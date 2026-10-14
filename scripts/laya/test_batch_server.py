"""Controlled server lifecycle regression; no model, socket or real source data."""
import asyncio
from datetime import datetime, timedelta, timezone
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import threading
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

spec = importlib.util.spec_from_file_location("local_batch_server", Path(__file__).with_name("batch-server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class OfflineAssetsTest(unittest.TestCase):
    def test_cgroup_probes_read_only_selected_cgroup_and_missing_is_not_zero(self):
        with tempfile.TemporaryDirectory() as parent:
            root=Path(parent);member=root/'membership';member.write_text('0::/fixture\n')
            group=root/'fixture';group.mkdir()
            missing=server.cgroup_snapshot(root,member)
            self.assertEqual(missing['cpuStat'],{'status':'missing'})
            self.assertNotIn('bytes',missing['memoryCurrent'])
            (group/'cpu.stat').write_text('usage_usec 123\nnr_throttled 2\nthrottled_usec 7\n')
            (group/'cpu.max').write_text('200000 100000\n')
            (group/'memory.current').write_text('4096\n');(group/'memory.max').write_text('max\n')
            value=server.cgroup_snapshot(root,member)
            self.assertEqual(value['cpuStat']['values']['usage_usec'],123)
            self.assertEqual(value['cpuMax']['quotaUs'],200000)
            self.assertEqual(value['memoryCurrent']['bytes'],4096)
            self.assertTrue(value['memoryMax']['unlimited'])
            member.write_text('0::/../other\n')
            self.assertEqual(server.cgroup_snapshot(root,member),{'status':'unsupported'})

    def test_offline_manifest_rejects_modified_weight_bytes_without_loading_model(self):
        with tempfile.TemporaryDirectory() as parent:
            location = Path(parent)
            files = []
            for name in sorted(server.ASSET_FILES):
                asset = location / name
                asset.parent.mkdir(parents=True, exist_ok=True)
                data = b"synthetic offline fixture"
                asset.write_bytes(data)
                files.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            (location / "asset-manifest.json").write_text(json.dumps({"formatVersion": "1.0.0",
                "model": "multilingual", "files": files}), encoding="utf-8")
            server.verify_model_assets(location)
            (location / "model.safetensors").write_bytes(b"modified synthetic bytes")
            with self.assertRaisesRegex(ValueError, "Offline Laya asset verification failed"):
                server.verify_model_assets(location)


class Request:
    headers = {"authorization": "Bearer synthetic-test-key"}

    def __init__(self, seconds=5):
        self.value = {"model": "multilingual", "items": [{"requestId": "synthetic-1", "state": {"text": "synthetic"}}],
                      "questions": {"category": {"type": "choice", "instructions": "Choose a public option.", "criteria": {"a": "A", "b": "B"}}},
                      "deadline": (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()}

    async def stream(self):
        yield json.dumps(self.value).encode()

    async def is_disconnected(self):
        return False


class SyntheticTokenizer:
    """Character tokens exercise admission/window control, not model quality."""
    mask_token = "<mask>"

    def __call__(self, text, add_special_tokens=False, truncation=False, max_length=None):
        values = list(range(len(text)))
        return {"input_ids": values[:max_length] if truncation else values}


class SyntheticAgent:
    tok = SyntheticTokenizer()
    cfg = {"max_len": 1024, "head_max_len": 256}
    model = SimpleNamespace(encoder=SimpleNamespace(config=SimpleNamespace(max_position_embeddings=8192)))

    def predict_batch(self, states, questions, batch_size, max_len, head_max_len):
        plan = server.complete_token_window(self, states, questions)
        return [{"usage": {"input_tokens": count, "output_tokens": 0}} for count in plan["expectedInputTokens"]]


class BatchServerReleaseTest(unittest.IsolatedAsyncioTestCase):
    async def test_expiry_during_tokenization_never_starts_a_new_forward(self):
        started=threading.Event();release=threading.Event();calls=[]

        class BlockingTokenizer(SyntheticTokenizer):
            def __call__(self,*args,**kwargs):
                started.set();release.wait(2)
                return super().__call__(*args,**kwargs)

        class Agent(SyntheticAgent):
            tok=BlockingTokenizer()
            def predict_batch(self,*args,**kwargs):
                calls.append(True);return super().predict_batch(*args,**kwargs)

        app=server.create_app(Agent(),'synthetic-test-key')
        endpoint=next(route.endpoint for route in app.routes if route.path=='/v1/systemone/batch')
        health=next(route.endpoint for route in app.routes if route.path=='/health')
        try:
            async with app.router.lifespan_context(app):
                task=asyncio.create_task(endpoint(Request(seconds=0.1)))
                while not started.is_set():await asyncio.sleep(0.001)
                with self.assertRaises(HTTPException) as expired:await task
                self.assertEqual(expired.exception.status_code,408)
                release.set()
                for _ in range(100):
                    if not (await health(Request()))['inferenceBusy']:break
                    await asyncio.sleep(0.002)
                self.assertEqual(calls,[])
                self.assertEqual((await health(Request()))['inferenceCalls'],0)
        finally:release.set()

    async def test_long_state_reaches_public_sdk_max_len_without_losing_tail(self):
        captured = []

        class Agent(SyntheticAgent):
            def predict_batch(self, states, questions, batch_size, max_len, head_max_len):
                captured.append((states, max_len, head_max_len))
                return super().predict_batch(states, questions, batch_size, max_len, head_max_len)

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/batch")
        request = Request()
        request.value["items"][0]["state"] = "public source " * 120 + "tail evidence must remain"
        async with app.router.lifespan_context(app):
            result = (await endpoint(request))["items"][0]["result"]
        window = result["tokenWindow"]
        self.assertGreaterEqual(result['inferenceMetrics']['precheckMs'],0)
        self.assertGreaterEqual(result['inferenceMetrics']['forwardMs'],0)
        self.assertGreaterEqual(result['inferenceMetrics']['processCpuMs'],0)
        self.assertEqual(result['inferenceMetrics']['forwardScope'],'sdk_predict_batch')
        self.assertGreater(window["encodedTokens"], 1024)
        self.assertEqual(window["encodedTokens"], window["expectedInputTokens"][0])
        self.assertEqual(window["droppedTokens"], 0)
        self.assertFalse(window["truncated"])
        self.assertEqual(captured[0][0][0], request.value["items"][0]["state"])
        self.assertGreater(captured[0][1], 1024)
        self.assertLessEqual(captured[0][1], 8192)

    async def test_encoder_overflow_is_explicit_and_never_submits_model_forward(self):
        calls = []

        class Agent(SyntheticAgent):
            def predict_batch(self, *args, **kwargs):
                calls.append(True)
                return super().predict_batch(*args, **kwargs)

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone")
        request = Request()
        request.value["state"] = "a" * 8192
        async with app.router.lifespan_context(app):
            with self.assertRaises(HTTPException) as overflow:
                await endpoint(request)
            self.assertEqual(overflow.exception.status_code, 413)
            self.assertEqual(overflow.exception.detail["code"], "CONTEXT_WINDOW_EXCEEDED")
            self.assertGreater(overflow.exception.detail["requiredTokens"], 8192)
            self.assertEqual(calls, [])

    async def test_sdk_usage_mismatch_cannot_claim_complete_context(self):
        class Agent(SyntheticAgent):
            def predict_batch(self, *args, **kwargs):
                return [{"usage": {"input_tokens": 1}}]

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/batch")
        async with app.router.lifespan_context(app):
            with self.assertRaises(HTTPException) as mismatch:
                await endpoint(Request())
            self.assertEqual(mismatch.exception.status_code, 502)
            self.assertEqual(mismatch.exception.detail, "Model token window mismatch")

    async def test_explicit_deadline_reaches_inference_without_a_hidden_30_second_cap(self):
        captured = []

        class Agent(SyntheticAgent):
            pass

        original_wait_for = asyncio.wait_for

        async def observe_wait_for(awaitable, timeout):
            captured.append(timeout)
            return await original_wait_for(awaitable, timeout=timeout)

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/batch")
        async with app.router.lifespan_context(app):
            with patch.object(server.asyncio, "wait_for", observe_wait_for):
                await endpoint(Request(seconds=90))
                legacy = Request()
                del legacy.value["deadline"]
                await endpoint(legacy)
                with self.assertRaises(HTTPException) as expired:
                    await endpoint(Request(seconds=-1))
            self.assertEqual(expired.exception.status_code, 408)
            self.assertEqual(len(captured), 2, "Expired requests never submit inference")
            self.assertGreater(captured[0], 80, "An explicit 90-second deadline must not become 30 seconds")
            self.assertLessEqual(captured[0], 90)
            self.assertEqual(captured[1], 30.0, "Only the no-deadline compatibility endpoint defaults to 30 seconds")

    async def test_late_inference_failure_is_consumed_without_logging_private_error(self):
        release = threading.Event()
        finished = threading.Event()
        calls = 0
        unhandled = []
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

        class Agent(SyntheticAgent):
            def predict_batch(self, states, questions, batch_size, max_len, head_max_len):
                nonlocal calls
                calls += 1
                if calls == 1:
                    try:
                        if not release.wait(5):
                            raise RuntimeError("synthetic test release timeout")
                        raise RuntimeError("synthetic-private-model-details")
                    finally:
                        finished.set()
                return super().predict_batch(states, questions, batch_size, max_len, head_max_len)

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/batch")
        try:
            async with app.router.lifespan_context(app):
                with self.assertRaises(HTTPException) as expired:
                    await endpoint(Request(seconds=0.1))
                self.assertEqual(expired.exception.status_code, 408)
                self.assertEqual(expired.exception.detail, "Inference deadline exceeded")
                with self.assertRaises(HTTPException) as busy:
                    await endpoint(Request())
                self.assertEqual(busy.exception.status_code, 429)
                self.assertEqual(calls, 1)
                release.set()
                for _ in range(100):
                    await asyncio.sleep(0.005)
                    if finished.is_set():
                        break
                self.assertTrue(finished.is_set())
                # Let the executor completion and admission-release callbacks run,
                # then surface any unobserved Future exception through the loop.
                for _ in range(3):
                    await asyncio.sleep(0)
                    gc.collect()
                self.assertEqual(unhandled, [], "late provider exceptions must not reach the event-loop logger")
                self.assertEqual((await endpoint(Request()))["items"][0]["requestId"], "synthetic-1")
                self.assertEqual(calls, 2)
        finally:
            release.set()
            loop.set_exception_handler(previous_handler)


if __name__ == "__main__":
    unittest.main()
