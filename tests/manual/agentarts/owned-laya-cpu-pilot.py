"""Opt-in, offline, single-instance CPU diagnostic; importing never loads weights.

Direct SDK timings are NOT HTTP timings. Only fixed public synthetic inputs are
used. No module hooks, model mutation, download, tool, MaaS or production API.
The caller must arrange available memory and serialize this with other models.
"""
import argparse
from contextlib import nullcontext
import copy
import ctypes
from datetime import datetime, timezone
import hashlib
import importlib.util
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[3]
SHORT_TOKENS = [274, 320, 275, 347]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def resources():
    """No added dependency; page faults include soft faults, not swap proof."""
    value = {"processCpuMs": time.process_time_ns() / 1e6}
    if sys.platform == "win32":
        from ctypes import wintypes
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
                (name, ctypes.c_ulonglong) for name in
                ("totalPhys", "availPhys", "totalPageFile", "availPageFile", "totalVirtual", "availVirtual", "availExtendedVirtual")]
        class ProcessMemory(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
        status = MemoryStatus(); status.length = ctypes.sizeof(status)
        memory = ProcessMemory(); memory.cb = ctypes.sizeof(memory)
        if kernel.GlobalMemoryStatusEx(ctypes.byref(status)):
            value.update(availablePhysicalBytes=status.availPhys, physicalMemoryLoadPercent=status.load,
                         availableCommitBytes=status.availPageFile)
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(memory), memory.cb):
            value.update(rssBytes=memory.WorkingSetSize, peakRssBytes=memory.PeakWorkingSetSize,
                         privateBytes=memory.PrivateUsage, pageFaultCount=memory.PageFaultCount)
        class ThreadEntry(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("threadId", wintypes.DWORD),
                        ("ownerPid", wintypes.DWORD), ("basePriority", wintypes.LONG),
                        ("deltaPriority", wintypes.LONG), ("flags", wintypes.DWORD)]
        kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel.Thread32First.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        kernel.Thread32Next.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateToolhelp32Snapshot(4, 0)
        if handle != ctypes.c_void_p(-1).value:
            try:
                entry = ThreadEntry(); entry.dwSize = ctypes.sizeof(entry)
                ok = kernel.Thread32First(handle, ctypes.byref(entry)); count = 0
                while ok:
                    count += entry.ownerPid == os.getpid()
                    ok = kernel.Thread32Next(handle, ctypes.byref(entry))
                value["osThreadCount"] = count
            finally:
                kernel.CloseHandle(handle)
    elif Path("/proc/self/status").exists():
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        for field, output in (("VmRSS", "rssBytes"), ("VmHWM", "peakRssBytes"), ("VmSwap", "swapBytes")):
            if field in status:
                value[output] = int(status[field].split()[0]) * 1024
        if "Threads" in status:
            value["osThreadCount"] = int(status["Threads"])
    return value


def timed(call):
    wall, cpu = time.perf_counter_ns(), time.process_time_ns()
    result = call()
    return result, {"wallMs": (time.perf_counter_ns() - wall) / 1e6,
                    "processCpuMs": (time.process_time_ns() - cpu) / 1e6}


def check_deadline(deadline):
    if deadline.tzinfo is None or deadline.utcoffset() is None:
        raise ValueError("TIMEZONE_REQUIRED")
    if datetime.now(timezone.utc) >= deadline:
        raise ValueError("PILOT_DEADLINE_EXPIRED")


def parse_deadline(value):
    try:
        deadline = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        raise ValueError("INVALID_DEADLINE") from None
    check_deadline(deadline)
    return deadline


def public_payloads(node_bin, deadline):
    """Reuse current probes AND current selector formatting, with a fake request."""
    code = r"""
import fs from 'node:fs'; import vm from 'node:vm'; import {pathToFileURL} from 'node:url';
const root=process.argv[1],deadline=process.argv[2];
const source=fs.readFileSync(root+'/tests/manual/agentarts/owned-laya-batching.mjs','utf8');
const match=source.match(/const probes=(\[[\s\S]*?\n\]);/);if(!match)throw Error('PUBLIC_PROBES_UNAVAILABLE');
const probes=vm.runInNewContext('('+match[1]+')',Object.create(null),{timeout:1000});
const {createOwnedLayaSelector}=await import(pathToFileURL(root+'/apps/agentarts-runtime/src/laya-selector.mjs'));
const output=[];
for(const probe of probes){let payload;const selector=createOwnedLayaSelector({port:18080,getApiKey:()=> 'synthetic-not-a-credential',
request:async(_url,options)=>{payload=JSON.parse(options.body);throw Error('FAKE_CAPTURE_ONLY');}});
try{await selector.select({...probe,deadline,signal:new AbortController().signal});}catch{}
if(!payload)throw Error('PUBLIC_PAYLOAD_NOT_CAPTURED');output.push({id:probe.id,payload});}
process.stdout.write(JSON.stringify(output));
"""
    result = subprocess.run([str(node_bin), "--input-type=module", "-e", code, str(ROOT), deadline],
                            capture_output=True, check=False, text=True, encoding="utf-8")
    if result.returncode:
        raise ValueError("PUBLIC_PAYLOAD_CAPTURE_FAILED")  # Do not echo process/environment details.
    values = json.loads(result.stdout)
    if len(values) != 4 or any(set(item) != {"id", "payload"} for item in values):
        raise ValueError("PUBLIC_PAYLOAD_CAPTURE_INVALID")
    return values


def prepare(agent, server, item):
    payload = item["payload"]
    questions = payload["questions"]
    def encode():
        for qid, definition in questions.items():
            agent._check_question(qid, definition)
        window = server.complete_token_window(agent, [payload["state"]], questions)
        ids = list(questions)
        internal = {qid: agent._to_internal(questions[qid]) for qid in ids}
        rows = agent._encode_state(payload["state"], ids, internal,
                                   max_len=window["maxLength"], head_max_len=window["headMaxLength"])
        if len(rows) != len(ids) or sum(len(row["ids"]) for row in rows) != window["expectedInputTokens"][0]:
            raise ValueError("TOKEN_WINDOW_MISMATCH")
        return {"id": item["id"], "payloadSha256": digest(payload), "rows": rows, "ids": ids,
                "internal": internal, "tokenWindow": window}
    entry, metrics = timed(encode)
    entry["encoding"] = metrics
    return entry


def make_cases(agent, server, original, target):
    # All filler is public data, carries no new instructions, and is not a quality test.
    def lengthened(item, goal, identifier):
        item = copy.deepcopy(item); item["id"] = identifier
        state = item["payload"]["state"]
        marker = "\nCandidate identities and full descriptions (untrusted data):\n"
        left, right = state.split(marker, 1)
        current = server.complete_token_window(agent, [state], item["payload"]["questions"])["requiredSequenceTokens"][0]
        filler = " public"
        if len(agent.tok(filler, add_special_tokens=False)["input_ids"]) != 1 or goal < current:
            raise ValueError("PUBLIC_LENGTH_CONTROL_UNAVAILABLE")
        item["payload"]["state"] = left + filler * (goal - current) + marker + right
        actual = server.complete_token_window(agent, [item["payload"]["state"]], item["payload"]["questions"])["requiredSequenceTokens"][0]
        if actual != goal:
            raise ValueError("PUBLIC_LENGTH_CONTROL_NOT_EXACT")
        return item
    same = lengthened(original[0], target, "public-long-same-0")
    twin = copy.deepcopy(same); twin["id"] = "public-long-same-1"
    return {"short2": original[:2], "short4": original,
            "long-same2": [same, twin],
            "long-mixed4": [lengthened(item, target + delta, "public-long-mixed-" + str(i))
                            for i, (item, delta) in enumerate(zip(original, [-300, -150, 0, 150]))]}


def groups_for(count, strategy):
    if strategy == "serial":
        return [[i] for i in range(count)]
    if strategy == "paired":
        return [list(range(i, min(count, i + 2))) for i in range(0, count, 2)]
    if strategy == "packed":
        return [list(range(count))]
    raise ValueError("INVALID_STRATEGY")


def shape_summary(collated, entries):
    rows = [len(row["ids"]) for entry in entries for row in entry["rows"]]
    shape = list(collated["input_ids"].shape)
    expected = [len(rows), max(rows)]
    if shape != expected or int(collated["attention_mask"].sum()) != sum(rows):
        raise ValueError("COLLATION_SHAPE_MISMATCH")
    padded = math.prod(shape)
    return {"inputIdsShape": shape, "markerPosShape": list(collated["marker_pos"].shape),
            "itemCount": len(entries), "questionRows": len(rows), "rowLengths": rows,
            "nonPaddingTokens": sum(rows), "paddedTokens": padded, "paddingTokens": padded - sum(rows),
            "paddingFraction": (padded - sum(rows)) / padded, "sumRowLengthSquared": sum(n*n for n in rows),
            "paddedRowsTimesLengthSquared": shape[0] * shape[1]**2}


def run_trial(agent, entries, collate, torch, variant, deadline, encode_again=None):
    """Cached mode excludes tokenization; optional direct mode actually re-encodes."""
    before = resources(); started = time.perf_counter_ns(); cpu_started = time.process_time_ns()
    stages = {name: {"wallMs": 0.0, "processCpuMs": 0.0} for name in ("encode", "collate", "forward", "decode")}
    if encode_again is not None:
        entries, stages["encode"] = timed(encode_again)
    outputs, forwards = {}, []
    for indexes in groups_for(len(entries), variant["strategy"]):
        check_deadline(deadline)
        selected = [entries[index] for index in indexes]
        collated, collate_time = timed(lambda: collate([entry["rows"] for entry in selected], agent.tok.pad_token_id))
        shape = shape_summary(collated, selected)
        context = torch.inference_mode if variant["gradMode"] == "inference_mode" else torch.no_grad
        def forward():
            with context():
                # Collation and context entry can consume the original cutoff.
                # Never grant a fresh duration or begin an already-expired forward.
                check_deadline(deadline)
                return agent._forward(collated)
        (logits, act), forward_time = timed(forward)
        if len(logits) != shape["questionRows"] or len(act) != shape["questionRows"]:
            raise ValueError("FORWARD_ROW_COUNT_MISMATCH")
        def decode():
            offset = 0
            for index, entry in zip(indexes, selected):
                answers = agent._decode_answers(logits, act, entry["rows"], entry["ids"], entry["internal"], offset)
                for qid in entry["ids"]:
                    answer = answers[qid]
                    values = answer["probabilities"]
                    if set(values) != set(entry["internal"][qid]["crit"]) or any(
                            not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p <= 1 for p in values.values()) \
                            or abs(sum(values.values()) - 1) > 0.005 or answer["choice"] not in values:
                        raise ValueError("INVALID_CHOICE_DISTRIBUTION")
                outputs[index] = {"id": entry["id"], "payloadSha256": entry["payloadSha256"], "answers": answers,
                                  "completedMs": (time.perf_counter_ns() - started) / 1e6}
                offset += len(entry["rows"])
        _, decode_time = timed(decode)
        forwards.append({"index": len(forwards) + 1, "shape": shape,
                         "collate": collate_time, "forward": forward_time, "decode": decode_time})
        for name, value in (("collate", collate_time), ("forward", forward_time), ("decode", decode_time)):
            for unit in value:
                stages[name][unit] += value[unit]
        del logits, act, collated
    wall, cpu = (time.perf_counter_ns() - started) / 1e6, (time.process_time_ns() - cpu_started) / 1e6
    items = [outputs[index] for index in range(len(entries))]
    return {"variant": variant, "scope": "direct_end_to_end" if encode_again else "cached_encoding_pipeline",
            "wallMs": wall, "processCpuMs": cpu, "resourcesBefore": before, "resourcesAfter": resources(),
            "stageTimings": stages, "instrumentationAndOtherWallMs": wall - sum(v["wallMs"] for v in stages.values()),
            "firstItemCompleteMs": min(item["completedMs"] for item in items),
            "lastItemCompleteMs": max(item["completedMs"] for item in items),
            "actualForwardCount": len(forwards), "forwards": forwards, "items": items}


def summarize(rounds):
    grouped = {}
    for row in rounds:
        grouped.setdefault((row["case"], row["comparison"], row["scope"]), {}).setdefault(row["pair"], []).append(row)
    results = []
    for (case, comparison, scope), pairs in grouped.items():
        samples = []
        for pair, rows in sorted(pairs.items()):
            by_label = {row["arm"]: row for row in rows}
            if set(by_label) != {"A", "B"}:
                raise ValueError("INCOMPLETE_PAIRED_RESULT")
            left, right = by_label["A"], by_label["B"]
            if [item["payloadSha256"] for item in left["items"]] != [item["payloadSha256"] for item in right["items"]]:
                raise ValueError("PAIRED_PAYLOAD_MISMATCH")
            deltas = []
            for a, b in zip(left["items"], right["items"]):
                probs = [abs(value - b["answers"][qid]["probabilities"][key])
                         for qid, answer in a["answers"].items() for key, value in answer["probabilities"].items()]
                deltas.append({"id": a["id"], "choicesEqual": all(a["answers"][qid]["choice"] == b["answers"][qid]["choice"]
                               for qid in a["answers"]), "maxReportedProbabilityDelta": max(probs)})
            samples.append({"pair": pair, "order": [row["arm"] for row in rows],
                            "aWallMs": left["wallMs"], "bWallMs": right["wallMs"],
                            "bMinusAPercent": 100 * (right["wallMs"] / left["wallMs"] - 1), "items": deltas})
        results.append({"case": case, "comparison": comparison, "scope": scope, "pairedSamples": samples,
                        "medianBMinusAPercent": statistics.median(row["bMinusAPercent"] for row in samples),
                        "interpretation": "Diagnostic paired observations; not accuracy, SLA, p95 or rollout approval"})
    return results


def load_server():
    spec = importlib.util.spec_from_file_location("owned_laya_batch_server_diagnostic", ROOT / "scripts/laya/batch-server.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def run_pilot(agent, server, torch, payloads, args):
    deadline = parse_deadline(args.deadline)
    if version("laya") != "0.3.20" or agent.device.type != "cpu" or agent.model.training or agent.hooks:
        raise ValueError("UNSUPPORTED_AGENT")
    if torch.get_num_threads() != 2 or any(parameter.is_floating_point() and parameter.dtype != torch.float32
                                           for parameter in agent.model.parameters()):
        raise ValueError("EXPECTED_FP32_TWO_THREADS")
    # Hooks alter TransformerEncoderLayer fastpath and would invalidate the comparison.
    if any(module._forward_hooks or module._forward_pre_hooks for module in agent.model.modules()):
        raise ValueError("MODULE_HOOKS_NOT_ALLOWED")
    collate, _ = server.heterogeneous_sdk(agent)
    available = make_cases(agent, server, payloads, args.long_target_tokens)
    original_prepared = [prepare(agent, server, item) for item in payloads]
    if [entry["tokenWindow"]["expectedInputTokens"][0] for entry in original_prepared] != SHORT_TOKENS:
        raise ValueError("ORIGINAL_PUBLIC_TOKEN_LENGTH_CHANGED")
    baseline = {"strategy": args.strategy, "mhaFastpath": True, "gradMode": "no_grad"}
    comparisons = {
        "strategy": ({**baseline, "strategy": "packed"}, {**baseline, "strategy": "serial"}),
        "paired": ({**baseline, "strategy": "packed"}, {**baseline, "strategy": "paired"}),
        "fastpath": ({**baseline, "mhaFastpath": True}, {**baseline, "mhaFastpath": False}),
        "inference": ({**baseline, "mhaFastpath": args.inference_fastpath == "on"},
                      {**baseline, "mhaFastpath": args.inference_fastpath == "on", "gradMode": "inference_mode"})}
    report = {"schemaVersion": 1, "kind": "public_owned_laya_cpu_pilot", "startedAt": datetime.now(timezone.utc).isoformat(),
              "platform": platform.system(), "architecture": platform.machine(), "pythonVersion": platform.python_version(),
              "torchVersion": torch.__version__, "sdkVersion": version("laya"), "intraOpThreads": torch.get_num_threads(),
              "interOpThreads": torch.get_num_interop_threads(), "dtype": "float32", "modelInstances": 1,
              "maasCalls": 0, "toolExecutions": 0, "offMachineRequests": 0, "httpTimings": {"status": "not_measured_direct_sdk_only"},
              "resourcesBefore": resources(), "cases": [], "rounds": [], "excludedWarmupForwardCount": 0,
              "semanticCorrectnessVerified": False, "modelRevision": None,
              "sdkSourceSha256": file_digest(Path(sys.modules[type(agent).__module__].__file__)),
              "sourceHashes": {name: file_digest(ROOT / path) for name, path in {
                  "manual": "tests/manual/agentarts/owned-laya-batching.mjs", "selector": "apps/agentarts-runtime/src/laya-selector.mjs",
                  "server": "scripts/laya/batch-server.py", "pilot": "tests/manual/agentarts/owned-laya-cpu-pilot.py"}.items()}}
    old_mha = torch.backends.mha.get_fastpath_enabled()
    try:
        for name in args.cases.split(","):
            if name not in available:
                raise ValueError("UNKNOWN_CASE")
            public = available[name]
            entries = [prepare(agent, server, item) for item in public]
            report["cases"].append({"name": name, "inputs": [{"id": item["id"], "payload": item["payload"],
                "payloadSha256": digest(item["payload"])} for item in public], "encodingOnce": [
                    {"id": entry["id"], "tokens": entry["tokenWindow"]["expectedInputTokens"][0],
                     "rows": [len(row["ids"]) for row in entry["rows"]], "timing": entry["encoding"]} for entry in entries]})
            for comparison in args.comparisons.split(","):
                if comparison not in comparisons:
                    raise ValueError("UNKNOWN_COMPARISON")
                arms = dict(zip(("A", "B"), comparisons[comparison]))
                for variant in arms.values():
                    torch.backends.mha.set_fastpath_enabled(variant["mhaFastpath"])
                    for _ in range(args.warmup_rounds):
                        warm = run_trial(agent, entries, collate, torch, variant, deadline)
                        report["excludedWarmupForwardCount"] += warm["actualForwardCount"]
                for scope in args.scopes.split(","):
                    if scope not in ("cached", "direct-e2e"):
                        raise ValueError("UNKNOWN_SCOPE")
                    for pair in range(args.repetitions):
                        for arm in (("A", "B") if pair % 2 == 0 else ("B", "A")):
                            variant = arms[arm]
                            torch.backends.mha.set_fastpath_enabled(variant["mhaFastpath"])
                            trial = run_trial(agent, entries, collate, torch, variant, deadline,
                                              encode_again=(lambda: [prepare(agent, server, item) for item in public])
                                              if scope == "direct-e2e" else None)
                            report["rounds"].append({"case": name, "comparison": comparison, "pair": pair,
                                                     "arm": arm, **trial})
    finally:
        torch.backends.mha.set_fastpath_enabled(old_mha)
    report.update(status="completed_diagnostic", finishedAt=datetime.now(timezone.utc).isoformat(),
                  resourcesAfter=resources(), measuredForwardCount=sum(row["actualForwardCount"] for row in report["rounds"]),
                  summary=summarize(report["rounds"]),
                  limitations=["One native Windows CPU instance is not Huawei ARM64 or a two-vCPU quota measurement.",
                    "Cached-encoding pipeline excludes tokenization; direct_end_to_end includes actual re-encoding, never HTTP.",
                    "SDK _forward includes model execution, output conversion and action softmax; it is not a pure NN kernel timing.",
                    "No module hooks or timed profiler. A backend flag is requested, not independent operator-trace proof.",
                    "Reported probability precision follows the SDK decoder; matching choices does not establish semantic correctness.",
                    "Working set and page-fault snapshots cannot prove absence of paging; caller must check memory pressure and concurrent work.",
                    "Repeated small paired observations are diagnostic, not p95/SLA, platform performance or automatic rollout approval."])
    return report


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-path", required=True)
    p.add_argument("--node-bin", required=True)
    p.add_argument("--deadline", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--cases", default="short2,short4,long-same2,long-mixed4")
    p.add_argument("--comparisons", default="strategy", help="strategy,paired,fastpath,inference; choose one variable at a time")
    p.add_argument("--strategy", choices=("serial", "paired", "packed"), default="serial", help="Grouping held fixed for fastpath/inference")
    p.add_argument("--inference-fastpath", choices=("on", "off"), default="on", help="Select explicitly from prior evidence; no automatic winner")
    p.add_argument("--scopes", default="cached", help="cached,direct-e2e")
    p.add_argument("--repetitions", type=int, default=3)
    p.add_argument("--warmup-rounds", type=int, default=1)
    p.add_argument("--long-target-tokens", type=int, default=1000)
    return p


def main():
    args = parser().parse_args()
    try:
        deadline = parse_deadline(args.deadline)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    if args.repetitions < 1 or args.warmup_rounds < 0 or args.long_target_tokens < 650:
        raise SystemExit("Invalid explicit diagnostic arguments")
    for value, allowed in ((args.cases, {"short2", "short4", "long-same2", "long-mixed4"}),
                           (args.comparisons, {"strategy", "paired", "fastpath", "inference"}),
                           (args.scopes, {"cached", "direct-e2e"})):
        if not set(value.split(",")) <= allowed:
            raise SystemExit("Unknown case, comparison or timing scope")
    location = Path(args.model_path)
    if not location.is_absolute() or not (location / "asset-manifest.json").is_file():
        raise SystemExit("Existing absolute offline asset-manifest directory required")
    os.environ["HF_HUB_OFFLINE"] = "1"; os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"; os.environ["DO_NOT_TRACK"] = "1"
    # Socket guard applies to this direct diagnostic, including accidental library network access.
    import socket
    def no_network(*_args, **_kwargs):
        raise RuntimeError("DIAGNOSTIC_NETWORK_FORBIDDEN")
    socket.socket.connect = no_network; socket.socket.connect_ex = no_network; socket.create_connection = no_network
    payloads = public_payloads(args.node_bin, args.deadline)
    server = load_server(); server.verify_model_assets(location)
    before_load = resources()
    check_deadline(deadline)
    import torch
    from laya.agent import Agent
    if version("laya") != "0.3.20":
        raise SystemExit("Pinned SDK 0.3.20 required")
    torch.set_num_threads(2)
    check_deadline(deadline)
    agent = Agent(str(location), device="cpu")
    report = run_pilot(agent, server, torch, payloads, args)
    manifest = json.loads((location / "asset-manifest.json").read_text(encoding="utf-8"))
    report["modelRevision"] = manifest.get("revision", manifest.get("sourceRevision"))
    report["assetManifestSha256"] = file_digest(location / "asset-manifest.json")
    report["resourcesBeforeModelLoad"] = before_load
    report["payloadHashScope"] = "Exact model/state/questions/original deadline JSON; grouping and backend flags do not change it"
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "measuredForwardCount": report["measuredForwardCount"],
                      "outputSha256": file_digest(destination)}, separators=(",", ":")))


if __name__ == "__main__":
    main()
