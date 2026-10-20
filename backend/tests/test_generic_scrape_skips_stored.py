"""PR10b: a website feed skips stored pages before fetching them, and
caps undated pages the way the ingest rules cap every other feed.

``scheduler._ingest`` hands a ``GenericScrapePlugin`` a ``known_urls``
lookup (its known-URL query, in its own session) and the
``ingest.max_undated_per_poll`` knob. The plugin asks which candidates
are already stored and never fetches those, even after a restart has
emptied its in-memory ``_extracted_urls``. A poll whose candidates are
all stored is a quiet success, not ``[no list]``.
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


def _serve(monkeypatch, urls: list[str], *, dated: bool = True) -> list[str]:
    """The sitemap lists ``urls`` (newest first); every page extracts as
    an article, dated now unless ``dated`` is False. Returns the list of
    pages ``_extract_one`` was asked for."""
    calls: list[str] = []

    async def fake_discover(url, limit=200, path_prefix=None, **kwargs):
        return [Candidate(u, None, None) for u in urls]

    async def fake_extract(url, custom_headers=None, **kwargs):
        calls.append(url)
        return {"title": f"Story {url}", "url": url, "published_at": NOW if dated else None}

    monkeypatch.setattr(generic_scrape, "discover_sitemap_entries", fake_discover)
    monkeypatch.setattr(generic_scrape, "_extract_one", fake_extract)
    return calls


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
async def test_undated_pages_below_a_stored_story_are_backlog(monkeypatch):
    """Candidates are newest first, so an undated page below a stored
    story is older than it: dropped, the same rule ``ingest_rules``
    applies to every other feed type's later polls."""
    urls = [f"{SITE}/new", f"{SITE}/stored", f"{SITE}/old-1", f"{SITE}/old-2"]
    _serve(monkeypatch, urls, dated=False)
    plugin = GenericScrapePlugin(_row())
    items = await plugin.fetch(known_urls=_known({f"{SITE}/stored"}), max_undated=5)
    assert [i["url"] for i in items] == [f"{SITE}/new"]
    assert {f"{SITE}/old-1", f"{SITE}/old-2"} <= set(plugin._extracted_urls)


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
