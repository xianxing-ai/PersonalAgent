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
import threading
import time

from fastapi import FastAPI, HTTPException, Request

MAX_BYTES = 131072
MAX_STATES = 4
ASSET_FILES = {"model.safetensors", "rl_agent_config.json", "encoder/config.json",
               "tokenizer/tokenizer_config.json", "tokenizer/tokenizer.json"}


class ContextWindowExceeded(Exception):
    """The loaded encoder cannot see all supplied decision material."""

    def __init__(self, required, maximum):
        self.required = required
        self.maximum = maximum


class InferenceControlStopped(Exception):
    """The original waiter expired/cancelled before a new forward."""


def cgroup_snapshot(root=Path("/sys/fs/cgroup"), membership=Path("/proc/self/cgroup")):
    """Read only this process's cgroup v2; omit unavailable measurements."""
    try:
        location = next(line[3:] for line in membership.read_text().splitlines() if line.startswith("0::"))
        relative = Path(location.lstrip("/"))
        if ".." in relative.parts:
            return {"status": "unsupported"}
        directory = root / relative
        if not directory.is_dir():
            return {"status": "missing"}
    except (OSError, StopIteration):
        return {"status": "unsupported"}

    def read(name, parse):
        try:
            return {"status": "available", **parse((directory / name).read_text().strip())}
        except FileNotFoundError:
            return {"status": "missing"}
        except (OSError, ValueError, IndexError):
            return {"status": "unsupported"}

    def cpu_stat(text):
        allowed = {"usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec"}
        values = {key: int(value) for key, value in (line.split() for line in text.splitlines()) if key in allowed}
        if not values or any(value < 0 for value in values.values()):
            raise ValueError()
        return {"values": values}

    def cpu_max(text):
        quota, period = text.split()
        period = int(period)
        if period <= 0 or quota != "max" and int(quota) <= 0:
            raise ValueError()
        return {"periodUs": period, "unlimited": quota == "max", **({} if quota == "max" else {"quotaUs": int(quota)})}

    def memory(text):
        if text == "max":
            return {"unlimited": True}
        value = int(text)
        if value < 0:
            raise ValueError()
        return {"bytes": value}

    return {"status": "available", "cpuStat": read("cpu.stat", cpu_stat), "cpuMax": read("cpu.max", cpu_max),
            "memoryCurrent": read("memory.current", memory), "memoryMax": read("memory.max", memory)}


def cgroup_delta(before, after):
    left, right = before.get("cpuStat", {}), after.get("cpuStat", {})
    if left.get("status") != "available" or right.get("status") != "available":
        return {"status": "missing"}
    values = {key: value - left["values"][key] for key, value in right["values"].items() if key in left["values"]}
    if any(value < 0 for value in values.values()):
        return {"status": "counter_reset"}
    return {"status": "available", "values": values}


def complete_token_window(agent, states, questions):
    """Size the SDK's public max_len/head_max_len without discarding state.

    Choice option labels retain the SDK's 48-token header format. The Node
    selector also supplies their full descriptions and identity mapping in
    state, so this header cap cannot conceal the candidate's meaning.
    """
    tokenizer = agent.tok
    maximum = agent.model.encoder.config.max_position_embeddings
    baseline = agent.cfg.get("max_len", 512)
    baseline_head = agent.cfg.get("head_max_len", 192)
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 1
           for value in [maximum, baseline, baseline_head]) or baseline > maximum:
        raise ValueError("Loaded encoder window is unavailable")

    def tokens(text, option=False):
        kwargs = {"add_special_tokens": False}
        if option:
            kwargs.update(truncation=True, max_length=48)
        return tokenizer(text.replace(tokenizer.mask_token, " "), **kwargs)["input_ids"]

    headers = []
    for question in questions.values():
        instructions = question["instructions"]
        if not isinstance(instructions, str):
            instructions = json.dumps(instructions, ensure_ascii=False)
        option_count = 0
        for key, value in question["criteria"].items():
            if value is None or value == "":
                rendered = key
            else:
                description = value if isinstance(value, str) else json.dumps(
                    value, ensure_ascii=False, separators=(", ", ": "), default=str)
                rendered = "%s: %s" % (key, description)
            option_count += 1 + len(tokens(" " + rendered, option=True))  # [MASK]
        headers.append(len(tokens("choice question: " + instructions)) + option_count)
    state_tokens = [len(tokens(state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)))
                    for state in states]
    # [CLS], two header [SEP] tokens and the final state [SEP].
    required = [4 + max(headers) + count for count in state_tokens]
    expected = [sum(4 + header + count for header in headers) for count in state_tokens]
    longest = max(required)
    if longest > maximum:
        raise ContextWindowExceeded(longest, maximum)
    return {"formatVersion": "1.0.0", "encoderMaxTokens": maximum,
            "maxLength": max(baseline, longest), "headMaxLength": max(baseline_head, max(headers)),
            "headerTokens": [header + 3 for header in headers], "stateTokens": state_tokens,
            "requiredSequenceTokens": required, "expectedInputTokens": expected,
            "droppedTokens": 0, "truncated": False, "criterionHeaderMaxTokens": 48}


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
    inference_calls = 0

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
            if "instructions" not in question:
                raise HTTPException(400, "Choice instructions are required")
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
        stopped = threading.Event()
        expires_at = time.monotonic() + seconds
        try:
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            # One SDK call handles several independent states in one bounded forward batch.
            def predict_complete():
                nonlocal inference_calls
                before = cgroup_snapshot()
                cpu_started = time.process_time_ns()
                precheck_started = time.perf_counter_ns()
                window = complete_token_window(agent, states, questions)
                precheck_ms = (time.perf_counter_ns() - precheck_started) / 1_000_000
                precheck_cpu_ms = (time.process_time_ns() - cpu_started) / 1_000_000
                # The HTTP timeout can finish while tokenization is still running.
                # Do not start a new CPU forward after that original waiter ends.
                if stopped.is_set() or time.monotonic() >= expires_at:
                    raise InferenceControlStopped()
                inference_calls += 1
                forward_started = time.perf_counter_ns()
                forward_cpu_started = time.process_time_ns()
                results = agent.predict_batch(states, questions, batch_size=MAX_STATES,
                                              max_len=window["maxLength"], head_max_len=window["headMaxLength"])
                forward_ms = (time.perf_counter_ns() - forward_started) / 1_000_000
                forward_cpu_ms = (time.process_time_ns() - forward_cpu_started) / 1_000_000
                cpu_ms = (time.process_time_ns() - cpu_started) / 1_000_000
                after = cgroup_snapshot()
                metrics = {"formatVersion": "1.0.0", "precheckMs": precheck_ms, "forwardMs": forward_ms,
                           "forwardScope": "sdk_predict_batch", "processCpuMs": cpu_ms,
                           "precheckProcessCpuMs": precheck_cpu_ms, "forwardProcessCpuMs": forward_cpu_ms,
                           "cgroupBefore": before, "cgroupAfter": after, "cgroupCpuDelta": cgroup_delta(before, after)}
                return results, window, metrics

            future = asyncio.get_running_loop().run_in_executor(
                pool, predict_complete)
            results, window, metrics = await asyncio.wait_for(asyncio.shield(future), timeout=seconds)
            if not isinstance(results, list) or len(results) != len(states) or any(not isinstance(item, dict) for item in results):
                raise HTTPException(502, "Model result count mismatch")
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            if any(not isinstance(item.get("usage"), dict)
                   or type(item["usage"].get("input_tokens")) is not int
                   or item["usage"]["input_tokens"] != window["expectedInputTokens"][index]
                   for index, item in enumerate(results)):
                raise HTTPException(502, "Model token window mismatch")
            return [{**item, "inferenceMetrics": metrics, "tokenWindow": {**window, "stateTokens": [window["stateTokens"][index]],
                        "requiredSequenceTokens": [window["requiredSequenceTokens"][index]],
                        "expectedInputTokens": [window["expectedInputTokens"][index]],
                        "encodedTokens": item["usage"]["input_tokens"]}}
                    for index, item in enumerate(results)]
        except ContextWindowExceeded as error:
            raise HTTPException(413, {"code": "CONTEXT_WINDOW_EXCEEDED", "requiredTokens": error.required,
                                      "encoderMaxTokens": error.maximum}) from None
        except InferenceControlStopped:
            raise HTTPException(408, "Inference deadline exceeded") from None
        except asyncio.TimeoutError:
            raise HTTPException(408, "Inference deadline exceeded") from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Local inference unavailable") from None
        finally:
            stopped.set()
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
                "warmed": warmed, "inferenceBusy": gate.locked(), "inferenceCalls": inference_calls}

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
