"""Tell a website's articles apart from the rest of its pages.

A ``type="generic_scrape"`` source reads a site that has no feed: its
sitemap, or a listing page. Both list far more than articles — About,
Contact, tag, author and shop pages sit right next to the posts, and a
page sitemap often sorts first because static pages get edited. This
module holds the tests that keep those out:

- ``url_ok`` — a cheap yes/no on a candidate URL, before any fetch.
- ``classify_sitemap`` / ``order_sitemaps`` — which of a site's
  sitemaps to read, and in what order.
- ``score_page`` — whether a fetched page is an article.
- ``listing_links`` — the article links on a listing page.

Pure: no network, no database, no process-local state. ``courlan``,
``tld``, ``lxml`` and ``trafilatura`` are used only as parsers. The
callers (``app.sources.generic_scrape``, ``app.feed_autodiscovery``)
do the SSRF-guarded fetching.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections import defaultdict
from email.utils import parsedate_to_datetime
from typing import Iterable, NamedTuple
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit

import courlan
import lxml.html
import tld
from lxml import etree

# A page is accepted at this score or more (see ``score_page``).
ACCEPT_SCORE = 2


class Candidate(NamedTuple):
    """One article link found on a listing page. Unpacks as
    ``(url, published, title)``, the same shape as a sitemap entry."""

    url: str
    published: dt.datetime | None
    title: str | None


# ---------------------------------------------------------------------------
# Sites and hosts
# ---------------------------------------------------------------------------


def _host(url_or_host: str) -> str:
    """Lower-case host of a URL, or the value itself when it is a bare
    host (``example.com``, ``127.0.0.1:8080`` keeps no port)."""
    value = url_or_host.strip()
    if "://" not in value:
        value = "http://" + value
    try:
        return (urlsplit(value).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def _site(host: str) -> str:
    """The registrable domain (``news.bbc.co.uk`` -> ``bbc.co.uk``) from
    ``tld``'s bundled public-suffix list. An IP, ``localhost`` or an
    unknown suffix has none, so the host itself is the site."""
    if not host:
        return ""
    return tld.get_fld(host, fix_protocol=True, fail_silently=True) or host


def same_site(url: str, site: str) -> bool:
    """True when ``url`` belongs to the same registrable domain as
    ``site`` (a URL or a host). Subdomains count: a blog at
    ``blog.example.com`` and its pages at ``www.example.com`` are one
    site. Separate tenants on a shared suffix (two ``*.blogspot.com``
    blogs) are not."""
    host = _host(url)
    return bool(host) and _site(host) == _site(_host(site))


# ---------------------------------------------------------------------------
# url_ok
# ---------------------------------------------------------------------------

# Whole path segments that mark a page as not an article wherever they
# appear: taxonomy and author listings, CMS plumbing, account and cart
# pages. Whole segments, not substrings: ``/pets/fat-cat/...`` and
# ``/news/power-user/...`` are articles.
_NON_ARTICLE_SEGMENTS = frozenset({
    "tag", "tags", "category", "categories", "author", "authors",
    "attachment", "uploads",
    "wp-admin", "wp-content", "wp-includes", "wp-json", "cdn-cgi",
    "feed", "rss", "atom", "trackback",
    "cart", "checkout", "basket", "wishlist", "account", "my-account",
    "login", "logout", "signin", "sign-in", "signup", "sign-up", "register",
    "shop", "collections",
})

# Words that name a listing or a record only in some positions. As the
# last segment they are the listing itself (``/forum/users``,
# ``/blog/products/``); as the first segment with one identifier after
# them they are one record (``/users/dana``, ``/products/canvas-tote``,
# ``/members/123``). A news section of the same name with an article
# under it (``/blog/products/new-launch``,
# ``/news/profiles/mayor-retires``) is fine.
_RECORD_SEGMENTS = frozenset({
    "user", "users", "profile", "profiles", "member", "members",
    "comments", "product", "products",
})

# Archive listings: the archive itself (``/archive/``) or a date
# archive under it (``/archives/2026/07/``). An article under it is
# fine: WordPress's numeric permalinks (``/archives/123``) and The
# Atlantic's ``/<section>/archive/2024/01/<slug>/<id>/``.
_ARCHIVE_SEGMENTS = frozenset({"archive", "archives"})

# Sections whose bare year is a year archive (``/blog/2026/``), unlike
# a numeric id elsewhere (``/node/2015``, ``/p/2041``).
_YEAR_ARCHIVE_PARENTS = _ARCHIVE_SEGMENTS | {
    "blog", "blogs", "news", "posts", "articles", "stories",
}

# Static pages, rejected when they are the page itself (the last
# segment): ``/about/``, ``/blog/contact``, ``/search``. A search
# section with articles under it (``/search/best-laptops-2026``) is
# fine; ``score_page`` judges whatever such a URL turns out to be.
_STATIC_SLUGS = frozenset({
    "about", "about-us", "about-me", "contact", "contact-us", "contacts",
    "privacy", "privacy-policy", "privacy-notice", "cookies", "cookie-policy",
    "terms", "terms-of-use", "terms-of-service", "terms-and-conditions", "tos",
    "legal", "disclaimer", "accessibility", "imprint", "impressum",
    "careers", "jobs", "advertise", "advertising", "faq", "faqs",
    "help", "support", "subscribe", "newsletter", "donate", "sitemap",
    "search", "team", "our-team", "staff", "embed", "amp",
    "wp-login.php", "xmlrpc.php",
})

# Sections whose every page is a static page: Shopify's ``/pages/``,
# ``/policies/``, and ``/about/team``-style trees. Not ``legal``,
# ``help`` or ``support``: news sites file stories under those
# (Reuters' ``/legal/government/...``). As the page itself they are
# still static slugs above.
_STATIC_SECTIONS = frozenset({
    "pages", "policies", "about", "about-us", "contact", "contact-us",
})

# Query keys of pages that aren't articles: a WordPress search
# (``?s=``), static page and attachment ids, comment-reply and share
# links, cart actions, paging.
_NON_ARTICLE_QUERY_KEYS = frozenset({
    "s", "page_id", "attachment_id", "replytocom", "share",
    "add-to-cart", "add_to_cart", "paged",
})

# Query keys that make the site root a post: WordPress's Plain
# permalinks (``/?p=123``), which its core sitemap lists for every post.
_ROOT_POST_QUERY_KEYS = frozenset({"p"})

_YEAR_RE = re.compile(r"(?:19|20)\d{2}")
_MONTH_RE = re.compile(r"0?[1-9]|1[0-2]")
_DAY_RE = re.compile(r"0?[1-9]|[12]\d|3[01]")
_NUMBER_RE = re.compile(r"\d+")

# courlan only judges the host, the page's own name and the query (see
# ``url_ok``); this stands in for the source's own host and for the
# path above the page.
_PROBE_HOST = "example.com"


def _segments(path: str) -> list[str]:
    return [unquote(s).lower() for s in path.split("/") if s]


def _is_date_tail(segments: list[str]) -> bool:
    """True for ``[YYYY]``, ``[YYYY, MM]`` or ``[YYYY, MM, DD]``."""
    if not 1 <= len(segments) <= 3:
        return False
    return all(
        pattern.fullmatch(s) for pattern, s in zip((_YEAR_RE, _MONTH_RE, _DAY_RE), segments, strict=False)
    )


def _date_archive(segments: list[str]) -> bool:
    """A path that ends in a date archive. ``/YYYY/MM/`` and
    ``/YYYY/MM/DD/`` are archives at any depth. A lone year is one only
    as the whole path (``/2026/``) or under a blog, news or archive
    section (``/blog/2026/``); elsewhere it is a numeric id
    (``/node/2015``, ``/p/2041``)."""
    if any(len(segments) >= n and _is_date_tail(segments[-n:]) for n in (3, 2)):
        return True
    if _YEAR_RE.fullmatch(segments[-1]):
        return len(segments) == 1 or segments[-2] in _YEAR_ARCHIVE_PARENTS
    return False


def _listing_path(segments: list[str]) -> bool:
    """A path whose segments name a listing, a record or CMS plumbing
    rather than an article (see the segment sets above)."""
    for i, segment in enumerate(segments):
        rest = segments[i + 1:]
        if segment in _NON_ARTICLE_SEGMENTS:
            return True
        if segment in _RECORD_SEGMENTS and (not rest or (i == 0 and len(rest) == 1)):
            return True
        if segment in _ARCHIVE_SEGMENTS and (not rest or _is_date_tail(rest)):
            return True
        # Pagination: /blog/page/2/.
        if segment == "page" and len(rest) == 1 and _NUMBER_RE.fullmatch(rest[0]):
            return True
    return False


def url_ok(url: str, site: str) -> bool:
    """Cheap test of whether ``url`` could be an article on ``site``
    (the source's URL or host). Same-site http(s) URLs only.

    Two checks, each on what it reads well:

    - **The path above the page is ours**, by whole segment and by
      position (``_NON_ARTICLE_SEGMENTS`` anywhere; record, archive and
      pagination words only where they are the listing or one record;
      ``_STATIC_SECTIONS`` first; date archives last). The site root is
      the home page unless its query names a post (WordPress's
      ``/?p=123``). courlan's own structure filter matches substrings:
      it reads
      ``/pets/fat-cat/how-to-feed`` as a category page,
      ``/news/power-user/tips`` as a user page, and any ``/search/``
      as a search page.
    - **courlan judges the rest**: ``check_url(strict=True)`` on the
      page's own name, the query and the host — file types, feeds,
      contact, login and index pages, malformed hosts. It is a yes/no
      test only. The URL it would normalize to is never used, because
      strict normalizing drops query parameters it doesn't know.

    When the URL's host is the source's own host, courlan's host check
    is skipped: the owner chose that host, and courlan rejects an IP or
    ``localhost`` with a port, which every loopback test server uses.
    """
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    if not same_site(url, site):
        return False

    segments = _segments(parts.path)
    query_keys = {k.lower() for k, _ in parse_qsl(parts.query, keep_blank_values=True)}
    if not segments and not query_keys & _ROOT_POST_QUERY_KEYS:
        return False  # the home page
    if _listing_path(segments):
        return False
    if segments and (segments[-1] in _STATIC_SLUGS or segments[0] in _STATIC_SECTIONS):
        return False
    if segments and _date_archive(segments):
        return False
    if query_keys & _NON_ARTICLE_QUERY_KEYS:
        return False

    own_host = parts.hostname.lower().rstrip(".") == _host(site)
    netloc = _PROBE_HOST if own_host else parts.netloc
    # Keep the page's own segment (and its trailing slash); every
    # segment above it was judged above. A root post (/?p=123) keeps
    # the bare root.
    path = ""
    if segments:
        page = parts.path.rstrip("/").rsplit("/", 1)[-1]
        trailing = "/" if parts.path.endswith("/") else ""
        path = "x/" * (len(segments) - 1) + page + trailing
    probe = f"{parts.scheme}://{netloc}/{path}"
    if parts.query:
        probe += "?" + parts.query
    return courlan.check_url(probe, strict=True) is not None


# ---------------------------------------------------------------------------
# Sitemaps
# ---------------------------------------------------------------------------

SITEMAP_NEWS = "news"
SITEMAP_POST = "post"
SITEMAP_PAGE = "page"
SITEMAP_TAXONOMY = "taxonomy"
SITEMAP_AUTHOR = "author"
SITEMAP_PRODUCT = "product"
SITEMAP_MEDIA = "media"
SITEMAP_OTHER = "other"

# Never read: their entries are listings, people, products or files.
SKIPPED_SITEMAPS = frozenset({
    SITEMAP_TAXONOMY, SITEMAP_AUTHOR, SITEMAP_PRODUCT, SITEMAP_MEDIA,
})

# Whole tokens of a sitemap's file name. Checked in this order, so the
# subtype wins over a broader word next to it: WordPress core's
# ``wp-sitemap-posts-page-1.xml`` is pages, Yoast's
# ``post_tag-sitemap.xml`` is tags and ``product_cat-sitemap.xml`` is
# product categories, not posts or products.
_SITEMAP_TOKENS: tuple[tuple[str, frozenset[str]], ...] = (
    (SITEMAP_TAXONOMY, frozenset({
        "tag", "tags", "category", "categories", "cat", "taxonomy",
        "taxonomies", "topic", "topics", "collection", "collections",
    })),
    (SITEMAP_AUTHOR, frozenset({"author", "authors", "user", "users"})),
    (SITEMAP_PRODUCT, frozenset({"product", "products", "shop"})),
    (SITEMAP_MEDIA, frozenset({
        "attachment", "attachments", "image", "images", "video", "videos", "media",
    })),
    (SITEMAP_PAGE, frozenset({"page", "pages"})),
    (SITEMAP_NEWS, frozenset({"news", "googlenews"})),
    (SITEMAP_POST, frozenset({
        "post", "posts", "article", "articles", "blog", "blogs", "story", "stories",
    })),
)

_SITEMAP_EXT_RE = re.compile(r"\.(?:xml|txt)(?:\.gz)?$|\.gz$")
_TOKEN_SPLIT_RE = re.compile(r"[-_.]+")
# Trailing page numbers: post-sitemap2, sitemap_products_1.
_TOKEN_DIGITS_RE = re.compile(r"\d+$")
_NOISE_TOKENS = frozenset({"sitemap", "sitemaps", "index", "wp", "xml", ""})


def _sitemap_tokens(name: str) -> list[str]:
    """Whole words of a sitemap name, without "sitemap" and page
    numbers. "sitemap" glued to a word is split off, so
    ``newssitemap1`` and ``sitemapnews`` both give ``news``; a word is
    never searched for inside another (``heritage`` holds no tag)."""
    tokens = []
    for raw in _TOKEN_SPLIT_RE.split(name.lower()):
        for token in _TOKEN_DIGITS_RE.sub("", raw).split("sitemap"):
            token = _TOKEN_DIGITS_RE.sub("", token)
            if token not in _NOISE_TOKENS:
                tokens.append(token)
    return tokens


def _class_of_tokens(tokens: Iterable[str]) -> str | None:
    found = set(tokens)
    for cls, words in _SITEMAP_TOKENS:
        if found & words:
            return cls
    return None


def classify_sitemap(url: str) -> str:
    """The kind of pages a sitemap lists, from its URL alone: one of
    ``news``, ``post``, ``page``, ``taxonomy``, ``author``,
    ``product``, ``media`` or ``other`` (a plain ``sitemap.xml``, an
    index, or a name we don't know).

    Whole subtype tokens decide first. WordPress core names its
    sitemaps ``wp-sitemap-<provider>-<subtype>-<n>.xml``, so
    ``wp-sitemap-posts-page-1.xml`` contains "posts" but lists pages.
    The page class also covers Yoast's ``page-sitemap*.xml`` and
    Shopify's ``sitemap_pages_*.xml``. Of the query, only WordPress
    core's Plain-permalink form is read
    (``/?sitemap=posts&sitemap-subtype=page``): the ``?page=2`` of a
    paged Drupal sitemap is not a page sitemap.
    """
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return SITEMAP_OTHER
    segments = [s for s in parts.path.lower().split("/") if s]
    name = _SITEMAP_EXT_RE.sub("", segments[-1]) if segments else ""

    cls = _class_of_tokens(_sitemap_tokens(name))
    if cls:
        return cls
    query = {k.lower(): v for k, v in parse_qsl(parts.query)}
    wp_plain = [query[k] for k in ("sitemap-subtype", "sitemap") if k in query]
    cls = _class_of_tokens(t for value in wp_plain for t in _sitemap_tokens(value))
    if cls:
        return cls
    # A sitemap filed under its section: /blog/sitemap.xml.
    for segment in reversed(segments[:-1]):
        cls = _class_of_tokens(_sitemap_tokens(segment))
        if cls:
            return cls
    return SITEMAP_OTHER


_SITEMAP_ORDER = {SITEMAP_NEWS: 0, SITEMAP_POST: 1, SITEMAP_OTHER: 2, SITEMAP_PAGE: 3}


def order_sitemaps(urls: Iterable[str]) -> list[str]:
    """The sitemaps worth reading, best first: news, then post (post,
    article and blog), then unknown ones, keeping the given order
    within each class. Taxonomy, author, product and media sitemaps
    are dropped.

    A page sitemap is dropped whenever a news or post sitemap exists.
    Page sitemaps are where About and Contact come from, and because
    static pages get edited they often carry the newest ``<lastmod>``.
    When there is no news or post sitemap, the page sitemap is kept
    last as a fallback; ``url_ok`` and ``score_page`` still filter its
    entries.
    """
    classed = [(u, classify_sitemap(u)) for u in urls]
    has_posts = any(c in (SITEMAP_NEWS, SITEMAP_POST) for _, c in classed)
    kept = [
        (u, c) for u, c in classed
        if c not in SKIPPED_SITEMAPS and not (c == SITEMAP_PAGE and has_posts)
    ]
    return [u for u, c in sorted(kept, key=lambda pair: _SITEMAP_ORDER[pair[1]])]


# ---------------------------------------------------------------------------
# Page parsing helpers
# ---------------------------------------------------------------------------

_HTML_PARSER = lxml.html.HTMLParser(encoding="utf-8")


def _parse_html(html: str):
    """An lxml document for ``html``, or None. Parsed from UTF-8 bytes,
    because lxml refuses a str that carries an XML encoding line."""
    if not html or not html.strip():
        return None
    try:
        return lxml.html.document_fromstring(
            html.encode("utf-8", "replace"), parser=_HTML_PARSER
        )
    except (ValueError, etree.ParserError):
        return None


def _clean_text(value: str | None) -> str:
    return " ".join((value or "").split())


def parse_date(raw: str | None) -> dt.datetime | None:
    """A timezone-aware UTC datetime from an ISO-8601 or RFC 822 date
    string, or None. A date without a time is midnight UTC, and a
    value before 1990 is treated as junk."""
    value = (raw or "").strip()
    if not value:
        return None
    parsed: dt.datetime | None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError):
            return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    parsed = parsed.astimezone(dt.timezone.utc)
    return parsed if parsed.year >= 1990 else None


# ---------------------------------------------------------------------------
# score_page
# ---------------------------------------------------------------------------

_ARTICLE_TYPES = frozenset({
    "article", "blogposting", "newsarticle", "analysisnewsarticle",
    "backgroundnewsarticle", "opinionnewsarticle", "reportagenewsarticle",
    "reviewnewsarticle", "liveblogposting", "techarticle",
    "scholarlyarticle", "report",
})
# JSON-LD that cancels an ``og:type=article``: Yoast marks every page
# ``og:type=article``, but its JSON-LD still calls a page a WebPage.
_PAGE_TYPES = frozenset({"webpage", "aboutpage", "contactpage"})
# JSON-LD that counts against a page (with ``og:type=website``).
_SITE_TYPES = frozenset({"website", "aboutpage", "contactpage"})

# Published-date metadata, most specific first. Modified dates don't
# count: Yoast gives every page an ``article:modified_time``.
_DATE_META = (
    "article:published_time", "og:published_time", "datepublished",
    "parsely-pub-date", "sailthru.date", "article.published", "pubdate",
    "publishdate", "publish-date", "publish_date", "dc.date.issued",
    "dcterms.issued", "dcterms.created", "dcterms.date", "dc.date", "date",
)
_TIME_CLASSES = frozenset({
    "published", "entry-date", "post-date", "publish-date", "date-published",
    "dt-published",  # microformats h-entry
})
_URL_DATE_RE = re.compile(
    r"/(?:19|20)\d{2}/(?:0?[1-9]|1[0-2])/"
    r"|(?<!\d)(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)"
)

# Title separators: "Post title – Site", "Site | Post title".
_TITLE_SPLIT_RE = re.compile(r"\s+[|–—·»:\-]+\s+")
# Each alternative is a whole title part: "404", "Error 404",
# "404 Not Found", "404: Page not found". A title that only starts with
# 404 ("404 errors: how to fix them") or a site named "404 Media" is not
# one.
_SOFT_404_RE = re.compile(
    r"^(?:error\s*)?404(?:\s*[:\-–—]?\s*(?:error|(?:page\s+)?not\s+found))?$"
    r"|^(?:page\s+)?not\s+found$"
    r"|^nothing\s+(?:was\s+)?found$"
    r"|^(?:oops[!.,]?\s*)?(?:sorry[!.,]?\s*)?(?:that\s+|the\s+|this\s+)?page\s+"
    r"(?:can(?:'|’|no)?t|could\s*n[o']?t|could not)\s+be\s+found",
    re.IGNORECASE,
)

_LONG_TEXT = 600
_SHORT_TEXT = 300


class _PageFacts(NamedTuple):
    og_type: str
    site_name: str
    titles: list[str]
    h1: str
    canonical: str | None
    jsonld_types: set[str]
    # A published date from the page's metadata, else whether its URL
    # carries one (/2026/07/slug).
    published: dt.datetime | None
    url_dated: bool


def _jsonld_nodes(data) -> Iterable[dict]:
    """Top-level JSON-LD nodes: the script's own object(s), ``@graph``
    members, and each one's ``mainEntity``. Nothing deeper, so a
    listing page whose ``ItemList`` holds BlogPostings isn't read as
    an article, nor an article's ``isPartOf`` WebSite as a site page."""
    stack = data if isinstance(data, list) else [data]
    for node in stack:
        if not isinstance(node, dict):
            continue
        graph = node.get("@graph")
        members = graph if isinstance(graph, list) else []
        for item in [node, *members]:
            if not isinstance(item, dict):
                continue
            yield item
            main = item.get("mainEntity")
            for sub in main if isinstance(main, list) else [main]:
                if isinstance(sub, dict):
                    yield sub


# "schema:NewsArticle" and "https://schema.org/NewsArticle" are both
# "NewsArticle".
_SCHEMA_PREFIX_RE = re.compile(r"^(?:schema:|https?://(?:www\.)?schema\.org/)", re.IGNORECASE)


def _node_types(node: dict) -> set[str]:
    raw = node.get("@type")
    values = raw if isinstance(raw, list) else [raw]
    return {
        _SCHEMA_PREFIX_RE.sub("", v.strip()).lower() for v in values if isinstance(v, str)
    }


def _marked_dates(doc) -> list[tuple[object, dt.datetime]]:
    """Every element that marks a published date in the body, with its
    date: a ``<time datetime>`` marked as published (``pubdate``,
    ``itemprop``, a published class) or inside an article's header, and
    microdata ``itemprop="datePublished"`` on any element. Not a
    footer's "updated" ``<time>``."""
    out = []
    for el in doc.iter():
        if not isinstance(el.tag, str):
            continue
        itemprop = (el.get("itemprop") or "").strip().lower() == "datepublished"
        if el.tag == "time":
            stamp = el.get("datetime") or (el.get("content") if itemprop else None)
            if not stamp:
                continue
            classes = set((el.get("class") or "").lower().split())
            above = [a.tag for a in el.iterancestors()]
            in_article_header = "header" in above and "article" in above[above.index("header"):]
            if not (
                el.get("pubdate") is not None or itemprop or classes & _TIME_CLASSES
                or in_article_header
            ):
                continue
        elif itemprop:
            stamp = el.get("content") or el.get("datetime")
        else:
            continue
        parsed = parse_date(stamp)
        if parsed:
            out.append((el, parsed))
    return out


def _body_date(doc) -> dt.datetime | None:
    """The page's published date from its body, only when the page is
    one article. A listing's post cards each carry a marked date, and
    the first card's is not the listing's.

    - When the first ``<h1>`` sits in an ``<article>`` (else a
      ``<header>``), a marked date inside that element is the page's.
      Not when several articles hold an ``<h1>``: that is a listing
      whose cards use one.
    - Otherwise a marked date counts only when the page has at most one
      ``<article>`` and all its marked dates agree.
    """
    marked = _marked_dates(doc)
    if not marked:
        return None
    h1 = doc.find(".//h1")
    if h1 is not None:
        ancestors = list(h1.iterancestors())
        scope = next((a for a in ancestors if a.tag == "article"), None)
        if scope is not None and sum(
            1 for a in doc.iter("article") if a.find(".//h1") is not None
        ) > 1:
            return None
        if scope is None:
            scope = next((a for a in ancestors if a.tag == "header"), None)
        if scope is not None:
            for el, parsed in marked:
                if scope in el.iterancestors():
                    return parsed
    if len(doc.findall(".//article")) > 1:
        return None
    if len({parsed for _, parsed in marked}) > 1:
        return None
    return marked[0][1]


def _page_facts(doc, url: str) -> _PageFacts:
    # Head metadata by property or name. Microdata (``itemprop``) can
    # sit on every card of a listing, so ``_body_date`` reads it.
    meta: dict[str, str] = {}
    for el in doc.iter("meta"):
        key = (el.get("property") or el.get("name") or "").strip().lower()
        content = el.get("content")
        if key and content is not None and key not in meta:
            meta[key] = content.strip()

    types: set[str] = set()
    site_name = meta.get("og:site_name", "")
    published = None
    for script in doc.iter("script"):
        if (script.get("type") or "").strip().lower() != "application/ld+json":
            continue
        try:
            data = json.loads(script.text or "")
        except ValueError:
            continue
        for node in _jsonld_nodes(data):
            node_types = _node_types(node)
            types |= node_types
            if node_types & _ARTICLE_TYPES and published is None:
                raw = node.get("datePublished")
                published = parse_date(raw) if isinstance(raw, str) else None
            if "website" in node_types and not site_name and isinstance(node.get("name"), str):
                site_name = node["name"].strip()

    if published is None:
        for key in _DATE_META:
            if key in meta:
                published = parse_date(meta[key])
                if published:
                    break
    if published is None:
        published = _body_date(doc)

    titles = [_clean_text(meta.get("og:title"))]
    title_el = doc.find(".//title")
    if title_el is not None:
        titles.append(_clean_text(title_el.text_content()))
    h1_el = doc.find(".//h1")
    canonical = None
    for link in doc.iter("link"):
        rels = (link.get("rel") or "").lower().split()
        if "canonical" in rels and link.get("href"):
            canonical = urljoin(url, link.get("href").strip())
            break
    return _PageFacts(
        og_type=meta.get("og:type", "").lower(),
        site_name=_clean_text(site_name),
        titles=[t for t in titles if t],
        h1=_clean_text(h1_el.text_content()) if h1_el is not None else "",
        canonical=canonical,
        jsonld_types=types,
        published=published,
        url_dated=bool(_URL_DATE_RE.search(urlsplit(url).path)),
    )


def _title_parts(title: str) -> list[str]:
    return [p.strip().rstrip(".!").strip() for p in _TITLE_SPLIT_RE.split(title) if p.strip()]


def _soft_404(facts: _PageFacts) -> bool:
    """True when a whole title part (of ``og:title``, ``<title>`` or
    the first ``<h1>``) is a not-found title. A part that is the site's
    own name is skipped, whatever it says."""
    name = facts.site_name.casefold()
    for title in [*facts.titles, facts.h1]:
        if any(
            _SOFT_404_RE.search(part)
            for part in _title_parts(title)
            if not (name and part.casefold() == name)
        ):
            return True
    return False


def _site_name_title(facts: _PageFacts) -> bool:
    """True when a title is nothing but the site's name ("Example Blog",
    or "Example Blog | Example Blog"), as on the home page a dead link
    redirects to. "Example Blog | My post" is not."""
    name = facts.site_name.casefold()
    if not name:
        return False
    return any(
        all(part.casefold() == name for part in _title_parts(title))
        for title in facts.titles
    )


def _same_path(a: str, b: str) -> bool:
    def norm(u: str) -> str:
        return unquote(urlsplit(u).path).rstrip("/") or "/"
    return norm(a) == norm(b)


def _extracted_text(html: str, url: str) -> str:
    """Main text the way the generic_scrape plugin extracts it."""
    try:
        import trafilatura

        doc = trafilatura.bare_extraction(html, url=url, favor_recall=True)
    except Exception:  # noqa: BLE001 - an unparseable page has no text
        return ""
    return (getattr(doc, "text", None) or "").strip() if doc is not None else ""


def score_page(
    html: str,
    url: str,
    *,
    final_url: str | None = None,
    text: str | None = None,
    owner_configured: bool = False,
) -> tuple[int, list[str]]:
    """Score a fetched page as an article: ``(score, reasons)``, where
    the page is accepted at ``ACCEPT_SCORE`` (2) or more and each reason
    reads like ``"+3 json-ld article"``.

    ``url`` is the URL that was asked for and ``final_url`` the one the
    fetch ended on after redirects. ``text`` is the page's extracted
    main text; when None it is extracted here, the same way the plugin
    does. Run it off the event loop, like any trafilatura call.

    Kind and date:
    - +3 for ``og:type=article`` or a JSON-LD Article, BlogPosting or
      NewsArticle. ``og:type=article`` earns nothing when JSON-LD calls
      the page a WebPage, AboutPage or ContactPage: Yoast marks every
      page ``og:type=article``.
    - -3 for ``og:type=website`` or a JSON-LD WebSite, AboutPage or
      ContactPage, but only when the page has no JSON-LD article and
      no date. Many CMSs tag every page ``og:type=website``.
    - +1 for a published date, -1 for none.

    Length: +1 for 600+ characters, -2 under 300.

    Hard rejects: -3 for a soft-404 title or one that is just the site
    name, -3 for a redirect to another path, -2 for a canonical URL on
    another site.

    ``owner_configured`` (the source has a ``link_pattern`` or
    ``sitemap_url``): the owner's choice is the article signal, so the
    page starts at +2 and only the hard rejects and the under-300 rule
    apply. An ollama-style ``/library/<model>`` page declares no
    article type and no date, and is still what the owner asked for.
    """
    reasons: list[str] = []
    score = 0

    def add(points: int, why: str) -> None:
        nonlocal score
        score += points
        reasons.append(f"{points:+d} {why}")

    doc = _parse_html(html)
    if doc is None:
        add(-3, "no page")
        return score, reasons
    facts = _page_facts(doc, final_url or url)
    if text is None:
        text = _extracted_text(html, final_url or url)
    length = len(text.strip())

    if owner_configured:
        add(2, "owner's link pattern or sitemap")
    else:
        article_ld = facts.jsonld_types & _ARTICLE_TYPES
        if article_ld:
            add(3, "json-ld " + "/".join(sorted(article_ld)))
        elif facts.og_type == "article" and not facts.jsonld_types & _PAGE_TYPES:
            add(3, "og:type article")
        dated = facts.published is not None or facts.url_dated
        site_ld = facts.jsonld_types & _SITE_TYPES
        if not article_ld and not dated:
            if facts.og_type == "website":
                add(-3, "og:type website, undated")
            elif site_ld:
                add(-3, "json-ld " + "/".join(sorted(site_ld)) + ", undated")
        if facts.published is not None:
            add(1, "dated " + facts.published.date().isoformat())
        elif facts.url_dated:
            add(1, "date in URL")
        else:
            add(-1, "no date")
        if length >= _LONG_TEXT:
            add(1, f"{length} characters")

    if length < _SHORT_TEXT:
        add(-2, f"only {length} characters")
    if _soft_404(facts):
        add(-3, "soft 404 title")
    elif _site_name_title(facts):
        add(-3, "title is the site name")
    if final_url and not _same_path(url, final_url):
        add(-3, "redirected to " + (urlsplit(final_url).path or "/"))
    if facts.canonical and not same_site(facts.canonical, final_url or url):
        add(-2, "canonical on " + _host(facts.canonical))
    return score, reasons


# ---------------------------------------------------------------------------
# listing_links
# ---------------------------------------------------------------------------

# Page chrome: nav and aside always; header and footer only when they
# belong to the page. That is the ARIA rule for the banner and
# contentinfo roles: no article, aside, main, nav or section element,
# and no element with an article, complementary, feed, main, navigation
# or region role, holds them. Themes that build cards from divs give
# their cards headers too, so an unscoped header or footer that repeats
# at one tag path as often as a listing's cards do is a card's, not the
# page's. So a post card's own <header><h2><a> stays.
_CHROME_TAGS = frozenset({"nav", "aside"})
_EDGE_TAGS = frozenset({"header", "footer"})
_SCOPING_TAGS = frozenset({"article", "aside", "main", "nav", "section"})
_SCOPING_ROLES = frozenset({
    "article", "complementary", "feed", "main", "navigation", "region",
})
_CHROME_ROLES = frozenset({"navigation", "banner", "contentinfo", "complementary"})
_MIN_GROUP = 3


def _role(el) -> str:
    return (el.get("role") or "").strip().lower()


def _drop_chrome(doc) -> None:
    doomed = []
    unscoped_edges: dict[tuple[str, ...], list] = defaultdict(list)
    for el in doc.iter():
        if not isinstance(el.tag, str):
            continue
        if el.tag in _CHROME_TAGS or _role(el) in _CHROME_ROLES:
            doomed.append(el)
        elif el.tag in _EDGE_TAGS and not any(
            a.tag in _SCOPING_TAGS or _role(a) in _SCOPING_ROLES for a in el.iterancestors()
        ):
            unscoped_edges[_tag_path(el)].append(el)
    for edges in unscoped_edges.values():
        if len(edges) < _MIN_GROUP:
            doomed.extend(edges)
    for el in doomed:
        el.drop_tree()


def _tag_path(el) -> tuple[str, ...]:
    """The element's tag path from the root, without classes or
    positions: WordPress gives each post card its own classes
    (``post-123 category-news``), so classes would split one list
    into groups of one."""
    return tuple(a.tag for a in reversed(list(el.iterancestors()))) + (el.tag,)


def _link_title(a) -> str:
    text = _clean_text(a.text_content())
    if text:
        return text
    if a.get("title"):
        return _clean_text(a.get("title"))
    img = a.find(".//img")
    return _clean_text(img.get("alt")) if img is not None and img.get("alt") else ""


def listing_links(html: str, page_url: str) -> list[Candidate]:
    """The article links on a listing page, in page order:
    ``[Candidate(url, published, title)]``.

    - Links resolve against ``<base href>`` when the page has one.
    - Only same-site links that pass ``url_ok`` count, and never the
      page itself.
    - nav, aside and page-level header and footer are dropped first.
    - Links group by their tag path (``main/div/article/h2/a``), and
      the largest group with 3 or more distinct URLs wins: a listing's
      cards repeat, menus and one-off links don't. On a tie, the group
      with the longer link text wins, so titles beat "Read more" and
      image links to the same posts.
    - Each link's date is the first ``<time datetime>`` in its card
      (the largest ancestor that holds no other link of the group).
    Returns ``[]`` when no group reaches 3.
    """
    doc = _parse_html(html)
    if doc is None:
        return []
    base = page_url
    base_el = doc.find(".//base[@href]")
    if base_el is not None:
        resolved = urljoin(page_url, base_el.get("href").strip())
        if urlsplit(resolved).scheme in ("http", "https"):
            base = resolved
    _drop_chrome(doc)

    page_key = urlsplit(page_url)._replace(fragment="").geturl()
    groups: dict[tuple[str, ...], list[tuple[str, object]]] = defaultdict(list)
    for a in doc.iter("a"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        try:
            absolute = urlsplit(urljoin(base, href))._replace(fragment="").geturl()
        except ValueError:
            continue
        if absolute == page_key or not url_ok(absolute, page_url):
            continue
        groups[_tag_path(a)].append((absolute, a))

    best: list[tuple[str, object]] | None = None
    best_key: tuple[int, float] = (0, 0.0)
    for links in groups.values():
        urls = {u for u, _ in links}
        if len(urls) < _MIN_GROUP:
            continue
        mean_text = sum(len(_link_title(a)) for _, a in links) / len(links)
        key = (len(urls), mean_text)
        if key > best_key:
            best, best_key = links, key
    if best is None:
        return []

    # Which group URLs sit under each element, to find each link's card.
    under: dict[object, set[str]] = defaultdict(set)
    for u, a in best:
        for ancestor in a.iterancestors():
            under[ancestor].add(u)

    out: list[Candidate] = []
    seen: set[str] = set()
    for u, a in best:
        if u in seen:
            continue
        seen.add(u)
        card = a
        for ancestor in a.iterancestors():
            if under[ancestor] != {u}:
                break
            card = ancestor
        published = None
        for el in card.iter("time"):
            published = parse_date(el.get("datetime"))
            if published:
                break
        out.append(Candidate(u, published, _link_title(a) or None))
    return out
