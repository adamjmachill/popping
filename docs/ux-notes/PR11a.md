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
     402 or 403, a `cf-mitigated: challenge` header or a challenge page is retried once as
     Safari when the caller sent no User-Agent; `headers_used` is then `browser`. A challenge
     page is matched only by markers of the interstitial itself (`<title>Just a moment`,
     `_cf_chl_opt`, `cf-chl-`, Cloudflare's "Attention Required!", `<title>DDoS-Guard`,
     `px-captcha`), never by the `challenge-platform` script Cloudflare's bot detection loads
     into ordinary pages. A timeout moves on to discovery. When discovery or the website read
     could still follow, this step gets at most half the time left: the half is worked out once,
     and the first GET and the Safari retry both come out of it (each still capped at 18 s).
  4. `discover_feed_url` with the step-3 page and headers (half the time left when step 5 could
     follow). Each feed link tried is recorded in `feed_candidates`. The caller's headers go only
     to feed links on the page's own site (the same registrable domain,
     `feed_autodiscovery.probe_headers`); a link on another host gets the default headers, plus
     the public Safari preset once the site needed it. `discover_feed_url`'s default probe
     follows the same rule.
  5. `plan_candidates(..., raise_errors=True)` (a refusal is retried as Safari the same way), then
     the 8 newest candidates read with `preview_page`, 3 at a time. When every page read is
     refused (the site serves its sitemap but not its articles), the same pages are read again
     as Safari when the caller sent no User-Agent, inside the same step and deadline;
     `headers_used` becomes `browser` once one is served. Still all refused, or no retry
     allowed: `blocked`, or `http_error` when every refusal was a 429 (not retried), as Add's
     first check ends (`_settle_refusals`). A refused verdict carries its `status` for this.
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
  - **`kind`:** for a feed, `podcast` when it has an audio enclosure or the iTunes namespace,
    else `rss`, whether the caller named `rss`, `podcast` or no type (a named feed type means
    "read it as a feed"). `youtube_channel` when named or when the address is a YouTube one,
    the canonical `feeds/videos.xml?channel_id=` address included (as `/sources/auto` types
    it), unless the caller named `rss` or `podcast`. `reddit` and `generic_scrape` from their
    steps. A named or resolved feed type is the `kind` from the start, so a preview that runs
    out of time still returns it.
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
- **The Safari retry keeps the caller's own headers** and adds the `BROWSER_HEADERS` the caller
  didn't set (`{**BROWSER_HEADERS, **headers}`), which is always the User-Agent (the retry runs
  only without one) and the `Accept-Language` unless the caller sent its own. `headers_used` is
  then `browser`.
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

## Review fixes

Eight confirmed review findings, all fixed (the sections above describe the fixed behaviour):

1. **Discovery sent the caller's headers to feed links on other hosts.** `probe_headers` keeps
   them on the page's registrable domain, in the preview's probe and `discover_feed_url`'s
   default one. Tests: `test_a_feed_link_on_another_site_never_gets_the_callers_headers`,
   `test_discover_feed_url_keeps_the_headers_on_the_pages_site`.
2. **An ordinary Cloudflare page read as a challenge** (the bare `challenge-platform` and
   `ddos-guard` markers). Only interstitial markers are kept. Test:
   `test_an_ordinary_cloudflare_page_is_not_a_challenge`.
3. **Article pages that refused us got no Safari retry**, and the preview still said ok with
   stories to add. Website mode now retries them and ends `blocked` / `http_error` as Add's
   first check would. Tests: `test_article_pages_that_refuse_us_are_retried_as_safari`,
   `test_article_pages_refusing_the_callers_user_agent_are_blocked`,
   `test_article_pages_that_rate_limit_us_are_an_http_error`.
4. **A pasted YouTube feed address came back as `rss`.** Test:
   `test_a_pasted_youtube_feed_is_a_youtube_channel` (and a named `rss` is kept).
5. **Step 3 and its Safari retry could use more than half the deadline** (the half was taken
   per attempt). It is now taken once. Test:
   `test_a_slow_refusal_and_a_hanging_retry_share_one_half`.
6. **A timed-out YouTube or typed feed preview returned `kind: null`.** Tests:
   `test_a_youtube_feed_that_hangs_still_says_its_kind`, and a `kind` check in
   `test_running_out_returns_timeout_with_what_is_known`.
7. **A named `rss` overrode the podcast rule** (so Find its feed could never yield a podcast).
   Fixed in code rather than listed as a deviation. Test:
   `test_a_named_feed_type_still_reads_the_feeds_kind` (replaces
   `test_a_named_type_is_the_kind`).
8. **The Safari retry replaced the caller's own `Accept-Language`.** `_as_browser` merges the
   presets under the caller's headers. Tests: the `callers-own` cases of
   `test_a_403_feed_is_retried_as_safari`, `test_a_403_website_is_retried_as_safari` and
   `test_article_pages_that_refuse_us_are_retried_as_safari`.

Not changed: a redirect from the caller's own site to another host still carries the caller's
custom headers (httpx drops only `Authorization` across origins). That is how every feed's
`custom_headers` already behave in `fetch_rss` and `fetch_html`, before this unit, so it is not
this unit's to change.

**Verification of the fixes** (database `popping_test_b2`):
- Backend pytest: 1501 passed, 13 failed, the 13 exactly the DNS-only baseline list.
  `test_sources_preview.py` is now 44 tests; it and `test_source_patch_type.py` were run 3 times
  in a row, all green.
- The 15 new or changed preview cases all fail against the first commit's code.
- Mutation checks (break the line, run the guarding tests, restore from a copy, `md5sum -c`
  clean), each failed as expected:
  - `_as_browser` merging the presets over the caller's headers: the three `callers-own` cases.
  - `probe_headers` returning the headers for any host: both cross-host tests. The preview's
    probe ignoring `probe_headers`: the preview's cross-host test.
  - No page retry: the two page-retry cases. A page retry despite the caller's User-Agent:
    `..._refusing_the_callers_user_agent_are_blocked`. 429s mapped to `blocked`:
    `..._rate_limit_us_are_an_http_error`.
  - The YouTube-address check dropped: both YouTube tests.
  - The early `state.kind` dropped: both timeout `kind` checks.
  - A named feed type kept as the kind: the `rss-True-podcast` and `podcast-False-rss` cases.
  - `challenge-platform` put back in the markers: the Cloudflare test.
  - The half taken per attempt again: the shared-half test.

## Device checks

None. The preview route and PATCH `type` have no caller until PR11b and PR11c, so nothing on the
device changes. The `fetch_rss` split and the type in the in-flight guard are covered by the
existing checks that feeds keep updating (#35).

## Open items for later units

- **PR11b:** `api.previewSource`; show `error` as given; on `busy`, offer a retry; on
  `headers_used: "browser"`, add to the headers it sent the presets it didn't set itself: "Use a
  browser identity" always, "Prefer English" only when it sent no `Accept-Language` (the
  response carries no header values, and the preview kept the caller's own), store them with
  Add and show "Reading as Safari · Undo"; prefix
  `https://` to a bare address; `duplicate_of` is a hint, the 409 is PR11b's.
- **PR11c:** previews the found feed first with `type: "rss"`, then PATCHes `{type: <the
  preview's kind>, url}` (`podcast` for a podcast feed, else `rss`) with `sitemap_url` and
  `link_pattern` cleared.
- **PR12b:** the `invalid_url` sentence (shared with `/sources/test`).
- Revert: safe while nothing calls the route. Once PR11b merges, fix forward or revert newest
  first.
