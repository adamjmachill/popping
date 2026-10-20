import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_HIDDEN,
  MAX_READ_PER_KEY,
  MAX_VOTED,
  PATCH_BATCH_MS,
  POLL_OVERLAP_MS,
  PUT_BATCH_MS,
  RETRY_MS,
  INFLIGHT_DEADLINE_MS,
  applyIdDelta,
  applyVoteDelta,
  capFor,
  classifyWriteError,
  createPrefSync,
  diffIds,
  foldDelta,
  isSetKey,
  laterStamp,
  legacySeedPlan,
  mergeIncoming,
  pruneIds,
  stampMicros,
} from '../../src/lib/prefSync.ts'
import type { Delta, PrefRow, Rows, Write } from '../../src/lib/prefSync.ts'

// ---------------------------------------------------------------------------
// A fake server that applies writes the way routes/preferences.py does, a
// fake clock, and a transport whose requests a test answers when it wants.
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-10-20T12:00:00Z')

// updated_at with microseconds, like the server's.
function stamp(micros: number): string {
  const ms = Math.floor(micros / 1000)
  return new Date(T0 + ms).toISOString().replace('Z', '') + String(micros % 1000).padStart(3, '0') + 'Z'
}

const CAPS: Record<string, number> = { starred_entries: 1000, hidden_entries: 1000, voted_entries: 2000 }
const serverCap = (key: string) => CAPS[key] ?? 1000

class FakeServer {
  rows = new Map<string, { value: unknown; updated_at: string }>()
  tick = 0
  write(key: string, value: unknown): PrefRow {
    const row = { value, updated_at: stamp(++this.tick * 1_000_001) }
    this.rows.set(key, row)
    return { key, ...row }
  }
  patch(key: string, body: Delta): PrefRow {
    const cur = this.rows.get(key)?.value
    if ('set' in body) {
      const votes: Record<string, string> = { ...((cur as Record<string, string>) ?? {}) }
      for (const [id, v] of Object.entries(body.set)) {
        if (v == null) delete votes[id]
        else votes[id] = v
      }
      const ids = Object.keys(votes).sort((a, b) => Number(a) - Number(b))
      for (const id of ids.slice(0, Math.max(0, ids.length - serverCap(key)))) delete votes[id]
      return this.write(key, votes)
    }
    const rm = new Set(body.remove)
    const ids = ((cur as number[]) ?? []).filter((id) => !rm.has(id))
    for (const id of body.add) if (!ids.includes(id)) ids.push(id)
    const keep = new Set([...ids].sort((a, b) => a - b).slice(-serverCap(key)))
    return this.write(key, ids.filter((id) => keep.has(id)))
  }
  list(since: string | null): PrefRow[] {
    const after = since == null ? null : stampMicros(since)!
    return [...this.rows].filter(([, r]) => after == null || stampMicros(r.updated_at)! > after).map(([key, r]) => ({ key, ...r }))
  }
  value(key: string): unknown {
    return this.rows.get(key)?.value
  }
}

type Req = {
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE'
  key: string
  body: unknown
  since: string | null
  keepalive: boolean
  settled: boolean
  // Runs it on the server now (a GET reads the rows as they are now).
  serve: () => void
  // Hands the answer to the page (serving it first if needed).
  respond: () => void
  // Fails it: a status, or no answer at all (a network error).
  fail: (status?: number) => void
}

function setup(opts: { server?: FakeServer; auto?: boolean; visible?: () => boolean } = {}) {
  const server = opts.server ?? new FakeServer()
  let now = T0
  let timerId = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const reqs: Req[] = []
  const errors: string[] = []
  let rows: Rows = {}
  let emits = 0
  let loads = 0
  const auto = { on: opts.auto ?? true }

  const request = <T>(method: Req['method'], key: string, body: unknown, since: string | null, keepalive: boolean, run: () => T, signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      let result: { v: T } | null = null
      const r: Req = {
        method,
        key,
        body,
        since,
        keepalive,
        settled: false,
        serve: () => {
          result ??= { v: run() }
        },
        respond: () => {
          if (r.settled) return
          r.serve()
          r.settled = true
          resolve(result!.v)
        },
        fail: (status?: number) => {
          if (r.settled) return
          r.settled = true
          reject(status ? { name: 'ApiError', status } : new TypeError('Failed to fetch'))
        },
      }
      signal?.addEventListener('abort', () => {
        if (r.settled) return
        r.settled = true
        reject(new DOMException('aborted', 'AbortError'))
      })
      reqs.push(r)
      if (auto.on) queueMicrotask(r.respond)
    })

  const sync = createPrefSync({
    transport: {
      get: (since, signal) => request('GET', '', null, since, false, () => server.list(since), signal),
      patch: (key, delta, keepalive) => request('PATCH', key, structuredClone(delta), null, keepalive, () => server.patch(key, delta)),
      put: (key, value, keepalive) => request('PUT', key, { value }, null, keepalive, () => server.write(key, value)),
      delete: (key, keepalive) =>
        request('DELETE', key, null, null, keepalive, () => {
          server.rows.delete(key)
        }),
    },
    onRows: (r) => {
      rows = r
      emits++
    },
    onLoad: (ok) => {
      if (ok) loads++
    },
    onError: (kind) => errors.push(kind),
    now: () => now,
    setTimer: (fn, ms) => {
      timers.set(++timerId, { at: now + ms, fn })
      return timerId
    },
    clearTimer: (id) => {
      timers.delete(id as number)
    },
    visible: opts.visible,
  })

  // Let promise callbacks run.
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
  }
  // Move the clock, firing timers in order, and let their requests run.
  const advance = async (ms: number) => {
    await settle()
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].fn()
      await settle()
    }
    now = end
    await settle()
  }
  return {
    sync,
    server,
    reqs,
    errors,
    auto,
    rows: () => rows,
    emits: () => emits,
    loads: () => loads,
    settle,
    advance,
    setNow: (t: number) => {
      now = t
    },
    writes: () => reqs.filter((r) => r.method !== 'GET'),
    gets: () => reqs.filter((r) => r.method === 'GET'),
  }
}

// Loaded: the first full GET has been adopted.
async function loaded(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts)
  await s.sync.resync({ full: true })
  await s.settle()
  return s
}

const patchBody = (r: Req) => r.body as Delta

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

test('isSetKey and capFor: the five set namespaces, nothing else', () => {
  for (const k of ['starred_entries', 'hidden_entries', 'voted_entries', 'read_entries:News', 'seen:News/Tech']) assert.ok(isSetKey(k), k)
  for (const k of ['read_entries:', 'seen:', 'column_prefs:news', 'last_viewed:news', 'filter_presets', 'history_group_by', 'muted_sources']) {
    assert.ok(!isSetKey(k), k)
    assert.equal(capFor(k), null, k)
  }
  assert.equal(capFor('hidden_entries'), MAX_HIDDEN)
  assert.equal(capFor('voted_entries'), MAX_VOTED)
  assert.equal(capFor('seen:x'), MAX_READ_PER_KEY)
  assert.equal(capFor('read_entries:x'), MAX_READ_PER_KEY)
})

test('foldDelta: the later op on an id wins; remove applies before add within one', () => {
  assert.deepEqual(foldDelta({ add: [1, 2], remove: [] }, { add: [], remove: [1] }), { add: [2], remove: [1] })
  assert.deepEqual(foldDelta({ add: [], remove: [3] }, { add: [3], remove: [] }), { add: [3], remove: [] })
  // An id in both lists of one change ends added, as the server does it.
  assert.deepEqual(foldDelta({ add: [4], remove: [4] }, { add: [], remove: [] }), { add: [4], remove: [] })
  assert.deepEqual(foldDelta({ set: { 1: 'up', 2: 'down' } }, { set: { 1: null } }), { set: { 1: null, 2: 'down' } })
})

test('applyIdDelta and applyVoteDelta: remove first, new ids last, same reference when nothing changes', () => {
  const ids = [3, 1, 2]
  assert.equal(applyIdDelta(ids, { add: [1], remove: [9] }), ids)
  assert.deepEqual(applyIdDelta(ids, { add: [4, 1], remove: [3] }), [1, 2, 4])
  assert.deepEqual(ids, [3, 1, 2], 'the input is not changed')
  const votes = { 1: 'up' as const }
  assert.equal(applyVoteDelta(votes, { set: { 1: 'up', 2: null } }), votes)
  assert.deepEqual(applyVoteDelta(votes, { set: { 1: null, 2: 'down' } }), { 2: 'down' })
})

test('diffIds: what was added and what went', () => {
  assert.deepEqual(diffIds([1, 2, 3], [3, 4, 1]), { add: [4], remove: [2] })
})

test('pruneIds: ids outside keep go first, then the smallest; dropped is returned', () => {
  assert.deepEqual(pruneIds([5, 1, 9, 3], [], 4), { ids: [5, 1, 9, 3], dropped: [] })
  assert.deepEqual(pruneIds([5, 1, 9, 3, 7], [], 3), { ids: [5, 9, 7], dropped: [1, 3] })
  // 1 is kept (just added), so the next smallest outside keep goes.
  assert.deepEqual(pruneIds([5, 1, 9, 3, 7], [1], 3), { ids: [1, 9, 7], dropped: [5, 3] })
  // Everything is in keep: the smallest of it goes.
  assert.deepEqual(pruneIds([4, 2, 6], [4, 2, 6], 2), { ids: [4, 6], dropped: [2] })
})

test('stamps keep microseconds: the later of two, and a poll overlap from the string', () => {
  assert.equal(stampMicros('2026-10-20T12:00:00.000001Z')! - stampMicros('2026-10-20T12:00:00Z')!, 1)
  assert.equal(stampMicros('2026-10-20T12:00:00.5+00:00'), stampMicros('2026-10-20T12:00:00.500000Z'))
  assert.equal(laterStamp('2026-10-20T12:00:00.000002Z', '2026-10-20T12:00:00.000001Z'), '2026-10-20T12:00:00.000002Z')
  assert.equal(laterStamp(null, '2026-10-20T12:00:00.000001Z'), '2026-10-20T12:00:00.000001Z')
  assert.equal(laterStamp('2026-10-20T12:00:00Z', 'garbage'), '2026-10-20T12:00:00Z')
})

test('classifyWriteError: no answer, 5xx, 404, 405, 408, 429 retry; other 4xx are refused', () => {
  for (const e of [new TypeError('Failed to fetch'), { status: 503 }, { status: 404 }, { status: 405 }, { status: 429 }, { status: 408 }]) {
    assert.equal(classifyWriteError(e), 'retry', JSON.stringify(e))
  }
  for (const s of [400, 401, 409, 413, 422]) assert.equal(classifyWriteError({ status: s }), 'refuse', String(s))
})

// ---------------------------------------------------------------------------
// mergeIncoming.
// ---------------------------------------------------------------------------

const row = (key: string, value: unknown, at = '2026-10-20T12:00:00Z'): PrefRow => ({ key, value, updated_at: at })
const none = { skip: new Set<string>(), writes: new Map<string, Write[]>() }

test('mergeIncoming: unchanged keys keep their reference, and nothing changed returns prev', () => {
  const prev: Rows = { starred_entries: [1, 2], 'column_prefs:news': { sort: 'best', minScore: 0, maxAgeHours: null } }
  const same = mergeIncoming(prev, [row('starred_entries', [1, 2]), row('column_prefs:news', { sort: 'best', minScore: 0, maxAgeHours: null })], none, { full: true })
  assert.equal(same, prev)
  const next = mergeIncoming(prev, [row('starred_entries', [1, 2, 3]), row('column_prefs:news', { sort: 'best', minScore: 0, maxAgeHours: null })], none, { full: true })
  assert.notEqual(next, prev)
  assert.deepEqual(next.starred_entries, [1, 2, 3])
  assert.equal(next['column_prefs:news'], prev['column_prefs:news'])
})

test('mergeIncoming: full mode deletes a missing key and keeps an empty list; since mode leaves missing keys alone', () => {
  const prev: Rows = { starred_entries: [1], hidden_entries: [2], 'read_entries:news': [3] }
  const full = mergeIncoming(prev, [row('starred_entries', [])], none, { full: true })
  assert.deepEqual(full, { starred_entries: [] })
  const since = mergeIncoming(prev, [row('starred_entries', [])], none, { full: false })
  assert.deepEqual(since, { starred_entries: [], hidden_entries: [2], 'read_entries:news': [3] })
})

test('mergeIncoming: skipped keys are untouched; pending writes are applied on top, and keep a missing key', () => {
  const prev: Rows = { hidden_entries: [1, 9], starred_entries: [5], 'column_prefs:news': { sort: 'best' } }
  const pending = {
    skip: new Set(['hidden_entries']),
    writes: new Map<string, Write[]>([
      ['starred_entries', [{ op: 'patch', delta: { add: [6], remove: [] } }]],
      ['column_prefs:news', [{ op: 'put', value: { sort: 'best' } }]],
    ]),
  }
  const next = mergeIncoming(prev, [row('hidden_entries', [1]), row('starred_entries', [5, 7])], pending, { full: true })
  assert.equal(next.hidden_entries, prev.hidden_entries)
  assert.deepEqual(next.starred_entries, [5, 7, 6])
  assert.equal(next['column_prefs:news'], prev['column_prefs:news'], 'a queued PUT keeps the key the GET no longer has')
})

test('mergeIncoming: set-key values are cleaned on the way in', () => {
  const next = mergeIncoming({}, [row('starred_entries', [1, '2', 1, 0, 3.5, 4]), row('voted_entries', { 5: 'up', x: 'down', 6: 'sideways' }), row('hidden_entries', 'junk')], none, { full: true })
  assert.deepEqual(next, { starred_entries: [1, 4], voted_entries: { 5: 'up' }, hidden_entries: [] })
})

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

test('set keys are never written whole: put and delete refuse them, and the other keys take no changes', async () => {
  const s = await loaded()
  for (const key of ['starred_entries', 'hidden_entries', 'voted_entries', 'read_entries:News', 'seen:News']) {
    assert.throws(() => s.sync.put(key, []), /set key/, key)
    assert.throws(() => s.sync.delete(key), /set key/, key)
  }
  assert.throws(() => s.sync.addIds('column_prefs:news', [1]), /not an id-set key/)
  assert.throws(() => s.sync.removeIds('voted_entries', [1]), /not an id-set key/)
  s.sync.addIds('starred_entries', [1])
  s.sync.setVotes({ 1: 'up' })
  s.sync.put('history_group_by', 'none')
  s.sync.delete('last_viewed:news')
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(
    s.writes().map((r) => [r.method, r.key]),
    [
      ['PUT', 'history_group_by'],
      ['DELETE', 'last_viewed:news'],
      ['PATCH', 'starred_entries'],
      ['PATCH', 'voted_entries'],
    ],
  )
})

test('two adds in one tick both land, in one PATCH after the 1 s batch', async () => {
  const s = await loaded()
  s.sync.addIds('starred_entries', [101])
  s.sync.addIds('starred_entries', [102])
  assert.deepEqual(s.rows().starred_entries, [101, 102], 'both show at once')
  assert.equal(s.writes().length, 0, 'nothing before the batch')
  await s.advance(PATCH_BATCH_MS)
  assert.equal(s.writes().length, 1)
  assert.deepEqual(patchBody(s.writes()[0]), { add: [101, 102], remove: [] })
  assert.deepEqual(s.server.value('starred_entries'), [101, 102])
  assert.ok(s.writes().every((r) => r.method === 'PATCH'))
})

test('add then remove: folded before it goes, and ordered once the first is on the way', async () => {
  const s = await loaded()
  s.sync.addIds('hidden_entries', [7])
  s.sync.removeIds('hidden_entries', [7])
  assert.deepEqual(s.rows().hidden_entries, [])
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[0]), { add: [], remove: [7] })

  // The add is on the way when the remove comes: the remove waits for it.
  s.auto.on = false
  s.sync.addIds('hidden_entries', [8])
  await s.advance(PATCH_BATCH_MS)
  s.sync.removeIds('hidden_entries', [8])
  await s.advance(PATCH_BATCH_MS * 3)
  assert.equal(s.writes().length, 2, 'one PATCH per key on the way')
  s.writes()[1].respond()
  await s.advance(PATCH_BATCH_MS)
  assert.equal(s.writes().length, 3)
  assert.deepEqual(patchBody(s.writes()[2]), { add: [], remove: [8] })
  s.writes()[2].respond()
  await s.settle()
  assert.deepEqual(s.server.value('hidden_entries'), [])
  assert.deepEqual(s.rows().hidden_entries, [])
})

test('two devices: neither undoes the other, and a resync shows both', async () => {
  const server = new FakeServer()
  server.write('starred_entries', [1])
  const a = await loaded({ server })
  const b = await loaded({ server })
  a.sync.addIds('starred_entries', [2])
  b.sync.addIds('starred_entries', [3])
  b.sync.removeIds('starred_entries', [1])
  await a.advance(PATCH_BATCH_MS)
  await b.advance(PATCH_BATCH_MS)
  assert.deepEqual(server.value('starred_entries'), [2, 3])
  await a.advance(2000)
  await a.sync.resync()
  await a.settle()
  assert.deepEqual(a.rows().starred_entries, [2, 3])
  assert.deepEqual(b.rows().starred_entries, [2, 3], "B's PATCH answer holds A's save")
})

test('an in-flight change survives a stale GET, and a GET sent before its answer is ignored for that key', async () => {
  const server = new FakeServer()
  server.write('hidden_entries', [1])
  server.write('starred_entries', [50])
  const s = await loaded({ server })
  s.auto.on = false
  s.sync.addIds('hidden_entries', [2])
  await s.advance(PATCH_BATCH_MS)
  const patch = s.writes()[0]

  // A GET answered with the old set while the PATCH is on the way.
  const poll = s.sync.resync({ full: true })
  const get1 = s.gets().at(-1)!
  server.write('starred_entries', [50, 51])
  get1.respond()
  await poll
  assert.deepEqual(s.rows().hidden_entries, [1, 2], 'still hidden')
  assert.deepEqual(s.rows().starred_entries, [50, 51], 'other keys are adopted')

  // A GET served before the PATCH and answered after the PATCH's answer.
  const poll2 = s.sync.resync({ full: true })
  const get2 = s.gets().at(-1)!
  get2.serve()
  patch.respond()
  await s.settle()
  assert.deepEqual(s.rows().hidden_entries, [1, 2])
  get2.respond()
  await poll2
  assert.deepEqual(s.rows().hidden_entries, [1, 2], 'the old set from before the answer is ignored')

  // A GET sent after the answer is adopted.
  server.patch('hidden_entries', { add: [], remove: [1] })
  const poll3 = s.sync.resync({ full: true })
  s.gets().at(-1)!.respond()
  await poll3
  assert.deepEqual(s.rows().hidden_entries, [2])
})

test('a PUT key in flight survives a stale full GET', async () => {
  const server = new FakeServer()
  server.write('column_prefs:news', { sort: 'newest', minScore: 0, maxAgeHours: null })
  const s = await loaded({ server })
  s.auto.on = false
  const best = { sort: 'best', minScore: 0, maxAgeHours: null }
  s.sync.put('column_prefs:news', best)
  await s.advance(PUT_BATCH_MS)
  const put = s.writes()[0]
  assert.equal(put.method, 'PUT')
  const poll = s.sync.resync({ full: true })
  s.gets().at(-1)!.respond()
  await poll
  assert.deepEqual(s.rows()['column_prefs:news'], best)
  put.respond()
  await s.settle()
  assert.deepEqual(s.rows()['column_prefs:news'], best)
  // A key queued but not yet sent: a full GET without the row keeps it.
  s.sync.put('column_sections:news', { newCollapsed: true, historyCollapsed: false })
  const poll2 = s.sync.resync({ full: true })
  s.gets().at(-1)!.respond()
  await poll2
  assert.deepEqual(s.rows()['column_sections:news'], { newCollapsed: true, historyCollapsed: false })
})

test('reference identity: a resync that brings nothing new changes nothing', async () => {
  const server = new FakeServer()
  server.write('starred_entries', [1, 2])
  server.write('column_prefs:news', { sort: 'best', minScore: 0, maxAgeHours: null })
  const s = await loaded({ server })
  const before = s.rows()
  const emits = s.emits()
  await s.advance(2000)
  await s.sync.resync({ full: true })
  await s.settle()
  assert.equal(s.rows(), before)
  assert.equal(s.emits(), emits)
  server.write('hidden_entries', [9])
  await s.advance(2000)
  await s.sync.resync({ full: true })
  await s.settle()
  assert.notEqual(s.rows(), before)
  assert.equal(s.rows().starred_entries, before.starred_entries)
  assert.equal(s.rows()['column_prefs:news'], before['column_prefs:news'])
})

test('caps: an add over the cap drops the smallest ids in the same PATCH, and the server ends with the same set', async () => {
  const server = new FakeServer()
  const full = Array.from({ length: MAX_READ_PER_KEY }, (_, i) => 100 + i)
  server.write('read_entries:News', full)
  const s = await loaded({ server })
  // 50 is older than everything stored but was just added: it stays.
  s.sync.addIds('read_entries:News', [50, 5000])
  await s.advance(PATCH_BATCH_MS)
  const body = patchBody(s.writes()[0])
  assert.deepEqual(body, { add: [50, 5000], remove: [100, 101] })
  const client = s.rows()['read_entries:News'] as number[]
  assert.equal(client.length, MAX_READ_PER_KEY)
  assert.deepEqual([...(server.value('read_entries:News') as number[])].sort((a, b) => a - b), [...client].sort((a, b) => a - b))
  // keep: ids on screen survive a prune (50 is no longer just added).
  s.sync.addIds('read_entries:News', [6000], [102])
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[1]), { add: [6000], remove: [50] })
  s.sync.addIds('read_entries:News', [7000], [102, 103])
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[2]), { add: [7000], remove: [104] })
  // More new ids than the cap holds: the smallest new ones are not sent,
  // and only ids held go in remove, so neither list passes the cap.
  const many = Array.from({ length: MAX_READ_PER_KEY + 5 }, (_, i) => 10_000 + i)
  s.sync.addIds('read_entries:News', many)
  await s.advance(PATCH_BATCH_MS)
  const big = patchBody(s.writes()[3]) as { add: number[]; remove: number[] }
  assert.equal(big.add.length, MAX_READ_PER_KEY)
  assert.deepEqual(big.add, many.slice(5))
  assert.equal(big.remove.length, MAX_READ_PER_KEY)
  assert.ok(big.remove.every((id) => id < 10_000), 'remove holds only ids that were stored')
  assert.deepEqual([...(server.value('read_entries:News') as number[])].sort((a, b) => a - b), many.slice(5))
})

test('votes: set, change and clear; over MAX_VOTED the smallest other ids are cleared', async () => {
  const server = new FakeServer()
  const votes: Record<string, string> = {}
  for (let i = 1; i <= MAX_VOTED; i++) votes[String(i + 10)] = 'up'
  server.write('voted_entries', votes)
  const s = await loaded({ server })
  s.sync.setVotes({ 5: 'down', 11: null, 12: 'down' })
  s.sync.setVotes({ 13: 'up' }) // no change: not sent
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[0]), { set: { 5: 'down', 11: null, 12: 'down' } })
  s.sync.setVotes({ 1: 'up', 2: 'up' })
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[1]), { set: { 1: 'up', 2: 'up', 5: null, 12: null } })
  const shown = s.rows().voted_entries as Record<string, string>
  assert.equal(Object.keys(shown).length, MAX_VOTED)
  assert.deepEqual(shown, server.value('voted_entries'))
})

test('a failed change goes back ahead of newer ones; retries after 2, 4 and 8 s, then one toast', async () => {
  const s = await loaded()
  s.auto.on = false
  s.sync.addIds('starred_entries', [1])
  await s.advance(PATCH_BATCH_MS)
  s.writes()[0].fail(503)
  await s.settle()
  assert.deepEqual(s.rows().starred_entries, [1], 'still shown')
  // Newer: remove 1 and add 2. Later ops win over the failed add.
  s.sync.removeIds('starred_entries', [1])
  s.sync.addIds('starred_entries', [2])
  await s.advance(PATCH_BATCH_MS)
  assert.equal(s.writes().length, 1, 'the batch waits for the retry')
  await s.advance(RETRY_MS[0] - PATCH_BATCH_MS)
  assert.equal(s.writes().length, 2)
  assert.deepEqual(patchBody(s.writes()[1]), { add: [2], remove: [1] })
  s.writes()[1].fail()
  await s.advance(RETRY_MS[1] - 1)
  assert.equal(s.writes().length, 2)
  await s.advance(1)
  s.writes()[2].fail(500)
  await s.advance(RETRY_MS[2])
  assert.deepEqual(s.errors, [])
  s.writes()[3].fail(502)
  await s.settle()
  assert.deepEqual(s.errors, ['unsaved'], 'one toast once the retries are used up')
  assert.deepEqual(s.rows().starred_entries, [2])
  await s.advance(60_000)
  assert.equal(s.writes().length, 4, 'no more timed retries')
  // Coming back after a hide tries again.
  s.sync.leave()
  assert.equal(s.writes().length, 5)
  assert.ok(s.writes()[4].keepalive)
  s.writes()[4].respond()
  await s.settle()
  assert.deepEqual(s.server.value('starred_entries'), [2])
})

test('405 keeps the change queued and shown; 400 and 422 drop it and the screen goes back', async () => {
  const server = new FakeServer()
  server.write('hidden_entries', [1])
  const s = await loaded({ server })
  s.auto.on = false
  s.sync.addIds('hidden_entries', [2])
  await s.advance(PATCH_BATCH_MS)
  s.writes()[0].fail(405)
  await s.settle()
  assert.deepEqual(s.rows().hidden_entries, [1, 2])
  assert.deepEqual(s.errors, [])
  await s.advance(RETRY_MS[0])
  assert.deepEqual(patchBody(s.writes()[1]), { add: [2], remove: [] })
  s.writes()[1].fail(400)
  await s.settle()
  assert.deepEqual(s.rows().hidden_entries, [1])
  assert.deepEqual(s.errors, ['refused'])
  s.sync.addIds('hidden_entries', [3])
  await s.advance(PATCH_BATCH_MS)
  s.writes()[2].fail(422)
  await s.settle()
  assert.deepEqual(s.rows().hidden_entries, [1])
  await s.advance(30_000)
  assert.equal(s.writes().length, 3, 'a refused change is not sent again')
  // A refusal ends the key's round of retries: the next failure waits
  // the first delay again, not the next one.
  s.sync.addIds('hidden_entries', [4])
  await s.advance(PATCH_BATCH_MS)
  s.writes()[3].fail(503)
  await s.advance(RETRY_MS[0] - 1)
  assert.equal(s.writes().length, 4)
  await s.advance(1)
  assert.equal(s.writes().length, 5, `retried ${RETRY_MS[0]} ms after the failure`)
})

test('a full request during a since GET runs right after it; polls during a GET are answered by it', async () => {
  const server = new FakeServer()
  server.write('starred_entries', [1])
  const s = await loaded({ server })
  s.auto.on = false
  await s.advance(5000)
  const poll = s.sync.resync()
  assert.equal(s.gets().length, 2)
  assert.ok(s.gets()[1].since, 'a poll asks with since')
  const again = s.sync.resync()
  const full = s.sync.resync({ full: true })
  assert.equal(s.gets().length, 2, 'one GET at a time')
  s.gets()[1].respond()
  await poll
  await again
  await s.settle()
  assert.equal(s.gets().length, 3, 'the full one went right after')
  assert.equal(s.gets()[2].since, null)
  s.gets()[2].respond()
  await full
  // A poll right after a GET was sent is answered by it.
  const soon = s.sync.resync()
  await soon
  assert.equal(s.gets().length, 3)
})

test('the watermark moves only with GETs: a PATCH answer does not move it; polls overlap by 60 s', async () => {
  const server = new FakeServer()
  const first = server.write('hidden_entries', [1]).updated_at
  const s = await loaded({ server })
  s.sync.addIds('starred_entries', [9])
  await s.advance(PATCH_BATCH_MS)
  assert.ok(stampMicros(server.rows.get('starred_entries')!.updated_at)! > stampMicros(first)!)
  await s.advance(2000)
  await s.sync.resync()
  await s.settle()
  const since = s.gets().at(-1)!.since!
  assert.equal(Date.parse(since), Math.floor(stampMicros(first)! / 1000) - POLL_OVERLAP_MS)
  // That GET held the PATCHed row, so now the watermark moves.
  const latest = server.rows.get('starred_entries')!.updated_at
  await s.advance(2000)
  await s.sync.resync()
  await s.settle()
  assert.equal(Date.parse(s.gets().at(-1)!.since!), Math.floor(stampMicros(latest)! / 1000) - POLL_OVERLAP_MS)
})

test('an in-flight record is cleared by its deadline: its change is sent again, and its late answer is ignored', async () => {
  const server = new FakeServer()
  server.write('starred_entries', [1])
  const s = await loaded({ server })
  s.auto.on = false
  s.sync.addIds('starred_entries', [2])
  await s.advance(PATCH_BATCH_MS)
  const stuck = s.writes()[0]
  s.sync.addIds('starred_entries', [3])
  await s.advance(PATCH_BATCH_MS)
  assert.equal(s.writes().length, 1, 'waits for the first')
  // A GET answered now ignores the key: a write is on its way.
  const poll = s.sync.resync({ full: true })
  s.gets().at(-1)!.respond()
  await poll
  assert.deepEqual(s.rows().starred_entries, [1, 2, 3])
  await s.advance(INFLIGHT_DEADLINE_MS)
  assert.equal(s.writes().length, 1, 'past the deadline it waits for its retry')
  assert.deepEqual(s.rows().starred_entries, [1, 2, 3], 'the change still shows')
  // The key no longer counts as busy: a full GET is taken in, with the
  // queued change on top.
  const poll2 = s.sync.resync({ full: true })
  s.gets().at(-1)!.respond()
  await poll2
  assert.deepEqual(s.rows().starred_entries, [1, 2, 3])
  await s.advance(RETRY_MS[0])
  assert.equal(s.writes().length, 2)
  assert.deepEqual(patchBody(s.writes()[1]), { add: [2, 3], remove: [] }, 'sent again, folded with the queued one')
  s.writes()[1].respond()
  await s.settle()
  assert.deepEqual(s.rows().starred_entries, [1, 2, 3])
  // The stuck one's late answer, whatever it is, changes nothing.
  stuck.fail(400)
  await s.settle()
  assert.deepEqual(s.errors, [])
  assert.deepEqual(s.rows().starred_entries, [1, 2, 3])
  assert.deepEqual(server.value('starred_entries'), [1, 2, 3])
})

test('coming back after a hide: a write sent before it with no answer yet goes again at once', async () => {
  let shown = true
  const s = await loaded({ visible: () => shown })
  s.auto.on = false
  s.sync.addIds('hidden_entries', [4])
  shown = false
  s.sync.leave()
  const keep = s.writes()[0]
  assert.ok(keep.keepalive, 'leaving sends the queued change with keepalive at once')
  // Back before it was answered.
  shown = true
  s.sync.resume()
  assert.equal(s.writes().length, 2)
  assert.deepEqual(patchBody(s.writes()[1]), { add: [4], remove: [] })
  assert.equal(s.writes()[1].keepalive, false)
  s.sync.addIds('hidden_entries', [5])
  await s.advance(PATCH_BATCH_MS)
  assert.equal(s.writes().length, 2, 'the next change waits for that one')
  const flushing = s.sync.flushPending()
  await s.settle()
  s.writes()[1].respond()
  await s.settle()
  keep.respond()
  await s.settle()
  assert.deepEqual(patchBody(s.writes()[2]), { add: [5], remove: [] })
  s.writes()[2].respond()
  assert.equal(await flushing, true)
  assert.deepEqual(s.server.value('hidden_entries'), [4, 5])
  assert.deepEqual(s.rows().hidden_entries, [4, 5])
  // A return without a hide in between does nothing.
  s.sync.resume()
  assert.equal(s.writes().length, 3)
})
test('leaving: before-flush collectors run first; a key still on the way resends its change folded with the queued one', async () => {
  const s = await loaded({ visible: () => false })
  s.auto.on = false
  s.sync.addIds('starred_entries', [1])
  await s.advance(PATCH_BATCH_MS)
  s.sync.addIds('starred_entries', [2])
  const unregister = s.sync.registerBeforeFlush(() => s.sync.addIds('seen:News', [77]))
  s.sync.put('column_prefs:news', { sort: 'best', minScore: 0, maxAgeHours: null })
  s.sync.leave()
  const sent = s.writes().slice(1)
  assert.deepEqual(
    sent.map((r) => [r.method, r.key, r.keepalive]),
    [
      ['PATCH', 'starred_entries', true],
      ['PUT', 'column_prefs:news', true],
      ['PATCH', 'seen:News', true],
    ],
  )
  assert.deepEqual(patchBody(sent[0]), { add: [1, 2], remove: [] })
  unregister()
  s.sync.leave()
  assert.equal(s.writes().length, 4, 'nothing left, and the collector is gone')
})

test('flushPending: sends everything once and says whether anything is left to retry', async () => {
  const s = await loaded()
  s.sync.addIds('starred_entries', [1])
  s.sync.put('history_group_by', 'none')
  assert.equal(await s.sync.flushPending(), true)
  assert.deepEqual(s.server.value('starred_entries'), [1])
  assert.equal(s.server.value('history_group_by'), 'none')
  s.auto.on = false
  s.sync.addIds('starred_entries', [2])
  const flushing = s.sync.flushPending()
  await s.settle()
  s.writes().at(-1)!.fail(503)
  assert.equal(await flushing, false, 'a change that did not get through is left')
  const again = s.sync.flushPending()
  await s.settle()
  s.writes().at(-1)!.fail(409)
  assert.equal(await again, true, 'refused for good is not left to retry')
})

test('discardPending: drops the queue and retries, waits for writes on the way, then sends nothing', async () => {
  const s = await loaded({ visible: () => false })
  s.auto.on = false
  s.sync.addIds('starred_entries', [1])
  await s.advance(PATCH_BATCH_MS)
  const onWay = s.writes()[0]
  s.sync.addIds('hidden_entries', [2])
  s.sync.put('column_prefs:news', { sort: 'best', minScore: 0, maxAgeHours: null })
  let done = false
  const discarding = s.sync.discardPending().then(() => (done = true))
  await s.settle()
  assert.equal(done, false, 'waits for the PATCH on the way')
  onWay.fail(503)
  await discarding
  // Reset's DELETEs and the reload follow: a write made meanwhile (a
  // handler still running) isn't sent either, and no GET goes.
  s.sync.addIds('starred_entries', [3])
  s.sync.put('history_group_by', 'none')
  const gets = s.gets().length
  await s.sync.resync({ full: true })
  await s.advance(60_000)
  s.sync.leave()
  assert.equal(s.writes().length, 1, 'no retry, no batch, no leave flush')
  assert.equal(s.gets().length, gets, 'no GET after the discard')
})

test('the first full GET failing: nothing is written over the server, and the next resync is full', async () => {
  const server = new FakeServer()
  server.write('starred_entries', [10, 11])
  const s = setup({ server, auto: false })
  const first = s.sync.resync()
  assert.equal(s.gets()[0].since, null)
  s.gets()[0].fail(500)
  await first
  assert.equal(s.loads(), 0)
  s.sync.addIds('starred_entries', [12])
  await s.advance(PATCH_BATCH_MS)
  assert.deepEqual(patchBody(s.writes()[0]), { add: [12], remove: [] })
  s.writes()[0].respond()
  await s.settle()
  assert.deepEqual(server.value('starred_entries'), [10, 11, 12])
  assert.deepEqual(s.rows().starred_entries, [10, 11, 12], "the PATCH answer brings the server's list")
  const next = s.sync.resync()
  assert.equal(s.gets()[1].since, null)
  s.gets()[1].respond()
  await next
  assert.equal(s.loads(), 1)
})

test("legacy localStorage lists plus server rows: no set-key PUT, and no server id removed", async () => {
  const server = new FakeServer()
  server.write('starred_entries', [1, 2])
  server.write('filter_presets', [{ id: 'p', name: 'Server view' }])
  const s = await loaded({ server })
  const legacy: Rows = {
    starred_entries: [2, 3],
    hidden_entries: [4],
    'read_entries:News': [5, 6],
    filter_presets: [{ id: 'old', name: 'Old view' }],
    history_group_by: 'none',
  }
  const plan = legacySeedPlan(legacy, s.rows())
  assert.deepEqual(plan.adds, [
    ['starred_entries', [3]],
    ['hidden_entries', [4]],
    ['read_entries:News', [5, 6]],
  ])
  assert.deepEqual(plan.puts, [['history_group_by', 'none']], 'filter_presets has a server row: not written')
  for (const [key, ids] of plan.adds) s.sync.addIds(key, ids)
  for (const [key, value] of plan.puts) s.sync.put(key, value)
  await s.advance(PATCH_BATCH_MS)
  for (const r of s.writes()) {
    if (isSetKey(r.key)) {
      assert.equal(r.method, 'PATCH', r.key)
      assert.deepEqual((r.body as { remove: number[] }).remove, [], r.key)
    }
  }
  assert.deepEqual(server.value('starred_entries'), [1, 2, 3])
  assert.deepEqual(server.value('filter_presets'), [{ id: 'p', name: 'Server view' }])
})
