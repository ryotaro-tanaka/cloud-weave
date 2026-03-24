# Threads API

Cloud Weave uses the Threads API from GitHub Actions to publish short bilingual posts when pull requests are merged into `main`.

This memo explains how to obtain the long-lived access token and how to verify posting manually with `curl`.

## Purpose

- Obtain a `LONG_LIVED_TOKEN` from the Meta Threads app screen
- Post a text update to Threads with `curl`

## Prerequisites

- A Meta for Developers app for Threads already exists
- `ryo.dev.studio` has already been added as a Threads tester
- The Threads account is public
- The token will be reused in GitHub Actions or similar automation

## 1. Obtain the LONG_LIVED_TOKEN

Open the existing Threads app from Meta for Developers.

Public page:

https://developers.facebook.com/apps/789363410453591/go_live/

Steps:

1. Click `公開` in the left navigation
2. In `このアプリのユースケース`, open `Threads APIにアクセス`
3. Move to:
   https://developers.facebook.com/apps/789363410453591/use_cases/customize/?use_case_enum=THREADS_API&selected_tab=permissions&product_route=use_cases
4. Click `設定`
5. Scroll to `ユーザートークン生成ツール`
6. Click `アクセストークンを生成` for `ryo.dev.studio`
7. Copy the generated token and store it as `LONG_LIVED_TOKEN`

Information visible on that page:

- Threads app ID: `1534044790993053`
- Threads display name: `ryotaro-dev-social`

## 2. Get your Threads user id

Use the `LONG_LIVED_TOKEN` to confirm the token works and fetch your user id.

```bash
curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_LONG_LIVED_TOKEN"
```

Expected result:

- A JSON response is returned
- The `id` value is the `THREADS_USER_ID`

## 3. Create a text post

Create the post container first.

```bash
curl -X POST "https://graph.threads.net/v1.0/THREADS_USER_ID/threads" \
  -F media_type=TEXT \
  -F text='test post from curl' \
  -F access_token=YOUR_LONG_LIVED_TOKEN
```

Expected result:

- A JSON response is returned
- The `id` value is the `CREATION_ID`

## 4. Publish the post

Publish the previously created post container.

```bash
curl -X POST "https://graph.threads.net/v1.0/THREADS_USER_ID/threads_publish" \
  -F creation_id=CREATION_ID \
  -F access_token=YOUR_LONG_LIVED_TOKEN
```

Expected result:

- The post is published

## 5. Full flow

1. Generate an access token from the Meta Threads app screen
2. Save it as `LONG_LIVED_TOKEN`
3. Call `/me` to get `THREADS_USER_ID`
4. Call `/threads` to get `CREATION_ID`
5. Call `/threads_publish` to publish

## 6. Values to replace

- `YOUR_LONG_LIVED_TOKEN`
- `THREADS_USER_ID`
- `CREATION_ID`

## 7. Minimum things to remember

- `LONG_LIVED_TOKEN` comes from the Meta `ユーザートークン生成ツール`
- Posting happens in two steps:
  - create
  - publish
- Call `/me` first to confirm the token and user id

## 8. Copy-paste commands

Get user id:

```bash
curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_LONG_LIVED_TOKEN"
```

Create post:

```bash
curl -X POST "https://graph.threads.net/v1.0/THREADS_USER_ID/threads" \
  -F media_type=TEXT \
  -F text='test post from curl' \
  -F access_token=YOUR_LONG_LIVED_TOKEN
```

Publish post:

```bash
curl -X POST "https://graph.threads.net/v1.0/THREADS_USER_ID/threads_publish" \
  -F creation_id=CREATION_ID \
  -F access_token=YOUR_LONG_LIVED_TOKEN
```

## GitHub Actions secret

The current workflow uses only one repository secret:

- `THREADS_LONG_LIVED_TOKEN`

Register the token obtained above as the GitHub Actions secret value.

## PR body contract

If the pull request body contains a `## Threads` section, the workflow posts it automatically after merge to `main`.

```md
## Threads
EN: Added file preview support for downloads.
JA: ダウンロードしたファイルのプレビューに対応しました。
```

Notes:

- There is no `Ready: true|false` flag anymore
- Delete the whole `## Threads` section when you do not want a post
- `EN` and `JA` are both required
- `skip-threads` or `no-threads` labels still force a skip

## Manual GitHub Actions test

To test Threads posting without creating and merging a pull request:

1. Open the `Threads Post Manual` workflow in the GitHub Actions tab
2. Click `Run workflow`
3. Enter `english` and `japanese`
4. Run the workflow

This uses the same Python posting script as the merged-PR workflow, but it reads the text directly from workflow inputs instead of a PR body.
