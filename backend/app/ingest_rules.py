"""Which fetched items an ingest keeps.

Pure: no I/O and no clock. ``scheduler._ingest`` reads the tunables
(``runtime_settings.get_many`` + ``parse_tunables``), runs its
known-URL query, decides whether this poll is a first fetch, and
passes all of that in.

Why it exists: a feed's first successful poll used to store its whole
back catalogue (often 100+ stories), and so did a feed that came back
after days of failures or a pause, and a feed whose address changed.
Each of those flooded its tab. The rules:

  - **First fetch** keeps the newest ``keep_first`` items (dated items
    newest first, then undated ones in feed order), plus every item
    dated within the last ``backfill_h`` hours.
  - **Later polls** drop items dated before ``baseline_at - backfill_h``
    (``baseline_at`` is when the feed's first fetch landed, so a
    backfill the first fetch left out doesn't trickle in later) or
    before ``now - max_age_d``. An undated item is kept only when it
    sits above the first already-stored URL in feed order (feeds and
    listings are newest-first, so anything below it is old backlog),
    and at most ``max_undated`` of those per poll, newest first.
  - Then ``per_poll`` caps how many new items one poll stores, newest
    first. The rest stay unknown, so a burst lands over the next polls
    instead of being lost.

Known URLs (already stored, by any feed) and repeats within the same
listing are not "dropped": they are duplicates, which the caller
counts. Everything the rules drop is counted in ``counts`` by reason.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Optional

# Reasons an item is dropped, as they appear in ``counts``.
FIRST_FETCH = "first_fetch"          # first fetch: not among the newest N, older than the backfill window
BEFORE_BASELINE = "before_baseline"  # later poll: dated before the first fetch's backfill window
TOO_OLD = "too_old"                  # later poll: dated before now - max_age_d
UNDATED = "undated"                  # later poll: undated and below the first known URL, or over the cap
PER_POLL = "per_poll"                # over this poll's cap; still unknown, so a later poll takes it


@dataclass(frozen=True)
class IngestTunables:
    first_fetch_keep: int = 10
    backfill_hours: int = 48
    max_age_days: int = 30
    max_per_poll: int = 50
    resume_gap_hours: int = 72
    max_undated_per_poll: int = 2


# runtime_settings key → (field, default, min, max). Out-of-range or
# non-numeric values fall back to the default, the same way
# ``BriefGenerator._resolve_window_hours`` treats ``brief.window_hours``.
# ``resume_gap_hours`` starts at 48: the longest poll interval a feed
# can have is 24 h (``routes/sources._REFRESH_MAX``), and a gap at or
# under that would turn every poll of a slow feed into a first fetch.
_TUNABLES: dict[str, tuple[str, int, int, int]] = {
    "ingest.first_fetch_keep": ("first_fetch_keep", 10, 1, 200),
    "ingest.backfill_hours": ("backfill_hours", 48, 1, 720),
    "ingest.max_age_days": ("max_age_days", 30, 1, 3650),
    "ingest.max_per_poll": ("max_per_poll", 50, 1, 1000),
    "ingest.resume_gap_hours": ("resume_gap_hours", 72, 48, 8760),
    "ingest.max_undated_per_poll": ("max_undated_per_poll", 2, 0, 100),
}
TUNABLE_KEYS: tuple[str, ...] = tuple(_TUNABLES)


def _parse_int(raw: Any, default: int, lo: int, hi: int) -> int:
    if raw is None or isinstance(raw, bool):
        return default
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if n < lo or n > hi:
        return default
    return n


def parse_tunables(raw: Mapping[str, Any]) -> IngestTunables:
    """Build the tunables from a ``runtime_settings.get_many`` result.
    A missing key, a non-number or a value out of range gives that
    knob's default."""
    values = {
        field: _parse_int(raw.get(key), default, lo, hi)
        for key, (field, default, lo, hi) in _TUNABLES.items()
    }
    return IngestTunables(**values)


def published_utc(value: Any) -> Optional[dt.datetime]:
    """An item's ``published_at`` as an aware UTC datetime, or None when
    it is missing or unreadable (the item then counts as undated).
    Naive datetimes are taken as UTC, as ``scoring.recency`` does."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, dt.datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _newest_first(cands: list[tuple[int, dict, Optional[dt.datetime]]]):
    """Dated items newest first, then undated ones in feed order. The
    sort is stable, so equal dates keep their feed order."""
    dated = sorted((c for c in cands if c[2] is not None), key=lambda c: c[2], reverse=True)
    undated = [c for c in cands if c[2] is None]
    return dated + undated


def select_items_for_ingest(
    items: Iterable[dict],
    *,
    known: set[str],
    first_fetch: bool,
    baseline_at: Optional[dt.datetime],
    now: dt.datetime,
    keep_first: int = 10,
    backfill_h: int = 48,
    max_age_d: int = 30,
    per_poll: int = 50,
    max_undated: int = 2,
) -> tuple[list[dict], dict[str, int]]:
    """Pick the items this poll stores.

    ``items`` are normalized items in feed order. ``known`` is the set
    of their URLs that are already stored. Returns ``(kept, counts)``:
    ``kept`` in feed order, ``counts`` the number dropped per reason
    (only reasons that dropped something appear).
    """
    items = list(items)
    counts: dict[str, int] = {}

    def drop(reason: str, n: int = 1) -> None:
        if n > 0:
            counts[reason] = counts.get(reason, 0) + n

    # New items only, first occurrence of each URL, with their feed
    # position. Known URLs and repeats are duplicates, not drops.
    first_known = len(items)
    seen: set[str] = set()
    cands: list[tuple[int, dict, Optional[dt.datetime]]] = []
    for idx, item in enumerate(items):
        url = item.get("url")
        if url in known:
            first_known = min(first_known, idx)
            continue
        if not url or url in seen:
            continue
        seen.add(url)
        cands.append((idx, item, published_utc(item.get("published_at"))))

    backfill = dt.timedelta(hours=backfill_h)
    survivors: list[tuple[int, dict, Optional[dt.datetime]]] = []
    if first_fetch:
        recent_from = now - backfill
        ranked = _newest_first(cands)
        for rank, cand in enumerate(ranked):
            when = cand[2]
            if rank < keep_first or (when is not None and when >= recent_from):
                survivors.append(cand)
            else:
                drop(FIRST_FETCH)
    else:
        # A feed always has a baseline once it is past its first fetch
        # (``sources.created_at`` is NOT NULL); the fallback only keeps
        # a caller that passes None from raising.
        baseline_from = (baseline_at - backfill) if baseline_at is not None else None
        oldest = now - dt.timedelta(days=max_age_d)
        undated_above: list[tuple[int, dict, Optional[dt.datetime]]] = []
        for cand in cands:
            idx, _item, when = cand
            if when is None:
                if idx < first_known:
                    undated_above.append(cand)
                else:
                    drop(UNDATED)
            elif baseline_from is not None and when < baseline_from:
                drop(BEFORE_BASELINE)
            elif when < oldest:
                drop(TOO_OLD)
            else:
                survivors.append(cand)
        # Feed order is newest first, so the topmost undated items are
        # the newest ones.
        survivors.extend(undated_above[:max_undated])
        drop(UNDATED, len(undated_above) - max_undated)

    ranked = _newest_first(survivors)
    drop(PER_POLL, len(ranked) - per_poll)
    keep_idx = {cand[0] for cand in ranked[:per_poll]}
    kept = [item for idx, item in enumerate(items) if idx in keep_idx]
    return kept, counts
