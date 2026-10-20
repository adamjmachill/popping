"""PR10b: a website feed skips stored pages before fetching them, and
caps undated pages the way the ingest rules cap every other feed.

``scheduler._ingest`` hands a ``GenericScrapePlugin`` a ``known_urls``
lookup (its known-URL query, in its own session), the
``ingest.max_undated_per_poll`` knob and the poll's backlog line. The
plugin asks which candidates are already stored and never fetches those,
even after a restart has emptied its in-memory ``_extracted_urls``. A
poll whose candidates are all stored is a quiet success, not
``[no list]``.

Which undated pages are old backlog depends on what orders the list: a
listing page is in publication order, so a page below a stored story is
older; a sitemap's ``<lastmod>`` order says nothing about age (an edited
story moves up), so a page's own ``<lastmod>`` is held against the
backlog line instead.
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app import ingest_rules, scheduler
from app.article_detect import Candidate
from app.models import Entry
from app.sources import generic_scrape
from app.sources.generic_scrape import GenericScrapePlugin
from factories import make_entry, make_source

SITE = "https://site.test"
NOW = dt.datetime.now(dt.timezone.utc)


def _row(**overrides) -> SimpleNamespace:
    row = dict(
        id=1,
        name="site_test",
        type="generic_scrape",
        category="news",
        url=f"{SITE}/sitemap.xml",
        refresh_interval_seconds=7200,
        sitemap_url=None,
        link_pattern=None,
        custom_headers=None,
    )
    row.update(overrides)
    return SimpleNamespace(**row)


def _serve(
    monkeypatch,
    urls: list[str],
    *,
    dated: bool = True,
    modified: dict[str, dt.datetime] | None = None,
    listing: bool = False,
) -> list[str]:
    """The sitemap lists ``urls`` (newest first), each with its
    ``<lastmod>`` from ``modified``; with ``listing``, the feed's
    listing page lists them instead (``_row(url=LISTING)``). Every page
    extracts as an article, dated now unless ``dated`` is False. Returns
    the list of pages ``_extract_one`` was asked for."""
    calls: list[str] = []
    modified = modified or {}
    candidates = [Candidate(u, None, None, modified.get(u)) for u in urls]

    async def fake_discover(url, limit=200, path_prefix=None, **kwargs):
        return [] if listing else candidates

    async def fake_page_links(url, pattern, *args, **kwargs):
        return candidates if listing else []

    async def fake_extract(url, custom_headers=None, **kwargs):
        calls.append(url)
        return {"title": f"Story {url}", "url": url, "published_at": NOW if dated else None}

    monkeypatch.setattr(generic_scrape, "discover_sitemap_entries", fake_discover)
    monkeypatch.setattr(generic_scrape, "_discover_page_links", fake_page_links)
    monkeypatch.setattr(generic_scrape, "_extract_one", fake_extract)
    return calls


LISTING = f"{SITE}/news/"


def _known(stored: set[str]):
    asked: list[list[str]] = []

    async def lookup(urls: list[str]) -> set[str]:
        asked.append(list(urls))
        return stored & set(urls)

    lookup.asked = asked
    return lookup


# --- the plugin, with a stand-in lookup ---------------------------------------


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_stored_urls_are_skipped_before_extraction(monkeypatch):
    urls = [f"{SITE}/a", f"{SITE}/b", f"{SITE}/c"]
    calls = _serve(monkeypatch, urls)
    lookup = _known({f"{SITE}/b"})
    items = await GenericScrapePlugin(_row()).fetch(known_urls=lookup)
    assert calls == [f"{SITE}/a", f"{SITE}/c"]
    assert [i["url"] for i in items] == [f"{SITE}/a", f"{SITE}/c"]
    # One lookup per poll, over every candidate.
    assert lookup.asked == [urls]


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_a_poll_where_everything_is_stored_returns_nothing_and_does_not_raise(monkeypatch):
    urls = [f"{SITE}/a", f"{SITE}/b"]
    calls = _serve(monkeypatch, urls)
    plugin = GenericScrapePlugin(_row())
    assert await plugin.fetch(known_urls=_known(set(urls))) == []
    assert calls == []
    # Nothing was fetched, so nothing is marked either.
    assert len(plugin._extracted_urls) == 0


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_stored_pages_are_not_fetched_again_after_a_restart(monkeypatch):
    """A new plugin instance (a backend restart) has an empty
    ``_extracted_urls``; the stored-URL lookup still keeps it from
    fetching the pages it already stored."""
    urls = [f"{SITE}/a", f"{SITE}/b"]
    calls = _serve(monkeypatch, urls)
    first = GenericScrapePlugin(_row())
    assert len(await first.fetch(known_urls=_known(set()))) == 2
    restarted = GenericScrapePlugin(_row())
    assert await restarted.fetch(known_urls=_known(set(urls))) == []
    assert calls == urls


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_without_a_lookup_nothing_counts_as_stored(monkeypatch):
    urls = [f"{SITE}/a", f"{SITE}/b"]
    calls = _serve(monkeypatch, urls)
    assert len(await GenericScrapePlugin(_row()).fetch()) == 2
    assert calls == urls


# --- the undated cap ----------------------------------------------------------


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_at_most_max_undated_pages_per_poll(monkeypatch):
    urls = [f"{SITE}/{n}" for n in range(6)]
    calls = _serve(monkeypatch, urls, dated=False)
    plugin = GenericScrapePlugin(_row())
    items = await plugin.fetch(max_undated=2)
    # The newest two (candidates are newest first).
    assert [i["url"] for i in items] == urls[:2]
    # The rest were read and passed over: marked, not fetched again.
    assert set(plugin._extracted_urls) == set(urls)
    assert await plugin.fetch(max_undated=2) == []
    assert calls == urls


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_the_undated_cap_defaults_to_the_ingest_knob(monkeypatch):
    urls = [f"{SITE}/{n}" for n in range(5)]
    _serve(monkeypatch, urls, dated=False)
    items = await GenericScrapePlugin(_row()).fetch()
    assert len(items) == ingest_rules.IngestTunables().max_undated_per_poll == 2


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_dated_pages_are_not_capped(monkeypatch):
    urls = [f"{SITE}/{n}" for n in range(6)]
    _serve(monkeypatch, urls, dated=True)
    assert len(await GenericScrapePlugin(_row()).fetch(max_undated=0)) == 6


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_undated_pages_below_a_stored_story_on_a_listing_page_are_backlog(monkeypatch):
    """A listing page is newest first, so an undated page below a stored
    story is older than it: dropped, the same rule ``ingest_rules``
    applies to every other feed type's later polls."""
    urls = [f"{SITE}/news/new", f"{SITE}/news/stored", f"{SITE}/news/old-1", f"{SITE}/news/old-2"]
    _serve(monkeypatch, urls, dated=False, listing=True)
    plugin = GenericScrapePlugin(_row(url=LISTING))
    items = await plugin.fetch(known_urls=_known({f"{SITE}/news/stored"}), max_undated=5)
    assert [i["url"] for i in items] == [f"{SITE}/news/new"]
    assert {f"{SITE}/news/old-1", f"{SITE}/news/old-2"} <= set(plugin._extracted_urls)


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_an_edited_story_at_the_top_of_a_sitemap_does_not_bury_a_new_page(monkeypatch):
    """A sitemap is in ``<lastmod>`` order, and editing a stored story
    moves it to the top. The new undated page below it is no older for
    that: it comes in, on a first fetch and on a later poll alike."""
    edited, new, stored = f"{SITE}/edited", f"{SITE}/new", f"{SITE}/stored"
    modified = {
        edited: NOW - dt.timedelta(minutes=5),
        new: NOW - dt.timedelta(hours=1),
        stored: NOW - dt.timedelta(days=3),
    }
    _serve(monkeypatch, [edited, new, stored], dated=False, modified=modified)
    known = _known({edited, stored})
    items = await GenericScrapePlugin(_row()).fetch(known_urls=known)
    assert [i["url"] for i in items] == [new]
    backlog_line = NOW - dt.timedelta(days=2)
    items = await GenericScrapePlugin(_row()).fetch(known_urls=known, backlog_before=backlog_line)
    assert [i["url"] for i in items] == [new]


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_an_undated_sitemap_page_last_modified_before_the_backlog_line_is_backlog(monkeypatch):
    """A page can't have been published after it last changed, so an
    undated page whose ``<lastmod>`` is older than the poll's backlog
    line is old backlog, wherever it sits (after a restart, the pages
    passed over before are read again)."""
    recent, old = f"{SITE}/recent", f"{SITE}/old"
    modified = {recent: NOW - dt.timedelta(hours=3), old: NOW - dt.timedelta(days=40)}
    _serve(monkeypatch, [old, recent], dated=False, modified=modified)
    plugin = GenericScrapePlugin(_row())
    items = await plugin.fetch(max_undated=5, backlog_before=NOW - dt.timedelta(days=2))
    assert [i["url"] for i in items] == [recent]
    assert old in plugin._extracted_urls
    # On a first fetch there is no backlog line yet: both come in.
    _serve(monkeypatch, [old, recent], dated=False, modified=modified)
    items = await GenericScrapePlugin(_row()).fetch(max_undated=5)
    assert [i["url"] for i in items] == [old, recent]


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_an_undated_sitemap_page_with_no_date_at_all_is_backlog_after_the_first_fetch(monkeypatch):
    """No publication date, no ``<lastmod>`` and an order that says
    nothing: such a page can't be told from old backlog, so only a first
    fetch takes it."""
    urls = [f"{SITE}/a", f"{SITE}/b"]
    _serve(monkeypatch, urls, dated=False)
    assert await GenericScrapePlugin(_row()).fetch(backlog_before=NOW - dt.timedelta(days=2)) == []
    assert [i["url"] for i in await GenericScrapePlugin(_row()).fetch()] == urls


# --- through scheduler._ingest ------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_passes_the_stored_url_lookup_and_the_undated_knob(
    db_session, offline_ingest, monkeypatch
):
    source = await make_source(db_session, "scraped_site", type="generic_scrape", url=f"{SITE}/sitemap.xml")
    await make_entry(db_session, source, "Already stored", url=f"{SITE}/stored")
    urls = [f"{SITE}/new-1", f"{SITE}/stored", f"{SITE}/new-2"]
    calls = _serve(monkeypatch, urls)

    summary = await scheduler._ingest(GenericScrapePlugin(source))

    assert summary["error"] is None
    assert calls == [f"{SITE}/new-1", f"{SITE}/new-2"]
    assert summary["inserted"] == 2
    stored = set((await db_session.scalars(select(Entry.url).where(Entry.source_id == source.id))).all())
    assert stored == set(urls)


@pytest.mark.asyncio
async def test_ingest_applies_the_undated_knob_inside_the_plugin(db_session, offline_ingest, monkeypatch):
    source = await make_source(db_session, "undated_site", type="generic_scrape", url=f"{SITE}/sitemap.xml")
    _serve(monkeypatch, [f"{SITE}/{n}" for n in range(4)], dated=False)

    async def one_undated():
        return ingest_rules.IngestTunables(max_undated_per_poll=1)

    monkeypatch.setattr(scheduler, "_ingest_tunables", one_undated)
    summary = await scheduler._ingest(GenericScrapePlugin(source))
    assert summary["error"] is None
    assert summary["fetched"] == 1
    assert summary["inserted"] == 1


@pytest.mark.asyncio
async def test_ingest_passes_the_polls_backlog_line(db_session, offline_ingest, monkeypatch):
    """No line on a feed's first fetch; after it, the line ``ingest_rules``
    draws for dated stories (the baseline's backfill window here, which
    is later than ``max_age_days``)."""
    source = await make_source(db_session, "lined_site", type="generic_scrape", url=f"{SITE}/sitemap.xml")
    _serve(monkeypatch, [f"{SITE}/first"])
    plugin = GenericScrapePlugin(source)
    real_fetch = plugin.fetch
    lines: list[dt.datetime | None] = []

    async def recording_fetch(**kwargs):
        lines.append(kwargs["backlog_before"])
        return await real_fetch(**kwargs)

    plugin.fetch = recording_fetch
    first = await scheduler._ingest(plugin)
    assert first["inserted"] == 1
    assert lines == [None]

    await db_session.refresh(source)
    _serve(monkeypatch, [f"{SITE}/second"])
    second = await scheduler._ingest(plugin)
    assert second["error"] is None
    baseline = source.created_at
    rules = ingest_rules.IngestTunables()
    assert lines[1] == baseline - dt.timedelta(hours=rules.backfill_hours)


@pytest.mark.asyncio
async def test_ingest_records_an_all_stored_poll_as_a_success(db_session, offline_ingest, monkeypatch):
    source = await make_source(db_session, "quiet_site", type="generic_scrape", url=f"{SITE}/sitemap.xml")
    await make_entry(db_session, source, "Only story", url=f"{SITE}/only")
    _serve(monkeypatch, [f"{SITE}/only"])
    summary = await scheduler._ingest(GenericScrapePlugin(source))
    assert summary["error"] is None
    assert summary["fetched"] == 0
    await db_session.refresh(source)
    assert source.last_error is None
    assert source.last_fetch_at is not None
