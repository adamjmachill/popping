# PR10b: Website crawl wiring and errors

Backend track. Wires PR10a's `article_detect` library into website feeds (`generic_scrape`) and
the sitemap crawl (`feed_autodiscovery`), and makes a website feed's failures say what they are.
No migration, no route, no frontend, no flows or smoke states.

## Plan (written before the code)

### Anchors checked against main 9e41130

- `generic_scrape.py`: `_section_candidates` (103) still has the whole-sitemap fallback;
  `_extract_one` (123) runs `bare_extraction` in `asyncio.to_thread` (PR1a);
  `_extract_links_from_html` is at 280 (spec: 268), `_discover_page_links` at 344 (spec: 332),
  `fetch()` at 438. Every fetch goes through `fetch_html`, which returns None on any error.
- `feed_autodiscovery.py`: `discover_sitemap_urls` (199) with the catch-all that turns every
  exception into `[]` (224-235); `_GUESSED_SITEMAP_PATHS` (246); `_parse_sitemap_entries` (284)
  returns `(loc, lastmod)`; `_newest_first` (347); `_crawl_sitemaps` (363), robots.txt at 375,
  empty documents skipped at 393-395.
- `article_extract.py`: `fetch_html` (60) returns None for every status of 400 or more. There is
  **no `fetch_html_checked`**: the spec names it as if it existed. This unit adds it.
- `scheduler._ingest_once`: the known-URL query is in the commit session (now 745-752); the
  tunables are read after `plugin.fetch()`; `_classify_error` maps `httpx.HTTPStatusError`
  401-403 to `blocked`, 429 to `http error`, and `asyncio.TimeoutError` to `network` (PR9a).
- `NoArticleListError` is in `app/sources/base.py` and is a setup state (PR9a).
- `ingest_rules.IngestTunables.max_undated_per_poll` (default 2) exists (PR4a).
- Pins: `test_b1_b8_coverage_gaps.py:285-319` (`fetch_html` signature and header merge),
  `:221-283` (`_extract_one` passes `custom_headers=custom_headers`, `fetch()` passes
  `custom_headers=self.custom_headers`, `__init__` reads `custom_headers`).

### Design

- **`article_extract`:** `FetchRefusedError(httpx.HTTPStatusError)` for 401, 402, 403 and 429.
  `fetch_html` keeps the header merge in its own body and gains `return_final_url`.
  `fetch_html_checked` delegates to it and raises instead of returning None: refusals as
  `FetchRefusedError`, and connect errors and timeouts as the httpx error. With
  `raise_for_status=True` (only for the user's own listing URL or sitemap) any other 4xx or 5xx
  raises `httpx.HTTPStatusError`; otherwise those still read as an empty document.
- **`feed_autodiscovery`:** `_parse_sitemap_entries` returns `(url, date, title)` (the date is a
  news sitemap's publication date, else `<lastmod>`). `_crawl_sitemaps` orders and skips
  sitemaps with `order_sitemaps`, keeps entries that pass `url_ok`, parses and filters each
  document in a thread, and returns `Candidate(url, published, title)` newest first. A new
  `discover_sitemap_entries(..., headers=, raise_errors=)` returns them; `discover_sitemap_urls`
  keeps returning `list[str]` and never raises, for `/auto`. With `raise_errors`, an empty crawl
  raises: the input sitemap's own failure; a refusal when every sitemap document was refused
  (a refused robots.txt alone never counts); a network error; the crawl budget's
  `asyncio.TimeoutError`.
- **`generic_scrape`:** `plan_candidates(url, sitemap_url, link_pattern, headers, known_urls)`
  → `Plan(mode, candidates, fresh)` serves `fetch` and `probe`.
  - Two reads, the listing page and the sitemap. A section URL reads the page first; a site
    root or an explicit `sitemap_url` reads the sitemap first; a URL that is itself a sitemap
    reads only the sitemap. The first read that finds articles wins.
  - The page read uses the link pattern's prefix filter (today's `_extract_links_from_html`)
    when there is one, and `listing_links` otherwise. The sitemap read is scoped to the link
    pattern, else the URL's section. No whole-sitemap fallback.
  - Every candidate passes `url_ok` and the link pattern.
  - Empty raw discovery raises the most telling failure (a refusal, then the user's own URL
    failing, then a network error), else `NoArticleListError`. With candidates, failures of
    the other read are ignored. `probe` and `/auto` never raise.
  - Stored URLs are skipped through the injected `known_urls` before extraction.
- **`_extract_one`:** `fetch_html_checked(..., return_final_url=True)`, then one
  `asyncio.to_thread` call that runs `bare_extraction` and `score_page(owner_configured=...)`. A
  page under `ACCEPT_SCORE` is rejected. A refusal raises; other failures return None, as today.
- **`fetch()`:**
  - A refused page is not marked extracted.
  - When every fetch in a non-empty batch was refused, one page of the site outside the batch is
    fetched as a control. If it is refused too (or there is none), the poll raises the refusal
    (`[blocked]`, or `[http error]` for 429). If it loads, the refusals are the pages' own
    (members-only pages), and the 401-403 ones are marked so they don't block the feed.
  - Undated pages: at most `max_undated` per poll, and only above the first stored candidate,
    the same rule `ingest_rules` applies to every other feed type. Pages past the cap are marked.
- **`scheduler._ingest`:** reads the tunables before the fetch and passes `known_urls` and
  `max_undated` to a plugin with `takes_ingest_hints`. `known_urls` runs the same known-URL
  query as the commit session (`_stored_urls`), in its own short session.

### Tests

New: `test_generic_scrape_skips_stored.py`, `test_generic_scrape_errors.py` (the spec's website
error cases, through the real `fetch_html_checked` and crawl with a fake transport), and plan,
scoring and undated-cap cases. Rewrites: the tests the spec lists, plus the extraction fakes that
need `**kwargs` and the tests that patch `fetch_html` in `generic_scrape`.

## What changed

- **`backend/app/article_extract.py`**
  - `REFUSED_STATUSES` (401, 402, 403, 429) and `FetchRefusedError(httpx.HTTPStatusError)`, so
    `scheduler._classify_error` reads a refusal from its status code: `[blocked]` for 401-403,
    `[http error]` for 429. The Test route's `except httpx.HTTPStatusError` reads it the same way.
  - `NETWORK_ERRORS` (`httpx.TransportError`, `httpx.TooManyRedirects`). The SSRF hook's plain
    `httpx.RequestError` is not one: a redirect to a denied host still reads as no document.
  - `fetch_html` gains `return_final_url` (returns `(body, final_url)`) and two keyword flags that
    only `fetch_html_checked` sets. Its header merge stays in its own body, so the B4 pins
    (`test_b1_b8_coverage_gaps.py:285-319`) hold. With neither flag it behaves exactly as before.
  - `fetch_html_checked` (new) raises a refusal as `FetchRefusedError` and a transport failure
    as the httpx error. With `raise_for_status`, any other 4xx or 5xx raises
    `httpx.HTTPStatusError`; without it, those read as an empty document, as in `fetch_html`.
    A host that doesn't resolve raises `httpx.ConnectError` (`unresolved_host_error`, review
    fix); a host in a denied range still reads as no document.
  - `most_telling_error(errors)`: a 401-403 refusal, then a 429, then any other HTTP status,
    then a network error or `asyncio.TimeoutError`, then anything else.
- **`backend/app/feed_autodiscovery.py`**
  - `_parse_sitemap_entries` returns `([(page, published, lastmod, title)], [(nested,
    lastmod)])`: a news sitemap's `<news:publication_date>`, the `<lastmod>` and `<news:title>`,
    kept apart (review fix; the first cut merged `<lastmod>` into the date).
  - `_crawl_sitemaps` returns `Candidate(url, published, title, modified)` newest first, ordered
    by the publication date, else `<lastmod>`, else a date in the URL. `published` is only a
    publication date, `modified` only the `<lastmod>`.
    - It orders and skips sitemaps with `article_detect.order_sitemaps`, both the robots.txt
      list and each index's nested list (newest first within a class).
    - It keeps entries that pass `url_ok` against the crawl's site.
    - Each document is parsed and filtered in `asyncio.to_thread` (`_read_sitemap`): `url_ok`
      costs about 90 µs per URL, so a 5000-entry sitemap would hold the event loop for about
      half a second.
    - Same-site checks use `article_detect.same_site` (the public-suffix list). The old
      `_site_key` / `_same_site` approximation and the unused `_parse_sitemap` are gone.
    - Headers go on every request, robots.txt included.
    - Failures are collected per document. A document that fails is skipped, as before. With
      `raise_errors`, an empty crawl raises, in order: the input sitemap's own failure (the
      feed's `sitemap_url`, read as the sitemap whatever its address looks like, or its URL when
      that looks like a sitemap; a 404 there is `[not found]`); a refusal when every sitemap
      that could list pages was refused (a sitemap index that loaded counts neither way, and a
      refused robots.txt reads as no robots.txt and never counts on its own); a network error.
  - `discover_sitemap_entries(page_url, limit, path_prefix, *, headers, raise_errors,
    input_is_sitemap, owner_pattern)` (new) wraps the crawl in the 30 s budget. Without
    `raise_errors` nothing raises (`[]`); with it, the crawl's error, the budget's
    `asyncio.TimeoutError` (`[network]`) or a host that doesn't resolve (`[network]`)
    propagates.
  - `discover_sitemap_urls` keeps returning `list[str]` and never raises; `/auto` calls it as
    before. It now goes through the same filters, so auto-add makes a website feed only when a
    sitemap lists an article-shaped URL (root cause "Auto-add makes a scraper if the sitemap
    lists any URL").
  - `_looks_like_sitemap` is public as `looks_like_sitemap` (`generic_scrape` uses it).
- **`backend/app/sources/generic_scrape.py`**
  - `plan_candidates(url, sitemap_url, link_pattern, headers, known_urls, *, limit,
    raise_errors) -> Plan(mode, candidates, fresh)` serves `fetch` and `probe`.
    - A section URL reads the page, then the sitemap. A site root, a feed with a
      `sitemap_url`, or a URL that looks like a sitemap reads the sitemap, then the page. The
      first read with candidates wins.
    - The page read (`_discover_page_links`) keeps today's prefix filter with a link pattern
      and uses `listing_links` without one. Every link passes `url_ok`, as the owner's choice
      under the link pattern (`owner_pattern`). The page is fetched with
      `raise_for_status`, because it is the feed's own address. `listing_links` resolves against
      the final URL when the page redirected within the site. The parse runs in a thread.
    - The sitemap read is scoped to the link pattern, else the URL's section. The whole-sitemap
      fallback is gone (`_section_candidates` is removed; `plan_candidates` replaces it).
    - With `raise_errors`, an empty plan raises `most_telling_error` of the reads' failures,
      else `NoArticleListError`. A read's failure is ignored when the other read finds
      candidates.
    - `known_urls` marks stored candidates; `fresh` leaves them out.
  - `_extract_one(url, custom_headers=None, *, owner_configured=False, listed_date=None)`
    fetches with `fetch_html_checked(..., return_final_url=True, raise_for_status=True)`. One
    `asyncio.to_thread` call (`_read_page`) runs `bare_extraction` and then `score_page(html,
    url, final_url=..., text=..., owner_configured=..., listed_date=...)`, passing the text it
    already extracted. A page under `ACCEPT_SCORE` is rejected, with the reasons in a DEBUG
    line. A refusal raises, and so does a failure that passes (a network error, a 5xx); a page
    that is gone (404, 410, other 4xx), not HTML or not an article returns None. A page with no
    date of its own takes `listed_date` (the list's publication date).
  - `GenericScrapePlugin.fetch(*, known_urls=None, max_undated=None)` (`takes_ingest_hints`):
    - plans with `raise_errors=True`, then takes up to 10 fresh candidates not in
      `_extracted_urls`;
    - a refused page is not marked extracted, nor is a page whose fetch failed in a way that
      passes (`_page_failed`: marked after 3 failed polls in a row);
    - when every page of a non-empty batch was refused, `_settle_refusals` fetches a control (the
      newest candidate outside the batch; a gone one, 404 or 410, passes to the next, up to 3).
      Serves a page: the 401-403 pages are marked, and a 429 stays unmarked. Refused, a 5xx, no
      answer, an answer with no page in it (not HTML, empty), or no control: it raises the
      refusal and leaves the pages unmarked;
    - `_cap_undated`: at most `max_undated` undated pages per poll, and none that are old
      backlog (see the review fixes). Pages it drops stay marked;
    - `owner_configured` is worked out after the plan: the link pattern, or a `sitemap_url` whose
      sitemap gave the candidates.
  - `probe` uses the same plan without `raise_errors` and skips refused pages, so the Test
    route's preview never raises.
- **`backend/app/sources/base.py`**: the `KnownUrls` type and `SourcePlugin.takes_ingest_hints`
  (False; True only on `GenericScrapePlugin`).
- **`backend/app/scheduler.py`**: `_stored_urls(session, urls)` is the known-URL query, used by
  the commit session as before and by `_known_urls_lookup` (its own short session) during a
  website feed's fetch. `_ingest_once` reads the tunables before the fetch and passes
  `known_urls`, `max_undated` and `backlog_before` (`_backlog_cutoff`, review fix) to a plugin
  with `takes_ingest_hints`.
- **Docs:** README gains a "Website feeds" subsection after Feed health. ARCHITECTURE.md's
  `_extracted_urls` row and its multi-worker note now describe what it holds, and the review
  fixes add a row for `_page_failures` (the only new process-local state; the control fetch
  and the plan live for one poll).
  `frontend/scripts/iphone-audit/README.md` is unchanged: no flows or states.

## Deviations from the spec

- **`fetch_html_checked` raises more than refusals.** The spec has it raise "only on 401, 402,
  403 and 429". It also raises transport errors, and any other status when the caller passes
  `raise_for_status`. Without that, two of the spec's own rules can't be implemented:
  - "A 404 counts as not found only on the user's own listing URL or an explicit
    `sitemap_url`" needs the 404 from those two fetches.
  - "a sitemap timeout gives `[network]`" needs the timeout. Most sitemap timeouts are httpx
    read timeouts (10 s), well inside the 30 s crawl budget, and `fetch_html` turned them into
    None, so the crawl would end empty and say `[no list]`.

  The spec's behaviour is kept for every other document: a 404, 410 or other 4xx on robots.txt,
  a guessed path or a nested sitemap still reads as empty, and the crawl moves on. A network
  error on one document is skipped too; it only matters when nothing at all was found.
- **A host that doesn't answer is `[network]`, not `[no list]`.** The spec's zero-yield rule
  says `[no list]` "only when raw discovery is empty". Raw discovery is also empty when every
  request failed to connect, and `[no list]` is a setup state that never backs off or stops.
  So an empty plan raises the most telling failure first (above), and `[no list]` only when
  nothing failed. That includes a host that doesn't resolve (a lapsed domain, a resolver
  that is down): `url_safety` refuses it like a denied address, so `article_extract` asks the
  resolver once more after the safety check fails and raises `httpx.ConnectError` for it
  (review fix; `url_safety.py` is frozen and unchanged).
- **The listing page's own failures count too.** A refused or missing listing page decides the
  error only when the sitemap finds nothing either ("a listing page 403 gives `[blocked]`" is
  that case). Today a section feed whose page 404s but whose section is in the sitemap works,
  and it keeps working (`test_a_missing_listing_page_with_a_working_section_sitemap_still_reads`).
- **A site root also reads its home page.** "A root URL is read sitemap-first" leaves the
  second read open. The home page is read after the sitemap, with `listing_links` (or the link
  pattern), so a blog with no sitemap now finds its posts instead of `[no list]`. It runs only
  when the sitemap found nothing, so a feed that works today reads exactly what it read before.
  So "all 404s with no link pattern give `[no list]`" is tested with a home page that answers
  but lists nothing. A home page that 404s is the feed's own address missing: `[not found]`.
- **A URL that looks like a sitemap reads the sitemap first, then the page.** The spec
  doesn't say. The first cut read only the sitemap, which broke an HTML sitemap page
  (`/sitemap/` with a link pattern) that works on main (review fix). Reading an XML sitemap as
  a page finds nothing at the cost of one fetch.
- **`discover_sitemap_entries` is new, and `_section_candidates` is gone.** The spec keeps
  `discover_sitemap_urls` (`list[str]`, for `/auto`) and gives it and `_section_candidates`
  `raise_errors`. The plugin needs the entries' dates and titles (PR11a's preview counts older
  pages from candidate dates), so it calls `discover_sitemap_entries`, and `discover_sitemap_urls`
  wraps it without `raise_errors`. `plan_candidates` replaces `_section_candidates`, which the
  spec allowed for `test_generic_scrape_probe_budget.py`. The test fakes therefore patch
  `discover_sitemap_entries` (returning `Candidate`s) instead of only gaining `**kwargs`.
- **`_newest_first` is unchanged.** Pages are projected to `(url, lastmod)` in `_crawl_sitemaps`
  before it runs, as the spec says, so `test_sitemap_newest_first.py:54-68` needs no rewrite.
- **Articles refused: a control fetch before reporting blocked.** "If every article fetch in a
  non-empty batch got 401 or 403, raise blocked" would stop a feed whose only new page is a
  members-only post. That page is never marked, so every poll's batch would be that page
  alone, refused, and the sixth poll would auto-disable the feed. This is common after a
  restart, when the only unstored candidate left is the refused one. So when the whole batch is
  refused, one page of the site outside the batch is fetched first:
  - refused too, a 5xx, no answer, an answer with no page in it, or no other page: the spec's
    rule (raise, pages unmarked);
  - gone (404, 410): the next candidate is tried, up to 3, so a deleted stored story doesn't
    decide;
  - serves a page: the pages refuse everyone, so they are marked and the poll succeeds.

  A 429 is treated as a refusal (`[http error]`, Check now) and is never marked, because a rate
  limit passes.
- **The undated cap also drops old undated backlog,** the other half of PR4a's rule for every
  feed type. Without it, after each restart the plugin would store up to two old undated pages
  per poll that it had passed over before. Which pages are backlog depends on the list's order
  (review fix; the first cut used position everywhere): below the first stored candidate on a
  listing page; in a sitemap, last modified before the poll's backlog line, or with no date at
  all after the first fetch. Pages the cap drops stay marked. PR4a's notes suggested leaving
  them unmarked, but then every poll would fetch them again only to drop them again, up to 8
  wasted fetches a poll on an undated site.
- **`url_ok` applies under a link pattern too,** as the spec's raw-discovery rule says, but
  without courlan (review fix): the pattern is the owner's article signal. The prefix filter
  itself is unchanged, and our own path rules still apply, so an owner pattern that targets
  record pages such as `/products/<x>` is still filtered out (see Open items).
- **Article pages that fail in a way that passes are asked for again.** The first cut marked a
  page that timed out or answered 5xx, so a transient failure lost the story (review fix). Now
  only a page that was read (gone, not HTML, not an article, kept) is marked. A failed page is
  left for the next poll and never fails the poll (only an all-refused batch raises); after 3
  failed polls in a row it is marked, so a page that never answers can't take a slot of every
  poll.
- **No owner VPS probe before merging.** Per the owner's decision of 2026-10-20 (PROGRESS.md),
  the read-only probe runs after deploying instead, from `docs/DEVICE_CHECKS.md`.

## Verification

- **Backend pytest** (database `popping_test_b`, worktree `PYTHONPATH`): **13 failed, 1301
  passed**, both before and after rebasing onto main 2d5f052 (PR1b, frontend only). The 13
  failures diff clean against the DNS-only baseline in `/root/popping-env/baseline.txt`. Main
  9e41130 gave 13 failed, 1238 passed in the same setup; this unit adds 63 tests:
  - `test_generic_scrape_errors.py` (30): the website error cases through the real fetch path.
    Only the transport is a fake (`httpx.MockTransport` behind `fake_dns`), so
    `fetch_html_checked`, the URL safety check, the SSRF hook, the crawl, `listing_links`,
    trafilatura and `score_page` all run. The cases:
    - robots.txt 404, `/sitemap.xml` 404 and a working `/wp-sitemap.xml` (its page, taxonomy and
      user sitemaps never read);
    - robots.txt 403 with a working sitemap; a refused robots.txt alone; every sitemap refused;
      one refused sitemap beside missing ones;
    - the Yoast index read in class order, end to end, and the About page never fetched;
    - all 404s with a home page that lists nothing (`[no list]`);
    - a sitemap read timeout, the crawl budget running out, and a host that refuses
      connections (all `[network]`);
    - a missing `sitemap_url` and a missing listing page (`[not found]`), a refused listing
      page (`[blocked]`), a rate-limited one (`[http error]`), and a missing listing page whose
      section sitemap still works;
    - article pages refused (`[blocked]`, unmarked, read after a Safari User-Agent is set); a
      members-only page beside a stored story (skipped, the poll succeeds); every page refused
      with stored stories (`[blocked]`); a 429 page that stays for later; a mixed poll;
      rate-limited articles (`[http error]`); a redirect to the home page rejected;
    - a listing page that brings its post and rejects a soft 404;
    - a link pattern that accepts an undated ollama-style page (the spec's test), and the same
      page rejected without one;
    - `probe` and `discover_sitemap_urls` never raise; `fetch_html_checked`'s contract; the
      final URL; news sitemap titles and dates.
  - `test_generic_scrape_skips_stored.py` (11): the spec's stored-URL cases (skipped before
    extraction; an all-stored poll returns `[]` without raising; not fetched again after a
    restart); the undated cap (at most `max_undated`, its default, dated pages uncapped, undated
    backlog below a stored story); and three `scheduler._ingest` runs on the test database. Those
    show the lookup and the knob reach the plugin, and that an all-stored poll is recorded as a
    success.
  - `test_generic_scrape_plan.py` (13): read order per URL kind, scoping, failure precedence,
    no raise without `raise_errors`, headers on every read, `owner_configured`, and the listing
    parse off the event loop.
  - `test_sitemap_crawl_filters.py` (9): parse shapes, `/auto` on a site with only static pages,
    a page sitemap skipped beside a post sitemap, Shopify blogs only, non-article URLs dropped,
    dates, and the sitemap parse off the event loop.
- **Rewritten tests** (the spec's list, plus what the change broke):
  - `test_generic_scrape.py`: the discovery fakes patch `discover_sitemap_entries`; the
    extraction fakes take `**kwargs`. The per-poll-cap, concurrency and extraction-error items
    are dated, so they test what they did before and not the undated cap.
  - `test_generic_scrape_page_links.py`:
    - :88-103 now asserts the page is read with `listing_links`, not the prefix filter, and that
      `NoArticleListError` is raised while `probe` returns `[]`;
    - :114-145 is read page-first, and the sitemap is never asked;
    - :151 (`test_plugin_sitemap_wins_over_page_links`) uses sitemap entries under the pattern
      and asserts the read is scoped to it;
    - :432-446 expects `NoArticleListError` and patches `fetch_html_checked`.
  - `test_generic_scrape_sitemap_url.py`: the three tests at :94-170 expect
    `NoArticleListError` and keep their checks on the discovery call's arguments (the home-page
    read is stubbed, so nothing touches the network). The dedup test's items are dated, and its
    second poll returns `[]` without an error. The probe test also asserts `raise_errors` is
    False.
  - `test_generic_scrape_probe_budget.py` patches `plan_candidates`.
  - `test_sitemap_newest_first.py`: `_serve` patches `fetch_html_checked`; :71-88 read
    `Candidate.url` (and the URL date); :100-109 now asserts there is no fallback.
  - `test_ingest_misfire_grace.py` (PR1a) and `test_generic_scrape_parse_published.py` patched
    `generic_scrape.fetch_html`; they now patch `fetch_html_checked`. The two date tests also
    accept their stub page in `score_page`, because they test the date, not the scoring.
- **Mutation check.** A script broke each guarded line, ran the tests that guard it, required a
  failure, and restored the file byte for byte (checked by SHA-256). The final run caught all 46
  mutations, in all 67 test runs.
  - `article_extract`: refusals never raise; `raise_for_status` ignored; network errors
    swallowed; `most_telling_error` unranked; the final URL not returned.
  - The crawl:
    - robots.txt refusal raising;
    - every-sitemap-refused not raised, and one refusal blocking;
    - the input sitemap's 404 read as empty;
    - network errors and the budget timeout swallowed;
    - nested and robots.txt sitemaps not ordered;
    - no `url_ok`;
    - the parse back on the loop;
    - news titles and dates dropped.
  - The plan:
    - section and root read orders swapped or cut;
    - `sitemap_url` not read first, and a sitemap URL also read as a page;
    - scoping removed, and the link pattern not scoping;
    - the whole-sitemap fallback put back;
    - a failed read sinking the plan;
    - raising without `raise_errors`, and an empty plan not raising `[no list]`;
    - stored URLs not skipped, and an all-stored poll raising;
    - headers dropped;
    - the prefix filter used without a pattern;
    - the listing parse on the loop;
    - the page read without `raise_for_status`.
  - Extraction: `score_page` ignored; `score_page` without the final URL; `owner_configured`
    never set; extraction on the loop.
  - The batch:
    - refused pages marked;
    - the all-refused rule removed;
    - no control fetch, and a refused control counted as loading;
    - a 429 page marked;
    - no undated cap, undated backlog kept, and dated pages capped.
  - The scheduler: no hints passed; no undated knob passed.

  The first run had three survivors, each fixed:
  - "Refusals never raise" survived its listing-page test: the listing fetch uses
    `raise_for_status`, so a 403 there raises anyway. The mutation now runs the article-page
    test, which has no such backstop.
  - "robots.txt sitemaps not ordered" survived because `url_ok` also drops the static pages.
    It got its own test (a page sitemap listed before a post sitemap is never fetched).
  - One mutation string matched twice and was made unique.
- **`ruff check --select F,E9,B`** on every changed app file and every new test: clean. One
  pre-existing B905 in `generic_scrape.py` was fixed (`zip(..., strict=True)`). The other
  findings in the edited old test files and in `scheduler.py` were already on main. CI runs no
  backend linter.
- **Frontend:** no frontend file changed. The backend tests that pin frontend source ran in the
  full pytest above.
- **The VPS probe** (Device checks below): its quoting was checked by splitting the command the
  way the owner's shell and the container's `sh` will, and its SQL ran on sample rows in a
  scratch transaction on the test cluster.
- **Security checklist:** no new route and no stored JSON. Every new request goes through
  `fetch_html` (`fetch_html_checked` delegates to it), so the URL safety check, the per-hop SSRF
  hook and the final-URL check apply to robots.txt, sitemaps, listing pages, article pages and
  the control fetch. Website feeds now send their `custom_headers` to robots.txt, sitemaps and
  the listing page as well as article pages, all on the feed's own site; the route layer's
  header denylist still applies. `trafilatura`, `courlan`, `lxml` and `defusedxml` are used only
  as parsers. Error messages carry the status and the URL the feed already has, never a body.

## Review fixes

The review agents' confirmed findings, each fixed with a test that fails without the fix (the
mutation run below):

1. **A control page that answers 404 or 5xx counted as loaded.** `_settle_refusals` fetches the
   control with `raise_for_status` and counts it only when it returns a page. A 5xx, a
   refusal, a network error, a non-HTML answer or an empty body is not the site serving us; a
   404 or 410 passes to the next candidate (up to 3).
2. **An HTML sitemap page was never read as a page.** A URL that looks like a sitemap now reads
   the sitemap, then the page, like a site root.
3. **A served sitemap index whose children are all refused read as `[no list]`** (reported
   twice). The refusal rule leaves out the indexes that loaded: an index whose post sitemaps
   are all refused raises the refusal (`[blocked]`, or `[http error]` for 429s). A lone guessed
   403 beside 404s, an index with one refused and one missing child, and a refused sitemap
   beside one that loads are still not blocked.
4. **A host that doesn't resolve read as `[no list]`.** `unresolved_host_error` in
   `article_extract` (used by `fetch_html` with `raise_errors` and by
   `discover_sitemap_entries`) raises `httpx.ConnectError` (`[network]`). A host in a denied
   range still reads as no document.
5. **Article pages that timed out or answered 5xx were marked** (reported twice). See the
   deviation above: `_extract_one` re-raises those, `fetch()` leaves them unmarked
   (`_page_failed`), and a 404 or 410 page stays marked.
6. **A dead `sitemap_url` vouched for the home page's links.** `owner_configured` is worked out
   after the plan, so links `listing_links` found are scored as any page is. An INFO line
   names the `sitemap_url` that listed nothing. The feed still reads its page: raising
   `[not found]` there would stop `sitemap_url` plus `link_pattern` feeds that work today.
7. **Dated articles were scored as undated.**
   - `Candidate.published` (a listing card's `<time datetime>` or a news sitemap's
     publication date) reaches `score_page` as `listed_date`, which counts like the page's own
     date and cancels the `og:type=website` −3. The item also takes it as `published_at` when
     the page carries no date of its own. A sitemap's `<lastmod>` is kept apart
     (`Candidate.modified`) and never dates a page; trafilatura's date is never used for
     scoring.
   - `_body_date` also reads a plain `<time datetime>` inside the first h1's own `<article>`
     (not in its footer, aside or nav, and not marked as an update), when only one article
     holds an h1. New fixture `astro-post.html` (the Astro blog starter's post layout).
   - Still rejected: About, Yoast About, the long listing and the listing fixtures.
8. **"Below the first stored candidate" dropped new pages in `<lastmod>` order.** The position
   rule now applies only to a listing page. In a sitemap, an undated page is backlog when its
   `<lastmod>` is older than the poll's backlog line (the scheduler's `_backlog_cutoff`: the
   baseline minus `backfill_hours`, or `max_age_days`, whichever is later; None on a first
   fetch), or when it has no date at all after the first fetch. A page can't have been
   published after it last changed, so the first is sound; the second can't tell a new
   undated page from old backlog in an order that says nothing.
9. **`url_ok`'s courlan step rejected real slugs** (`png-vs-jpg`, `node.js-22-released`,
   `.ece`, `.cms`). File types are judged by the page's own ending (`_FILE_EXTENSIONS`);
   courlan sees a one-word page name as it is and a longer slug as a neutral word, with an
   ending that is neither a file nor a web page it knows left off; and under the owner's link
   pattern (page links and the sitemap read) courlan isn't asked (`owner_pattern`).
   Blogspot's `_archive.html` pages, which only courlan rejected, are rejected by our rules.
10. **No request-level test of the feed's headers.** Two tests serve robots.txt, a sitemap index
    listed only there, its post sitemap, the article page and a section's listing page only to
    a Safari User-Agent, and assert that every request carries it. Each fails when
    `custom_headers=headers` becomes `None` on the robots.txt fetch, the sitemap document fetch
    or the listing page fetch (mutation run below).
11. **An explicit `sitemap_url` that didn't look like a sitemap was ignored.**
    `discover_sitemap_entries(..., input_is_sitemap=True)` reads the owner's URL as the sitemap
    whatever its path (`/?sitemap=index`), so a 404 there is `[not found]`. `/auto` doesn't set
    it.
12. **The VPS probe contradicted Step 0 and its 24-hour count couldn't catch a stopped feed.**
    The baseline is its own line, marked as the one check that runs before Step 0's
    `popping-update`. The probe now has a `since_deploy` column (stories fetched since the
    backend container was created, read from `docker inspect`), and the line a day after
    deploying fails a feed whose `since_deploy` is 0 while its site kept publishing.

### Verification of the review fixes

- **Backend pytest** (database `popping_test_b`, worktree `PYTHONPATH`): **13 failed, 1371
  passed**. The 13 are the DNS-only baseline (`/root/popping-env/baseline.txt`), unchanged.
  The 11 DNS-only source-route tests among them pass with a fake resolver (their four files:
  50 passed).
- **New and rewritten tests:** `test_generic_scrape_errors.py` (+27 cases: controls, the HTML
  sitemap page, refused index children, DNS, transient article failures, gone pages, the dead
  and working `sitemap_url`, list dates, the Astro post, the owner's pattern, headers on every
  request, `/?sitemap=index`), `test_generic_scrape_skips_stored.py` (the undated cap per list
  order, the backlog line, and the scheduler passing it), `test_article_detect.py` (the
  review's `url_ok` slugs, `owner_pattern`, the wider body date, `listed_date`, the static
  pages that stay rejected), `test_generic_scrape_plan.py` (read order for a sitemap-looking
  URL, `input_is_sitemap`, `owner_pattern`, `owner_configured` after a dead `sitemap_url`),
  `test_sitemap_crawl_filters.py` and `test_sitemap_newest_first.py` (`<lastmod>` kept apart).
- **Mutation check of the fixes.** A script broke each guarded line, ran the tests that guard
  it, required a failure, and restored the file byte for byte (SHA-256). 41 mutations, 51 test
  runs, all caught:
  - control: a gone control not skipped, a 5xx control counted as serving, a control with no
    page counted as serving;
  - a sitemap-looking URL read only as a sitemap;
  - the index rule: indexes counted as refusable, every loaded document counted as an index,
    and the looser "any refusal with nothing loaded" rule;
  - DNS: `fetch_html` and the sitemap discovery not raising, and a denied host read as
    unresolved;
  - articles: a 5xx read as gone, network errors swallowed, no `raise_for_status`, a failed
    page marked, a failing page never passed over, a gone page left unmarked;
  - `owner_configured` from the `sitemap_url` alone;
  - dates: the listed date not scored, not passed by `fetch()`, not dating the item, ignored by
    `score_page`; the plain article `<time>` ignored; a footer or "updated" `<time>` counted;
    `<lastmod>` merged into the publication date;
  - the undated cap: position in a sitemap, no position on a listing page, `<lastmod>` not held
    against the line, an undated no-date page kept after the first fetch, the scheduler passing
    no line, the line ignoring the baseline;
  - `url_ok`: courlan seeing the whole slug, our file-type check dropped, courlan asked under
    the owner's pattern, page links and the sitemap read not passing `owner_pattern`;
  - headers dropped on the robots.txt fetch, the sitemap document fetch and the listing page
    fetch, one at a time;
  - the explicit `sitemap_url` read by its looks, and the plan not flagging it.

  The first run had six survivors, each fixed: two mutations had been aimed at the wrong tests;
  `fetch_html`'s own unresolved-host raise and the page links' `owner_pattern` had no test that
  reached them (now `fetch_html_checked` is asserted directly, and a link-pattern listing with a
  `/library/home` link is planned); and "every loaded document counted as an index" got its
  own test (a refused sitemap beside one that loads is not blocked).
- **`ruff check --select F,E9,B`** on every changed app file and test: clean, except the 5
  findings in `scheduler.py` that are on main.
- **The probe:** the exact command in `docs/DEVICE_CHECKS.md` was run with `docker` stubbed to
  run its container half locally, against sample rows in a scratch schema on the test cluster
  (dropped afterwards): it parses, and `since_deploy` reads 0 for a feed whose stories all came
  in the 24 hours before the deploy.

## Risks and data-compatibility notes

- **Some website feeds will pull fewer stories or show a new state.** This is the intended
  effect, which the owner's probe checks after deploying (Device checks):
  - `[no list]` is a setup state (D27): it never counts toward `error_count` and never stops
    the feed. Its fix (Pick a section, PR9b) also sends `active: true`.
  - `[blocked]` and `[not found]` count as failures, back off, and stop the feed after six in a
    row, as for every other feed.
- **A section feed now reads its page first.** If `listing_links` picks a repeating group that
  isn't the posts and every one of them is rejected by `score_page`, the feed finds candidates
  but brings nothing (Quiet). It never falls through to the sitemap. The probe's
  `since_deploy` a day after deploying would show it; the fix is a link pattern or a
  `sitemap_url`.
- **A listing ordered by update time** (a model index whose "newest" means recently updated)
  still uses the position rule for undated pages: a new undated page below a stored one that
  was just updated is dropped as backlog. The review asked to keep position for listing pages;
  a `sitemap_url` or a dated listing avoids it.
- **A sitemap with no `<lastmod>` and pages with no date** brings undated pages only on its
  first fetch: such a page can't be told from old backlog.
- **After a restart,** pages that were fetched but not kept (not articles, too old, over the
  undated cap) are fetched once more, and pages that were failing start a new count of 3.
  Stored pages are not fetched.
- **Revert is safe until PR11a merges** (it calls `plan_candidates`). There is no migration,
  and no route or response changes shape.

## Open items for later units

- **PR11a:** the preview should call `plan_candidates` (`Plan.candidates` carries each
  candidate's publication date, `<lastmod>` and title for `older_skipped_count`; a date in the
  URL is not carried, `feed_autodiscovery._entry_date` reads it). `_read_page` logs `score_page`'s reasons
  but returns only accept or reject. The preview's per-item `accepted` and `reason` will need it
  to return the score and reasons.
- **PR9b:** a website feed's `[blocked]` comes from its sitemaps, its listing page or its
  article pages. Read as Safari fixes all three: `custom_headers` reach every request.
- **The owner's junk sites** are still not in the fixtures (PR10a's open item). Once they're
  sent, save them offline and add cases.
- **Scoring edge cases** from PR10a stand. A date in the URL earns +1 and cancels the
  `og:type=website` −3, so a static page at a dated URL scores 2 and is accepted (seen while
  writing these tests; not a real-world shape so far).
- **`url_ok` under a link pattern** no longer asks courlan, but our own path rules still reject
  record-shaped paths (`/products/<x>`, `/users/<x>`) even when the owner chose them. If a feed
  needs that, the pattern should replace `url_ok`'s path rules for that feed; that is a spec
  change.
- **A date written only as text** ("Posted on October 14, 2026") with no `<time>`, no metadata
  and no listing card date still leaves an `og:type=website` page undated (−3), and such a page
  is rejected without a link pattern. Reading dates from text is a heuristic of its own.
- **A slug that ends in a file type** (`/blog/getting-started-with-vue.js`) is read as a file.
- **The plan's frontend-only rollback command** still lacks `--no-deps` (PR9a's open item).

## Device checks

Added under Pending in `docs/DEVICE_CHECKS.md`. The first three are the read-only VPS probe that
used to be the merge gate; the owner now runs it before deploying (the one exception to Step 0)
and twice after.

- [ ] #<pr> · Baseline, the one check that runs **before** Step 0's `popping-update` (it has to read the old build): with #35 already deployed (the query reads its columns), run `cd /opt/popping && DEPLOYED=$(docker inspect -f '{{.Created}}' $(docker compose ps -q backend)) && docker compose exec -e DEPLOYED="$DEPLOYED" postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT s.name, s.active, s.last_attempt_at, s.last_item_count AS listed, s.last_new_count AS new, left(s.last_error, 40) AS error, count(e.id) FILTER (WHERE e.fetched_at >= '\''$DEPLOYED'\''::timestamptz) AS since_deploy, count(e.id) FILTER (WHERE e.fetched_at >= now() - make_interval(hours => 24)) AS stories_24h, count(e.id) AS stories_7d FROM sources s LEFT JOIN entries e ON e.source_id = s.id AND e.fetched_at >= now() - make_interval(days => 7) WHERE s.type = '\''generic_scrape'\'' GROUP BY s.id ORDER BY s.name"'` and keep the output. Pass: it prints a row per website feed (`since_deploy` counts from the previous deploy here and doesn't matter).
- [ ] #<pr> · 3 hours after deploying this PR (a website feed is checked every 2 hours by default), run the baseline's command again. Pass: every website feed has a `last_attempt_at` after the deploy, and each one with no error in the baseline still shows none (its `listed` count can be lower than before, because About, tag and shop pages no longer count); write `fail: <feed name>` for one that now shows `[no list]`, `[blocked]` or `[not found]`.
- [ ] #<pr> · A day or more after deploying this PR, and before deploying anything else, run the baseline's command once more: `since_deploy` counts only the stories each feed brought since the backend was deployed. Pass: each website feed with stories in the baseline's `stories_7d` has a `since_deploy` above 0, unless its site published nothing since the deploy; write `fail: <feed name>` for one whose `since_deploy` is 0 while its site kept publishing. `listed` is no signal on its own: a check with nothing new lists 0 too.
- [ ] #<pr> · A day after deploying, open the tab of a website feed that used to pull pages that aren't articles. Pass: the stories that arrived since the deploy are its articles, with no About, Contact, tag, author or shop pages.
