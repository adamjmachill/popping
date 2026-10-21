// What a tab shows and in what order (PR3b, D3 and D4). No imports (see
// feedRules.ts), so the unit tests run it under strip-types.
//
// A tab is a snapshot of its stories, taken when the tab opens (or is
// reset): the ones not seen yet, in the tab's order, then "You're all
// caught up", then the seen ones under "Earlier (N)". Once taken, a
// snapshot doesn't move while you read:
// - a story keeps its group and its place once it is seen (opening it
//   uses it up, but the list stays still until the next snapshot);
// - a story that arrives with a poll goes at the end of the unseen ones,
//   and waits while the marker is above the screen (``hold``): Safari has
//   no scroll anchoring, so a card added above what you are reading would
//   push it down;
// - a story a poll no longer returns stays, drawn from the copy kept here,
//   until the next snapshot;
// - only ``isRemoved`` takes a story out at once (a hide, a deleted feed),
//   and only while it holds, so an Undo puts the story back in its place.
// App resets a snapshot on a tab switch, Refresh, Mark all and its Undo,
// and coming back after 10 minutes away (C1); a change of the tab's order
// (its sort; its window from PR4d) starts a new one by itself. Polls never
// reset one.

/** What the read model needs of a story. */
export type Item = { id: number; fetched_at: string | null }

export type Snapshot<E extends Item> = {
  /** Bumped by every new snapshot of the tab (Column folds Earlier again
   *  and starts its batches over when it changes). */
  generation: number
  /** The tab's order this snapshot was taken in. */
  order: string
  unseen: number[]
  earlier: number[]
  /** Arrivals waiting while the marker is above the screen. */
  held: number[]
  /** The latest copy of every story in the snapshot. */
  cache: Map<number, E>
  /** The arrays the last call returned, handed out again while equal. */
  out: { unseen: E[]; earlier: E[] } | null
}

export type Partition<E extends Item> = {
  /** The unseen group as drawn: snapshot order, arrivals at the end. */
  unseen: E[]
  /** The seen ones, under the marker. */
  earlier: E[]
  snapshot: Snapshot<E>
  /** Unseen-group stories not seen yet, held arrivals and stories a poll
   *  dropped included: the tab's badge, the marker and C8 count these. */
  unseenCount: number
  /** Those stories' ids: what Mark all marks. */
  unseenIds: number[]
}

export type PartitionInput<E extends Item> = {
  /** The tab's stories, in the tab's order. */
  entries: readonly E[]
  isSeen: (e: E) => boolean
  /** Hidden, or from a deleted feed (and from PR5b a muted one). */
  isRemoved?: (e: E) => boolean
  /** The tab's order (its sort, from PR4d its window too); a new one
   *  starts a new snapshot. */
  order: string
  snapshot?: Snapshot<E> | null
  /** The marker is above the screen: arrivals wait. */
  hold?: boolean
  /** Start a new snapshot. */
  reset?: boolean
  /** Seen, its mark not written yet (PR3c: a story seen on scroll waits
   *  in App's collector for a moment). Placed as seen: a new snapshot,
   *  or an arrival, puts it under the marker, where its mark keeps it
   *  once it lands (ids keep their group). The counts wait for the mark,
   *  so one written batch is one change of the badge. */
  isPending?: (e: E) => boolean
}

const keepAll = () => false

/** One tab's stories split into unseen and Earlier, from its snapshot. */
export function partitionTab<E extends Item>(input: PartitionInput<E>): Partition<E> {
  const { entries, isSeen, order, isPending } = input
  const isRemoved = input.isRemoved ?? keepAll
  // Where a story goes when it is placed: under the marker once seen, or
  // seen and still waiting for its mark.
  const placedSeen = isPending ? (e: E) => isSeen(e) || isPending(e) : isSeen
  const prev = input.snapshot ?? null
  let snap: Snapshot<E>
  if (!prev || input.reset || prev.order !== order) {
    const cache = new Map<number, E>()
    const unseen: number[] = []
    const earlier: number[] = []
    for (const e of entries) {
      if (cache.has(e.id)) continue
      cache.set(e.id, e)
      ;(placedSeen(e) ? earlier : unseen).push(e.id)
    }
    snap = { generation: (prev?.generation ?? 0) + 1, order, unseen, earlier, held: [], cache, out: prev?.out ?? null }
  } else {
    const cache = new Map(prev.cache)
    const known = new Set<number>([...prev.unseen, ...prev.earlier, ...prev.held])
    const unseen = [...prev.unseen]
    const earlier = [...prev.earlier]
    let held = [...prev.held]
    for (const e of entries) {
      // The latest copy (a poll replaces a story whose summary, score or
      // comment count changed).
      cache.set(e.id, e)
      if (known.has(e.id)) continue
      known.add(e.id)
      // A story that comes in already seen (marked on another device
      // first) isn't new: it goes under the marker, at the end.
      if (placedSeen(e)) earlier.push(e.id)
      else held.push(e.id)
    }
    if (!input.hold && held.length) {
      unseen.push(...held)
      held = []
    }
    snap = { generation: prev.generation, order, unseen, earlier, held, cache, out: prev.out }
  }

  const draw = (ids: readonly number[]) => {
    const out: E[] = []
    for (const id of ids) {
      const e = snap.cache.get(id)
      if (e && !isRemoved(e)) out.push(e)
    }
    return out
  }
  let unseen = draw(snap.unseen)
  let earlier = draw(snap.earlier)
  if (snap.out && sameItems(snap.out.unseen, unseen)) unseen = snap.out.unseen
  if (snap.out && sameItems(snap.out.earlier, earlier)) earlier = snap.out.earlier
  snap.out = { unseen, earlier }

  const unseenIds: number[] = []
  for (const id of [...snap.unseen, ...snap.held]) {
    const e = snap.cache.get(id)
    if (e && !isRemoved(e) && !isSeen(e)) unseenIds.push(id)
  }
  return { unseen, earlier, snapshot: snap, unseenCount: unseenIds.length, unseenIds }
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** How many of a tab's stories aren't seen: the badge of a tab that has
 *  no snapshot (one that isn't on screen). */
export function countUnseen<E extends Item>(entries: readonly E[], isSeen: (e: E) => boolean): number {
  const ids = new Set<number>()
  for (const e of entries) if (!isSeen(e)) ids.add(e.id)
  return ids.size
}

// D33: on the first load of the read model, a device counts the stories
// fetched more than this long before it as seen, so no tab opens at 99+.
export const BASELINE_MS = 48 * 60 * 60 * 1000

/** Seen: marked (``ids``: every ``seen:*`` and legacy ``read_entries:*``
 *  row), or fetched more than ``BASELINE_MS`` before this device's first
 *  load (D33; ``firstRunAt`` null: no baseline). */
export function seenTest(ids: ReadonlySet<number>, firstRunAt: number | null): (e: Item) => boolean {
  const cutoff = firstRunAt == null || !Number.isFinite(firstRunAt) ? null : firstRunAt - BASELINE_MS
  return (e) => {
    if (ids.has(e.id)) return true
    if (cutoff == null || !e.fetched_at) return false
    const t = Date.parse(e.fetched_at)
    return Number.isFinite(t) && t < cutoff
  }
}

/** The preference key a story's seen mark goes under: its category's,
 *  wherever it was seen (so a custom tab needs no key of its own). */
export function seenKey(category: string): `seen:${string}` {
  return `seen:${category}`
}

export type TabCount = { key: string; label: string; count: number }

/** C8: the first tab after ``current`` in strip order (wrapping round)
 *  with stories not seen yet, or null when every other tab is at 0. The
 *  caller passes the shown tabs (never the hidden ones) that have a
 *  count: not Brief, not Saved. */
export function nextTab(tabs: readonly TabCount[], current: string): TabCount | null {
  const at = tabs.findIndex((t) => t.key === current)
  for (let i = 1; i <= tabs.length; i++) {
    const t = tabs[(at + i + tabs.length) % tabs.length]
    if (t.key !== current && t.count > 0) return t
  }
  return null
}
