"""The Add preview: what a pasted address will bring, before it is
added (``POST /api/sources/preview``, ``routes/sources.py``).

One field takes any address. The preview reads it the way Add's first
check would, in this order, and stops at the first that works:

1. A YouTube or Apple Podcasts link resolves to its feed.
2. A subreddit reads through ``reddit_client``. Reddit switched off on
   the server is ``reddit_off`` (``fetch_subreddit`` returns ``[]``
   while disabled, which would read as an empty subreddit).
3. The address as a feed: one attempt with a short read
   (``FEED_READ_S``), not ``fetch_rss``'s two attempts with a 60 s
   read. A 401, 402 or 403, or a challenge page, is tried once more as
   Safari (``rss.BROWSER_HEADERS``) when the caller sent no
   User-Agent of its own. A timeout moves on to discovery rather than
   failing.
4. The feed the page links to (``discover_feed_url``), reusing the
   page step 3 got back, so nothing is fetched as a feed twice.
5. The page as a website feed: ``generic_scrape.plan_candidates``, then
   up to ``EXTRACT_MAX`` of its pages read and scored
   (``generic_scrape.preview_page``). A refused plan, or pages that
   all refuse, are tried once more as Safari on the same terms.

The Safari retry keeps the caller's own headers and adds only what the
caller didn't set. The caller's headers go to the address's own site:
a feed link on another host is fetched without them.

Limits, all module constants so tests can shrink them:

- **One deadline.** The whole preview has ``PREVIEW_BUDGET_S``; each
  step gets the smaller of its own cap and the time left. Step 3 and
  step 4 take at most half of what is left when a later step could
  still find the stories, so a hanging feed fetch can't use up the
  time discovery needs. Out of time, the response carries what is
  known (the kind, the stories, the feed links found) with
  ``error_kind: "timeout"``.
- **Two at a time.** ``PREVIEW_CONCURRENCY`` slots, and no queue: a
  third preview while both are taken is ``busy`` at once. The request
  waits on its pipeline task through ``asyncio.shield``, so a slot is
  held until that task ends, not until the response is sent. The task
  ends only after the parsing threads it started have ended
  (``thread_work``): a timeout stops the wait, never the thread, so a
  parse past the deadline keeps its slot.
- **A short cache.** ``PREVIEW_CACHE_TTL_S`` seconds, at most
  ``PREVIEW_CACHE_MAX`` entries, in this process. It holds only what
  was fetched and parsed upstream (``_Upstream``), keyed on the
  address, the type, the sitemap URL, the link pattern and a hash of
  the request headers, so a preview with no headers never gets a result
  fetched with the caller's headers. Only a preview that worked is
  kept, and a task that outlives its response can still fill it. What
  depends on the database (the duplicate, the stored and new counts) is
  worked out fresh on every request (``build_result``), because an Add,
  a delete or a first check inside two minutes changes it.

Every fetch goes through the SSRF-guarded fetchers
(``rss.get_feed_response``, ``article_extract.fetch_html``,
``reddit_client``), and an error is one fixed sentence per
``error_kind``: never response text, an exception or an address.
"""

from __future__ import annotations

import asyncio
import dataclasses
import datetime as dt
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable
from dataclasses import dataclass, field
from typing import Any, TypeVar
from urllib.parse import urlparse

import httpx

from app import reddit_client
from app.apple_podcasts import PodcastResolutionError, resolve_feed_url
from app.article_detect import Candidate
from app.article_extract import NETWORK_ERRORS, FetchRefusedError
from app.feed_autodiscovery import discover_feed_url, probe_headers
from app.ingest_rules import FIRST_FETCH, IngestTunables, published_utc, select_items_for_ingest
from app.schemas import SourcePreviewDuplicate, SourcePreviewItem, SourcePreviewResult
from app.sources import generic_scrape
from app.sources.base import NoArticleListError, NotAFeedError, validate_required
from app.sources.reddit import normalize_subreddit
from app.sources.rss import _DEFAULT_HEADERS, BROWSER_HEADERS, ParsedFeed, get_feed_response, parse_feed
from app.thread_work import drain, run_in_thread, tracked
from app.url_safety import check_url_safe
from app.youtube import (
    YouTubeResolutionError,
    is_youtube_url,
    normalize_youtube_input,
    resolve_channel_feed_url,
)

logger = logging.getLogger("popping.source_preview")

T = TypeVar("T")

# The whole preview's deadline, in seconds.
PREVIEW_BUDGET_S = 60.0
# Previews that may run at once; a further one is ``busy``.
PREVIEW_CONCURRENCY = 2
# The upstream cache: seconds an entry lives, and most entries kept.
PREVIEW_CACHE_TTL_S = 120.0
PREVIEW_CACHE_MAX = 32

# Step caps, each also bounded by the time left.
RESOLVE_CAP_S = 15.0      # a YouTube or Apple lookup
REDDIT_CAP_S = 20.0       # one subreddit listing
FEED_CONNECT_S = 6.0      # step 3's connect
FEED_READ_S = 12.0        # step 3's read (and each feed link discovery tries)
DISCOVERY_CAP_S = 30.0    # step 4
PLAN_CAP_S = 40.0         # step 5's sitemap and listing reads

# Pages read in step 5, and how many at once (one site, so few).
EXTRACT_MAX = 8
EXTRACT_CONCURRENCY = 3
# Stories returned, and the longest title.
ITEMS_MAX = 50
TITLE_MAX = 300

# The type an address is read as when the caller names one; None reads
# it every way Add would.
FEED_TYPES = frozenset({"rss", "podcast", "youtube_channel"})

# One short sentence per ``error_kind``.
ERRORS = {
    # The message /sources/test gives a private or unreachable host
    # (``routes.sources._validate_url``), so the two never differ.
    "invalid_url": "url is not reachable (must be a public host)",
    "invalid_headers": "Those headers can't be sent.",
    "invalid_options": "Check the sitemap address and link pattern.",
    "blocked": "The site refused Popping.",
    "not_found": "Nothing was found at that address.",
    "not_a_feed": "That address isn't a feed.",
    "no_list": "No feed or list of stories was found there.",
    "http_error": "The site answered with an error. Try again later.",
    "network": "The site didn't answer.",
    "timeout": "The site took too long to answer.",
    "busy": "Two previews are already running. Try again in a moment.",
    "reddit_off": "Reddit isn't available on this server.",
    "error": "Popping couldn't read that address.",
}

# A challenge page (Cloudflare and the like) instead of the document.
# Only markers of the interstitial itself: an ordinary page behind
# Cloudflare loads ``/cdn-cgi/challenge-platform/...`` scripts (its bot
# detection), and one behind DDoS-Guard loads its scripts, so neither
# name alone says the page is a challenge.
_CHALLENGE_RE = re.compile(
    r"<title>\s*Just a moment|_cf_chl_opt|cf-chl-|"
    r"Attention Required! \| Cloudflare|<title>\s*DDoS-Guard|px-captcha",
    re.IGNORECASE,
)
# Statuses Popping reads as the site refusing it (``[blocked]``).
_REFUSED = frozenset({401, 402, 403})


@dataclass(frozen=True)
class PreviewRequest:
    """A validated preview request (``routes/sources.py`` checks the
    URL's options and the headers the way Add does)."""

    url: str
    type: str | None = None
    sitemap_url: str | None = None
    link_pattern: str | None = None
    headers: dict[str, str] | None = None

    @property
    def key(self) -> tuple:
        """The cache key. Header names are lower-cased and sorted before
        hashing, so the same headers spelled differently share an entry;
        only the hash is kept."""
        pairs = sorted((k.lower(), v) for k, v in (self.headers or {}).items())
        digest = hashlib.sha256(json.dumps(pairs).encode()).hexdigest()
        return (self.url, self.type, self.sitemap_url, self.link_pattern, digest)


@dataclass
class _Upstream:
    """What a preview found upstream: the cached half of a result. The
    pipeline fills it as it goes, so a timeout can return what is known
    so far."""

    kind: str | None = None
    url: str | None = None
    mode: str | None = None
    headers_used: str = "default"
    feed_title: str | None = None
    # Feed and Reddit stories, normalized, in feed order.
    items: list[dict] = field(default_factory=list)
    # A website's candidates (``Plan.candidates``) and its pages read so
    # far, keyed by URL (``generic_scrape.preview_page``).
    candidates: list[Candidate] = field(default_factory=list)
    pages: dict[str, dict] = field(default_factory=dict)
    # The feed links the page offered (Find its feed).
    feed_candidates: list[str] = field(default_factory=list)
    error_kind: str | None = None

    def snapshot(self, error_kind: str | None = None) -> "_Upstream":
        """A copy the still-running pipeline can't change underneath.
        ``error_kind`` applies only when the pipeline hasn't recorded
        one of its own."""
        return dataclasses.replace(
            self,
            items=list(self.items),
            candidates=list(self.candidates),
            pages=dict(self.pages),
            feed_candidates=list(self.feed_candidates),
            error_kind=self.error_kind or error_kind,
        )


class _Stop(Exception):
    """Ends the pipeline with ``error_kind``."""

    def __init__(self, error_kind: str) -> None:
        super().__init__(error_kind)
        self.error_kind = error_kind


# --- Process-local state ------------------------------------------------

_slots = asyncio.Semaphore(PREVIEW_CONCURRENCY)
# Pipeline tasks still running, so none is garbage-collected mid-flight
# after its response has gone (``routes/sources._DISCOVERY_TASKS``).
_tasks: set[asyncio.Task] = set()
_cache: "OrderedDict[tuple, tuple[float, _Upstream]]" = OrderedDict()


def _cache_get(key: tuple) -> _Upstream | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    expires, upstream = hit
    if time.monotonic() >= expires:
        _cache.pop(key, None)
        return None
    return upstream.snapshot()


def _cache_put(key: tuple, upstream: _Upstream) -> None:
    _cache[key] = (time.monotonic() + PREVIEW_CACHE_TTL_S, upstream.snapshot())
    _cache.move_to_end(key)
    while len(_cache) > PREVIEW_CACHE_MAX:
        _cache.popitem(last=False)


def clear_cache() -> None:
    """Drop every cached preview (tests)."""
    _cache.clear()


# --- Running a preview --------------------------------------------------


async def run_preview(req: PreviewRequest) -> _Upstream:
    """Read ``req`` upstream, from the cache when it has it. Returns by
    the deadline; a preview still running then comes back as
    ``timeout`` with what it knew, and finishes in the background."""
    cached = _cache_get(req.key)
    if cached is not None:
        return cached
    if _slots.locked():
        return _Upstream(error_kind="busy")
    deadline = time.monotonic() + PREVIEW_BUDGET_S
    state = _Upstream()
    # Never waits: the slot is free (checked above, with no await since).
    await _slots.acquire()
    try:
        task = asyncio.create_task(_pipeline(req, state, deadline))
    except BaseException:
        _slots.release()
        raise
    _tasks.add(task)
    task.add_done_callback(_pipeline_done)
    try:
        return await asyncio.wait_for(asyncio.shield(task), max(0.0, deadline - time.monotonic()))
    except asyncio.TimeoutError:
        logger.info("source_preview: %s ran out of time; returning what is known", req.url)
        return state.snapshot("timeout")


def _pipeline_done(task: asyncio.Task) -> None:
    _tasks.discard(task)
    _slots.release()
    if not task.cancelled() and task.exception() is not None:
        logger.error("source_preview: pipeline failed", exc_info=task.exception())


async def _pipeline(req: PreviewRequest, state: _Upstream, deadline: float) -> _Upstream:
    """Run the steps, then wait out any parsing thread they started,
    then cache a preview that worked."""
    with tracked() as threads:
        try:
            await _read(req, state, deadline)
        except _Stop as stop:
            state.error_kind = stop.error_kind
        except asyncio.TimeoutError:
            state.error_kind = "timeout"
        except Exception:  # noqa: BLE001 - a preview reports, it never fails the request
            logger.exception("source_preview: %s failed", req.url)
            state.error_kind = "error"
        await drain(threads)
    if state.error_kind is None:
        _cache_put(req.key, state)
    return state.snapshot()


async def _step(coro: Awaitable[T], cap: float, deadline: float, share: float = 1.0) -> T:
    """``coro`` with the smaller of ``cap`` and ``share`` of the time
    left. Raises ``asyncio.TimeoutError`` when it runs out."""
    budget = min(cap, (deadline - time.monotonic()) * share)
    if budget <= 0:
        if asyncio.iscoroutine(coro):
            coro.close()
        raise asyncio.TimeoutError
    return await asyncio.wait_for(coro, budget)


async def _read(req: PreviewRequest, state: _Upstream, deadline: float) -> None:
    url = req.url
    kind_hint = req.type
    headers = dict(req.headers or {})
    state.headers_used = "custom" if headers else "default"

    # 1. YouTube and Apple Podcasts links resolve to their feed.
    if kind_hint not in ("reddit", "generic_scrape"):
        try:
            resolved = await _step(resolve_feed_url(url), RESOLVE_CAP_S, deadline)
            if resolved != url:
                url, kind_hint = resolved, kind_hint or "podcast"
            youtube_ok = kind_hint in (None, "youtube_channel")
            # Any YouTube address, the channel feed's own included (it
            # resolves to itself), is a YouTube channel, as
            # ``/sources/auto`` types it, unless the caller named a
            # feed type of its own.
            youtube = youtube_ok and is_youtube_url(
                normalize_youtube_input(url, allow_bare_handle=youtube_ok)
            )
            resolved = await _step(
                resolve_channel_feed_url(url, allow_bare_handle=youtube_ok),
                RESOLVE_CAP_S,
                deadline,
            )
            if resolved != url or youtube:
                url, kind_hint = resolved, "youtube_channel"
        except (PodcastResolutionError, YouTubeResolutionError):
            raise _Stop("not_found")

    # 2. A subreddit.
    if kind_hint == "reddit" or (kind_hint is None and _is_subreddit_url(url)):
        await _read_reddit(url, state, deadline)
        return

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise _Stop("invalid_url")
    safe, reason = check_url_safe(url)
    if not safe:
        # The reason names internal addresses: the log only.
        logger.info("source_preview: refused by the SSRF guard host=%s reason=%s", parsed.hostname, reason)
        raise _Stop("invalid_url")
    state.url = url
    if kind_hint in FEED_TYPES:
        # Known before anything is fetched, so a preview that runs out
        # of time still says what it is reading; a feed that parses
        # settles it (``_found_feed``).
        state.kind = kind_hint

    discovery_next = kind_hint in (None, "rss", "podcast")
    scrape_next = kind_hint in (None, "generic_scrape")

    # 3. The address as a feed.
    page_html: str | None = None
    if kind_hint in (None, "rss", "podcast", "youtube_channel"):
        share = 0.5 if discovery_next or scrape_next else 1.0
        outcome = await _read_feed(url, headers, state, deadline, share)
        if isinstance(outcome, ParsedFeed):
            _found_feed(state, url, outcome, kind_hint)
            return
        if not discovery_next:
            # Nothing comes after a YouTube feed: a timeout is the
            # answer, not "isn't a feed".
            if outcome is None:
                raise asyncio.TimeoutError
            raise _Stop("not_a_feed")
        page_html = outcome or None
        headers = _effective_headers(headers, state)

    # 4. The feed the page links to.
    if discovery_next:
        found = await _discover(url, headers, page_html, state, deadline, share=0.5 if scrape_next else 1.0)
        if found is not None:
            feed_url, feed = found
            _found_feed(state, feed_url, feed, kind_hint)
            return
        if not scrape_next:
            raise _Stop("not_a_feed")

    # 5. The page as a website feed.
    await _read_site(req, url, headers, state, deadline)


_SUBREDDIT_REF_RE = re.compile(r"/?r/[A-Za-z0-9_]{2,21}/?")


def _is_subreddit_url(url: str) -> bool:
    """A subreddit link (``reddit.com/r/<name>``) or reference
    (``r/<name>``). A bare word is not one: with no type given, it
    could be anything."""
    if _SUBREDDIT_REF_RE.fullmatch(url):
        return True
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    return (host == "reddit.com" or host.endswith(".reddit.com")) and parsed.path.lower().startswith("/r/")


async def _read_reddit(url: str, state: _Upstream, deadline: float) -> None:
    state.kind = "reddit"
    state.mode = "reddit"
    if reddit_client.is_disabled():
        raise _Stop("reddit_off")
    sub = normalize_subreddit(url)
    if not sub:
        raise _Stop("invalid_url")
    state.url = f"https://www.reddit.com/r/{sub}"
    try:
        # The listing the feed's own checks read (``DynamicRedditPlugin``),
        # so the counts are the first check's.
        posts = await _step(
            reddit_client.fetch_subreddit(sub, listing="hot", limit=50), REDDIT_CAP_S, deadline
        )
    except reddit_client.RedditFetchThrottled:
        raise _Stop("http_error")
    if not posts:
        # A private, banned or missing subreddit and a failed fetch all
        # come back empty (``fetch_subreddit``).
        raise _Stop("not_found")
    state.feed_title = f"r/{sub}"
    state.items = _normalized(_reddit_item(post) for post in posts)


def _reddit_item(post: dict) -> dict:
    """A listing post as a story, the way ``DynamicRedditPlugin`` maps
    it: the outbound link, else the thread."""
    url = post.get("url") or ""
    permalink = post.get("permalink") or ""
    if not url and permalink:
        url = f"https://www.reddit.com{permalink}"
    created: dt.datetime | None = None
    try:
        if post.get("created_utc") is not None:
            created = dt.datetime.fromtimestamp(int(float(post["created_utc"])), tz=dt.timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        created = None
    return {"title": post.get("title") or "", "url": url, "published_at": created}


def _normalized(raw_items) -> list[dict]:
    """Items the ingest would accept (``validate_required``: a title and
    a URL, the title unescaped)."""
    out: list[dict] = []
    for raw in raw_items:
        try:
            out.append(validate_required("preview", raw))
        except ValueError:
            continue
    return out


def _feed_timeout() -> httpx.Timeout:
    return httpx.Timeout(connect=FEED_CONNECT_S, read=FEED_READ_S, write=FEED_READ_S, pool=FEED_READ_S)


def _is_refusal(resp: httpx.Response) -> bool:
    """The site refused us: 401, 402 or 403, or a challenge page in
    place of the document (whatever its status)."""
    if resp.status_code in _REFUSED:
        return True
    if (resp.headers.get("cf-mitigated") or "").lower() == "challenge":
        return True
    ctype = (resp.headers.get("content-type") or "").lower()
    return "html" in ctype and bool(_CHALLENGE_RE.search(resp.text[:16_384]))


def _may_retry_as_browser(headers: dict[str, str]) -> bool:
    return not any(k.lower() == "user-agent" for k in headers)


def _as_browser(headers: dict[str, str]) -> dict[str, str]:
    """``headers`` read as Safari: ``BROWSER_HEADERS`` under the
    caller's own, so a header the caller set (its ``Accept-Language``)
    is kept and only the User-Agent, which the caller didn't set
    (``_may_retry_as_browser``), is Safari's. Header names arrive
    canonical (``routes.sources._validate_custom_headers``), so no name
    is sent twice in two spellings."""
    return {**BROWSER_HEADERS, **headers}


def _effective_headers(headers: dict[str, str], state: _Upstream) -> dict[str, str]:
    """The headers later steps send: Safari's once the site answered
    Safari and not us."""
    if state.headers_used == "browser":
        return _as_browser(headers)
    return headers


async def _get_document(
    url: str, headers: dict[str, str], state: _Upstream, deadline: float, share: float
) -> httpx.Response:
    """One GET of ``url`` as a feed, and once more as Safari when the
    site refuses us and the caller set no User-Agent. Raises ``_Stop``
    for an answer that ends the preview, and ``asyncio.TimeoutError``
    (or an httpx timeout) when it runs out of time.

    ``share`` of the time left is worked out once, before the first
    attempt, and both attempts come out of it, so a slow refusal and a
    hanging retry together still leave the rest to the later steps.
    Each attempt also has its own cap."""
    cap = FEED_CONNECT_S + FEED_READ_S
    now = time.monotonic()
    step_deadline = now + max(0.0, share * (deadline - now))

    async def get(with_headers: dict[str, str]) -> httpx.Response:
        return await _step(
            get_feed_response(
                url, {**_DEFAULT_HEADERS, **with_headers}, timeout=_feed_timeout(), raise_for_status=False
            ),
            cap,
            step_deadline,
        )

    try:
        resp = await get(headers)
        if _is_refusal(resp) and _may_retry_as_browser(headers):
            retry = await get(_as_browser(headers))
            if not _is_refusal(retry):
                state.headers_used = "browser"
            resp = retry
    except httpx.TimeoutException:
        raise asyncio.TimeoutError
    except NETWORK_ERRORS:
        raise _Stop("network")
    except (httpx.HTTPError, ValueError):
        # The SSRF hook's ``httpx.RequestError`` or a redirect to a
        # denied host (``get_feed_response``).
        raise _Stop("invalid_url")
    if _is_refusal(resp):
        raise _Stop("blocked")
    if resp.status_code in (404, 410):
        raise _Stop("not_found")
    if resp.status_code >= 400:
        raise _Stop("http_error")
    return resp


async def _read_feed(
    url: str, headers: dict[str, str], state: _Upstream, deadline: float, share: float
) -> ParsedFeed | str | None:
    """Step 3. The parsed feed, the page that came back instead of one
    (``""`` when the body is neither a feed nor HTML, so there is no
    page to reuse), or None when it ran out of time."""
    try:
        resp = await _get_document(url, headers, state, deadline, share)
    except asyncio.TimeoutError:
        logger.info("source_preview: %s timed out as a feed", url)
        return None
    ctype = resp.headers.get("content-type")
    try:
        return await run_in_thread(parse_feed, resp.text, url, ctype)
    except NotAFeedError:
        return resp.text if "html" in (ctype or "").lower() else ""
    except ValueError:
        # A feed whose entries are broken: nothing to add from it.
        return ""


def _found_feed(state: _Upstream, url: str, feed: ParsedFeed, kind_hint: str | None) -> None:
    """Record a feed that parsed. A YouTube channel (named, or a YouTube
    address) stays one. Any other feed, whether the caller named
    ``rss`` or ``podcast`` or no type, is a podcast when it has audio
    enclosures or the iTunes namespace, else ``rss``: a named feed type
    means "read it as a feed", so a podcast found through a page (Find
    its feed previews with ``type: "rss"``) still gets the podcast
    refresh default and category on Add."""
    if kind_hint == "youtube_channel":
        state.kind = kind_hint
    elif feed.podcast:
        state.kind = "podcast"
    else:
        state.kind = "rss"
    state.url = url
    state.mode = "feed"
    state.feed_title = feed.title
    state.items = _normalized(feed.items)


async def _discover(
    url: str,
    headers: dict[str, str],
    page_html: str | None,
    state: _Upstream,
    deadline: float,
    share: float,
) -> tuple[str, ParsedFeed] | None:
    """Step 4: the first feed link on the page that parses with items,
    and what it parsed to. Each link is recorded as it is tried, so a
    timeout still returns them."""
    parsed: dict[str, ParsedFeed] = {}

    async def probe(candidate: str) -> object:
        state.feed_candidates.append(candidate)
        sent = probe_headers(candidate, url, headers)
        if sent is None:
            # A feed link on another site never gets the caller's own
            # headers (an API key is for this site), only the public
            # Safari preset once this site needed it.
            sent = BROWSER_HEADERS if state.headers_used == "browser" else {}
        resp = await get_feed_response(
            candidate, {**_DEFAULT_HEADERS, **sent}, timeout=_feed_timeout()
        )
        feed = await run_in_thread(parse_feed, resp.text, candidate, resp.headers.get("content-type"))
        parsed[candidate] = feed
        return feed.items

    try:
        found = await _step(
            discover_feed_url(
                url, headers or None, tried_as_feed=True, page_html=page_html, probe=probe
            ),
            DISCOVERY_CAP_S,
            deadline,
            share,
        )
    except asyncio.TimeoutError:
        logger.info("source_preview: discovery for %s ran out of time", url)
        if deadline - time.monotonic() <= 0:
            raise
        return None
    if found is None or found not in parsed:
        return None
    return found, parsed[found]


async def _read_site(
    req: PreviewRequest, url: str, headers: dict[str, str], state: _Upstream, deadline: float
) -> None:
    """Step 5: the website feed's plan, then its newest pages read.

    A site that refuses us is asked once more as Safari when the caller
    set no User-Agent: its sitemap or listing (the plan), or, when the
    plan was served, its pages, since a site often serves its sitemap
    but refuses its article pages. Every page read refused, still or
    with no retry allowed, ends the preview the way it ends Add's first
    check (``GenericScrapePlugin._settle_refusals``): ``blocked``, or
    ``http_error`` when every refusal was a 429."""
    state.kind = "generic_scrape"
    state.url = url

    async def plan(with_headers: dict[str, str]):
        return await _step(
            generic_scrape.plan_candidates(
                url,
                req.sitemap_url,
                req.link_pattern,
                with_headers or None,
                raise_errors=True,
            ),
            PLAN_CAP_S,
            deadline,
        )

    try:
        try:
            found = await plan(headers)
        except FetchRefusedError as exc:
            if exc.response.status_code == 429 or not _may_retry_as_browser(headers):
                raise
            headers = _as_browser(headers)
            found = await plan(headers)
            state.headers_used = "browser"
    except FetchRefusedError as exc:
        raise _Stop("http_error" if exc.response.status_code == 429 else "blocked")
    except httpx.HTTPStatusError as exc:
        raise _Stop("not_found" if exc.response.status_code in (404, 410) else "http_error")
    except NoArticleListError:
        raise _Stop("no_list")
    except NETWORK_ERRORS:
        raise _Stop("network")
    state.mode = found.mode
    state.candidates = list(found.candidates)
    owner_configured = bool(req.link_pattern) or (bool(req.sitemap_url) and found.mode == "sitemap")
    sem = asyncio.Semaphore(EXTRACT_CONCURRENCY)

    newest = found.candidates[:EXTRACT_MAX]

    async def read(candidate: Candidate, with_headers: dict[str, str], as_browser: bool) -> None:
        async with sem:
            verdict = await generic_scrape.preview_page(
                candidate, with_headers or None, owner_configured=owner_configured
            )
        # A page read again as Safari replaces its refusal.
        state.pages[candidate.url] = verdict
        if as_browser and verdict["reason"] != generic_scrape.REFUSED:
            state.headers_used = "browser"

    async def read_all(with_headers: dict[str, str], as_browser: bool = False) -> None:
        await asyncio.gather(*(read(c, with_headers, as_browser) for c in newest))

    async def read_newest() -> None:
        await read_all(headers)
        refusal = _refusal(state, newest)
        if refusal == "blocked" and _may_retry_as_browser(headers):
            await read_all(_as_browser(headers), as_browser=True)
            refusal = _refusal(state, newest)
        if refusal is not None:
            raise _Stop(refusal)

    # Each page is recorded as it is read, so a timeout returns those.
    # The Safari retry runs inside the same step and deadline.
    await _step(read_newest(), PREVIEW_BUDGET_S, deadline)


def _refusal(state: _Upstream, candidates: list[Candidate]) -> str | None:
    """``blocked`` when every page read was refused and a 401-403 was
    among them, ``http_error`` when every one was a 429 (a rate limit,
    which Safari wouldn't change), None when any page answered or none
    was read."""
    verdicts = [state.pages.get(c.url) for c in candidates]
    if not verdicts or any(v is None or v["reason"] != generic_scrape.REFUSED for v in verdicts):
        return None
    return "http_error" if all(v.get("status") == 429 for v in verdicts) else "blocked"


# --- The response -------------------------------------------------------


def lookup_urls(upstream: _Upstream) -> list[str]:
    """The story URLs whose stored state the response needs."""
    if upstream.kind == "generic_scrape":
        return [c.url for c in upstream.candidates]
    return [item["url"] for item in upstream.items]


def address_variants(url: str) -> list[str]:
    """``url`` with and without a trailing slash: the spellings a feed
    already following it may be stored under."""
    bare = url.rstrip("/")
    return list(dict.fromkeys([url, bare, bare + "/"]))


def build_result(
    upstream: _Upstream,
    *,
    known: set[str],
    duplicate: SourcePreviewDuplicate | None,
    rules: IngestTunables,
    now: dt.datetime,
) -> SourcePreviewResult:
    """The response for ``upstream``, with the parts that depend on what
    is stored worked out now: which stories are already stored
    (``known``), the feed already following the address
    (``duplicate``), and what Add's first check would keep
    (``ingest_rules.select_items_for_ingest`` with ``first_fetch``)."""
    result = SourcePreviewResult(
        ok=upstream.error_kind is None,
        kind=upstream.kind,
        url=upstream.url,
        headers_used=upstream.headers_used,
        mode=upstream.mode,
        feed_title=_clip(upstream.feed_title),
        feed_candidates=upstream.feed_candidates[:10],
        duplicate_of=duplicate,
        error_kind=upstream.error_kind,
        error=ERRORS.get(upstream.error_kind) if upstream.error_kind else None,
    )
    if upstream.kind == "generic_scrape":
        _count_site(result, upstream, known, rules, now)
    else:
        _count_feed(result, upstream.items, known, rules, now)
    return result


def _clip(title: Any) -> str | None:
    if not isinstance(title, str):
        return None
    title = " ".join(title.split())
    return title[:TITLE_MAX] or None


def _first_fetch(items: list[dict], known: set[str], rules: IngestTunables, now: dt.datetime, per_poll: int):
    return select_items_for_ingest(
        items,
        known=known,
        first_fetch=True,
        baseline_at=None,
        now=now,
        keep_first=rules.first_fetch_keep,
        backfill_h=rules.backfill_hours,
        max_age_d=rules.max_age_days,
        per_poll=per_poll,
        max_undated=rules.max_undated_per_poll,
    )


def _count_feed(
    result: SourcePreviewResult,
    items: list[dict],
    known: set[str],
    rules: IngestTunables,
    now: dt.datetime,
) -> None:
    """A feed (or a subreddit): the first-fetch rule over its items."""
    kept, counts = _first_fetch(items, known, rules, now, rules.max_per_poll)
    # The same rule with no per-check cap, to tell a story over the cap
    # (a later check takes it) from one left out as older.
    uncapped, _ = _first_fetch(items, known, rules, now, max(len(items), 1))
    kept_urls = {item["url"] for item in kept}
    uncapped_urls = {item["url"] for item in uncapped}
    distinct: dict[str, dict] = {}
    for item in items:
        distinct.setdefault(item["url"], item)
    result.total_count = len(distinct)
    result.already_stored_count = sum(1 for url in distinct if url in known)
    result.will_add_count = len(kept_urls)
    result.older_skipped_count = counts.get(FIRST_FETCH, 0)
    for url, item in list(distinct.items())[:ITEMS_MAX]:
        if url in kept_urls:
            reason = None
        elif url in known:
            reason = "stored"
        elif url in uncapped_urls:
            reason = "over_cap"
        else:
            reason = "older"
        result.items.append(
            SourcePreviewItem(
                title=_clip(item.get("title")),
                url=url,
                published_at=published_utc(item.get("published_at")),
                accepted=reason is None,
                reason=reason,
            )
        )


def _count_site(
    result: SourcePreviewResult,
    upstream: _Upstream,
    known: set[str],
    rules: IngestTunables,
    now: dt.datetime,
) -> None:
    """A website feed. ``total_count`` is every candidate page. A page
    the preview read counts by what it found (a story with its own
    date, or turned down); one not read yet counts as a story, dated by
    its list (a listing card's date, a news sitemap's, else the
    sitemap's ``<lastmod>``, which a page's publication can't be later
    than). Add's first check reads at most ``_MAX_NEW_PER_POLL`` pages
    and keeps at most ``max_undated_per_poll`` undated ones, so it adds
    ``min(stories, 10, dated + 2)`` of those the first-fetch rule
    doesn't leave out as older."""
    candidates = upstream.candidates
    pseudo: list[dict] = []
    for c in candidates:
        verdict = upstream.pages.get(c.url)
        if verdict is not None and c.url not in known:
            if not verdict["accepted"]:
                continue
            when = verdict["published_at"]
        else:
            when = c.published or c.modified
        pseudo.append({"url": c.url, "published_at": when})
    result.total_count = len({c.url for c in candidates})
    result.already_stored_count = sum(1 for c in {c.url for c in candidates} if c in known)
    kept, counts = _first_fetch(pseudo, known, rules, now, max(len(pseudo), 1))
    result.older_skipped_count = counts.get(FIRST_FETCH, 0)
    dated = sum(1 for item in kept if item["published_at"] is not None)
    result.will_add_count = min(
        len(kept), generic_scrape._MAX_NEW_PER_POLL, dated + rules.max_undated_per_poll
    )
    for c in candidates:
        verdict = upstream.pages.get(c.url)
        if verdict is None:
            continue
        stored = c.url in known
        result.items.append(
            SourcePreviewItem(
                title=_clip(verdict["title"]),
                url=c.url,
                published_at=published_utc(verdict["published_at"]),
                accepted=bool(verdict["accepted"]) and not stored,
                reason="stored" if stored else verdict["reason"],
            )
        )
