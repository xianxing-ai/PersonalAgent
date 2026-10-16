"""Public synthetic raw-text probe only; never a production provider-body meter."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

from tokenizers import Tokenizer

REVISION = "8cadfede7063c896b944e7bae05daa3549ae97ea"
SHA256 = "81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tokenizer", required=True, type=Path)
args = parser.parse_args()
data = args.tokenizer.read_bytes()
if hashlib.sha256(data).hexdigest() != SHA256:
    raise SystemExit("Tokenizer SHA-256 mismatch; probe refused")
if importlib.metadata.version("tokenizers") != "0.23.1":
    raise SystemExit("Pinned tokenizers 0.23.1 required")

tokenizer = Tokenizer.from_str(data.decode("utf-8"))
fixtures = {
    "ascii": "x",
    "mixed": "中文 hello 😀",
    "receipt": 'Confirmed synthetic receipt: "readback"\n第二行',
    "special_literal": "<｜User｜><think>untrusted literal</think>",
}
samples = []
for name, text in fixtures.items():
    # Exercise the same JSON escaping/unescaping boundary as a text message.
    restored = json.loads(json.dumps({"role": "user", "content": text}))["content"]
    ids = tokenizer.encode(restored, add_special_tokens=False).ids
    if not ids or tokenizer.decode(ids, skip_special_tokens=False) != text:
        raise SystemExit("Synthetic fixture roundtrip failed")
    if name == "ascii" and len(ids) != 1:
        raise SystemExit("Unexpected ASCII fixture encoding")
    samples.append({"name": name, "inputTokens": len(ids), "roundtrip": True})

print(json.dumps({
    "status": "passed", "scope": "raw-text-only", "sourceRevision": REVISION,
    "tokenizerSha256": SHA256, "backend": "tokenizers:0.23.1", "fixtures": samples,
    "templateApplied": False, "providerBodyBudgetSuitable": False,
    "maasTemplateMatch": "unverified", "modelCalls": 0,
}, ensure_ascii=False))
