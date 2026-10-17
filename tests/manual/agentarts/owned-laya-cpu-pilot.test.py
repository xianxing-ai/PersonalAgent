"""Weight-free stdlib checks for diagnostic accounting; not a CPU benchmark."""
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("owned_cpu_pilot", Path(__file__).with_name("owned-laya-cpu-pilot.py"))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class Tensor:
    def __init__(self, shape, total):
        self.shape, self.total = shape, total
    def sum(self):
        return self.total


def collate(groups, _pad):
    rows = [row for group in groups for row in group]
    lengths = [len(row["ids"]) for row in rows]
    return {"input_ids": Tensor((len(rows), max(lengths)), sum(lengths)),
            "attention_mask": Tensor((len(rows), max(lengths)), sum(lengths)),
            "marker_pos": Tensor((len(rows), 2), 0), "test_rows": rows}


class Agent:
    def __init__(self):
        self.tok = type("Tokenizer", (), {"pad_token_id": 0})()
        self.calls = 0
    def _forward(self, batch):
        self.calls += 1
        return [[row["ids"][0]] for row in batch["test_rows"]], [[1, 0] for _ in batch["test_rows"]]
    def _decode_answers(self, logits, _act, _rows, ids, _internal, offset):
        return {qid: {"choice": "a" if logits[offset][0] % 2 == 0 else "b",
                      "probabilities": {"a": 0.8 if logits[offset][0] % 2 == 0 else 0.2,
                                        "b": 0.2 if logits[offset][0] % 2 == 0 else 0.8}}
                for qid in ids}


class Torch:
    no_grad = staticmethod(nullcontext)
    inference_mode = staticmethod(nullcontext)


def entries():
    return [{"id": "public-" + str(i), "payloadSha256": str(i) * 64,
             "rows": [{"ids": [i] * length, "markers": [1, 2]}], "ids": ["decision"],
             "internal": {"decision": {"crit": {"a": "public observation A", "b": "public observation B"}}}}
            for i, length in enumerate((5, 9, 6, 12))]


class Accounting(unittest.TestCase):
    def run_case(self, strategy, encode=None):
        agent = Agent()
        report = pilot.run_trial(agent, entries(), collate, Torch,
                                 {"strategy": strategy, "gradMode": "no_grad", "mhaFastpath": True},
                                 datetime.now(timezone.utc) + timedelta(minutes=1), encode_again=encode)
        self.assertEqual(report["actualForwardCount"], agent.calls)
        return report

    def test_same_public_items_preserve_mapping_for_serial_and_real_grouping(self):
        serial, packed = self.run_case("serial"), self.run_case("packed")
        self.assertEqual(serial["actualForwardCount"], 4)
        self.assertEqual(packed["actualForwardCount"], 1)
        self.assertEqual([item["answers"] for item in serial["items"]], [item["answers"] for item in packed["items"]])
        self.assertEqual(packed["forwards"][0]["shape"]["inputIdsShape"], [4, 12])
        self.assertEqual(packed["forwards"][0]["shape"]["paddingTokens"], 16)
        self.assertEqual(packed["forwards"][0]["shape"]["sumRowLengthSquared"], 286)
        self.assertEqual(packed["stageTimings"]["encode"]["wallMs"], 0)
        for value in (serial, packed):
            self.assertLessEqual(value["firstItemCompleteMs"], value["lastItemCompleteMs"])
            self.assertEqual(value["scope"], "cached_encoding_pipeline")

    def test_pair_grouping_counts_two_actual_forwards_not_one_http_batch(self):
        paired = self.run_case("paired")
        self.assertEqual(paired["actualForwardCount"], 2)
        self.assertEqual([row["shape"]["inputIdsShape"] for row in paired["forwards"]], [[2, 9], [2, 12]])

    def test_direct_scope_only_when_reencoding_actually_runs(self):
        calls = []
        direct = self.run_case("packed", lambda: calls.append("encode") or entries())
        self.assertEqual(calls, ["encode"])
        self.assertEqual(direct["scope"], "direct_end_to_end")

    def test_pair_summary_retains_choice_difference_and_rejects_payload_change(self):
        a, b = self.run_case("serial"), self.run_case("packed")
        b["items"][0]["answers"]["decision"]["choice"] = "b"
        rounds = [{"case": "public", "comparison": "strategy", "pair": 0, "arm": label, **row}
                  for label, row in (("A", a), ("B", b))]
        self.assertFalse(pilot.summarize(rounds)[0]["pairedSamples"][0]["items"][0]["choicesEqual"])
        rounds[1]["items"][0]["payloadSha256"] = "changed"
        with self.assertRaisesRegex(ValueError, "PAIRED_PAYLOAD_MISMATCH"):
            pilot.summarize(rounds)

    def test_bad_collate_shape_rejected_before_forward(self):
        agent = Agent()
        def bad(groups, pad):
            result = collate(groups, pad)
            result["input_ids"].shape = (1, 1)
            return result
        with self.assertRaisesRegex(ValueError, "COLLATION_SHAPE_MISMATCH"):
            pilot.run_trial(agent, entries(), bad, Torch, {"strategy": "packed", "gradMode": "no_grad"},
                            datetime.now(timezone.utc) + timedelta(minutes=1))
        self.assertEqual(agent.calls, 0)

    def test_original_deadline_expiring_in_collate_cannot_start_forward(self):
        start = datetime.now(timezone.utc)
        class Clock:
            current = start
            @classmethod
            def now(cls, _timezone):
                return cls.current
        def expire_collate(groups, pad):
            result = collate(groups, pad)
            Clock.current = start + timedelta(seconds=2)
            return result
        agent = Agent()
        with patch.object(pilot, "datetime", Clock), self.assertRaisesRegex(ValueError, "PILOT_DEADLINE_EXPIRED"):
            pilot.run_trial(agent, entries(), expire_collate, Torch,
                            {"strategy": "packed", "gradMode": "no_grad"}, start + timedelta(seconds=1))
        self.assertEqual(agent.calls, 0)

    def test_original_deadline_expiring_in_context_entry_cannot_start_forward(self):
        start = datetime.now(timezone.utc)
        class Clock:
            current = start
            @classmethod
            def now(cls, _timezone):
                return cls.current
        class Context:
            def __enter__(self):
                Clock.current = start + timedelta(seconds=2)
            def __exit__(self, *_args):
                return False
        torch = type("ExpiringTorch", (), {"inference_mode": staticmethod(Context)})
        agent = Agent()
        with patch.object(pilot, "datetime", Clock), self.assertRaisesRegex(ValueError, "PILOT_DEADLINE_EXPIRED"):
            pilot.run_trial(agent, entries(), collate, torch,
                            {"strategy": "packed", "gradMode": "inference_mode"}, start + timedelta(seconds=1))
        self.assertEqual(agent.calls, 0)

    def test_cli_invalid_cutoff_rejected_before_importing_or_loading_torch(self):
        import builtins
        original = builtins.__import__
        heavy_imports = []
        def guard(name, *args, **kwargs):
            if name in ("torch", "laya.agent"):
                heavy_imports.append(name)
                raise AssertionError("Heavy import must not occur")
            return original(name, *args, **kwargs)
        for value, code in (((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "PILOT_DEADLINE_EXPIRED"),
                            ((datetime.now() + timedelta(days=1)).isoformat(), "TIMEZONE_REQUIRED")):
            with self.subTest(code=code), patch.object(pilot.sys, "argv", ["pilot", "--model-path", "unused",
                    "--node-bin", "unused", "--output", "unused", "--deadline", value]), \
                    patch("builtins.__import__", guard), self.assertRaisesRegex(SystemExit, code):
                pilot.main()
        self.assertEqual(heavy_imports, [])


if __name__ == "__main__":
    unittest.main()
