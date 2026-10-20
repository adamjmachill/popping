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
| `app/sources/generic_scrape.py` | `GenericScrapePlugin._extracted_urls` | Per-source URL dedup (bounded FIFO, 5000 entries) |
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
- **`_extracted_urls` is per-worker**: each worker re-attempts URLs
  the DB already has (silently no-op'd by `ON CONFLICT DO NOTHING`).
- **Convergence cache is per-worker**: N redundant SQL queries per
  30s window instead of 1.
- **`_warned_disabled` is per-worker**: N× the warning log lines.
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