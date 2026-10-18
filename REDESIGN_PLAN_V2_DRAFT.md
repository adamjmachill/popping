## 2. Safety and security

Baseline for every file:line in sections 2 to 14 is origin/main 721713e (PR #12). The audit scripts under frontend/scripts/iphone-audit/ exist only on origin/claude/redesign-plan; their line numbers refer to that branch. Re-check each line before editing, because lines drift between PRs.

Nothing in this plan opens a port, starts a process, adds a container or changes how the VPS is reached. Code is written in the Claude Code container and lands as pull requests.

**Merging to main is the release.** build.yml tags `latest` on every push to main (build.yml:141, :191), and both app services use `pull_policy: ${POPPING_PULL_POLICY:-always}` (docker-compose.yml:84, :120). The next `docker compose up -d` on the VPS, from popping-update or by hand, deploys whatever main last built. There is no phone preview before merge (PR images are built but never pushed, build.yml:144, :156). The owner go/no-go below is therefore mandatory, not advisory.

| Item | After this plan |
|---|---|
| Published ports | Unchanged: only the frontend, `${POPPING_FRONTEND_HOST:-127.0.0.1}:${POPPING_FRONTEND_PORT:-14789}:8080` (docker-compose.yml:129). |
| Containers and services | Unchanged: postgres, backend, frontend, plus guard-proxy (profile `hardened`, docker-compose.yml:78) or cloudflared (profile `tunnel`, :138) only if the owner enabled those profiles. No new asyncio task: the /auto YouTube branch starts no discovery task (the RSS branch does, routes/sources.py:621-628). No new API route, cron job, service worker or web worker. |
| Outbound hosts | No new host compared with today. The YouTube page lookup goes to youtube.com hosts and follows only the redirects YouTube sends (consent.youtube.com, consent.google.com, accounts.google.com, www.google.com/sorry). Every hop passes `ssrf_event_hook`; the entry URL and final URL pass `check_url_safe`; after the response every URL in `resp.history` and `resp.url` must be on that list or the result is rejected without reading any marker. The `/user/NAME` fallback is verified with the existing `app.sources.rss.fetch_rss` (same SSRF guard). No googleapis.com (open decision 1). |
| What a lookup sends | A desktop Safari User-Agent, `Accept`, `Accept-Language: en-US,en;q=0.9`, and two fixed consent cookies (`SOCS=CAI`, `CONSENT=YES+`) on `.youtube.com`. No user data, credentials or keys. |
| Logging | Popping's own `youtube: lookup` line never contains a query string or page body. httpx's own INFO line (`HTTP Request: GET <url>`, enabled because main.py:71-74 sets the root logger to INFO) still logs each hop's full URL; that is public YouTube data and main.py stays untouched. |
| SSRF guard reasons | Never shown to the user (url_safety.py:220-222). PR1 removes today's leaks at youtube.py:83-85, :101-106 and routes/sources.py:957-964 (in /test that branch is reached only for reddit, whose validator skips `check_url_safe`; every other type is refused first at :943 by `_validate_url`, whose detail "url is not reachable (must be a public host)" already hides the reason, :233-242). The user sees "That address isn't reachable from Popping."; the reason is logged as `result=blocked:ssrf` without the query string. |
| Header deny list | routes/sources.py:169-187 stays the authority and grows by: content-length, transfer-encoding, connection, keep-alive, te, trailer, upgrade, expect, proxy-authorization, proxy-connection. New input rules: names must be RFC 7230 tokens (checked before the deny list), at most 100 characters, no case-insensitive duplicates, and `user-agent`, `accept`, `accept-language` are stored as `User-Agent`, `Accept`, `Accept-Language`. The last rule matters because rss.py:375 and article_extract.py:97-101 merge with a case-sensitive dict, so a lower-case key would send two User-Agent headers. lib/headers.ts mirrors all of it; a no_db test pins both directions. |
| Header values | Stored as plain text and returned by GET /api/sources to anyone who can open Popping, as today. The editor says so. No new storage. |
| Source names | `_NAME_RE.match` (routes/sources.py:111, :213) accepts `"abc\n"`. PR1 switches to `fullmatch` so a newline can never reach a job id, `/api/ingest/{name}` or a log line. |
| CSP (frontend/nginx.conf.template:29) | Unchanged. No external fonts, scripts or styles. The select chevron is a `data:` SVG, allowed by `img-src 'self' data:`. Inline `style` attributes (keyboard insets) are allowed by `style-src 'self' 'unsafe-inline'`. The CI smoke test injects this CSP and fails on any console "Refused to". |
| Docker images | Same Dockerfiles. frontend/package.json and package-lock.json are unchanged, so the image build stage is identical. Playwright exists only on the GitHub runner, installed with `npm install --no-save --ignore-scripts`, followed by `git diff --exit-code package.json package-lock.json`. |
| CI | Steps are added to the `frontend-checks` job only. That job also gains job-level `permissions: { contents: read }` and `persist-credentials: false` on its checkout. Today it inherits `packages: write` (build.yml:20-22) and actions/checkout persists that token, so a compromised Playwright, apt or browser download could push a `:latest` image the VPS pulls automatically. Both changes narrow access. No new job, trigger, secret or third-party action. |

**Files a PR may touch:**
- `frontend/src/**`
- `frontend/scripts/iphone-audit/**` (restored from the plan branch in PR2, step 0)
- `frontend/scripts/unit/**` (new in PR3)
- `frontend/eslint.config.js`
- `frontend/tailwind.config.js` (PR2 only: `future.hoverOnlyWhenSupported` and the stale sheetUp comment)
- `backend/app/youtube.py`
- `backend/app/routes/sources.py`
- `backend/app/scheduler.py` (inside `update_source` only)
- `backend/app/schemas.py` (docstrings and comments only)
- `backend/tests/**`
- `README.md` (YouTube how-to, smoke test)
- `.github/workflows/build.yml` (the `frontend-checks` job only)

**Files no PR may touch** (anything not listed above is also forbidden; these are the likely mistakes):
- docker-compose*.yml, any Dockerfile, frontend/nginx.conf.template, egress-proxy/**, ops/**
- frontend/package.json, frontend/package-lock.json, frontend/tsconfig.json, frontend/index.html, frontend/public/**, .github/dependabot.yml
- backend/app/config.py, backend/app/main.py, backend/app/url_safety.py, backend/app/sources/**, backend/app/article_extract.py, backend/requirements*.lock, .env.example
- .redesign/**, REDESIGN_*.md (plan files never go into a PR)

**Before each merge** (repo root; each line must pass):
1. Path check. It exits non-zero when any other path appears, renames included:
   ```bash
   git fetch origin main
   ! git diff --no-renames --name-only origin/main...HEAD | grep -vE '^(frontend/src/|frontend/scripts/(iphone-audit|unit)/|frontend/(eslint|tailwind)\.config\.js$|backend/app/(youtube|scheduler|schemas)\.py$|backend/app/routes/sources\.py$|backend/tests/|README\.md$|\.github/workflows/build\.yml$)'
   ```
2. Narrow files, by reading `git diff --no-renames origin/main...HEAD -- <file>`:
   - scheduler.py: every hunk is inside `update_source`;
   - schemas.py: only docstring and comment lines change;
   - tailwind.config.js: only the `future` key and comments;
   - build.yml: only lines inside `frontend-checks`; no `secrets.`; no new `uses:`; the only `permissions:` and `persist-credentials` lines added are `contents: read` and `persist-credentials: false` on that job.
3. Backend greps:
   ```bash
   ! git diff --no-renames origin/main...HEAD -- backend/app | grep '^+' | grep -E 'trust_env|proxy=|mounts=|create_task|ensure_future|BackgroundTasks|subprocess|threading|@router\.'
   git diff --no-renames origin/main...HEAD -- backend/app | grep '^+' | grep -oE 'https?://[A-Za-z0-9.-]+' | sort -u   # every host listed ends in youtube.com
   test "$(grep -c 'httpx.AsyncClient(' backend/app/youtube.py)" -eq "$(grep -c 'event_hooks={"request": \[ssrf_event_hook\]}' backend/app/youtube.py)"
   ! grep -rnE 'serviceWorker|new Worker|SharedWorker' frontend/src
   ```
4. Run the security-review skill on the diff and read every finding.
5. All four check runs are green: `backend tests`, `frontend lint + build`, `backend image`, `frontend image` (poll as in section 13).
6. Owner go/no-go. Send the 390-wide PNGs of the changed screens from the local smoke run (CI screenshots cannot be retrieved) with SendUserFile, plus three lines on what to look for. PR1 and PR3 change nothing visible: send a three-line summary instead. Merge only after the owner replies "go".

**Around each popping-update on the VPS** (owner, as root):
```bash
cd /opt/popping
docker ps --format '{{.Names}}\t{{.Ports}}' | sort > /root/pre-ports.txt
ss -ltn | awk 'NR>1{print $4}' | sort > /root/pre-ss.txt
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q backend)" > /root/popping-prev-sha
popping-update
docker ps --format '{{.Names}}\t{{.Ports}}' | sort | diff /root/pre-ports.txt -
ss -ltn | awk 'NR>1{print $4}' | sort | diff /root/pre-ss.txt -
```
- Both diffs print nothing. Any added line is a stop: roll back.
- The app loads and a feed refreshes.
- After PR1: add one channel by @handle, then `cd /opt/popping && docker compose logs backend | grep "youtube: lookup"`. A marker name in `result=` means lookups work from the VPS; `blocked:consent` or `blocked:bot` confirms cause B1 (section 3).

**Rollback:**
```bash
cd /opt/popping
echo "POPPING_IMAGE_TAG=sha-$(cat /root/popping-prev-sha)" >> .env
docker compose pull && docker compose up -d
```
- The tag is `sha-<full 40-character sha>` (build.yml:140, :190; README.md:83). The revision label is set by metadata-action through `labels:` (build.yml:158, :208).
- popping-update pruned the old image (ops/popping-update.sh:26), so this pulls it again from GHCR.
- The pin survives later popping-update runs. To resume normal updates: delete that line from /opt/popping/.env, then run popping-update.
- No migration exists in this plan, and data written by new code (stripped categories, canonical header names) reads fine in old code, so rollback is always safe.

## 3. YouTube links that will not add

### Causes found in the code

**Confirmed** (each one alone makes Add fail today):
- **F1. Add and Test stay grey with no reason.** `nameError` blocks while Name is empty (FeedManager.tsx:1371, :1400). `new URL()` rejects `@handle`, scheme-less links and bare ids (:1382-1386, :1410-1415). Neither error is rendered anywhere.
- **F2. Every Add failure goes to `onError`** (:1430, :1473), which is App's banner under the z-50 sheet (App.tsx:2397-2411, :2839). A non-empty invalid name such as "Marques Brownlee" also ends there.
- **F3. Add sends the typed URL, not `resolved_url` from Test** (:1446-1458), so YouTube is looked up twice.
- **B3. Shapes that already carry the id still fail.** `feeds/videos.xml?channel_id=UC…` does not match `/channel/` (youtube.py:37) and is fetched as a page, whose XML has no JSON marker. A bare `UC…` id or a link without `https://` is not a URL and gets a 422. youtube.py:37 is unanchored, so a 23+ character id is silently truncated.
- **B4. /auto has no YouTube branch** (routes/sources.py:573-644). It creates an rss row called `youtube_com`, a generic_scrape row, or fails.
- **B5. Raw text reaches the user:** httpx exception text (youtube.py:107-108), the `check_url_safe` reason (youtube.py:83-85, :101-106) and, in /test, the SSRF reason at routes/sources.py:957-964. That /test branch is reached only when `_validate_url` was skipped (type reddit, :931-940) or DNS changed between :943 and :957; every other type is refused at :943 with the generic "url is not reachable (must be a public host)" (:233-242). All three break url_safety.py:220-222.

**Likely, not verifiable here** (this container's proxy blocks youtube.com):
- **B1. The page fetch looks like a bot:** `User-Agent: Popping/0.2` (config.py:392 via youtube.py:41, sent at :98), no Accept-Language, no consent cookies. Datacenter and EU addresses may get consent.youtube.com or a bot check; the VPS region is unknown. The lookup log line (below) settles this after PR1 deploys.
- **B2. One marker only** (youtube.py:38).

### Every link shape and how it resolves (backend/app/youtube.py, PR1)

Path prefixes compare case-insensitively (`/CHANNEL/` works); ids are case-sensitive. A channel id is anchored: `/channel/(UC[0-9A-Za-z_-]{22})(?=[/?#]|$)`.

| # | Pasted | Result | Network |
|---|---|---|---|
| 1 | `/channel/UC…` on www, m., music., studio. or the bare host, with any suffix (`/videos`, `?si=…`) | feed URL | none |
| 2 | `…/feeds/videos.xml?channel_id=UC…` (extra params dropped) | canonical feed URL | none |
| 3 | `…/feeds/videos.xml?user=NAME` or `?playlist_id=<allowed id>` | canonical feed URL | none |
| 4 | `…/playlist?list=ID` without `v=`, where ID starts PL, OLAK5uy_ or FL | `feeds/videos.xml?playlist_id=ID` | none |
| 5 | `…/playlist?list=UU` + 22 characters | `feeds/videos.xml?channel_id=UC` + the same 22 | none |
| 6 | `list=WL`, `LL`, `RD…` or any other prefix | error "Private or automatic playlists don't have a feed. Paste the channel's link instead." | none |
| 7 | bare `UC` + 22 characters, surrounding spaces allowed | feed URL | none |
| 8 | scheme-less `youtube.com/…`, `www.`, `m.`, `music.`, `youtu.be/…` | `https://` is added only when the prefixed URL's parsed host is a YouTube host; then rows 1-15 | as that row |
| 9 | bare `@handle` matching `^@[\w.·-]{3,30}$` (Python `\w` is Unicode), only when the caller allows it (type youtube_channel, PATCH of a youtube_channel row, /auto) | `https://www.youtube.com/@<percent-encoded handle>`, then row 10 | page lookup |
| 10 | `/@handle` (+ `/videos`, `?si=`) | page lookup of `https://www.youtube.com/@handle` | yes |
| 11 | `/c/NAME` | page lookup | yes |
| 12 | `/user/NAME` | page lookup. If YouTube blocks it, use `feeds/videos.xml?user=NAME` only when one `fetch_rss` of it returns at least one item; otherwise the blocked message | yes |
| 13 | `watch?v=ID` (any parameter order, `app=desktop`, `t=`), `youtu.be/ID` (`?si=`), `/shorts/ID`, `/live/ID`, `/embed/ID`, on www, m. or music. | page lookup of `https://www.youtube.com/watch?v=ID` | yes |
| 14 | a single path segment that is not reserved (legacy vanity, `youtube.com/marquesbrownlee`) | page lookup | yes |
| 15 | home page, `/results`, `/feed/…`, `/account`, `/about`, `/attribution_link`, `/channel/<not a valid id>`, any other path | error "That isn't a channel link. Paste the channel's page, a video link, an @handle or the channel ID." Never a lookup: the last marker would pick a random recommended channel. | none |
| 16 | any other host, including `youtube.com.evil.example` and `youtube.com@127.0.0.1/` | passthrough, then normal URL validation (`is_youtube_url` unchanged) | as today |

Reserved first segments: watch, results, feed, feeds, playlist, shorts, live, embed, channel, c, user, account, about, attribution_link.

Every page-lookup URL is rebuilt from parsed parts as `https://www.youtube.com/<path>[?v=ID]`: userinfo and port dropped, youtu.be mapped to `/watch?v=`, only `v` kept, so `si` never leaves the server.

### Code shape

Public names kept: `is_youtube_url` (unchanged), `resolve_channel_feed_url`, `YouTubeResolutionError`. `resolve_channel_feed_url` calls `normalize_youtube_input` first and returns non-YouTube input unchanged (so `r/python` stays a no-op, test_youtube.py:104-109).

```python
_TRANSPORT: httpx.AsyncBaseTransport | None = None   # test seam; None = real network (env proxies still mount)
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
_PAGE_HEADERS = {"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                 "Accept-Language": "en-US,en;q=0.9"}          # never a Cookie header
_MAX_BODY = 3_000_000
class YouTubeBlockedError(YouTubeResolutionError): ...
class YouTubeNotFoundError(YouTubeResolutionError): ...
def normalize_youtube_input(text: str, *, allow_bare_handle: bool = False) -> str
def channel_id_from_html(html: str) -> str | None                     # pure
def is_blocked_page(final_url: str, status: int, html: str) -> bool   # pure
def youtube_source_slug(original: str, feed_url: str) -> str          # pure
def _client() -> httpx.AsyncClient
async def resolve_channel_feed_url(url: str, *, allow_bare_handle: bool = False) -> str

def _client() -> httpx.AsyncClient:
    jar = httpx.Cookies()
    # SOCS=CAI is the "reject all" consent value open-source YouTube clients use to skip the
    # EU consent wall. YouTube may stop honouring it at any time; blocked-page detection plus
    # the channel-ID message is the fallback.
    jar.set("SOCS", "CAI", domain=".youtube.com")
    jar.set("CONSENT", "YES+", domain=".youtube.com")
    return httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT, follow_redirects=True, max_redirects=5, cookies=jar, transport=_TRANSPORT,
        event_hooks={"request": [ssrf_event_hook]},
    )
```
- Cookies sit on the client: httpx 0.28.1 (requirements.lock:85) pops the `Cookie` header on every redirect; jar cookies were verified to reach the youtube.com → www → consent hops.
- Keep the `event_hooks={"request": [ssrf_event_hook]}` literal exactly (test_youtube.py:77-88) and exactly one `httpx.AsyncClient(` in the file.
- With `transport=None`, httpx still mounts env proxies (the optional egress guard).

**Lookup steps:**
1. `check_url_safe(rebuilt_url)`. Failure: the unreachable message, log `blocked:ssrf`.
2. `async with _client() as client, client.stream("GET", url, headers=_PAGE_HEADERS) as resp:` read with `resp.aiter_bytes()` (decoded bytes, so the cap bounds decompressed size against the backend's 2 GB limit, docker-compose.yml:106). Append `chunk[: _MAX_BODY - len(buf)]`, stop at the cap, then `buf = buf[:_MAX_BODY]` (MockTransport delivers the whole body as one chunk). Decode with `errors="replace"`.
3. Catch only `httpx.HTTPError`, never `except Exception`. A `RequestError` whose message starts with "SSRF guard aborted" gives the unreachable message (`blocked:ssrf`); other transport errors and timeouts give the network message.
4. Host chain: every URL in `resp.history` plus `resp.url` must have a host matching `(^|\.)(youtube\.com|youtu\.be)$`, or be consent.google.com, accounts.google.com, or (www.)google.com with a path starting `/sorry/`. Anything else gives the unexpected-host message (`blocked:host`) and no marker is read.
5. Final-URL `check_url_safe` (kept).
6. Status 404: not found. Status 429: blocked. Any other status ≥ 400: the HTTP-error message.
7. Final host consent.youtube.com, consent.google.com, accounts.google.com, or google.com `/sorry/`: blocked.
8. `channel_id_from_html(html)`: a hit returns the feed URL. Markers run before the blocked check, so an age-gated watch page ("Sign in to confirm your age") still resolves.
9. `is_blocked_page(...)`: blocked. Otherwise the no-marker message.

**Markers.** First hit wins. `"browseId"` is excluded because shelves name other channels. Match the tag first, then read its attributes, so attribute order does not matter.
1. `<link rel="alternate" type="application/rss+xml" href="…/feeds/videos.xml?channel_id=(UC…)">`
2. `<link rel="canonical" href="…/channel/(UC…)">`
3. `<meta property="og:url" content="…/channel/(UC…)">`
4. `<meta itemprop="channelId|identifier" content="(UC…)">`
5. Locate `"videoDetails":{"videoId":` and search `"channelId":"(UC…)"` in the next 4,000 characters. No brace rule: a title containing `{` or `}` would defeat one.
6. `"externalChannelId":"(UC…)"`
7. `"externalId":"(UC…)"`
8. `"channelId":"(UC…)"`

**Blocked page** (`is_blocked_page` true when any holds):
- final host ends with `consent.youtube.com` or `consent.google.com`, is `accounts.google.com`, or is (www.)google.com with a path starting `/sorry/`;
- status 429;
- body contains `action="https://consent.youtube.com` or `Before you continue to YouTube`, or matches `confirm you(?:’|'|\\u2019|\\u0027)re not a bot` (case-insensitive). A bare "Sign in to confirm" is not a rule.

**/user fallback.** Import lazily inside the function (`from app.sources.rss import fetch_rss`). Accept `feeds/videos.xml?user=NAME` only when it returns at least one item; otherwise raise `YouTubeBlockedError`. Wrap the call in `except (httpx.HTTPError, ValueError)`: `fetch_rss` raises httpx errors (`raise_for_status`, rss.py:394; a retried transport error, :500-503), and `ValueError` for a redirect to a denied host (rss.py:411-413) and for a body that is not a feed (rss.py:476-481). Either becomes `YouTubeBlockedError`, so nothing escapes as a 500. This is the one place besides lookup step 3 that catches, and it still never uses `except Exception`. Log `fallback:user_ok` or `fallback:user_failed`. This also covers POST, PATCH and /auto, which never fetch the feed themselves.

**Slug** (`youtube_source_slug`, also mirrored by `suggestName` in lib/feedRules.ts):
- `@handle`, `/c/NAME`, `/user/NAME` or `?user=NAME` → `<name>_yt`;
- playlist → `playlist_<last 6 of the id, lower-cased>_yt`;
- channel id, including resolved watch links → `channel_<last 6 of the UC id, lower-cased>_yt`;
- names slugified to `[a-z0-9_]`, at most 100 characters; empty after slugifying (a non-Latin handle) → the channel form.
- labels.ts:50-53 already shows `_yt` as " (YouTube)".

**Logging.** One INFO line per lookup: `youtube: lookup host=<final host> status=<code> result=<marker name | blocked:<rule> | not_found | http_<code> | network | fallback:user_ok | fallback:user_failed>`. Never the query string or the body.

**Error wording.** The user sees exactly these; raw exception text is never included.

| Case | Message |
|---|---|
| Blocked | "YouTube didn't let Popping look this channel up. Paste the channel ID instead: open the channel in YouTube, tap “more about this channel”, then Share channel, then Copy channel ID. It starts with UC." |
| 404 | "YouTube says this channel or video doesn't exist." |
| No marker | "Couldn't find the channel on that YouTube page. Paste the channel ID instead. It starts with UC." |
| Other HTTP status | "YouTube answered with an error (HTTP <code>). Try again later, or paste the channel ID. It starts with UC." |
| Network or timeout | "Couldn't reach YouTube. Try again in a minute." |
| SSRF guard (entry, any hop, final URL) | "That address isn't reachable from Popping." |
| Redirect to an unexpected host | "YouTube sent Popping somewhere unexpected. Paste the channel ID instead. It starts with UC." |
| Not a channel link (row 15) | "That isn't a channel link. Paste the channel's page, a video link, an @handle or the channel ID." |
| Private or automatic playlist (row 6) | "Private or automatic playlists don't have a feed. Paste the channel's link instead." |
| Already followed (POST, 409) | "You already follow this channel as <name>." The frontend shows `sourceLabel(name)`. |

Check the YouTube app's wording ("more about this channel", "Share channel") on the phone after PR1 deploys and adjust the string if it differs.

### Routes (backend/app/routes/sources.py, PR1)

- **POST /api/sources** (:421-538): keep `_validate_name` first (:437) and the Apple resolver (:441-444). Then `resolve_channel_feed_url(body.url, allow_bare_handle=(body.type == "youtube_channel"))`. When the result is a YouTube feed (`is_youtube_url(url) and "/feeds/videos.xml" in url`), look up `Source.url == url`; a hit returns 409 "You already follow this channel as <name>.".
- **PATCH** (:696-699): `allow_bare_handle=(pre.type == "youtube_channel")`.
- **POST /api/sources/test** (:839-1068):
  - move the name block (:894-926) above resolution (:884-892), so a bad name costs no lookup;
  - resolve with the same flag as POST; a failure returns `error_kind="invalid_url"` and the message as `error`;
  - the SSRF branch (:957-964) returns `error="That address isn't reachable from Popping."` and logs the reason at INFO without the query. It is reached for reddit (its validator skips `check_url_safe`); other types keep failing earlier at :943 with `_validate_url`'s generic detail, which the frontend maps through "not reachable" (section 6);
  - header validation failure (:968-980) returns `error_kind="invalid_headers"` instead of `"unknown"`; document it in the SourceTestResult docstring (schemas.py:212+).
- **POST /api/sources/auto** (:573-644). Before `_validate_url(body.url)` (:607):
  1. `url = normalize_youtube_input(body.url, allow_bare_handle=True)`.
  2. If `is_youtube_url(url)`: `category = _validate_category(body.category)`; `feed_url = await resolve_channel_feed_url(url, allow_bare_handle=True)` (a 422 carries the message); `_validate_url(feed_url)`, as POST does at :456-460.
  3. If a row has `Source.url == feed_url`, return `SourceAutoResult(found=True, kind="youtube_channel", source=<that row>)` and create nothing. The frontend detects the known id and says "Already added".
  4. `name = await _free_source_name(session, youtube_source_slug(url, feed_url))`.
  5. `scheduler.add_source(session, name=name, type_="youtube_channel", category=category, url=feed_url, refresh=_YOUTUBE_DEFAULT_REFRESH)`. No discovery task.
  6. `return SourceAutoResult(found=True, kind="youtube_channel", source=…)`. `kind` is `Optional[str]` (schemas.py:142), so only the docstring changes.
  - Otherwise /auto continues exactly as today with `body.url`.
- The per-type refresh defaults (:476-487) are dead code because `SourceCreate.refresh_interval_seconds` is `int = 3600` (schemas.py:95). schemas.py stays docstring-only; every frontend caller sends a refresh value explicitly (trackAnyway sends 7200). Open decision 8.

### Frontend (PR4, FeedManager.tsx Add tab; helpers in lib/feedRules.ts from PR3)

**`normalizeFeedInput(type, raw)`**, used by `validateForm`, the re-validate effect, `test` and `submit`:
- trim;
- youtube: a value matching `/^@[\p{L}\p{N}._·-]{3,30}$/u` becomes `new URL('https://www.youtube.com/' + value).toString()` (this percent-encodes non-Latin handles); `^UC[0-9A-Za-z_-]{22}$` becomes `https://www.youtube.com/channel/UC…`;
- every non-reddit type: a value with no `://` and a dot gets `https://` in front.
- The re-validate effect keeps `new URL(trimmedUrl)` and deps exactly `[name, url, sourceType]` (slice15 test_useeffect_revalidate_treats_generic_scrape_as_url_type): compute `const trimmedUrl = normalizeFeedInput(sourceType, url)` inside it. `normalizeFeedInput` is a module import, not a dep.

**Name is optional.**
- Label "Name (optional)". A typed name is normalised like the editor's (section 6); an invalid one shows an inline error and nothing is sent.
- `suggestName(type, normalizedUrl, existingNames)`: the backend slug rules above for YouTube; `r_<sub>` for reddit; the hostname slug otherwise (the same operations as trackAnyway, FeedManager.tsx:1179-1186). Dedupe with `_2`, `_3`.
- Shown as hint text "Will be saved as: <slug>", never a `placeholder={…}`.
- YouTube video links (watch, youtu.be, shorts, live, embed) with Name blank: before Test the hint reads "Name is chosen after Test."; after an ok Test the name derives from `resolvedUrl`. Tapping Add with Name blank and no `resolvedUrl` runs `test()` inside `submit` first; a failed Test stops Add and shows its error.

**Errors and results.**
- Render `nameError` and `urlError` under their fields (`text-ios-caption text-red-300`), in plain words.
- Add failures render in the result box (`setTestResult({ kind: 'err', message })`), never `onError`.
- `submit` sends `testResult?.kind === 'ok' && testResult.resolvedUrl ? testResult.resolvedUrl : normalized`.
- `noValidate` on the `<form>`.
- YouTube Test where resolution worked but the feed fetch failed (`resolved_url` set and `error_kind` is not_found, timeout, network_error or unknown): "Found the channel, but YouTube's feed isn't answering right now. You can add it anyway; Popping will keep checking."
- A 409 "You already follow this channel as <name>." is shown as "You already follow this channel as <sourceLabel(name)>."

**Labels.**
- YouTube URL label "YouTube channel link or channel ID"; hint "A channel link, video link, @handle or channel ID (starts with UC)".
- The label stays inside the existing ternary at :1645-1653 with no `}` in it and keeps the 'Page URL' branch and `htmlFor="fm-url"` (slice15 test_url_label_uses_generic_scrape_specific_text). The fm-url `placeholder={…}` ternary (:1660-1670) stays the first `placeholder={` in FeedManager.tsx with the generic_scrape value `'https://example.com'`.
- `friendlyTestError('invalid_url', raw)` returns the mapped plain message (section 6 table) or `raw` for resolver messages, without the "Invalid URL —" prefix.

**AutoFeedBlock** (FeedManager.tsx:1150-1294; it now receives `sources` from AddCustomTab) classifies the paste before calling anything:
- YouTube host, bare UC id or `@handle`: `api.autoAddSource(url, resolveDefault('video'))`.
- `r/x` or reddit.com/r/…: new prop `onPrefill('reddit', url)`. AddCustomTab sets the type and URL and scrolls the form into view.
- podcasts.apple.com: `onPrefill('podcast', url)`.
- Anything else: `api.autoAddSource(url, resolveDefault('other'))` (today's default, api.ts:409).
- `resolveDefault(x)` is `resolveNewCategory(x, existing, CATEGORY_OPTIONS, categoryLabel)`, so an existing "Video" or "Other" spelling is reused instead of making a second column.
- Success: when the returned source id was already in `sources`, toast "Already added: <label>"; otherwise "Added <label> to <categoryLabel(category)>". PR6 adds an Edit action.
- All errors, from autoAdd (:1227-1229) and trackAnyway (:1197-1199), go to `setAutoMessage({ kind: 'err', text })`.
- Keep the literal "couldn't find a feed" in the error text and the `autoMessage.kind === 'err'` gate before "Track this URL anyway" (slice15 :240-255). New text: "Popping couldn't find a feed or a page list at that address."
- Keep trackAnyway's shape (slice15 :262-303): `const trackAnyway = async () => {` at two-space indent, closing with `\n  }\n`, containing `api.createSource`, `type: 'generic_scrape'`, `setAutoUrl('')`, `setAutoMessage(null)`, `onAdded()` and the five slug operations. It now also sends `refresh_interval_seconds: 7200` and the resolved category.

**api.ts** (PR3): the `autoAddSource` return `kind` union gains `'youtube_channel'`.

### Offline tests (PR1, backend/tests/test_youtube.py)

**Fixtures:**
- Autouse: set `app.youtube._TRANSPORT` to an `httpx.MockTransport` whose default handler increments a counter and calls `pytest.fail(f"unexpected network call {request.url}")`. Tests assert the counter as well as the outcome.
- `fake_dns`: monkeypatch `app.url_safety.socket.getaddrinfo`. The patch is process-wide (url_safety.py:150 uses the shared socket module, and asyncpg resolves `POSTGRES_HOST=localhost` through it, build.yml:71), so:
  - map youtube.com, www.youtube.com, m.youtube.com, music.youtube.com, consent.youtube.com and example.org to public addresses (142.250.0.1; 93.184.215.14 for example.org), and evil.internal to 10.0.0.5;
  - delegate every other host to the saved original `socket.getaddrinfo`;
  - the real `check_url_safe` and `ssrf_event_hook` run; never stub them.
- Use `fake_dns` only in tests that stub every fetch. A route test that would reach `fetch_rss` for a resolved youtube feed monkeypatches `app.sources.rss.fetch_rss`.
- Tests 4-11 and 13, and every route test that resolves or validates a youtube.com URL, use `fake_dns`. The container has no DNS and section 13 step 4 adds no YouTube hosts to /etc/hosts, so without it those tests get the unreachable message locally while passing in CI.
- `fake_dns` yields its host map, so a single test can add an entry (test 15's reddit case maps www.reddit.com to 10.0.0.5).

**Tests:**
1. Rows 1-8 and 15-16 make zero handler calls: a bare id with spaces; a feed link with `&foo=1`; `/CHANNEL/UC…`; `studio.youtube.com/channel/UC…`; `playlist?list=UU…` → `channel_id=UC…`; `list=WL` → playlist error; the home page and `/results?search_query=x` → not-a-channel error; `/channel/UC…abc` (25 characters) → not-a-channel error; `youtube.com.evil.example` and `youtube.com@127.0.0.1/` → not treated as YouTube.
2. `channel_id_from_html`: one snippet per marker; the canonical link beats a different `"channelId"`; a watch page whose title contains braces and whose first generic `"channelId"` is another channel resolves through the videoDetails window; `externalChannelId`; a page with only `"browseId"` returns None.
3. `is_blocked_page`: true for consent hosts, accounts.google.com, google.com `/sorry/`, a 429, and each body phrase (including the `’` form); false for a normal page and for "Sign in to confirm your age". An age-gated watch page carrying videoDetails resolves.
4. `@handle?si=abc` lookup: the request URL has no `si`; User-Agent contains "Safari"; Accept-Language is present; the `cookie` header contains `SOCS=CAI` on the first request **and** on a redirected hop (the handler answers 301 from youtube.com to www.youtube.com).
5. A 302 to `https://consent.youtube.com/m?…` raises `YouTubeBlockedError`; the message contains "channel ID" and no "http".
6. `/user/NAME` blocked: with `app.sources.rss.fetch_rss` monkeypatched to `[{"title": "x"}]` the result is `…feeds/videos.xml?user=NAME`; with `[]` it raises `YouTubeBlockedError`; with a stub that raises `ValueError` it raises `YouTubeBlockedError` (not a 500) and logs `fallback:user_failed`.
7. 404 raises the not-found message.
8. Redirects to `http://127.0.0.1/admin` and to `http://evil.internal/` raise the unreachable message; it contains no IP address and no "denied"; the handler never sees those hosts.
9. A redirect to `https://example.org/` raises the unexpected-host message, and no marker in that body is read.
10. A 5 MB body with the marker after byte 3,000,000 gives the no-marker error (the implementation slices the buffer).
11. `@ゆっくり実況`: the request path is percent-encoded; `youtube_source_slug` falls back to `channel_<id6>_yt`.
12. `_client()` with `_TRANSPORT = None` and `HTTPS_PROXY` monkeypatched has a proxy mount for `https://` (httpx `_mounts`), so the egress guard cannot be bypassed silently.
13. `caplog` around a lookup: the `youtube: lookup` line has no `?` and no `si=`.
14. Rewrite `test_resolve_channel_feed_url_raises_for_nonexistent_handle` (:115-121) and the route tests at :125-133 and :164-177 to use a mocked 404 instead of the live network.
15. Route tests (DB):
    - POST /api/sources/test, `type=youtube_channel`, mocked consent page (with `fake_dns`): `ok False`, `error_kind 'invalid_url'`, error contains "channel ID";
    - POST /api/sources with a bare id (with `fake_dns`): 200, stored url is the feed URL; the same POST again: 409 containing "already follow";
    - POST /api/sources/auto with `https://www.youtube.com/@somehandle`, `app.routes.sources.resolve_channel_feed_url` monkeypatched and `fake_dns` on (`_validate_url(feed_url)` runs `check_url_safe` on www.youtube.com): a row with type youtube_channel, name `somehandle_yt`, refresh 21600, `kind == "youtube_channel"`; a second identical call returns the same id and creates no `somehandle_yt_2`;
    - /auto with a playlist link (with `fake_dns`; `_validate_url(feed_url)` runs `check_url_safe` on www.youtube.com): name `playlist_<id6>_yt`;
    - POST /api/sources/test with `custom_headers={"Cookie": "x"}`: `error_kind 'invalid_headers'`;
    - POST /api/sources/test, type rss, `http://127.0.0.1/feed`: `error_kind 'invalid_url'`; the error contains no IP address and no "denied" (it is `_validate_url`'s generic detail from :943, which the frontend maps to "That address isn't reachable from Popping.");
    - POST /api/sources/test, type reddit, `r/python`, with `fake_dns` mapping www.reddit.com to 10.0.0.5 in that test: the :957-964 branch answers, and `error` equals "That address isn't reachable from Popping.".
16. Keep test_youtube.py:47-109, :136-158 and :180-192 as they are.

## 4. Text that overflows rows and boxes

### Root causes (measured at 390×844@3 and 320×568@2 in Chromium with iPhone emulation)

- **R1. A flexible text child without `min-w-0` next to fixed or `shrink-0` siblings:** the search pill `w-44` (App.tsx:2231); the Auto-add input `flex-1` without `min-w-0` (FeedManager.tsx:1257), which pushes the Settings body to scrollWidth 369 at 320; five `shrink-0` chips on the feed name line (FeedManager.tsx:712-781).
- **R2. No shared gutter.** The Feeds tab wrapper is `pt-4` (Settings.tsx:265) while every other tab is `pt-4 px-4` (:275, :331, :401); SourceRow adds its own `px-3` (FeedManager.tsx:685).
- **R3. Rows of controls that do not wrap,** so each control wraps inside itself: Card meta row (Card.tsx:956-964) and action rows (:978, :1052, :1122).
- **R4. Fixed widths sized for 390+:** the `w-28` thumbnail (Card.tsx:1734) beside a headline on a 250-330px card.
- **R5. Controls authored at 13px and forced to 16px by `!important`** (styles.css:22-26). Line heights mismatch and the cause is hidden.
- **R6. Hand-rolled sub-11px sizes:** Card.tsx:1174 (9px), FramingWatch.tsx:81 (10px) and :111 (9px), App.tsx:2709 (10px), FeedManager.tsx:1114 (10px), SourceIcon.tsx:68 (9px). Card.tsx:1171 and FramingWatch.tsx:106 are already 11px.
- **R7. Header crowding:** a 34px title and four 44px buttons (App.tsx:2220-2334).
- **R8. `body { overflow-wrap: break-word }`** (styles.css:39) does not lower the min-content size of flex and grid items, so a long unbroken token still widens its row.
- **R9. Inline `minHeight: '100dvh'`** (App.tsx:2188) on top of `html, body, #root { height: 100% }` and `#root { padding-bottom: env(safe-area-inset-bottom) }` (styles.css:17, :20). In standalone mode on a Face ID iPhone the document gets a 34px vertical scroll range and the whole UI, header included, can be dragged. `overscroll-behavior` would only hide that.
- **R10. 320 is the design floor.** Page Zoom 125% turns a 390 phone into about 312 CSS px. Larger Text and Dynamic Type do not scale px web text (non-goal).
- `html, body { overflow-x: clip }` (styles.css:36) stays as a last-resort net. Because it hides page overflow from the owner, the guard measures `body` and `#root`, never `html`.

### Fixes in PR2 (class and CSS changes plus five one-line JS fixes)

**Search row** (App.tsx:2220-2334, R1, R7):
- h1 (:2221) gets `${searchOpen ? 'hidden sm:block' : ''}`.
- The cluster div (:2224) gets `${searchOpen ? 'flex-1 min-w-0 justify-end sm:flex-none' : ''}`.
- The pill (:2231) becomes `flex-1 min-w-0 sm:flex-none sm:w-72`.
- The phone refresh button (:2289-2297) is not rendered while `searchOpen`.
- The clear ✕ (:2250-2261) becomes `w-11 h-11 -mr-3 flex items-center justify-center shrink-0`; keep `onMouseDown={(e) => e.preventDefault()}`.
- The input (:2233-2248) becomes `type="text" inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}`, keeps `text-ios-body`, and gets `onKeyDown` Enter → `e.currentTarget.blur()` (dismisses the iOS keyboard, keeps the query). This also removes the second, native clear button.
- Same commit, App.tsx:1762: test `ae instanceof HTMLInputElement && ae.id === 'app-search'` instead of `ae.type === 'search'`, and on Esc also `setSearchOpen(false)`.
- App.tsx:1769-1772: `/` calls `setSearchOpen(true)` then `requestAnimationFrame(() => document.getElementById('app-search')?.focus())`; today it does nothing while search is collapsed.

**Card meta row** (Card.tsx:956-964): source span `min-w-0 truncate`; dot and `<time>` `shrink-0 whitespace-nowrap`.

**Card action rows** (Card.tsx:978, :1052, :1122):
- Each row becomes `flex flex-wrap items-center gap-x-4 gap-y-2`, and consecutive rows use `mt-2` instead of `mt-1.5`, so the 44px hit boxes never overlap.
- Each action becomes `inline-flex items-center whitespace-nowrap min-h-[44px] -my-2`.
- Keep `data-card-interactive` and the stopPropagation handlers.

**Card thumbnail** (R4) uses arbitrary container-query utilities on the elements, not `@layer components` rules (Tailwind 3.4 emits components before utilities, so `.w-28` and `.aspect-video` would win at equal specificity):
- article (Card.tsx:890): add `max-md:[container-type:inline-size]`;
- title row (:905): `items-center` becomes `items-start md:items-center`, plus `[@container(max-width:299px)]:flex-col`;
- thumbnail wrapper (:946, today an unclassed `shrink-0` div): add `[@container(max-width:299px)]:w-full [@container(max-width:299px)]:self-stretch` (without it a `width:100%` child of a shrink-to-fit parent measured 20px);
- Thumbnail (:1734): add `[@container(max-width:379px)]:w-[72px] [@container(max-width:379px)]:aspect-square [@container(max-width:299px)]:w-full [@container(max-width:299px)]:aspect-video`.
- iOS 15 and older keep today's look. md and up are unaffected.

**Text sizes** (R6): Card.tsx:1174, FramingWatch.tsx:81 and :111, App.tsx:2709 and FeedManager.tsx:1114 become `text-[11px]`. SourceIcon.tsx:68 (the decorative letter inside an 18px icon) stays 9px with `aria-hidden` and the only allowed `// eslint-disable-next-line no-restricted-syntax -- decorative letter`.

**Settings header** (Settings.tsx:211-222): h2 first, `min-w-0 flex-1 truncate`, always "Settings"; Done second (trailing edge), `shrink-0 min-h-[44px] min-w-[44px] px-2 text-ios-body font-semibold text-accent`, keeping `aria-label="close settings"`.

**Settings gutter:** Settings.tsx:265 becomes `pt-4 px-4`, and the SourceRow wrapper (FeedManager.tsx:685) drops `px-3`, so rows, pills and inputs share one 16px gutter.

**Settings tab pills** (Settings.tsx:248): `min-h-[44px]`; the strip (:228) gets `data-hscroll`.

**Scrollers:** `overscroll-contain` on Settings.tsx:263, Drawer.tsx:334, Column.tsx:489, App.tsx:2437, :2490, :2721, SearchResults.tsx:78 and ShortcutsSheet.tsx:79. Add `html, body { overscroll-behavior-y: none; }` to styles.css `@layer base`. Guard C4 asserts it on every vertical scroller.

**Horizontal strips** get `data-hscroll`: App.tsx:226 (preset strip), :2369 (filter chips), :2671 (phone tabs), Settings.tsx:228.

**Drawer header** (Drawer.tsx:314-325): title "Menu" first, `min-w-0 flex-1`, carrying the grabber clearance (`pl-10 md:pl-0`, moved off Done); Done trailing, `min-h-[44px] min-w-[44px]`, keeping `aria-label="close menu"`. Rewrite the stale comments at :266-273 and :307-313.

**FeedManager TabButton** (FeedManager.tsx:264-287): `flex-1 min-w-0 min-h-[44px] px-1.5 rounded-ios text-ios-body whitespace-nowrap truncate`. Labels "My feeds", "Suggested", "Add" (17px fits 3 pills of about 92px at 320; "My feeds (14)" does not). FeedManager.tsx:1095 says "the Add tab".

**Auto feed row** (FeedManager.tsx:1244-1266): input `flex-1 min-w-0 min-h-[44px] px-3 text-ios-body`, `type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"`; placeholder literal unchanged. Button `min-h-[44px] shrink-0`.

**Feed rows** (FeedManager.tsx:695-786): move the auto-disabled, paused, ⚠ and vote-score chips to the caption line (:783-787, now always shown, `flex flex-wrap`). The category chip and the caption become `text-ios-caption`.

**Toast** (Toast.tsx):
- :122 `truncate` becomes `line-clamp-3 break-words`;
- :93 durations: info 3000 ms, error 5000 ms, with an action 5000 ms;
- :117 `z-50` becomes `z-[60]`, so the toast sits above Settings regardless of DOM order;
- the bottom offset follows the keyboard: inline `` style={{ bottom: `calc(1.5rem + env(safe-area-inset-bottom) + ${kbInset}px)` }} `` from `useVisualViewport()` (new frontend/src/lib/visualViewport.ts).

**lib/visualViewport.ts** (new): `useVisualViewport(): { height, offsetTop, kbInset, keyboardOpen }`, rAF-throttled on visualViewport `resize` and `scroll`. `kbInset = max(0, round(documentElement.clientHeight - vv.height - vv.offsetTop))`; `keyboardOpen = clientHeight - vv.height > 120`. Without visualViewport it returns zeros. Also `useMediaQuery(query): boolean` (used in PR10).

**BriefCard** (BriefCard.tsx):
- first-run header (:562): add `flex-wrap`, and wrap TonePicker and Generate (:578-590) in `<div className="flex items-center gap-2 basis-full sm:basis-auto">` with Generate `ml-auto`. A plain wrap would crush the `flex-1 min-w-0` text block (:570) to about 13px.
- tone pills (:312) and Generate/Regenerate (:543, :651, :724): `min-h-[44px]`.

**SearchResults header** (SearchResults.tsx:66-76): h2 `shrink-0 whitespace-nowrap`; the count span `min-w-0 truncate`.

**styles.css:**
- :39 becomes `body { overflow-wrap: break-word; overflow-wrap: anywhere; }` (the first line is the fallback for Safari before 15.4).
- `@layer components` gains `.select-ios { appearance: none; -webkit-appearance: none; background: url("data:image/svg+xml,…chevron…") no-repeat right 0.75rem center / 12px; }`. Padding comes from `pl-3 pr-8` in markup, because utilities beat component classes.

**Root-cause one-liners:**
- App.tsx:2188: remove `minHeight: '100dvh'` (keep `backgroundColor`); update the comment at :2180-2187. Guard C2b.
- Card.tsx:513: `el.style.transition = animate ? 'transform 180ms ease-out' : 'none'`. Today `''` lets the class's 200ms transition (Card.tsx:893) make the card trail the finger.
- frontend/tailwind.config.js: add `future: { hoverOnlyWhenSupported: true }`, so hover styles stop sticking after a tap (Card.tsx:891, :919, :1745 and about 14 others); fix the stale sheetUp comment (:93-96 says the Drawer uses it).
- App.tsx:2401: `z-15` (not a Tailwind class, so the banner has no z-index) becomes `z-10`.

### Later PRs

- PR4 and PR6 build the Add form and the editor at 17px and 44px from the start.
- PR5 removes the gear and fixes the title (section 9): h1 `shrink-0 whitespace-nowrap` instead of `truncate`, plus `max-[359px]:text-[28px] max-[359px]:leading-[34px]`. With the gear gone the row has 148px at 320 and 140px at 312, which is exactly what the 34px title needs; the smaller size below 360 gives a margin.
- PR7 and PR8 move every remaining control to 16px or more **by design**; PR9 deletes the `!important` rule:

| Control | Change | PR |
|---|---|---|
| App.tsx:2233 (search) | done in PR2 | 2 |
| FeedManager.tsx Add form (:1532-1745), interval select (:825) | rebuilt at 17px | 4, 6 |
| Column.tsx:418-428 sort, :462-477 max age | `min-h-[44px] text-ios-body select-ios pl-3 pr-8` | 7 |
| LoginPage.tsx:72, :84 | already 44px and `text-ios-body`; add the iOS attributes | 7 |
| Settings.tsx:776, :796, :804, :812, :847, :855 (provider and model) and :897 (API keys) | `min-h-[44px] text-ios-body`, selects `select-ios pl-3 pr-8`, inputs `px-3` | 8 |
| Preset rename and Save-current-view fields | built at 17px | 9 |
| Checkboxes, radios, range (Drawer.tsx:463, FeedManager.tsx:1557-1638, Column.tsx:434) | exempt: no text | — |

Then, in PR9:
- delete styles.css:22-26 (the comment and the `@media (pointer: coarse)` rule);
- add to `@layer base`: `input, select, textarea { font-size: 17px; line-height: 22px; }` (non-important; utilities still override);
- run the guard with `--strict`.

### The guard: frontend/scripts/iphone-audit/smoke.cjs (new, CommonJS, PR2)

**Step 0 of PR2:** `git checkout origin/claude/redesign-plan -- frontend/scripts/iphone-audit`. The audit scripts are not on main (`git ls-tree -r origin/main frontend/scripts/` lists only check-html-comments.mjs). Bring nothing else from the plan branch.

**Usage:** `node smoke.cjs <base> [--csp] [--strict] [--browser chromium|webkit] [--out <dir>] [--only <state>]`. smoke.cjs never sets `PLAYWRIGHT_BROWSERS_PATH`; the caller does (locally `/opt/pw-browsers`; CI uses Playwright's default).

**Setup:**
- Reuse `mockApi` and `IOS_UA` from capture.cjs (exported at :560). Change capture.cjs in PR2:
  - anchor the route on the pathname: `context.route((u) => /^\/(api|auth|assets)\//.test(new URL(u).pathname), …)` (today a regex on the whole URL, :52-53);
  - `mockApi(context, { onUnmocked })`: call the callback where `'  !! UNMOCKED …'` is pushed (:163), so C8 can fail on it;
  - per-context state: deep-copy `F.SOURCES` and `F.ENTRIES` per `mockApi` call; PATCH and DELETE mutate the copy and GET reads it (today PATCH echoes `{...src, ...body}` at :93-95 while GET always returns `F.SOURCES`).
- Fixtures (fixtures.cjs). Present already: `LONG_SOURCE_NAME`/`LONG_SOURCE_URL` with a long User-Agent header (id 3), rfd_hot_deals (id 5), reddit (id 7), paused krebs (id 10), auto-disabled risky_business_podcast (id 12), youtube_channel (ids 13, 14). Add only:
  - a generic_scrape source with `sitemap_url` and `link_pattern`;
  - a 300-character `last_error` on the auto-disabled row (id 12);
  - a 40-character category;
  - `last_error: "[blocked] HTTPStatusError: Client error '403 Forbidden' for url 'https://www.theverge.com/rss/index.xml'"`, `error_count: 2` on the_verge (id 4, custom rss, no User-Agent);
  - category `nhl` with exactly one rss source that has 3 entries;
  - a custom rss source with `custom_headers: { 'Bad Header': 'x' }`;
  - a 60-character search query constant and a 90-character unbroken title token if missing.
- Fresh browser context per state per width; no `setViewportSize` (long sessions gave false `pointer: coarse` readings).
- Contexts: 390×844@3 and 320×568@2, `isMobile`, `hasTouch`, `IOS_UA`, `colorScheme: 'dark'`, `clock.setFixedTime(F.NOW)` (flow FN uses `clock.install` instead).
- WebKit mode: `devices['iPhone 13']` with the viewport set explicitly to 390×844 (the descriptor is 390×664), and 320×568.
- Per state: goto, wait for `main.md\:hidden article[data-card-id]` (or the state's own selector), run the setup, wait 400 ms, run the checks, take a screenshot into `--out`.
- Output: every failure is printed in full (width, state, rule, selector path, rect, text), and, when `GITHUB_ACTIONS` is set, also as a `::error::` line, because CI screenshots cannot be retrieved and annotations stay readable when raw logs are not (the same pattern as build.yml:76-99). Exit 1 on any failure.

**States** (each PR adds its own):
- PR2: dashboard; card summary open; search open with "x"; search with the 60-character query (results header); Menu open; Settings → Feeds; Settings → Add with YouTube selected and long text; AI tab; Notifications, History, Hidden, Saved, Downvoted, Reset (one each, via `?view=settings&tab=`); the phone Brief tab with no brief (route `/api/brief/latest` to `[]`) at 320.
- PR4: the Add form in New-category mode with 45 characters typed, at 320; the Add form with the headers section open, two rows, one invalid.
- PR5: Menu at 320 with the › buttons; dashboard and Menu at 312×676@2 (Page Zoom 125%).
- PR6: the editor via `?view=settings&tab=feeds&source=<id>` for the custom row with headers, the built-in bbc_news, the auto-disabled row, the generic_scrape row, the_verge (blocked), the legacy-header row; the editor in New-category mode with 45 characters.
- PR7: the column ⋯ popover; the login page (mock `/auth/me` 401 and `/auth/local/availability` `{ enabled: true }`).

**Checks.**

| Rule | Check | From |
|---|---|---|
| C1 harness | `matchMedia('(pointer: coarse)').matches` is true | PR2 |
| C2 page width | `document.body.scrollWidth` and `#root.scrollWidth` ≤ innerWidth. `html` alone misses overflow because of `overflow-x: clip` (styles.css:36). | PR2 |
| C2b page height | In the dashboard state at both widths, inject `#root{padding-bottom:34px}` (Chromium's `env()` is 0) and assert `document.scrollingElement.scrollHeight ≤ innerHeight + 1`. | PR2 |
| C3 viewport escape | Every visible element (has rects, not `visibility:hidden`, opacity > 0, not inside `[inert]` or `[aria-hidden="true"]`, not inside a closed Drawer whose aside starts at or beyond innerWidth) has `left ≥ -1` and `right ≤ innerWidth + 1`. Skip only descendants of `[data-hscroll]`, never `overflow-x:auto/hidden` ancestors in general. | PR2 |
| C4 vertical scrollers | Every visible element with computed `overflow-y` auto or scroll has `scrollWidth ≤ clientWidth + 1` (unless `data-hscroll`) and computed `overscroll-behavior-y: contain`. Catches the Settings body at 369/320 that C2 and C3 miss. | PR2 |
| C5 clipped text | For every non-whitespace text node, each `Range.getClientRects()` rect's **left and right** lie inside its nearest ancestor whose `overflow-x` is not visible (or the viewport). Exceptions: an ancestor up to that clipper has `text-overflow: ellipsis` or `-webkit-line-clamp`; a `data-hscroll` strip is in between; the clipper's rect is ≤ 1px wide or tall, or its computed `clip` is `rect(0px, 0px, 0px, 0px)` (sr-only, e.g. FeedManager.tsx:1555). | PR2 |
| C6 field font | Delete the coarse-pointer rule through CSSOM (find the `CSSMediaRule` whose `conditionText` includes `pointer: coarse`, then `deleteRule`). Every visible input (not checkbox, radio or range), select and textarea must then compute ≥ 16px. Warn-only until `--strict`; after PR9 the rule no longer exists. | warn PR2, strict PR9 |
| C7 tap targets | Inside `[role="dialog"]`, `aside[aria-label="menu"]`, `header`, `[role="tablist"]`, `[role="status"] button` (and `main.md\:hidden article` from PR7): every visible `button`, `a[href]`, `select`, `[role=button\|tab\|switch]` is ≥ 43.5px tall, and ≥ 43.5px wide when it has no text. Checkboxes and radios are measured on `closest('label')`. Skip descendants of `[data-tap-exempt]` (article prose). | warn PR2, strict PR9 |
| C8 runtime | Fail on any `pageerror`; any console error except the known `/auth/me` 404, matched by `new URL(msg.location().url).pathname === '/auth/me'` (Chromium's text has no URL); any `onUnmocked` call; any `page.on('dialog')` event, whose handler records the failure and calls `dialog.dismiss()` so the page does not hang. | PR2 |
| C9 CSP (`--csp`, chromium only) | `page.route('**/*', …)`: for `request().resourceType() === 'document'` do `const response = await route.fetch(); await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } })`; otherwise `route.fallback()` so `mockApi` still answers. CSP is read from frontend/nginx.conf.template with one regex over the whole file (`/Content-Security-Policy "([^"]+)"/`); exit 1 if it is missing. Fail on any console "Refused to". | PR2 |
| C10 no Save | No visible button whose accessible name matches `/^save$/i` inside `[role=dialog][aria-label=settings]`. | PR8 |
| C11 one line | For every visible text node inside `button`, `a`, `[role=tab]`, `time`, or an element marked `data-one-line`, the distinct tops of `Range.getClientRects()` number 1. Catches "12m / ago", mid-phrase action wraps, the two-line Settings header and two-line pills. | PR2 |
| C12 gutter | Inside `main.md\:hidden`, `[role=dialog][aria-label=settings]` and `aside[aria-label=menu]`: every visible text rect and every input, select and button rect has `left ≥ 8` and `right ≤ innerWidth - 8`, unless an ancestor has `data-bleed` or `data-hscroll`. Catches the Feeds tab, which passes C3's `left ≥ -1`. | PR2 |
| C13 measure | A headline anchor (`article a[aria-label="open in new tab"]`) narrower than 55% of its article's content box, or any text block taller than 8 lines while narrower than 160px, fails. Catches the thumbnail ribbon. | PR2 |
| C14 ellipsis floor | An element with computed `text-overflow: ellipsis` whose `clientWidth < min(96, scrollWidth)` fails. Catches feed names squeezed by chips and the Menu › regression. | PR2 |
| C15 no native search | No visible `input[type=search]` (its native clear button is invisible to DOM checks). | PR2 |
| C16 title fits | On the dashboard at 320 and 312: the h1 has `scrollWidth ≤ clientWidth`. | PR5 |

**Behaviour flows** live in `flows.cjs` (new in PR4), required by smoke.cjs. They count `page.on('request')` events with `method() === 'PATCH'` (or `'PUT'` for the AI tab). Section 12 lists them per PR.

**Fix existing scripts in PR2:**
- run.sh:13-15: start `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &` so `$!` is the server and the trap kills it; keep run.sh's own `PLAYWRIGHT_BROWSERS_PATH` export (it is the local-only wrapper).
- README.md in the folder: document smoke.cjs and flows.cjs.
- capture.cjs and probe.cjs selectors are updated in PR5 when the UI changes: `open settings` becomes Menu → Settings; probe.cjs:27 and :37 `header > div.flex` are rechecked; in PR6 `edit refresh interval`, `` edit ${name} `` and the textarea go away.

### Lint bans (frontend/eslint.config.js; core rules only, no new dependency)

Add a block with `files: MOBILE_SCOPE`, all errors (selectors verified with ESLint 10 and typescript-eslint in this repo):
```js
const ban = (re, message) => [
  { selector: `Literal[value=${re}]`, message },
  { selector: `TemplateElement[value.raw=${re}]`, message },
]
// rules:
'no-restricted-syntax': ['error',
  { selector: "JSXOpeningElement[name.name='datalist']", message: 'iOS Safari never shows a datalist. Use CategoryPicker or a select.' },
  ...ban('/\\btext-\\[(?:[0-9]|10)px\\]/', 'Text under 11px is unreadable on a phone. Use text-[11px] or text-ios-caption.'),
  ...ban('/\\bmin-h-\\[(?:[0-9]|[1-3][0-9]|4[0-3])px\\]/', 'Tap targets need min-h-[44px].'),
  ...ban('/\\b(?:min-|max-)?h-screen\\b|\\d+vh\\]/', 'vh overshoots on iOS Safari. Use dvh or the height:100% chain.'),
  { selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value='mousedown']", message: 'iOS sends no mousedown for taps on empty space. Use pointerdown.' },
  { selector: 'JSXText[value=/\\\\u[0-9a-fA-F]{4}/]', message: 'JSX text does not process \\u escapes. Type the character itself.' },
],
'no-restricted-globals': ['error', 'prompt', 'confirm', 'alert'],
'no-restricted-properties': ['error',
  { object: 'window', property: 'prompt' }, { object: 'window', property: 'confirm' }, { object: 'window', property: 'alert' }],
'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
```

`MOBILE_SCOPE` grows as files are cleaned:
- PR2: `src/components/{Card,Toast,BriefCard,FramingWatch,SourceIcon,SearchResults}.tsx`
- PR3: adds `src/lib/**`
- PR4: adds `src/components/feeds/**`
- PR5: adds `Drawer.tsx`, `Hamburger.tsx`
- PR6: adds `FeedManager.tsx`
- PR7: adds `Column.tsx`, `ShortcutsSheet.tsx`, `LoginPage.tsx`
- PR8: adds `Settings.tsx`
- PR9: the dialog and eval bans (`no-restricted-globals`, `no-restricted-properties`, `no-eval`, `no-implied-eval`, `no-new-func`) apply to all `src/**/*.{ts,tsx}`; the size, vh, mousedown, datalist and JSXText bans apply to `src/**/*.{ts,tsx}` with `ignores: ['src/App.tsx']`. App.tsx's phone-visible sizes are fixed by hand (PR2, PR7); its desktop-only sub-row buttons (App.tsx:2351, :2358) are out of scope.

The only allowed disable is SourceIcon.tsx:68, with a reason. ESLint 10 reports an unused disable as a warning, so add no others. Lint must end with 0 errors and at most the 6 baseline warnings.

### CI (.github/workflows/build.yml, `frontend-checks` only)

PR2 changes the job to:
```yaml
  frontend-checks:
    name: frontend lint + build
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      # tsc + vite build
      - run: npm run build
      - name: Install Playwright (not saved)
        run: |
          npm install --no-save --no-audit --no-fund --ignore-scripts playwright@1.56.1
          git diff --exit-code package.json package-lock.json
          npx playwright install --with-deps chromium webkit
      - name: Start preview
        run: |
          nohup ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort > /tmp/preview.log 2>&1 &
          for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && exit 0; sleep 0.5; done
          cat /tmp/preview.log; exit 1
      - name: iPhone layout smoke test
        run: node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp
      - name: iPhone layout smoke test (Safari engine, report only)
        continue-on-error: true
        run: node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --browser webkit
```
- Background processes started in one step keep running into later steps of the same job on GitHub-hosted runners; separate steps are fine.
- PR3 inserts, after "Start preview": `- name: Unit tests` / `run: node --experimental-strip-types --test 'scripts/unit/*.test.ts'`. The quoted glob is required: a directory argument fails on Node 22.22 with "Cannot find module …/scripts/unit".
- PR9 adds `--strict` to the Chromium command. The WebKit step stays report-only: WebKit on Linux is not iOS Safari, and making it blocking adds supply-chain surface for little signal.
- `--no-save` plus the `git diff --exit-code` line prove package.json, the lockfile, the Docker build stage and dependabot stay untouched.

## 5. What you will see on the phone

**Top bar (every phone width):** the "Popping" title, Search, Refresh (phones only, as today) and one Menu button (≡). The gear is gone (PR5). While searching, the title and Refresh hide and the field takes the width; the keyboard's Search key closes the keyboard and keeps the results (PR2).

**Menu** (the right-hand panel; title "Menu" on the left, Done on the right at 44px):
- **First group** (no label):
  1. **Settings**: subtitle "Feeds, AI, history, saved". Opens Settings on Feeds.
  2. **Save current view**: from PR9 tapping it turns the row into a name field with the keyboard up; Return or Save keeps it. `window.prompt` until then.
- The separate "History" row is removed: History is a Settings tab, and two routes into Settings are the duplication the owner described.
- **Jump to column:** switches the phone's tab and scrolls that tab into view; clears an open search first (PR5).
- **Sources:** each row keeps the filter checkbox and gains a 44px › button that opens that feed's editor (PR5). On phones the row hides its category text so names keep about 117px at 320.
- A drag to the right (the way the panel slides out) also closes the Menu.

**F1. Change a feed's category** (today: gear → row → edit → field → type the exact spelling → save):
1. Tap ≡.
2. Tap › beside "The Verge". The Menu closes; Settings opens on Feeds with The Verge's editor open and scrolled into view.
3. Tap **Category**. iOS shows the list: "Your categories" (Deals, News, NHL…), then "Suggestions".
4. Pick "Tech". The label row shows "Saving…", then "Saved ✓" for 1.5 s. The feed's stories move to the Tech column. The phone stays on the tab you had open.
5. Done (top right) or Esc closes Settings.

Result: 4 taps, no typing, no Save. One tap fewer from a card (F11).

**F2. New category.** Steps 1-2, then:
- Tap **New category** (a 44px button under the category list). A field appears with the keyboard up (capital letters at the start of words, no autocorrect). Placeholder "e.g. Hockey".
- Type "Hockey". The line under it reads "Shows as “Hockey”".
- Tap Return or **Add**. It saves as typed: "Hockey".
- Typing "news" or "NEWS" when "News" exists reads "Using your existing “News” category" and saves "News". Typing "Tech" when nobody uses Tech yet saves the suggested "tech", so the cards keep the Tech colour.
- "Saved", "For You", "for_you" or more than 40 characters show an error under the field while typing; Add stays grey and nothing is sent.
- Tapping elsewhere or closing Settings does **not** save a half-typed name. **Cancel** puts the list back.

**F3. A site blocks the reader.** The editor's "Last problem" line reads "This site is refusing Popping (HTTP 403)." with **More** (the raw message) and a **Use a browser identity** button.
- Tap it: a User-Agent row appears and saves. Popping checks the feed again right away, and the line updates within about 15 s.
- Without a problem line: ≡ → › → **Headers** → **Use a browser identity**.

**F4. Pause:** ≡ → › → **Pause feed**. "Saved ✓". The button becomes **Resume feed** and the row name is struck through.

**F5. Check for new items:** ≡ → › → **Check for new items** → pick. Built-in feeds show "Checked every 5 min (built-in feed)" instead, because their schedule is fixed.

**F6. Delete:** ≡ → › → **Delete feed…**. The row becomes "Delete The Verge? This can't be undone. Pausing keeps it." with **Pause instead**, **Delete** and **Keep**, all 44px, with no timer. Delete → toast "Deleted The Verge" → the row and its stories disappear.

**F7. Rename or change the address.** Tap the field and edit. Return or tapping elsewhere saves.
- Spaces become underscores in names, and the hint previews the label.
- A refusal shows plain words under the field, for example "Another feed already uses this name." The text is kept, with **Undo**.
- No connection: one silent retry after 2 s, then "Couldn't reach Popping. Check your connection." with **Try again**.
- After 8 s a slow save reads "Still saving…". After 35 s it gives up with "That took too long. Try again."
- When Popping rewrites the address (a subreddit, a YouTube or Apple link), the field shows the saved form: "Saved as the channel's feed link".

**F8. Close mid-save.** Type a new address and tap Done at once.
- The field saves as it loses focus, and Settings closes immediately.
- The dashboard updates when the save lands.
- If it fails, a red toast on the dashboard says "Couldn't save the address for The Verge: <reason>" with **Open**, which reopens the editor with your text and the reason.
- Switching apps mid-edit also saves.

**F9. Through Settings:** ≡ → **Settings** (opens on Feeds) → tap a row → its editor.

**F10. Add a YouTube channel** (PR4):
- **Quick:** ≡ → Settings → **Add** → paste a channel link, video link, @handle or channel ID into **Auto feed** → **Auto-add** (or the keyboard's Go). Toast "Added Mkbhd (YouTube) to Video". Pasting one you already follow reads "Already added: Mkbhd (YouTube)".
- **Form:** tap **YouTube**, paste, leave Name blank ("Will be saved as: mkbhd_yt", or "Name is chosen after Test." for a video link) → **Test** ("✓ Looks good — 15 items found" and "Resolved to the real feed: …") → **Add feed**. Add reuses the resolved link.
- **Failure:** a red box above the buttons explains it, for example "YouTube didn't let Popping look this channel up. Paste the channel ID instead: …".

**F11. One tap to a feed** (PR6): tap the source name under any card ("The Verge · 12m ago"). Settings opens on that feed's editor.

**F12. AI settings** (PR8): ≡ → Settings → AI.
- Provider and models are lists that save when picked. "Other…" reveals a field that saves when you leave it.
- Switching to a provider that needs a key shows its key field first; the switch saves once the key is saved.
- A key saves when you leave its field and then shows "Key saved". Leaving an empty key field changes nothing. Removing a key asks once, inline.
- There is no Edit button and no Save button.

| Task | Today | After |
|---|---|---|
| Open a given feed's editor | 3 (gear → row → edit) | 2 (≡ → ›); 1 from a card (PR6) |
| Change category | 5 + exact spelling | 4, no typing (3 from a card) |
| Browser identity on a blocked feed | 5 + JSON | 3 (≡ → › → Use a browser identity); 2 from a card |
| Pause | 3 | 3 |
| Check interval | 4 | 4 (built-ins show it, read-only) |
| Delete | 4 within 4 s | 4, no timer |
| Open Settings | 1 | 2 (the cost of one button) |
| History | 2 (≡ → History) | 3 (≡ → Settings → History) |

Desktop (md and up) keeps the 480px right-hand panel and the sub-row. Only the gear is removed; `,` opens Settings from a keyboard (PR5).

## 6. Feed editor that saves on its own

### Where things live

| File | Contents | PR |
|---|---|---|
| lib/feedRules.ts (new, no imports) | Moved from FeedManager.tsx:57-155: `REFRESH_PRESETS`, `PODCAST_DEFAULT_REFRESH`, `YOUTUBE_DEFAULT_REFRESH`, `KNOWN_BUILT_INS` (adds `'rfd_hot_deals'`; 7 names), `isBuiltIn(s: { name: string })`, `refreshLabel`, `timeAgo`, `isStale`. New: `normalizeFeedInput`, `suggestName`, `normalizeName`, `isYouTubeVideoLink`. Exporting these from FeedManager.tsx would add react-refresh warnings (verified) and make FeedEditor ↔ FeedManager imports circular. | 3 |
| lib/categories.ts (new, no imports) | `CATEGORY_OPTIONS` (moved from FeedManager.tsx:80-101), `CATEGORY_MAX`, `RESERVED_CATEGORIES`, `categoryOptions`, `resolveNewCategory` (section 7). | 3 |
| lib/headers.ts (new, no imports) | `HEADER_DENYLIST`, `HEADERS_MAX`, `HEADER_VALUE_MAX`, `HEADER_NAME_MAX`, `CANONICAL_HEADER_NAMES`, row validation, `rowsToMap`, `sameHeaders` (section 8). | 3 |
| lib/apiErrors.ts (new, no imports) | `parseApiError` and `friendlyTestError` moved from FeedManager.tsx:163-210; `errorMessage(err)`; `fieldSaveMessage(err, field, value)`; `lastErrorMessage(lastError)`; `isRetryable(err)`. Duck-typed on `{ name, status, detail }`. | 3 |
| lib/sourceSaves.ts (new, no imports) | The save store, plus `registerFlusher` / `flushEditors`. | 3 |
| lib/settingsTabs.ts (new) | `SETTINGS_TABS`, `SettingsTab` (an array constant exported from Settings.tsx adds a react-refresh warning, verified). | 5 |
| lib/visualViewport.ts (new) | `useVisualViewport`, `useMediaQuery`. | 2 |
| components/feeds/CategoryPicker.tsx (new) | Section 7. | 4 |
| components/feeds/HeadersEditor.tsx (new) | Section 8 (`local` mode in PR4, `autosave` mode in PR6). | 4, 6 |
| components/feeds/SaveStatus.tsx (new) | `SaveStatus({ state })` presentational; `useSaveState(id, field)` hook; `FieldError`. | 6 |
| components/feeds/FeedEditor.tsx (new) | The editor, mounted under an open row. | 6 |
| components/FeedManager.tsx | Keeps MyFeedsTab, the slimmed SourceRow, RecommendedTab ("Suggested"), AutoFeedBlock and AddCustomTab with every literal the guard tests pin. Loses (PR6) the old edit form (:439-682), the JSON parser, `saveEdit`, the re-seed effect, the "edit", "every X", "fetch", "save" and "cancel" links, the 4 s timer, `editingRowId` and `editingInterval`. **Rule: any new attribute in this file uses a string-literal `placeholder="…"`**, never `placeholder={…}`, because slice15 :212-230 reads the first `placeholder={`. | 4-6 |
| scripts/unit/*.test.ts (new) | `node --test` with type stripping; outside `src`, so tsc never sees `node:test`. Imports use explicit extensions (`../../src/lib/categories.ts`). Lib modules use erasable TypeScript only (no `enum`, `namespace` or parameter properties); tsconfig.json is off-limits, so this is a review rule. | 3 |

### SourceRow (slimmed, PR6)

- A header button `min-h-[44px] aria-expanded` holding the icon, the name (`min-w-0 truncate`), the category chip, the vote badge and the chevron.
- A caption line, always shown, `flex flex-wrap text-ios-caption`: "updated 4m ago · every 1 hour" plus the chips "paused", "stopped after 6 failed checks" or "⚠ 3" (PR2 already moved them there).
- `` <li id={`feed-${id}`}> `` (PR5).
- MyFeedsTab owns one `openRowId` (PR5). While a row is open, MyFeedsTab keeps the id order captured when it opened (new ids appended), so a poll after a rename or recategorise (server `ORDER BY category, name`, routes/sources.py:397) cannot move the row being edited.

### FeedEditor, top to bottom

`FeedEditor({ source, sources, onDeleted }: { source: Source; sources: Source[]; onDeleted(id: number): void })`. Every control is `min-h-[44px] text-ios-body`; labels are `text-ios-caption`; each label row is `flex justify-between` with `<SaveStatus>` on the right. Every button inside the editor (Undo, Try again, Add header, remove, presets, New category, Add, Cancel, Pause, Check now, Delete, More) has `onPointerDown={(e) => e.preventDefault()}`: WebKit does not focus a button on tap, so without it the field's blur fires first with a null `relatedTarget` and commits mid-edit.

1. **Last problem** (only when `last_error` is set):
   - `lastErrorMessage(last_error)` maps the scheduler's prefix (scheduler.py:220-242, :522-527) to plain words: `[blocked]` → "This site is refusing Popping (HTTP <code>)." (code from `\b40[123]\b`, else no code); `[not found]` → "The address no longer exists (HTTP 404)."; `[upstream error]` → "The site had a problem on its end (HTTP <code>)."; `[http error]` → "The site answered with an error (HTTP <code>)."; `[network]` → "Couldn't reach the site."; anything else → "Popping couldn't read this feed."
   - `text-ios-caption text-red-300 break-words`; **More** reveals the raw string.
   - If `auto_disabled`: "Popping stopped checking after <error_count> failed tries. Fix the address or headers, then tap Resume feed."
   - If `/^\[blocked\]/.test(e) || /\b40[123]\b/.test(e)`, the type takes headers (item 6) and no User-Agent is set: a **Use a browser identity** button that commits the preset (section 8).
2. **Name.** `type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"`. Hint "Shows as “<sourceLabel(draft)>”." Read-only for built-ins, with "Built-in feed: its name and address are fixed."
3. **Address.** Label "Subreddit" for reddit rows. `type="url" inputMode="url"`, same attributes. Read-only for built-ins. While the draft differs from the saved value: "Its icon refreshes on the next check." If the server returns a different URL (reddit canonical form, YouTube or Apple resolution), the draft takes it and the hint reads "Saved as the channel's feed link" (YouTube) or "Saved as <url>".
4. **Category:** `` <CategoryPicker inputId={`fe-category-${source.id}`} value={pending ?? source.category} sources={sources} onChange={(v) => commitField(id, 'category', v, 'category')} /> ``.
5. **Check for new items:**
   - Built-ins: read-only text "Checked every <refreshLabel(v)> (built-in feed)". The scheduler ignores the column for registered names (update_source returns at scheduler.py:2440-2442; built-in jobs use `plugin_cls.refresh_interval_seconds`, :1802, :500, :565), so a select would show "Saved ✓" for a no-op.
   - Others: `<select className="select-ios pl-3 pr-8 …">` over `REFRESH_PRESETS`. If the stored value is not a preset, put `<option value={v}>every {refreshLabel(v)}</option>` first.
6. **Headers:** `<HeadersEditor mode="autosave">`, only when `!isBuiltIn(source) && ['rss','podcast','youtube_channel','generic_scrape'].includes(type)`. reddit (dynamic_reddit.py:171) and built-ins (rss.py:537, rfd.py:168) ignore headers. For generic_scrape add: "Used when Popping opens each article. The site's page list is still read without these." (generic_scrape.py:343, :435 send default headers; Test ignores headers for this type, routes/sources.py:996-1006). Reddit rows that still store headers from the old JSON box keep them; harmless, noted in the PR body.
7. **Website rows** (`generic_scrape` only): **Sitemap address** (`type="url"`) and **Only links starting with** (text; must start with "/" and contain no "://", else "Start it with /"). Empty sends `null`.
8. **Actions** (`flex flex-wrap gap-2`, each 44px):
   - **Pause feed** / **Resume feed**: `commitField(id, 'active', !(pending ?? active), 'pause setting')`.
   - **Check now**: `await whenIdle(id)`, then `api.ingest(currentSource(id).name)`; toast "Checked <label>: <n> new" or "Couldn't check <label>: <lastErrorMessage(r.error)>" (replacing FeedManager.tsx:871, :874).
   - **Delete feed…**: inline confirm with no timer, **Pause instead**, **Delete**, **Keep**. Delete: `await whenIdle(id)`, `api.deleteSource(id)`, then `onDeleted(id)` (App's `removeSource`, toast "Deleted <label>").

Built-ins can still be paused, recategorised and deleted; their name, address, headers and interval are fixed.

### The save store (lib/sourceSaves.ts)

```ts
export type Field = 'name' | 'url' | 'category' | 'refresh_interval_seconds' | 'active' | 'custom_headers' | 'sitemap_url' | 'link_pattern'
export type SaveState = Readonly<{ status: 'idle' | 'saving' | 'slow' | 'saved' | 'error'; pending?: unknown; failedValue?: unknown; message?: string; retryable?: boolean }>
export function configureSourceSaves(deps: {
  patch: (id: number, body: Record<string, unknown>, opts: { keepalive: boolean; signal: AbortSignal }) => Promise<SourceRow>
  getSource: (id: number) => SourceRow | undefined
  onServerRow: (row: SourceRow) => void
  onRenamed: (oldName: string, newName: string) => void
  onGone: (id: number) => void                                              // 404: the feed was deleted elsewhere
  onFailedAway: (id: number, failures: Array<{ label: string; message: string }>) => void
  describe: (err: unknown, field: Field, value: unknown) => { message: string; retryable: boolean }
  equal: (field: Field, a: unknown, b: unknown) => boolean
}): void
export function commitField(id: number, field: Field, value: unknown, label: string): void
export function retryField(id: number, field: Field): void
export function clearError(id: number, field: Field): void
export function getSaveState(id: number, field: Field): SaveState
export function subscribe(id: number, field: Field, cb: () => void): () => void
export function currentSource(id: number): SourceRow | undefined
export function whenIdle(id: number): Promise<void>
export function dropSource(id: number): void
export function setPageHiding(hiding: boolean): void
export function registerFlusher(fn: () => void): () => void
export function flushEditors(): void
```
- `SourceRow` is a local structural type (`{ id: number; name: string } & Record<string, unknown>`), so the module has no imports. App calls `configureSourceSaves` once in an effect, with refs to its latest state.
- `getSaveState` returns a frozen module-level `IDLE` for unknown keys and the same object until that key's state changes (React 18.3.1 StrictMode, main.tsx:8, loops on a fresh snapshot). `useSaveState` memoises its subscribe function per `(id, field)`.
- `equal`: exact string compare for text fields and category (so `'news '` → `'news'` still sends), `sameHeaders` for headers.

**Triggers** (no time-based debounce):

| Field | Commits on |
|---|---|
| Name, Address, Sitemap, Link pattern | `onBlur`, and `onKeyDown` Enter → `e.currentTarget.blur()` |
| Category, Check for new items | `onChange` of the native select |
| Pause | tap |
| Headers | focus leaves the whole headers group, a row is removed, or a preset is tapped (section 8) |

Why no debounce timer: every effective PATCH on an active feed rebuilds its job with `next_run_time` = now (scheduler.py:2461 → :2144), which is a fetch. A timer would save half-typed addresses and fetch on every pause in typing.

**Per-source state:** a queue `Map<Field, Item>` in insertion order; an in-flight map; a `retrying` slot; `lastRejected: Map<Field, unknown>`; per-field `SaveState`.

**commitField:**
1. Compare `value` with the queued value for the field; else the in-flight or retrying value; else `getSource(id)[field]`. If `equal`, clear a stale error when the value equals the server value, and return. Nothing is sent and "Saved" is not shown.
2. If `lastRejected.get(field)` equals `value` (a non-retryable 4xx), show that error again and return.
3. If the field is queued and not started, replace its value (newest wins). Otherwise append `{ field, value, label }`. This absorbs an iOS select that fires `change` more than once.
4. Set `{ status: 'saving', pending: value }` and notify.
5. `pump(id)`.

**pump(id):**
- Normal: if anything is in flight or `retrying` is set, return; otherwise take the first queued item.
- While the page is hiding: send **every** queued item at once with `keepalive: true`, without waiting for the in-flight one. Different fields are independent columns and `update_source` touches only changed attributes.
- Per item: `AbortController`; a 35 s timer that aborts; an 8 s timer that sets `slow`; `patch(id, { [field]: value }, { keepalive: pageHiding, signal })`. Each body holds **one key**, so a 422 belongs to one field.
- **Success** (`row`): `prev = getSource(id)`; `onServerRow(row)`; if `prev && prev.name !== row.name`, `onRenamed(prev.name, row.name)`; `lastRejected.delete(field)`; if no newer value is queued for the field, set `saved`, then `idle` after 1500 ms.
- **Failure:**
  - A `TypeError` (network) not yet retried moves to `retrying` with a 2000 ms timer, then goes back to the front of the queue. `retrying` counts as busy for `whenIdle`, for `pump`, and for step 1's comparison.
  - HTTP 404: `onGone(id)` (App's `removeSource`), `dropSource(id)`, state "This feed was deleted.".
  - Otherwise `describe(err, field, value)` → `{ status: 'error', message, failedValue: value, retryable }`; a non-retryable 4xx sets `lastRejected`.
  - If nobody is subscribed to (id, field), the editor is gone: collect `{ label, message }` per source and call `onFailedAway(id, failures)` once per source per tick (`setTimeout(0)`), because Toast.tsx shows one toast at a time (:71-96). The failed value and message stay in the store, so a reopened editor shows the draft and the reason.
- `finally`: clear timers and in-flight state, then `pump(id)`.
- `dropSource(id)` clears the queue and the retry timer; a result arriving for a dropped id is ignored (a per-source generation counter).
- `whenIdle(id)` resolves when the queue is empty, nothing is in flight and `retrying` is empty.
- `setPageHiding(true)` pumps every source synchronously, inside the `visibilitychange`/`pagehide` handler (no microtask, no timer: timers do not run while iOS suspends the page).

**Text fields in the editor:**
- The draft is local state seeded from `source[field]`. It reseeds from the server only when the field is not focused, not queued, in flight or retrying, and not in error. After a successful save it takes `row[field]` when not focused (reddit canonicalises at routes/sources.py:244-263; Apple and YouTube resolve at :688-699), so a later blur does not re-send and re-fetch.
- On error the draft is kept, and the message shows under the field with **Undo** (draft = saved value, `clearError`) and, when `retryable` (network, timeout, 5xx), **Try again** (`retryField`).
- On mount with an error state in the store, the draft is `failedValue` and the message shows.
- **Discrete controls** (category, interval, pause) show the saved value again on failure (the store drops `pending`) with the message under the control. **Headers** keep their draft rows (section 8).

**Messages** (`fieldSaveMessage`, checked in this order; the backend's text never reaches the user raw):

| Response | Message |
|---|---|
| 409 "already in use" | "Another feed already uses this name." |
| 400 "reserved for a built-in source" (routes/sources.py:681-685; test before the next row, it also contains "built-in") | "That name belongs to a built-in feed. Pick another." |
| 400 "cannot be renamed or re-URLed" (:765-771) | "Built-in feeds keep their name and address." |
| 404 "source not found" (:666, :797) | "This feed was deleted." (and `removeSource`) |
| 422 "name must match" (:213-217) | "Use lowercase letters, numbers and underscores." |
| 422 "category cannot be empty" | "Pick a category." |
| 422 "reserved for a built-in column" | "“<value>” is used by the app. Pick another name." |
| 422 "characters or fewer" (category) | "Keep it to 40 characters or fewer." |
| 422 "url must be http or https", "url must include a host", "url is not a valid URL" (:220-228) | "Use a web address that starts with https://" |
| 422 "not reachable" | "That address isn't reachable from Popping." |
| 422 "reddit url must be a subreddit reference" (:263-271) | "Type a subreddit, like r/python." |
| 422 "link_pattern must" (:736-745) | "Start it with /" |
| 422 "not a valid HTTP header name" | "Header names use letters, numbers and dashes." |
| 422 "header name … is longer than" | "Header names can be 100 characters at most." |
| 422 "listed twice" | "Already added." |
| 422 "cannot be overridden" | "Popping can't send a <Name> header." |
| 422 "exceeds 512" | "Too long (512 characters max)." |
| 422 "disallowed characters" | "Use plain letters, numbers and punctuation." |
| 422 "at most 20" | "20 headers at most." |
| 409 "You already follow this channel as <name>." | "You already follow this channel as <sourceLabel(name)>." |
| other 4xx from the YouTube or Apple resolvers (the exact strings in section 3 and apple_podcasts) | the detail as is |
| any other 4xx | "Popping couldn't save that. Try a different value." |
| 401 | "Please sign in again." |
| 5xx | "Popping had a problem saving. Try again." |
| `TypeError` | "Couldn't reach Popping. Check your connection." |
| `AbortError` | "That took too long. Try again." |

`friendlyTestError` uses the same mappings for `error` strings, plus: `forbidden` → "This site blocks automated readers. Open “Headers” below, tap “Use a browser identity”, then Test again." (FeedManager.tsx:171 points at a section that does not exist); `parse_error` → "That address answered, but it isn't a feed." (:175); `invalid_headers` → the header message for `raw`; `network_error` → "Couldn't reach that site. Check the address."; `name_conflict` → "Another feed already uses this name."

`errorMessage(err)` for every other call site: 401 "Please sign in again."; 5xx "Popping had a problem. Try again."; `TypeError` "Couldn't reach Popping. Check your connection."; else "Something went wrong. Try again."

**Validation before any PATCH.** A failure shows the error, sends nothing and keeps the draft.
- **Name:** `normalizeName(v) = v.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')`, then `^[a-z0-9_]{1,120}$`. Empty: "Type a name." A `KNOWN_BUILT_INS` name: "That name belongs to a built-in feed. Pick another."
- **Address** (non-reddit): trim; add `https://` when there is no `://` and the value has a dot; `new URL(v)` with protocol `http:` or `https:`, else "Use a web address that starts with https://". YouTube shapes go through `normalizeFeedInput`.
- **Address** (reddit): non-empty; the backend canonicalises it.
- **Category:** section 7. **Headers:** section 8. **Link pattern:** starts with "/" and has no "://".

**What the backend still rejects** (the client mirrors most; the rest arrive as messages above): name regex 422; registry name 400; built-in rename or re-URL 400; name collision 409; URL scheme, host or SSRF 422; Apple, YouTube and reddit resolution 422; category empty, over 40 or reserved 422 (routes/sources.py:287-303); headers not an object, more than 20, non-string, bad name, too-long name, duplicate, denylisted, over 512, non-printable 422; `refresh_interval_seconds` is clamped silently to [60, 86400].

### api.ts (PR3)

- `ApiError` gains `status: number` (constructor `(message, detail?, status?)`); `jsonFetch` passes `resp.status` (api.ts:264-287).
- `Source` (api.ts:117-147) gains `sitemap_url: string | null; link_pattern: string | null` (the backend already returns both, schemas.py:28-34).
- `SourceTestResult.error_kind` (api.ts:158-168) gains `'invalid_headers'`.
- `updateSource(id, body, opts?: { keepalive?: boolean; signal?: AbortSignal })` passes both to `fetch`; the body type gains `sitemap_url?: string | null; link_pattern?: string | null`; the comment at :432-436 says "send null to clear" (it says `{}`). A keepalive body must stay under 64 KB; a one-key PATCH is tiny.
- `deleteSource` (:446-452) throws `ApiError` with `status` and `detail`.
- `autoAddSource` kind union gains `'youtube_channel'`.
- Keep the `testSource` body union and the `createSource` body shape exactly (slice15 :326-341 and test_source_create_sitemap_link_pattern.py:183-190 pin them).

### App wiring (App.tsx, PR6)

**`applyServerSource(row)`:** `setSources(prev => prev.map(s => s.id === row.id ? { ...row, net_vote_score: s.net_vote_score } : s))` (the PATCH response carries `net_vote_score: 0`, routes/sources.py:798) and record the write time. If the row's category changed and the phone shows a column (`mobileCol >= 0`), remember the current column's name in `followTabRef` (below).

**`insertSource(row)`:** append, sort by (category, name), record the insert time. Called after `createSource`, `autoAddSource` and a Suggested add, through a new FeedManager prop `onSourceAdded(row)`.

**`removeSource(id)`:**
- filter it out of `sources`; record the delete time; `dropSource(id)`;
- `setEntries(prev => prev.filter(e => e.source_id !== id))` and the same for `forYou` (otherwise its stories fall into an "Other" column through `?? 'other'`, App.tsx:756);
- remove its name from `activeSources` and from every preset's `activeSources` (`setFilterPresets`, App.tsx:605, with `filterPresetsRef`, :627);
- `refresh({ silent: true })`.

**`refresh(opts?: { silent?: boolean })`** (App.tsx:1057-1119):
- Record `startedAt = Date.now()` and a sequence number before `Promise.all`. On resolve, drop the whole result if a newer refresh has already been applied.
- Before `reconcileById`: drop ids deleted at or after `startedAt`; keep the local row for ids written at or after `startedAt`; add rows inserted at or after `startedAt` that the response lacks; prune overlay entries older than 120 s.
- The "N new" / "refreshed" toast and the error toast fire only when not silent; errors still set the banner. The error text goes through `errorMessage` (PR7 does :1114-1115).
- Silent callers: the interval (:1248), visibility (:1263), the initial load (:1271), the filter debounce (:1343). Settings' and Drawer's `onRefreshSources` (:2805, :2838) become `() => refresh({ silent: true })` and return the promise, so FeedManager's `await onRefresh()` really waits.
- Manual callers keep `refresh()` with no argument: the phone icon (:2291), the desktop button (:2349), the `r` key and Column's chip. Write `onClick={() => void refresh()}`, never `onClick={refresh}` (the event would arrive as `opts`). Column gets `const manualRefresh = useCallback(() => refresh(), [refresh])`.

**Follow-up check.** After a successful `url` or `custom_headers` save on an active feed, call `refresh({ silent: true })` once, 15 s later (one timer per source id), so the "Last problem" line shows the result of the fetch the PATCH started.

**`onFailedAway(id, failures)`:** one toast per source: one failure → `Couldn't save the ${label} for ${sourceLabel(name)}: ${message}`; several → `Couldn't save ${n} changes for ${sourceLabel(name)}`; `{ kind: 'error', action: { label: 'Open', onClick: () => openSettings('feeds', id) } }`.

**`onSourceRenamed`** (App.tsx:1994-2003): stays `const onSourceRenamed = useCallback(` (slice21 pins it); also remaps `filterPresets[].activeSources` with the destructured `setFilterPresets` (App.tsx:605) and `filterPresetsRef`; deps `[setActiveSources, setFilterPresets]`.

**Phone tab across a category change** (scope cut to the editor case): today the phone remembers its tab by index (App.tsx:445, :1358-1367). When a category save lands, `followTabRef` holds the open column's name; an effect on `columns` sets `mobileCol` to that name's new index if it still exists, else leaves the existing clamp (:1358-1367) to land on a neighbour; then clears the ref. Nothing new is stored; the Brief tab (-1) and cold starts behave as today.

**Desktop `selectedColumnIndex`** (App.tsx:671): clamp it to `columns.length - 1` in the same effect, so j/k/o never target a vanished column.

**`onSourceTap`:** `const onSourceTap = useCallback((id: number) => openSettings('feeds', id), [openSettings])` (stable, because `openSettings` has no deps), passed through Column to Card. The Card and Column memo comparators ignore callbacks (Card.tsx:1460-1475, Column.tsx `_columnPropsEqual`), so stability matters. Keep `memo(ColumnInner` and the nine `useCallback` handlers slice21 pins.

**Card source name** (Card.tsx:961): the span becomes `<button type="button" data-card-interactive onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSourceTap?.(entry.source_id) }} className="min-w-0 truncate text-left font-semibold …">`. The meta row (:956) gets `min-h-[44px]` instead of a negative-margin hit area, so the button never overlaps the headline or thumbnail.

### Settings wiring (Settings.tsx, PR6)

- `const reportError = useCallback((m: string) => toast(m, 'error'), [])`, defined before `if (!open) return null` (:182). Pass it as FeedManager's and HistoryTab's `onError` (:269, :398) instead of App's `setError`.
- **Keyboard** (from `useVisualViewport()`), only while `keyboardOpen` and `matchMedia('(max-width: 767px)').matches`:
  - the panel's inline style is `top: calc(env(safe-area-inset-top) + 0.75rem + ${offsetTop}px)` and `bottom: ${documentElement.clientHeight - (offsetTop + height)}px`;
  - the body drops its safe-area bottom padding;
  - on each viewport resize the focused element gets `scrollIntoView({ block: 'nearest' })`;
  - Done and the focused field both stay visible. Desktop ignores all of this.
- **`handleClose`** (Done, the backdrop at :190-194, and the Esc listener at :166-180):
  1. `(document.activeElement as HTMLElement | null)?.blur()`; the blur commits a pending text field;
  2. `flushEditors()`: each FeedEditor registered a flusher that commits any dirty, valid text draft. A CategoryPicker New-category draft is never committed and is discarded;
  3. `onClose()`; nothing waits.
- **App switching:** while Settings is open, `visibilitychange` (hidden) and `pagehide` call `setPageHiding(true)`, blur the active element and `flushEditors()`; the store pumps synchronously with `keepalive`. `setPageHiding(false)` on visible.

## 7. Category picker

`CategoryPicker({ inputId, value, sources, onChange, disabled, defaultInSuggestions }: { inputId: string; value: string; sources: Array<{ category: string }>; onChange(final: string): void; disabled?: boolean; defaultInSuggestions?: boolean })` in components/feeds/CategoryPicker.tsx. It is presentational: it emits the final value and the caller commits (FeedEditor) or sets form state (Add form). It replaces the edit form's `<input list>` + `<datalist>` (FeedManager.tsx:603-619, deleted in PR6) and the Add form's select (:1720-1733). The Add form keeps `inputId="fm-category"` with `<label htmlFor="fm-category">`; the editor uses `fe-category-<id>`.

**Source of categories:** `sources.map(s => s.category)`, never App's `categories`, which come from visible entries and miss empty categories (App.tsx:753-764). AddCustomTab today receives no sources (FeedManager.tsx:258); PR4 passes them.

lib/categories.ts:
- `CATEGORY_OPTIONS` (moved, exported), `CATEGORY_MAX = 40`, `RESERVED_CATEGORIES = ['saved', 'for you']`.
- `categoryOptions(sources, current, label, { defaultInSuggestions })` returns `{ yours: Array<{ value, text, count }>, suggestions: Array<{ value, text }> }`:
  - **yours:** unique exact raw strings, plus `current` when missing (editor), sorted by `label(value)` with `localeCompare(undefined, { sensitivity: 'base' })`. `text = label(value)`; when two raw values share a label ("news" and "News", or "news " with a trailing space), each text becomes `${label} (“${raw}”)` so whitespace twins show.
  - **suggestions:** `CATEGORY_OPTIONS` minus anything matching "yours" by `toLowerCase()` or by `label(x).toLowerCase()`. In the Add form the default 'news' sits here when no feed uses it (no invented "yours" entry with count 0). On a fresh install this is the only group.
- `label` is passed in (`categoryLabel`, labels.ts:64-68); the module has no imports.

**Rendering:**
- One native `<select id={inputId} className="select-ios w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline pl-3 pr-8 text-ios-body">` with `<optgroup label="Your categories">` and `<optgroup label="Suggestions">`. A native select gives the iOS picker (a popup menu on iOS 16 and later); a datalist is invisible on iOS Safari.
- Under it, a 44px **New category** button. Its `onClick` does `flushSync(() => setMode('new'))` then `inputRef.current?.focus()` inside the same tap, which is what makes iOS raise the keyboard (a select `change` handler is not a user gesture, so an option-based "New category…" would focus without a keyboard). There is no `__new__` option value.
- In the Add form the picker takes the full row; Refresh moves to its own row below (today they share a `flex gap-2` row at :1720-1747, which would leave about 136px for the field, Add and Cancel at 320).

**New-category mode:**
- `<input ref={inputRef} type="text" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="done" placeholder="e.g. Hockey">`, no `maxLength` (it silently truncates pastes and counts UTF-16 units).
- A live line: "Shows as “<label(normalised)>”", or "Using your existing “News” category", or the error.
- 44px **Add** (disabled while the input is invalid) and **Cancel**, both with `onPointerDown` preventDefault.
- **Return or Add commits. Blur does not.** Cancel returns to the select with the current value. `flushEditors` never commits this draft.
- Add form: while New-category mode holds a non-empty draft, **Add feed** is disabled with the hint "Finish or cancel the new category." Otherwise the feed would silently land in the previous category.

**Rules** (`resolveNewCategory(input, existing, suggestions, label)` → `{ ok: true, value, reused: 'existing' | 'suggestion' | null } | { ok: false, message }`):
1. Normalise: `trim()`, collapse inner whitespace to one space. **Keep the case as typed.** Lower-casing would turn "NHL" into "nhl", which `categoryLabel` shows as "Nhl" (ACRONYMS, labels.ts:21-25).
2. Empty: "Type a name."
3. `Array.from(s).length > 40` (code points, like Python `len` and Postgres `varchar(40)`): "Keep it to 40 characters or fewer."
4. `s.toLowerCase()` or `label(s).toLowerCase()` in `RESERVED_CATEGORIES`: "“<input>” is used by the app. Pick another name." ("for_you" and "saved_" display as "For You" and "Saved".)
5. Equal ignoring case, or equal by `label(x).toLowerCase()` ("tech_news" vs "Tech News"), to an existing category: return the existing raw spelling, `reused: 'existing'`.
6. Same against a suggestion: return the suggestion slug ("Tech" → "tech"), `reused: 'suggestion'`, so Card colours (case-sensitive switches) still apply.
7. Otherwise the normalised input.

**Where it is used beyond the picker** (PR4): Suggested-tab adds (`rec.category`, FeedManager.tsx:1042), Auto-add and Track anyway (`resolveDefault`, section 3) resolve through `resolveNewCategory`, so an existing "News" is reused instead of creating a second column with the same label (columns group by the raw string, App.tsx:753-762).

**Other category fixes (PR4):**
- Card colours (Card.tsx:131-149, :171-190, :192+) switch on `category?.toLowerCase().trim()` (class logic only).
- Columns sort by label (App.tsx:764): `Array.from(byCategory.keys()).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), undefined, { sensitivity: 'base' }))`, so typed "Hockey" and "NHL" do not jump ahead of every lower-case category and the tab bar, desktop grid and Jump list match the picker order.

**Backend (PR1):**
- `_validate_category` returns the stripped value. POST (:469 → :518), /auto (:608 → :617 and the generic_scrape branch :638) and PATCH (:752 → :779) store the returned value. The discover route already strips (:1143-1144); use the returned value there too.
- The reserved check compares `re.sub(r"[_\s-]+", " ", stripped.lower()).strip()`, so "for_you", "For-You" and "saved_" are rejected like the label rule.
- No lower-casing, because entries.py:366 compares raw strings.

**Expected behaviour, documented:** per-column preferences (sort, min score, max age), sections and last-viewed are server-backed and keyed by the raw column name (App.tsx:906, :966, :1188-1196). A category that loses its last feed keeps its preferences on the server and gets them back if the name returns; a new category starts with defaults. Read state is global (App.tsx:970), so moved stories do not turn unread. Moving preferences on a rename is out of scope (open decision 2).

**Existing case or space duplicates:** the quoted-raw suffix makes them visible, and feeds can be moved one by one. A bulk merge is open decision 2.

## 8. Headers without code

`HeadersEditor({ value, onCommit, disabled, mode, saved }: { value: Record<string, string> | null; onCommit(map: Record<string, string> | null): void; disabled?: boolean; mode: 'autosave' | 'local'; saved?: Record<string, string> | null })` in components/feeds/HeadersEditor.tsx. Rules live in lib/headers.ts.

**Rows:**
- State is `Array<{ key: number; name: string; value: string }>`, seeded from `Object.entries(value ?? {})`.
- Reseed only when no header input is focused, no headers save is pending, the group is not in error, and the server map differs from `lastSeeded` (canonical JSON). After a successful commit set `lastSeeded = canonical(sent map)`, so the server's echo does not trigger a reseed. A reseed keeps the existing row order for names still present and appends new ones (Postgres JSONB returns keys sorted by length, models.py:93).
- Layout per row, at 320 (`grid grid-cols-[1fr_auto] gap-2`):
  - first line: the name input (`placeholder="Header name"`) and a 44×44 remove button (`aria-label="remove header <name>"`, a minus-circle icon);
  - second line: the value input spanning both columns (`placeholder="Value"`);
  - both inputs: `type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"`, 17px (iOS would otherwise alter User-Agent tokens such as "KHTML");
  - errors appear under the row.
- Existing rows whose names fail the new rules (stored before PR1) show their error as soon as the editor opens, so the user knows why headers do not save.

**Below the rows:**
- **Add header** (44px, outline): `flushSync` adds a row, then its name input is focused in the same tap, so iOS raises the keyboard. Hidden at 20 rows.
- **Presets**, each hidden when that header already exists (case-insensitive):
  - **Use a browser identity:** `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`.
  - **Prefer English:** `Accept-Language: en-CA,en;q=0.9`.
- Every button in the group has `onPointerDown={(e) => e.preventDefault()}`, so focus stays in the input and no premature focusout fires.
- Footnote: "Some sites block automated readers. A browser identity usually fixes it. Headers are saved as plain text that anyone who can open Popping can read, so don't put passwords or keys here."

**Commit triggers (autosave mode):**
- `onBlur` on the group container when `!e.currentTarget.contains(e.relatedTarget as Node)`. With the pointerdown rule above, a null `relatedTarget` now only means a tap outside the group, which commits.
- Removing a row commits; tapping a preset commits; Return in a value field blurs it.
- The "Fill in both to save this header." message appears only after focus has left the group.

**Validation** (lib/headers.ts):
- Normalise names and values: “ ” become ", ‘ ’ become ', en and em dashes become -, … becomes "...", then trim. Then `canonicalName(n)`: `user-agent` → `User-Agent`, `accept` → `Accept`, `accept-language` → `Accept-Language` (`CANONICAL_HEADER_NAMES`), so the row shows what will be stored.
- **Both empty:** the row is dropped silently (the backend accepts blank keys today, routes/sources.py:324-334).
- **Only one filled:** "Fill in both to save this header." (see the commit rule below).
- **Name not matching `` ^[!#$%&'*+.^_`|~0-9A-Za-z-]+$ ``:** "Header names use letters, numbers and dashes."
- **Name longer than `HEADER_NAME_MAX = 100`:** "Header names can be 100 characters at most."
- **Name in `HEADER_DENYLIST`** (exactly the backend's `_HEADER_DENYLIST_ALL` after PR1: cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url, content-length, transfer-encoding, connection, keep-alive, te, trailer, upgrade, expect, proxy-authorization, proxy-connection; compared lower-cased): "Popping can't send a <Name> header."
- **Duplicate name** ignoring case: "Already added."
- **Value over `HEADER_VALUE_MAX = 512`:** "Too long (512 characters max)."
- **Value outside `^[\t\x20-\x7e]*$`:** "Use plain letters, numbers and punctuation."
- **More than `HEADERS_MAX = 20` rows:** "20 headers at most."

**What a commit sends** (`rowsToMap(rows, saved)` → map or `null`):
- complete valid rows are included;
- an incomplete row whose name matches a saved header keeps the saved value (the user may be retyping it); an incomplete new row is left out and stays as a draft with its message;
- any complete row with an error (bad name, too long, denied, duplicate, bad value) blocks the whole commit: nothing is sent and the error shows;
- `null` when nothing remains. `sameHeaders(a, b)` compares key-sorted JSON and treats `null` and `{}` as equal; no request is sent when the map equals the saved one. The client always sends `null` to clear (the backend stores `{}` and `null` as NULL, routes/sources.py:354, :753-759).
- In the editor: `commitField(id, 'custom_headers', map, 'headers')`.

**On a failed headers save:** the draft rows stay, the message shows under the group with **Undo** (reseed from `source.custom_headers`) and, for network or 5xx, **Try again**.

**Add form** (FeedManager.tsx AddCustomTab, PR4):
- A 44px toggle `<button type="button" aria-expanded aria-controls="fm-headers" className="min-h-[44px] …">Advanced: headers for sites that block readers</button>` (not `<details>`/`<summary>`, which older WebKit lays out inconsistently and which C7 does not measure) reveals `<HeadersEditor mode="local">`.
- Local mode validates before Test and Add: any half-filled or invalid row disables both buttons and shows the row error (otherwise `rowsToMap` would drop it and the user would believe a User-Agent was sent).
- The map goes to `api.testSource({ …, custom_headers })` (api.ts:389-400) and `api.createSource` only when the type is rss, podcast, youtube_channel or generic_scrape. Switching the type to Subreddit clears the map.
- `friendlyTestError('forbidden')` reads: "This site blocks automated readers. Open “Advanced” below, tap “Use a browser identity”, then Test again."
- Suggested adds keep `custom_headers: rec.default_headers ?? undefined` (FeedManager.tsx:1050); cbc_top's browser User-Agent (alembic/versions/0017_feed_recommendation_candidates.py:53-58) passes the new rules (contract test).

**Backend (PR1, `_validate_custom_headers`, routes/sources.py:306-354)**, in this order per key:
1. type check (:324-329);
2. `` _HEADER_NAME_RE = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+") `` with `fullmatch`; failure: `header name {k!r} is not a valid HTTP header name`;
3. `len(k) > _HEADER_NAME_MAX` (100): `header name {k!r} is longer than 100 characters`;
4. canonicalise `user-agent`, `accept`, `accept-language` to `User-Agent`, `Accept`, `Accept-Language` (`_CANONICAL_HEADER_NAMES`);
5. a lower-case form already seen: `header {k!r} is listed twice`;
6. the deny list (:330-334), now including the ten framing and hop-by-hop names in `_HEADER_DENYLIST_EXTRA` (:177-186). A user-set Content-Length or Transfer-Encoding on a GET can make h11 fail or mis-frame the request; Proxy-* names would reach the optional guard-proxy for plain-http feeds;
7. value length and characters (:335-352), unchanged.
- Fix the stale comments at routes/sources.py:711-715 (generic_scrape does use headers for article pages) and schemas.py:186-188 (an explicit `null` clears `custom_headers`; omitting the field leaves it).

## 9. One button in the top bar

**The one button** is the existing Hamburger (≡, Hamburger.tsx:11-33, `aria-label="open menu"`). It gains `aria-expanded={open}` and `aria-haspopup="dialog"`; App passes `drawerOpen` (App.tsx:2333). Search and the phone-only Refresh stay: one is a field and the other an action, not menus. Pull-to-refresh is a non-goal.

**Deleted (PR5):**
- The gear: App.tsx:2298-2329 (the blank line, the comment starting at :2299, the button with `data-settings-gear`, the SVG, its `</button>` at :2329). :2296-2297 are the Refresh button's icon and closing tag and stay. If the Hamburger comment (:2330-2332) is also removed, remove all three lines, or the JSX breaks.
- The Menu's "All settings…" row (Drawer.tsx:377-390) and the "History" row (:336-351).
- The dead Drawer prop `onResetLocalState` (Drawer.tsx:61-66, :89-92; App.tsx:2810). Settings keeps its own live `onResetLocalState` (Settings.tsx:80, :129, :414; App.tsx:2846).
- Stale comments at App.tsx:1-17 (swipe, localStorage read state) and :2202-2219, and Drawer.tsx:3-28, :71-75, :257-261, :266-273, :307-313.

**Header title** (App.tsx:2221): `shrink-0 whitespace-nowrap` instead of `truncate`, plus `max-[359px]:text-[28px] max-[359px]:leading-[34px]` (guard C16 at 320 and 312).

**Menu (Drawer.tsx) contents:**
1. **Settings**: the first row of a first group without a label (`GroupedSection`'s `label` becomes optional; the "Quick settings" label at :335 goes). Subtitle "Feeds, AI, history, saved" (a longer one truncates at 320). `onOpenSettings?.('feeds'); onClose()`. No icon (GroupedRow, Drawer.tsx:552-602, has no icon slot).
2. **Save current view** (Drawer.tsx:366-376, existing title). Inline from PR9 (below); `window.prompt` until then.
3. **Jump to column** (Drawer.tsx:393-409). `jumpToCategory` (App.tsx:2022-2030) stays a `useCallback` (slice21) and also: clears search when `showSearchView` (App.tsx:2436) is active; calls `setMobileCol(idx)`; scrolls the selected phone tab into view inside the strip (`[role=tablist] [aria-selected=true]`, `scrollIntoView({ inline: 'nearest', block: 'nearest' })`); on desktop scrolls `(el?.firstElementChild as HTMLElement | null)?.scrollIntoView(…)`, because the ref is a `display: contents` div (App.tsx:2598).
4. **Sources** (Drawer.tsx:454-479):
   - Each row becomes `<div className="flex items-center border-b border-hairline last:border-b-0">` holding the existing `<label className="flex flex-1 min-w-0 items-center gap-3 pl-4 min-h-[44px] …">` (its own `border-b`/`last:border-b-0` at :459 move to the wrapper, or every row loses its divider) and a sibling `` <button type="button" aria-label={`edit ${sourceLabel(s.name)}`} className="w-11 h-11 shrink-0 flex items-center justify-center text-label-tertiary active:bg-bg-elevated" onClick={() => { onEditSource?.(s.id); onClose() }}><ChevronRight /></button> ``. A sibling, not a child, so `toggleSourceAndMaybeClose` (App.tsx:2013-2017) never fires.
   - The category text (:476-478) becomes `hidden md:inline` and uses `categoryLabel(s.category)`; on phones the drawer is 88vw (Drawer.tsx:287), and with the › the name would otherwise get about 67px at 320.
   - New prop `onEditSource?: (id: number) => void`; App passes `(id) => openSettings('feeds', id)`.
   - The checkbox `aria-label` (:468) and the footnote (:415) use `sourceLabel`.
   - "Clear" (:420-426) gets `min-h-[44px] px-2 -mr-2`.
- Sign out is not added to the Menu (open decision 5).

**Other fixes (PR5):**
- App.tsx:2379-2385 filter chips: text and `aria-label` use `sourceLabel(src)`; `key={src}` stays raw.
- Grabber (Drawer.tsx:303-306): `top-3` becomes `top-[calc(env(safe-area-inset-top)+0.75rem)]`.
- While closed the aside is inert: an effect does `drawerRef.current?.toggleAttribute('inert', !open)` and sets `aria-hidden` (React 18 has no `inert` prop; the ref is `drawerRef`, Drawer.tsx:203). On close, focus returns to the Hamburger unless Settings is opening.
- Backdrop and panel transitions get the `motion-safe:` prefix.
- Swipe to dismiss (Drawer.tsx:148-193): also close on a rightward drag of more than 100px (the direction the right-anchored panel slides out); update the comments at :11-13 and :142-147.
- Desktop shortcut: `,` opens Settings on Feeds (App.tsx keydown handler :1753-1894, after the input guard), listed in ShortcutsSheet.tsx:29.
- LoginPage stays as is until PR7.

**Where Settings is opened:** the Menu's Settings row, the Menu's ›, a card's source name (PR6), the failed-save toast's **Open** (PR6), the add toast's **Edit** (PR6), the `,` key, and a URL.

**Settings routing (App.tsx):**
- **Focus parameter.** New state `settingsSourceId: number | null`. `sync()` (App.tsx:395-424) reads `source` with `/^\d+$/` and sets it to `null` whenever `source` is absent or `view` is not settings. Settings passes `focusSourceId` to FeedManager.
- **`openSettings(tab = 'feeds', sourceId?: number)`** in `useCallback` with empty deps: set `view`, `tab` and `source` (or delete `source`). If the current URL already has `view=settings`, `replaceState(window.history.state ?? { popping: 'settings' }, '', url)` (re-entry from a toast must not stack entries); otherwise `pushState({ popping: 'settings' }, '', url)`. Then set the states.
- **`closeSettings`** in `useCallback`: first `setSettingsOpen(false)` and `setSettingsSourceId(null)` synchronously (`history.back()` is asynchronous; the sheet must close at once). Then: if `window.history.state?.popping === 'settings'`, `window.history.back()` (popstate runs `sync`, which agrees); otherwise delete `view`, `tab` and `source` and `replaceState(null, '', url)`. Done, Esc and the backdrop add no history entry, and one Back after Done does not reopen Settings.
- **Settings tab buttons** (Settings.tsx:236-247): `u.searchParams.delete('source')` and `window.history.replaceState(window.history.state, '', u.toString())`, keeping the flag (today `null` at :241). Keep the synthetic popstate.
- **FeedManager focus:** lift SourceRow's local `open` (FeedManager.tsx:384) into MyFeedsTab as `openRowId`, passing `isOpen`/`onToggle`. A `useEffect` keyed on `focusSourceId` plus a nonce from App (so re-focusing the same id while mounted works) forces the tab to 'mine', sets `openRowId` and, until PR6 deletes it, `editingRowId` (:215) so › lands in the old edit form in 2 taps; then on the next frame `` document.getElementById(`feed-${id}`)?.scrollIntoView({ block: 'start' }) ``. Put the li id on :321. When the user collapses or changes the open row, remove `source` the same way (replaceState with the current state).
- **One tab list:** `export const SETTINGS_TABS = ['feeds','llm','notifications','history','hidden','starred','voted','reset'] as const` and `export type SettingsTab = typeof SETTINGS_TABS[number]` in lib/settingsTabs.ts. Settings.tsx uses it for the strip (:229) and keeps `export type { SettingsTab }` so Drawer.tsx:34 still compiles; App's allow-list (App.tsx:409-418) becomes `(SETTINGS_TABS as readonly string[]).includes(t)`.
- **Panel animation:** `motion-safe:animate-sheet-up md:animate-none` (the keyframe exists at tailwind.config.js:97-100, unused).
- **Stacking:** header z-20 < Drawer z-30/40 < Settings z-50 < Toast z-[60]. Esc capture listeners are unchanged except that Settings' calls `handleClose`.
- Severity: the Back fix is low priority. The home-screen app (manifest `display: standalone`, index.html:15) has no Back gesture; it shows in a Safari tab and on desktop. Flow FG is the real gate.

**Inline Save current view (PR9):** tapping the row does `flushSync(() => setEditing(true))` then focuses a 17px input in the same tap (keyboard up), with a 44px **Save** disabled while the field is empty. Return or Save calls `onSavePreset(name)`. App's `onSavePreset` becomes `` (name: string) => { savePreset(name); toast(`Saved view “${name.trim() || 'Untitled preset'}”`, 'info') } ``; delete the `window.prompt` block at App.tsx:2812-2832. Preset rename (App.tsx:302-318) becomes the same inline field on the chip, prefilled with `preset.name`, doing nothing for an unchanged or empty value (as :307-310 does today).

## 10. iPhone sweep checklist

Each line was checked against the code. The PR column is where it closes; the PR body lists the items it closes with file:line, or strikes one with a reason.

| PR | file:line | Issue | Fix |
|---|---|---|---|
| 2 | Settings.tsx:265; FeedManager.tsx:685 | Feeds tab has no side gutter; rows add their own px-3. | `pt-4 px-4`; drop row `px-3` (C12). |
| 2 | App.tsx:2221-2334 | With search open the w-44 pill beside three 44px buttons makes body 336px at 320 and the title "P…". | Title and refresh hidden while searching below sm; pill and cluster `flex-1 min-w-0`; 44px clear (C2, C3). |
| 2 | App.tsx:2235; :1762; :1769-1772 | `type=search` draws a second clear button; Esc and `/` rely on it. | `type=text inputMode=search …`; Esc by id plus `setSearchOpen(false)`; `/` opens search; Enter blurs (C15). |
| 2 | Card.tsx:890, :905, :946, :1734 | w-28 thumbnail turns the title into a 10-17 line ribbon on 250-330px cards. | Arbitrary `[@container(...)]` utilities: 72px square under 380px, full-width 16:9 row under 300px (C13). |
| 2 | Card.tsx:956-964 | "12m / ago" wraps with a stray dot. | Source `min-w-0 truncate`; dot and time `shrink-0 whitespace-nowrap` (C11). |
| 2 | Card.tsx:978, :1052, :1122 | Inline actions wrap mid-phrase and are about 18px tall. | `flex-wrap gap-x-4 gap-y-2`, rows `mt-2`, each `whitespace-nowrap min-h-[44px] -my-2` (C11, C7). |
| 2 | FeedManager.tsx:1244-1266 | Auto-add sits off-screen at 320; Settings body 369; text keyboard, autocapitalised. | `min-w-0`, URL keyboard attributes, 44px (C3, C4). |
| 2 | FeedManager.tsx:695-786 | Name clipped by five shrink-0 chips. | Status chips to the caption line (C14); errors on screen in PR6. |
| 2 | FeedManager.tsx:264-287 | Sub-tab pills wrap "My feeds (14)" at 320; 36px. | `min-h-[44px] whitespace-nowrap truncate text-ios-body`; "My feeds / Suggested / Add" (C11). |
| 2 | Settings.tsx:211-222 | "Settings → X" wraps at 320; 32px Done on the leading edge. | Title left `min-w-0 flex-1 truncate`; Done right 44px. |
| 2 | Drawer.tsx:314-325 | 32px Done on the leading edge. | Title left with grabber clearance; Done right 44px. |
| 2 | Card.tsx:1174; FramingWatch.tsx:81, :111; App.tsx:2709; FeedManager.tsx:1114 | 9-10px text. | `text-[11px]`; SourceIcon.tsx:68 stays decorative with one disable. |
| 2 | Toast.tsx:117, :122, :93 | One line; z-50 relies on DOM order; under the keyboard; info vanishes after 1.5 s. | `line-clamp-3 break-words`; `z-[60]`; bottom follows `kbInset`; 3 s / 5 s. |
| 2 | BriefCard.tsx:562-591 | First-run header crushes the text block; Generate can clip. | `flex-wrap` and a `basis-full sm:basis-auto` group for TonePicker and Generate. |
| 2 | BriefCard.tsx:312, :543, :651, :724 | Tone pills 28px; Generate/Regenerate 36px. | `min-h-[44px]`. |
| 2 | SearchResults.tsx:66-76 | Header and long query wrap to many lines at 320. | h2 `shrink-0 whitespace-nowrap`; count `min-w-0 truncate`. |
| 2 | styles.css:39 | `break-word` does not shrink min-content; long tokens widen rows. | `overflow-wrap: anywhere` after a `break-word` fallback. |
| 2 | App.tsx:2188 | `minHeight: 100dvh` gives a 34px document scroll in standalone mode. | Remove it (C2b). |
| 2 | Card.tsx:513 | Swipe leaves the 200ms class transition on; the card trails the finger. | `'none'` while dragging. |
| 2 | tailwind.config.js:7-123 | Hover styles stick after a tap (Card.tsx:891, :919, :1745, ~14 more). | `future: { hoverOnlyWhenSupported: true }`. |
| 2 | Settings.tsx:263; Drawer.tsx:334; Column.tsx:489; App.tsx:2437, :2490, :2721; SearchResults.tsx:78; ShortcutsSheet.tsx:79 | Scroll chains to the page behind. | `overscroll-contain`; `html, body { overscroll-behavior-y: none }` (C4). |
| 2 | App.tsx:2401 | `z-15` is not a class; the banner has no z-index. | `z-10`. |
| 2 | App.tsx:2250 | Search clear is 16px. | `w-11 h-11 -mr-3`. |
| 2 | Settings.tsx:215, :248 | Done 32px; tab pills 36px. | 44px; strip `data-hscroll`. |
| 4 | FeedManager.tsx:1072, :1123, :1280 | Suggested buttons 28px; "Track this URL anyway" 32px. | `min-h-[44px]`. |
| 4 | FeedManager.tsx:1720-1747 | Category and Refresh share a row; New-category mode would not fit at 320. | Category full width, Refresh below. |
| 5 | App.tsx:2221 | "Pop…" at 320 and at 312 (Page Zoom 125%). | Gear removed; title `shrink-0 whitespace-nowrap`, 28px below 360 (C16). |
| 5 | Drawer.tsx:303-306 | Grabber sits under the status bar. | `top-[calc(env(safe-area-inset-top)+0.75rem)]`. |
| 5 | Drawer.tsx:262-295 | The closed Drawer stays focusable off-screen. | `inert` and `aria-hidden` while closed; focus back to ≡. |
| 5 | Drawer.tsx:454-479 | A › button would leave names about 67px at 320. | Category text `hidden md:inline`; divider on the wrapper. |
| 5 | Hamburger.tsx:13-16 | No `aria-expanded`. | `aria-expanded`, `aria-haspopup="dialog"`. |
| 5 | Drawer.tsx:148-178 | Dismiss only by dragging left, against the panel's direction. | Rightward drag also closes. |
| 5 (low) | App.tsx:430-444; Settings.tsx:241 | Done pushes history, so Back reopens Settings (Safari tab and desktop only). | `pushState({popping:'settings'})`, synchronous close, `back()`/`replaceState`, tabs keep state. |
| 5 | App.tsx:2022-2030, :2598 | Jump to column does nothing on phone or desktop. | `setMobileCol`, tab into view, clear search; scroll `firstElementChild`. |
| 6 | Settings.tsx:204 | The sheet ignores the keyboard: Done pans off and lower fields stay covered. | `useVisualViewport` top and bottom; `scrollIntoView` nearest. |
| 6 | App.tsx:2397-2411, :2839 | Settings and FeedManager errors go to a banner under the sheet. | `reportError` → toast at z-[60]; inline errors. |
| 6 | FeedManager.tsx:603-619 | Category datalist is invisible on iOS and autocapitalises. | CategoryPicker. |
| 6 | FeedManager.tsx:790-930 | Feed row links about 18px tall. | Replaced by the 44px editor. |
| 6 | Card.tsx:961 | No touch path from a card to its feed. | Source-name button; meta row 44px. |
| 7 | App.tsx:2673-2717 | Phone tabs about 30px. | `min-h-[44px]` button with an inner visual pill. |
| 7 | App.tsx:2379-2393 | Filter chips `py-0.5`, "clear all" a text link. | 44px buttons with inner pills. |
| 7 | App.tsx:282-374 | Preset chips and their actions under 44px. | 44px buttons with inner pills. |
| 7 | App.tsx:2404-2410 | Error ✕ about 16px. | `w-11 h-11`. |
| 7 | Column.tsx:393; :693 | ⋯ is 32px; section header 28px. | `w-11 h-11`; `min-h-[44px]`. |
| 7 | Column.tsx:418-428, :462-477 | Selects 36px, no chevron on iOS, no text size. | `min-h-[44px] text-ios-body select-ios pl-3 pr-8`. |
| 7 | Column.tsx:236-246 | Popover closes on `mousedown`; iOS sends none for taps on empty space. | `pointerdown`. |
| 7 | Card.tsx:1254-1431 | Action icons 40px (`w-10 h-10`). | `w-11 h-11`, keeping the `data-*` hooks. |
| 7 | Card.tsx:585-593 | 500ms long-press silently copies the URL and fights the native link menu. | Arm the timer only when `matchMedia('(hover: hover)').matches`. |
| 7 | LoginPage.tsx:72, :84 | Username autocapitalises ("Adam"), so local sign-in fails. | `autoCapitalize="none" autoCorrect="off" spellCheck={false}`; `enterKeyHint` next/go. |
| 7 | ShortcutsSheet.tsx:93 | Close 32px. | `w-11 h-11`. |
| 8 | Settings.tsx:776, :796, :804, :812, :847, :855, :897 | AI selects and inputs 36px with no text class; selects look like text boxes. | 44px, `text-ios-body`, `select-ios`. |
| 8 | Settings.tsx:346, :765, :831, :910, :1406, :1450 | Text-link actions with no height. | `min-h-[44px]` buttons. |
| 8 | Settings.tsx:1230, :1238 | History group pills 28px. | 44px segmented control. |
| 9 | styles.css:22-26 | `!important` 16px rule hides 13px-authored controls. | Delete after every control is 17px by design; base 17px default; C6 strict. |
| 10 | App.tsx:2210, :2655, :2668; Drawer.tsx:286-289; Settings.tsx:204 | Only the top inset is handled; in landscape the notch covers the title, Menu and edges. | `pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`; main `max(0.75rem,…)`. |
| 10 | App.tsx:2594 | The hidden desktop grid renders every Column and Card on the phone too. | Render it only when `useMediaQuery('(min-width: 768px)')`. |
| — | App.tsx:2594, :2655; BriefCard.tsx:372, :385 | An iPhone in landscape gets the desktop grid (md is width-only). | Open decision 3 (not in this plan). |

**False positives removed after checking the code:**
- "Card options chevron → Edit this feed": the chevron toggles the summary; the card menu is right-click only (Card.tsx:708-808, bound at :879).
- "A keyboard shortcut and BriefCard pills open Settings": the only callers were App.tsx:2307 and :2811 (PR5 adds `,`).
- "The headers textarea's third line is clipped by line height": moot once the textarea is deleted.
- "The draft guard's 'beyond parent' rule": it flags the intentional `-ml-3`/`-mr-2` hit areas about 25 times per state; replaced by C3-C5 and C11-C14.
- "Toast at Toast.tsx:256-261": the file has 143 lines; the lines are 117 and 122.
- "The rAF focus fallback (App.tsx:2272) fails on iOS": `autoFocus` already raises the keyboard; no change.
- "Card context menu ignores insets (Card.tsx:1832)": desktop only.
- "No service worker or offline mode": not a defect; a service worker would be a background process. Non-goal.
- "The coarse-pointer rule misses iPads with trackpads": moot once the rule is deleted and controls are 17px by design.
- "The Card context menu needs a lint disable": it has no violation (Card.tsx:708, :879); no allowance.

## 11. Ease-of-use sweep checklist

| PR | file:line | Issue | Fix |
|---|---|---|---|
| 3 | FeedManager.tsx:108-115 | KNOWN_BUILT_INS lacks rfd_hot_deals, so its name and address look editable and the backend answers 400. | Add it in lib/feedRules.ts; no_db guard test against the plugin registry. |
| 3 | api.ts:446-452; :284 | deleteSource throws a plain Error; raw "<status> for <url>" text reaches users. | `ApiError` with status and detail; `errorMessage()` at call sites (PR7, PR8). |
| 3 | FeedManager.tsx:171, :175 | The forbidden hint points at "Advanced → Custom headers", which does not exist; "Is this a valid RSS/Atom URL?". | New wording (section 6). |
| 4 | FeedManager.tsx:1368-1424 | The Add form requires an invented slug; nameError and urlError are never rendered, so Add stays grey with no reason. | Optional name with `suggestName`; rendered errors; `normalizeFeedInput`. |
| 4 | FeedManager.tsx:1426-1432, :1473 | Add failures and invalid typed names go to the hidden banner. | Inline in the result box; names normalised. |
| 4 | FeedManager.tsx:1446-1458 | Add sends the typed URL, not Test's resolved one. | `resolvedUrl` after an ok Test; auto-Test for video links with no name. |
| 4 | FeedManager.tsx:1197-1199, :1227-1229 | AutoFeedBlock errors go to the hidden banner. | `setAutoMessage`. |
| 4 | FeedManager.tsx:1190; api.ts:409; FeedManager.tsx:1042 | Fixed or raw categories ('news', 'other', rec.category) can create a second "News" column. | `resolveNewCategory` against existing categories. |
| 4 | FeedManager.tsx:1462, :1193, :1215-1218 | "Feed Added: <slug>", "Tracking: <slug> — scraping…", "tracking via periodic scraping". | "Added <label> to <category>"; "Added <label>. No feed found, so Popping will check the page for new stories." |
| 4 | FeedManager.tsx:1110-1111 | Suggested shows raw slugs and categories. | `sourceLabel` / `categoryLabel`. |
| 4 | FeedManager.tsx:1281 | Tooltip says "generic_scrape source". | Plain title; keep "Track page", "no RSS" and "Track this URL anyway" (slice15). |
| 4 | Card.tsx:131-149, :171-190, :192+ | Colour switches are case-sensitive, so typed "Tech" loses its colour. | Switch on `category?.toLowerCase().trim()`. |
| 4 | App.tsx:764 | Columns sort by code unit, so typed "Hockey" sorts before every lower-case category. | Sort by `categoryLabel` with `localeCompare`. |
| 5 | Drawer.tsx:377-390, :336-351; App.tsx:2298-2329 | Gear, "All settings…" and "History" are three routes into one overlay. | One Settings row in the Menu; gear and extra rows deleted. |
| 5 | Drawer.tsx:477, :415, :468; App.tsx:2384 | Raw category and source names in the Menu and filter chips. | `categoryLabel` / `sourceLabel`. |
| 6 | FeedManager.tsx:657 | Edits save only through a tiny "save" link; errors go behind the sheet. | FeedEditor with field autosave, SaveStatus, inline errors. |
| 6 | FeedManager.tsx:633-650 | Custom headers typed as JSON. | HeadersEditor rows with browser-identity and English presets. |
| 6 | FeedManager.tsx:463-475 | The re-seed effect overwrites in-progress edits on any poll after the feed was fetched. | Deleted; drafts reseed only when not focused, pending or in error. |
| 6 | FeedManager.tsx:379, :433-437 | Delete confirm cancels itself after 4 s. | Inline confirm with no timer and "Pause instead". |
| 6 | FeedManager.tsx:704-754 | last_error, the auto-disable reason and staleness live only in tooltips. | "Last problem" line in plain words; one-tap browser identity on `[blocked]`. |
| 6 | FeedManager.tsx:825-836 | Interval select shows the wrong value for non-preset intervals; built-in intervals are ignored by the scheduler. | Current value first for custom rows; read-only text for built-ins. |
| 6 | FeedManager.tsx:871, :874, :890 | "<slug>: <raw error>", "Fetched N from <source>", "fetch". | "Check now"; "Checked <label>: N new" / plain error. |
| 6 | App.tsx:1112, :1247-1249, :1263 | "refreshed" toast fires every minute and on every return to the app. | `refresh({ silent })`; toast only on a manual refresh. |
| 6 | App.tsx:1994-2003 | Rename remaps the active filter but not saved views. | Remap `filterPresets[].activeSources`. |
| 6 | Feed-add toasts (section 3) | No way from "Added …" to the new feed's settings. | Toast action **Edit** → `openSettings('feeds', id)`. |
| 7 | App.tsx:1615 | Hide toast says "Entry moved to history." (Undo already exists, :1615-1630). | "Hidden." with the same Undo. |
| 7 | Column.tsx:425; :432 | "Top (composite score)"; "Min score:". | "Best first"; "Minimum score: <n>". The slider stays. |
| 7 | Column.tsx:824, :836; App.tsx:2495 | Empty states mention "Feed Manager" and "the scheduler". | Plain copy naming Menu → Settings → Feeds; keep "no entries in this column yet", a `.slice(0, N)` on last_error and an `auto-disabled`/`auto_disabled` reference (slice19 pins them). |
| 7 | App.tsx:1114-1115; SearchResults.tsx:81; LoginPage.tsx:105; BriefCard.tsx:594, :785 | Raw error text. | `errorMessage(err)`. |
| 8 | Settings.tsx:763-768, :928-934 | AI tab needs Edit, then a lower-case "save"; free-text models; "set provider in env"; "Scoring model". | Autosave rules below; "Story-ranking model"; no Save or Edit. |
| 8 | Settings.tsx:886-890 | Key hint says "saved when you tap save below" and mentions .env. | "Paste a key and it saves when you leave the field. Leave it empty to keep the current one." |
| 8 | Settings.tsx:413 | `window.confirm` for reset. | Inline two-step confirm. |
| 8 | Settings.tsx:361-371 | Notifications tells the user to edit .env and restart the backend. | "Push notifications are off. They are turned on in the server's settings file; see “Notifications” in the README." |
| 8 | Settings.tsx:1092, :1110-1112, :1165 | JSX text shows `…`, `✓`, `◯ with strike` literally. | Real characters; eye-off icon from TabIcon; lint selector. |
| 8 | Settings.tsx:1526, :1598, :1683 | Empty states tell phone users to right-click or press keys. | "Tap the eye / star / ▼ on a card". |
| 8 | Settings.tsx:1436; :1442 | Hidden and Saved titles cut to one line; raw source slug. | `line-clamp-2 break-words`; `sourceLabel`. |
| 8 | Settings.tsx:285, :336, :923, :926, :1099, :1416 | Raw error text. | `errorMessage(err)`. |
| 8 | Settings.tsx:113 | Tab "Voted". | "Downvoted" (the id stays `voted`). |
| 9 | App.tsx:2826, :306 | `window.prompt` for Save current view and rename. | Inline fields (section 9); lint and C8. |
| 9 (low) | App.tsx:457 | Brief tone resets on reload. | `popping.v1.brief.tone` in STORAGE_KEYS; validate against the three tones on read (else 'terse'); update the storage.ts:1-44 header ("Only two keys remain"). |
| 9 (low) | App.tsx:2860-2864, :2876-2886 | Saved "Clear all" and "Hide all downvoted" act at once. | Toast with Undo restoring the previous array. |
| 9 (low) | lib/preferences.tsx:523-532; :27-30 | Write failures are swallowed; the comment claims they revert. | One error toast per failure burst plus one retry; fix the comment. |

**AI tab autosave rules (PR8, LLMSection at Settings.tsx:540-939, routes/settings.py:91-170).** The per-source store does not apply; SaveStatus is reused.
- The controls are always shown: `openPicker` (:605-620) runs when the tab opens; delete the Edit/Cancel toggle (:763-768) and the save button (:928-934).
- Provider select: a change sends one PUT `{ provider, model_brief: '', model_scoring: '' }` (models are provider-specific, :622-638). For anthropic, openai, groq or ollama_cloud with `apiKeySet[provider]` false, show that provider's key field with "Paste your <Provider> key to switch." and send the provider PUT only after the key PUT succeeds. Default ('') and ollama send at once.
- Model selects send `{ model_brief }` or `{ model_scoring }` alone on change. "Other…" reveals a text field that sends on blur when non-empty. A saved name missing from the list stays its first option (as :864-866 does).
- Key fields (`type="password" autoComplete="off"`): blur on an empty or untouched field sends nothing (`""` deletes the key server-side, routes/settings.py:165-169). A typed key sends `{ <id>_api_key: value }` alone, then the input state resets to '' and the row shows "Key saved". Removing a key is an inline confirm ("Remove the <Provider> key? Popping falls back to the server's settings file." **Remove** / **Keep**) calling the existing `clearApiKey` (:696-714).
- Never put a key in a toast, an error string or a console line. Errors use `errorMessage`.
- Each PUT carries only its own fields; flows FX and FY pin the counts.

## 12. Build order (PR-sized steps)

Every PR:
- branches from up-to-date main (CI runs only for PRs into main, build.yml:14-18) and reads the plan with `git show origin/claude/redesign-plan:REDESIGN_PLAN.md`;
- runs the section 13 recipe before every push, including `pytest -m no_db`;
- is opened as a draft PR through REST (`gh pr create` and `gh pr view` use GraphQL, which returns 403 here) or the GitHub MCP tool;
- passes every section 2 check, then gets the owner go/no-go, then merges;
- lists in its body the checklist items it closes, with file:line.

| PR | Scope | Owner requirements | Depends on |
|---|---|---|---|
| 1 | Backend: YouTube resolver, header rules, category strip, scheduler skip, safety fixes, tests | 2, 4, 8, 9 | none |
| 2 | Overflow root causes, layout guard, lint bans, CI | 6, 8, 10 | none |
| 3 | Shared rules: pure libs, unit tests, api.ts, no_db guard test | 2, 3, 4 | 1, 2 |
| 4 | Add form and YouTube links in the app | 2, 4, 7, 9 | 1, 2, 3 |
| 5 | One Menu button, Settings history, focus links | 1, 5, 6 | 2, 4 |
| 6 | Feed editor that saves on its own; one tap from a card | 1, 2, 3, 4, 7 | 3, 4, 5 |
| 7 | Cards, columns, dashboard and login sweep | 6, 7 | 6 |
| 8 | Settings sweep and AI tab autosave | 3, 6, 7 | 6 |
| 9 | Inline dialogs, strict guard, delete the 16px rule, low-priority extras | 6, 7, 10 | 7, 8 |
| 10 | Side safe areas; the phone renders only the phone layout | 6 | 9 |

Owner requirements: 1 fewer steps to edit a feed; 2 category picker; 3 saves on its own; 4 headers without JSON; 5 one top-bar button; 6 iPhone problems fixed by default; 7 basic ease of use; 8 nothing exposes the VPS; 9 YouTube links add; 10 no text overflow, fixed at the root.

PR4 lands before PR5 so YouTube adding (the owner's most acute problem) ships right after the backend fix; the Add form does not depend on the Menu work.

### PR1. Backend: YouTube, header rules, category strip, safety

- **Files:** backend/app/youtube.py, backend/app/routes/sources.py, backend/app/scheduler.py (inside `update_source`), backend/app/schemas.py (docstrings and comments), backend/tests/test_youtube.py, backend/tests/test_source_editor_contract.py (new), README.md (YouTube how-to: link shapes, the channel ID path, the log line).
- **Change:**
  - youtube.py and the four routes: section 3.
  - Header rules and deny-list additions: section 8.
  - Category: `_validate_category` returns the stripped value, stored at :518, :617, :638, :779 and used at :1143-1152; reserved check with separators normalised (section 7).
  - `_NAME_RE = re.compile(r"[a-z0-9_]{1,120}")` with `fullmatch` in `_validate_name` (:111, :213).
  - scheduler.update_source: after the built-in early return (:2440-2442), `if category_changed and not (refresh_changed or active_changed or name_changed or url_changed or headers_changed or sitemap_url_changed or link_pattern_changed): return row`, with a comment. Ingest reads the category from the row (scheduler.py:431); name, URL and headers still rebuild, because the job holds `args=[plugin]` built from the row.
  - /test: `invalid_headers`, SSRF message, name checks before resolution.
  - schemas.py: docstrings for SourceAutoResult `kind` (adds youtube_channel), SourceTestResult `error_kind` (adds invalid_headers), and the custom_headers comment (:186-188).
  - Stale comment routes/sources.py:711-715.
- **Tests** (test_source_editor_contract.py, route-level via `app_client`, conftest.py:198):
  - Headers: POST and PATCH reject names "Bad Header", "", "Coo kie" (as invalid, not denied) and "Cookie", "Content-Length", "Proxy-Authorization"; accept "X-Ok"; `{"X-A":"1","x-a":"2"}` 422; a 101-character name 422; a value with `\r\n` 422; 21 headers 422; a 513-character value 422; `null` and `{}` both clear; `{"user-agent": "X"}` is stored as `{"User-Agent": "X"}`; a PATCH of `url` without `custom_headers` leaves the map unchanged; POST with cbc_top's `default_headers` (alembic 0017:53-58) returns 200.
  - Category: `" Tech "` stored as `"Tech"`; a 40-character value with surrounding spaces stored stripped (no 500); empty and 41 characters 422; "For You", "for_you", "saved_" 422; /auto's generic_scrape branch and the discover route store stripped values.
  - Names: PATCH of `name` or `url` on each of the 7 registry names (including rfd_hot_deals; create the rows the way test_builtin_source_deletion.py does) → 400; a collision → 409; "Bad Name" and `"abc\n"` → 422.
  - Refresh: 30 is clamped to 60.
  - Scheduler, with `monkeypatch.setattr(scheduler, "_scheduler", Fake())` (`Fake` records `add_job`, `remove_job`, `get_job`; `get_job` returns None): a category-only PATCH records no `add_job`; a headers PATCH records one.
  - YouTube: section 3.
- **Acceptance:**
  - Every new test passes with the autouse failing transport (no network) and the real `ssrf_event_hook` and `check_url_safe` in the path; rows 1-8 and 15-16 make zero handler calls; the consent cookie is present on a redirected hop; redirects to 127.0.0.1, evil.internal and example.org are refused before any marker is read; no user-facing YouTube or /test message contains "http://", an IP or exception text.
  - Existing tests pass unchanged: test_reserved_category_names, test_source_patch_unset_regression, test_feed_autodiscovery, test_apple_podcasts, slice15, test_source_create_sitemap_link_pattern, test_builtin_source_deletion, test_youtube (rewritten parts aside).
  - All section 2 checks pass, including the AsyncClient/hook count; security-review reports no new outbound host and no SSRF regression.
- **Verification:** `cd /home/user/popping/backend && PYTHONPATH=$PWD .venv/bin/python -m pytest tests/test_youtube.py tests/test_source_editor_contract.py -ra -q -p no:cacheprovider`, then `-m no_db`, then the full suite (section 13); section 2 checks; CI check runs.
- **Depends on:** none.

### PR2. Overflow root causes, the guard, lint bans, CI

- **Files:** frontend/scripts/iphone-audit/** (restored in step 0, then smoke.cjs new, capture.cjs, fixtures.cjs, run.sh, README.md); frontend/src/styles.css; frontend/src/lib/visualViewport.ts (new); App.tsx; Card.tsx; BriefCard.tsx; FramingWatch.tsx; SourceIcon.tsx; SearchResults.tsx; Settings.tsx; Drawer.tsx; FeedManager.tsx (class-only); Column.tsx (overscroll class only); ShortcutsSheet.tsx (overscroll class only); Toast.tsx; frontend/tailwind.config.js; frontend/eslint.config.js; .github/workflows/build.yml.
- **Steps:**
  0. `git checkout origin/claude/redesign-plan -- frontend/scripts/iphone-audit`.
  1. Write smoke.cjs (section 4) with the PR2 states and rules. Run it before any fix and record the output in the PR body. Expected failures: C2 at 320 with search open (336 > 320); C3 and C4 on the Auto-add row (369); C12 on the Feeds tab; C13 on the thumbnail ribbon; C11 on the meta row, the action rows, the Settings header and the sub-tab pills; C14 on feed names; C15 on the search field; C2b on the dashboard.
  2. Apply the section 4 PR2 fixes.
  3. Re-run until it exits 0 at 390 and 320; C6 and C7 print warnings only.
  4. Look at every PNG.
  5. Add the lint block (PR2 scope) and the CI changes.
- **Acceptance:**
  - Guard self-test, recorded in the PR body: adding `w-[500px]` to the h1 makes smoke exit 1 on C2 and C3; reverted, it passes.
  - At 320 with search open, `body.scrollWidth` is 320. The Settings body scrollWidth on the Add tab is ≤ 320. At 320 the headline uses ≥ 55% of the card width or sits above a full-width thumbnail.
  - The h1 is still "Pop…" at 320 (known; fixed and gated by C16 in PR5).
  - `npm run lint`: 0 errors, ≤ 6 warnings. `npm run build` passes. `pytest -m no_db` passes. CI's new steps are green (WebKit may report problems; read them).
- **Verification:** section 13 frontend recipe; `pytest -m no_db`; section 2 checks; CI check runs.
- **Depends on:** none.

### PR3. Shared rules: pure libs, unit tests, api.ts, guard test (no visible change)

- **Files:** frontend/src/lib/{feedRules,categories,headers,apiErrors,sourceSaves}.ts (new); frontend/src/api.ts; frontend/src/components/FeedManager.tsx (imports the moved constants and helpers; no UI change); frontend/scripts/unit/{feedRules,categories,headers,apiErrors,sourceSaves}.test.ts (new); backend/tests/test_frontend_feed_editor_rules.py (new, no_db); frontend/eslint.config.js (scope `src/lib/**`); .github/workflows/build.yml (the unit-test step).
- **Change:** sections 6, 7 and 8 for the libs; the api.ts list in section 6.
- **Unit tests** (`node:test`, `node:assert/strict`; `mock.timers` for the store):
  - sourceSaves: equal value → 0 calls; same-field coalescing with the first call pending → exactly 2 calls, the second with the last value; different fields → serial one-key bodies; a TypeError → one retry after 2 s and `whenIdle` unresolved during the wait; two dirty fields plus `setPageHiding(true)` → two calls with `keepalive: true` sent without waiting; `getSaveState` returns the identical object across calls and a frozen IDLE; a 4xx-rejected value is not re-sent by an identical commit while `retryField` re-sends; 404 → `onGone` and the queue dropped; two failures in one tick with no subscribers → one `onFailedAway` call with two entries; a late result for a dropped id is ignored.
  - categories: reuse via a suggestion slug ("Tech" → "tech"); label-equal reuse ("tech_news" vs "Tech News"); "NEWS" reuses "news"; 41 code points rejected while 21 emoji (42 UTF-16 units) are accepted; "for_you", "saved_", " Saved " rejected; whitespace collapse; quoted-raw text for twins; the Add-form default 'news' in Suggestions.
  - headers: each validation rule and message; smart punctuation in names and values; canonical names; `rowsToMap` with an incomplete saved row (keeps the saved value) and an incomplete new row (left out); `null` vs `{}`; `sameHeaders` key order.
  - apiErrors: each `fieldSaveMessage` row, in table order; `lastErrorMessage` for each prefix; `friendlyTestError` kinds.
  - feedRules: `normalizeFeedInput` and `suggestName` for the same examples as the backend slug tests (including `@ゆっくり実況`, a playlist and `/user/`); `normalizeName`.
- **Guard test** (`@pytest.mark.no_db`, `from app.sources import list_sources`, which imports every plugin and fills the registry):
  - the quoted names in lib/feedRules.ts `KNOWN_BUILT_INS` equal `set(list_sources())`;
  - the quoted entries of lib/headers.ts `HEADER_DENYLIST` equal `routes.sources._HEADER_DENYLIST_ALL` (both directions);
  - `CATEGORY_MAX` = `_CATEGORY_MAX`; `HEADERS_MAX` = `_CUSTOM_HEADERS_MAX`; `HEADER_VALUE_MAX` = `_HEADER_VALUE_MAX`; `HEADER_NAME_MAX` = `_HEADER_NAME_MAX`; `RESERVED_CATEGORIES` = `_RESERVED_CATEGORY_NAMES`; `CANONICAL_HEADER_NAMES` = `_CANONICAL_HEADER_NAMES`.
  - Write the TS constants as plain array or object literals so a regex such as `HEADER_DENYLIST[^=]*=\s*\[([^\]]*)\]` reads them.
- **Acceptance:** unit tests pass with `node --experimental-strip-types --test 'scripts/unit/*.test.ts'`; the guard test passes; slice15 and test_source_create_sitemap_link_pattern pass unchanged; lint 0 errors with `src/lib/**` in scope; build passes; smoke unchanged and green.
- **Verification:** section 13 recipe (now including unit tests); `pytest -m no_db`; section 2 checks; CI.
- **Depends on:** PR1 (the deny list and limits the guard test compares), PR2 (the CI job).

### PR4. Add form and YouTube links in the app

- **Files:** frontend/src/components/FeedManager.tsx (AddCustomTab, AutoFeedBlock, RecommendedTab, passing `sources` and `onPrefill`); frontend/src/components/feeds/CategoryPicker.tsx (new); frontend/src/components/feeds/HeadersEditor.tsx (new, `local` mode); frontend/src/components/Card.tsx (colour switches); frontend/src/App.tsx (column sort by label); frontend/scripts/iphone-audit/{smoke.cjs, flows.cjs (new), fixtures.cjs}; frontend/eslint.config.js (scope `src/components/feeds/**`); README.md if the how-to needs the app steps.
- **Change:** section 3 Frontend; section 7 (form mode, other category fixes); section 8 Add form; RecommendedTab labels and 44px buttons; FeedManager.tsx:1280 44px; success toasts in plain words.
- **Flows** (flows.cjs):
  - FJ: YouTube type, `@handle`, Name empty → Test and Add enabled; Add after a mocked Test posts `resolved_url`; the name sent is `handle_yt`.
  - FJ2: a watch link with Name empty → hint "Name is chosen after Test."; Add triggers one Test request, then one POST with `resolved_url` and a `channel_<id6>_yt` name.
  - FP: Auto feed paste `r/python` → the form shows Subreddit with the value; no POST.
  - FQ: Add form, New category, type "NEWS", Add → the POST body has `category: "news"`; "Add feed" is disabled while a draft is pending.
  - FR: headers section with a half-filled row → Test and Add disabled with the row error; switching the type to Subreddit clears the map and the POST has no `custom_headers`.
  - FS: Auto-add returning an id already in sources → toast "Already added: …".
- **Acceptance:** flows pass at 390; smoke green at 390 and 320 including the new states; slice15 and the sitemap tests pass (the first `placeholder={` is still the fm-url ternary); lint 0 errors; build passes; no `datalist` in the Add form.
- **Verification:** section 13 recipe; `pytest -m no_db`; section 2 checks; CI; owner screenshots of the Add tab (YouTube selected, an error, New-category mode).
- **Depends on:** PR1, PR2, PR3.

### PR5. One Menu button, Settings history, focus links

- **Files:** frontend/src/App.tsx; frontend/src/components/{Drawer,Hamburger,Settings,FeedManager,ShortcutsSheet}.tsx; frontend/src/lib/settingsTabs.ts (new); frontend/scripts/iphone-audit/{capture.cjs, probe.cjs, smoke.cjs, flows.cjs}; frontend/eslint.config.js (adds Drawer.tsx, Hamburger.tsx).
- **Change:** section 9 in order: the gear and stale comments; the title; the Menu rows, ›, labels, Clear, grabber, inert and focus return, swipe, dead prop; `jumpToCategory`; filter chip labels; the focus parameter and `openSettings(tab, id)` with re-entry; `closeSettings`; tab `replaceState`; `SETTINGS_TABS`; FeedManager `openRowId`, focus effect, li ids; `,` shortcut; Hamburger ARIA. Update the audit selectors.
- **Flows:**
  - FG: open from the Menu, Done, wait for the settings dialog to detach, then `page.goBack()` → Settings stays closed; `page.url()` has the app's origin and no `view`, `tab` or `source`; `history.length` grows by at most 1 per open/close cycle.
  - FT: Menu › on the_verge → Settings on Feeds with that row expanded and in view; then › on another feed while Settings stays mounted (via the URL) focuses it.
  - FU: Jump to column on a phone context → the selected tab changes and is inside the strip's visible area.
- **Acceptance:**
  - At 390, 320 and 312 the header has exactly title, search, refresh (phone) and Menu; no `[aria-label="open settings"]` in the DOM; `grep -rn 'data-settings-gear' frontend/src` is empty; `grep -n 'onResetLocalState' frontend/src/components/Drawer.tsx` is empty and App's `<Drawer>` no longer passes it (Settings keeps its prop).
  - C16 passes at 320 and 312. Menu → Settings opens Feeds. With the Menu closed, Tab never focuses Menu content.
  - Smoke green with the new states; flows pass; lint 0 errors; build; `pytest -m no_db` (slice21 still finds `jumpToCategory` and `onSourceRenamed` as `useCallback`).
- **Verification:** section 13 recipe; section 2 checks; CI; owner screenshots of the header and the Menu at 390.
- **Depends on:** PR2 (guard), PR4 (merged first to avoid FeedManager conflicts).

### PR6. Feed editor that saves on its own; one tap from a card

- **Files:** frontend/src/components/FeedManager.tsx; frontend/src/components/feeds/{FeedEditor,SaveStatus}.tsx (new), HeadersEditor.tsx (`autosave` mode), CategoryPicker.tsx; frontend/src/components/Settings.tsx (reportError, keyboard, handleClose, visibility flush); frontend/src/App.tsx (store wiring, overlay, `refresh({ silent })`, `removeSource`, `insertSource`, presets, follow-tab, clamp, `onSourceTap`, follow-up check, `onFailedAway`); frontend/src/components/Card.tsx (source-name button); frontend/src/components/Column.tsx (passes `onSourceTap`); frontend/scripts/iphone-audit/{smoke.cjs, flows.cjs, fixtures.cjs, capture.cjs}; backend/tests/test_frontend_feed_editor_rules.py (adds the FeedManager absence checks); frontend/eslint.config.js (adds FeedManager.tsx).
- **Change:** sections 6 and 8 (editor parts); delete the old edit form and links; Edit action on add toasts; guard test adds: `<datalist`, `custom headers (JSON)` and `JSON.parse(editHeaders` are absent from FeedManager.tsx.
- **Flows** (mock delays use `page.route` on `**/api/sources/<id>` with a timer before `route.fulfill`):
  - FA: ≡ → › on the_verge → pick "Tech" from Suggestions → exactly 1 PATCH, body `{"category":"tech"}`; "Saved ✓" visible.
  - FA2: New category → type "NEWS" → Add → 1 PATCH `{"category":"news"}`; the line "Using your existing “News” category" was visible.
  - FA3: New category → "For You", then "for_you" → 0 PATCHes; the reserved error is visible and Add is disabled.
  - FB: type 10 characters into Address without leaving → 0 PATCHes; Enter, then blur → exactly 1.
  - FC: route a 422 `{ detail: "category 'For You' is reserved for a built-in column" }`, pick a category → the picker shows the old value; "“For You” is used by the app…" is visible (`elementFromPoint` at its centre returns it or a descendant).
  - FD: `route.abort('failed')` twice on the Address save → "Couldn't reach Popping…" and Try again visible; typed text kept; Try again with the route removed → 1 PATCH → "Saved ✓".
  - FE: "Use a browser identity" → 1 PATCH with a `User-Agent` key; typing header name "Cookie" then blurring → 0 PATCHes and "Popping can't send a Cookie header.".
  - FE2: type a header name, tap Add header → 0 PATCHes and no "Fill in both" message.
  - FE3: one half-filled new row, tap "Use a browser identity" → exactly 1 PATCH whose map has the User-Agent (and any saved headers) but not the half-filled row.
  - FF: delay the PATCH 1500 ms, change Address, tap Done → the sheet is gone at once; after the response, reopening shows the new address. Variant with the PATCH aborted → one red toast with "Open"; Open shows the typed address and the reason.
  - FH: delay the PATCH 800 ms, three quick `selectOption` calls on Check for new items → exactly 2 PATCHes, the second carrying the last value.
  - FI: a `GET /api/sources` that started before a PATCH and returns the old category after it → the UI keeps the new category.
  - FK: built-in bbc_news → Name and Address read-only, the interval is text, no Headers section; reddit fixture → no Headers.
  - FL: rename a feed that is in the active filter and in a saved view → the filter chip and the preset's `activeSources` use the new name.
  - FM: phone tab on "nhl" (one feed); recategorise that feed to "news" → the tab bar renders and a neighbouring column is selected. Second case: phone tab on "video"; move another feed into a new category "Hockey" → the tab is still "video".
  - FN: `page.clock.install({ time: F.NOW })` before goto, then `page.clock.runFor(65_000)` → no "refreshed" toast.
  - FO: the legacy-header fixture → the row error shows on open; editing another header sends nothing until that row is fixed or removed.
  - FV: tap a card's source name → the editor for that feed; `elementFromPoint` at the headline's bottom edge is not the source button.
  - FG2 (re-entry): open Settings from the Menu, Auto-add a feed, tap the toast's **Edit** (this calls `openSettings` while Settings is open) → that feed's editor opens; one Done closes Settings; `page.goBack()` keeps it closed.
  - FW: Delete a feed while a delayed stale poll is pending → the row and its stories disappear and no "Other" column appears.
- **Acceptance:** flows pass at 390; unit tests pass; smoke green at 390 and 320 with the editor states; `pytest -m no_db` passes (slice15, sitemap, slice19, slice21, slice30, the guard test); `grep -n 'datalist\|JSON.parse\|custom headers (JSON)' frontend/src/components/FeedManager.tsx frontend/src/components/feeds` is empty; lint 0 errors with FeedManager.tsx in scope; build passes.
- **Verification:** section 13 recipe; section 2 checks; CI; owner screenshots of the editor (custom, built-in, blocked, New-category mode, an error).
- **Depends on:** PR3, PR4, PR5.

### PR7. Cards, columns, dashboard and login sweep

- **Files:** frontend/src/App.tsx; frontend/src/components/{Card,Column,SearchResults,LoginPage,ShortcutsSheet,BriefCard}.tsx; frontend/scripts/iphone-audit/smoke.cjs (popover and login states; C7 adds `main.md\:hidden article`); frontend/eslint.config.js (adds Column.tsx, ShortcutsSheet.tsx, LoginPage.tsx).
- **Change:** every section 10 and 11 row marked 7.
- **Acceptance:** smoke green at 390 and 320 with the new states; C7 warnings gone for the dashboard and popover; lint 0 errors; build; `pytest -m no_db` (slice19 literals kept; slice21 and slice30 pass).
- **Verification:** section 13 recipe; section 2 checks; CI; owner screenshots of the dashboard tabs, a card and the popover.
- **Depends on:** PR6.

### PR8. Settings sweep and AI tab autosave

- **Files:** frontend/src/components/Settings.tsx; frontend/src/components/feeds/SaveStatus.tsx (reuse only); frontend/scripts/iphone-audit/{smoke.cjs (C10), flows.cjs}; frontend/eslint.config.js (adds Settings.tsx).
- **Change:** every row marked 8; the AI autosave rules (section 11).
- **Flows:**
  - FX: switch provider from Default to Ollama (local) → exactly 1 PUT with `provider`, `model_brief: ""`, `model_scoring: ""`.
  - FX2: switch to Anthropic with no key set → 0 PUTs and the key field shown; type a key, blur → 1 PUT with only `anthropic_api_key`, then 1 PUT with the provider fields.
  - FY: focus an empty key field and blur → 0 PUTs; type a key and blur → 1 PUT whose body has exactly one key; the input is empty afterwards and "Key saved" shows.
  - FZ: Reset → inline confirm, no dialog event.
- **Acceptance:** C10 passes; flows pass; no `window.confirm` in Settings.tsx; smoke green; lint 0 errors; build; `pytest -m no_db`.
- **Verification:** section 13 recipe; section 2 checks; CI; owner screenshots of the AI tab and Notifications.
- **Depends on:** PR6.

### PR9. Inline dialogs, strict guard, delete the 16px rule

- **Files:** frontend/src/App.tsx; frontend/src/components/Drawer.tsx; frontend/src/styles.css; frontend/src/lib/storage.ts and lib/preferences.tsx (low-priority items); frontend/scripts/iphone-audit/{smoke.cjs, flows.cjs}; frontend/eslint.config.js (final scope); .github/workflows/build.yml (`--strict` on the Chromium step).
- **Change:** inline Save current view and preset rename (section 9); delete styles.css:22-26 and add the base 17px rule; final lint scope; `--strict`. Low priority, last, droppable into a follow-up if the PR grows: brief tone persistence, Undo toasts, preference-failure toast.
- **Flows:** FPR: Save current view with an empty field → Save disabled; type "Hockey", Return → chip appears and toast "Saved view “Hockey”"; no dialog event. Rename via the chip → inline field prefilled; an unchanged value does nothing.
- **Acceptance:** `smoke.cjs --strict` is green at 390 and 320 locally and in CI's Chromium step (C6 and C7 strict); `grep -n 'pointer: coarse' frontend/src/styles.css` is empty; `grep -rnE 'window\.(prompt|confirm|alert)' frontend/src` is empty; lint 0 errors with the final scope and only the SourceIcon.tsx:68 disable; build; `pytest -m no_db`.
- **Verification:** section 13 recipe with `--strict`; section 2 checks; CI; owner checks focus zoom on the phone.
- **Depends on:** PR7, PR8.

### PR10. Side safe areas; the phone renders only the phone layout

- **Files:** frontend/src/App.tsx; frontend/src/components/{Drawer,Settings}.tsx; frontend/src/lib/visualViewport.ts.
- **Change:** the header (App.tsx:2210), the phone `<main>` (:2655, `p-3` becomes the `max(0.75rem, env(...))` form), the tab strip (:2668), the Drawer (:286-289) and the Settings sheet (:204) use `pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`. The desktop `<main>` (:2594-2653) renders only when `useMediaQuery('(min-width: 768px)')` is true (both `<Column` call sites stay in the source with `sourcesByName=`, slice19).
- **Acceptance:** smoke `--strict` green at 390 and 320; screenshots at 1024×768 and 1440×900 (a scratch Playwright script) show the desktop layout unchanged; React renders one Column on a phone context (count `section` elements under `main`); lint, build, `pytest -m no_db`.
- **Verification:** section 13 recipe; desktop screenshots; section 2 checks; CI; on the phone: rotate and check the notch side.
- **Depends on:** PR9.

### Open decisions and risks

**Non-goals** (larger regression surfaces, or not asked for):
- A push-navigation sheet, deleting the Drawer, a NavStack, swipe-down to close, pull-to-refresh, or regrouping Settings into fewer tabs.
- iOS Larger Text and Dynamic Type for web text (`-apple-system-body`, rem tokens): a home-screen web app does not scale px text; the 312 and 320 runs cover Page Zoom.
- Encrypting or masking header values (they stay plain text, with a warning).
- A service worker or offline mode, a router, Vitest or Jest, any frontend dependency, or package.json changes.
- Two-device edit conflicts: last write wins per field; there is no version column (models.py:40-99).
- Deleting `api.deletePreference` (api.ts:818-826) and the legacy Card `onHide` path.
- An OIDC sign-in flow from the home-screen app (LoginPage.tsx:52); local sign-in works.
- Desktop-only copy: "(local bypass)" (UserBadge.tsx:37), the raw health status (App.tsx:2344) and the star tooltip's "(s)" (Card.tsx:1392). None is visible on the iPhone.

**Open decisions** (each would mean materially different work; the default is in brackets):
1. **YouTube API key [no].** Only if, after PR1 is live, @handle lookups still fail from the VPS and pasting the channel ID is not acceptable. It adds www.googleapis.com as an outbound host and needs a Google Cloud key from the owner. Two ways: config.py and .env.example (both off-limits today), or the existing runtime-settings store, exposed only as `youtube_api_key_set` (the pattern at routes/settings.py:74-87), which avoids config.py. Either way the key travels in an `X-Goog-Api-Key` header, never the URL, because httpx logs request URLs at INFO (main.py:71-74).
2. **Merging categories that differ only in case or spaces [no].** PR6 shows them as "News (“news”)" and lets the user move feeds one at a time. A "Rename this category for all its feeds" action would be a new Settings feature with a bulk PATCH loop, partial-failure handling, moving server-side column preferences, and its own tests.
3. **Landscape keeps the phone layout [no].** Not requested; the owner uses portrait. If chosen: `theme.screens.md = { raw: '(min-width: 768px) and (min-height: 560px), (min-width: 1024px)' }` keeping sm, lg, xl, 2xl; switch every header `sm:` together (App.tsx:2220, :2224, :2231, :2294, :2341, plus PR2's `hidden sm:block` and `sm:flex-none` search classes); a `PHONE_QUERY` in lib/visualViewport.ts used by BriefCard.tsx:372 and :385 (today 639px, so 640-767 behaviour changes too) and by the Settings keyboard query; grep the built CSS to confirm `md` blocks sit after `sm` and before `lg`; add an 844×390 smoke state; desktop screenshots at 1024 and 1440.
4. **Column header tap marks the column read; "+N new" refreshes; no "Mark all as read" in the ⋯ menu [unchanged].** Column.tsx:314-325 and :339-357 are real hazards but behaviour the owner did not raise. If changed: header static on touch (drop `role="button"` and `tabIndex` there), a 44px "Mark all as read" first in the ⋯ popover inside `popoverRef`, and the chip as a plain badge.
5. **Sign out in the phone Menu [no].** Not requested. If added: pass `onSignOut` only when `user && user.auth_method !== 'bypass'` (sign-out is a no-op for bypass, UserBadge.tsx:5-10), tone destructive, and ship the LoginPage attributes (PR7) first so the first phone sign-out cannot strand the owner at a login that capitalises "adam".
6. **Subreddit Test and category validation in /test [no].** Test on a subreddit fails today (routes/sources.py:1007-1009 imports `fetch_subreddit` from a module that only defines `normalize_subreddit`). The fix is three lines (`from app.reddit_client import fetch_subreddit`, `normalize_subreddit(url)`, `not_found` on an empty list) plus tests; outside the ten requirements.
7. **Readable YouTube names from the channel title [no].** The resolver could return `videoDetails.author` or `og:title` so names read "Mkbhd" instead of `channel_ab12cd_yt`; it needs a new SourceTestResult field, which widens the schemas.py rule.
8. **`SourceCreate.refresh_interval_seconds` optional [no].** Making it `Optional[int] = None` (schemas.py:95) would revive the per-type defaults (routes/sources.py:476-487); instead every frontend caller sends a value.

**Risks:**
- **Source-text guard tests** (slice15, test_source_create_sitemap_link_pattern, slice19, slice21, slice30) pin literals in FeedManager.tsx, api.ts, Column.tsx, App.tsx and Card.tsx. Mitigation: the editor lives in new files, FeedManager.tsx uses string-literal placeholders, the pinned literals are listed in sections 3, 6 and 11, and `pytest -m no_db` runs before every push.
- **iOS select `change` timing** cannot be checked in Chromium. On iOS 16+ the select is a popup menu; if `change` fires more than once, coalescing caps it at two PATCHes. On the PR6 phone list.
- **Keyboard on "New category" and "Add header"** depends on focus inside the tap; Chromium cannot show it. On the PR4 and PR6 phone lists.
- **WebKit on Linux is not iOS Safari.** It stays report-only; the implementer reads its output on each PR.
- **Fonts:** Chromium on Linux lays out with a fallback font, not SF Pro, so near misses at 390 can still overflow on the phone. 320 and 312 are enforced floors.
- **YouTube may still block the VPS** even with consent cookies and a browser UA, and SOCS=CAI may stop working. Mitigation: offline resolution of ids, feed links and UU playlists; plain messages that teach the channel ID; the verified /user fallback; the lookup log line; open decision 1.
- **A PATCH aborted after 35 s may still apply** on the server. The UI shows an error and offers Try again (same value, idempotent); the next poll reconciles.
- **keepalive flushes** depend on iOS delivering `visibilitychange` or `pagehide` before suspension. If the app is killed with a field focused, that edit is lost.
- **Save store and polling overlay bugs** could show stale values. The unit tests and flows FF, FI, FL, FW pin the behaviour.
- **`history.back()`** in closeSettings is used only when `history.state.popping === 'settings'`, so it never leaves the app; flows FG and FG2 cover it.
- **Scheduler change** (category-only early return) alters when ingests happen; pinned by the fake-scheduler test. Name, URL and header changes still rebuild by design.
- **Phantom row on rename (low, pre-existing):** `_ingest` finds the row by plugin name (scheduler.py:117-133); an ingest already running when a rename commits can recreate a row under the old name. Autosave sends one rename per blur, as today, so the risk is unchanged.
- **Container queries need iOS 16+.** Older Safari keeps today's thumbnail beside the title.
- **PR size:** PR6 is the largest. If review gets hard, split it into "store and App wiring" and "editor UI", keeping the flows with the second.
- **Header values are plain text** readable by anyone who can open Popping. The UI warns; the deny list keeps Cookie, Authorization and Proxy-Authorization out.
- **Playwright in CI** is pinned to 1.56.1 with `--no-save`. A runner image change could break `--with-deps`; nothing reaches the Docker images or dependabot.

## 13. How to verify

**Frontend, every PR, in the container** (set `SCRATCHPAD` to the scratchpad directory from your system prompt):
```bash
cd /home/user/popping/frontend && npm ci        # never run `npx playwright install` here (the CDN is blocked)
npm run lint                                    # 0 errors; at most the 6 baseline warnings
npm run build                                   # check-html-comments + tsc + vite
node --experimental-strip-types --test 'scripts/unit/*.test.ts'   # from PR3; the quotes matter
S="$SCRATCHPAD/smoke"; mkdir -p "$S"
pkill -f 'vite preview --host 127.0.0.1 --port 4173' || true
./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort > "$S/preview.log" 2>&1 &
P=$!
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 0.5; done
curl -sf -o /dev/null http://127.0.0.1:4173/ || { cat "$S/preview.log"; kill $P; exit 1; }
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --out "$S"; echo "smoke exit=$?"
kill $P
```
- Look at every PNG in `$S` at 390 and 320 (and 312 from PR5). The rules catch overflow; your eyes catch "this looks wrong". These PNGs are the owner's screenshots.
- Playwright 1.56.1 and Chromium are preinstalled (`/opt/node-tools/node_modules/playwright`, resolved through `NODE_PATH`; browsers in /opt/pw-browsers), so the scripts stay `.cjs` and no package is installed. WebKit cannot be downloaded here; it runs only in CI.
- Guard self-test (PR2, recorded in the PR body): add `w-[500px]` to the h1; smoke exits 1 on C2 and C3; revert and it passes.

**Backend, locally** (CI is the authority; `-m no_db` is required before every push):
1. pgvector: if `/usr/lib/postgresql/16/lib/vector.so` is missing, build pgvector v0.8.7 from source with `PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config` (apt's postgresql-16-pgvector is 0.6.0).
2. As the postgres user: `/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/popping-test --auth=trust`, then `/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/popping-test -l /tmp/pg.log start` (the binaries are not on PATH).
3. Create user and database `popping_test` (password `popping_test`), then `CREATE EXTENSION vector` in it.
4. Add /etc/hosts entries for example.com, example.org, example.net, reddit.com and www.reddit.com pointing at public addresses (for example 93.184.215.14 and 151.101.1.140). The container has no DNS and the SSRF guard resolves names (url_safety.py:150); even `-m no_db` needs this (test_url_safety.py::test_ssrf_event_hook_is_a_valid_async_request_hook fails without it). The new YouTube tests patch getaddrinfo themselves.
5. `uv venv --python 3.12 /home/user/popping/backend/.venv && uv pip install --python /home/user/popping/backend/.venv/bin/python --no-deps -r /home/user/popping/backend/requirements-dev.lock` (system python is 3.13 without deps; `.venv/` is git-ignored).
6. `cd /home/user/popping/backend && PYTHONPATH=$PWD .venv/bin/python -m pytest -m no_db -q -p no:cacheprovider` (about 11 s), then `POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=popping_test POSTGRES_PASSWORD=popping_test POSTGRES_DB=popping_test PYTHONPATH=$PWD .venv/bin/python -m pytest -ra -q -p no:cacheprovider`.

**CI:**
- Open draft PRs with `gh api repos/adamjmachill/popping/pulls -f title='…' -f head='<branch>' -f base=main -F draft=true -f body='…'` (or the GitHub MCP `create_pull_request` tool).
- Poll `gh api repos/adamjmachill/popping/commits/<sha>/check-runs --jq '.check_runs[]|"\(.id) \(.name) \(.status) \(.conclusion)"'` until `backend tests`, `frontend lint + build`, `backend image` and `frontend image` all report success.
- Read failures with `gh api repos/adamjmachill/popping/check-runs/<id>/annotations` (backend failures and smoke failures are emitted as `::error::` annotations); raw job logs may need admin rights. CI screenshots are not retrievable.

**On-phone checks after each popping-update** (owner, about 2 minutes; Chromium cannot show these):
- **After PR1:** add a YouTube channel by @handle. If it fails, the message says what to paste, and pasting the channel ID works. Read one `youtube: lookup` line (section 2).
- **After PR2:** open search with Page Zoom at 125%: nothing runs off. Tap the Auto feed box: no zoom. Drag the dashboard up and down: the header does not move. Tap a card: it does not stay lifted. Swipe a card: it follows the finger.
- **After PR4:** add a channel by link, by @handle and by channel ID; paste a YouTube link into Auto feed; in the Add form tap **New category**: the keyboard comes up.
- **After PR5:** ≡ → › opens that feed; ≡ → Settings opens Feeds; Jump to column switches the tab. In a Safari tab (not the home-screen icon): Settings → Done → swipe back: Settings stays closed.
- **After PR6:**
  - change a category with the picker: a single "Saved ✓" (this checks iOS `change` timing);
  - **New category** and **Add header**: the keyboard comes up;
  - focus the address field: Done and the field stay visible above the keyboard;
  - switch apps mid-edit, then come back: the edit saved;
  - "Use a browser identity" on a blocked feed;
  - tap a card's source name: its editor opens.
- **After PR7:** tabs, filter chips and ⋯ are easy to hit; long-press a headline: the normal iOS link menu; sign in with a lower-case username works.
- **After PR8:** AI tab: change a model; paste a key; there is no Save button.
- **After PR9:** focus every field type (search, login, AI key, editor fields): no zoom. Save current view with the inline field.
- **After PR10:** rotate to landscape: nothing under the notch on either side.

## 14. How to start the session

Open a new Claude Code session on this repository with the model and effort from section 1, and paste:

```
Implement the redesign in REDESIGN_PLAN.md on the claude/redesign-plan branch (read it with `git show origin/claude/redesign-plan:REDESIGN_PLAN.md`; sections 2 to 14 are the spec). Work one PR at a time in the order of section 12 (PR1 to PR10), each on a new branch from up-to-date origin/main, each opened as a draft PR to main through the REST API (gh pr create is blocked) or the GitHub MCP tool. In PR2, step 0 restores frontend/scripts/iphone-audit from the plan branch; never bring .redesign/ or REDESIGN_*.md into a PR.

Before every push, run the whole section 13 recipe (lint, build, unit tests from PR3, the smoke test with --csp, and pytest -m no_db), look at every screenshot, and fix what it shows. Before asking to merge, pass every section 2 check: the path check, the narrow-file checks, the backend greps, the security-review skill, and four green check runs.

Stay inside the section 2 file list. If a change needs any other file, stop and ask me.

Re-check every file:line against the current code before editing; lines drift. Keep every literal the backend guard tests pin (sections 3, 6, 11). Every string the app shows uses plain words, no developer terms, no exclamation points.

Merging is the release: before each merge send me the 390-wide screenshots of the changed screens with three lines on what to look for, and wait for my "go". After each merge, tell me in three lines what to check on the phone after popping-update (section 13).
```

If there is quota for only one PR, start with PR1 and PR2: PR1 fixes YouTube on the server, and PR2 is visible at once and installs the guard that keeps overflow from coming back. They are independent and can run in parallel.
