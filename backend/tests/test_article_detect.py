"""``app.article_detect``: which URLs, sitemaps and pages are articles.

Pure library, no wiring yet (PR10b calls it from the generic_scrape
crawl). The fixtures in ``tests/fixtures/scrape/`` are hand-written
from public CMS layouts: WordPress core, Yoast SEO, Shopify, Google
News sitemaps, a WordPress listing page, and the page shapes that
produce junk stories today (About pages, a home-page redirect, a soft
404).
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest
from lxml import etree

from app.article_detect import (
    ACCEPT_SCORE,
    Candidate,
    classify_sitemap,
    listing_links,
    order_sitemaps,
    score_page,
    url_ok,
)

pytestmark = pytest.mark.no_db

FIXTURES = Path(__file__).parent / "fixtures" / "scrape"
SITE = "https://www.example.com/"


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _locs(name: str) -> list[tuple[str, str | None]]:
    """(loc, lastmod) of every entry in a sitemap fixture."""
    root = etree.fromstring((FIXTURES / name).read_bytes())
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    out = []
    for entry in root:
        if not isinstance(entry.tag, str):
            continue
        loc = entry.findtext("sm:loc", namespaces=ns)
        out.append((loc.strip(), entry.findtext("sm:lastmod", namespaces=ns)))
    return out


def _accepted(html: str, url: str, **kwargs) -> bool:
    score, _ = score_page(html, url, **kwargs)
    return score >= ACCEPT_SCORE


# ---------------------------------------------------------------------------
# url_ok
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        # Slugs that hold a structural word as part of a segment.
        # courlan's own structure filter rejects all three.
        "https://www.example.com/pets/fat-cat/how-to-feed",
        "https://www.example.com/news/power-user/tips",
        "https://www.example.com/search/best-laptops-2026",
        # Everyday article shapes.
        "https://www.example.com/2026/10/18/council-approves-river-trail/",
        "https://www.example.com/news/987654",
        "https://www.example.com/blogs/news/autumn-restock",
        "https://news.example.com/local/bridge-reopens",
        # A query string courlan's strict mode would strip still passes,
        # and the URL is never rewritten.
        "https://www.example.com/article.php?id=42&ref=home",
    ],
)
def test_url_ok_keeps_articles(url):
    assert url_ok(url, SITE)


def test_url_ok_keeps_a_loopback_host_that_is_the_sources_own():
    # courlan rejects an IP or localhost with a port; every loopback
    # test server has one.
    assert url_ok("http://127.0.0.1:8765/news/first-post", "http://127.0.0.1:8765/news/")
    assert url_ok("http://localhost:8080/blog/hello", "http://localhost:8080")
    # A different loopback host is another site.
    assert not url_ok("http://127.0.0.2:8765/news/first-post", "http://127.0.0.1:8765/")


@pytest.mark.parametrize(
    "url",
    [
        "https://www.example.com/",
        "https://www.example.com/tag/python/",
        "https://www.example.com/category/news/local/",
        "https://www.example.com/author/dana/",
        "https://www.example.com/blog/page/2/",
        "https://www.example.com/about/",
        "https://www.example.com/about/team",
        "https://www.example.com/contact-us",
        "https://www.example.com/pages/our-story",
        "https://www.example.com/products/canvas-tote",
        "https://www.example.com/search",
        "https://www.example.com/blog/?s=trail",
        "https://www.example.com/news/council-approves-river-trail/?replytocom=12",
        "https://www.example.com/2026/10/",
        "https://www.example.com/feed/",
        "https://www.example.com/wp-content/uploads/2026/10/trail.jpg",
        "https://www.example.com/files/annual-report.pdf",
        "https://www.example.com/kontakt",
        "https://www.other-site.com/news/a-story",
        "mailto:news@example.com",
    ],
)
def test_url_ok_rejects_pages_that_are_not_articles(url):
    assert not url_ok(url, SITE)


# ---------------------------------------------------------------------------
# Sitemaps
# ---------------------------------------------------------------------------


def test_wordpress_core_sitemaps_classify_on_the_subtype_token():
    classes = {loc.rsplit("/", 1)[-1]: classify_sitemap(loc) for loc, _ in _locs("wp-sitemap.xml")}
    assert classes == {
        "wp-sitemap-posts-post-1.xml": "post",
        # Holds "posts", but the subtype token is "page".
        "wp-sitemap-posts-page-1.xml": "page",
        "wp-sitemap-taxonomies-category-1.xml": "taxonomy",
        "wp-sitemap-taxonomies-post_tag-1.xml": "taxonomy",
        "wp-sitemap-users-1.xml": "author",
    }
    assert order_sitemaps(loc for loc, _ in _locs("wp-sitemap.xml")) == [
        "https://www.example.com/wp-sitemap-posts-post-1.xml",
    ]


def test_yoast_sitemaps_classify_and_the_page_sitemap_is_skipped():
    locs = [loc for loc, _ in _locs("yoast-sitemap_index.xml")]
    classes = {loc.rsplit("/", 1)[-1]: classify_sitemap(loc) for loc in locs}
    assert classes == {
        "post-sitemap.xml": "post",
        "post-sitemap2.xml": "post",
        "page-sitemap.xml": "page",
        "category-sitemap.xml": "taxonomy",
        "post_tag-sitemap.xml": "taxonomy",
        "author-sitemap.xml": "author",
        "attachment-sitemap.xml": "media",
        "product-sitemap.xml": "product",
        "product_cat-sitemap.xml": "taxonomy",
    }
    assert order_sitemaps(locs) == [
        "https://www.example.com/post-sitemap.xml",
        "https://www.example.com/post-sitemap2.xml",
    ]


def test_recently_edited_about_page_is_excluded_when_a_post_sitemap_exists():
    index = dict(_locs("yoast-sitemap_index.xml"))
    page_sitemap = "https://www.example.com/page-sitemap.xml"
    # The page sitemap is the newest thing on the site, and its newest
    # entry is the About page, newer than any post.
    assert max(index.values()) == index[page_sitemap]
    pages = sorted(_locs("yoast-page-sitemap.xml"), key=lambda e: e[1], reverse=True)
    newest_post = max(lastmod for _, lastmod in _locs("yoast-post-sitemap2.xml"))
    assert "https://www.example.com/about-us/" in [loc for loc, m in pages if m > newest_post]

    assert page_sitemap not in order_sitemaps(index)


def test_a_lone_page_sitemap_is_kept_and_its_entries_still_filtered():
    page_sitemap = "https://www.example.com/wp-sitemap-posts-page-1.xml"
    assert order_sitemaps([page_sitemap, "https://www.example.com/wp-sitemap-users-1.xml"]) == [
        page_sitemap,
    ]
    kept = [loc for loc, _ in _locs("wp-sitemap-posts-page-1.xml") if url_ok(loc, SITE)]
    assert kept == ["https://www.example.com/our-history/"]
    # And a page that gets past url_ok is still scored as a page.
    assert not _accepted(_fixture("yoast-about.html"), "https://www.example.com/our-history/")


def test_shopify_sitemaps_keep_only_the_blogs():
    locs = [loc for loc, _ in _locs("shopify-sitemap.xml")]
    assert [classify_sitemap(loc) for loc in locs] == ["product", "page", "taxonomy", "post"]
    assert order_sitemaps(locs) == ["https://shop.example.com/sitemap_blogs_1.xml"]


def test_news_sitemap_reads_first():
    locs = [loc for loc, _ in _locs("news-sitemap_index.xml")]
    assert order_sitemaps(locs) == [
        "https://www.example.com/news-sitemap.xml",
        "https://www.example.com/sitemaps/sitemap-posts-2026-10.xml",
        "https://www.example.com/sitemap-1.xml",
    ]
    # Its entries are articles.
    assert all(url_ok(loc, SITE) for loc, _ in _locs("news-sitemap.xml"))


@pytest.mark.parametrize(
    ("url", "cls"),
    [
        ("https://www.example.com/sitemap.xml", "other"),
        ("https://www.example.com/sitemap_index.xml", "other"),
        # Drupal pages a big sitemap with ?page=; that isn't a page sitemap.
        ("https://www.example.com/sitemap.xml?page=2", "other"),
        ("https://www.example.com/newssitemap.xml", "news"),
        ("https://www.example.com/sitemap-news.xml.gz", "news"),
        ("https://www.example.com/blog/sitemap.xml", "post"),
        # Whole words only: "heritage" holds no "tag".
        ("https://www.example.com/heritage-sitemap.xml", "other"),
    ],
)
def test_classify_sitemap_edge_cases(url, cls):
    assert classify_sitemap(url) == cls


# ---------------------------------------------------------------------------
# score_page
# ---------------------------------------------------------------------------


def test_yoast_post_is_an_article():
    score, reasons = score_page(
        _fixture("yoast-post.html"), "https://www.example.com/news/council-approves-river-trail/"
    )
    assert score >= ACCEPT_SCORE
    assert "+3 json-ld article" in reasons


def test_dated_og_website_post_is_accepted():
    # Many builders tag every page og:type=website; the date saves it.
    score, reasons = score_page(
        _fixture("dated-website-post.html"), "https://www.example.com/blog/spring-planting-guide"
    )
    assert score >= ACCEPT_SCORE, reasons
    assert "+1 dated 2026-10-14" in reasons
    assert not any("website" in r for r in reasons)


def test_about_page_is_rejected():
    score, reasons = score_page(_fixture("about.html"), "https://www.example.com/about")
    assert score < ACCEPT_SCORE
    assert "-3 og:type website, undated" in reasons


def test_yoast_about_page_with_og_article_is_rejected():
    score, reasons = score_page(_fixture("yoast-about.html"), "https://www.example.com/about-us/")
    assert score < ACCEPT_SCORE
    # og:type=article earns nothing next to JSON-LD AboutPage, and the
    # WebPage node's datePublished is not an article date.
    assert not any(r.startswith("+3") for r in reasons)
    assert "-1 no date" in reasons


def test_home_page_redirect_is_rejected():
    score, reasons = score_page(
        _fixture("home.html"),
        "https://www.example.com/2026/05/04/old-post/",
        final_url="https://www.example.com/",
    )
    assert score < ACCEPT_SCORE
    assert "-3 redirected to /" in reasons
    assert "-3 title is the site name" in reasons


def test_redirect_to_the_same_path_is_not_a_redirect():
    url = "http://www.example.com/news/council-approves-river-trail"
    _, reasons = score_page(
        _fixture("yoast-post.html"),
        url,
        final_url="https://www.example.com/news/council-approves-river-trail/",
    )
    assert not any("redirected" in r for r in reasons)


def test_soft_404_is_rejected():
    score, reasons = score_page(_fixture("soft-404.html"), "https://www.example.com/news/gone/")
    assert score < ACCEPT_SCORE
    assert "-3 soft 404 title" in reasons


def test_foreign_canonical_counts_against_a_page():
    _, reasons = score_page(
        _fixture("foreign-canonical.html"), "https://www.example.com/news/wildfire-order/"
    )
    assert "-2 canonical on www.wire.example.org" in reasons
    # A canonical on another host of the same site is not foreign.
    _, reasons = score_page(
        _fixture("yoast-post.html"), "https://example.com/news/council-approves-river-trail/"
    )
    assert not any("canonical" in r for r in reasons)


def test_undated_library_page_is_accepted_under_a_link_pattern():
    html = _fixture("ollama-library-model.html")
    url = "https://models.example.com/library/riverlm3"
    # No article type, no date: on its own it is not an article...
    assert not _accepted(html, url)
    # ...but the owner's link pattern is the article signal.
    score, reasons = score_page(html, url, owner_configured=True)
    assert score >= ACCEPT_SCORE, reasons


@pytest.mark.parametrize(
    ("fixture", "url", "final_url", "reason"),
    [
        ("soft-404.html", "https://www.example.com/library/gone", None, "-3 soft 404 title"),
        ("home.html", "https://www.example.com/library/old", "https://www.example.com/",
         "-3 redirected to /"),
        ("foreign-canonical.html", "https://www.example.com/library/copy", None,
         "-2 canonical on www.wire.example.org"),
    ],
)
def test_owner_configured_keeps_the_hard_rejects(fixture, url, final_url, reason):
    score, reasons = score_page(_fixture(fixture), url, final_url=final_url, owner_configured=True)
    assert score < ACCEPT_SCORE
    assert reason in reasons


def test_owner_configured_rejects_a_page_under_300_characters():
    html = _fixture("ollama-library-model.html")
    url = "https://models.example.com/library/riverlm3"
    score, reasons = score_page(html, url, text="A compact open model.", owner_configured=True)
    assert score < ACCEPT_SCORE
    assert "-2 only 21 characters" in reasons
    # Kind and date scoring are skipped entirely.
    assert not any("date" in r or "og:type" in r for r in reasons)


def test_text_passed_in_is_used_instead_of_extracting():
    html = _fixture("yoast-post.html")
    url = "https://www.example.com/news/council-approves-river-trail/"
    _, reasons = score_page(html, url, text="x" * 650)
    assert "+1 650 characters" in reasons


def test_empty_page_scores_below_acceptance():
    score, _ = score_page("", "https://www.example.com/news/x")
    assert score < ACCEPT_SCORE


# ---------------------------------------------------------------------------
# listing_links
# ---------------------------------------------------------------------------


def test_listing_links_takes_the_repeating_post_list():
    links = listing_links(_fixture("listing.html"), "https://www.example.com/blog/")
    base = "https://www.example.com/blog/"
    assert links == [
        Candidate(
            base + "2026/10/18/council-approves-river-trail/",
            dt.datetime(2026, 10, 18, 16, 30, 11, tzinfo=dt.timezone.utc),
            "Council approves the river trail extension",
        ),
        Candidate(
            base + "2026/10/12/harvest-market-returns/",
            dt.datetime(2026, 10, 12, 21, 2, 45, tzinfo=dt.timezone.utc),
            "The harvest market returns to the square",
        ),
        # No <time> in this card.
        Candidate(base + "2026/09/30/new-bus-routes/", None, "Three new bus routes start Monday"),
        Candidate(
            base + "2026/09/22/school-garden-wins-grant/",
            dt.datetime(2026, 9, 22, tzinfo=dt.timezone.utc),
            "School garden wins a provincial grant",
        ),
        Candidate(
            base + "2026/09/15/rowing-club-hosts-regatta/",
            dt.datetime(2026, 9, 15, 8, tzinfo=dt.timezone.utc),
            "Rowing club hosts its first regatta",
        ),
    ]


def test_listing_links_resolves_against_base():
    # The fixture's hrefs are relative to <base href=".../blog/">. Read
    # as if it sat elsewhere on the site, they still land under /blog/.
    links = listing_links(_fixture("listing.html"), "https://www.example.com/news/archive-copy")
    assert links and all(c.url.startswith("https://www.example.com/blog/2026/") for c in links)


def test_listing_links_drops_chrome_and_foreign_links():
    urls = {c.url for c in listing_links(_fixture("listing.html"), "https://www.example.com/blog/")}
    assert not any("popular" in u or "footer" in u or "menu-link" in u for u in urls)
    assert not any("partner" in u for u in urls)


def test_listing_links_needs_three_distinct_links():
    html = """<html><body><main>
      <article><h2><a href="/news/one">One</a></h2></article>
      <article><h2><a href="/news/two">Two</a></h2></article>
      <article><h2><a href="/news/two#comments">Two again</a></h2></article>
    </main></body></html>"""
    assert listing_links(html, "https://www.example.com/news/") == []


def test_listing_links_prefers_title_links_over_image_links_to_the_same_posts():
    # The thumbnail link comes first in each card and repeats as often
    # as the title link; the longer text decides the tie.
    cards = "".join(
        f'<li><a class="thumb" href="/news/{slug}"><img src="/i/{slug}.jpg" alt=""></a>'
        f'<h3><a href="/news/{slug}">{title}</a></h3></li>'
        for slug, title in [("alpha", "Alpha story"), ("beta", "Beta story"), ("gamma", "Gamma story")]
    )
    html = f"<html><body><main><ul>{cards}</ul></main></body></html>"
    assert [c.title for c in listing_links(html, "https://www.example.com/news/")] == [
        "Alpha story", "Beta story", "Gamma story",
    ]


def test_listing_links_keeps_post_card_headers_without_main():
    # Cards in plain divs with their own <header>: only the page-level
    # header (outside every sectioning element) is chrome.
    html = """<html><body>
      <header><a href="/news/menu-one">M1</a><a href="/news/menu-two">M2</a>
        <a href="/news/menu-three">M3</a><a href="/news/menu-four">M4</a></header>
      <div class="posts">
        <section class="post"><header><h2><a href="/news/alpha">Alpha story</a></h2></header></section>
        <section class="post"><header><h2><a href="/news/beta">Beta story</a></h2></header></section>
        <section class="post"><header><h2><a href="/news/gamma">Gamma story</a></h2></header></section>
      </div>
    </body></html>"""
    assert [c.url for c in listing_links(html, "https://www.example.com/news/")] == [
        "https://www.example.com/news/alpha",
        "https://www.example.com/news/beta",
        "https://www.example.com/news/gamma",
    ]
