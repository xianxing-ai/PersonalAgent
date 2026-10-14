"""Project-owned loopback adapter. Importing this file never loads model weights."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hmac
import hashlib
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request

MAX_BYTES = 131072
MAX_STATES = 4
ASSET_FILES = {"model.safetensors", "rl_agent_config.json", "encoder/config.json",
               "tokenizer/tokenizer_config.json", "tokenizer/tokenizer.json"}


def verify_model_assets(location):
    """Validate the generated offline model manifest without trusting source paths."""
    try:
        manifest = json.loads((location / "asset-manifest.json").read_text(encoding="utf-8"))
        files = manifest["files"]
        if manifest.get("formatVersion") != "1.0.0" or manifest.get("model") != "multilingual" \
                or not isinstance(files, list) or len(files) != len(ASSET_FILES) \
                or {item.get("path") for item in files} != ASSET_FILES:
            raise ValueError()
        for item in files:
            source = location / item["path"]
            if source.is_symlink() or not source.is_file() or source.stat().st_size != item["bytes"]:
                raise ValueError()
            digest = hashlib.sha256()
            with source.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if not hmac.compare_digest(digest.hexdigest(), item["sha256"]):
                raise ValueError()
    except Exception:
        raise ValueError("Offline Laya asset verification failed") from None


def create_app(agent, api_key, warmed=False):
    if not isinstance(api_key, str) or not api_key or "\n" in api_key or "\r" in api_key:
        raise ValueError("An explicit local API key is required")
    expected = ("Bearer " + api_key).encode("utf-8")
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="laya-local-batch")
    gate = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            pool.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(request):
        supplied = request.headers.get("authorization", "").encode("utf-8", "surrogateescape")
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(401, "Invalid local authorization")

    async def body(request):
        authorize(request)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "Request too large")
            data.extend(chunk)
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError):
            raise HTTPException(400, "Invalid JSON") from None
        if not isinstance(value, dict) or value.get("model") != "multilingual":
            raise HTTPException(400, "Only the explicitly loaded multilingual model is available")
        questions = value.get("questions")
        if not isinstance(questions, dict) or not 1 <= len(questions) <= 32:
            raise HTTPException(400, "Invalid questions")
        for question in questions.values():
            if not isinstance(question, dict) or question.get("type") != "choice":
                raise HTTPException(400, "Only bounded choice questions are supported")
            criteria = question.get("criteria")
            if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 16:
                raise HTTPException(400, "Invalid category whitelist")
        return value

    def remaining(value):
        deadline = value.get("deadline")
        if deadline is None:
            return 30.0  # Compatibility endpoint lacks a deadline field.
        try:
            instant = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            if instant.tzinfo is None:
                raise ValueError()
            seconds = (instant - datetime.now(timezone.utc)).total_seconds()
        except (AttributeError, TypeError, ValueError):
            raise HTTPException(400, "Invalid deadline") from None
        if seconds <= 0:
            raise HTTPException(408, "Deadline expired")
        # Explicit upstream deadlines include queue and model time. The old
        # compatibility default applies only when no deadline was supplied.
        return seconds

    async def infer(states, questions, seconds, request):
        if gate.locked():
            raise HTTPException(429, "Local inference busy")
        await gate.acquire()
        future = None
        try:
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            # One SDK call handles several independent states in one bounded forward batch.
            future = asyncio.get_running_loop().run_in_executor(
                pool, lambda: agent.predict_batch(states, questions, batch_size=MAX_STATES))
            results = await asyncio.wait_for(asyncio.shield(future), timeout=seconds)
            if not isinstance(results, list) or len(results) != len(states):
                raise HTTPException(502, "Model result count mismatch")
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            return results
        except asyncio.TimeoutError:
            raise HTTPException(408, "Inference deadline exceeded") from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Local inference unavailable") from None
        finally:
            # A CPU forward cannot be preempted. Keep admission closed until it
            # ends, even when the client deadline/disconnect cancels its waiter.
            def release_completed(completed):
                try:
                    # After timeout/cancellation no waiter consumes late model errors.
                    # Retrieve them without logging private provider details.
                    if not completed.cancelled():
                        completed.exception()
                finally:
                    gate.release()

            if future is None:
                gate.release()
            elif future.done():
                release_completed(future)
            else:
                future.add_done_callback(release_completed)

    @app.get("/health")
    async def health(request: Request):
        authorize(request)
        return {"status": "ok", "model": "multilingual", "capabilities": ["multi_state"], "maxStates": MAX_STATES,
                "warmed": warmed, "inferenceBusy": gate.locked()}

    @app.post("/v1/systemone/batch")
    async def batch(request: Request):
        value = await body(request)
        items = value.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_STATES:
            raise HTTPException(400, "Invalid state batch")
        ids, states = [], []
        for item in items:
            if not isinstance(item, dict) or set(item) != {"requestId", "state"}:
                raise HTTPException(400, "Invalid batch item")
            identifier = item["requestId"]
            if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128 or identifier in ids:
                raise HTTPException(400, "Invalid request identity")
            if len(json.dumps(item["state"], ensure_ascii=False)) > 5000:
                raise HTTPException(413, "State too large")
            ids.append(identifier)
            states.append(item["state"])
        results = await infer(states, value["questions"], remaining(value), request)
        return {"batching": "multi_state", "items": [
            {"requestId": identifier, "result": result} for identifier, result in zip(ids, results)]}

    @app.post("/v1/systemone")
    async def single(request: Request):
        value = await body(request)
        if "state" not in value or len(json.dumps(value["state"], ensure_ascii=False)) > 50000:
            raise HTTPException(413, "State missing or too large")
        return (await infer([value["state"]], value["questions"], remaining(value), request))[0]

    return app


def main():
    key = os.environ.get("LAYA_API_KEY", "")
    location = Path(os.environ.get("LAYA_MODEL_PATH", ""))
    if not key or not location.is_absolute() or not (location / "model.safetensors").is_file():
        raise SystemExit("Set LAYA_API_KEY and an existing absolute LAYA_MODEL_PATH; no automatic download")
    if os.environ.get("LAYA_VERIFY_MANIFEST") == "1":
        verify_model_assets(location)
    port = int(os.environ.get("LAYA_PORT", "8000"))
    if not 1024 <= port <= 65535:
        raise SystemExit("Invalid local port")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from laya.agent import Agent
    import uvicorn
    torch.set_num_threads(2)
    agent = Agent(str(location), device="cpu")
    # Bind only after weights/tokenizer loading and one real, public synthetic forward.
    # Readiness is not a quality score or a promise that a business task succeeded.
    warm = agent.predict_batch([{"context": "Synthetic startup readiness check"}], {
        "ready": {"type": "choice", "instructions": "Choose the applicable readiness label.",
                  "criteria": {"ready": "The synthetic test is ready", "review": "The synthetic test needs review"}}},
        batch_size=1)
    if not isinstance(warm, list) or len(warm) != 1 or not isinstance(warm[0], dict) or "answers" not in warm[0]:
        raise SystemExit("Laya warmup did not return a typed choice")
    uvicorn.run(create_app(agent, key, warmed=True), host="127.0.0.1", port=port, access_log=False,
                log_level="critical")


if __name__ == "__main__":
    main()
