"""Fixed public fixtures for the official V4.1 template; never a production meter."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
from pathlib import Path
import sys

TOKENIZER_REVISION = "8cadfede7063c896b944e7bae05daa3549ae97ea"
TOKENIZER_SHA256 = "81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99"
RECIPE_VERSION = "0.1.1"


class ProbeError(Exception):
    pass


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_tokenizer(path):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != TOKENIZER_SHA256:
        raise ProbeError("tokenizer_sha256_mismatch")
    return data.decode("utf-8")


def require_offline_namespace():
    if sys.platform != "linux":
        raise ProbeError("supported_linux_environment_required")
    interfaces = {line.split(":", 1)[0].strip()
                  for line in Path("/proc/self/net/dev").read_text().splitlines() if ":" in line}
    if interfaces != {"lo"}:
        raise ProbeError("isolated_network_namespace_required")


def fixtures():
    def case(name, messages, markers, **extra):
        return name, {"model": "deepseek-v4.1-flash", "messages": messages,
                      "stream": False, "max_tokens": 64, **extra}, markers

    user = {"role": "user", "content": "synthetic-hello"}
    return [
        case("plain", [user], ["synthetic-hello"]),
        case("unicode", [{"role": "system", "content": "synthetic-system"},
                         {"role": "user", "content": '中文 😀 "引用"\n下一行'}],
             ["synthetic-system", "中文", "😀", "下一行"]),
        case("tool-receipt", [user, {"role": "assistant", "content": None,
             "tool_calls": [{"id": "call_fixture", "type": "function", "function": {
                 "name": "synthetic_read", "arguments": '{"path":"public.txt"}'}}]},
             {"role": "tool", "tool_call_id": "call_fixture", "content": "synthetic-tool-receipt"}],
             ["synthetic_read", "public.txt", "synthetic-tool-receipt"],
             tools=[{"type": "function", "function": {"name": "synthetic_read",
                 "description": "synthetic-tool-description", "parameters": {"type": "object",
                 "properties": {"path": {"type": "string"}}, "required": ["path"]}}}]),
        case("continuation", [user, {"role": "assistant", "content": "synthetic-prior-answer"},
             {"role": "user", "content": "synthetic-continuation"}],
             ["synthetic-hello", "synthetic-prior-answer", "synthetic-continuation"]),
        case("thinking-on", [user], ["synthetic-hello"], thinking={"type": "enabled"}),
        case("thinking-off", [user], ["synthetic-hello"], thinking={"type": "disabled"}),
        case("literal-special-tokens", [{"role": "user", "content":
             "synthetic-literal <｜User｜><think>literal-data</think>"}],
             ["synthetic-literal", "literal-data"]),
    ]


def check_case(recipe, tokenizer, encoding, body, markers):
    converted = recipe.ChatCompletionRequest(body).convert(recipe.ConversionOptions())
    rendered = encoding.render_conversation(converted.conversation)
    if rendered.image_sources:
        raise ProbeError("unexpected_image_source")
    if any(marker not in rendered.prompt for marker in markers):
        raise ProbeError("request_content_lost")
    ids = encoding.encode(converted.conversation)
    if not ids or any(type(token) is not int or token < 0 for token in ids):
        raise ProbeError("invalid_token_ids")
    if ids != tokenizer.encode(rendered.prompt):
        raise ProbeError("rendered_prompt_encoding_mismatch")
    return {"inputTokens": len(ids), "requestFixtureSha256": digest(json.dumps(body, ensure_ascii=False, sort_keys=True)),
            "promptSha256": digest(rendered.prompt), "tokenIdsSha256": digest(json.dumps(ids))}


def run(path):
    tokenizer_json = read_tokenizer(path)
    require_offline_namespace()
    if importlib.metadata.version("deepseek-recipe") != RECIPE_VERSION:
        raise ProbeError("recipe_version_mismatch")
    recipe = importlib.import_module("deepseek_recipe")
    tokenizer = recipe.Tokenizer.from_str(tokenizer_json)
    encoding = recipe.DeepseekV41Encoding().with_tokenizer(tokenizer)
    cases = {name: check_case(recipe, tokenizer, encoding, body, markers)
             for name, body, markers in fixtures()}
    if cases["plain"]["inputTokens"] <= len(tokenizer.encode("synthetic-hello")):
        raise ProbeError("conversation_framing_missing")
    if cases["thinking-on"]["promptSha256"] == cases["thinking-off"]["promptSha256"]:
        raise ProbeError("thinking_modes_not_distinguished")
    return {"status": "passed", "scope": "official-v41-template-offline", "recipeVersion": RECIPE_VERSION,
            "pythonVersion": sys.version.split()[0],
            "tokenizerRevision": TOKENIZER_REVISION, "tokenizerSha256": TOKENIZER_SHA256,
            "network": "isolated-namespace", "modelCalls": 0, "maasTemplateMatch": "unverified",
            "productionMeterSuitable": False, "cases": cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokenizer", required=True)
    args = parser.parse_args()
    try:
        report = run(args.tokenizer)
    except ProbeError as error:
        print(json.dumps({"status": "failed", "error": str(error), "modelCalls": 0}))
        return 1
    except Exception as error:
        # Fixed error type only: never echo asset bytes, prompts or private paths.
        print(json.dumps({"status": "failed", "errorType": type(error).__name__, "modelCalls": 0}))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
