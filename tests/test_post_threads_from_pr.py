import importlib.util
import os
import pathlib
import unittest
from unittest import mock


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
EN: Added preview support.
JA: プレビュー対応を追加しました。
Image: ignored
"""
        config = MODULE.parse_threads_config(body)

        self.assertEqual(config["en"], "Added preview support.")
        self.assertEqual(config["ja"], "プレビュー対応を追加しました。")
        self.assertEqual(config["image"], "ignored")

    def test_parse_threads_config_supports_indented_continuation_lines(self) -> None:
        body = """## Threads
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
            {"en": "Only English"},
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

    def test_build_manual_post_text_truncates_to_threads_limit(self) -> None:
        text = MODULE.build_manual_post_text(
            english="A" * 400,
            japanese="B" * 400,
        )

        self.assertLessEqual(len(text), MODULE.THREADS_MAX_LENGTH)
        self.assertTrue(text.startswith("New in CloudWeave: "))

    def test_get_manual_config_reads_environment(self) -> None:
        original_en = os.environ.get("THREADS_TEST_EN")
        original_ja = os.environ.get("THREADS_TEST_JA")
        try:
            os.environ["THREADS_TEST_EN"] = "Manual English"
            os.environ["THREADS_TEST_JA"] = "手動テスト"
            config = MODULE.get_manual_config()
        finally:
            if original_en is None:
                os.environ.pop("THREADS_TEST_EN", None)
            else:
                os.environ["THREADS_TEST_EN"] = original_en
            if original_ja is None:
                os.environ.pop("THREADS_TEST_JA", None)
            else:
                os.environ["THREADS_TEST_JA"] = original_ja

        self.assertEqual(config, {"en": "Manual English", "ja": "手動テスト"})

    def test_is_transient_threads_error_for_server_error(self) -> None:
        error = MODULE.ThreadsApiError("boom", status_code=500, payload={"error": {"message": "retry later"}})

        self.assertTrue(MODULE.is_transient_threads_error(error))

    def test_publish_with_retry_retries_transient_error(self) -> None:
        transient_error = MODULE.ThreadsApiError(
            "retry later",
            status_code=500,
            payload={"error": {"is_transient": True, "code": 2}},
        )

        with mock.patch.object(MODULE, "post_form", side_effect=[transient_error, {"id": "published-123"}]) as post_form:
            with mock.patch.object(MODULE.time, "sleep") as sleep:
                result = MODULE.publish_with_retry(
                    publish_url="https://graph.threads.net/v1.0/test/threads_publish",
                    token="token",
                    creation_id="creation",
                )

        self.assertEqual(result, {"id": "published-123"})
        self.assertEqual(post_form.call_count, 2)
        sleep.assert_any_call(MODULE.THREADS_PUBLISH_INITIAL_DELAY_SECONDS)

    def test_publish_with_retry_does_not_retry_non_transient_error(self) -> None:
        fatal_error = MODULE.ThreadsApiError(
            "bad request",
            status_code=400,
            payload={"error": {"is_transient": False, "code": 100}},
        )

        with mock.patch.object(MODULE, "post_form", side_effect=fatal_error) as post_form:
            with mock.patch.object(MODULE.time, "sleep"):
                with self.assertRaises(MODULE.ThreadsApiError):
                    MODULE.publish_with_retry(
                        publish_url="https://graph.threads.net/v1.0/test/threads_publish",
                        token="token",
                        creation_id="creation",
                    )

        self.assertEqual(post_form.call_count, 1)


if __name__ == "__main__":
    unittest.main()
