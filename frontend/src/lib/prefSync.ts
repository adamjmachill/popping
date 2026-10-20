// Preferences sync by change, not by overwrite (PR2b). No imports, no
// React and no DOM (see feedRules.ts): the provider (preferences.tsx)
// hands in the requests, the clock, the timers and the page's
// visibility, so the unit tests run every rule under strip-types.
//
// Set keys (saves, hides, votes, read and seen marks) are written as
// changes: PATCH ``{add, remove}``, or ``{set}`` for votes. The server
// applies a change under a row lock (routes/preferences.py), so two
// devices, or two taps in one tick, both land; a whole-list PUT would
// let the later list drop the earlier one's change. The other keys (a
// tab's sort, its section folds, saved views) are small whole values
// and stay PUT.
//
// What the screen shows for a key is the server's value (``base``: the
// last one adopted, from a GET or from a write's response) with every
// write not yet acknowledged applied on top, oldest first: those given
// up on (sync rule 4) until the next answer about the key, those on the
// way, then the one still queued. A GET can be older than a write the
// server already took, so a GET's row is ignored for a key that has a
// write on the way, or one that settled after the GET was sent (request
// sequence numbers, not clocks).

// ---------------------------------------------------------------------------
// Keys and caps.
// ---------------------------------------------------------------------------

// The most each set key holds. Pinned against the server's
// ``SET_KEY_CAPS`` by backend/tests/test_preferences_delta.py, which reads
// this file. The server trims to the same caps (smallest id first) as a
// backstop; the client prunes first (``pruneIds``) and sends what it
// drops in the same PATCH.
export const MAX_HIDDEN = 1000
export const MAX_STARRED = 1000
// Votes accumulate one story at a time, so they get more headroom than
// saves and hides (deliberate actions).
export const MAX_VOTED = 2000
// Each ``read_entries:<column>`` and ``seen:<category>`` key.
export const MAX_READ_PER_KEY = 1000

export const VOTES_KEY = 'voted_entries'
const SUFFIXED_SET_KEYS = ['read_entries:', 'seen:']

/** A key whose value is a set of story ids (or, for ``voted_entries``,
 *  a map of story id to vote): it is written by PATCH. */
export function isSetKey(key: string): boolean {
  if (key === 'starred_entries' || key === 'hidden_entries' || key === VOTES_KEY) return true
  return SUFFIXED_SET_KEYS.some((p) => key.startsWith(p) && key.length > p.length)
}

export function isVoteKey(key: string): boolean {
  return key === VOTES_KEY
}

/** The cap of a set key, null for any other key. */
export function capFor(key: string): number | null {
  if (key === 'starred_entries') return MAX_STARRED
  if (key === 'hidden_entries') return MAX_HIDDEN
  if (key === VOTES_KEY) return MAX_VOTED
  return isSetKey(key) ? MAX_READ_PER_KEY : null
}

// ---------------------------------------------------------------------------
// Values and changes.
// ---------------------------------------------------------------------------

export type Vote = 'up' | 'down'
export type VoteMap = Record<string, Vote>
/** A PATCH body for an id-set key. Each id is in one list at most. */
export type IdDelta = { add: number[]; remove: number[] }
/** A PATCH body for ``voted_entries``: ``null`` clears a vote. */
export type VoteDelta = { set: Record<string, Vote | null> }
export type Delta = IdDelta | VoteDelta
/** One write to a key: a change (set keys), or a whole value or a
 *  delete (the other keys). */
export type Write = { op: 'patch'; delta: Delta } | { op: 'put'; value: unknown } | { op: 'delete' }
/** A row as the server sends it. */
export type PrefRow = { key: string; value: unknown; updated_at: string }
/** Key -> value. Set keys hold clean values (``coerceIds``,
 *  ``coerceVotes``); the others hold what the server sent. */
export type Rows = Readonly<Record<string, unknown>>

const isId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0
const VOTE_ID_RE = /^[1-9][0-9]*$/
const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)

/** A stored id list as clean ids: positive integers, each once, in
 *  stored order. Anything that isn't a list is empty. The same array
 *  when it was already clean. */
export function coerceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  let clean = true
  for (const x of value) {
    if (!isId(x) || seen.has(x)) {
      clean = false
      break
    }
    seen.add(x)
  }
  if (clean) return value as number[]
  seen.clear()
  const out: number[] = []
  for (const x of value) {
    if (isId(x) && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

/** Stored votes as ``{"<id>": "up" | "down"}``; the same object when it
 *  was already clean. */
export function coerceVotes(value: unknown): VoteMap {
  if (!isPlainObject(value)) return {}
  const entries = Object.entries(value)
  if (entries.every(([k, v]) => VOTE_ID_RE.test(k) && (v === 'up' || v === 'down'))) return value as VoteMap
  const out: VoteMap = {}
  for (const [k, v] of entries) if (VOTE_ID_RE.test(k) && (v === 'up' || v === 'down')) out[k] = v
  return out
}

/** A server value as the screen keeps it: set keys cleaned, the rest as
 *  sent. */
export function normalizeValue(key: string, value: unknown): unknown {
  if (!isSetKey(key)) return value
  return isVoteKey(key) ? coerceVotes(value) : coerceIds(value)
}

/** Deep equality for JSON values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]))
  }
  return false
}

/** What turns ``prev`` into ``next``, as a change. */
export function diffIds(prev: readonly number[], next: readonly number[]): IdDelta {
  const before = new Set(prev)
  const after = new Set(next)
  return {
    add: next.filter((id) => !before.has(id)),
    remove: prev.filter((id) => !after.has(id)),
  }
}

const isVoteDelta = (d: Delta): d is VoteDelta => 'set' in d

/** ``older`` then ``newer`` as one change; for each id the later op wins.
 *  Within one change ``remove`` applies before ``add``, as on the
 *  server. */
export function foldDelta(older: Delta, newer: Delta): Delta {
  if (isVoteDelta(older) || isVoteDelta(newer)) {
    return { set: { ...(isVoteDelta(older) ? older.set : {}), ...(isVoteDelta(newer) ? newer.set : {}) } }
  }
  const ops = new Map<number, 'add' | 'remove'>()
  const op = (id: number, o: 'add' | 'remove') => {
    ops.delete(id)
    ops.set(id, o)
  }
  for (const d of [older, newer]) {
    for (const id of d.remove) op(id, 'remove')
    for (const id of d.add) op(id, 'add')
  }
  const out: IdDelta = { add: [], remove: [] }
  for (const [id, o] of ops) out[o].push(id)
  return out
}

const isEmptyDelta = (d: Delta): boolean =>
  isVoteDelta(d) ? Object.keys(d.set).length === 0 : d.add.length === 0 && d.remove.length === 0

/** ``ids`` with ``delta`` applied: ``remove`` first, then ``add`` (new
 *  ids at the end). The same array when nothing changed. */
export function applyIdDelta(ids: readonly number[], delta: IdDelta): number[] {
  let out = ids as number[]
  if (delta.remove.length) {
    const rm = new Set(delta.remove)
    const kept = out.filter((id) => !rm.has(id))
    if (kept.length !== out.length) out = kept
  }
  let present: Set<number> | null = null
  for (const id of delta.add) {
    present ??= new Set(out)
    if (present.has(id)) continue
    if (out === ids) out = [...ids]
    out.push(id)
    present.add(id)
  }
  return out
}

/** ``votes`` with ``delta`` applied (``null`` clears). The same object
 *  when nothing changed. */
export function applyVoteDelta(votes: VoteMap, delta: VoteDelta): VoteMap {
  let out = votes
  for (const [id, v] of Object.entries(delta.set)) {
    if (v == null ? !(id in out) : out[id] === v) continue
    if (out === votes) out = { ...votes }
    if (v == null) delete out[id]
    else out[id] = v
  }
  return out
}

/** ``ids`` cut down to ``cap``: ids absent from ``keep`` go first, then
 *  the rest, smallest first (story ids grow with time, so the oldest
 *  stories go). ``dropped`` is what went, for the PATCH's ``remove``. */
export function pruneIds(
  ids: readonly number[],
  keep: Iterable<number>,
  cap: number,
): { ids: number[]; dropped: number[] } {
  const over = ids.length - cap
  if (over <= 0) return { ids: ids as number[], dropped: [] }
  const keepSet = new Set(keep)
  const asc = (a: number, b: number) => a - b
  const order = [...ids.filter((id) => !keepSet.has(id)).sort(asc), ...ids.filter((id) => keepSet.has(id)).sort(asc)]
  const drop = new Set(order.slice(0, over))
  return { ids: ids.filter((id) => !drop.has(id)), dropped: ids.filter((id) => drop.has(id)) }
}

/** ``base`` (undefined: no row) with ``writes`` applied in order. For a
 *  set key with no row and no write, undefined. */
export function applyWrites(key: string, base: unknown, writes: readonly Write[]): unknown {
  let v = base
  for (const w of writes) {
    if (w.op === 'put') v = w.value
    else if (w.op === 'delete') v = undefined
    else if (isVoteDelta(w.delta)) v = applyVoteDelta(coerceVotes(v), w.delta)
    else v = applyIdDelta(coerceIds(v), w.delta)
  }
  return v
}

/** ``older`` then ``newer`` to one key as one write: two changes fold
 *  (``foldDelta``); a whole value or a delete replaces what came before. */
export function foldWrite(older: Write, newer: Write): Write {
  return older.op === 'patch' && newer.op === 'patch' ? { op: 'patch', delta: foldDelta(older.delta, newer.delta) } : newer
}

/** ``delta`` cut to what one PATCH may carry: at most ``limit`` ids per
 *  list, or ``limit`` votes (the key's cap, which is what the server's
 *  body check allows). ``now`` goes first and ``later`` (null when it all
 *  fits) after its answer. Removes and cleared votes go before adds and
 *  votes, so the server's trim after each PATCH (smallest id first) ends
 *  where one PATCH of the whole change would. */
export function splitDelta(delta: Delta, limit: number): { now: Delta; later: Delta | null } {
  if (isVoteDelta(delta)) {
    const entries = Object.entries(delta.set)
    if (entries.length <= limit) return { now: delta, later: null }
    const ordered = [...entries.filter(([, v]) => v == null), ...entries.filter(([, v]) => v != null)]
    return { now: { set: Object.fromEntries(ordered.slice(0, limit)) }, later: { set: Object.fromEntries(ordered.slice(limit)) } }
  }
  if (delta.remove.length > limit) {
    return { now: { add: [], remove: delta.remove.slice(0, limit) }, later: { add: delta.add, remove: delta.remove.slice(limit) } }
  }
  if (delta.add.length > limit) {
    return { now: { add: delta.add.slice(0, limit), remove: delta.remove }, later: { add: delta.add.slice(limit), remove: [] } }
  }
  return { now: delta, later: null }
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** What ``older`` may have undone of ``net``, a later write to the same
 *  key that holds ``older``'s change folded with a newer one, given
 *  ``value``: the key's value the server answered ``older`` with. It is
 *  the part of ``net`` that reverses ``older`` (an id ``older`` added and
 *  ``net`` removes, a vote ``net`` changes, a whole value ``net``
 *  replaces) where ``value`` still shows ``older``'s side. Null when
 *  there is none. */
export function overridden(older: Write, net: Write, value: unknown): Write | null {
  if (older.op === 'patch' && net.op === 'patch') {
    const o = older.delta
    const n = net.delta
    if (isVoteDelta(o) && isVoteDelta(n)) {
      const votes = coerceVotes(value)
      const set: Record<string, Vote | null> = {}
      for (const [id, v] of Object.entries(o.set)) {
        if (!has(n.set, id) || n.set[id] === v) continue
        if ((has(votes, id) ? votes[id] : null) === v) set[id] = n.set[id]
      }
      return Object.keys(set).length ? { op: 'patch', delta: { set } } : null
    }
    if (isVoteDelta(o) || isVoteDelta(n)) return null
    const held = new Set(coerceIds(value))
    const removes = new Set(n.remove)
    const adds = new Set(n.add)
    const add = o.remove.filter((id) => adds.has(id) && !held.has(id))
    const remove = o.add.filter((id) => removes.has(id) && held.has(id))
    return add.length || remove.length ? { op: 'patch', delta: { add, remove } } : null
  }
  if (older.op === 'patch' || net.op === 'patch') return null
  const was = older.op === 'put' ? older.value : undefined
  const want = net.op === 'put' ? net.value : undefined
  return !sameValue(was, want) && sameValue(value, was) ? net : null
}

/** What a merge must leave alone, and what it re-applies. */
export type Pending = {
  /** Keys whose incoming row is ignored (sync rule 5). */
  skip: ReadonlySet<string>
  /** Per key, the writes not yet acknowledged, oldest first. */
  writes: ReadonlyMap<string, readonly Write[]>
}

const NOTHING_PENDING: Pending = { skip: new Set(), writes: new Map() }

/** ``rows`` from the server merged into ``prev``, with the pending
 *  writes re-applied on top. ``full``: the response holds every row,
 *  so a key missing from it was deleted (unless it is skipped; a
 *  pending write still shows). Since mode leaves missing keys alone.
 *  An empty list or object is a value like any other. Unchanged values
 *  keep their reference, and with nothing changed ``prev`` comes back
 *  itself, so a resync doesn't re-render what it didn't change. */
export function mergeIncoming(
  prev: Rows,
  rows: readonly PrefRow[],
  pending: Pending = NOTHING_PENDING,
  opts: { full: boolean } = { full: false },
): Rows {
  let out: Record<string, unknown> | null = null
  const set = (key: string, value: unknown) => {
    const cur = (out ?? prev) as Record<string, unknown>
    if (value === undefined) {
      if (!(key in cur)) return
      out ??= { ...prev }
      delete out[key]
      return
    }
    if (key in cur && sameValue(cur[key], value)) return
    out ??= { ...prev }
    out[key] = value
  }
  const got = new Set<string>()
  for (const row of rows) {
    got.add(row.key)
    if (pending.skip.has(row.key)) continue
    set(row.key, applyWrites(row.key, normalizeValue(row.key, row.value), pending.writes.get(row.key) ?? []))
  }
  if (opts.full) {
    for (const key of Object.keys(prev)) {
      if (got.has(key) || pending.skip.has(key)) continue
      set(key, applyWrites(key, undefined, pending.writes.get(key) ?? []))
    }
  }
  return out ?? prev
}

// An ``updated_at`` in microseconds since the epoch, or null. The server
// sends microseconds; a Date keeps milliseconds, so the string is kept and
// only compared and shifted through this.
const STAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/
export function stampMicros(stamp: string): number | null {
  const m = STAMP_RE.exec(stamp)
  if (!m) return null
  const frac = (m[2] ?? '').padEnd(6, '0')
  const ms = Date.parse(`${m[1]}.${frac.slice(0, 3)}${m[3]}`)
  return Number.isFinite(ms) ? ms * 1000 + Number(frac.slice(3, 6)) : null
}

/** The later of two ``updated_at`` strings (null loses). */
export function laterStamp(a: string | null, b: string): string | null {
  const mb = stampMicros(b)
  if (mb == null) return a
  const ma = a == null ? null : stampMicros(a)
  return ma == null || mb > ma ? b : a
}

/** How a failed write ends: tried again (it may get through later: no
 *  answer, a 5xx, or a 404 / 405 from a server rolled back to before
 *  PATCH), or refused for good (400, 409, 422 and other 4xx). */
export function classifyWriteError(err: unknown): 'retry' | 'refuse' {
  const status = isPlainObject(err) && typeof err.status === 'number' ? err.status : 0
  if (status === 0 || status >= 500) return 'retry'
  return [404, 405, 408, 429].includes(status) ? 'retry' : 'refuse'
}

/** What an old build's localStorage still holds, written so it can't take
 *  anything from the server: set keys add only the ids the screen
 *  (``current``) lacks, and the other keys are written only where no row
 *  exists. */
export function legacySeedPlan(
  legacy: Rows,
  current: Rows,
): { adds: Array<[string, number[]]>; puts: Array<[string, unknown]> } {
  const adds: Array<[string, number[]]> = []
  const puts: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(legacy)) {
    if (isSetKey(key)) {
      if (isVoteKey(key)) continue
      const add = diffIds(coerceIds(current[key]), coerceIds(value)).add
      if (add.length) adds.push([key, add])
    } else if (!(key in current) && value !== undefined) {
      puts.push([key, value])
    }
  }
  return { adds, puts }
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

/** Set keys go out in a fixed 1 s batch (a scroll marks many stories),
 *  other keys in a fixed 250 ms one. Fixed, not a debounce: the first
 *  write starts the clock. */
export const PATCH_BATCH_MS = 1000
export const PUT_BATCH_MS = 250
/** A write that didn't get through is tried again after these. */
export const RETRY_MS = [2000, 4000, 8000]
/** A write with no answer after this is given up on (sync rule 4). A
 *  keepalive or suspended request may never settle on iOS. */
export const INFLIGHT_DEADLINE_MS = 30_000
/** Polls ask for rows updated since the newest one seen, minus this:
 *  ``updated_at`` is the writing transaction's start, so a write that
 *  started first can commit after a later one was read. */
export const POLL_OVERLAP_MS = 60_000
export const GET_TIMEOUT_MS = 20_000
/** A poll this soon after the last GET was sent is answered by it. */
export const RESYNC_COALESCE_MS = 1000
/** Reset waits at most this long for the writes on the way before its
 *  DELETEs (sync rule 9), like PR1r's flush before a reload: a fetch
 *  that never settles must not stop Reset. */
export const DISCARD_WAIT_MS = 3000

export type SyncTransport = {
  get: (since: string | null, signal: AbortSignal) => Promise<PrefRow[]>
  patch: (key: string, delta: Delta, keepalive: boolean) => Promise<PrefRow>
  put: (key: string, value: unknown, keepalive: boolean) => Promise<PrefRow>
  delete: (key: string, keepalive: boolean) => Promise<unknown>
}

export type SyncDeps = {
  transport: SyncTransport
  /** Shown rows changed. */
  onRows: (rows: Rows) => void
  /** A full GET ended: ``ok`` when its rows were adopted. */
  onLoad?: (ok: boolean) => void
  /** ``unsaved``: a write is still failing after its retries (once per
   *  round of retries). ``refused``: the server refused a write, which
   *  was dropped. */
  onError?: (kind: 'unsaved' | 'refused') => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  /** Whether the page is in front. */
  visible?: () => boolean
}

type Flight = {
  key: string
  write: Write
  seq: number
  sentAt: number
  // The hide count when it was sent, and whether the page was hidden
  // then: once the page is back in front after a later hide, or after
  // the hide it was sent in, it is no longer waited for (sync rule 4).
  epoch: number
  whileHidden: boolean
  done: Promise<void>
  // How it settled, once it has.
  outcome?: 'ok' | 'retry' | 'refused'
  // Folded by the leave flush into this later request (see settleStale).
  by?: Flight
}

type Get = { seq: number; full: boolean; ctrl: AbortController; done: Promise<void> }

export type PrefSync = ReturnType<typeof createPrefSync>

export function createPrefSync(deps: SyncDeps) {
  const t = deps.transport
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const visible = deps.visible ?? (() => true)

  let base: Rows = {}
  // The request (GET or write) whose answer set each key's base.
  const baseSeq = new Map<string, number>()
  let shown: Rows = {}
  const queue = new Map<string, Write>()
  const flights = new Map<string, Flight[]>()
  // Writes the leave flush folded into a later request while they were
  // still on the way (sync rule 1's one exception). They don't hold up
  // their key; their answers are only checked (settleStale).
  const stale = new Map<string, Flight[]>()
  // Writes given up on (sync rule 4), folded per key: still shown, never
  // sent again, until the next answer about the key replaces them.
  const limbo = new Map<string, Write>()
  // Per key, the ids that a write sent since base was last set added (or,
  // for votes, voted on): the server may hold them although base doesn't.
  const sentAdds = new Map<string, Set<string>>()
  const retries = new Map<string, { attempt: number; timer: unknown | null }>()
  // When each key's latest write settled (or was given up on), as a
  // request number: a GET sent before that is ignored for the key.
  const settledAt = new Map<string, number>()
  let seq = 0
  let watermark: string | null = null
  let loadedOnce = false
  // A full resync is due: a write was refused or given up on, so its
  // key's base or what it shows may be out of date. Cleared by a full GET
  // sent after it.
  let needFullAfter: number | null = null
  let get: Get | null = null
  let followUp: { promise: Promise<void>; resolve: () => void } | null = null
  // Runs for RESYNC_COALESCE_MS after a GET is sent. A timer, not a
  // clock reading: the device's clock can jump.
  let coalesceTimer: unknown | null = null
  let patchTimer: unknown | null = null
  let putTimer: unknown | null = null
  // A batch held back by a write still on the way runs again at that
  // write's deadline, in case it never answers.
  let deadlineTimer: unknown | null = null
  let hideEpoch = 0
  let resumedEpoch = 0
  let closed = false
  const beforeFlush = new Set<() => void>()

  const emit = (next: Rows) => {
    if (next === shown) return
    shown = next
    deps.onRows(shown)
  }

  const busy = (key: string) => (flights.get(key)?.length ?? 0) > 0
  const allFlights = () => Array.from(flights.values()).flat()
  const allStale = () => Array.from(stale.values()).flat()
  const overlay = (key: string): Write[] => {
    const out: Write[] = []
    const l = limbo.get(key)
    if (l) out.push(l)
    for (const f of flights.get(key) ?? []) out.push(f.write)
    const q = queue.get(key)
    if (q) out.push(q)
    return out
  }

  // Shown values for `keys`, from base and what is pending.
  const recompute = (keys: Iterable<string>) => {
    let out: Record<string, unknown> | null = null
    for (const key of keys) {
      const value = applyWrites(key, base[key], overlay(key))
      const cur = (out ?? shown) as Record<string, unknown>
      if (value === undefined) {
        if (!(key in cur)) continue
        out ??= { ...shown }
        delete out[key]
      } else if (!(key in cur) || !sameValue(cur[key], value)) {
        out ??= { ...shown }
        out[key] = value
      }
    }
    if (out) emit(out)
  }

  // The server's value for `key` was just adopted, from a request sent
  // after anything given up on: that settles what was given up on, and
  // the adds sent before it are in it or gone. A write the leave flush
  // folded away may still land after it, so its adds are kept meanwhile.
  const adopted = (key: string) => {
    limbo.delete(key)
    if (!busy(key) && !stale.has(key)) sentAdds.delete(key)
  }

  const setBase = (key: string, value: unknown, at: number) => {
    const next = { ...base }
    if (value === undefined) delete next[key]
    else next[key] = normalizeValue(key, value)
    base = next
    baseSeq.set(key, at)
    adopted(key)
  }

  // Off the list: whatever its request answers later is ignored.
  const removeFlight = (f: Flight) => {
    const rest = (flights.get(f.key) ?? []).filter((x) => x !== f)
    if (rest.length) flights.set(f.key, rest)
    else flights.delete(f.key)
  }

  const removeStale = (f: Flight) => {
    const rest = (stale.get(f.key) ?? []).filter((x) => x !== f)
    if (rest.length) stale.set(f.key, rest)
    else stale.delete(f.key)
  }

  const schedule = (kind: 'patch' | 'put') => {
    if (closed) return
    if (kind === 'patch') {
      if (patchTimer == null) patchTimer = setTimer(() => {
        patchTimer = null
        sendBatch('patch')
      }, PATCH_BATCH_MS)
    } else if (putTimer == null) {
      putTimer = setTimer(() => {
        putTimer = null
        sendBatch('put')
      }, PUT_BATCH_MS)
    }
  }
  const kindOf = (key: string) => (isSetKey(key) ? 'patch' : 'put')

  const stopBatches = () => {
    for (const timer of [patchTimer, putTimer, deadlineTimer]) if (timer != null) clearTimer(timer)
    patchTimer = putTimer = deadlineTimer = null
  }

  const stopRetry = (key: string) => {
    const r = retries.get(key)
    if (r?.timer != null) {
      clearTimer(r.timer)
      r.timer = null
    }
  }

  // Back in the queue ahead of anything newer: a newer whole value
  // replaces it, and a newer change, which doesn't hold it, folds on top.
  const putBack = (key: string, write: Write) => {
    const q = queue.get(key)
    queue.set(key, q ? foldWrite(write, q) : write)
  }

  // Sync rule 4: no answer by the deadline, or, once the page is back in
  // front, sent before it last hid or while it was hidden.
  const givenUp = (f: Flight, at: number, back: boolean) =>
    at - f.sentAt >= INFLIGHT_DEADLINE_MS || (back && (f.epoch < hideEpoch || f.whileHidden))

  // Sync rule 4: a write that may never settle (a keepalive or a
  // suspended fetch on iOS) stops holding up its key, and its late answer
  // is ignored. It is not sent again: it may have landed, and another
  // device may have changed the same story since, which a second send
  // would undo. What it changed stays on screen until the next answer
  // about the key (the next full GET, which this makes the next resync,
  // or a later write's answer) shows what the server holds.
  const expire = () => {
    const at = now()
    const back = visible()
    for (const f of allFlights()) {
      if (!givenUp(f, at, back)) continue
      removeFlight(f)
      settledAt.set(f.key, ++seq)
      needFullAfter = seq
      const l = limbo.get(f.key)
      limbo.set(f.key, l ? foldWrite(l, f.write) : f.write)
    }
    for (const f of allStale()) if (givenUp(f, at, back)) removeStale(f)
  }

  // Sync rule 1: one write in flight per key; a key waiting on a retry
  // timer waits for it.
  const sendBatch = (kind: 'patch' | 'put') => {
    if (closed) return
    expire()
    let deadline = Infinity
    for (const key of Array.from(queue.keys())) {
      if (kindOf(key) !== kind || retries.get(key)?.timer != null) continue
      if (busy(key)) {
        for (const f of flights.get(key)!) deadline = Math.min(deadline, f.sentAt + INFLIGHT_DEADLINE_MS)
        continue
      }
      send(key, false)
    }
    if (deadline < Infinity && deadlineTimer == null) {
      deadlineTimer = setTimer(() => {
        deadlineTimer = null
        sendBatch('patch')
        sendBatch('put')
      }, Math.max(0, deadline - now()))
    }
  }

  // A change as the server can take it. A remove (or a cleared vote) of
  // an id that is neither in base nor added by a write sent since base was
  // set is dropped: that id was added and taken back, or pruned, before
  // it ever went, so removing it changes nothing. Without this, a key at
  // its cap whose writes keep failing would grow ``remove`` by one pruned
  // id per add, past what one PATCH may carry.
  const forServer = (key: string, delta: Delta): Delta => {
    const sent = sentAdds.get(key)
    if (isVoteDelta(delta)) {
      const held = coerceVotes(base[key])
      let set: Record<string, Vote | null> | null = null
      for (const [id, v] of Object.entries(delta.set)) {
        if (v != null || has(held, id) || sent?.has(id)) continue
        set ??= { ...delta.set }
        delete set[id]
      }
      return set ? { set } : delta
    }
    const held = new Set(coerceIds(base[key]))
    const remove = delta.remove.filter((id) => held.has(id) || !!sent?.has(String(id)))
    return remove.length === delta.remove.length ? delta : { add: delta.add, remove }
  }

  const noteSent = (key: string, delta: Delta) => {
    const ids = isVoteDelta(delta)
      ? Object.entries(delta.set).flatMap(([id, v]) => (v == null ? [] : [id]))
      : delta.add.map(String)
    if (!ids.length) return
    let s = sentAdds.get(key)
    if (!s) sentAdds.set(key, (s = new Set()))
    for (const id of ids) s.add(id)
  }

  // The queued write for `key` goes out. A change goes as the server can
  // take it (``forServer``), at most one PATCH's worth at a time
  // (``splitDelta``): the rest stays queued for the next batch after the
  // answer. Returns the request on the way, or null when nothing went.
  const send = (key: string, keepalive: boolean): Flight | null => {
    let write = queue.get(key)
    if (!write) return null
    queue.delete(key)
    if (write.op === 'patch') {
      const { now: part, later } = splitDelta(forServer(key, write.delta), capFor(key) ?? Infinity)
      if (later) queue.set(key, { op: 'patch', delta: later })
      if (isEmptyDelta(part)) {
        recompute([key])
        return null
      }
      write = { op: 'patch', delta: part }
      noteSent(key, part)
    }
    const sent = write
    const f: Flight = { key, write: sent, seq: ++seq, sentAt: now(), epoch: hideEpoch, whileHidden: !visible(), done: Promise.resolve() }
    flights.set(key, [...(flights.get(key) ?? []), f])
    let req: Promise<unknown>
    try {
      req =
        sent.op === 'patch'
          ? t.patch(key, sent.delta, keepalive)
          : sent.op === 'put'
            ? t.put(key, sent.value, keepalive)
            : t.delete(key, keepalive)
    } catch (err) {
      req = Promise.reject(err)
    }
    f.done = req.then(
      (row) => settle(f, row as PrefRow | undefined, null),
      (err) => settle(f, undefined, err ?? new Error('failed')),
    )
    return f
  }

  const settle = (f: Flight, row: PrefRow | undefined, err: unknown) => {
    if ((stale.get(f.key) ?? []).includes(f)) {
      settleStale(f, row, err)
      return
    }
    // Off the list: discarded, or given up on (rule 4).
    if (!(flights.get(f.key) ?? []).includes(f)) return
    const key = f.key
    removeFlight(f)
    settledAt.set(key, ++seq)
    if (err == null) {
      f.outcome = 'ok'
      // The whole row after this write. A newer answer about the key
      // (a later write's, or a GET sent after this write) wins.
      if (f.seq > (baseSeq.get(key) ?? -1)) setBase(key, f.write.op === 'delete' ? undefined : row?.value, f.seq)
      retries.delete(key)
      recompute([key])
      if (queue.has(key)) schedule(kindOf(key))
      return
    }
    if (closed) return
    if (classifyWriteError(err) === 'retry') {
      // Sync rule 2.
      f.outcome = 'retry'
      putBack(key, f.write)
      armRetry(key)
    } else {
      // Sync rule 3: dropped, and the screen goes back to what the
      // server has. A newer write queued behind it still goes, with a
      // fresh round of retries.
      f.outcome = 'refused'
      needFullAfter = seq
      retries.delete(key)
      deps.onError?.('refused')
      if (queue.has(key)) schedule(kindOf(key))
    }
    recompute([key])
  }

  // A write the leave flush folded into a later request (``f.by``)
  // settled. Its answer never sets base, because ``f.by`` carries its
  // change too. But two requests for one key were on the way at once, so
  // this one may have reached the server after ``f.by`` and put back what
  // ``f.by`` reversed (an Undo made just before the page hid). When
  // ``f.by``'s answer is already in, the row this one answered with
  // shows whether it did; if so, that part goes again. When this answer
  // comes first, it most likely landed first, and nothing goes. (Not by
  // ``updated_at``: it is the transaction's start, not the order in which
  // the two took the row lock.)
  const settleStale = (f: Flight, row: PrefRow | undefined, err: unknown) => {
    const key = f.key
    removeStale(f)
    settledAt.set(key, ++seq)
    if (err != null || closed || f.by?.outcome !== 'ok') return
    const value = f.write.op === 'delete' ? undefined : row?.value
    const fix = overridden(f.write, f.by.write, value)
    if (!fix) return
    putBack(key, fix)
    recompute([key])
    // Still hidden: it may be the last chance to send it.
    if (!visible() && !busy(key)) send(key, true)
    else schedule(kindOf(key))
  }

  // Sync rule 2: retries after RETRY_MS; once they are used up, one toast
  // for the round. A round ends when the key's write is saved or refused,
  // or the page comes back to the front.
  const armRetry = (key: string) => {
    const r = retries.get(key) ?? { attempt: 0, timer: null }
    retries.set(key, r)
    stopRetry(key)
    r.attempt++
    if (r.attempt > RETRY_MS.length) {
      if (r.attempt === RETRY_MS.length + 1) deps.onError?.('unsaved')
      return
    }
    r.timer = setTimer(() => {
      r.timer = null
      if (closed) return
      expire()
      if (queue.has(key) && !busy(key)) send(key, false)
    }, RETRY_MS[r.attempt - 1])
  }

  const enqueue = (key: string, write: Write) => {
    const q = queue.get(key)
    queue.set(key, q ? foldWrite(q, write) : write)
    recompute([key])
    schedule(write.op === 'patch' ? 'patch' : 'put')
  }

  // ---- writes ----

  /** Add story ids to an id-set key. Ids already shown are skipped. Over
   *  the cap, ``pruneIds`` drops ids (never these, nor ``keep``) in the
   *  same PATCH. */
  const addIds = (key: string, ids: readonly number[], keep: Iterable<number> = []) => {
    if (!isSetKey(key) || isVoteKey(key)) throw new Error(`addIds: ${key} is not an id-set key`)
    const cur = coerceIds(shown[key])
    const have = new Set(cur)
    const add = [...new Set(ids)].filter((id) => isId(id) && !have.has(id))
    if (!add.length) return
    const keepAll = new Set(keep)
    for (const id of add) keepAll.add(id)
    const { dropped } = pruneIds(applyIdDelta(cur, { add, remove: [] }), keepAll, capFor(key)!)
    const gone = new Set(dropped)
    // Only ids held now go in ``remove``: a dropped new id (more added
    // at once than the cap holds) is simply not sent.
    enqueue(key, { op: 'patch', delta: { add: add.filter((id) => !gone.has(id)), remove: dropped.filter((id) => have.has(id)) } })
  }

  /** Remove story ids from an id-set key. Ids not shown are skipped. */
  const removeIds = (key: string, ids: readonly number[]) => {
    if (!isSetKey(key) || isVoteKey(key)) throw new Error(`removeIds: ${key} is not an id-set key`)
    const have = new Set(coerceIds(shown[key]))
    const remove = [...new Set(ids)].filter((id) => have.has(id))
    if (remove.length) enqueue(key, { op: 'patch', delta: { add: [], remove } })
  }

  /** Set or clear (``null``) votes. Over ``MAX_VOTED``, the smallest
   *  other ids are cleared in the same PATCH. */
  const setVotes = (changes: Readonly<Record<string, Vote | null>>) => {
    const cur = coerceVotes(shown[VOTES_KEY])
    const set: Record<string, Vote | null> = {}
    for (const [id, v] of Object.entries(changes)) {
      if (!VOTE_ID_RE.test(id) || (v !== null && v !== 'up' && v !== 'down')) continue
      if ((cur[id] ?? null) !== v) set[id] = v
    }
    if (!Object.keys(set).length) return
    const after = Object.keys(applyVoteDelta(cur, { set })).map(Number)
    const { dropped } = pruneIds(after, Object.keys(set).map(Number), MAX_VOTED)
    for (const id of dropped) set[String(id)] = null
    enqueue(VOTES_KEY, { op: 'patch', delta: { set } })
  }

  /** Write a whole value to a key that isn't a set key. */
  const put = (key: string, value: unknown) => {
    if (isSetKey(key)) throw new Error(`put: ${key} is a set key; use addIds, removeIds or setVotes`)
    enqueue(key, { op: 'put', value })
  }

  /** Delete a key that isn't a set key. */
  const del = (key: string) => {
    if (isSetKey(key)) throw new Error(`delete: ${key} is a set key`)
    enqueue(key, { op: 'delete' })
  }

  // ---- reads ----

  const adopt = (g: Get, rows: readonly PrefRow[]) => {
    expire()
    const keys = new Set(rows.map((r) => r.key))
    if (g.full) for (const k of [...Object.keys(base), ...Object.keys(shown), ...limbo.keys()]) keys.add(k)
    // Sync rule 5.
    const skip = new Set<string>()
    for (const key of keys) if (busy(key) || (settledAt.get(key) ?? -1) > g.seq) skip.add(key)
    const writes = new Map<string, Write[]>()
    for (const key of keys) {
      if (skip.has(key)) continue
      baseSeq.set(key, g.seq)
      adopted(key)
      writes.set(key, overlay(key))
    }
    base = mergeIncoming(base, rows, { skip, writes: new Map() }, { full: g.full })
    for (const row of rows) watermark = laterStamp(watermark, row.updated_at)
    if (g.full) {
      loadedOnce = true
      if (needFullAfter != null && g.seq > needFullAfter) needFullAfter = null
    }
    emit(mergeIncoming(shown, rows, { skip, writes }, { full: g.full }))
  }

  const startGet = (full: boolean): Promise<void> => {
    const g: Get = { seq: ++seq, full, ctrl: new AbortController(), done: Promise.resolve() }
    if (coalesceTimer != null) clearTimer(coalesceTimer)
    coalesceTimer = setTimer(() => {
      coalesceTimer = null
    }, RESYNC_COALESCE_MS)
    get = g
    const timer = setTimer(() => g.ctrl.abort(), GET_TIMEOUT_MS)
    const w = watermark == null ? null : stampMicros(watermark)
    const since = full || w == null ? null : new Date(Math.floor(w / 1000) - POLL_OVERLAP_MS).toISOString()
    let req: Promise<PrefRow[]>
    try {
      req = t.get(since, g.ctrl.signal)
    } catch (err) {
      req = Promise.reject(err)
    }
    g.done = req
      .then(
        (rows) => {
          if (get !== g || g.ctrl.signal.aborted) return
          adopt(g, rows)
          if (full) deps.onLoad?.(true)
        },
        () => {
          if (full) deps.onLoad?.(false)
        },
      )
      .finally(() => {
        clearTimer(timer)
        if (get !== g) return
        get = null
        const next = followUp
        followUp = null
        if (next) void resync({ full: true }).then(next.resolve)
      })
    return g.done
  }

  /** Read the server's rows. A poll asks only for rows changed since the
   *  newest one seen (minus ``POLL_OVERLAP_MS``); ``full`` asks for all,
   *  which is also how deleted rows go. One GET at a time (sync rule 7):
   *  a poll during a GET, or within ``RESYNC_COALESCE_MS`` of the last
   *  one, is answered by it; a full request during a poll runs right
   *  after it. */
  const resync = (opts: { full?: boolean } = {}): Promise<void> => {
    if (closed) return Promise.resolve()
    expire()
    const full = !!opts.full || !loadedOnce || watermark == null || needFullAfter != null
    if (get) {
      if (!full || get.full) return get.done
      if (!followUp) {
        let resolve = () => {}
        const promise = new Promise<void>((r) => (resolve = r))
        followUp = { promise, resolve }
      }
      return followUp.promise
    }
    if (!full && coalesceTimer != null) return Promise.resolve()
    return startGet(full)
  }

  // ---- leaving and coming back ----

  const runBeforeFlush = () => {
    for (const fn of Array.from(beforeFlush)) {
      try {
        fn()
      } catch {
        // A collector that throws doesn't stop the writes already queued.
      }
    }
  }

  /** The page is going away or hiding (``visibilitychange: hidden``,
   *  ``pagehide``, ``beforeunload``): everything queued goes now with
   *  ``keepalive``, one key per request (a change over one PATCH's worth
   *  sends its first part; the rest waits for the return). A key whose
   *  earlier write is still on the way sends that change again, folded
   *  with the queued one, because the page may never come back to send
   *  it after the answer; the earlier request is kept as stale, and its
   *  answer is checked (``settleStale``). */
  const leave = () => {
    if (closed) return
    runBeforeFlush()
    stopBatches()
    if (get) {
      get.ctrl.abort()
      get = null
      followUp?.resolve()
      followUp = null
    }
    for (const key of Array.from(queue.keys())) {
      const older = flights.get(key) ?? []
      const q = queue.get(key)!
      if (older.length && q.op === 'patch') {
        let delta: Delta | null = null
        for (const f of older) if (f.write.op === 'patch') delta = delta ? foldDelta(delta, f.write.delta) : f.write.delta
        if (delta) queue.set(key, { op: 'patch', delta: foldDelta(delta, q.delta) })
      }
      stopRetry(key)
      const carrier = send(key, true)
      if (!carrier || !older.length) continue
      const folded = [...(stale.get(key) ?? []), ...older]
      for (const f of folded) {
        removeFlight(f)
        f.by = carrier
      }
      stale.set(key, folded)
    }
    if (!visible()) hideEpoch++
  }

  /** Back in front after a hide: writes sent before it, or while the
   *  page was hidden, with no answer yet are given up on (rule 4), and
   *  everything queued, those waiting on a retry included, goes now with
   *  a new round of retries. (The full resync is the caller's.) */
  const resume = () => {
    if (closed || resumedEpoch === hideEpoch) return
    resumedEpoch = hideEpoch
    expire()
    for (const [key, r] of retries) {
      stopRetry(key)
      r.attempt = 0
    }
    for (const key of Array.from(queue.keys())) if (!busy(key)) send(key, false)
  }

  /** Send everything queued now (one behind an earlier write goes after
   *  its answer; a change over one PATCH's worth goes in parts) and wait.
   *  A write this sends that fails isn't sent again here. True when
   *  nothing is left to try again: each write was saved, or refused for
   *  good. The reload onto a new build runs this first (PR1r). */
  const flushPending = async (): Promise<boolean> => {
    if (closed) return true
    runBeforeFlush()
    stopBatches()
    const mine = new Set<Flight>()
    const failed = new Set<string>()
    for (;;) {
      expire()
      for (const key of Array.from(queue.keys())) {
        if (failed.has(key) || busy(key)) continue
        stopRetry(key)
        const f = send(key, false)
        if (f) mine.add(f)
      }
      const waiting = allFlights()
      if (!waiting.length) break
      await Promise.all(waiting.map((f) => f.done))
      for (const f of waiting) if (mine.has(f) && f.outcome === 'retry') failed.add(f.key)
    }
    // Keys that failed here wait on their retry timers.
    return queue.size === 0 && allFlights().length === 0
  }

  /** Reset only (it reloads next): drop everything queued and its timers,
   *  ignore what the writes on the way settle with, and wait for them, at
   *  most ``DISCARD_WAIT_MS`` (one given up on by rule 4 isn't waited for
   *  at all). A write that lands after Reset's DELETEs can at worst put
   *  back a few read marks or one tab's setting. From here on nothing more
   *  is sent, not even when the page goes. */
  const discardPending = async (): Promise<void> => {
    const at = now()
    const back = visible()
    closed = true
    stopBatches()
    for (const key of retries.keys()) stopRetry(key)
    retries.clear()
    get?.ctrl.abort()
    followUp?.resolve()
    followUp = null
    const waiting = [...allFlights(), ...allStale()].filter((f) => !givenUp(f, at, back)).map((f) => f.done)
    const keys = new Set([...queue.keys(), ...flights.keys(), ...limbo.keys()])
    queue.clear()
    flights.clear()
    stale.clear()
    limbo.clear()
    sentAdds.clear()
    recompute(keys)
    if (!waiting.length) return
    let timer: unknown = null
    const capped = new Promise<void>((resolve) => {
      timer = setTimer(resolve, DISCARD_WAIT_MS)
    })
    await Promise.race([Promise.allSettled(waiting), capped])
    clearTimer(timer)
  }

  /** Run ``fn`` before the leave flush and ``flushPending`` read the
   *  queue (the seen collectors drain into it). Returns the unregister. */
  const registerBeforeFlush = (fn: () => void) => {
    beforeFlush.add(fn)
    return () => {
      beforeFlush.delete(fn)
    }
  }

  return {
    rows: () => shown,
    addIds,
    removeIds,
    setVotes,
    put,
    delete: del,
    resync,
    leave,
    resume,
    flushPending,
    discardPending,
    registerBeforeFlush,
  }
}
