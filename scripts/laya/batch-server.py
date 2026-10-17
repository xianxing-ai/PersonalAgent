"""Project-owned loopback adapter. Importing this file never loads model weights."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hmac
import hashlib
from importlib.metadata import version
import inspect
import json
import os
from pathlib import Path
import threading
import time
from uuid import uuid4

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


def heterogeneous_sdk(agent):
    """Use only the pinned SDK's existing encoding/decoding and one CPU forward.

    This deliberately fails closed on SDK drift instead of changing SDK methods
    or silently looping over public predict_batch calls.
    """
    methods = {"_check_question": ("qid", "qdef"), "_to_internal": ("qdef",),
               "_encode_state": ("state", "ids", "internal", "max_len", "head_max_len"),
               "_forward": ("b",), "_decode_answers": ("logits", "act", "items", "ids", "internal", "offset", "lang")}
    if version("laya") != "0.3.20" or getattr(getattr(agent, "device", None), "type", None) not in ("cpu", "cuda") \
            or getattr(agent.model, "training", None) is not False or getattr(agent, "hooks", ()) \
            or any(not callable(getattr(agent, name, None)) for name in
                   methods) or any(tuple(inspect.signature(getattr(agent, name)).parameters) != parameters
                                   for name, parameters in methods.items()):
        raise ValueError("Unsupported heterogeneous Laya adapter")
    from laya.common import collate_items
    from laya.hooks import default_hooks
    import torch
    if default_hooks():
        raise ValueError("Unsupported heterogeneous Laya hooks")
    return collate_items, torch.inference_mode


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


def create_app(agent, api_key, warmed=False, cpu_execution_policy="sequential"):
    if not isinstance(api_key, str) or not api_key or "\n" in api_key or "\r" in api_key:
        raise ValueError("An explicit local API key is required")
    if cpu_execution_policy not in ("sequential", "packed"):
        raise ValueError("Invalid trusted CPU execution policy")
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

    def validate_questions(questions):
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

    async def body(request, independent=False):
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
        if not independent:
            validate_questions(value.get("questions"))
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
        watcher = None
        stopped = threading.Event()
        expires_at = time.monotonic() + seconds
        try:
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            # One SDK call handles several independent states in one bounded forward batch.
            def predict_complete():
                nonlocal inference_calls
                import torch
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
                with torch.inference_mode():
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
                metrics = {"formatVersion": "1.0.0", "precheckMs": precheck_ms, "precheckScope": "context_window_preflight", "forwardMs": forward_ms,
                           "forwardScope": "sdk_predict_batch", "processCpuMs": cpu_ms,
                           "precheckProcessCpuMs": precheck_cpu_ms, "forwardProcessCpuMs": forward_cpu_ms,
                           "cgroupBefore": before, "cgroupAfter": after, "cgroupCpuDelta": cgroup_delta(before, after)}
                return results, window, metrics

            future = asyncio.get_running_loop().run_in_executor(
                pool, predict_complete)

            async def disconnected():
                while True:
                    if await request.is_disconnected():
                        stopped.set()
                        return
                    await asyncio.sleep(0.01)

            watcher = asyncio.create_task(disconnected())
            done, _ = await asyncio.wait([future, watcher], timeout=max(0, expires_at - time.monotonic()),
                                         return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                raise HTTPException(408, "Request disconnected")
            if future not in done or time.monotonic() >= expires_at:
                raise HTTPException(408, "Inference deadline exceeded")
            results, window, metrics = future.result()
            if not isinstance(results, list) or len(results) != len(states) or any(not isinstance(item, dict) for item in results):
                raise HTTPException(502, "Model result count mismatch")
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")
            if time.monotonic() >= expires_at:
                raise HTTPException(408, "Inference deadline exceeded")
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
            # Register CPU completion before awaiting cleanup: another cancel
            # during watcher teardown must not strand admission or late errors.
            if watcher is not None:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)

    async def infer_independent(items, request, batch_id):
        if gate.locked():
            raise HTTPException(429, "Local inference busy")
        await gate.acquire()
        future = None
        watcher = None
        stopped = threading.Event()

        def failure(item_id, status, code, **metadata):
            return {"itemId": item_id, "error": {"status": status, "code": code, **metadata}}

        try:
            if await request.is_disconnected():
                raise HTTPException(408, "Request disconnected")

            def predict_independent():
                nonlocal inference_calls
                collate_items, inference_mode = heterogeneous_sdk(agent)
                preparation_started = time.perf_counter_ns()
                preparation_cpu_started = time.process_time_ns()
                prepared, outcomes = [], {}
                for item in items:
                    item_id = item["itemId"]
                    if item["expiresAt"] <= time.monotonic():
                        outcomes[item_id] = failure(item_id, 408, "TIMEOUT")
                        continue
                    try:
                        questions = item["questions"]
                        for qid, definition in questions.items():
                            agent._check_question(qid, definition)
                        window = complete_token_window(agent, [item["state"]], questions)
                        ids = list(questions)
                        internal = {qid: agent._to_internal(questions[qid]) for qid in ids}
                        rows = agent._encode_state(item["state"], ids, internal,
                                                   max_len=window["maxLength"], head_max_len=window["headMaxLength"])
                        if len(rows) != len(ids) or sum(len(row["ids"]) for row in rows) != window["expectedInputTokens"][0] \
                                or any(len(row["ids"]) != window["stateTokens"][0] + window["headerTokens"][i] + 1
                                       for i, row in enumerate(rows)):
                            outcomes[item_id] = failure(item_id, 502, "TOKEN_WINDOW_MISMATCH")
                            continue
                        prepared.append((item, window, ids, internal, rows))
                    except ContextWindowExceeded as error:
                        outcomes[item_id] = failure(item_id, 413, "CONTEXT_WINDOW_EXCEEDED",
                                                    requiredTokens=error.required, encoderMaxTokens=error.maximum)
                    except (ValueError, TypeError, KeyError, AttributeError):
                        outcomes[item_id] = failure(item_id, 400, "INVALID_ARGUMENT")
                preparation = {"wallMs": (time.perf_counter_ns() - preparation_started) / 1_000_000,
                               "processCpuMs": (time.process_time_ns() - preparation_cpu_started) / 1_000_000}
                # The conservative CPU default never pads one item's rows to a
                # different item's length. Packed is an explicit startup policy,
                # not a request flag or an online calibration/retry.
                groups = [prepared] if cpu_execution_policy == "packed" else [[entry] for entry in prepared]
                forward_count = 0
                for group in groups:
                    if stopped.is_set():
                        raise InferenceControlStopped()
                    before = cgroup_snapshot()
                    group_cpu_started = time.process_time_ns()
                    precheck_started = time.perf_counter_ns()
                    live = []
                    for entry in group:
                        if entry[0]["expiresAt"] <= time.monotonic():
                            item_id = entry[0]["itemId"]
                            outcomes[item_id] = failure(item_id, 408, "TIMEOUT")
                        else:
                            live.append(entry)
                    # Recheck after collation, including between every
                    # sequential forward. No original deadline is renewed.
                    while live:
                        collated = collate_items([entry[4] for entry in live], agent.tok.pad_token_id)
                        expired_ids = {entry[0]["itemId"] for entry in live if entry[0]["expiresAt"] <= time.monotonic()}
                        if stopped.is_set():
                            raise InferenceControlStopped()
                        if not expired_ids:
                            break
                        for item_id in expired_ids:
                            outcomes[item_id] = failure(item_id, 408, "TIMEOUT")
                        live = [entry for entry in live if entry[0]["itemId"] not in expired_ids]
                    if not live:
                        continue
                    precheck_ms = (time.perf_counter_ns() - precheck_started) / 1_000_000
                    precheck_cpu_ms = (time.process_time_ns() - group_cpu_started) / 1_000_000
                    scope = "sdk_heterogeneous_forward" if cpu_execution_policy == "packed" else "sdk_independent_sequential_forward"
                    forward_id = str(uuid4())
                    # This context must be entered in the executor thread;
                    # inference_mode is thread-local, as is no_grad.
                    with inference_mode():
                        if stopped.is_set():
                            raise InferenceControlStopped()
                        # Context construction/entry can consume a deadline.
                        # Re-collate only surviving rows; an expired sibling
                        # must not turn a still-live item's result into timeout.
                        while live:
                            expired_ids = {entry[0]["itemId"] for entry in live if entry[0]["expiresAt"] <= time.monotonic()}
                            if not expired_ids:
                                break
                            for item_id in expired_ids:
                                outcomes[item_id] = failure(item_id, 408, "TIMEOUT")
                            live = [entry for entry in live if entry[0]["itemId"] not in expired_ids]
                            if live:
                                collated = collate_items([entry[4] for entry in live], agent.tok.pad_token_id)
                            if stopped.is_set():
                                raise InferenceControlStopped()
                        if not live:
                            continue
                        precheck_ms = (time.perf_counter_ns() - precheck_started) / 1_000_000
                        precheck_cpu_ms = (time.process_time_ns() - group_cpu_started) / 1_000_000
                        inference_calls += 1
                        forward_count += 1
                        forward = {"forwardId": forward_id, "index": forward_count, "itemCount": len(live),
                                   "scope": scope, "batchId": batch_id}
                        forward_started = time.perf_counter_ns()
                        forward_cpu_started = time.process_time_ns()
                        logits, act = agent._forward(collated)
                    expected_rows = sum(len(entry[4]) for entry in live)
                    if len(logits) != expected_rows or len(act) != expected_rows:
                        raise ValueError("Independent forward row mismatch")
                    forward_ms = (time.perf_counter_ns() - forward_started) / 1_000_000
                    forward_cpu_ms = (time.process_time_ns() - forward_cpu_started) / 1_000_000
                    after = cgroup_snapshot()
                    metrics = {"formatVersion": "1.0.0", "precheckMs": precheck_ms,
                               "precheckScope": "forward_group_collation", "forwardMs": forward_ms, "forwardScope": scope,
                               "processCpuMs": (time.process_time_ns() - group_cpu_started) / 1_000_000,
                               "precheckProcessCpuMs": precheck_cpu_ms, "forwardProcessCpuMs": forward_cpu_ms,
                               "cgroupBefore": before, "cgroupAfter": after, "cgroupCpuDelta": cgroup_delta(before, after)}
                    offset = 0
                    for item, window, ids, internal, encoded in live:
                        item_id = item["itemId"]
                        if item["expiresAt"] <= time.monotonic():
                            outcomes[item_id] = failure(item_id, 408, "TIMEOUT")
                        else:
                            count = sum(len(row["ids"]) for row in encoded)
                            if int(collated["attention_mask"][offset:offset + len(encoded)].sum()) != count:
                                outcomes[item_id] = failure(item_id, 502, "TOKEN_WINDOW_MISMATCH")
                            else:
                                try:
                                    answers = agent._decode_answers(logits, act, encoded, ids, internal, offset)
                                    result = {"answers": answers, "usage": {"input_tokens": count, "output_tokens": 0},
                                              "inferenceMetrics": metrics, "tokenWindow": {**window, "encodedTokens": count},
                                              "forward": forward}
                                    if cpu_execution_policy == "packed":
                                        result["sharedForward"] = {"batchId": batch_id, "batchSize": len(live)}
                                    outcomes[item_id] = {"itemId": item_id, "result": result}
                                except (ValueError, TypeError, KeyError, IndexError, AttributeError):
                                    outcomes[item_id] = failure(item_id, 502, "INVALID_MODEL_RESULT")
                        offset += len(encoded)
                return [outcomes[item["itemId"]] for item in items], forward_count, preparation

            future = asyncio.get_running_loop().run_in_executor(pool, predict_independent)

            async def disconnected():
                while True:
                    if await request.is_disconnected():
                        return
                    await asyncio.sleep(0.01)

            watcher = asyncio.create_task(disconnected())
            seconds = max(item["expiresAt"] for item in items) - time.monotonic()
            done, _ = await asyncio.wait([future, watcher], timeout=max(0, seconds), return_when=asyncio.FIRST_COMPLETED)
            if watcher in done or future not in done:
                raise HTTPException(408, "Inference deadline exceeded")
            return future.result()
        except InferenceControlStopped:
            raise HTTPException(408, "Inference deadline exceeded") from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Local inference unavailable") from None
        finally:
            stopped.set()
            if watcher is not None:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)

            def release_completed(completed):
                try:
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
        accelerator = {}
        if getattr(getattr(agent, 'device', None), 'type', None) == 'cuda':
            import torch
            accelerator = {'allocatorAllocatedBytes': torch.cuda.memory_allocated(),
                           'allocatorReservedBytes': torch.cuda.memory_reserved(),
                           'allocatorPeakAllocatedBytes': torch.cuda.max_memory_allocated(),
                           'scope': 'Torch allocator only; driver/context memory excluded'}
        return {"status": "ok", "model": "multilingual", "capabilities": ["multi_state", "independent_items"], "maxStates": MAX_STATES,
                "executionPolicy": cpu_execution_policy, "inferenceMode": "inference_mode",
                "device": getattr(getattr(agent, 'device', None), 'type', 'unknown'),
                "precision": {"autocastEnabled": bool(getattr(agent, 'amp_enabled', False)),
                              "autocastDtype": str(getattr(agent, 'dtype', 'unknown'))},
                "processId": os.getpid(),
                "accelerator": accelerator,
                "warmed": warmed, "inferenceBusy": gate.locked(), "inferenceCalls": inference_calls}

    @app.post("/v1/systemone/independent-batch")
    async def independent(request: Request):
        value = await body(request, independent=True)
        items = value.get("items")
        batch_id = value.get("batchId")
        if not isinstance(batch_id, str) or not 1 <= len(batch_id) <= 128 \
                or not isinstance(items, list) or not 1 <= len(items) <= MAX_STATES:
            raise HTTPException(400, "Invalid independent batch")
        ids, valid, errors = set(), [], {}
        for item in items:
            if not isinstance(item, dict) or set(item) != {"itemId", "state", "questions", "deadline"} \
                    or not isinstance(item.get("itemId"), str) or not 1 <= len(item["itemId"]) <= 128 \
                    or item["itemId"] in ids:
                raise HTTPException(400, "Invalid independent item identity")
            ids.add(item["itemId"])
            try:
                validate_questions(item["questions"])
                if not isinstance(item["deadline"], str):
                    raise HTTPException(400, "An explicit independent deadline is required")
                if len(json.dumps(item["state"], ensure_ascii=False)) > 50000:
                    raise HTTPException(413, "State too large")
                valid.append({**item, "expiresAt": time.monotonic() + remaining(item)})
            except HTTPException as error:
                errors[item["itemId"]] = {"itemId": item["itemId"], "error": {"status": error.status_code,
                    "code": "TIMEOUT" if error.status_code == 408 else "INVALID_ARGUMENT"}}
        results, forward_count, preparation = await infer_independent(valid, request, batch_id) if valid else ([], 0, {"wallMs": 0, "processCpuMs": 0})
        results = {entry["itemId"]: entry for entry in results}
        results.update(errors)
        return {"batching": "independent_items", "batchId": batch_id,
                "execution": {"policy": cpu_execution_policy, "forwardCount": forward_count},
                "preparationMetrics": preparation,
                "items": [results[item["itemId"]] for item in items]}

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
    cpu_execution_policy = os.environ.get("LAYA_CPU_EXECUTION_POLICY", "sequential")
    if cpu_execution_policy not in ("sequential", "packed"):
        raise SystemExit("Invalid trusted CPU execution policy")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from laya.agent import Agent
    import uvicorn
    torch_threads = int(os.environ.get('LAYA_TORCH_THREADS', '2'))
    if not 1 <= torch_threads <= (os.cpu_count() or 1):
        raise SystemExit('Invalid local Torch thread count')
    torch.set_num_threads(torch_threads)
    torch.set_num_interop_threads(1)
    device = os.environ.get('LAYA_DEVICE', 'cpu')
    if device not in ('cpu', 'cuda') or device == 'cuda' and not torch.cuda.is_available():
        raise SystemExit('Requested local accelerator unavailable')
    if device == 'cuda':
        torch.backends.cuda.matmul.allow_tf32 = False
    agent = Agent(str(location), device=device)
    # Bind only after weights/tokenizer loading and one real, public synthetic forward.
    # Readiness is not a quality score or a promise that a business task succeeded.
    warm = agent.predict_batch([{"context": "Synthetic startup readiness check"}], {
        "ready": {"type": "choice", "instructions": "Choose the applicable readiness label.",
                  "criteria": {"ready": "The synthetic test is ready", "review": "The synthetic test needs review"}}},
        batch_size=1)
    if not isinstance(warm, list) or len(warm) != 1 or not isinstance(warm[0], dict) or "answers" not in warm[0]:
        raise SystemExit("Laya warmup did not return a typed choice")
    uvicorn.run(create_app(agent, key, warmed=True, cpu_execution_policy=cpu_execution_policy), host="127.0.0.1", port=port, access_log=False,
                log_level="critical")


if __name__ == "__main__":
    main()
