"""PR10b: a website feed's failures say what they are.

Every case runs the real fetch path: ``fetch_html_checked``, the URL
safety check and SSRF hook (DNS answered by ``fake_dns``), the sitemap
crawl, ``listing_links`` and ``score_page``. Only the transport is fake:
each request goes to the test's routes through an httpx
``MockTransport``, and an unrouted path answers 404. Nothing touches the
network.

The feed's error kind is read the way the scheduler records it
(``scheduler._classify_error``):

- a site that refuses us (401-403) is ``[blocked]``, also when it
  serves its sitemap but refuses the article pages;
- a 404 on robots.txt or a guessed sitemap path is routine, and the
  crawl moves on; a 404 counts as ``[not found]`` only on the feed's
  own listing page or ``sitemap_url``;
- a refused robots.txt counts only when every sitemap is refused too;
- a timeout is ``[network]``, not ``[no list]``;
- ``[no list]`` only when nothing at all lists articles;
- ``probe`` and ``/auto`` never raise.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app import article_extract, feed_autodiscovery
from app.article_detect import Candidate
from app.article_extract import FetchRefusedError
from app.scheduler import _classify_error
from app.sources import generic_scrape
from app.sources.generic_scrape import GenericScrapePlugin, plan_candidates, probe

pytestmark = [pytest.mark.no_db, pytest.mark.asyncio]

FIXTURES = Path(__file__).parent / "fixtures" / "scrape"
SITE = "https://www.example.com"
SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _urlset(*urls: str) -> str:
    entries = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    )


def _xml(body: str) -> tuple[int, str, str]:
    return 200, body, "application/xml"


def _html(body: str, status: int = 200) -> tuple[int, str, str]:
    return status, body, "text/html; charset=utf-8"


_NO_LIST_PAGE = "<html><head><title>Example</title></head><body><p>Welcome.</p></body></html>"


class _Site:
    """Routes by full URL. A value is ``(status, body, content type)``,
    an int status, an ``httpx.Response``, an httpx exception class
    (raised for the request), or an async callable taking the request
    and returning one of those."""

    def __init__(self) -> None:
        self.routes: dict[str, object] = {}
        self.requests: list[str] = []

    async def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        route = self.routes.get(url, 404)
        if isinstance(route, type) and issubclass(route, Exception):
            raise route("simulated", request=request)
        if callable(route):
            route = await route(request)
        if isinstance(route, httpx.Response):
            return route
        if isinstance(route, int):
            return httpx.Response(route, text="", headers={"content-type": "text/html"})
        status, body, content_type = route
        return httpx.Response(status, text=body, headers={"content-type": content_type})

    def asked(self, path: str) -> int:
        return self.requests.count(SITE + path)


@pytest.fixture
def site(monkeypatch, fake_dns):
    fake_dns["www.example.com"] = "93.184.215.14"
    site = _Site()
    real_client = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(site.handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(article_extract.httpx, "AsyncClient", client)
    # The fixture pages are dated October 2026; keep them in range
    # whenever this runs.
    monkeypatch.setattr(generic_scrape, "_MAX_AGE_DAYS", 100_000)
    return site


def _plugin(url: str, **overrides) -> GenericScrapePlugin:
    row = dict(
        id=1,
        name="example_site",
        type="generic_scrape",
        category="news",
        url=url,
        refresh_interval_seconds=7200,
        sitemap_url=None,
        link_pattern=None,
        custom_headers=None,
    )
    row.update(overrides)
    return GenericScrapePlugin(SimpleNamespace(**row))


async def _kind_of(coro) -> str:
    """Run a fetch that must fail, and return the kind the scheduler
    records for it."""
    with pytest.raises(Exception) as caught:
        await coro
    return _classify_error(caught.value)


# --- the sitemap crawl --------------------------------------------------------


async def test_robots_and_sitemap_404s_still_find_the_wordpress_sitemap(site):
    # robots.txt, /sitemap.xml and /sitemap_index.xml all 404: routine.
    site.routes[f"{SITE}/wp-sitemap.xml"] = _xml(_fixture("wp-sitemap.xml"))
    site.routes[f"{SITE}/wp-sitemap-posts-post-1.xml"] = _xml(
        _urlset(f"{SITE}/2026/10/18/council-approves-river-trail/", f"{SITE}/2026/10/12/harvest-market-returns/")
    )
    plan = await plan_candidates(f"{SITE}/", raise_errors=True)
    assert plan.mode == "sitemap"
    assert [c.url for c in plan.candidates] == [
        f"{SITE}/2026/10/18/council-approves-river-trail/",
        f"{SITE}/2026/10/12/harvest-market-returns/",
    ]
    # The page, taxonomy and user sitemaps beside the posts are never read.
    assert site.asked("/wp-sitemap-posts-page-1.xml") == 0
    assert site.asked("/wp-sitemap-taxonomies-category-1.xml") == 0
    assert site.asked("/wp-sitemap-users-1.xml") == 0


async def test_a_refused_robots_txt_with_a_working_sitemap_still_finds_articles(site):
    site.routes[f"{SITE}/robots.txt"] = 403
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(f"{SITE}/news/council-approves-river-trail/"))
    plan = await plan_candidates(f"{SITE}/", raise_errors=True)
    assert [c.url for c in plan.candidates] == [f"{SITE}/news/council-approves-river-trail/"]


async def test_robots_txt_listed_sitemaps_are_read_in_class_order(site):
    # The Yoast index lists its page sitemap with the newest <lastmod>;
    # only the post sitemaps are read, newest first.
    site.routes[f"{SITE}/robots.txt"] = _html("User-agent: *\nSitemap: " + SITE + "/sitemap_index.xml\n")
    site.routes[f"{SITE}/sitemap_index.xml"] = _xml(_fixture("yoast-sitemap_index.xml"))
    site.routes[f"{SITE}/post-sitemap2.xml"] = _xml(_fixture("yoast-post-sitemap2.xml"))
    site.routes[f"{SITE}/page-sitemap.xml"] = _xml(_fixture("yoast-page-sitemap.xml"))
    plan = await plan_candidates(f"{SITE}/", raise_errors=True)
    assert [c.url for c in plan.candidates] == [
        f"{SITE}/news/council-approves-river-trail/",
        f"{SITE}/news/harvest-market-returns/",
    ]
    assert site.requests.index(f"{SITE}/post-sitemap2.xml") < site.requests.index(f"{SITE}/post-sitemap.xml")
    for skipped in ("page", "category", "post_tag", "author", "attachment", "product", "product_cat"):
        assert site.asked(f"/{skipped}-sitemap.xml") == 0, skipped

    # The feed then brings the post. The second post is gone (404) and
    # the About page in the page sitemap is never fetched at all.
    site.routes[f"{SITE}/news/council-approves-river-trail/"] = _html(_fixture("yoast-post.html"))
    items = await _plugin(f"{SITE}/").fetch()
    assert [i["url"] for i in items] == [f"{SITE}/news/council-approves-river-trail/"]
    assert items[0]["title"].startswith("Council approves the river trail extension")
    assert site.asked("/about-us/") == 0


async def test_all_404s_and_no_listing_is_no_list(site):
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    kind = await _kind_of(_plugin(f"{SITE}/").fetch())
    assert kind == "no list"


async def test_every_sitemap_refused_is_blocked(site):
    # The home page answers but lists nothing; every sitemap is refused.
    for path in ("/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"):
        site.routes[SITE + path] = 403
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "blocked"


async def test_one_refused_sitemap_beside_missing_ones_is_not_blocked(site):
    site.routes[f"{SITE}/sitemap.xml"] = 403
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "no list"


async def test_a_refused_robots_txt_alone_is_not_blocked(site):
    # The guessed sitemaps 404 and the home page has no list: the site
    # answers us, it just has nothing to read.
    site.routes[f"{SITE}/robots.txt"] = 403
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "no list"


async def test_a_sitemap_read_timeout_is_network(site):
    site.routes[f"{SITE}/robots.txt"] = _html(f"Sitemap: {SITE}/sitemap.xml\n")
    site.routes[f"{SITE}/sitemap.xml"] = httpx.ReadTimeout
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "network"


async def test_the_crawl_budget_running_out_is_network(site, monkeypatch):
    async def slow(request):
        await asyncio.sleep(5)
        return _xml(_urlset(f"{SITE}/news/late/"))

    monkeypatch.setattr(feed_autodiscovery, "_TRAFILATURA_BUDGET", 0.2)
    site.routes[f"{SITE}/robots.txt"] = _html(f"Sitemap: {SITE}/sitemap.xml\n")
    site.routes[f"{SITE}/sitemap.xml"] = slow
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "network"


async def test_a_host_that_refuses_connections_is_network(site):
    for path in ("/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/"):
        site.routes[SITE + path] = httpx.ConnectError
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "network"


async def test_a_missing_explicit_sitemap_url_is_not_found(site):
    site.routes[f"{SITE}/"] = _html(_NO_LIST_PAGE)
    plugin = _plugin(f"{SITE}/", sitemap_url=f"{SITE}/news-sitemap.xml")
    assert await _kind_of(plugin.fetch()) == "not found"


# --- the listing page ---------------------------------------------------------


async def test_a_refused_listing_page_is_blocked(site):
    site.routes[f"{SITE}/news/"] = 403
    assert await _kind_of(_plugin(f"{SITE}/news/").fetch()) == "blocked"


async def test_a_missing_listing_page_is_not_found(site):
    assert await _kind_of(_plugin(f"{SITE}/news/").fetch()) == "not found"


async def test_a_rate_limited_listing_page_is_an_http_error(site):
    site.routes[f"{SITE}/news/"] = 429
    assert await _kind_of(_plugin(f"{SITE}/news/").fetch()) == "http error"


async def test_a_missing_listing_page_with_a_working_section_sitemap_still_reads(site):
    # The page 404s, but the section has sitemap entries: the feed works.
    site.routes[f"{SITE}/sitemap.xml"] = _xml(
        _urlset(f"{SITE}/news/council-approves-river-trail/", f"{SITE}/about/")
    )
    site.routes[f"{SITE}/news/council-approves-river-trail/"] = _html(_fixture("yoast-post.html"))
    items = await _plugin(f"{SITE}/news/").fetch()
    assert [i["url"] for i in items] == [f"{SITE}/news/council-approves-river-trail/"]


# --- article pages ------------------------------------------------------------


async def test_refused_article_pages_are_blocked_and_retried_later(site):
    """The sitemap is served, every article page is refused: the feed is
    blocked, and the pages stay unmarked, so the poll after Read as
    Safari reads them."""
    posts = [f"{SITE}/news/council-approves-river-trail/", f"{SITE}/news/harvest-market-returns/"]
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(*posts))

    async def challenge(request):
        if "Safari" in request.headers.get("user-agent", ""):
            return _html(_fixture("yoast-post.html"))
        return 403

    for post in posts:
        site.routes[post] = challenge

    plugin = _plugin(f"{SITE}/")
    assert await _kind_of(plugin.fetch()) == "blocked"
    assert len(plugin._extracted_urls) == 0

    plugin.custom_headers = {"User-Agent": SAFARI}
    items = await plugin.fetch()
    assert {i["url"] for i in items} == set(posts)
    assert set(plugin._extracted_urls) == set(posts)


async def test_a_page_that_refuses_everyone_does_not_block_the_feed(site):
    """A members-only page alone in a poll: the stored story beside it
    loads, so the site serves us. The page is skipped (marked), and the
    poll succeeds with nothing new."""
    stored = f"{SITE}/news/council-approves-river-trail/"
    members = f"{SITE}/news/members-only-briefing/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(members, stored))
    site.routes[stored] = _html(_fixture("yoast-post.html"))
    site.routes[members] = 403

    async def known(urls):
        return {stored} & set(urls)

    plugin = _plugin(f"{SITE}/")
    assert await plugin.fetch(known_urls=known) == []
    assert members in plugin._extracted_urls
    assert site.requests.count(stored) == 1  # the control fetch
    # The next poll doesn't ask for the page again.
    assert await plugin.fetch(known_urls=known) == []
    assert site.requests.count(members) == 1


async def test_a_site_that_refuses_every_page_is_blocked_even_with_stored_stories(site):
    stored = f"{SITE}/news/council-approves-river-trail/"
    new = f"{SITE}/news/harvest-market-returns/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(new, stored))
    site.routes[stored] = 403
    site.routes[new] = 403

    async def known(urls):
        return {stored} & set(urls)

    plugin = _plugin(f"{SITE}/")
    assert await _kind_of(plugin.fetch(known_urls=known)) == "blocked"
    assert new not in plugin._extracted_urls


async def test_a_rate_limited_page_stays_for_later_even_when_the_site_loads(site):
    """A 429 is about this moment, not the page: when the control loads,
    the poll succeeds, but the page stays unmarked for the next poll."""
    stored = f"{SITE}/news/council-approves-river-trail/"
    limited = f"{SITE}/news/harvest-market-returns/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(limited, stored))
    site.routes[stored] = _html(_fixture("yoast-post.html"))
    site.routes[limited] = 429

    async def known(urls):
        return {stored} & set(urls)

    plugin = _plugin(f"{SITE}/")
    assert await plugin.fetch(known_urls=known) == []
    assert limited not in plugin._extracted_urls


async def test_a_page_that_redirects_elsewhere_is_not_an_article(site):
    # The same dated post is accepted at its own address and rejected
    # when its address redirects to the home page (``score_page`` reads
    # the final URL).
    gone = f"{SITE}/news/old-story/"
    kept = f"{SITE}/news/fresh-story/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(kept, gone))

    async def to_home(request):
        return httpx.Response(301, headers={"location": f"{SITE}/"})

    site.routes[gone] = to_home
    site.routes[f"{SITE}/"] = _html(_fixture("dated-website-post.html"))
    site.routes[kept] = _html(_fixture("dated-website-post.html"))
    items = await _plugin(f"{SITE}/").fetch()
    assert [i["url"] for i in items] == [kept]


async def test_a_mixed_poll_keeps_the_refused_page_for_later(site):
    ok = f"{SITE}/news/council-approves-river-trail/"
    refused = f"{SITE}/news/harvest-market-returns/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(ok, refused))
    site.routes[ok] = _html(_fixture("yoast-post.html"))
    site.routes[refused] = 403
    plugin = _plugin(f"{SITE}/")
    items = await plugin.fetch()
    assert [i["url"] for i in items] == [ok]
    assert ok in plugin._extracted_urls
    assert refused not in plugin._extracted_urls


async def test_rate_limited_article_pages_are_an_http_error(site):
    posts = [f"{SITE}/news/council-approves-river-trail/", f"{SITE}/news/harvest-market-returns/"]
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(*posts))
    for post in posts:
        site.routes[post] = 429
    assert await _kind_of(_plugin(f"{SITE}/").fetch()) == "http error"


# --- what gets in -------------------------------------------------------------


async def test_a_listing_page_brings_its_articles_not_its_other_pages(site):
    base = f"{SITE}/blog/"
    site.routes[base] = _html(_fixture("listing.html"))
    council = base + "2026/10/18/council-approves-river-trail/"
    harvest = base + "2026/10/12/harvest-market-returns/"
    site.routes[council] = _html(_fixture("yoast-post.html"))
    # A dead link that answers 200 with a "Page not found" page is
    # fetched and rejected (``score_page``), and not asked for again.
    site.routes[harvest] = _html(_fixture("soft-404.html"))
    plugin = _plugin(base)
    items = await plugin.fetch()
    assert [i["url"] for i in items] == [council]
    assert harvest in plugin._extracted_urls
    # Read page first: the sitemap was never asked.
    assert site.asked("/robots.txt") == 0


async def test_a_link_pattern_accepts_an_undated_page_with_no_article_type(site):
    """The owner's link pattern is the article signal: an ollama-style
    model page declares no article type and no date, and still comes
    in (``score_page(owner_configured=True)``)."""
    page = f"{SITE}/search?o=newest"
    links = "".join(
        f'<li><a href="/library/{m}">{m}</a></li>' for m in ("riverlm3", "riverlm2")
    )
    site.routes[page] = _html(f"<html><body><ul>{links}</ul></body></html>")
    for model in ("riverlm3", "riverlm2"):
        site.routes[f"{SITE}/library/{model}"] = _html(_fixture("ollama-library-model.html"))
    items = await _plugin(page, link_pattern="/library/").fetch()
    assert [i["url"] for i in items] == [f"{SITE}/library/riverlm3", f"{SITE}/library/riverlm2"]
    assert all(i["published_at"] is None for i in items)


async def test_without_a_link_pattern_the_same_page_is_not_an_article(site):
    # Same site read as a sitemap feed: no owner signal, so the model
    # page (no article type, no date) is rejected.
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(f"{SITE}/library/riverlm3"))
    site.routes[f"{SITE}/library/riverlm3"] = _html(_fixture("ollama-library-model.html"))
    plugin = _plugin(f"{SITE}/")
    assert await plugin.fetch() == []
    assert f"{SITE}/library/riverlm3" in plugin._extracted_urls


# --- callers that never raise -------------------------------------------------


async def test_probe_and_auto_discovery_never_raise(site):
    for path in ("/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/", "/news/"):
        site.routes[SITE + path] = 403
    assert await probe(f"{SITE}/") == []
    assert await probe(f"{SITE}/news/") == []
    assert await feed_autodiscovery.discover_sitemap_urls(f"{SITE}/") == []


async def test_probe_skips_refused_pages(site):
    ok = f"{SITE}/news/council-approves-river-trail/"
    site.routes[f"{SITE}/sitemap.xml"] = _xml(_urlset(f"{SITE}/news/harvest-market-returns/", ok))
    site.routes[f"{SITE}/news/harvest-market-returns/"] = 403
    site.routes[ok] = _html(_fixture("yoast-post.html"))
    items = await probe(f"{SITE}/")
    assert [i["url"] for i in items] == [ok]


async def test_fetch_html_checked_refusal_is_an_http_status_error(site):
    site.routes[f"{SITE}/x"] = 402
    with pytest.raises(FetchRefusedError) as caught:
        await article_extract.fetch_html_checked(f"{SITE}/x")
    assert isinstance(caught.value, httpx.HTTPStatusError)
    assert caught.value.response.status_code == 402
    # fetch_html itself still returns None for the same answer.
    assert await article_extract.fetch_html(f"{SITE}/x") is None
    # Other statuses read as an empty document unless asked for.
    site.routes[f"{SITE}/y"] = 503
    assert await article_extract.fetch_html_checked(f"{SITE}/y") is None
    with pytest.raises(httpx.HTTPStatusError) as caught:
        await article_extract.fetch_html_checked(f"{SITE}/y", raise_for_status=True)
    assert _classify_error(caught.value) == "upstream error"


async def test_a_redirect_reports_the_final_url(site):
    async def moved(request):
        return httpx.Response(301, headers={"location": f"{SITE}/new-home/"})

    site.routes[f"{SITE}/old/"] = moved
    site.routes[f"{SITE}/new-home/"] = _html("<html><body>home</body></html>")
    body, final_url = await article_extract.fetch_html_checked(f"{SITE}/old/", return_final_url=True)
    assert final_url == f"{SITE}/new-home/"
    assert "home" in body


async def test_candidates_carry_news_sitemap_titles_and_dates(site):
    site.routes[f"{SITE}/news-sitemap.xml"] = _xml(_fixture("news-sitemap.xml"))
    plan = await plan_candidates(f"{SITE}/", sitemap_url=f"{SITE}/news-sitemap.xml", raise_errors=True)
    assert plan.candidates and all(isinstance(c, Candidate) for c in plan.candidates)
    assert all(c.title and c.published for c in plan.candidates)
