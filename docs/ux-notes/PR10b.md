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
  - `most_telling_error(errors)`: a 401-403 refusal, then a 429, then any other HTTP status,
    then a network error or `asyncio.TimeoutError`, then anything else.
- **`backend/app/feed_autodiscovery.py`**
  - `_parse_sitemap_entries` returns `([(page, date, title)], [(nested, lastmod)])`. A page's
    date is a news sitemap's `<news:publication_date>`, else `<lastmod>`; its title is
    `<news:title>`.
  - `_crawl_sitemaps` returns `Candidate(url, published, title)` newest first.
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
      feed's `sitemap_url`, or its URL when that is a sitemap; a 404 there is `[not found]`); a
      refusal when every sitemap document fetched was refused (a refused robots.txt reads as no
      robots.txt and never counts on its own); a network error.
  - `discover_sitemap_entries(page_url, limit, path_prefix, *, headers, raise_errors)` (new)
    wraps the crawl in the 30 s budget. Without `raise_errors` nothing raises (`[]`); with it,
    the crawl's error or the budget's `asyncio.TimeoutError` (`[network]`) propagates.
  - `discover_sitemap_urls` keeps returning `list[str]` and never raises; `/auto` calls it as
    before. It now goes through the same filters, so auto-add makes a website feed only when a
    sitemap lists an article-shaped URL (root cause "Auto-add makes a scraper if the sitemap
    lists any URL").
  - `_looks_like_sitemap` is public as `looks_like_sitemap` (`generic_scrape` uses it).
- **`backend/app/sources/generic_scrape.py`**
  - `plan_candidates(url, sitemap_url, link_pattern, headers, known_urls, *, limit,
    raise_errors) -> Plan(mode, candidates, fresh)` serves `fetch` and `probe`.
    - A section URL reads the page, then the sitemap. A site root or a feed with a
      `sitemap_url` reads the sitemap, then the page. A URL that is itself a sitemap reads only
      the sitemap. The first read with candidates wins.
    - The page read (`_discover_page_links`) keeps today's prefix filter with a link pattern
      and uses `listing_links` without one. Every link passes `url_ok`. The page is fetched with
      `raise_for_status`, because it is the feed's own address. `listing_links` resolves against
      the final URL when the page redirected within the site. The parse runs in a thread.
    - The sitemap read is scoped to the link pattern, else the URL's section. The whole-sitemap
      fallback is gone (`_section_candidates` is removed; `plan_candidates` replaces it).
    - With `raise_errors`, an empty plan raises `most_telling_error` of the reads' failures,
      else `NoArticleListError`. A read's failure is ignored when the other read finds
      candidates.
    - `known_urls` marks stored candidates; `fresh` leaves them out.
  - `_extract_one(url, custom_headers=None, *, owner_configured=False)` fetches with
    `fetch_html_checked(..., return_final_url=True)`. One `asyncio.to_thread` call
    (`_read_page`) runs `bare_extraction` and then `score_page(html, url, final_url=..., text=...,
    owner_configured=...)`, passing the text it already extracted. A page under `ACCEPT_SCORE`
    is rejected, with the reasons in a DEBUG line. A refusal raises; every other failure returns
    None, as before.
  - `GenericScrapePlugin.fetch(*, known_urls=None, max_undated=None)` (`takes_ingest_hints`):
    - plans with `raise_errors=True`, then takes up to 10 fresh candidates not in
      `_extracted_urls`;
    - a refused page is not marked extracted;
    - when every page of a non-empty batch was refused, `_settle_refusals` fetches a control (the
      newest candidate outside the batch). Refused too, no answer, or no control: it raises the
      refusal and leaves the pages unmarked. Loads: the 401-403 pages are marked, and a 429 stays
      unmarked;
    - `_cap_undated`: at most `max_undated` undated pages per poll, only above the first stored
      candidate. Pages past the cap stay marked;
    - `owner_configured = bool(link_pattern or sitemap_url)`.
  - `probe` uses the same plan without `raise_errors` and skips refused pages, so the Test
    route's preview never raises.
- **`backend/app/sources/base.py`**: the `KnownUrls` type and `SourcePlugin.takes_ingest_hints`
  (False; True only on `GenericScrapePlugin`).
- **`backend/app/scheduler.py`**: `_stored_urls(session, urls)` is the known-URL query, used by
  the commit session as before and by `_known_urls_lookup` (its own short session) during a
  website feed's fetch. `_ingest_once` reads the tunables before the fetch and passes
  `known_urls` and `max_undated` to a plugin with `takes_ingest_hints`.
- **Docs:** README gains a "Website feeds" subsection after Feed health. ARCHITECTURE.md's
  `_extracted_urls` row and its multi-worker note now describe what it holds. No new
  process-local state: the control fetch and the plan live for one poll.
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
  nothing failed.
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
- **A URL that is itself a sitemap reads only the sitemap.** The spec doesn't say; reading XML
  as a listing page could only find nothing.
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
  - refused too, no answer, or no other page: the spec's rule (raise, pages unmarked);
  - loads: the pages refuse everyone, so they are marked and the poll succeeds.

  A 429 is treated as a refusal (`[http error]`, Check now) and is never marked, because a rate
  limit passes.
- **The undated cap also drops undated pages below a stored candidate,** the other half of
  PR4a's rule for every feed type. Without it, after each restart the plugin would store up to
  two old undated pages per poll that it had passed over before. Pages past the cap stay marked.
  PR4a's notes suggested leaving them unmarked, but then every poll would fetch them again only
  to drop them again, up to 8 wasted fetches a poll on an undated site.
- **`url_ok` applies under a link pattern too,** as the spec's raw-discovery rule says. The
  prefix filter itself is unchanged. An owner pattern that targets record pages such as
  `/products/<x>` would be filtered out (see Open items).
- **Network errors on article pages** still return None and mark the page, as before. Only
  refusals are left unmarked: a single page that always times out must not fail every poll.
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

## Risks and data-compatibility notes

- **Some website feeds will pull fewer stories or show a new state.** This is the intended
  effect, which the owner's probe checks after deploying (Device checks):
  - `[no list]` is a setup state (D27): it never counts toward `error_count` and never stops
    the feed. Its fix (Pick a section, PR9b) also sends `active: true`.
  - `[blocked]` and `[not found]` count as failures, back off, and stop the feed after six in a
    row, as for every other feed.
- **A section feed now reads its page first.** If `listing_links` picks a repeating group that
  isn't the posts and every one of them is rejected by `score_page`, the feed finds candidates
  but brings nothing (Quiet). It never falls through to the sitemap. The probe's `stories_24h`
  would show it; the fix is a link pattern or a `sitemap_url`.
- **After a restart,** pages that were fetched but not kept (not articles, too old, over the
  undated cap) are fetched once more. Stored pages are not.
- **Revert is safe until PR11a merges** (it calls `plan_candidates`). There is no migration,
  and no route or response changes shape.

## Open items for later units

- **PR11a:** the preview should call `plan_candidates` (`Plan.candidates` carries each
  candidate's date and title for `older_skipped_count`). `_read_page` logs `score_page`'s reasons
  but returns only accept or reject. The preview's per-item `accepted` and `reason` will need it
  to return the score and reasons.
- **PR9b:** a website feed's `[blocked]` comes from its sitemaps, its listing page or its
  article pages. Read as Safari fixes all three: `custom_headers` reach every request.
- **The owner's junk sites** are still not in the fixtures (PR10a's open item). Once they're
  sent, save them offline and add cases.
- **Scoring edge cases** from PR10a stand. A date in the URL earns +1 and cancels the
  `og:type=website` −3, so a static page at a dated URL scores 2 and is accepted (seen while
  writing these tests; not a real-world shape so far).
- **`url_ok` under a link pattern** rejects record-shaped paths (`/products/<x>`, `/users/<x>`)
  even when the owner chose them. If a feed needs that, the pattern should replace `url_ok`'s
  path rules for that feed; that is a spec change.
- **The plan's frontend-only rollback command** still lacks `--no-deps` (PR9a's open item).

## Device checks

Added under Pending in `docs/DEVICE_CHECKS.md`. The first is the read-only VPS probe that used
to be the merge gate; the owner now runs it before and after deploying.

- [ ] #<pr> · With #35 already deployed (the query reads its columns), and before running `popping-update` for this PR, run `cd /opt/popping && docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT s.name, s.active, s.last_attempt_at, s.last_item_count AS listed, s.last_new_count AS new, left(s.last_error, 40) AS error, count(e.id) FILTER (WHERE e.fetched_at >= now() - make_interval(hours => 24)) AS stories_24h, count(e.id) AS stories_7d FROM sources s LEFT JOIN entries e ON e.source_id = s.id AND e.fetched_at >= now() - make_interval(days => 7) WHERE s.type = '\''generic_scrape'\'' GROUP BY s.id ORDER BY s.name"'` and keep the output; run it again 3 hours after deploying (a website feed is checked every 2 hours by default). Pass: every website feed has a `last_attempt_at` after the deploy, and each one that brought stories before still shows no error (its `listed` count can be lower than before, because About, tag and shop pages no longer count); write `fail: <feed name>` for a feed that now shows `[no list]`, `[blocked]` or `[not found]`, or whose `stories_24h` fell to 0 while its site kept publishing.
- [ ] #<pr> · A day after deploying, open the tab of a website feed that used to pull pages that aren't articles. Pass: the stories that arrived since the deploy are its articles, with no About, Contact, tag, author or shop pages.
