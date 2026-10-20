"""PR11a: ``POST /api/sources/preview``, the Add preview (``app.source_preview``).

Every case runs the real fetch path: the SSRF-guarded fetchers
(``rss.get_feed_response``, ``article_extract.fetch_html``), the URL
safety check and the SSRF hook, with DNS answered by ``fake_dns``. Only
the transport is fake: each request goes to the test's routes through an
httpx ``MockTransport``, and an unrouted URL answers 404. Nothing touches
the network.

- A site that refuses our User-Agent (in feed mode and in website mode)
  is asked once more as Safari (``rss.BROWSER_HEADERS``), and only when
  the caller sent no User-Agent of its own.
- One deadline: a hanging feed fetch still leaves time for discovery,
  and running out returns ``timeout`` with what is known.
- Two at a time, no queue: a parse that runs past the deadline keeps its
  slot, and a third preview is ``busy`` until it ends.
- The cache holds only the upstream half: other options or headers fetch
  again, and the duplicate and the counts are fresh after an Add.
- The counts in feed and website mode, and ``kind='podcast'``.
- ``reddit_off``, and the SSRF guard's message.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import threading
import time
from email.utils import format_datetime

import httpx
import pytest
from sqlalchemy import select

from app import article_extract, feed_autodiscovery, reddit_client, source_preview
from app.models import Entry, Source
from app.sources import generic_scrape, rss

SITE = "https://www.example.com"
FEED = f"{SITE}/feed.xml"
SECRET = "preview-header-value-7f3a"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _rss(n: int, *, podcast: bool = False, hours_step: float = 24, path: str = "s") -> str:
    """A feed of ``n`` stories, the newest an hour old and each next one
    ``hours_step`` older. ``podcast`` gives each an audio enclosure."""
    items = []
    for i in range(n):
        when = _now() - dt.timedelta(hours=1 + i * hours_step)
        enclosure = (
            f'<enclosure url="{SITE}/audio/{i}.mp3" type="audio/mpeg" length="1"/>' if podcast else ""
        )
        items.append(
            f"<item><title>Story {i}</title><link>{SITE}/{path}/{i}</link>"
            f"<pubDate>{format_datetime(when)}</pubDate>{enclosure}</item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
        f"<title>Example Daily</title><link>{SITE}/</link>{''.join(items)}</channel></rss>"
    )


def _itunes_feed() -> str:
    """A podcast feed that declares the iTunes namespace (no enclosures)."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>'
        f"<title>Example Show</title><link>{SITE}/</link><itunes:author>Example</itunes:author>"
        f"<item><title>Episode 1</title><link>{SITE}/ep/1</link>"
        f"<pubDate>{format_datetime(_now())}</pubDate></item></channel></rss>"
    )


def _page_linking(feed_path: str) -> str:
    return (
        "<html><head><title>Example blog</title>"
        f'<link rel="alternate" type="application/rss+xml" href="{feed_path}">'
        "</head><body><p>Welcome.</p></body></html>"
    )


def _article(url: str, title: str, when: dt.datetime) -> str:
    stamp = when.isoformat()
    para = (
        "<p>Town council voted six to one on Tuesday night to extend the river trail by four "
        "kilometres along the north bank, linking the boat launch with the new housing on the "
        "east side of town. The paved path will be three metres wide and lit along its whole "
        "length, and construction starts in the spring.</p>"
    )
    return (
        f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>'
        f'<link rel="canonical" href="{url}">'
        '<meta property="og:type" content="article">'
        f'<meta property="og:title" content="{title}">'
        f'<meta property="article:published_time" content="{stamp}">'
        "</head><body><main><article>"
        f'<h1>{title}</h1><time class="published" datetime="{stamp}">{stamp}</time>'
        f"{para * 4}</article></main></body></html>"
    )


def _news_sitemap(entries: list[tuple[str, dt.datetime]]) -> str:
    body = "".join(
        f"<url><loc>{u}</loc><news:news><news:publication><news:name>Example</news:name>"
        "<news:language>en</news:language></news:publication>"
        f"<news:publication_date>{when.isoformat()}</news:publication_date>"
        f"<news:title>t</news:title></news:news></url>"
        for u, when in entries
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        f'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">{body}</urlset>'
    )


def _xml(body: str) -> tuple[int, str, str]:
    return 200, body, "application/rss+xml"


def _html(body: str, status: int = 200) -> tuple[int, str, str]:
    return status, body, "text/html; charset=utf-8"


class _Site:
    """Routes by full URL. A value is ``(status, body, content type)``,
    an int status, or an async callable taking the request and returning
    one of those. Every request is recorded with its headers."""

    def __init__(self) -> None:
        self.routes: dict[str, object] = {}
        self.requests: list[httpx.Request] = []

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        route = self.routes.get(str(request.url), 404)
        if callable(route):
            route = await route(request)
        if isinstance(route, httpx.Response):
            return route
        if isinstance(route, int):
            return httpx.Response(route, text="", headers={"content-type": "text/html"})
        status, body, content_type = route
        return httpx.Response(status, text=body, headers={"content-type": content_type})

    def asked(self, url: str) -> int:
        return sum(1 for r in self.requests if str(r.url) == url)

    def agents(self, url: str) -> list[str]:
        return [r.headers.get("user-agent", "") for r in self.requests if str(r.url) == url]


@pytest.fixture
def site(monkeypatch, fake_dns):
    fake_dns["www.example.com"] = "93.184.215.14"
    site = _Site()
    real_client = httpx.AsyncClient

    def client(*args, **kwargs):
        # The test's own ASGI client (``app_client``) keeps its transport.
        kwargs.setdefault("transport", httpx.MockTransport(site.handle))
        return real_client(*args, **kwargs)

    # ``article_extract.httpx`` is the httpx module, so this reaches
    # every fetcher the preview uses (rss, article_extract).
    monkeypatch.setattr(article_extract.httpx, "AsyncClient", client)
    monkeypatch.setattr(generic_scrape, "_MAX_AGE_DAYS", 100_000)
    return site


@pytest.fixture(autouse=True)
async def _fresh_preview_state():
    """Each test starts with an empty cache and leaves no pipeline
    running behind it."""
    source_preview.clear_cache()
    yield
    if source_preview._tasks:
        await asyncio.wait(set(source_preview._tasks), timeout=10)
    source_preview.clear_cache()


async def _preview(app_client, **body) -> dict:
    resp = await app_client.post("/api/sources/preview", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- feed mode: counts, kind, duplicate ---------------------------------------


async def test_feed_counts_and_fresh_duplicate_after_an_add(app_client, site, db_session):
    site.routes[FEED] = _xml(_rss(15))

    first = await _preview(app_client, url=FEED)
    assert first["ok"] is True
    assert (first["kind"], first["mode"], first["url"]) == ("rss", "feed", FEED)
    assert first["feed_title"] == "Example Daily"
    assert first["headers_used"] == "default"
    # The first-fetch rule: the newest 10, plus the last 2 days (here
    # inside the 10 already); the other 5 are older.
    assert (first["total_count"], first["will_add_count"], first["older_skipped_count"]) == (15, 10, 5)
    assert first["already_stored_count"] == 0
    assert first["duplicate_of"] is None
    assert [i["accepted"] for i in first["items"]] == [True] * 10 + [False] * 5
    assert {i["reason"] for i in first["items"][10:]} == {"older"}
    assert first["items"][0]["title"] == "Story 0"
    assert site.asked(FEED) == 1

    # Add it, and let its first check store two of its stories.
    created = await app_client.post(
        "/api/sources", json={"name": "example_daily", "type": "rss", "category": "news", "url": FEED}
    )
    assert created.status_code == 200, created.text
    source_id = created.json()["id"]
    db_session.add_all(
        Entry(source_id=source_id, title=f"Story {i}", url=f"{SITE}/s/{i}") for i in (0, 1)
    )
    await db_session.commit()
    asked = site.asked(FEED)

    again = await _preview(app_client, url=FEED)
    # Upstream came from the cache; what is stored was read again.
    assert site.asked(FEED) == asked
    assert again["duplicate_of"] == {"id": source_id, "name": "example_daily", "display_name": None}
    assert again["already_stored_count"] == 2
    # Stored stories still hold their rank among the newest 10.
    assert again["will_add_count"] == 8
    assert [i["reason"] for i in again["items"][:2]] == ["stored", "stored"]


async def test_a_trailing_slash_still_finds_the_duplicate(app_client, site, db_session):
    url = f"{SITE}/podcast/"
    site.routes[url] = _xml(_rss(3))
    db_session.add(Source(name="already", type="rss", category="news", url=f"{SITE}/podcast"))
    await db_session.commit()
    result = await _preview(app_client, url=url)
    assert result["duplicate_of"]["name"] == "already"


@pytest.mark.parametrize("body", [_rss(4, podcast=True), _itunes_feed()], ids=["enclosures", "itunes"])
async def test_a_podcast_feed_is_kind_podcast(app_client, site, body):
    site.routes[FEED] = _xml(body)
    result = await _preview(app_client, url=FEED)
    assert result["ok"] is True
    assert result["kind"] == "podcast"


async def test_a_named_type_is_the_kind(app_client, site):
    site.routes[FEED] = _xml(_rss(4, podcast=True))
    result = await _preview(app_client, url=FEED, type="rss")
    assert result["kind"] == "rss"


async def test_a_page_with_a_feed_link_is_read_once_and_previews_its_feed(app_client, site):
    page = f"{SITE}/blog"
    site.routes[page] = _html(_page_linking("/blog/feed.xml"))
    site.routes[f"{SITE}/blog/feed.xml"] = _xml(_rss(3))
    result = await _preview(app_client, url=page)
    assert result["ok"] is True
    assert (result["kind"], result["url"], result["mode"]) == ("rss", f"{SITE}/blog/feed.xml", "feed")
    # Discovery reused the page step 3 got back.
    assert site.asked(page) == 1


# --- blocked: the browser retry -----------------------------------------------


def _refuses_us(body: tuple[int, str, str]):
    async def route(request: httpx.Request):
        if request.headers.get("user-agent") == rss.BROWSER_HEADERS["User-Agent"]:
            assert request.headers.get("accept-language") == rss.BROWSER_HEADERS["Accept-Language"]
            return body
        return _html("<html><body>Forbidden</body></html>", status=403)

    return route


async def test_a_403_feed_is_retried_as_safari(app_client, site):
    site.routes[FEED] = _refuses_us(_xml(_rss(3)))
    result = await _preview(app_client, url=FEED)
    assert result["ok"] is True
    assert result["headers_used"] == "browser"
    assert result["total_count"] == 3
    assert site.agents(FEED)[1] == rss.BROWSER_HEADERS["User-Agent"]
    assert len(site.agents(FEED)) == 2
    # Values never come back, only which set was used.
    assert rss.BROWSER_HEADERS["User-Agent"] not in str(result)


async def test_a_challenge_page_is_retried_as_safari(app_client, site):
    async def route(request: httpx.Request):
        if request.headers.get("user-agent") == rss.BROWSER_HEADERS["User-Agent"]:
            return _xml(_rss(2))
        return _html("<html><head><title>Just a moment...</title></head><body></body></html>")

    site.routes[FEED] = route
    result = await _preview(app_client, url=FEED)
    assert (result["ok"], result["headers_used"]) == (True, "browser")


async def test_a_403_website_is_retried_as_safari(app_client, site):
    when = _now() - dt.timedelta(hours=3)
    story = f"{SITE}/news/2026/river-trail"
    sitemap = _news_sitemap([(story, when)])
    site.routes[f"{SITE}/sitemap.xml"] = _refuses_us((200, sitemap, "application/xml"))
    site.routes[story] = _refuses_us(_html(_article(story, "River trail", when)))
    # The whole site refuses us: its home page and robots.txt too.
    site.routes[f"{SITE}/"] = _refuses_us(_html("<html><body><p>Welcome.</p></body></html>"))
    site.routes[f"{SITE}/robots.txt"] = _refuses_us((200, "User-agent: *\n", "text/plain"))
    result = await _preview(app_client, url=f"{SITE}/", type="generic_scrape")
    assert result["ok"] is True, result
    assert (result["kind"], result["mode"], result["headers_used"]) == ("generic_scrape", "sitemap", "browser")
    assert result["items"][0]["accepted"] is True
    assert site.agents(story) == [rss.BROWSER_HEADERS["User-Agent"]]


async def test_the_callers_own_user_agent_is_never_swapped(app_client, site):
    site.routes[FEED] = _refuses_us(_xml(_rss(3)))
    result = await _preview(app_client, url=FEED, custom_headers={"User-Agent": "MyReader/1.0"})
    assert (result["ok"], result["error_kind"]) == (False, "blocked")
    assert result["error"] == source_preview.ERRORS["blocked"]
    assert site.agents(FEED) == ["MyReader/1.0"]


# --- one deadline -------------------------------------------------------------


async def test_a_hanging_feed_fetch_still_leaves_time_for_discovery(app_client, site, monkeypatch):
    monkeypatch.setattr(source_preview, "PREVIEW_BUDGET_S", 3.0)
    page = f"{SITE}/blog"
    calls = 0

    async def hangs_first(request: httpx.Request):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(30)
        return _html(_page_linking("/blog/feed.xml"))

    site.routes[page] = hangs_first
    site.routes[f"{SITE}/blog/feed.xml"] = _xml(_rss(3))
    started = time.monotonic()
    result = await _preview(app_client, url=page)
    assert result["ok"] is True, (result, [(str(r.url), r.headers.get("user-agent")[:20]) for r in site.requests])
    assert result["url"] == f"{SITE}/blog/feed.xml"
    assert time.monotonic() - started < 3.0


async def test_running_out_returns_timeout_with_what_is_known(app_client, site, monkeypatch):
    monkeypatch.setattr(source_preview, "PREVIEW_BUDGET_S", 0.6)
    page = f"{SITE}/blog"

    async def hangs(request: httpx.Request):
        await asyncio.sleep(30)
        return _xml(_rss(3))

    site.routes[page] = _html(_page_linking("/blog/feed.xml"))
    site.routes[f"{SITE}/blog/feed.xml"] = hangs
    started = time.monotonic()
    result = await _preview(app_client, url=page, type="rss")
    assert time.monotonic() - started < 1.6
    assert (result["ok"], result["error_kind"]) == (False, "timeout")
    assert result["error"] == source_preview.ERRORS["timeout"]
    # What was known by then: the address and the feed link it found.
    assert result["url"] == page
    assert result["feed_candidates"] == [f"{SITE}/blog/feed.xml"]


# --- two at a time ------------------------------------------------------------


async def test_a_parse_past_the_deadline_keeps_its_slot(app_client, site, monkeypatch):
    monkeypatch.setattr(source_preview, "PREVIEW_BUDGET_S", 0.4)
    gate = threading.Event()
    real_parse = source_preview.parse_feed

    def slow_parse(*args):
        gate.wait(10)
        return real_parse(*args)

    monkeypatch.setattr(source_preview, "parse_feed", slow_parse)
    for n in (1, 2, 3):
        site.routes[f"{SITE}/{n}.xml"] = _xml(_rss(2))

    try:
        first, second = await asyncio.gather(
            _preview(app_client, url=f"{SITE}/1.xml"), _preview(app_client, url=f"{SITE}/2.xml")
        )
        assert first["error_kind"] == second["error_kind"] == "timeout"
        # Both parses are still running, so both slots are taken.
        busy = await _preview(app_client, url=f"{SITE}/3.xml")
        assert (busy["ok"], busy["error_kind"]) == (False, "busy")
        assert busy["error"] == source_preview.ERRORS["busy"]
        assert site.asked(f"{SITE}/3.xml") == 0
    finally:
        gate.set()
    await asyncio.wait(set(source_preview._tasks), timeout=10)
    assert not source_preview._tasks

    monkeypatch.setattr(source_preview, "PREVIEW_BUDGET_S", 10.0)
    third = await _preview(app_client, url=f"{SITE}/3.xml")
    assert third["ok"] is True
    # The parse that outlived its response still filled the cache.
    asked = site.asked(f"{SITE}/1.xml")
    cached = await _preview(app_client, url=f"{SITE}/1.xml")
    assert cached["ok"] is True
    assert site.asked(f"{SITE}/1.xml") == asked


# --- the cache ----------------------------------------------------------------


async def test_other_options_fetch_again(app_client, site):
    url = f"{SITE}/"
    when = _now() - dt.timedelta(hours=3)
    story = f"{SITE}/news/2026/river-trail"
    site.routes[f"{SITE}/sitemap.xml"] = (200, _news_sitemap([(story, when)]), "application/xml")
    site.routes[f"{SITE}/news-sitemap.xml"] = (200, _news_sitemap([(story, when)]), "application/xml")
    site.routes[story] = _html(_article(story, "River trail", when))

    await _preview(app_client, url=url, type="generic_scrape")
    asked = len(site.requests)
    await _preview(app_client, url=url, type="generic_scrape")
    assert len(site.requests) == asked

    for options in (
        {"type": "generic_scrape", "link_pattern": "/news/"},
        {"type": "generic_scrape", "sitemap_url": f"{SITE}/news-sitemap.xml"},
        {"type": None},
    ):
        before = len(site.requests)
        await _preview(app_client, url=url, **options)
        assert len(site.requests) > before, options


async def test_headers_are_part_of_the_key(app_client, site):
    site.routes[FEED] = _xml(_rss(3))

    custom = await _preview(app_client, url=FEED, custom_headers={"X-Preview-Test": SECRET})
    assert custom["headers_used"] == "custom"
    assert SECRET not in str(custom)
    assert site.requests[-1].headers.get("x-preview-test") == SECRET

    # The same headers spelled differently share the entry.
    await _preview(app_client, url=FEED, custom_headers={"x-preview-test": SECRET})
    assert site.asked(FEED) == 1

    # Without them, the result fetched with them is never reused.
    plain = await _preview(app_client, url=FEED)
    assert plain["headers_used"] == "default"
    assert site.asked(FEED) == 2
    assert "x-preview-test" not in site.requests[-1].headers


async def test_a_failed_preview_is_not_cached(app_client, site):
    site.routes[FEED] = 503
    assert (await _preview(app_client, url=FEED))["error_kind"] == "http_error"
    site.routes[FEED] = _xml(_rss(2))
    assert (await _preview(app_client, url=FEED))["ok"] is True


# --- website mode counts ------------------------------------------------------


async def test_website_counts(app_client, site, db_session):
    """Twelve dated sitemap entries: the 8 newest are read (one of them
    turns out not to be an article). The first-fetch rule over the
    rest: the newest 10 plus the last 2 days."""
    stories = []
    for i in range(12):
        when = _now() - dt.timedelta(hours=2 + i * 24)
        stories.append((f"{SITE}/news/2026/story-{i}", when))
    site.routes[f"{SITE}/sitemap.xml"] = (200, _news_sitemap(stories), "application/xml")
    for i, (url, when) in enumerate(stories[:8]):
        site.routes[url] = _html(_article(url, f"Story {i}", when))
    # Story 3 is a page with no text: not a story.
    site.routes[stories[3][0]] = _html("<html><head><title>x</title></head><body></body></html>")

    result = await _preview(app_client, url=f"{SITE}/", type="generic_scrape")
    assert result["ok"] is True, (result, [(str(r.url), r.headers.get("user-agent")[:20]) for r in site.requests])
    assert (result["kind"], result["mode"]) == ("generic_scrape", "sitemap")
    assert result["total_count"] == 12
    # 11 stories left once story 3 is out; the newest 10 are kept, so
    # one is older. A check adds at most 10 pages.
    assert result["older_skipped_count"] == 1
    assert result["will_add_count"] == 10
    assert len(result["items"]) == 8
    by_url = {i["url"]: i for i in result["items"]}
    assert by_url[stories[3][0]]["accepted"] is False
    assert by_url[stories[3][0]]["reason"] == "no_text"
    assert by_url[stories[0][0]]["title"] == "Story 0"
    assert by_url[stories[0][0]]["accepted"] is True

    # A stored story is counted, and leaves the rest fresh.
    src = Source(name="site", type="generic_scrape", category="news", url=f"{SITE}/")
    db_session.add(src)
    await db_session.commit()
    db_session.add(Entry(source_id=src.id, title="Story 0", url=stories[0][0]))
    await db_session.commit()
    again = await _preview(app_client, url=f"{SITE}/", type="generic_scrape")
    assert again["already_stored_count"] == 1
    assert {i["url"]: i for i in again["items"]}[stories[0][0]]["reason"] == "stored"
    assert again["duplicate_of"]["name"] == "site"


async def test_website_undated_pages_count_at_most_two(app_client, site, monkeypatch):
    # No page is read, so all that is known of each is its undated
    # sitemap entry.
    monkeypatch.setattr(source_preview, "EXTRACT_MAX", 0)
    stories = [f"{SITE}/news/story-{i}" for i in range(6)]
    urlset = "".join(f"<url><loc>{u}</loc></url>" for u in stories)
    site.routes[f"{SITE}/sitemap.xml"] = (
        200,
        f'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urlset}</urlset>',
        "application/xml",
    )
    result = await _preview(app_client, url=f"{SITE}/", type="generic_scrape", link_pattern="/news/")
    assert result["ok"] is True, result
    assert result["total_count"] == 6
    # A check keeps at most 2 undated pages.
    assert result["will_add_count"] == 2
    assert result["items"] == []


# --- reddit, errors and the SSRF guard ----------------------------------------


async def test_reddit_off(app_client, site, monkeypatch):
    async def never(*args, **kwargs):
        raise AssertionError("fetch_subreddit must not be called while Reddit is off")

    monkeypatch.setattr(reddit_client, "is_disabled", lambda: True)
    monkeypatch.setattr(reddit_client, "fetch_subreddit", never)
    result = await _preview(app_client, url="https://www.reddit.com/r/python")
    assert (result["ok"], result["kind"], result["error_kind"]) == (False, "reddit", "reddit_off")
    assert result["error"] == source_preview.ERRORS["reddit_off"]


async def test_a_subreddit_previews_its_posts(app_client, site, monkeypatch):
    now = time.time()

    async def listing(sub, listing="hot", limit=50):
        assert (sub, listing, limit) == ("python", "hot", 50)
        return [
            {"title": f"Post {i}", "url": f"{SITE}/p/{i}", "permalink": f"/r/python/{i}", "created_utc": now - i * 60}
            for i in range(3)
        ]

    monkeypatch.setattr(reddit_client, "is_disabled", lambda: False)
    monkeypatch.setattr(reddit_client, "fetch_subreddit", listing)
    result = await _preview(app_client, url="r/python")
    assert (result["ok"], result["kind"], result["url"]) == (True, "reddit", "https://www.reddit.com/r/python")
    assert result["will_add_count"] == 3


async def test_a_private_host_gets_the_test_routes_message(app_client, site, fake_dns):
    url = "https://evil.internal/feed.xml"
    result = await _preview(app_client, url=url)
    assert (result["ok"], result["error_kind"]) == (False, "invalid_url")
    tested = (await app_client.post("/api/sources/test", json={"type": "rss", "url": url})).json()
    assert result["error"] == tested["error"] == "url is not reachable (must be a public host)"
    text = str(result)
    for leak in (fake_dns["evil.internal"], "private", "denied", "10.0."):
        assert leak not in text
    assert site.requests == []


async def test_a_redirect_to_a_private_host_is_refused(app_client, site):
    async def to_private(request: httpx.Request):
        return httpx.Response(302, headers={"location": "http://10.0.0.5/admin"})

    site.routes[FEED] = to_private
    result = await _preview(app_client, url=FEED, type="rss")
    assert (result["ok"], result["error_kind"]) == (False, "invalid_url")
    assert "10.0.0.5" not in str(result)
    # The SSRF hook stopped the hop before it was sent.
    assert [str(r.url) for r in site.requests] == [FEED]


@pytest.mark.parametrize(
    "body,kind",
    [
        ({"url": "ftp://example.com/feed"}, "invalid_url"),
        ({"url": FEED, "custom_headers": {"Cookie": "a=b"}}, "invalid_headers"),
        ({"url": FEED, "link_pattern": "https://example.com/x"}, "invalid_options"),
        ({"url": FEED, "sitemap_url": "https://evil.internal/sitemap.xml"}, "invalid_options"),
    ],
)
async def test_refused_requests(app_client, site, body, kind):
    result = await _preview(app_client, **body)
    assert (result["ok"], result["error_kind"]) == (False, kind)
    assert result["error"] == source_preview.ERRORS[kind]


async def test_not_found_and_not_a_feed(app_client, site):
    assert (await _preview(app_client, url=FEED))["error_kind"] == "not_found"
    site.routes[FEED] = _html("<html><body><p>Hello</p></body></html>")
    assert (await _preview(app_client, url=FEED, type="rss"))["error_kind"] == "not_a_feed"


async def test_unknown_fields_are_refused(app_client, site):
    resp = await app_client.post("/api/sources/preview", json={"url": FEED, "name": "x"})
    assert resp.status_code == 422


async def test_preview_writes_nothing(app_client, site, db_session):
    site.routes[FEED] = _xml(_rss(3))
    await _preview(app_client, url=FEED)
    assert (await db_session.scalars(select(Source))).all() == []
    assert (await db_session.scalars(select(Entry))).all() == []


# --- discover_feed_url(headers=) ----------------------------------------------


@pytest.mark.no_db
async def test_discover_feed_url_sends_the_headers(site):
    page = f"{SITE}/blog"
    site.routes[page] = _html(_page_linking("/blog/feed.xml"))
    site.routes[f"{SITE}/blog/feed.xml"] = _xml(_rss(2))
    found = await feed_autodiscovery.discover_feed_url(page, headers={"X-Preview-Test": SECRET})
    assert found == f"{SITE}/blog/feed.xml"
    assert len(site.requests) >= 3
    assert all(r.headers.get("x-preview-test") == SECRET for r in site.requests)
