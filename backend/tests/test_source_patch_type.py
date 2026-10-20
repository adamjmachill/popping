"""PATCH ``type``: a dynamic feed switches how it is read.

Find its feed (PR11c) turns a website feed into the feed its page links
to, so ``PATCH /api/sources/{id}`` takes ``type``:

- only between ``rss``, ``podcast`` and ``generic_scrape``, both ways;
- never on a built-in, whose type is its plugin class;
- the URL is checked as the new type reads it;
- a change starts the feed over (``last_fetch_at`` null, a new
  baseline), clears the error fields and rebuilds the job with the new
  type's plugin;
- a poll of the old type still in flight stores nothing and records
  nothing (``_ingest``'s in-flight guard compares the type too).

URLs use example.com / example.org, answered by ``fake_dns`` so the SSRF
guard runs without network.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app import scheduler
from app.db import SessionLocal
from app.models import Source
from app.sources import list_sources
from app.sources.dynamic_rss import DynamicRssPlugin
from app.sources.generic_scrape import GenericScrapePlugin
from app.sources.podcast import DynamicPodcastPlugin
from ingest_harness import age_feed, entry_count, item, make_plugin, source_row

_PLUGIN_FOR = {
    "rss": DynamicRssPlugin,
    "podcast": DynamicPodcastPlugin,
    "generic_scrape": GenericScrapePlugin,
}


class _FakeScheduler:
    """Records the jobs ``update_source`` adds, with their plugin."""

    def __init__(self) -> None:
        self.added: list[object] = []

    def add_job(self, *args, **kwargs):
        self.added.append(kwargs["args"][0])

    def remove_job(self, *args, **kwargs):
        pass

    def get_job(self, *args, **kwargs):
        return None


@pytest.fixture
def jobs(monkeypatch):
    fake = _FakeScheduler()
    monkeypatch.setattr(scheduler, "_scheduler", fake)
    return fake


async def _create(app_client, type_: str, name: str, url: str = "https://example.com/feed.xml") -> dict:
    resp = await app_client.post(
        "/api/sources", json={"name": name, "type": type_, "category": "news", "url": url}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _fail(db_session, source_id: int) -> None:
    """Give the feed a failure streak and a last success."""
    await db_session.execute(
        text(
            "UPDATE sources SET last_error = '[blocked] HTTPStatusError: 403', error_count = 4, "
            "last_fetch_at = now() - interval '2 hours', created_at = now() - interval '10 days' "
            "WHERE id = :id"
        ),
        {"id": source_id},
    )
    await db_session.commit()


async def _row(db_session, source_id: int) -> Source:
    db_session.expire_all()
    return await db_session.scalar(select(Source).where(Source.id == source_id))


@pytest.mark.parametrize(
    "old,new",
    [
        ("generic_scrape", "rss"),
        ("rss", "generic_scrape"),
        ("rss", "podcast"),
        ("podcast", "generic_scrape"),
    ],
)
async def test_allowed_type_change_starts_the_feed_over(app_client, fake_dns, db_session, jobs, old, new):
    created = await _create(app_client, old, f"retype_{old}_{new}")
    await _fail(db_session, created["id"])
    # Read out now: the session's row object is refreshed below.
    old_baseline = (await _row(db_session, created["id"])).created_at
    jobs.added.clear()

    resp = await app_client.patch(f"/api/sources/{created['id']}", json={"type": new})
    assert resp.status_code == 200, resp.text
    assert resp.json()["type"] == new

    row = await _row(db_session, created["id"])
    assert row.type == new
    assert row.last_fetch_at is None
    assert row.created_at > old_baseline
    assert row.last_error is None
    assert row.error_count == 0
    # The job now holds the new type's plugin, built from the edited row.
    assert len(jobs.added) == 1
    assert type(jobs.added[0]) is _PLUGIN_FOR[new]
    assert jobs.added[0].fetch_target[0] == new


async def test_type_and_url_change_together(app_client, fake_dns, db_session, jobs):
    """Find its feed sends both: the website feed becomes the feed it
    found."""
    created = await _create(app_client, "generic_scrape", "retype_with_url", url="https://example.com/news")
    resp = await app_client.patch(
        f"/api/sources/{created['id']}",
        json={"type": "rss", "url": "https://example.com/news/feed.xml", "sitemap_url": None, "link_pattern": None},
    )
    assert resp.status_code == 200, resp.text
    row = await _row(db_session, created["id"])
    assert (row.type, row.url) == ("rss", "https://example.com/news/feed.xml")
    assert type(jobs.added[-1]) is DynamicRssPlugin


@pytest.mark.parametrize(
    "old,new,url",
    [
        ("rss", "reddit", "https://example.com/feed.xml"),
        ("rss", "youtube_channel", "https://example.com/feed.xml"),
        ("rss", "nonsense", "https://example.com/feed.xml"),
        ("reddit", "rss", "r/python"),
    ],
)
async def test_other_type_pairs_are_refused(app_client, fake_dns, db_session, jobs, old, new, url):
    created = await _create(app_client, old, f"retype_refused_{old}_{new}", url=url)
    last_fetch = (await _row(db_session, created["id"])).last_fetch_at
    jobs.added.clear()

    resp = await app_client.patch(f"/api/sources/{created['id']}", json={"type": new})
    assert resp.status_code == 422, resp.text
    row = await _row(db_session, created["id"])
    assert row.type == old
    assert row.last_fetch_at == last_fetch
    assert jobs.added == []


async def test_a_youtube_row_keeps_its_type(app_client, db_session, jobs):
    # Inserted directly: creating one resolves through YouTube.
    row = Source(
        name="retype_youtube",
        type="youtube_channel",
        category="video",
        url="https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012",
    )
    db_session.add(row)
    await db_session.commit()
    resp = await app_client.patch(f"/api/sources/{row.id}", json={"type": "rss"})
    assert resp.status_code == 422
    assert (await _row(db_session, row.id)).type == "youtube_channel"


async def test_same_type_is_no_change(app_client, fake_dns, db_session, jobs):
    created = await _create(app_client, "rss", "retype_same")
    await _fail(db_session, created["id"])
    last_fetch = (await _row(db_session, created["id"])).last_fetch_at
    jobs.added.clear()

    resp = await app_client.patch(f"/api/sources/{created['id']}", json={"type": "rss"})
    assert resp.status_code == 200
    row = await _row(db_session, created["id"])
    assert last_fetch is not None
    assert row.last_fetch_at == last_fetch
    assert row.error_count == 4
    assert jobs.added == []


async def test_built_ins_refuse_a_type_change(app_client, db_session, jobs):
    for plugin in list_sources().values():
        row = await scheduler._upsert_source(db_session, plugin)
        new = "generic_scrape" if row.type != "generic_scrape" else "rss"
        resp = await app_client.patch(f"/api/sources/{row.id}", json={"type": new})
        assert resp.status_code == 400, (row.name, resp.text)
        assert (await _row(db_session, row.id)).type == row.type
    assert jobs.added == []


async def test_update_source_itself_refuses_a_built_in_type_change(db_session):
    plugin = next(iter(list_sources().values()))
    row = await scheduler._upsert_source(db_session, plugin)
    async with SessionLocal() as session:
        with pytest.raises(ValueError):
            await scheduler.update_source(session, row.id, type_="generic_scrape")
    assert (await _row(db_session, row.id)).type == row.type


async def test_the_url_is_checked_as_the_new_type(app_client, fake_dns, db_session, jobs):
    created = await _create(app_client, "rss", "retype_url_check")
    # A new URL on a private host is refused, whatever the type.
    resp = await app_client.patch(
        f"/api/sources/{created['id']}", json={"type": "generic_scrape", "url": "https://evil.internal/news"}
    )
    assert resp.status_code == 422
    assert (await _row(db_session, created["id"])).type == "rss"

    # A type change alone checks the stored URL: one that no longer
    # resolves to a public host (here written straight to the row) can't
    # become a website feed.
    await db_session.execute(
        text("UPDATE sources SET url = 'https://evil.internal/feed' WHERE id = :id"), {"id": created["id"]}
    )
    await db_session.commit()
    resp = await app_client.patch(f"/api/sources/{created['id']}", json={"type": "generic_scrape"})
    assert resp.status_code == 422
    assert (await _row(db_session, created["id"])).type == "rss"


# --- a poll of the old type still in flight -------------------------------------------


@pytest.fixture
def _no_live_scheduler(monkeypatch):
    monkeypatch.setattr(scheduler, "_scheduler", None)


async def test_type_change_during_an_in_flight_poll_inserts_nothing(
    db_session, offline_ingest, _no_live_scheduler
):
    plugin = make_plugin("retype_in_flight")
    plugin.items = [item(n, hours_ago=1 + n) for n in range(3)]
    assert (await scheduler._ingest(plugin))["inserted"] == 3
    await age_feed(db_session, plugin.name, hours=10 * 24, last_fetch_hours=1)
    before = await source_row(db_session, plugin.name)

    class _Retyped(plugin):
        async def fetch(self):
            # The user switches the feed's type while it is being read.
            async with SessionLocal() as session:
                await scheduler.update_source(session, before.id, type_="generic_scrape")
            return [item(100 + n, hours_ago=1 + n) for n in range(5)]

    _Retyped.name = plugin.name
    summary = await scheduler._ingest(_Retyped)
    assert summary["inserted"] == 0
    assert await entry_count(db_session, plugin.name) == 3
    row = await source_row(db_session, plugin.name)
    assert row.type == "generic_scrape"
    # The bookkeeping was skipped too: the reset stands.
    assert row.last_fetch_at is None


async def test_job_still_holding_the_old_types_plugin_inserts_nothing(
    db_session, offline_ingest, _no_live_scheduler
):
    """The job's plugin was built before the type change (``update_source``
    replaces it only after its commit), so the guard compares the
    plugin's own type, not a fresh read of the row. Its failure isn't
    recorded against the new type either."""
    async with SessionLocal() as session:
        row = Source(name="retype_stale_plugin", type="rss", category="news", url="https://old.test/feed")
        session.add(row)
        await session.commit()
        await session.refresh(row)
    old_plugin = DynamicRssPlugin(row)
    items = [item(n, hours_ago=1 + n, host="old.test") for n in range(3)]

    async def fetch() -> list[dict]:
        return list(items)

    old_plugin.fetch = fetch
    assert (await scheduler._ingest(old_plugin))["inserted"] == 3

    async with SessionLocal() as session:
        await scheduler.update_source(session, row.id, type_="generic_scrape")

    items[:] = [item(50 + n, hours_ago=1 + n, host="old.test") for n in range(5)]
    assert (await scheduler._ingest(old_plugin))["inserted"] == 0
    assert await entry_count(db_session, row.name) == 3

    async def broken() -> list[dict]:
        raise RuntimeError("the old type's fetch failed")

    old_plugin.fetch = broken
    await scheduler._ingest(old_plugin)
    after = await source_row(db_session, row.name)
    assert after.last_error is None
    assert after.error_count == 0
    assert after.last_fetch_at is None
