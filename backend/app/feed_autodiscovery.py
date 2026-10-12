"""Auto-discover a feed for a URL the user pastes into "Add custom" —
either an existing RSS/Atom feed, or (when none exists) a sitemap-
derived list of article URLs suitable for the generic-scrape fallback
source type (``app.sources.generic_scrape``).

Uses trafilatura's feed detection (``trafilatura.feeds``) rather than
reimplementing "search a page for <link rel=alternate>" ourselves — well-tested, actively maintained, and already a project
dependency (added in ``app.article_extract`` for full-article LLM
summaries).

Network access: every request goes through
``app.article_extract.fetch_html``, which applies the SSRF guard to the
URL and to every redirect hop. trafilatura is used only to parse what we
fetched (``determine_feed``); it never fetches anything itself, because
its own downloader has no hook for that guard.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as DefusedET

from app.article_extract import fetch_html
from app.sources.rss import fetch_rss
from app.url_safety import check_url_safe

logger = logging.getLogger("popping.feed_autodiscovery")

_MAX_FEED_CANDIDATES = 5
_MAX_SITEMAP_URLS = 50

# Per-stage timeouts for the autodiscovery flow.
#
# The /api/sources/auto endpoint is synchronous from the user's
# perspective ("click Add Custom, wait for a toast"). The discovery
# chain — initial fetch_rss + trafilatura.find_feed_urls + a per-
# candidate fetch_rss loop — runs WITHOUT an outer endpoint
# timeout, so the worst case is unbounded (``fetch_rss`` uses
# ``_READ_TIMEOUT=60.0`` × 2 attempts = 120s per candidate).
# Observed: a slow CDN makes the endpoint hang 5-10 minutes, which
# the user reads as "the autofeed button is broken".
#
# Bounded here per stage so every link in the chain has a sane
# deadline. The numbers are chosen to be larger than the happy
# path (most feeds discover in <2s) but tight enough that a hung
# host gets returned-as-not-found within a small multiple of the
# happy-path wall time, not minutes:
#
#   _INITIAL_PROBE_BUDGET    10s  the user-supplied URL is a direct feed
#                              (fast probe; if the URL itself isn't a
#                              feed we move on quickly)
#   _TRAFILATURA_BUDGET      30s  fetching + scanning the page for feed
#                              links, or the sitemap crawl (robots.txt,
#                              guessed paths, nested sitemap indexes)
#   _CANDIDATE_PROBE_BUDGET  20s  per-candidate fetch_rss; shorter than
#                              60s because we have many candidates and
#                              the diminishing-return on slow feeds is
#                              steep — if the first candidate takes
#                              >20s, the rest will too, and the user
#                              would rather see a fast "not a feed"
#                              than a 5-min wait
#   _DISCOVERY_TOTAL_BUDGET  60s  outer cap on the whole flow inside
#                              discover_feed_url itself; protects
#                              against the worst-case scenario where
#                              every candidate narrowly misses each
#                              per-stage cap and adds up
_INITIAL_PROBE_BUDGET = 10.0
_TRAFILATURA_BUDGET = 30.0
_CANDIDATE_PROBE_BUDGET = 20.0
_DISCOVERY_TOTAL_BUDGET = 60.0


async def discover_feed_url(page_url: str) -> str | None:
    """Return a working RSS/Atom feed URL for ``page_url``, or None
    if none could be found within the discovery time budget.

    Tries ``page_url`` itself first — the user may have pasted a feed
    URL directly, which is the common case and needs no discovery at
    all — then asks trafilatura for candidate feed URLs on the page
    and tries each in turn until one actually parses with at least
    one item. A candidate merely existing in the page's markup isn't
    enough to trust; feed-detection heuristics false-positive on
    stale/broken `<link>` tags often enough that "does it actually
    parse" is the only real test.

    Every external hop is wrapped in ``asyncio.wait_for`` so a
    host that hangs on connect, read, or any internal trafilatura
    call can't hold the request open for minutes. Timeouts are
    treated the same as a network failure — fall through to the
    next stage. The user-visible behavior is "took too long,
    not a feed after all"; see the per-stage budget module
    docstring for the rationale.
    """
    safe, reason = check_url_safe(page_url)
    if not safe:
        logger.info("feed_autodiscovery: %s rejected by URL safety check (%s)", page_url, reason)
        return None

    async def _probe_initial() -> str | None:
        """Phase 1: a quick probe of the user-supplied URL itself."""
        items = await fetch_rss(page_url)
        return page_url if items else None

    try:
        result = await asyncio.wait_for(_probe_initial(), _INITIAL_PROBE_BUDGET)
        if result:
            return result
    except asyncio.TimeoutError:
        logger.info(
            "feed_autodiscovery: initial probe of %s hit the %ss budget; "
            "falling through to trafilatura",
            page_url, _INITIAL_PROBE_BUDGET,
        )
    except Exception:  # noqa: BLE001 - not itself a feed; fall through to discovery
        pass

    async def _trafilatura_find() -> list[str]:
        # Lazy import: trafilatura loads lxml at import time.
        from trafilatura.feeds import FeedParameters, determine_feed, get_hostinfo

        # determine_feed scans the page for <link rel=alternate> tags and
        # common feed paths and returns candidate feed URLs. (Not
        # trafilatura.feeds.find_feed_urls: that dereferences the feed
        # and returns the article links inside it.)
        domain, baseurl = get_hostinfo(page_url)
        if domain is None:
            logger.info(
                "feed_autodiscovery: no domain in %s — giving up before fetching",
                page_url,
            )
            return []
        html = await fetch_html(page_url)
        if html is None:
            logger.info(
                "feed_autodiscovery: could not fetch %s — no page to scan for feed links",
                page_url,
            )
            return []
        params = FeedParameters(baseurl, domain, page_url, False, None)
        found = await asyncio.to_thread(determine_feed, html, params)
        logger.info(
            "feed_autodiscovery: determine_feed found %d candidate(s) for %s: %s",
            len(found), page_url, found[:_MAX_FEED_CANDIDATES],
        )
        return found

    try:
        candidates = await asyncio.wait_for(_trafilatura_find(), _TRAFILATURA_BUDGET)
    except asyncio.TimeoutError:
        logger.info(
            "feed_autodiscovery: determine_feed for %s hit the "
            "%ss budget; giving up",
            page_url, _TRAFILATURA_BUDGET,
        )
        return None
    except Exception as exc:  # noqa: BLE001 - third-party discovery, never let it fail the request
        logger.info("feed_autodiscovery: determine_feed failed for %s: %s", page_url, exc)
        return None

    async def _probe_candidate(candidate: str) -> str | None:
        """Phase 2: probe a single trafilatura-discovered candidate."""
        items = await fetch_rss(candidate)
        return candidate if items else None

    for candidate in candidates[:_MAX_FEED_CANDIDATES]:
        try:
            result = await asyncio.wait_for(_probe_candidate(candidate), _CANDIDATE_PROBE_BUDGET)
            if result:
                return result
            logger.info(
                "feed_autodiscovery: candidate %s for %s fetched but "
                "didn't parse as a feed with any items; trying next candidate",
                candidate, page_url,
            )
        except asyncio.TimeoutError:
            # Log and try the next candidate. A single slow candidate
            # shouldn't take down the whole loop.
            logger.info(
                "feed_autodiscovery: candidate %s for %s hit the %ss budget; "
                "trying next candidate",
                candidate, page_url, _CANDIDATE_PROBE_BUDGET,
            )
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "feed_autodiscovery: candidate %s for %s raised %s; "
                "trying next candidate",
                candidate, page_url, exc,
            )
            continue
    return None


async def discover_sitemap_urls(page_url: str, limit: int = _MAX_SITEMAP_URLS) -> list[str]:
    """Return up to ``limit`` article-page URLs from ``page_url``'s
    sitemap, or an empty list if none is found or discovery fails.
    Used as the "this site has no native feed" fallback when adding a
    ``type="generic_scrape"`` source — see
    ``app.sources.generic_scrape``.

    Subject to the same ``_TRAFILATURA_BUDGET`` as the feed
    discovery path: a hung sitemap host returns ``[]``, not
    an unbounded wait, so the Add Custom endpoint can't hang on
    this hop either.
    """
    safe, reason = check_url_safe(page_url)
    if not safe:
        logger.info("feed_autodiscovery: %s rejected by URL safety check (%s)", page_url, reason)
        return []
    try:
        urls = await asyncio.wait_for(
            _crawl_sitemaps(page_url, limit), _TRAFILATURA_BUDGET
        )
    except asyncio.TimeoutError:
        logger.info(
            "feed_autodiscovery: sitemap crawl for %s hit the %ss budget",
            page_url, _TRAFILATURA_BUDGET,
        )
        return []
    except Exception as exc:  # noqa: BLE001
        logger.info("feed_autodiscovery: sitemap crawl failed for %s: %s", page_url, exc)
        return []
    return urls[:limit]


# Sitemap crawl limits: how many sitemap documents one discovery may
# fetch (robots.txt-listed + guessed + nested index entries).
_MAX_SITEMAP_DOCS = 10
_GUESSED_SITEMAP_PATHS = ("/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml")


def _looks_like_sitemap(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith((".xml", ".xml.gz", ".txt")) or "sitemap" in path


def _site_key(host: str) -> str:
    """Approximate registrable domain: news.example.com -> example.com,
    www.bbc.co.uk -> bbc.co.uk. Good enough to keep a site's own
    subdomains together without a public-suffix list."""
    host = host.lower().rstrip(".")
    if host.replace(".", "").isdigit() or ":" in host:  # IP literal
        return host
    labels = host.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in {
        "co", "com", "org", "net", "gov", "ac", "edu"
    }:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _same_site(url: str, host: str) -> bool:
    return _site_key(urlparse(url).hostname or "") == _site_key(host)


def _parse_sitemap(text: str) -> tuple[list[str], list[str]]:
    """Return (page URLs, nested sitemap URLs) from a sitemap document:
    an XML urlset, an XML sitemapindex, or a plain-text list."""
    try:
        root = DefusedET.fromstring(text.lstrip())
    except (DefusedET.ParseError, ValueError, DefusedXmlException):
        lines = [ln.strip() for ln in text.splitlines()]
        return [ln for ln in lines if ln.startswith(("http://", "https://"))], []
    pages: list[str] = []
    nested: list[str] = []
    is_index = root.tag.rsplit("}", 1)[-1] == "sitemapindex"
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] == "loc" and el.text:
            (nested if is_index else pages).append(el.text.strip())
    return pages, nested


async def _crawl_sitemaps(page_url: str, limit: int) -> list[str]:
    """Find article URLs for ``page_url`` from its sitemap(s), using only
    SSRF-guarded fetches. ``page_url`` may be a sitemap itself or a site
    URL; for a site URL, robots.txt ``Sitemap:`` lines are tried first,
    then a few common paths."""
    parsed = urlparse(page_url)
    host = (parsed.hostname or "").lower()
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if _looks_like_sitemap(page_url):
        queue = [page_url]
    else:
        robots = await fetch_html(f"{origin}/robots.txt", content_types=None) or ""
        listed = [
            line.split(":", 1)[1].strip()
            for line in robots.splitlines()
            if line.lower().startswith("sitemap:")
        ]
        queue = listed or [origin + path for path in _GUESSED_SITEMAP_PATHS]

    seen: set[str] = set()
    pages: list[str] = []
    page_set: set[str] = set()
    fetched = 0
    while queue and fetched < _MAX_SITEMAP_DOCS and len(pages) < limit:
        url = queue.pop(0)
        if url in seen or not _same_site(url, host):
            continue
        seen.add(url)
        fetched += 1
        text = await fetch_html(url, content_types=None)
        if not text:
            continue
        found, nested = _parse_sitemap(text)
        for u in found:
            if len(pages) >= limit:
                break
            if u not in page_set and _same_site(u, host):
                page_set.add(u)
                pages.append(u)
        queue.extend(nested)
    return pages
