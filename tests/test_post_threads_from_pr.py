import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(".github/scripts/post_threads_from_pr.py")
SPEC = importlib.util.spec_from_file_location("post_threads_from_pr", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ThreadsPostTests(unittest.TestCase):
    def test_parse_threads_config_extracts_known_fields(self) -> None:
        body = """## Summary

Something changed.

## Threads
Ready: true
EN: Added preview support.
JA: プレビュー対応を追加しました。
Image: ignored
"""
        config = MODULE.parse_threads_config(body)

        self.assertEqual(config["ready"], "true")
        self.assertEqual(config["en"], "Added preview support.")
        self.assertEqual(config["ja"], "プレビュー対応を追加しました。")
        self.assertEqual(config["image"], "ignored")

    def test_parse_threads_config_supports_indented_continuation_lines(self) -> None:
        body = """## Threads
Ready: true
EN: Added preview support.
  Works for downloaded files too.
JA: プレビュー対応を追加しました。
  ダウンロード済みファイルにも対応します。
"""
        config = MODULE.parse_threads_config(body)

        self.assertEqual(config["en"], "Added preview support.\nWorks for downloaded files too.")
        self.assertEqual(config["ja"], "プレビュー対応を追加しました。\nダウンロード済みファイルにも対応します。")

    def test_should_post_rejects_missing_section(self) -> None:
        allowed, reason = MODULE.should_post({"draft": False, "labels": []}, {})

        self.assertFalse(allowed)
        self.assertIn("no ## Threads section", reason)

    def test_should_post_rejects_missing_copy(self) -> None:
        allowed, reason = MODULE.should_post(
            {"draft": False, "labels": []},
            {"ready": "true", "en": "Only English"},
        )

        self.assertFalse(allowed)
        self.assertIn("EN or JA content is empty", reason)

    def test_build_post_text_truncates_to_threads_limit(self) -> None:
        text = MODULE.build_post_text(
            pr_number=12,
            pr_url="https://github.com/example/repo/pull/12",
            english="A" * 400,
            japanese="B" * 400,
        )

        self.assertLessEqual(len(text), MODULE.THREADS_MAX_LENGTH)
        self.assertIn("#12 https://github.com/example/repo/pull/12", text)
        self.assertTrue(text.endswith("#12 https://github.com/example/repo/pull/12"))


if __name__ == "__main__":
    unittest.main()
