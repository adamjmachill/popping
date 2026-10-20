# Architecture Notes: In-Memory State & Single-Worker Constraint

## Overview

Popping's backend is designed for **single-process deployment**: one
`uvicorn` worker, one `AsyncIOScheduler` instance, one in-process
embedder. This document explains why, what state is process-local,
and what to change if you ever need multi-worker scaling.

## Process-Local State

The following in-memory state is **not shared across workers** and
will silently break if you run `uvicorn --workers > 1`:

| Location | Variable | Purpose |
|---|---|---|
| `app/scheduler.py` | `_scheduler` | The APScheduler instance — owns all cron/interval jobs |
| `app/scheduler.py` | `_brief_generator` | The BriefGenerator singleton |
| `app/scheduler.py` | `_last_queued` | Check now's per-feed cooldown: when `queue_check` last queued each feed (monotonic clock; entries older than `refresh.cooldown_seconds` are dropped on each call). A restart forgets it; the `last_fetch_at` half of the cooldown still applies |
| `app/scheduler.py` | `_reddit_calls_done_at` | Reddit direct mode: when the subreddits check-now has queued will have had their calls (one per 75 s), for `expected_done_s` |
| `app/scheduler.py` | `_ingest_running`, `_ingest_unrecorded`, `_ingest_finished` | Ingest runs in progress per job id, those that haven't written their result yet, and how many have returned (one count per job id that has run; never counted down). `queue_check` leaves a running job alone instead of moving it up (APScheduler would drop the run), and treats a job whose finished count moved while it read the rows as just checked |
| `app/sources/github_releases.py` | `_etag_cache` | Per-repo ETag cache for GitHub API 304s |
| `app/sources/dynamic_reddit.py` | `_warned_disabled` | One-shot warning dedup for disabled Reddit rows |
| `app/sources/generic_scrape.py` | `GenericScrapePlugin._extracted_urls` | Pages each website feed has already fetched (bounded FIFO, 5000 entries), so a page that isn't an article, is too old, is gone (404, 410) or is over the undated cap isn't fetched again. Stored pages are skipped through the scheduler's stored-URL lookup instead, so a restart only re-reads the pages that weren't kept. A refused page is left out, so the next check (for example after Read as Safari) asks for it again. A page read while the feed's `sitemap_url` gave no pages (its home page's links were read instead) is flagged, and read once more when that sitemap lists it. Each entry also records whether the page answered with a page (HTML); only those, besides stored stories and pages not tried yet, are fetched to check whether the site serves the feed when every page a check asked for was refused |
| `app/sources/generic_scrape.py` | `GenericScrapePlugin._deferred_new` | Pages a check left for a later one (refused, failed in a way that passes, or read while the feed's `sitemap_url` gave no pages) while they weren't old backlog, bounded FIFO, 1000 entries. Such a page isn't counted as backlog when it is read, even below a story stored in between. A restart forgets them |
| `app/sources/generic_scrape.py` | `GenericScrapePlugin._page_failures` | Consecutive failed checks per page whose fetch failed in a way that passes (a timeout, a network error, a 5xx), bounded FIFO, 1000 entries. Such a page is asked for again on the next check, and passed over (added to `_extracted_urls`) after 3 failed checks in a row. A restart starts the counts again |
| `app/source_preview.py` | `_slots` | The Add preview's concurrency limit (`asyncio.Semaphore(PREVIEW_CONCURRENCY)`, 2). No queue: a preview that finds both slots taken returns `busy` at once. A slot is held until the preview's pipeline task ends, not until its response is sent: the request waits on the task through `asyncio.shield` for at most the deadline (`PREVIEW_BUDGET_S`, 60 s), and on a timeout the response goes out with what is known while the task finishes in the background |
| `app/source_preview.py` | `_tasks` | Pipeline tasks still running, so a task that outlives its response isn't garbage-collected mid-flight |
| `app/source_preview.py` | `_cache` | What a preview fetched and parsed upstream, for `PREVIEW_CACHE_TTL_S` (120 s), at most `PREVIEW_CACHE_MAX` (32) entries, oldest dropped first. Keyed on the URL, type, sitemap URL, link pattern and a hash of the lower-cased, sorted request headers (no header values are kept). Only previews that worked are kept, and a task that outlived its response can still fill it. The duplicate and the stored / will-add / older counts are read from the database on every request, never cached |
| `app/thread_work.py` | `_running` (a context variable) | The parsing threads a preview started (feedparser, trafilatura, sitemap and listing parses, page scoring). A timeout or cancel stops only the `await`, never the thread, so the pipeline waits for every one of them (`drain`) before it ends and releases its slot: a parse that runs past the deadline keeps its slot until it finishes. Outside a preview, `run_in_thread` is `asyncio.to_thread` |
| `app/scoring/convergence.py` | process-level cache | 30s TTL convergence counts cache |
| `app/runtime_settings.py` | `_cache` | In-process app_settings cache |
| `app/request_state.py` | `_notifier` | Module-level notifier singleton |

## What Breaks

With N workers:
- **Scheduler fires N×**: each worker has its own `AsyncIOScheduler`,
  so every job runs N times per tick. Ingests duplicate (silently —
  the DB's `ON CONFLICT DO NOTHING` catches it), but brief generation,
  convergence alerts, and CVE notifications fire N times.
- **ETag cache is per-worker**: only the worker that saw the 304
  benefits from it; others re-fetch the full body.
- **`_extracted_urls` is per-worker**: each worker re-fetches the pages
  another worker already read and passed over. Stored pages are skipped
  on every worker (the stored-URL lookup reads the DB).
- **`_page_failures` is per-worker**: a page that keeps failing is passed
  over after 3 failed checks on each worker, not 3 in all.
- **`_deferred_new` is per-worker**: a page one worker left for later is
  judged by its place on another.
- **Convergence cache is per-worker**: N redundant SQL queries per
  30s window instead of 1.
- **`_warned_disabled` is per-worker**: N× the warning log lines.
- **The Add preview's limit and cache are per-worker**: N workers run
  up to 2×N previews at once, and a preview repeated on another worker
  fetches the site again.
- **Check now's state is per-worker**: a pull that lands on another
  worker skips the cooldown in `_last_queued` (the `last_fetch_at`
  check still holds), and that worker can't see a run in progress
  elsewhere, so it can move up a job that another worker is running.

## How to Fix (Future)

If multi-worker is needed:
1. Run the scheduler in one dedicated process (or take a Postgres
   advisory lock per job tick) so only one worker runs each job. A
   shared APScheduler job store alone does not prevent duplicate runs.
2. Move `_etag_cache` and `_extracted_urls` to a shared store (a DB
   table, or Redis if one is added back).
3. Move the convergence cache to the same shared store with a TTL.
4. The notifier singleton is already built from env on startup — no
   change needed, each worker builds its own (that's fine).

## Current Stance

The Dockerfile and `docker-compose.yml` are configured for a single
worker. The `--reload` flag in dev mode also implies a single worker.
Do NOT add `--workers N` to the uvicorn command without addressing
the above.