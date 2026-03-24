#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from typing import Any

THREADS_MAX_LENGTH = 500
THREADS_SECTION_NAME = "Threads"
SKIP_LABELS = {"skip-threads", "no-threads"}


def load_event(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def extract_pr(event: dict[str, Any]) -> dict[str, Any]:
    pr = event.get("pull_request") or {}
    if not pr:
        raise ValueError("pull_request payload is missing.")
    return pr


def extract_threads_section(markdown: str) -> str:
    if not markdown.strip():
        return ""

    pattern = rf"^##\s+{re.escape(THREADS_SECTION_NAME)}\s*$([\s\S]*?)(?=^##\s+|\Z)"
    match = re.search(pattern, markdown, flags=re.MULTILINE)
    return match.group(1).strip("\n") if match else ""


def parse_threads_config(markdown: str) -> dict[str, str]:
    section = extract_threads_section(markdown)
    if not section:
        return {}

    config: dict[str, str] = {}
    current_key: str | None = None

    for raw_line in section.splitlines():
        line = raw_line.rstrip()
        key_match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if key_match:
            current_key = key_match.group(1).lower()
            config[current_key] = key_match.group(2).strip()
            continue

        if current_key and line.startswith(("  ", "\t")):
            extra = line.strip()
            if extra:
                existing = config.get(current_key, "")
                config[current_key] = f"{existing}\n{extra}".strip()

    return config


def has_skip_label(pr: dict[str, Any]) -> bool:
    labels = pr.get("labels") or []
    names = {label.get("name", "").strip().lower() for label in labels}
    return any(label in SKIP_LABELS for label in names)


def collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_post_text(*, pr_number: int, pr_url: str, english: str, japanese: str) -> str:
    prefix = f"New in CloudWeave: {collapse_whitespace(english)} / CloudWeave更新: {collapse_whitespace(japanese)}"
    suffix = f" #{pr_number} {pr_url}"
    available = THREADS_MAX_LENGTH - len(suffix)
    if available <= 0:
        return suffix[-THREADS_MAX_LENGTH:]

    if len(prefix) > available:
        prefix = prefix[: max(available - 1, 0)].rstrip()
        if prefix:
            prefix = f"{prefix}…"

    return f"{prefix}{suffix}"


def log_notice(message: str) -> None:
    print(f"::notice::{message}")


def log_warning(message: str) -> None:
    print(f"::warning::{message}")


def get_threads_user_id(token: str) -> str:
    url = f"https://graph.threads.net/v1.0/me?fields=id&access_token={urllib.parse.quote(token)}"
    with urllib.request.urlopen(url) as response:
        payload = json.loads(response.read().decode("utf-8"))
    user_id = payload.get("id", "")
    if not user_id:
        raise RuntimeError(f"Could not resolve Threads user id: {sanitize_payload(payload)}")
    return user_id


def post_form(url: str, form_data: dict[str, str]) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(form_data).encode("utf-8")
    request = urllib.request.Request(url, data=encoded, method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        response_text = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(response_text)
        except json.JSONDecodeError:
            payload = {"raw": response_text}
        raise RuntimeError(
            f"Threads API request failed ({error.code} {error.reason}) at {url}: {sanitize_payload(payload)}"
        ) from error


def sanitize_payload(payload: Any) -> Any:
    if isinstance(payload, dict):
        return {
            key: "***" if "token" in key.lower() else sanitize_payload(value)
            for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [sanitize_payload(value) for value in payload]
    return payload


def publish_text_post(*, user_id: str, token: str, text: str) -> str:
    create_url = f"https://graph.threads.net/v1.0/{user_id}/threads"
    created = post_form(
        create_url,
        {
            "media_type": "TEXT",
            "text": text,
            "access_token": token,
        },
    )
    creation_id = created.get("id")
    if not creation_id:
        raise RuntimeError(f"Failed to create Threads post: {sanitize_payload(created)}")

    publish_url = f"https://graph.threads.net/v1.0/{user_id}/threads_publish"
    published = post_form(
        publish_url,
        {
            "creation_id": creation_id,
            "access_token": token,
        },
    )
    post_id = published.get("id")
    if not post_id:
        raise RuntimeError(f"Failed to publish Threads post: {sanitize_payload(published)}")
    return str(post_id)


def should_post(pr: dict[str, Any], config: dict[str, str]) -> tuple[bool, str]:
    if pr.get("draft"):
        return False, "Skipping Threads post for draft PR."
    if has_skip_label(pr):
        return False, "Skipping Threads post because a skip label is present."
    if not config:
        return False, "Skipping Threads post because the PR body has no ## Threads section."
    if not config.get("en") or not config.get("ja"):
        return False, "Skipping Threads post because EN or JA content is empty."
    return True, ""


def main() -> int:
    token = os.getenv("THREADS_LONG_LIVED_TOKEN", "").strip()
    event_path = os.getenv("GITHUB_EVENT_PATH", "").strip()

    if not token:
        log_notice("THREADS_LONG_LIVED_TOKEN is not set; skipping Threads posting.")
        return 0
    if not event_path:
        print("GITHUB_EVENT_PATH is missing.", file=sys.stderr)
        return 1

    event = load_event(event_path)
    pr = extract_pr(event)
    config = parse_threads_config(pr.get("body") or "")

    allowed, reason = should_post(pr, config)
    if not allowed:
        log_warning(reason)
        return 0

    post_text = build_post_text(
        pr_number=pr["number"],
        pr_url=pr["html_url"],
        english=config["en"],
        japanese=config["ja"],
    )

    user_id = get_threads_user_id(token)
    post_id = publish_text_post(user_id=user_id, token=token, text=post_text)
    log_notice(f"Posted merged PR #{pr['number']} to Threads as {post_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
