# PR10a: article_detect library

Backend track. A pure library plus fixtures and tests. Nothing calls it yet: PR10b wires it into
`generic_scrape` and `feed_autodiscovery`. No route, no migration, no frontend, no flows or smoke
states, and no change in behaviour.

## What changed

- **`backend/app/article_detect.py` (new, pure).** No network, no database, no process-local
  state. It imports `courlan`, `tld`, `lxml` and `trafilatura`, all already in
  `requirements.lock`, and uses them only as parsers.
  - **`url_ok(url, site)`.** A yes/no test on a candidate URL. `site` is the source's URL or host.
    - Same site only, by registrable domain from `tld`'s bundled public-suffix list
      (`news.example.com` and `www.example.com` are one site; two `*.blogspot.com` blogs are
      not). An IP or `localhost` has no registrable domain, so the host itself is the site.
    - The path above the page is judged by whole segment, not substring:
      - listing, CMS and shop segments anywhere (`tag`, `category`, `author`, `page`, `feed`,
        `wp-content`, `cart`, `products`, …);
      - static-page slugs as the last segment (`about`, `contact`, `privacy-policy`, `search`, …);
      - static sections as the first segment (`pages`, `policies`, `about`, …);
      - a trailing date archive (`/2026/`, `/2026/10/`);
      - query keys of non-articles (`s`, `replytocom`, `share`, `add-to-cart`, `paged`).
    - Then `courlan.check_url(strict=True)` judges the host, the page's own segment and the
      query (file types, feeds, contact, login and index pages, bad hosts). It is called on a
      probe URL whose path above the page is neutral segments. Its verdict is used as yes/no only;
      the normalized URL is never kept.
    - When the URL's host is the source's own host, the probe uses a placeholder host, so
      courlan's host check is skipped (loopback servers with a port).
  - **`classify_sitemap(url)`** returns `news`, `post`, `page`, `taxonomy`, `author`, `product`,
    `media` or `other`, from the path only. The file name is split into whole tokens on `-_.`,
    with page numbers and the word "sitemap" removed (also when glued on: `newssitemap`). The
    classes are checked in a fixed order (taxonomy, author, product, media, page, news, post), so
    the subtype wins: `wp-sitemap-posts-page-1` is page, `post_tag-sitemap` is taxonomy,
    `product_cat-sitemap` is taxonomy. A name with no known token falls back to its directory
    (`/blog/sitemap.xml` is post), then `other`.
  - **`order_sitemaps(urls)`** applies the spec's policy: news first, then post, then other.
    Taxonomy, author, product and media are dropped. A page sitemap is dropped whenever a news or
    post sitemap is in the list, and kept last as a fallback otherwise.
  - **`score_page(html, url, *, final_url=None, text=None, owner_configured=False)`** returns
    `(score, reasons)`. A page is accepted at `ACCEPT_SCORE` (2) or more. Each reason reads like
    `"+3 json-ld article"` or `"-3 redirected to /"`.
    - +3 for a JSON-LD Article-family node, or for `og:type=article` when JSON-LD doesn't call
      the page a WebPage, AboutPage or ContactPage.
    - −3 for `og:type=website`, or JSON-LD WebSite, AboutPage or ContactPage, only when there is
      no JSON-LD article and no date.
    - +1 for a published date, −1 for none. +1 for 600+ characters, −2 under 300.
    - Hard rejects: −3 for a soft-404 title or a title that is just the site name; −3 for a
      redirect to another path; −2 for a canonical on another site.
    - `owner_configured` starts the page at +2 ("owner's link pattern or sitemap") and applies
      only the hard rejects and the under-300 rule, with no kind, date or 600+ scoring. So one
      threshold serves both modes: an owner-configured page is accepted unless a hard reject or
      the length rule fires.
    - `text` is the page's extracted main text. PR10b passes the text it already extracts. When
      it is None, it is extracted here with the plugin's options (`bare_extraction(...,
      favor_recall=True)`).
  - **`listing_links(html, page_url)`** returns `[Candidate(url, published, title)]` in page
    order. A `Candidate` unpacks as `(url, published, title)`, the shape PR10b gives sitemap
    entries.
    - It honours `<base href>`.
    - It drops nav, aside and `role` chrome, and drops header and footer when no article, aside,
      main, nav or section holds them (ARIA's banner and contentinfo rule).
    - It keeps only links that pass `url_ok` against the page, and never the page itself.
    - It groups links by tag path and takes the largest group with 3 or more distinct URLs. On a
      tie, the group with longer link text wins, so titles beat thumbnail or "Read more" links.
    - Each link's date is the first `<time datetime>` in its card: the largest ancestor that
      holds no other link of the group.
  - `same_site(url, site)` and `parse_date(raw)` are public, because PR10b can use them.
- **Fixtures (`backend/tests/fixtures/scrape/`).** All are hand-written from public CMS layouts:
  - Sitemaps:
    - WordPress core index and its page sitemap (`wp-sitemap.xml`, `wp-sitemap-posts-page-1.xml`).
    - Yoast index, page sitemap and post sitemap (`yoast-sitemap_index.xml`,
      `yoast-page-sitemap.xml`, `yoast-post-sitemap2.xml`). The page sitemap is the newest entry
      in the index, and the About page is newer than any post.
    - Shopify index (`shopify-sitemap.xml`).
    - Google News sitemap and a news site's mixed index (`news-sitemap.xml`,
      `news-sitemap_index.xml`).
  - Pages:
    - a WordPress listing (`listing.html`) with `<base>`, menus, pagination, tag links, external
      partner links, a sidebar list longer than the listing, and a footer list;
    - a Yoast post (`yoast-post.html`), a Yoast About page (`yoast-about.html`) and a plain About
      page (`about.html`);
    - a dated `og:type=website` post (`dated-website-post.html`);
    - an undated ollama-style `/library/<model>` page (`ollama-library-model.html`);
    - the home page a dead link redirects to (`home.html`), a soft 404 (`soft-404.html`), and a
      wire story with a foreign canonical (`foreign-canonical.html`).
- **`backend/tests/test_article_detect.py` (new, `no_db`, 63 tests).**
  - `url_ok`: the spec's must-pass slugs (`/pets/fat-cat/how-to-feed`, `/news/power-user/tips`,
    `/search/best-laptops-2026`), everyday article shapes, a query string, a loopback host equal
    to the source's own host (and a different loopback host rejected), and 20 shapes that must be
    rejected.
  - Sitemaps:
    - WordPress core, Yoast, Shopify and News class and order;
    - the recently edited About page excluded when a post sitemap exists;
    - a lone page sitemap kept, with its entries still filtered by `url_ok` and `score_page`;
    - edge names: a plain sitemap, Drupal's `?page=2`, `newssitemap`, `.xml.gz`, `/blog/sitemap.xml`
      and `heritage-sitemap`.
  - `score_page`:
    - the Yoast post and the dated `og:type=website` post are accepted;
    - the About page and the Yoast About page are rejected;
    - the home-page redirect and the soft 404 are rejected;
    - a same-path redirect (http to https, trailing slash) is not counted as a redirect;
    - a foreign canonical counts, and a canonical on another host of the same site does not;
    - the ollama page is rejected on its own and accepted under `owner_configured`;
    - owner mode keeps each hard reject and the under-300 rule, with no kind or date scoring;
    - text passed in is used.
  - `listing_links`:
    - the fixture's five posts, in order, with titles and dates;
    - `<base>` honoured;
    - chrome and foreign links dropped;
    - fewer than 3 distinct links gives `[]`;
    - title links beat thumbnail links;
    - card headers survive without `<main>`.
- `ARCHITECTURE.md` is unchanged, because the library adds no process-local state.
  `frontend/scripts/iphone-audit/README.md` is unchanged, because no flows or states were added.

## Deviations from the spec

- **`url_ok` doesn't give courlan the whole URL.** The spec uses
  `courlan.check_url(strict=True)` as the yes/no test, and also requires the cat, user and search
  slugs to pass. courlan 1.4.0 rejects all three in strict mode. Its `SITE_STRUCTURE` regex
  matches `[/_-](cat|user|…)/[^/]+/?$`, so `fat-cat/` and `power-user/` match, and any
  `/search/` segment matches. So the path above the page is ours, by whole segment, and courlan
  sees that path as neutral `x/` segments. It still judges the host, the page's own segment and
  the query. That is also how "skip courlan's domain check for the source's own host" is done: the
  probe gets a placeholder host. The `with_nav=True` option doesn't help, because it still rejects
  `/search/`.
- **`order_sitemaps` is new.** The spec puts the page-sitemap rule under `classify_sitemap`, and
  the ordering in PR10b's `_crawl_sitemaps`. The rule needs the whole list ("skip it whenever a
  post sitemap exists"), so it is a pure function here and is tested with the fixtures. PR10b
  calls it instead of re-implementing it.
- **`classify_sitemap` has no WordPress-specific branch.** Checking the classes in a fixed order
  (page and taxonomy before post) classifies `wp-sitemap-posts-page-1` as page from its whole
  tokens. A WordPress custom post type (`wp-sitemap-posts-recipe-1`) reads as post.
- **`score_page`'s owner mode is a +2 start**, not a separate accept rule, so callers compare
  one score with one threshold. The spec's rules are unchanged: only the hard rejects and the
  under-300 rule apply.
- **What counts as a date** isn't spelled out in the spec. The library counts:
  - published-date metadata only: `article:published_time` and its peers, and `datePublished`
    on JSON-LD Article-family nodes;
  - a `<time datetime>` marked as published (`pubdate`, `itemprop`, `published`, `entry-date` or
    `dt-published`) or inside an article's header;
  - a dated URL path (`/2026/10/slug`, `2026-10-18`).

  It does not count modified times (Yoast gives every page `article:modified_time`), the
  `datePublished` on a Yoast WebPage node, or trafilatura's guessed date, which can come from a
  copyright line. Without these limits the Yoast About page earns +1 and escapes the −3.
- **JSON-LD is read at the top level, in `@graph`, and in `mainEntity`, and no deeper.** So a
  listing's `ItemList` of BlogPostings doesn't make the listing an article. The Article family
  includes schema.org's subtypes (TechArticle, LiveBlogPosting, the NewsArticle subtypes, …).
- **Soft-404 titles** cover "404", "Page not found", "Not found", "Nothing found" and WordPress's
  "Oops! That page can't be found." The checks run on each part of `<title>` and `og:title` split
  on separators (`|`, `–`, `-`, …), and on the first `<h1>`. "Title is the site name" means every
  part equals `og:site_name`, or the JSON-LD WebSite name. So "Example Blog | My post" does not
  count.
- **`listing_links` filters with `url_ok` before grouping,** not just by same site. Without that,
  each card's tag links join its "Read more" links in one larger group (`article/footer/a`), and
  that group wins.

## Verification

- **Full backend pytest** on `popping_test`, after the fast-forward onto main 520ee43 (PR1r and
  PR6a): **13 failed, 1060 passed**. The 13 failures diff clean against the DNS-only baseline in
  `/root/popping-env/baseline.txt`. That is 997 on main plus the 63 new tests. Before the
  fast-forward, on ed956b4, the result was 13 failed, 1009 passed, with the same 13 failures.
- `tests/test_article_detect.py` alone: 63 passed in about 0.5 s, with no database.
- `ruff check --select F,E9,B` on both new Python files: clean.
- No frontend file changed, so frontend lint, build, unit tests and smoke were not needed. No
  backend test that pins frontend source was touched.
- **Security checklist:** no routes, no fetches and no stored JSON. `courlan.check_url` runs
  without `with_redirects`, so it never touches the network. `tld` reads its bundled suffix list.
  `trafilatura` parses a string it is handed.
- **Mutation checks.** A script broke each guarded line, ran the named test(s), expected a
  failure, and restored the file byte for byte (checked by SHA-256). All 43 mutations were caught:

  | Broken line | Failing test |
  |---|---|
  | courlan judges the whole path / host check never skipped | `test_url_ok_keeps_articles` / `test_url_ok_keeps_a_loopback_host_that_is_the_sources_own` |
  | no same-site check / no segment list / no static slugs / no date-archive rule / no query-key rule | `test_url_ok_rejects_pages_that_are_not_articles` |
  | segment list matched by substring / static slugs at any position | `test_url_ok_keeps_articles` |
  | post class checked before page | `test_wordpress_core_sitemaps_classify_on_the_subtype_token` |
  | post class checked before taxonomy | `test_yoast_sitemaps_classify_and_the_page_sitemap_is_skipped` |
  | tokens matched as substrings / query read as part of the name | `test_classify_sitemap_edge_cases` |
  | page sitemap kept beside posts | `test_recently_edited_about_page_is_excluded_when_a_post_sitemap_exists` |
  | lone page sitemap dropped | `test_a_lone_page_sitemap_is_kept_and_its_entries_still_filtered` |
  | skipped classes read | `test_shopify_sitemaps_keep_only_the_blogs` |
  | news not first | `test_news_sitemap_reads_first` |
  | og:type article not cancelled by WebPage / JSON-LD date from any node / modified time counts | `test_yoast_about_page_with_og_article_is_rejected` |
  | no JSON-LD article +3 | `test_yoast_post_is_an_article` |
  | website −3 even when dated / no h-entry or article-header time | `test_dated_og_website_post_is_accepted` |
  | no website −3 | `test_about_page_is_rejected` |
  | threshold 3 / owner mode without the +2 | `test_dated_og_website_post_is_accepted`, `test_undated_library_page_is_accepted_under_a_link_pattern` |
  | owner mode still scores kind and date / no under-300 rule | `test_owner_configured_rejects_a_page_under_300_characters` |
  | no soft-404 / no site-name / no redirect / no foreign-canonical rule | `test_soft_404_is_rejected`, `test_home_page_redirect_is_rejected`, `test_foreign_canonical_counts_against_a_page`, `test_owner_configured_keeps_the_hard_rejects` |
  | redirect compares raw paths | `test_redirect_to_the_same_path_is_not_a_redirect` |
  | canonical compared by host, not site | `test_foreign_canonical_counts_against_a_page` |
  | `text` argument ignored | `test_text_passed_in_is_used_instead_of_extracting` |
  | no chrome dropped | `test_listing_links_takes_the_repeating_post_list`, `test_listing_links_drops_chrome_and_foreign_links` |
  | header/footer kept only inside article or main | `test_listing_links_keeps_post_card_headers_without_main` |
  | `<base>` ignored | `test_listing_links_resolves_against_base` |
  | links filtered by same site only / foreign links kept | `test_listing_links_takes_the_repeating_post_list` / `test_listing_links_drops_chrome_and_foreign_links` |
  | no tie-break on link text | `test_listing_links_prefers_title_links_over_image_links_to_the_same_posts` |
  | group minimum 2 | `test_listing_links_needs_three_distinct_links` |
  | date read from the link instead of its card | `test_listing_links_takes_the_repeating_post_list` |

  On the first run, three mutations survived, and each one was fixed:
  - **The query-key rule.** The test URL `/?s=trail` was already rejected as the home page. The
    test now uses `/blog/?s=trail` and a `?replytocom=` link.
  - **Two malformed mutations** were rewritten to break the intended line: reading the query into
    the sitemap name, and owner mode still scoring kind and date.

## Risks and data-compatibility notes

- None at runtime: nothing imports the module yet.
- Revert is safe.

## Open items for later units

- **The owner's junk sites aren't covered yet.** Their URLs weren't available to this session,
  and this container has no DNS, so nothing was fetched live. Once the owner sends the URLs, save
  each page and sitemap offline into `backend/tests/fixtures/scrape/` and add cases (spec's last
  Tests bullet).
- **PR10b wiring:**
  - `_crawl_sitemaps`: run `order_sitemaps` on the robots.txt-listed sitemaps and on each index's
    nested list, before the newest-first sort. Run `url_ok(entry, source.url)` on every entry,
    then `link_pattern`.
  - `_extract_one`: pass `text=` from the `bare_extraction` it already runs, and `final_url=`
    once `fetch_html` gains `return_final_url`, both in the same `asyncio.to_thread` call. Accept
    when `score >= ACCEPT_SCORE`. The `reasons` list suits a debug log line.
    `owner_configured=bool(link_pattern or sitemap_url)`.
  - `listing_links(html, url)` when there is no link pattern. Its `Candidate.published` can feed
    the newest-first sort and the undated cap.
  - `feed_autodiscovery._site_key` is an approximate registrable domain. `article_detect.same_site`
    uses the public-suffix list. Consider switching `_same_site` to it, so the crawl and the
    filter agree on what "same site" means (for example `*.blogspot.com` tenants).
- **Scoring false negative to watch in PR10b's review:** an undated post with `og:type=article`
  on a site whose every page carries a site-wide JSON-LD WebSite node scores +3 −3 −1 +1 = 0 and
  is rejected. This follows the spec's −3 rule literally. If the owner's VPS probe shows such
  feeds losing stories, the fix is to stop counting the WebSite node against a page that earned
  +3 from `og:type=article`. That needs a spec change.

## Device checks

None. Nothing calls the library until PR10b, so there is nothing to see on a device. Nothing was
added to `docs/DEVICE_CHECKS.md`.
