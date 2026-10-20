# PR11a: Preview endpoint, browser headers, PATCH type

Backend track. A preview route for the Add field, the Safari headers it retries with, and PATCH
`type` for Find its feed. No migration, no frontend, no flows or smoke states. Inert: nothing
calls the preview until PR11b, and nothing sends PATCH `type` until PR11c.

Built on PR10b (#39, `plan_candidates`, `raise_errors`, header threading), which was still in
review when this unit was written; PR4a (`select_items_for_ingest`, the `_ingest` in-flight
guard) and PR9a (`NotAFeedError`) are merged. A first pass of this unit was paused partway (the
WIP commit); this commit reviews and completes it.

## What changed

- **`rss.BROWSER_HEADERS`**: the Safari User-Agent from `headers.ts` (`BROWSER_USER_AGENT`) plus
  `Accept-Language: en-CA,en;q=0.9` (the "Prefer English" preset). Pinned against `headers.ts`
  in `test_frontend_feed_editor_rules.py`, which reads only the User-Agent.
- **`rss.py` split**: `fetch_rss`'s body is now `get_feed_response` (one SSRF-guarded GET: the
  per-hop `ssrf_event_hook` and the final-URL check, unchanged) and `parse_feed` (the parse and
  both "not a feed" / "malformed" checks, unchanged, plus the feed's title and a `podcast` flag:
  an audio enclosure or the iTunes namespace). `fetch_rss` calls both, so its behaviour, retries
  and messages are as before.
- **`app/thread_work.py`** (new): `run_in_thread`, `tracked()` and `drain()`. Outside `tracked()`
  `run_in_thread` is `asyncio.to_thread`. Inside, every thread started (also from tasks the block
  starts) is recorded, and `drain` waits for each one. The parsing calls the preview reaches use
  it: `parse_feed`, trafilatura's `determine_feed`, the sitemap and listing parses
  (`_crawl_sitemaps`, `_discover_page_links`) and page scoring (`preview_page`). This is what
  makes "the slot is held until the thread work ends" true: `asyncio.to_thread` gives a
  cancelled waiter no way to wait for its thread.
- **`discover_feed_url(page_url, headers=None, *, tried_as_feed, page_html, probe)`**: `headers`
  goes on the page fetch and every feed probe (moved here from PR9). The preview passes
  `tried_as_feed` (it already fetched the address as a feed), `page_html` (the page that came
  back, so it isn't fetched again) and `probe` (its own one-attempt fetch that keeps the parse).
  Every existing caller is unchanged.
- **`generic_scrape.preview_page(candidate, headers, owner_configured=)`**: one candidate read the
  way a check reads it (`fetch_html_checked`, the extraction and `score_page` via `_judge_page`,
  the 30-day rule), returning `{title, url, published_at, accepted, reason}`. `_read_page` is now
  `_judge_page(...)[0]`, so the plugin's path is unchanged. Reasons: `no_text`, `not_article`,
  `unreadable`, `refused`, `failed`, `too_old`.
- **`app/source_preview.py`** (new) and **`POST /api/sources/preview`** (`_write_deps`, on the
  sources router, so inside `main.py`'s `_api_deps`; body `SourcePreviewRequest`, unknown fields
  refused; response `SourcePreviewResult`; writes nothing):
  1. YouTube and Apple Podcasts links resolve to their feed (a failure is `not_found`).
  2. A subreddit (`reddit.com/r/x` or `r/x`, or `type: "reddit"`): `reddit_client.is_disabled()`
     first, `reddit_off`; then the hot listing of 50, as `DynamicRedditPlugin` reads it.
  3. The address as a feed: one GET through `get_feed_response`, connect 6 s, read 12 s. A 401,
     402 or 403, a `cf-mitigated: challenge` header or a challenge page is retried once with
     `BROWSER_HEADERS` when the caller sent no User-Agent; `headers_used` is then `browser`.
     A timeout moves on to discovery. When discovery or the website read could still follow,
     this step gets at most half the time left.
  4. `discover_feed_url` with the step-3 page and headers (half the time left when step 5 could
     follow). Each feed link tried is recorded in `feed_candidates`.
  5. `plan_candidates(..., raise_errors=True)` (a refusal is retried as Safari the same way), then
     the 8 newest candidates read with `preview_page`, 3 at a time.
  - **Deadline:** `PREVIEW_BUDGET_S = 60`; each step gets `min(cap, time left)`. Out of time, the
    response is `error_kind: "timeout"` with what is known (kind, url, items or pages read,
    `feed_candidates`).
  - **Semaphore:** `PREVIEW_CONCURRENCY = 2`, no queue (`busy` at once). The pipeline runs in a
    task that owns the slot; the request waits with `wait_for(shield(task), time left)`. The task
    waits out its threads (`drain`) before it ends and releases the slot.
  - **Cache:** 120 s, 32 entries, upstream only (`_Upstream`), keyed on the URL, type, sitemap
    URL, link pattern and a SHA-256 of the lower-cased, sorted headers. Only previews that worked
    are kept; a task that outlives its response can still fill it. `duplicate_of`,
    `already_stored_count`, `will_add_count` and `older_skipped_count` are computed on every
    request (`build_result`, `scheduler._stored_urls`, `scheduler._ingest_tunables`).
  - **Counts, feed mode:** `select_items_for_ingest(first_fetch=True)` with the live `ingest.*`
    knobs. Each item's `reason` is `stored`, `older` or `over_cap` (over `max_per_poll`).
  - **Counts, website mode:** `total_count` is every candidate the plan accepted. The first-fetch
    rule runs over them (a page read and turned down is left out; one not read is dated by its
    list: the listing card's or news sitemap's date, else `<lastmod>`), and `will_add_count =
    min(kept, 10, dated + max_undated_per_poll)`. `older_skipped_count` is what that rule left
    out. `items` are the pages read.
  - **`kind`:** the type the caller named; with none, `podcast` when the feed has an audio
    enclosure or the iTunes namespace, else `rss`; `youtube_channel`, `reddit`,
    `generic_scrape` from their steps.
  - **`error`:** one fixed sentence per `error_kind` (`source_preview.ERRORS`), never upstream
    text, an exception or an address. A private host's message is the one `/sources/test` gives
    (`_validate_url`'s). `headers_used` is `default | browser | custom`; header values are never
    returned.
  - `/sources/test` and `_test_source_impl` are unchanged.
- **PATCH `type`** (`SourceUpdate.type`, `update_source(type_=)`):
  - Only between `rss`, `podcast` and `generic_scrape`, both before and after (422 otherwise);
    the same type is no change. Built-ins: 400 in the route, and `update_source` raises
    `ValueError` too (mapped to 400).
  - The URL is validated as the new type reads it; a type change alone re-checks the stored URL.
  - `type_changed` joins the nothing-changed return and the category-only return. A change sets
    `last_error = NULL`, `error_count = 0`, `last_fetch_at = NULL` and a new `created_at`
    baseline, and the job is rebuilt with the new type's plugin (`_add_or_replace_dynamic_job`).
  - `row_fetch_target` is now `(type, url, sitemap_url, link_pattern)`, so `_ingest`'s in-flight
    guard discards a batch (and skips the bookkeeping, failure included) when the type changed
    during the poll, for both a job still holding the old plugin and a class-driven snapshot.
- **Docs:** `ARCHITECTURE.md` lists `_slots`, `_tasks`, `_cache` and `thread_work._running`, with
  the thread behaviour, and what breaks under several workers. `README.md` lists the route.

## Deviations from the spec, and why

- **402 counts as a refusal** next to 401 and 403 (D12 and PR10b's `FetchRefusedError` treat
  401-403 alike).
- **`invalid_url`'s sentence** is `/sources/test`'s `_validate_url` text, "url is not reachable
  (must be a public host)", because the spec asks for the generic `/sources/test` message. It
  reads like an API error; PR12b's copy sweep can change both together.
- **Extra response field `feed_candidates`**: the feed links discovery found, the "Find its feed
  candidates" the spec says a timeout returns.
- **`get_feed_response` and `parse_feed`** are new public halves of `fetch_rss`. The rule lists
  `fetch_rss` as a permitted fetcher; the preview needs one attempt with a short read and the raw
  status and body (for the 403 / challenge retry and to hand the page to discovery), which
  `fetch_rss` can't give. The guard code was moved, not copied, and `fetch_rss` uses it.
- **`thread_work`** is new; without it a timed-out wait on `asyncio.to_thread` can't keep the
  slot until the thread ends.
- **Failed previews aren't cached**, so a retry after a blip fetches again.
- **The Safari retry merges `BROWSER_HEADERS` over the caller's own headers** when those carry no
  User-Agent; `headers_used` is then `browser`.
- **Duplicate lookup** matches the previewed URL exactly, with and without a trailing slash.
  PR11b defines the normalized lookup (lower-case host) and the 409.
- **PATCH `type` keeps `last_attempt_at`, `last_item_count` and `last_new_count`**: they describe
  the last attempt. The new `created_at` baseline is what PR11b's poll compares against.
- An address without `http(s)://` (other than a subreddit reference or a YouTube handle) is
  `invalid_url`; the Add field (PR11b) adds the scheme.

## Verification

- **Backend pytest** (database `popping_test_b2`): 1487 passed, 13 failed. The 13 are exactly the
  DNS-only baseline list (`/root/popping-env/baseline.txt`). New: `test_sources_preview.py` (30
  tests), `test_source_patch_type.py` (16), and the `BROWSER_HEADERS` pin. The preview and PATCH
  files were run 3 times in a row, all green.
- **Harness:** `fake_dns` plus an httpx `MockTransport` patched into `httpx.AsyncClient` (the
  test's own ASGI client keeps its transport). The real `check_url_safe` and `ssrf_event_hook`
  run; no production toggle, no network.
- **Frontend:** no frontend change. Lint (0 errors, 5 existing warnings), build and the 97 unit
  tests pass with the `node_modules` symlink, removed afterwards. Strict smoke not run (nothing
  it renders changed).
- **Mutation checks** (break the line, run the guarding test, restore, `md5sum -c` clean). Every
  one failed as expected:
  - `wait_for(shield(task))` → `wait_for(task)`: `test_a_parse_past_the_deadline_keeps_its_slot`.
  - The `busy` check removed (requests queue): same test.
  - Step 3 given the whole budget: `test_a_hanging_feed_fetch_still_leaves_time_for_discovery`.
  - Headers, then link pattern, dropped from the cache key: `test_headers_are_part_of_the_key`,
    `test_other_options_fetch_again`.
  - Stored URLs not read per request: `test_feed_counts_and_fresh_duplicate_after_an_add`.
  - Browser retry despite the caller's User-Agent; no retry in feed mode; no retry in website
    mode: the three blocked tests.
  - `reddit_off` check removed: `test_reddit_off`.
  - SSRF reason returned as the error: `test_a_private_host_gets_the_test_routes_message`.
  - SSRF hook removed from `get_feed_response`: `test_a_redirect_to_a_private_host_is_refused`.
  - iTunes podcast detection off: `test_a_podcast_feed_is_kind_podcast[itunes]`.
  - Step-3 page not passed to discovery:
    `test_a_page_with_a_feed_link_is_read_once_and_previews_its_feed`.
  - Undated cap left out of website counts: `test_website_undated_pages_count_at_most_two`.
  - `discover_feed_url` dropping `headers`: `test_discover_feed_url_sends_the_headers`.
  - `type` dropped from `row_fetch_target`: both in-flight tests.
  - `type_changed` out of the nothing-changed guard; error fields kept; `last_fetch_at` kept:
    `test_allowed_type_change_starts_the_feed_over`.
  - Other type pairs allowed: `test_other_type_pairs_are_refused`.
  - The route's built-in guard, then `update_source`'s, removed: the two built-in tests.
  - Type-only change skipping the URL check: `test_the_url_is_checked_as_the_new_type`.
  - `BROWSER_HEADERS` User-Agent changed: `test_browser_user_agent_matches`.
- **Security checklist:** the route is on the sources router inside `_api_deps`
  (`test_oidc_route_gating.py` passes) and behind `_write_deps`; it takes a Pydantic body with
  `extra="forbid"` and has no side effects; every fetch goes through the SSRF-guarded fetchers
  (`get_feed_response`, `fetch_html`, `fetch_html_checked`, `reddit_client`, and the fixed-host
  YouTube and Apple lookups); `trafilatura` is only a parser; no error text carries upstream
  content, exception text or addresses; header values are never echoed. The unit's review step
  (`/security-review` + `/code-review high`) runs on the PR.

## Device checks

None. The preview route and PATCH `type` have no caller until PR11b and PR11c, so nothing on the
device changes. The `fetch_rss` split and the type in the in-flight guard are covered by the
existing checks that feeds keep updating (#35).

## Open items for later units

- **PR11b:** `api.previewSource`; show `error` as given; on `busy`, offer a retry; on
  `headers_used: "browser"`, store the "Use a browser identity" and "Prefer English" presets with
  Add (the response carries no header values) and show "Reading as Safari · Undo"; prefix
  `https://` to a bare address; `duplicate_of` is a hint, the 409 is PR11b's.
- **PR11c:** PATCH `{type, url}` with `sitemap_url` and `link_pattern` cleared; previews the found
  feed first with `type: "rss"`.
- **PR12b:** the `invalid_url` sentence (shared with `/sources/test`).
- Revert: safe while nothing calls the route. Once PR11b merges, fix forward or revert newest
  first.
