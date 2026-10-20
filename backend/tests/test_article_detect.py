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
import re
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


STORY_URL = "https://www.example.com/news/council-approves-river-trail"


def _page(
    *,
    title: str = "Council approves the river trail | Example Town News",
    site_name: str = "Example Town News",
    og_type: str | None = "article",
    published: str | None = "2026-10-18T09:30:00+00:00",
    jsonld: str | None = None,
    body: str = "<p>The extension adds four kilometres of path.</p>",
) -> str:
    """A small inline page. Pass ``text=`` to ``score_page`` to set its
    length, so each test controls exactly which rules fire."""
    head = [f"<title>{title}</title>", f'<meta property="og:site_name" content="{site_name}">']
    if og_type:
        head.append(f'<meta property="og:type" content="{og_type}">')
    if published:
        head.append(f'<meta property="article:published_time" content="{published}">')
    if jsonld:
        head.append(f'<script type="application/ld+json">{jsonld}</script>')
    return f"<html><head>{''.join(head)}</head><body>{body}</body></html>"


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
        # WordPress Plain and Numeric permalinks.
        "https://www.example.com/?p=123",
        "https://www.example.com/index.php?p=123",
        "https://www.example.com/archives/123",
        # An article under an archive section (The Atlantic's shape).
        "https://www.example.com/technology/archive/2024/01/ai-chatbots/677123/",
        "https://www.example.com/magazine/archive/2023/10/some-story/675123/",
        # News sections named like static pages or records (Reuters'
        # /legal/), with an article under them.
        "https://www.example.com/legal/government/judge-blocks-rule-2026-07-27/",
        "https://www.example.com/help/how-to-reset-a-router",
        "https://www.example.com/blog/products/new-launch",
        "https://www.example.com/news/profiles/mayor-retires",
        # Year-shaped numeric ids (Drupal's /node/<id>).
        "https://www.example.com/node/2015",
        "https://www.example.com/p/2041",
        # "page" is pagination only when a number follows it.
        "https://www.example.com/page/how-we-report",
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
        "https://www.example.com/page/2/",
        "https://www.example.com/archive/",
        "https://www.example.com/archives/",
        "https://www.example.com/archives/2026/07/",
        "https://www.example.com/users/dana",
        "https://www.example.com/forum/users",
        "https://www.example.com/?page_id=2",
        "https://www.example.com/?s=x",
        "https://www.example.com/index.php?page_id=2",
        "https://www.example.com/help",
        "https://www.example.com/legal/",
        "https://www.example.com/2026/",
        "https://www.example.com/2026/07/",
        "https://www.example.com/blog/2026/",
        # Without the slash courlan accepts a year, so the rule is ours.
        "https://www.example.com/2026",
        "https://www.example.com/blog/2026",
        "https://www.example.com/archives/2015",
        "https://www.example.com/blog/2026/07/",
        "https://www.example.com/news/2026/10/18/",
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


def test_a_page_sitemap_reads_after_an_unknown_sitemap():
    # No post sitemap, so the page sitemap stays, but as the last
    # fallback: an unknown sitemap may hold the posts.
    assert order_sitemaps([
        "https://www.example.com/wp-sitemap-posts-page-1.xml",
        "https://www.example.com/sitemap-1.xml",
        "https://www.example.com/wp-sitemap-users-1.xml",
    ]) == [
        "https://www.example.com/sitemap-1.xml",
        "https://www.example.com/wp-sitemap-posts-page-1.xml",
    ]


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
        # WordPress core under Plain permalinks: the class is in the query.
        ("https://www.example.com/?sitemap=posts&sitemap-subtype=page", "page"),
        ("https://www.example.com/?sitemap=posts&sitemap-subtype=post&paged=2", "post"),
        ("https://www.example.com/?sitemap=taxonomies&sitemap-subtype=category", "taxonomy"),
        ("https://www.example.com/?sitemap=users", "author"),
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
    assert "-3 json-ld aboutpage/website, undated" in reasons


def test_og_article_post_without_json_ld_is_accepted():
    # Undated, so og:type=article is what carries it: 3 - 1 + 1.
    score, reasons = score_page(
        _fixture("og-article-post.html"), "https://www.example.com/posts/squeaky-bike-chain/"
    )
    assert "+3 og:type article" in reasons
    assert "-1 no date" in reasons
    assert score >= ACCEPT_SCORE, reasons


def test_undated_og_article_with_a_site_wide_json_ld_website_is_rejected():
    # The spec's -3 for a JSON-LD WebSite applies even next to
    # og:type=article when the page is undated: 3 - 3 - 1 + 1 = 0. This
    # is the false negative left open for PR10b's review and the owner's
    # VPS probe (docs/ux-notes/PR10a.md, "Open items"). Changing it is a
    # spec change, so this test pins today's rule on purpose.
    html = _page(
        published=None,
        jsonld='{"@context":"https://schema.org","@type":"WebSite","name":"Example Town News"}',
    )
    score, reasons = score_page(html, STORY_URL, text="x" * 650)
    assert reasons == [
        "+3 og:type article", "-3 json-ld website, undated", "-1 no date", "+1 650 characters",
    ]
    assert score == 0


def test_prefixed_json_ld_types_count():
    for prefix in ("https://schema.org/", "http://schema.org/", "schema:"):
        html = _page(
            og_type=None,
            published=None,
            jsonld=(
                '{"@context":"https://schema.org","@type":"' + prefix + 'NewsArticle",'
                '"datePublished":"2026-07-27"}'
            ),
        )
        score, reasons = score_page(html, STORY_URL, text="x" * 450)
        assert reasons == ["+3 json-ld newsarticle", "+1 dated 2026-07-27"], prefix
        assert score >= ACCEPT_SCORE


def test_long_listing_with_dated_cards_is_rejected():
    # Six cards, each with a time.entry-date.published and a full
    # excerpt: the first card's date is not the listing's.
    html = _fixture("listing-long.html")
    score, reasons = score_page(html, "https://www.example.com/blog/")
    assert any(r.startswith("+1") and r.endswith("characters") for r in reasons)
    assert "-3 og:type website, undated" in reasons
    assert score < ACCEPT_SCORE
    # The same cards as divs, with no <article> and no <h1>: their dates
    # disagree, so none is the page's.
    divs = (
        html.replace("<article", "<div").replace("</article>", "</div>")
        .replace('<header class="page-header"><h1 class="page-title">Blog</h1></header>', "")
    )
    score, reasons = score_page(divs, "https://www.example.com/blog/")
    assert "-1 no date" in reasons
    assert score < ACCEPT_SCORE
    # Cards all from one day still make a listing: more than one
    # <article>, and no <h1> to say which is the page's.
    no_h1 = html.replace('<header class="page-header"><h1 class="page-title">Blog</h1></header>', "")
    same_day = re.sub(r'datetime="[^"]+"', 'datetime="2026-10-18T09:30:11-07:00"', no_h1)
    _, reasons = score_page(same_day, "https://www.example.com/blog/")
    assert "-1 no date" in reasons
    # A theme that titles every card with an <h1>.
    h1_cards = no_h1.replace('<h2 class="entry-title">', '<h1 class="entry-title">').replace(
        "</a></h2>", "</a></h1>"
    )
    _, reasons = score_page(h1_cards, "https://www.example.com/blog/")
    assert "-1 no date" in reasons


def test_a_post_with_related_cards_keeps_its_own_date():
    # The post's <h1> and date sit in its <article>; the related posts
    # below are <article>s with dates of their own.
    related = "".join(
        f'<article class="related"><h3><a href="/news/older-{n}">Older {n}</a></h3>'
        f'<time class="entry-date published" datetime="2026-09-0{n}">Sep {n}</time></article>'
        for n in range(1, 4)
    )
    html = _page(og_type="website", published=None, body=(
        '<main><article class="post"><header><h1>Council approves the trail</h1>'
        '<time class="entry-date published" datetime="2026-10-14">Oct 14</time></header>'
        f'<p>Story.</p></article><section class="related-posts">{related}</section></main>'
    ))
    score, reasons = score_page(html, STORY_URL, text="x" * 650)
    assert "+1 dated 2026-10-14" in reasons
    assert score >= ACCEPT_SCORE


def test_listing_microdata_dates_are_not_the_pages():
    cards = "".join(
        f'<div itemscope itemtype="https://schema.org/BlogPosting">'
        f'<h2 itemprop="headline"><a href="/blog/post-{n}">Post {n}</a></h2>'
        f'<meta itemprop="datePublished" content="2026-10-{10 + n}"></div>'
        for n in range(4)
    )
    html = _page(og_type="website", published=None, body=f"<main>{cards}</main>")
    _, reasons = score_page(html, "https://www.example.com/blog/", text="x" * 650)
    assert "-1 no date" in reasons
    # One microdata date on a one-article page is the page's.
    single = _page(og_type="website", published=None, body=(
        '<div itemscope itemtype="https://schema.org/BlogPosting"><h1>Post</h1>'
        '<meta itemprop="datePublished" content="2026-10-11"></div>'
    ))
    _, reasons = score_page(single, STORY_URL, text="x" * 650)
    assert "+1 dated 2026-10-11" in reasons


def test_a_date_in_the_url_counts_as_dated():
    html = _page(og_type="website", published=None)
    score, reasons = score_page(
        html, "https://www.example.com/2026/10/18/council-approves-river-trail", text="x" * 650
    )
    assert "+1 date in URL" in reasons
    assert not any("website" in r for r in reasons)
    assert score >= ACCEPT_SCORE, reasons


@pytest.mark.parametrize(
    ("body", "dated"),
    [
        # A class-less <time> in the article's header is its date.
        (('<article><header><h1>Council approves the trail</h1>'
          '<time datetime="2026-10-14">Oct 14</time></header><p>Story.</p></article>'), True),
        # In the article's footer it is not ("updated", comment times).
        (('<article><header><h1>Council approves the trail</h1></header><p>Story.</p>'
          '<footer><time datetime="2026-10-14">Oct 14</time></footer></article>'), False),
        # Nor outside the article.
        (('<article><header><h1>Council approves the trail</h1></header><p>Story.</p></article>'
          '<div class="sidebar"><time datetime="2026-10-14">Oct 14</time></div>'), False),
    ],
)
def test_a_class_less_time_counts_only_in_the_articles_header(body, dated):
    html = _page(og_type="website", published=None, body=body)
    _, reasons = score_page(html, STORY_URL, text="x" * 650)
    assert ("+1 dated 2026-10-14" in reasons) is dated
    assert ("-1 no date" in reasons) is not dated


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


# 450 characters: neither +1 nor -2 for length, so a dated og:type=article
# page scores 4 and only the title can reject it. (At 600+ a fully
# marked-up page scores 5, and the -3 alone leaves it at 2.)
_MID_TEXT = "x" * 450


@pytest.mark.parametrize("owner_configured", [False, True])
@pytest.mark.parametrize(
    "title",
    [
        "404",
        "404 – Example Town News",
        "Error 404 | Example Town News",
        "Example Town News | 404",
        "404 Not Found",
        "404: Page not found",
        "404 Error",
    ],
)
def test_a_404_title_is_a_soft_404(title, owner_configured):
    html = _page(title=title)
    assert _accepted(_page(), STORY_URL, text=_MID_TEXT, owner_configured=owner_configured)
    score, reasons = score_page(html, STORY_URL, text=_MID_TEXT, owner_configured=owner_configured)
    assert "-3 soft 404 title" in reasons
    assert score < ACCEPT_SCORE


@pytest.mark.parametrize("owner_configured", [False, True])
@pytest.mark.parametrize(
    ("title", "site_name", "jsonld"),
    [
        ("404 errors: how to fix them | Town News", "Town News", None),
        ("Error 404 explained | Town News", "Town News", None),
        # A site whose own name reads as a not-found title.
        ("Our autumn issue | Not Found", "Not Found", None),
        ("FBI story | 404 Media", "404 Media",
         ('{"@context":"https://schema.org","@type":"NewsArticle",'
          '"datePublished":"2026-07-27T12:00:00Z"}')),
    ],
)
def test_a_title_that_only_mentions_404_is_not_a_soft_404(title, site_name, jsonld, owner_configured):
    html = _page(title=title, site_name=site_name, jsonld=jsonld)
    score, reasons = score_page(html, STORY_URL, text=_MID_TEXT, owner_configured=owner_configured)
    assert not any("404" in r for r in reasons)
    assert score >= ACCEPT_SCORE, reasons


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


@pytest.mark.parametrize(
    ("length", "accepted"),
    [(150, False), (299, False), (300, True), (450, True)],
)
def test_a_short_page_loses_two_points(length, accepted):
    # An undated JSON-LD Article: 3 - 1 = 2 before the length rule.
    html = _page(
        og_type=None,
        published=None,
        jsonld='{"@context":"https://schema.org","@type":"Article","headline":"Trail"}',
    )
    score, reasons = score_page(html, STORY_URL, text="x" * length)
    assert (f"-2 only {length} characters" in reasons) is not accepted
    assert (score >= ACCEPT_SCORE) is accepted, reasons


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


@pytest.mark.parametrize("role_main", [True, False])
def test_listing_links_keeps_div_card_headers(role_main):
    # Div cards with their own <header><h2><a> and <time>, under a div
    # with role="main" (an ARIA scope), or under no scope at all (their
    # headers repeat card by card, unlike the page's one header).
    html = _fixture("div-cards-listing.html")
    if not role_main:
        html = html.replace(' role="main"', "")
    links = listing_links(html, "https://www.example.com/blog/")
    base = "https://www.example.com/blog/"
    assert [(c.url, c.title) for c in links] == [
        (base + "council-approves-river-trail", "Council approves the river trail extension"),
        (base + "harvest-market-returns", "The harvest market returns to the square"),
        (base + "new-bus-routes", "Three new bus routes start Monday"),
        (base + "school-garden-wins-grant", "School garden wins a provincial grant"),
        (base + "rowing-club-hosts-regatta", "Rowing club hosts its first regatta"),
    ]
    assert [c.published.date().isoformat() for c in links] == [
        "2026-10-18", "2026-10-12", "2026-09-30", "2026-09-22", "2026-09-15",
    ]


def test_listing_links_keeps_a_header_inside_an_aria_main_region():
    # ARIA scopes a header by role as well as by tag: under role="main"
    # it is the region's header, not the page's banner.
    html = """<html><body>
      <header><a href="/news/menu-one">M1</a><a href="/news/menu-two">M2</a>
        <a href="/news/menu-three">M3</a><a href="/news/menu-four">M4</a></header>
      <div id="content" role="main">
        <header class="top-stories"><ul>
          <li><a href="/news/alpha">Alpha story</a></li>
          <li><a href="/news/beta">Beta story</a></li>
          <li><a href="/news/gamma">Gamma story</a></li>
        </ul></header>
      </div>
    </body></html>"""
    assert [c.title for c in listing_links(html, "https://www.example.com/news/")] == [
        "Alpha story", "Beta story", "Gamma story",
    ]
