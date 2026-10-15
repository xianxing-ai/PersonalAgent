"""Controlled server lifecycle regression; no model, socket or real source data."""
import asyncio
from datetime import datetime, timedelta, timezone
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import threading
import time
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
    mask_token_id = 3
    cls_token_id = 1
    sep_token_id = 2
    pad_token_id = 0

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


def heterogeneous_agent():
    """Real pinned SDK encode/collate/decode, synthetic forward; no weights."""
    import numpy as np
    import torch
    from laya.agent import Agent

    class AgentFixture(SyntheticAgent):
        device = torch.device("cpu")
        hooks = []
        temperature = [1, 1, 1]
        temperature_by_options = {}
        lang_temperatures = {}
        _check_question = staticmethod(Agent._check_question)
        _to_internal = staticmethod(Agent._to_internal)

        def __init__(self):
            self.model = SimpleNamespace(training=False, encoder=SimpleNamespace(config=SimpleNamespace(max_position_embeddings=8192)))
            self.encoded = []
            self.offsets = []
            self.forwards = []
            self.before_encode = None
            self.before_forward = None

        def _encode_state(self, state, ids, internal, max_len=None, head_max_len=None):
            if self.before_encode:
                self.before_encode(state)
            self.encoded.append((state, ids, internal))
            return Agent._encode_state(self, state, ids, internal, max_len=max_len, head_max_len=head_max_len)

        def _forward(self, b):
            self.forwards.append(b)
            if self.before_forward:
                self.before_forward()
            assert not torch.is_grad_enabled()
            assert torch.is_inference_mode_enabled(), "The context must be entered in the worker thread"
            count, width = b["marker_pos"].shape
            logits = np.full((count, width), -5.0)
            for row in range(count):
                options = int(b["marker_mask"][row].sum())
                logits[row, row % options] = 5.0
            return logits, np.full((count, 2), 0.5)

        def _decode_answers(self, logits, act, items, ids, internal, offset, lang=None):
            self.offsets.append(offset)
            return Agent._decode_answers(self, logits, act, items, ids, internal, offset, lang)

    return AgentFixture()


def independent_request(seconds=5):
    request = Request(seconds)
    request.value = {"model": "multilingual", "batchId": "synthetic-independent-batch", "items": [
        {"itemId": "first-opaque", "state": "first distinct state", "questions": {
            "first_question": {"type": "choice", "instructions": "First question.", "criteria": {"first-A": "Alpha", "first-B": "Beta"}},
            "second_question": {"type": "choice", "instructions": "Second question.", "criteria": {"first-X": "X", "first-Y": "Y", "first-Z": "Z"}}},
         "deadline": (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()},
        {"itemId": "second-opaque", "state": "second separate state " * 70, "questions": {
            "other_question": {"type": "choice", "instructions": "Different question.", "criteria": {"other-A": "Other A", "other-B": "Other B"}}},
         "deadline": (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()}]}
    return request


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

        original_wait = asyncio.wait

        async def observe_wait(awaitables, *, timeout, return_when):
            captured.append(timeout)
            return await original_wait(awaitables, timeout=timeout, return_when=return_when)

        app = server.create_app(Agent(), "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/batch")
        async with app.router.lifespan_context(app):
            with patch.object(server.asyncio, "wait", observe_wait):
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
            self.assertGreater(captured[1], 29, "The no-deadline compatibility endpoint retains its 30-second window")
            self.assertLessEqual(captured[1], 30)

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


class LegacyDisconnectTest(unittest.IsolatedAsyncioTestCase):
    async def wait_for_event(self, event):
        self.assertTrue(await asyncio.to_thread(event.wait, 10), "Worker did not reach the controlled barrier")

    async def wait_until_idle(self, health):
        async def idle():
            while (await health(Request()))["inferenceBusy"]:
                await asyncio.sleep(0.005)
        await asyncio.wait_for(idle(), timeout=5)

    async def test_disconnect_during_precheck_never_starts_forward(self):
        for path in ("/v1/systemone", "/v1/systemone/batch"):
            entered, release = threading.Event(), threading.Event()
            disconnected = False
            calls = []

            class Tokenizer(SyntheticTokenizer):
                def __call__(self, *args, **kwargs):
                    entered.set()
                    if not release.wait(10):
                        raise RuntimeError("synthetic tokenizer barrier release timeout")
                    return super().__call__(*args, **kwargs)

            class Agent(SyntheticAgent):
                tok = Tokenizer()

                def predict_batch(self, *args, **kwargs):
                    calls.append(True)
                    return super().predict_batch(*args, **kwargs)

            request = Request(seconds=30)
            request.value["state"] = "synthetic legacy state"

            async def is_disconnected():
                return disconnected

            request.is_disconnected = is_disconnected
            app = server.create_app(Agent(), "synthetic-test-key")
            endpoint = next(route.endpoint for route in app.routes if route.path == path)
            health = next(route.endpoint for route in app.routes if route.path == "/health")
            task = None
            async with app.router.lifespan_context(app):
                try:
                    task = asyncio.create_task(endpoint(request))
                    await self.wait_for_event(entered)
                    disconnected = True
                    done, _ = await asyncio.wait([task], timeout=0.5)
                    self.assertTrue((await health(Request()))["inferenceBusy"], "Tokenization still owns admission")
                    release.set()
                    with self.assertRaises(HTTPException) as stopped:
                        await asyncio.wait_for(asyncio.shield(task), timeout=5)
                    self.assertEqual(stopped.exception.status_code, 408)
                    await self.wait_until_idle(health)
                    self.assertEqual(calls, [], "A disconnected waiter cannot admit a new CPU forward")
                    self.assertEqual((await health(Request()))["inferenceCalls"], 0)
                    self.assertIn(task, done, "Disconnect must finish the waiter while tokenization is paused")
                finally:
                    if task is not None and not task.done():
                        task.cancel()
                    release.set()
                    if task is not None:
                        await asyncio.gather(task, return_exceptions=True)

    async def test_disconnect_during_forward_keeps_gate_and_consumes_late_errors(self):
        for path in ("/v1/systemone", "/v1/systemone/batch"):
            entered, release = threading.Event(), threading.Event()
            disconnected = False
            calls = []
            unhandled = []
            loop = asyncio.get_running_loop()
            previous = loop.get_exception_handler()
            loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

            class Agent(SyntheticAgent):
                def predict_batch(self, *args, **kwargs):
                    calls.append(True)
                    if len(calls) == 1:
                        entered.set()
                        if not release.wait(10):
                            raise RuntimeError("synthetic forward barrier release timeout")
                        raise RuntimeError("synthetic-private-late-provider-error")
                    return super().predict_batch(*args, **kwargs)

            request = Request(seconds=30)
            request.value["state"] = "synthetic legacy state"

            async def is_disconnected():
                return disconnected

            request.is_disconnected = is_disconnected
            app = server.create_app(Agent(), "synthetic-test-key")
            endpoint = next(route.endpoint for route in app.routes if route.path == path)
            health = next(route.endpoint for route in app.routes if route.path == "/health")
            task = None
            try:
                async with app.router.lifespan_context(app):
                    try:
                        task = asyncio.create_task(endpoint(request))
                        await self.wait_for_event(entered)
                        disconnected = True
                        done, _ = await asyncio.wait([task], timeout=0.5)
                        self.assertIn(task, done, "Disconnect must finish the waiter while CPU forward is paused")
                        with self.assertRaises(HTTPException) as stopped:
                            task.result()
                        self.assertEqual(stopped.exception.status_code, 408)
                        self.assertTrue((await health(Request()))["inferenceBusy"])
                        competing = Request()
                        competing.value["state"] = "competing synthetic state"
                        with self.assertRaises(HTTPException) as busy:
                            await endpoint(competing)
                        self.assertEqual(busy.exception.status_code, 429)
                        self.assertEqual(len(calls), 1)
                        release.set()
                        await self.wait_until_idle(health)
                        for _ in range(3):
                            await asyncio.sleep(0)
                            gc.collect()
                        self.assertEqual(unhandled, [])
                        self.assertFalse((await health(Request()))["inferenceBusy"])
                        fresh = Request()
                        fresh.value["state"] = "fresh synthetic state"
                        await endpoint(fresh)
                        self.assertEqual(len(calls), 2)
                    finally:
                        if task is not None and not task.done():
                            task.cancel()
                        release.set()
                        if task is not None:
                            await asyncio.gather(task, return_exceptions=True)
            finally:
                release.set()
                loop.set_exception_handler(previous)

    async def test_cancellation_during_watcher_cleanup_cannot_strand_cpu_admission(self):
        for path in ("/v1/systemone", "/v1/systemone/batch"):
            entered, release = threading.Event(), threading.Event()
            probe_entered, cleanup_entered, cleanup_release = asyncio.Event(), asyncio.Event(), asyncio.Event()
            calls, unhandled = [], []
            loop = asyncio.get_running_loop()
            previous = loop.get_exception_handler()
            loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

            class Agent(SyntheticAgent):
                def predict_batch(self, *args, **kwargs):
                    calls.append(True)
                    if len(calls) == 1:
                        entered.set()
                        if not release.wait(10):
                            raise RuntimeError("synthetic forward barrier release timeout")
                        raise RuntimeError("synthetic-private-late-provider-error")
                    return super().predict_batch(*args, **kwargs)

            request = Request(seconds=30)
            request.value["state"] = "synthetic legacy state"
            probes = 0

            async def is_disconnected():
                nonlocal probes
                probes += 1
                if probes == 1:
                    return False
                probe_entered.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cleanup_entered.set()
                    await cleanup_release.wait()

            request.is_disconnected = is_disconnected
            app = server.create_app(Agent(), "synthetic-test-key")
            endpoint = next(route.endpoint for route in app.routes if route.path == path)
            health = next(route.endpoint for route in app.routes if route.path == "/health")
            task = None
            try:
                async with app.router.lifespan_context(app):
                    try:
                        task = asyncio.create_task(endpoint(request))
                        await self.wait_for_event(entered)
                        await asyncio.wait_for(probe_entered.wait(), timeout=5)
                        task.cancel()
                        await asyncio.wait_for(cleanup_entered.wait(), timeout=5)
                        self.assertFalse(task.done(), "Endpoint must be paused in watcher cleanup")
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                        self.assertTrue((await health(Request()))["inferenceBusy"])
                        competing = Request()
                        competing.value["state"] = "competing synthetic state"
                        with self.assertRaises(HTTPException) as busy:
                            await endpoint(competing)
                        self.assertEqual(busy.exception.status_code, 429)
                        self.assertEqual(len(calls), 1)
                        release.set()
                        await self.wait_until_idle(health)
                        for _ in range(3):
                            await asyncio.sleep(0)
                            gc.collect()
                        self.assertEqual(unhandled, [], "Late CPU errors must still be consumed after cleanup cancellation")
                        fresh = Request()
                        fresh.value["state"] = "fresh synthetic state"
                        await endpoint(fresh)
                        self.assertEqual(len(calls), 2)
                    finally:
                        release.set()
                        cleanup_release.set()
                        if task is not None:
                            if not task.done():
                                task.cancel()
                            await asyncio.gather(task, return_exceptions=True)
            finally:
                release.set()
                loop.set_exception_handler(previous)


class IndependentBatchTest(unittest.IsolatedAsyncioTestCase):
    async def test_distinct_state_questions_use_exactly_one_real_sdk_collation_forward_and_correct_offsets(self):
        agent = heterogeneous_agent()
        app = server.create_app(agent, "synthetic-test-key", warmed=True, cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        health = next(route.endpoint for route in app.routes if route.path == "/health")
        request = independent_request()
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
            self.assertEqual((await health(Request()))["inferenceCalls"], 1)
        self.assertEqual(len(agent.forwards), 1)
        self.assertEqual(agent.forwards[0]["input_ids"].shape[0], 3, "Question rows, not item count, define the tensor batch")
        self.assertEqual(agent.offsets, [0, 2])
        self.assertEqual([entry[0] for entry in agent.encoded], [item["state"] for item in request.value["items"]])
        self.assertEqual(agent.encoded[0][2]["first_question"]["crit"], request.value["items"][0]["questions"]["first_question"]["criteria"])
        self.assertEqual(response["batchId"], request.value["batchId"])
        first, second = [item["result"] for item in response["items"]]
        self.assertEqual(first["answers"]["first_question"]["choice"], "first-A")
        self.assertEqual(first["answers"]["second_question"]["choice"], "first-Y")
        self.assertEqual(second["answers"]["other_question"]["choice"], "other-A")
        self.assertGreater(second["tokenWindow"]["encodedTokens"], 1024)
        for result in (first, second):
            self.assertEqual(result["usage"]["input_tokens"], result["tokenWindow"]["expectedInputTokens"][0])
            self.assertEqual(result["inferenceMetrics"]["forwardScope"], "sdk_heterogeneous_forward")
            self.assertEqual(result["sharedForward"], {"batchId": request.value["batchId"], "batchSize": 2})
            self.assertFalse(result["tokenWindow"]["truncated"])
            self.assertEqual(result["tokenWindow"]["droppedTokens"], 0)
        self.assertEqual(first["inferenceMetrics"], second["inferenceMetrics"], "One forward timing is shared, not two independent forwards")

    async def test_invalid_questions_overflow_and_expired_item_are_isolated_from_a_good_item(self):
        for bad in ("questions", "overflow", "expired"):
            agent = heterogeneous_agent()
            app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
            endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
            request = independent_request()
            if bad == "questions":
                request.value["items"][0]["questions"] = {"bad": {"type": "score"}}
            elif bad == "overflow":
                request.value["items"][0]["state"] = "x" * 8192
            else:
                request.value["items"][0]["deadline"] = "2020-01-01T00:00:00Z"
            async with app.router.lifespan_context(app):
                response = await endpoint(request)
            self.assertEqual(response["items"][0]["error"]["status"], {"questions": 400, "overflow": 413, "expired": 408}[bad])
            self.assertIn("result", response["items"][1])
            self.assertEqual(len(agent.forwards), 1)
            self.assertEqual(agent.forwards[0]["input_ids"].shape[0], 1)

    async def test_expiry_while_encoding_other_item_is_removed_before_forward_and_offsets_recomputed(self):
        agent = heterogeneous_agent()
        request = independent_request()
        request.value["items"][0]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.1)).isoformat()
        agent.before_encode = lambda state: time.sleep(0.15) if state.startswith("second") else None
        app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
        self.assertEqual(response["items"][0]["error"]["code"], "TIMEOUT")
        self.assertIn("result", response["items"][1])
        self.assertEqual(agent.forwards[0]["input_ids"].shape[0], 1)
        self.assertEqual(agent.offsets, [0])

    async def test_all_items_expire_during_encoding_without_starting_forward(self):
        agent = heterogeneous_agent()
        agent.before_encode = lambda _state: time.sleep(0.08)
        app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        health = next(route.endpoint for route in app.routes if route.path == "/health")
        async with app.router.lifespan_context(app):
            with self.assertRaises(HTTPException) as expired:
                await endpoint(independent_request(0.04))
            self.assertEqual(expired.exception.status_code, 408)
            for _ in range(100):
                if not (await health(Request()))["inferenceBusy"]:
                    break
                await asyncio.sleep(0.005)
            self.assertEqual((await health(Request()))["inferenceCalls"], 0)
        self.assertEqual(agent.forwards, [])

    async def test_collation_expiry_rebuilds_only_live_rows_and_token_mismatch_is_independent(self):
        from laya.common import collate_items
        for boundary in ("collation", "token_mismatch"):
            agent = heterogeneous_agent()
            request = independent_request()
            if boundary == "collation":
                request.value["items"][0]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.06)).isoformat()
            else:
                original = agent._encode_state

                def altered(state, ids, internal, max_len=None, head_max_len=None):
                    rows = original(state, ids, internal, max_len, head_max_len)
                    if state.startswith("first"):
                        rows[0]["ids"] = rows[0]["ids"][:-1]
                    return rows

                agent._encode_state = altered
            calls = []

            def collate(groups, pad):
                calls.append(len(groups))
                if boundary == "collation" and len(calls) == 1:
                    time.sleep(0.1)
                return collate_items(groups, pad)

            app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
            endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
            async with app.router.lifespan_context(app):
                with patch("laya.common.collate_items", side_effect=collate):
                    response = await endpoint(request)
            self.assertEqual(response["items"][0]["error"]["code"], "TIMEOUT" if boundary == "collation" else "TOKEN_WINDOW_MISMATCH")
            self.assertIn("result", response["items"][1])
            self.assertEqual(agent.forwards[0]["input_ids"].shape[0], 1)
            self.assertEqual(agent.offsets, [0])
            self.assertEqual(calls, [2, 1] if boundary == "collation" else [1])

    async def test_one_item_expires_during_non_preemptible_forward_but_other_result_survives(self):
        agent = heterogeneous_agent()
        agent.before_forward = lambda: time.sleep(0.15)
        request = independent_request()
        request.value["items"][0]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.07)).isoformat()
        app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
        self.assertEqual(len(agent.forwards), 1)
        self.assertEqual(response["items"][0]["error"]["code"], "TIMEOUT")
        self.assertIn("result", response["items"][1])

    async def test_cancellation_or_disconnect_keeps_admission_busy_until_cpu_finishes(self):
        for stop_kind in ("cancel", "disconnect"):
            agent = heterogeneous_agent()
            entered, release = threading.Event(), threading.Event()
            agent.before_forward = lambda: (entered.set(), release.wait(3))
            request = independent_request()
            disconnected = False

            async def is_disconnected():
                return disconnected

            request.is_disconnected = is_disconnected
            app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
            endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
            health = next(route.endpoint for route in app.routes if route.path == "/health")
            try:
                async with app.router.lifespan_context(app):
                    task = asyncio.create_task(endpoint(request))
                    while not entered.is_set():
                        await asyncio.sleep(0.001)
                    if stop_kind == "cancel":
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                    else:
                        disconnected = True
                        with self.assertRaises(HTTPException) as stopped:
                            await task
                        self.assertEqual(stopped.exception.status_code, 408)
                    self.assertTrue((await health(Request()))["inferenceBusy"])
                    with self.assertRaises(HTTPException) as busy:
                        await endpoint(independent_request())
                    self.assertEqual(busy.exception.status_code, 429)
                    self.assertEqual(len(agent.forwards), 1)
                    release.set()
                    for _ in range(100):
                        if not (await health(Request()))["inferenceBusy"]:
                            break
                        await asyncio.sleep(0.005)
                    self.assertFalse((await health(Request()))["inferenceBusy"])
                    await endpoint(independent_request())
                    self.assertEqual(len(agent.forwards), 2)
            finally:
                release.set()

    async def test_unsupported_sdk_hooks_training_or_device_never_silently_loop_single_predictions(self):
        for incompatible in ("version", "hooks", "global_hooks", "training", "device", "signature"):
            agent = heterogeneous_agent()
            if incompatible == "hooks":
                agent.hooks = [object()]
            elif incompatible == "training":
                agent.model.training = True
            elif incompatible == "device":
                agent.device = SimpleNamespace(type="unsupported_accelerator")
            elif incompatible == "signature":
                agent._forward = lambda changed_argument: None
            app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
            endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
            async with app.router.lifespan_context(app):
                with patch.object(server, "version", return_value="0.0.0" if incompatible == "version" else "0.3.20"), \
                        patch("laya.hooks.default_hooks", return_value=[object()] if incompatible == "global_hooks" else []):
                    with self.assertRaises(HTTPException) as rejected:
                        await endpoint(independent_request())
            self.assertEqual(rejected.exception.status_code, 503)
            self.assertEqual(agent.forwards, [])

    async def test_duplicate_item_identity_oversized_batch_and_auth_fail_before_forward(self):
        for invalid in ("duplicate", "size", "auth"):
            agent = heterogeneous_agent()
            request = independent_request()
            if invalid == "duplicate":
                request.value["items"][1]["itemId"] = request.value["items"][0]["itemId"]
            elif invalid == "size":
                request.value["items"] *= 3
            else:
                request.headers = {"authorization": "Bearer wrong-key"}
            app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
            endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
            async with app.router.lifespan_context(app):
                with self.assertRaises(HTTPException) as rejected:
                    await endpoint(request)
            self.assertEqual(rejected.exception.status_code, 401 if invalid == "auth" else 400)
            self.assertEqual(agent.forwards, [])

    async def test_new_endpoint_requires_each_deadline_while_single_compatibility_still_accepts_omission(self):
        agent = heterogeneous_agent()
        app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        single = next(route.endpoint for route in app.routes if route.path == "/v1/systemone")
        async with app.router.lifespan_context(app):
            for invalid in (None, 123, "not-an-instant"):
                request = independent_request()
                request.value["items"][0]["deadline"] = invalid
                result = await endpoint(request)
                self.assertEqual(result["items"][0]["error"]["status"], 400)
                self.assertIn("result", result["items"][1])
            request = Request()
            request.value["state"] = "single compatibility state"
            del request.value["deadline"]
            result = await single(request)
            self.assertIn("tokenWindow", result)


class InferenceContextDeadlineTest(unittest.IsolatedAsyncioTestCase):
    async def test_packed_context_entry_expiry_removes_only_expired_rows_before_forward(self):
        import torch
        real_mode = torch.inference_mode

        class DelayedMode:
            def __enter__(self):
                time.sleep(0.1)
                self.context = real_mode()
                return self.context.__enter__()

            def __exit__(self, *args):
                return self.context.__exit__(*args)

        agent = heterogeneous_agent()
        app = server.create_app(agent, "synthetic-test-key", cpu_execution_policy="packed")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        request = independent_request()
        request.value["items"][0]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.06)).isoformat()
        async with app.router.lifespan_context(app):
            with patch.object(torch, "inference_mode", return_value=DelayedMode()):
                response = await endpoint(request)
        self.assertEqual(response["items"][0]["error"]["code"], "TIMEOUT")
        self.assertIn("result", response["items"][1])
        self.assertEqual(len(agent.forwards), 1)
        self.assertEqual(agent.forwards[0]["input_ids"].shape[0], 1)
        self.assertEqual(agent.offsets, [0])
        self.assertEqual(response["execution"]["forwardCount"], 1)

    async def test_context_creation_and_entry_expiry_do_not_start_or_count_legacy_or_independent_forward(self):
        import torch
        real_mode = torch.inference_mode
        for path in ("/v1/systemone/batch", "/v1/systemone/independent-batch"):
            for boundary in ("creation", "entry"):
                entered, release = threading.Event(), threading.Event()
                calls = []

                class Agent(SyntheticAgent):
                    def predict_batch(self, *args, **kwargs):
                        calls.append(True)
                        return super().predict_batch(*args, **kwargs)

                agent = heterogeneous_agent() if path.endswith("independent-batch") else Agent()

                class DelayedMode:
                    def __enter__(self):
                        if boundary == "entry":
                            entered.set()
                            release.wait(3)
                        self.context = real_mode()
                        return self.context.__enter__()

                    def __exit__(self, *args):
                        return self.context.__exit__(*args)

                def mode():
                    if boundary == "creation":
                        entered.set()
                        release.wait(3)
                    return DelayedMode()

                app = server.create_app(agent, "synthetic-test-key")
                endpoint = next(route.endpoint for route in app.routes if route.path == path)
                health = next(route.endpoint for route in app.routes if route.path == "/health")
                try:
                    async with app.router.lifespan_context(app):
                        with patch.object(torch, "inference_mode", side_effect=mode):
                            request = independent_request(0.06) if path.endswith("independent-batch") else Request(0.06)
                            task = asyncio.create_task(endpoint(request))
                            for _ in range(400):
                                if entered.is_set():
                                    break
                                await asyncio.sleep(0.001)
                            self.assertTrue(entered.is_set())
                            with self.assertRaises(HTTPException) as expired:
                                await task
                            self.assertEqual(expired.exception.status_code, 408)
                            self.assertTrue((await health(Request()))["inferenceBusy"])
                            release.set()
                            for _ in range(100):
                                if not (await health(Request()))["inferenceBusy"]:
                                    break
                                await asyncio.sleep(0.005)
                        self.assertEqual((await health(Request()))["inferenceCalls"], 0)
                        self.assertEqual(calls, [])
                        if path.endswith("independent-batch"):
                            self.assertEqual(agent.forwards, [])
                finally:
                    release.set()


class SequentialExecutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_default_uses_distinct_forwards_without_cross_item_padding_and_reports_real_ids(self):
        agent = heterogeneous_agent()
        app = server.create_app(agent, "synthetic-test-key", warmed=True)
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        health = next(route.endpoint for route in app.routes if route.path == "/health")
        request = independent_request()
        request.value["executionPolicy"] = "packed"  # Untrusted request data cannot change startup policy.
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
            value = await health(Request())
        self.assertEqual(value["executionPolicy"], "sequential")
        self.assertEqual(value["inferenceMode"], "inference_mode")
        self.assertEqual(value["inferenceCalls"], 2)
        self.assertEqual(response["execution"], {"policy": "sequential", "forwardCount": 2})
        self.assertEqual(len(agent.forwards), 2)
        self.assertEqual([batch["input_ids"].shape[0] for batch in agent.forwards], [2, 1])
        self.assertNotEqual(agent.forwards[0]["input_ids"].shape[1], agent.forwards[1]["input_ids"].shape[1])
        self.assertEqual(agent.offsets, [0, 0], "Offsets restart inside every actual forward")
        results = [item["result"] for item in response["items"]]
        self.assertNotEqual(results[0]["forward"]["forwardId"], results[1]["forward"]["forwardId"])
        self.assertEqual([result["forward"]["index"] for result in results], [1, 2])
        for result in results:
            self.assertEqual(result["forward"]["scope"], "sdk_independent_sequential_forward")
            self.assertEqual(result["forward"]["itemCount"], 1)
            self.assertNotIn("sharedForward", result)
            self.assertEqual(result["usage"]["input_tokens"], result["tokenWindow"]["expectedInputTokens"][0])
            self.assertEqual(result["tokenWindow"]["droppedTokens"], 0)
            self.assertEqual(result["inferenceMetrics"]["precheckScope"], "forward_group_collation")

    async def test_item_expiring_during_previous_forward_is_not_started_or_retried(self):
        agent = heterogeneous_agent()
        agent.before_forward = lambda: time.sleep(0.1)
        request = independent_request()
        request.value["items"][1]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.06)).isoformat()
        app = server.create_app(agent, "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
        self.assertEqual(len(agent.forwards), 1)
        self.assertIn("result", response["items"][0])
        self.assertEqual(response["items"][1]["error"]["code"], "TIMEOUT")
        self.assertEqual(response["execution"]["forwardCount"], 1)

    async def test_expired_first_result_does_not_prevent_second_forward_or_renew_either_deadline(self):
        agent = heterogeneous_agent()
        agent.before_forward = lambda: time.sleep(0.1)
        request = independent_request()
        request.value["items"][0]["deadline"] = (datetime.now(timezone.utc) + timedelta(seconds=0.06)).isoformat()
        app = server.create_app(agent, "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        async with app.router.lifespan_context(app):
            response = await endpoint(request)
        self.assertEqual(len(agent.forwards), 2)
        self.assertEqual(response["items"][0]["error"]["code"], "TIMEOUT")
        self.assertIn("result", response["items"][1])
        self.assertEqual(response["items"][1]["result"]["forward"]["index"], 2)
        self.assertEqual(response["execution"]["forwardCount"], 2)

    async def test_all_cancelled_waiters_cannot_start_later_sequential_forward(self):
        agent = heterogeneous_agent()
        entered, release = threading.Event(), threading.Event()
        agent.before_forward = lambda: (entered.set(), release.wait(3))
        app = server.create_app(agent, "synthetic-test-key")
        endpoint = next(route.endpoint for route in app.routes if route.path == "/v1/systemone/independent-batch")
        health = next(route.endpoint for route in app.routes if route.path == "/health")
        try:
            async with app.router.lifespan_context(app):
                task = asyncio.create_task(endpoint(independent_request()))
                while not entered.is_set():
                    await asyncio.sleep(0.001)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertTrue((await health(Request()))["inferenceBusy"])
                release.set()
                for _ in range(100):
                    if not (await health(Request()))["inferenceBusy"]:
                        break
                    await asyncio.sleep(0.005)
                self.assertEqual(len(agent.forwards), 1)
                self.assertEqual((await health(Request()))["inferenceCalls"], 1)
        finally:
            release.set()

    def test_unknown_policy_rejected_before_any_inference(self):
        with self.assertRaisesRegex(ValueError, "CPU execution policy"):
            server.create_app(SyntheticAgent(), "synthetic-test-key", cpu_execution_policy="online-autotune")


if __name__ == "__main__":
    unittest.main()
