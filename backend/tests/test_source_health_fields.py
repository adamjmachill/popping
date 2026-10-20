"""Feed health bookkeeping (migration 0031): every check that records an
outcome stamps ``last_attempt_at``.

``last_attempt_at`` is when the feed's last check finished, whatever it
found: a success, a failure, or a setup state (``[no list]``,
``[reddit off]``). A success also writes ``last_item_count`` (what the
feed listed, before the ingest rules cut it) and ``last_new_count``
(the stories it stored). Check now's caller (PR9b) waits on
``last_attempt_at >= queued_at``, so a run that records nothing (a
paused feed, a feed re-pointed mid-fetch) must not stamp either.
"""

from __future__ import annotations

import httpx
from sqlalchemy import update

from app import scheduler
from app.config import settings
from app.db import SessionLocal
from app.models import Source
from app.sources.base import NoArticleListError
from app.sources.dynamic_reddit import DynamicRedditPlugin
from app.sources.dynamic_rss import DynamicRssPlugin
from factories import make_source
from ingest_harness import item, make_plugin, source_row, utcnow


async def test_a_success_stamps_the_attempt_and_the_counts(db_session, offline_ingest):
    plugin = make_plugin("hf_success")
    # A first fetch of 15 stories from last week: the rules keep the
    # newest 10.
    plugin.items = [item(n, hours_ago=100 + n) for n in range(15)]
    start = utcnow()

    summary = await scheduler._ingest(plugin)

    assert summary["inserted"] == 10
    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at >= start
    # One stamp for a success: the same instant.
    assert row.last_attempt_at == row.last_fetch_at
    assert row.last_item_count == 15
    assert row.last_new_count == 10
    assert row.last_error is None


async def test_a_later_poll_of_known_stories_counts_none_new(db_session, offline_ingest):
    plugin = make_plugin("hf_known")
    plugin.items = [item(n, hours_ago=1 + n) for n in range(4)]
    await scheduler._ingest(plugin)
    first = (await source_row(db_session, plugin.name)).last_attempt_at

    await scheduler._ingest(plugin)

    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at > first
    assert (row.last_item_count, row.last_new_count) == (4, 0)


async def test_an_empty_success_counts_zero(db_session, offline_ingest):
    plugin = make_plugin("hf_empty")
    plugin.items = []
    start = utcnow()

    await scheduler._ingest(plugin)

    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at >= start
    assert (row.last_item_count, row.last_new_count) == (0, 0)


async def test_a_failure_stamps_the_attempt_and_keeps_the_last_counts(db_session, offline_ingest):
    plugin = make_plugin("hf_failure")
    plugin.items = [item(n, hours_ago=1 + n) for n in range(3)]
    await scheduler._ingest(plugin)
    ok = await source_row(db_session, plugin.name)

    async def _refused(self):
        raise httpx.ConnectError("refused")

    plugin.fetch = _refused
    start = utcnow()
    summary = await scheduler._ingest(plugin)

    assert summary["error"].startswith("[network]")
    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at >= start
    assert row.last_attempt_at > row.last_fetch_at
    # The last success is still the last success.
    assert row.last_fetch_at == ok.last_fetch_at
    assert (row.last_item_count, row.last_new_count) == (3, 3)
    assert row.error_count == 1
    assert row.last_error.startswith("[network]")


async def test_a_first_check_that_fails_leaves_the_counts_null(db_session, offline_ingest):
    plugin = make_plugin("hf_first_fails")

    async def _blocked(self):
        request = httpx.Request("GET", self.url)
        raise httpx.HTTPStatusError("403", request=request, response=httpx.Response(403, request=request))

    plugin.fetch = _blocked
    start = utcnow()
    await scheduler._ingest(plugin)

    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at >= start
    assert row.last_fetch_at is None
    assert (row.last_item_count, row.last_new_count) == (None, None)
    assert row.last_error.startswith("[blocked]")


async def test_no_list_stamps_the_attempt(db_session, offline_ingest):
    plugin = make_plugin("hf_no_list")

    async def _no_list(self):
        raise NoArticleListError("no sitemap and no matching links")

    plugin.fetch = _no_list
    start = utcnow()
    summary = await scheduler._ingest(plugin)

    assert summary["error"].startswith("[no list]")
    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at >= start
    assert row.last_error.startswith("[no list] NoArticleListError")
    assert row.error_count == 0


async def test_reddit_off_stamps_the_attempt_without_fetching(db_session, offline_ingest, monkeypatch):
    monkeypatch.setattr(settings, "reddit_hydra_url", "")
    monkeypatch.setattr(settings, "reddit_direct_disabled", True)
    calls: list[str] = []

    async def _fetch(self):
        calls.append(self.name)
        return []

    monkeypatch.setattr(DynamicRedditPlugin, "fetch", _fetch)
    row = await make_source(db_session, "hf_reddit_off", type="reddit", url="r/python")
    start = utcnow()

    summary = await scheduler._ingest(DynamicRedditPlugin(row))

    assert calls == []
    assert summary["error"].startswith("[reddit off] RedditDisabledError")
    row = await source_row(db_session, "hf_reddit_off")
    assert row.last_attempt_at >= start
    assert row.last_error.startswith("[reddit off]")
    assert row.error_count == 0


async def test_a_paused_feed_records_nothing(db_session, offline_ingest):
    plugin = make_plugin("hf_paused")
    plugin.items = [item(0, hours_ago=1)]
    await make_source(db_session, plugin.name, url=plugin.url, active=False)

    summary = await scheduler._ingest(plugin)

    assert summary["status"] == "paused"
    assert summary["fetched"] == 0
    row = await source_row(db_session, plugin.name)
    assert row.last_attempt_at is None
    assert row.last_item_count is None


async def test_a_failure_from_an_address_the_feed_no_longer_has_records_nothing(
    db_session, offline_ingest
):
    """The fetch fails after the feed was re-pointed: the error belongs
    to the old address. Recording it would count a failure (and a
    backoff) against the new one, and its stamp would tell a Check now
    waiting on the new address that it had been checked."""
    row = await make_source(db_session, "hf_repointed", url="https://old.test/feed")
    plugin = DynamicRssPlugin(row)

    async def _repoint_then_fail(self):
        async with SessionLocal() as session:
            await session.execute(
                update(Source).where(Source.id == row.id).values(url="https://new.test/feed")
            )
            await session.commit()
        raise httpx.ConnectError("old host refused")

    plugin.fetch = _repoint_then_fail.__get__(plugin)
    summary = await scheduler._ingest(plugin)

    assert summary["error"].startswith("[network]")
    after = await source_row(db_session, "hf_repointed")
    assert after.url == "https://new.test/feed"
    assert after.last_attempt_at is None
    assert after.last_error is None
    assert after.error_count == 0


async def test_a_failure_from_the_current_address_is_recorded(db_session, offline_ingest):
    # The same dynamic path with no edit: the guard above doesn't drop
    # an ordinary failure.
    row = await make_source(db_session, "hf_dynamic_fail", url="https://same.test/feed")
    plugin = DynamicRssPlugin(row)

    async def _fail(self):
        raise httpx.ReadTimeout("slow")

    plugin.fetch = _fail.__get__(plugin)
    start = utcnow()
    await scheduler._ingest(plugin)

    after = await source_row(db_session, "hf_dynamic_fail")
    assert after.last_attempt_at >= start
    assert after.last_error.startswith("[network]")
    assert after.error_count == 1
