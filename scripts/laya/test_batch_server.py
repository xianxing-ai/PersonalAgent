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

from fastapi import HTTPException

spec = importlib.util.spec_from_file_location("local_batch_server", Path(__file__).with_name("batch-server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class OfflineAssetsTest(unittest.TestCase):
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
                      "questions": {"category": {"type": "choice", "criteria": {"a": "A", "b": "B"}}},
                      "deadline": (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()}

    async def stream(self):
        yield json.dumps(self.value).encode()

    async def is_disconnected(self):
        return False


class BatchServerReleaseTest(unittest.IsolatedAsyncioTestCase):
    async def test_late_inference_failure_is_consumed_without_logging_private_error(self):
        release = threading.Event()
        finished = threading.Event()
        calls = 0
        unhandled = []
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

        class Agent:
            def predict_batch(self, states, questions, batch_size):
                nonlocal calls
                calls += 1
                if calls == 1:
                    try:
                        if not release.wait(5):
                            raise RuntimeError("synthetic test release timeout")
                        raise RuntimeError("synthetic-private-model-details")
                    finally:
                        finished.set()
                return [{} for _ in states]

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
