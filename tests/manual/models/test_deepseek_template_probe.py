"""Guard tests with an explicit Fake encoder; not official-template evidence."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import deepseek_template_probe as probe


class GuardTests(unittest.TestCase):
    def test_changed_asset_is_rejected_before_backend_or_network_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "tokenizer.json"
            asset.write_text("synthetic wrong asset", encoding="utf-8")
            with patch.object(probe, "require_offline_namespace") as network:
                with self.assertRaisesRegex(probe.ProbeError, "tokenizer_sha256_mismatch"):
                    probe.run(asset)
                network.assert_not_called()

    def test_networked_linux_and_other_platforms_are_rejected(self):
        with patch.object(probe.sys, "platform", "win32"):
            with self.assertRaisesRegex(probe.ProbeError, "supported_linux_environment_required"):
                probe.require_offline_namespace()
        with patch.object(probe.sys, "platform", "linux"), patch.object(probe.Path, "read_text", return_value="lo: 0\neth0: 0\n"):
            with self.assertRaisesRegex(probe.ProbeError, "isolated_network_namespace_required"):
                probe.require_offline_namespace()
        with patch.object(probe.sys, "platform", "linux"), patch.object(probe.Path, "read_text", return_value="header\nlo: 0\n"):
            probe.require_offline_namespace()

    def test_wrong_recipe_version_is_rejected_before_import(self):
        with patch.object(probe, "read_tokenizer", return_value="{}"), \
                patch.object(probe, "require_offline_namespace"), \
                patch.object(probe.importlib.metadata, "version", return_value="0.1.2"), \
                patch.object(probe.importlib, "import_module") as backend:
            with self.assertRaisesRegex(probe.ProbeError, "recipe_version_mismatch"):
                probe.run("synthetic")
            backend.assert_not_called()

    def test_encoding_mismatch_invalid_ids_and_content_loss_fail(self):
        # Deliberately fake only to exercise failures; no real token counts reported.
        recipe = SimpleNamespace(ChatCompletionRequest=lambda body: SimpleNamespace(
            convert=lambda options: SimpleNamespace(conversation=body)), ConversionOptions=lambda: None)
        tokenizer = SimpleNamespace(encode=lambda prompt: [1, 2])
        for ids, prompt, images, error in [([1], "marker", [], "encoding_mismatch"),
                ([], "marker", [], "invalid_token_ids"), ([True], "marker", [], "invalid_token_ids"),
                ([-1], "marker", [], "invalid_token_ids"),
                ([1, 2], "dropped", [], "request_content_lost"),
                ([1, 2], "marker", ["https://synthetic.invalid/image"], "unexpected_image_source")]:
            encoding = SimpleNamespace(encode=lambda body: ids, render_conversation=lambda body:
                SimpleNamespace(prompt=prompt, image_sources=images))
            with self.subTest(error=error), self.assertRaisesRegex(probe.ProbeError, error):
                probe.check_case(recipe, tokenizer, encoding, {}, ["marker"])

    def test_cli_failure_does_not_echo_private_exception(self):
        output = io.StringIO()
        with patch.object(probe.sys, "argv", ["probe", "--tokenizer", "unused"]), \
                patch.object(probe, "run", side_effect=RuntimeError("synthetic-private-path-and-key")), \
                contextlib.redirect_stdout(output):
            self.assertEqual(probe.main(), 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result, {"status": "failed", "errorType": "RuntimeError", "modelCalls": 0})
        self.assertNotIn("private", output.getvalue())


if __name__ == "__main__":
    unittest.main()
