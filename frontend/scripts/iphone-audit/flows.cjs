// Behaviour flows for smoke.cjs (REDESIGN_PLAN.md section 12). Each flow
// has the same shape as a smoke state, with `checks: false` and a `run`
// that calls fail(rule, detail) for each problem. They run at 390 only.
//
// Flows record the requests they care about with page routes, which run
// before capture.cjs's context mock and then fall through to it.
// smoke.cjs requires this file, so it must not require smoke.cjs.
//
// Counting taps (H1). A tap-count flow proves "this takes at most N taps":
// - tap(page, locator) is locator.tap() (phone contexts have hasTouch) and
//   adds 1 to page._taps.
// - taps(page, max, id) fails the flow under rule `id` when page._taps is
//   over max. The count starts at 0 when `run` starts.
// - A swipe through touchDrag() counts as 1. Typing with fill() is free.
// - A tap-count flow starts from its URL and uses only tap, touchDrag and
//   fill to get there: no evaluate, pushState, .click(), .check(),
//   selectOption or startPoll shortcuts. The older flows below use those
//   freely; they count requests, not taps.
//
// Every flow also gets installHarness() before the page loads: window.open,
// navigator.share and the clipboard are stubbed (nothing leaves the page),
// and fetches to /api/preferences and /api/interactions are recorded with
// their keepalive flag, which Playwright's Request does not expose, and
// whether the app has read the answer (harnessLog(), answered()).
//
// Preferences. capture.cjs keeps a preference store per context; a flow
// seeds it with prefMock(context).seed({ key: value }) (rows as if the
// server had them) and queues faults with prefMock(context).fail(...).
// Answering GET /api/preferences with a fixed body instead would bring
// that body back on every poll and on every return to the front, which
// now re-read the preferences. Any whole-list PUT of a set key fails
// the flow under smoke rule C17.
//
// Time. Flows that assert dwell, batch, toast, poll or arrival timing call
// installClock(page) in `before` and move time with page.clock.runFor (as
// flow-fn-quiet-poll does). runFor also fires the regular visible poll, so
// GET counts allow for it. Where real time is kept, pause at least twice
// the delay under test.
'use strict'

const F = require('./fixtures.cjs')
const { prefMock } = require('./capture.cjs')

const SETTINGS = '[role="dialog"][aria-label="settings"]'
const FEED_TABS = `${SETTINGS} [role="tablist"][aria-label="feed manager tabs"]`
const CHANNEL_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv'

async function openAddTab(page) {
  await page.locator(SETTINGS).waitFor({ state: 'visible' })
  await page.locator(`${FEED_TABS} [role="tab"]`).nth(2).click()
  await page.locator('#fm-url').waitFor({ state: 'visible' })
}

// Records the JSON bodies of `method` requests to `pathname`; `reply`
// answers them instead of the shared mock when given.
async function record(page, method, pathname, reply) {
  const bodies = []
  await page.route(
    (u) => new URL(u).pathname === pathname,
    async (route) => {
      const req = route.request()
      if (req.method() !== method) return route.fallback()
      bodies.push(req.postDataJSON() || {})
      if (reply) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply(req.postDataJSON() || {})) })
      return route.fallback()
    },
  )
  return bodies
}

const testOk = (resolved) => () => ({
  ok: true,
  status_code: 200,
  item_count: 15,
  sample_titles: ['First video', 'Second video'],
  error_kind: null,
  error: null,
  resolved_url: resolved,
})

// Polls a sync or async condition; the UI settles over a render or two.
async function waitFor(fn, ms = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !!(await fn())
}

const isDisabled = (page, name) => page.getByRole('button', { name, exact: true }).isDisabled()

const MENU = 'aside[aria-label="menu"]'

async function openMenu(page) {
  await page.locator('button[aria-label="open menu"]').click()
  await menuOpened(page)
}

// The Menu has slid in and takes input.
async function menuOpened(page) {
  await page.waitForFunction(() => {
    const a = document.querySelector('aside[aria-label="menu"]')
    if (!a || a.hasAttribute('inert')) return false
    const r = a.getBoundingClientRect()
    return r.right <= innerWidth + 0.5 && a.getAnimations().every((x) => x.playState !== 'running')
  }, null, { timeout: 5000 })
}

// A feed row is open when its controls show: the expanded row, or (until
// PR6 replaces it) the old edit form the Menu's › lands in.
const rowOpen = (page, id) =>
  page.locator(`#feed-${id}`).locator('button[aria-expanded="true"], input[type="text"], input[type="url"]').count().then((n) => n > 0)

// True when el's box sits inside the visible part of its scroller.
async function inView(page, selector, scrollerSelector) {
  return page.evaluate(([sel, scSel]) => {
    const el = document.querySelector(sel)
    const sc = el && (scSel ? el.closest(scSel) : null)
    if (!el) return false
    const r = el.getBoundingClientRect()
    const box = sc ? sc.getBoundingClientRect() : { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
    return r.top >= box.top - 1 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top < box.bottom
  }, [selector, scrollerSelector])
}

// --- H1: harness helpers ----------------------------------------------------

// Runs in the page before the app (addInitScript; a CSP doesn't apply).
// window.__harness collects what the stubs and the fetch wrapper saw.
function harnessInit() {
  const h = (window.__harness = { fetches: [], opened: [], shared: [], copied: [] })
  const realFetch = window.fetch
  window.fetch = function (input, init) {
    let rec = null
    try {
      const req = input instanceof Request ? input : null
      const url = new URL(req ? req.url : String(input), location.href)
      if (/^\/api\/(preferences|interactions)(\/|$)/.test(url.pathname)) {
        rec = {
          method: String((init && init.method) || (req && req.method) || 'GET').toUpperCase(),
          path: url.pathname,
          keepalive: !!(init && 'keepalive' in init ? init.keepalive : req && req.keepalive),
          answered: false,
        }
        h.fetches.push(rec)
      }
    } catch {
      // A URL the wrapper can't read is still fetched as usual.
    }
    const res = realFetch.apply(this, arguments)
    if (rec) {
      // `answered` turns true once the app has read the body (or the
      // request failed). These callbacks run before the app's own, and
      // everything the app does with the answer up to its next await on
      // the network is microtasks, so a later evaluate that sees
      // `answered` sees the app's handling of it too.
      res.then(
        (r) => {
          const json = r.json
          r.json = function () {
            const body = json.apply(this, arguments)
            const done = () => {
              rec.answered = true
            }
            body.then(done, done)
            return body
          }
        },
        () => {
          rec.answered = true
        },
      )
    }
    return res
  }
  window.open = (url, target) => {
    h.opened.push({ url: url == null ? '' : String(url), target: target == null ? '' : String(target) })
    return null
  }
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data) => {
      h.shared.push({ ...(data || {}) })
    },
  })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        h.copied.push(String(text))
      },
      readText: async () => h.copied[h.copied.length - 1] || '',
    },
  })
}

const installHarness = (page) => page.addInitScript(harnessInit)

// What the stubs and the fetch wrapper recorded so far:
// { fetches: [{ method, path, keepalive, answered }], opened, shared, copied }.
const harnessLog = (page) => page.evaluate(() => window.__harness)
// The app has taken in the answer to its latest `method` request to `path`
// (a flow waits for this before moving the clock or the page's
// visibility, so a retry or a return doesn't race the answer).
const answered = (page, method, path) =>
  harnessLog(page).then((h) => {
    const sent = h.fetches.filter((f) => f.method === method && f.path === path)
    return sent.length > 0 && sent[sent.length - 1].answered
  })

const isChromium = (page) => page.context().browser().browserType().name() === 'chromium'

// Installs the fake clock at F.NOW. touchDrag then waits in Node instead
// of on animation frames, which a paused clock never delivers.
async function installClock(page, time = F.NOW) {
  page._clockInstalled = true
  await page.clock.install({ time })
}

async function tap(page, locator) {
  await locator.tap()
  page._taps = (page._taps || 0) + 1
}

// False (and one failure under `id`) when more than `max` taps were used.
function taps(page, max, id) {
  const n = page._taps || 0
  if (n <= max) return true
  page._fail(id, `${n} taps, expected at most ${max}`)
  return false
}

// One finger from `from` to `to` ({ x, y } in CSS pixels) through CDP touch
// events: `steps` moves `stepMs` apart, then `holdMs` still before the
// finger lifts. Counts as one tap. Chromium only (the WebKit run is report
// only): elsewhere it does nothing and returns false. Assert outcomes (a
// request sent or not, a card hidden, a transform, defaultPrevented), never
// exact scroll offsets. Chromium doesn't deliver page touch moves under
// about 40px, so rules about small movements belong in unit tests.
async function touchDrag(page, { from, to, steps = 10, stepMs = 50, holdMs = 150 }) {
  if (!isChromium(page)) return false
  // A drag right after load sometimes didn't scroll; two frames plus
  // 300 ms always did.
  if (!page._clockInstalled) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  await sleep(300)
  const cdp = await page.context().newCDPSession(page)
  const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 1, radiusY: 1, force: 1 }]
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) })
    for (let i = 1; i <= steps; i++) {
      await sleep(stepMs)
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) })
    }
    await sleep(holdMs)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach().catch(() => {})
  }
  page._taps = (page._taps || 0) + 1
  return true
}

// Leaving the app and coming back: iOS sets both visibilityState and
// hidden, then fires visibilitychange (the app reads visibilityState).
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    const state = h ? 'hidden' : 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

const flow = (name, fields) => ({
  name,
  url: '/?view=settings&tab=feeds',
  widths: [390],
  checks: false,
  ...fields,
  before: async (ctx) => {
    await installHarness(ctx.page)
    if (fields.before) await fields.before(ctx)
  },
  run:
    fields.run &&
    (async (ctx) => {
      ctx.page._taps = 0
      ctx.page._fail = ctx.fail
      return fields.run(ctx)
    }),
})

// PR5 flows run from the dashboard.
const dashFlow = (name, fields) => flow(name, { url: '/', ...fields })

// --- PR8: the AI tab --------------------------------------------------------

// Opens Settings › AI with the server's AI settings as `opts` describe
// (provider: null = Default; anthropic: whether its key is saved here;
// configured: what /api/llm/status says). PUTs are recorded in
// page._puts and change the settings the way the server would.
const aiFlow = (name, opts, fields) =>
  flow(name, {
    url: '/?view=settings&tab=llm',
    before: async ({ page }) => {
      const state = { ...F.SETTINGS }
      if ('provider' in opts) Object.assign(state, { llm_provider: opts.provider, llm_model_brief: null, llm_model_scoring: null })
      if ('anthropic' in opts) state.anthropic_api_key_set = opts.anthropic
      const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      await page.route(
        (u) => new URL(u).pathname === '/api/settings',
        (route) => (route.request().method() === 'GET' ? route.fulfill(json(state)) : route.fallback()),
      )
      if ('configured' in opts) {
        await page.route(
          (u) => new URL(u).pathname === '/api/llm/status',
          (route) => route.fulfill(json({ configured: opts.configured, backend: null, model: null })),
        )
      }
      page._puts = await record(page, 'PUT', '/api/settings/llm', (body) => {
        if ('provider' in body) state.llm_provider = body.provider || null
        if ('model_brief' in body) state.llm_model_brief = body.model_brief || null
        if ('model_scoring' in body) state.llm_model_scoring = body.model_scoring || null
        for (const id of ['anthropic', 'openai', 'groq', 'ollama_cloud']) {
          if (`${id}_api_key` in body) state[`${id}_api_key_set`] = !!body[`${id}_api_key`]
        }
        return state
      })
    },
    ...fields,
  })

// --- PR6: the feed editor ---------------------------------------------------

const MOBILE_MAIN = 'main.md\\:hidden'
const STRIP = '[role="tablist"][aria-label="dashboard sections"]'
const ROW = (id) => `#feed-${id}`
const editorUrl = (id) => `/?view=settings&tab=feeds&source=${id}`
// Starts on a feed's editor through its link.
const editorFlow = (name, id, fields) => flow(name, { url: editorUrl(id), ...fields })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitEditor(page, id) {
  await page.locator(SETTINGS).waitFor({ state: 'visible' })
  await page.locator(`${ROW(id)} button[aria-expanded="true"]`).waitFor({ state: 'visible' })
}

// Opens a feed's editor from the dashboard the way App does (one history
// entry), without going through the Menu.
async function openEditor(page, id) {
  await page.evaluate((u) => {
    history.pushState({ popping: 'settings' }, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, editorUrl(id))
  await waitEditor(page, id)
}

async function closeSettings(page) {
  await page.locator('button[aria-label="close settings"]').click()
  await page.locator(SETTINGS).waitFor({ state: 'detached' })
}

const field = (page, id, label) => page.locator(ROW(id)).getByLabel(label, { exact: true })
const rowButton = (page, id, name) => page.locator(ROW(id)).getByRole('button', { name, exact: true })
const savedShown = (page, id) => page.locator(ROW(id)).getByText('Saved ✓').first().isVisible()

// Holds each PATCH to /api/sources/<id> for `ms` before it goes on;
// page._patchesReleased counts the ones let through.
async function delayPatches(page, id, ms) {
  page._patchesReleased = 0
  await page.route(
    (u) => new URL(u).pathname === `/api/sources/${id}`,
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      await sleep(ms)
      page._patchesReleased++
      return route.fallback()
    },
  )
}

// The next GET of `pathname` waits `ms` and answers `body`: a poll that
// started before a change and lands after it.
async function stalePoll(page, pathname, body, ms) {
  await page.route(
    (u) => new URL(u).pathname === pathname,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await sleep(ms)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
    { times: 1 },
  )
}

// What the app does when it comes back to the front: a quiet poll.
const startPoll = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

const selectedTab = async (page) => ((await page.locator(`${STRIP} [aria-selected="true"]`).first().textContent()) || '').trim()
const tabTexts = (page) => page.locator(`${STRIP} [role="tab"]`).allTextContents()
// The phone tab whose text matches `re`, and the tab key the phone stored.
const phoneTab = (page, re) => page.locator(`${STRIP} [role="tab"]`).filter({ hasText: re }).first()
const storedTab = (page) => page.evaluate(() => localStorage.getItem('popping.v1.mobileTab'))

// The element at the centre of `locator`'s box is it or inside it.
const onTop = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!at && (at === el || el.contains(at))
  })

// --- PR1r: reload on a new build ----------------------------------------------

// The server "deploys" a new build: fetches of / (the update check's, not
// page loads) get index.html with its entry script renamed to
// page._nextScript (index-next*.js), which answers HEAD with a script (or
// a 404 when its name says "gone"). With page._nextScript null they get
// the build the page runs. page._hold, when set, is a promise each such
// fetch waits for (counted before it waits); one the page called off
// meanwhile is dropped. Under vite preview a real reload still loads the old build,
// so the reloaded page runs the old id against the new one again.
// The log: { checks, heads, navs, events } counts the update check's
// fetches of /, the HEADs of a new script and the page loads after the
// first; events lists 'put-done' and 'nav' in the order they happened.
async function newBuild(page) {
  const log = { checks: 0, heads: [], navs: 0, events: [] }
  page._nextScript = '/static/index-next.js'
  await page.route(
    (u) => new URL(u).pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'fetch') return route.fallback()
      log.checks++
      if (page._hold) await page._hold
      try {
        const res = await route.fetch()
        const html = await res.text()
        const next = page._nextScript
        await route.fulfill({ response: res, body: next ? html.replace(/\/static\/index-[^"]+\.js/, next) : html })
      } catch {
        // The page aborted the fetch while it was held (a hide).
      }
    },
  )
  await page.route(
    (u) => /^\/static\/index-(next\d*|gone)\.js$/.test(new URL(u).pathname),
    (route) => {
      const p = new URL(route.request().url()).pathname
      log.heads.push(`${route.request().method()} ${p}`)
      if (p.includes('gone')) return route.fulfill({ status: 404, contentType: 'text/plain', body: '' })
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    },
  )
  let loads = 0
  page.on('request', (r) => {
    if (r.resourceType() !== 'document' || r.frame() !== page.mainFrame()) return
    if (++loads > 1) {
      log.navs++
      log.events.push('nav')
    }
  })
  return log
}

// Away from the app for `minutes` of the page's clock, then back.
async function away(page, minutes) {
  await setHidden(page, true)
  const now = await page.evaluate(() => Date.now())
  await page.clock.setSystemTime(now + minutes * 60_000)
  await setHidden(page, false)
}

// --- PR1c: preferences and the brief -----------------------------------------

// A brief the mock's /api/brief/latest can answer with.
const BRIEF = {
  id: 1,
  generated_at: new Date(F.NOW - 2 * 3600000).toISOString(),
  tone: 'terse',
  content: 'TODAY IN ONE SENTENCE\nA quiet day.\nHIGHLIGHTS\n- Nothing much happened.',
  delivered_at: null,
  meta: null,
}

// Writes `rows` ({ key: value }) into the mock's preference store, then
// reloads, so the app reads them the way it would from the server.
async function putPrefs(page, rows) {
  prefMock(page.context()).seed(rows)
  await page.reload()
  await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible' })
}

// Every interaction event the app POSTs (one or a batch) from now on,
// in page._events; they go on to the mock.
async function recordInteractions(page) {
  page._events = []
  await page.route(
    (u) => /^\/api\/interactions(\/batch)?$/.test(new URL(u).pathname),
    (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const b = req.postDataJSON() || {}
        for (const e of b.events || [b]) page._events.push(e)
      }
      return route.fallback()
    },
  )
}
const bookmarksFor = (page, id) => page._events.filter((e) => e.type === 'bookmark' && e.entry_id === id).length

// Every PUT, PATCH and DELETE to /api/preferences/<key> from now on, in
// the order sent, as { method, key, value, body } (`value` a PUT's,
// `body` a PATCH's change); they go on to the mock.
async function prefWrites(page) {
  const out = []
  await page.route(
    (u) => new URL(u).pathname.startsWith('/api/preferences/'),
    (route) => {
      const req = route.request()
      const method = req.method()
      if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const key = decodeURIComponent(new URL(req.url()).pathname.slice('/api/preferences/'.length))
        const body = method === 'DELETE' ? undefined : req.postDataJSON() || {}
        out.push({ method, key, value: method === 'PUT' ? body.value : undefined, body: method === 'PATCH' ? body : undefined })
      }
      return route.fallback()
    },
  )
  return out
}

// The ids a recorded PATCH body adds to (or removes from) its key.
const patched = (writes, key, op) => writes.filter((w) => w.method === 'PATCH' && w.key === key).flatMap((w) => w.body[op] || [])

// --- PR7a: tab order and hiding -----------------------------------------------

const TABS_EDITOR = '[role="dialog"][aria-label="edit tabs"]'
const editPill = (page) => page.locator('button[data-edit-tabs]')
const editorButton = (page, name) => page.locator(TABS_EDITOR).getByRole('button', { name, exact: true })
const showSwitch = (page, label) => page.locator(TABS_EDITOR).getByRole('switch', { name: `Show ${label}`, exact: true })
const focusedLabel = (page) => page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('aria-label')) || '')
const announced = async (page) => ((await page.locator(`${TABS_EDITOR} [aria-live="polite"]`).textContent()) || '').trim()
// The strip's tab labels, without their counts.
const stripLabels = async (page) => (await tabTexts(page)).map((t) => t.replace(/\d+$/, '').trim())
// The Menu's Jump to column rows, in order (the Menu is open).
const jumpLabels = async (page) =>
  (await page.locator(MENU).locator('h3:text-matches("jump to column", "i")').locator('xpath=../..').getByRole('button').allTextContents()).map((t) => t.trim())
// The desktop grid's column headings, in order.
const gridLabels = async (page) => (await page.locator('main.grid section header h2').allTextContents()).map((t) => t.trim())
const layoutWrites = (writes) => writes.filter((w) => w.key === 'category_layout')
// The tab order a move stores, as every tab but Brief in the default
// order: Saved, For You, then the fixture's categories with stories by
// label (CATEGORY_40 has none until PR4d).
const DEFAULT_ORDER = ['meta:saved', 'meta:foryou', 'cat:deals', 'cat:nhl', 'cat:news', 'cat:podcast', 'cat:security', 'cat:video']

async function openTabsEditor(page) {
  await tap(page, editPill(page))
  await page.locator(TABS_EDITOR).waitFor({ state: 'visible' })
}
async function closeTabsEditor(page) {
  await tap(page, editorButton(page, 'Done'))
  await page.locator(TABS_EDITOR).waitFor({ state: 'detached' })
}

// Moves the podcast feed (11) into a new "Hockey" category from its
// editor, then back to the dashboard: the new category's tab appears.
async function newHockeyCategory(page, fail, id) {
  page._patches11 = page._patches11 || []
  await openEditor(page, 11)
  await rowButton(page, 11, 'New category').click()
  await page.fill('#fe-category-11', 'Hockey')
  await rowButton(page, 11, 'Add').click()
  if (!(await waitFor(() => page._patches11.length === 1))) return fail(id, 'no PATCH for the new category')
  await waitFor(() => savedShown(page, 11), 3000)
  await closeSettings(page)
  if (!(await waitFor(async () => (await stripLabels(page)).includes('Hockey'), 3000))) return fail(id, `no Hockey tab after the move: ${JSON.stringify(await stripLabels(page))}`)
  return true
}

// --- PR3a: desktop single scroller and batching --------------------------------

// `n` more stories from nhl_news (16) beyond the fixture's 3, ids from
// 7001, each a few minutes older than the last, so the NHL tab holds
// 3 + n stories.
const moreNhl = (n) => {
  const like = F.ENTRIES.find((e) => e.id === 602)
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(F.NOW - (500 + i * 3) * 60000).toISOString()
    return { ...like, id: 7001 + i, title: `NHL story ${i + 1}`, url: `https://example.com/16/more-${7001 + i}`, published_at: at, fetched_at: at }
  })
}

// Adds `extra` to every story list the app loads for its tabs (not
// search or a filter). The mock is a context route, so the page's own
// fetch appends them on the way in, as flow-saved-order does.
async function withStories(page, extra) {
  await page.addInitScript((rows) => {
    const orig = window.fetch
    window.fetch = async (...args) => {
      const res = await orig(...args)
      const u = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href)
      if (u.pathname !== '/api/entries' || u.searchParams.get('q') || u.searchParams.getAll('source').length) return res
      const got = await res.clone().json()
      if (!Array.isArray(got)) return res
      return new Response(JSON.stringify([...got, ...rows]), { status: res.status, statusText: res.statusText, headers: res.headers })
    }
  }, extra)
}

// The cards a Column has rendered so far.
const cardCount = (column) => column.locator('article[data-card-id]').count()
// Scrolls the sentinel's scroller (the nearest `[data-scroller]` around
// it) until the sentinel sits `px` below the scroller's visible bottom:
// inside the 600px margin, still out of sight. False when the column
// has no sentinel.
const sentinelBelow = (column, px) =>
  column.evaluate((col, d) => {
    const el = col.querySelector('[data-more]')
    const sc = el && el.closest('[data-scroller]')
    if (!sc) return false
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().bottom - d
    return true
  }, px)

module.exports = [
  flow('flow-fj-youtube-handle', {
    before: async ({ page }) => {
      page._tests = await record(page, 'POST', '/api/sources/test', testOk(CHANNEL_FEED))
      page._posts = await record(page, 'POST', '/api/sources')
    },
    run: async ({ page, fail }) => {
      await openAddTab(page)
      await page.locator('input[type="radio"][value="youtube_channel"]').check({ force: true })
      await page.fill('#fm-url', '@somehandle')
      if (await isDisabled(page, 'Test')) fail('FJ', 'Test is disabled with @handle and no name')
      if (await isDisabled(page, 'Add feed')) fail('FJ', 'Add feed is disabled with @handle and no name')
      await page.getByRole('button', { name: 'Test', exact: true }).click()
      await page.locator('[data-test-result="ok"]').waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Add feed', exact: true }).click()
      if (!(await waitFor(() => page._posts.length === 1))) return fail('FJ', `expected 1 POST, saw ${page._posts.length}`)
      const body = page._posts[0]
      if (body.url !== CHANNEL_FEED) fail('FJ', `POST url is ${body.url}, expected the resolved feed`)
      if (body.name !== 'somehandle_yt') fail('FJ', `POST name is ${body.name}, expected somehandle_yt`)
      if (body.type !== 'youtube_channel') fail('FJ', `POST type is ${body.type}`)
      if (page._tests.length !== 1) fail('FJ', `expected 1 Test request, saw ${page._tests.length}`)
    },
  }),

  flow('flow-fj2-youtube-video-link', {
    before: async ({ page }) => {
      page._tests = await record(page, 'POST', '/api/sources/test', testOk(CHANNEL_FEED))
      page._posts = await record(page, 'POST', '/api/sources')
    },
    run: async ({ page, fail }) => {
      await openAddTab(page)
      await page.locator('input[type="radio"][value="youtube_channel"]').check({ force: true })
      await page.fill('#fm-url', 'https://www.youtube.com/watch?v=abcdefghijk')
      if (!(await page.getByText('Name is chosen after Test.').isVisible())) fail('FJ2', 'no "Name is chosen after Test." hint')
      await page.getByRole('button', { name: 'Add feed', exact: true }).click()
      if (!(await waitFor(() => page._posts.length === 1))) return fail('FJ2', `expected 1 POST, saw ${page._posts.length}`)
      if (page._tests.length !== 1) fail('FJ2', `expected Add to run 1 Test first, saw ${page._tests.length}`)
      const body = page._posts[0]
      if (body.url !== CHANNEL_FEED) fail('FJ2', `POST url is ${body.url}, expected the resolved feed`)
      if (body.name !== 'channel_qrstuv_yt') fail('FJ2', `POST name is ${body.name}, expected channel_qrstuv_yt`)
    },
  }),

  flow('flow-fp-auto-subreddit', {
    before: async ({ page }) => {
      page._auto = await record(page, 'POST', '/api/sources/auto')
      page._posts = await record(page, 'POST', '/api/sources')
    },
    run: async ({ page, fail }) => {
      await openAddTab(page)
      await page.fill('input[aria-label="link to add"]', 'r/python')
      await page.getByRole('button', { name: 'Auto-add', exact: true }).click()
      await page.waitForTimeout(300)
      if (!(await page.locator('input[type="radio"][value="reddit"]').isChecked())) fail('FP', 'the form did not switch to Subreddit')
      const value = await page.locator('#fm-url').inputValue()
      if (value !== 'r/python') fail('FP', `the address field holds ${JSON.stringify(value)}`)
      if (page._auto.length || page._posts.length) fail('FP', 'a request was sent for a subreddit paste')
    },
  }),

  flow('flow-fq-new-category', {
    before: async ({ page }) => {
      page._posts = await record(page, 'POST', '/api/sources')
    },
    run: async ({ page, fail }) => {
      await openAddTab(page)
      await page.fill('#fm-url', 'https://example.com/feed.xml')
      await page.getByRole('button', { name: 'New category', exact: true }).click()
      await page.fill('#fm-category', 'NEWS')
      if (!(await isDisabled(page, 'Add feed'))) fail('FQ', 'Add feed is enabled while a new category is pending')
      if (!(await page.getByText('Finish or cancel the new category.').isVisible())) fail('FQ', 'no hint while a new category is pending')
      if (!(await page.getByText('Using your existing “News” category').isVisible())) fail('FQ', 'no "Using your existing" line for NEWS')
      await page.locator('#fm-category').press('Enter')
      const picked = await page.locator('select#fm-category').inputValue()
      if (picked !== 'news') fail('FQ', `the picker holds ${JSON.stringify(picked)} after NEWS, expected "news"`)
      await page.getByRole('button', { name: 'Add feed', exact: true }).click()
      if (!(await waitFor(() => page._posts.length === 1))) return fail('FQ', 'no POST after Add feed')
      if (page._posts[0].category !== 'news') fail('FQ', `POST category is ${JSON.stringify(page._posts[0].category)}`)

      // The form clears once the first feed is added.
      if (!(await waitFor(async () => (await page.locator('#fm-url').inputValue()) === ''))) return fail('FQ', 'the form did not clear after Add')
      await page.fill('#fm-url', 'https://example.org/hockey.xml')
      await page.getByRole('button', { name: 'New category', exact: true }).click()
      await page.fill('#fm-category', 'Hockey')
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      const select = page.locator('select#fm-category')
      const value = await select.inputValue()
      const text = await select.evaluate((el) => el.options[el.selectedIndex]?.textContent || '')
      if (value !== 'Hockey' || text !== 'Hockey (new)') fail('FQ', `selected option is ${JSON.stringify(text)} (${JSON.stringify(value)})`)
      await page.getByRole('button', { name: 'Add feed', exact: true }).click()
      if (!(await waitFor(() => page._posts.length === 2))) return fail('FQ', 'no second POST')
      if (page._posts[1].category !== 'Hockey') fail('FQ', `second POST category is ${JSON.stringify(page._posts[1].category)}`)
    },
  }),

  flow('flow-fr-headers', {
    before: async ({ page }) => {
      page._posts = await record(page, 'POST', '/api/sources')
    },
    run: async ({ page, fail }) => {
      await openAddTab(page)
      await page.fill('#fm-url', 'https://example.com/feed.xml')
      await page.locator('button[aria-controls="fm-headers"]').click()
      await page.getByRole('button', { name: 'Add header', exact: true }).click()
      await page.locator('#fm-headers input[aria-label="header name"]').last().fill('X-Test')
      await page.locator('#fm-url').focus()
      if (!(await page.getByText('Fill in both to save this header.').isVisible())) fail('FR', 'no row error for a half-filled header')
      if (!(await waitFor(() => isDisabled(page, 'Test'), 2000))) fail('FR', 'Test is enabled with a half-filled header')
      if (!(await waitFor(() => isDisabled(page, 'Add feed'), 2000))) fail('FR', 'Add feed is enabled with a half-filled header')
      await page.locator('#fm-headers input[placeholder="Value"]').last().fill('abc')
      if (!(await waitFor(async () => !(await isDisabled(page, 'Add feed')), 2000))) fail('FR', 'Add feed stays disabled once the header is complete')
      await page.locator('input[type="radio"][value="reddit"]').check({ force: true })
      await page.fill('#fm-url', 'r/python')
      await page.getByRole('button', { name: 'Add feed', exact: true }).click()
      if (!(await waitFor(() => page._posts.length === 1))) return fail('FR', 'no POST for the subreddit')
      if ('custom_headers' in page._posts[0]) fail('FR', `the subreddit POST carries custom_headers ${JSON.stringify(page._posts[0].custom_headers)}`)
    },
  }),

  dashFlow('flow-fg-settings-back', {
    run: async ({ page, fail }) => {
      // An app entry to come back to, so Back stays inside the app.
      await page.evaluate(() => history.pushState(null, '', '/?start=1'))
      const before = await page.evaluate(() => history.length)
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: /^Settings/ }).click()
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      const tab = await page.locator(`${SETTINGS} [role="tablist"]:not([aria-label]) [aria-selected="true"]`).first().textContent()
      if (!/Feeds/.test(tab || '')) fail('FG', `Menu → Settings opened ${JSON.stringify(tab)}, expected Feeds`)
      await page.locator('button[aria-label="close settings"]').click()
      await page.locator(SETTINGS).waitFor({ state: 'detached' })
      const after = await page.evaluate(() => history.length)
      if (after - before > 1) fail('FG', `history grew by ${after - before} for one open and close`)
      await page.goBack()
      await page.waitForTimeout(400)
      if (await page.locator(SETTINGS).count()) fail('FG', 'Back after Done reopened Settings')
      const u = new URL(page.url())
      if (!/^https?:$/.test(u.protocol)) fail('FG', `Back left the app: ${page.url()}`)
      for (const k of ['view', 'tab', 'source']) if (u.searchParams.has(k)) fail('FG', `the URL still has ${k}: ${page.url()}`)
    },
  }),

  dashFlow('flow-ft-menu-edit-feed', {
    run: async ({ page, fail }) => {
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: 'edit The Verge', exact: true }).click()
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      await page.locator('#feed-4').waitFor({ state: 'visible' })
      if (!(await waitFor(() => rowOpen(page, 4), 3000))) fail('FT', 'the_verge is not open after its ›')
      await page.waitForTimeout(300)
      if (!(await inView(page, '#feed-4', '.overflow-y-auto'))) fail('FT', 'the_verge is not scrolled into view')
      if (!/source=4/.test(page.url())) fail('FT', `the URL has no source=4: ${page.url()}`)
      // Another feed while Settings stays open, through the URL.
      await page.evaluate(() => {
        const u = new URL(location.href)
        u.searchParams.set('source', '11')
        history.replaceState(history.state, '', u.toString())
        dispatchEvent(new PopStateEvent('popstate'))
      })
      if (!(await waitFor(() => rowOpen(page, 11), 3000))) fail('FT', 'darknet_diaries did not open from the URL')
      await page.waitForTimeout(300)
      if (!(await inView(page, '#feed-11', '.overflow-y-auto'))) fail('FT', 'darknet_diaries is not scrolled into view')
      if (await rowOpen(page, 4)) fail('FT', 'the_verge stayed open')
    },
  }),

  dashFlow('flow-fu-jump-to-column', {
    run: async ({ page, fail }) => {
      const STRIP = '[role="tablist"][aria-label="dashboard sections"]'
      await openMenu(page)
      // The last column, which starts outside the strip's visible area.
      const rows = page.locator(MENU).locator('h3:text-matches("jump to column", "i")').locator('xpath=../..').getByRole('button')
      const last = rows.last()
      const label = ((await last.textContent()) || '').trim()
      await last.click()
      await page.waitForTimeout(600)
      const selected = page.locator(`${STRIP} [aria-selected="true"]`).first()
      const text = ((await selected.textContent()) || '').trim()
      if (!text.startsWith(label)) fail('FU', `selected tab is ${JSON.stringify(text)}, expected ${JSON.stringify(label)}`)
      if (!(await inView(page, `${STRIP} [aria-selected="true"]`, STRIP))) fail('FU', 'the selected tab is outside the strip')
    },
  }),

  dashFlow('flow-menu-closed-inert', {
    run: async ({ page, fail }) => {
      await openMenu(page)
      await page.locator('button[aria-label="close menu"]').click()
      await page.waitForTimeout(500)
      const focusedMenu = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      if (focusedMenu !== 'open menu') fail('MENU', `focus went to ${JSON.stringify(focusedMenu)} after closing, expected the ≡ button`)
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab')
        const inMenu = await page.evaluate(() => !!document.activeElement?.closest('aside[aria-label="menu"]'))
        if (inMenu) return fail('MENU', `Tab reached the closed Menu after ${i + 1} presses`)
      }
    },
  }),

  flow('flow-fs-auto-already-added', {
    run: async ({ page, fail }) => {
      await openAddTab(page)
      // capture.cjs answers Auto-add with the first fixture source (BBC News).
      await page.fill('input[aria-label="link to add"]', 'https://www.bbc.co.uk/news')
      await page.getByRole('button', { name: 'Auto-add', exact: true }).click()
      const ok = await page
        .getByText('Already added: BBC News')
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true, () => false)
      if (!ok) fail('FS', 'no "Already added: BBC News" toast')
    },
  }),
  dashFlow('flow-fa-category-pick', {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/4')
    },
    run: async ({ page, fail }) => {
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: 'edit The Verge', exact: true }).click()
      await waitEditor(page, 4)
      await page.locator('#fe-category-4').selectOption('tech')
      if (!(await waitFor(() => page._patches.length >= 1))) return fail('FA', 'no PATCH after picking Tech')
      if (!(await waitFor(() => savedShown(page, 4), 3000))) fail('FA', 'no "Saved ✓" after the category save')
      await sleep(300)
      if (page._patches.length !== 1) fail('FA', `expected 1 PATCH, saw ${page._patches.length}`)
      if (JSON.stringify(page._patches[0]) !== '{"category":"tech"}') fail('FA', `PATCH body is ${JSON.stringify(page._patches[0])}`)
    },
  }),

  dashFlow('flow-fa2-new-category-existing', {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/11')
    },
    run: async ({ page, fail }) => {
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: 'edit Darknet Diaries', exact: true }).click()
      await waitEditor(page, 11)
      await rowButton(page, 11, 'New category').click()
      await page.fill('#fe-category-11', 'NEWS')
      if (!(await page.locator(ROW(11)).getByText('Using your existing “News” category').isVisible())) {
        fail('FA2', 'no "Using your existing “News” category" line')
      }
      await rowButton(page, 11, 'Add').click()
      if (!(await waitFor(() => page._patches.length >= 1))) return fail('FA2', 'no PATCH after Add')
      await sleep(300)
      if (page._patches.length !== 1) fail('FA2', `expected 1 PATCH, saw ${page._patches.length}`)
      if (JSON.stringify(page._patches[0]) !== '{"category":"news"}') fail('FA2', `PATCH body is ${JSON.stringify(page._patches[0])}`)
    },
  }),

  editorFlow('flow-fa3-new-category-reserved', 4, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/4')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 4)
      await rowButton(page, 4, 'New category').click()
      for (const name of ['For You', 'for_you']) {
        await page.fill('#fe-category-4', name)
        if (!(await page.locator(ROW(4)).getByText(/is used by the app/).isVisible())) fail('FA3', `no reserved-name error for ${JSON.stringify(name)}`)
        if (!(await rowButton(page, 4, 'Add').isDisabled())) fail('FA3', `Add is enabled for ${JSON.stringify(name)}`)
        await page.locator('#fe-category-4').press('Enter')
      }
      await sleep(300)
      if (page._patches.length) fail('FA3', `a reserved category sent ${page._patches.length} PATCH(es)`)
    },
  }),

  editorFlow('flow-fb-address-commits-on-leave', 4, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/4')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 4)
      const addr = field(page, 4, 'Address')
      await addr.click()
      await addr.press('End')
      await addr.pressSequentially('abcdefghij')
      await sleep(400)
      if (page._patches.length) fail('FB', `typing sent ${page._patches.length} PATCH(es)`)
      await addr.press('Enter')
      if (!(await waitFor(() => page._patches.length >= 1))) return fail('FB', 'no PATCH after Enter')
      await addr.focus()
      await addr.blur()
      await sleep(400)
      if (page._patches.length !== 1) fail('FB', `expected 1 PATCH after Enter and a blur, saw ${page._patches.length}`)
      if (!String(page._patches[0].url || '').endsWith('abcdefghij')) fail('FB', `PATCH body is ${JSON.stringify(page._patches[0])}`)
    },
  }),

  editorFlow('flow-fc-category-refused', 4, {
    expectedFailedLoads: ['/api/sources/4'],
    before: async ({ page }) => {
      await page.route(
        (u) => new URL(u).pathname === '/api/sources/4',
        (route) =>
          route.request().method() === 'PATCH'
            ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: "category 'For You' is reserved for a built-in column" }) })
            : route.fallback(),
      )
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 4)
      await page.locator('#fe-category-4').selectOption('tech')
      const msg = page.locator(ROW(4)).getByText(/is used by the app\. Pick another name\./)
      if (!(await waitFor(() => msg.isVisible(), 3000))) return fail('FC', 'no message for the refused category')
      const value = await page.locator('#fe-category-4').inputValue()
      if (value !== 'news') fail('FC', `the picker shows ${JSON.stringify(value)}, expected the saved "news"`)
      await msg.scrollIntoViewIfNeeded()
      if (!(await onTop(msg))) fail('FC', 'the message is covered')
    },
  }),

  editorFlow('flow-fd-network-retry', 6, {
    expectedFailedLoads: ['/api/sources/6'],
    before: async ({ page }) => {
      page._attempts = 0
      page._abort = true
      await page.route(
        (u) => new URL(u).pathname === '/api/sources/6',
        (route) => {
          if (route.request().method() !== 'PATCH') return route.fallback()
          page._attempts++
          return page._abort ? route.abort('failed') : route.fallback()
        },
      )
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const addr = field(page, 6, 'Address')
      const typed = 'https://slickdeals.net/newsearch.php?rss=2'
      await addr.fill(typed)
      await addr.press('Enter')
      const msg = page.locator(ROW(6)).getByText("Couldn't reach Popping. Check your connection.")
      if (!(await waitFor(() => msg.isVisible(), 6000))) return fail('FD', 'no network message after the save and its retry failed')
      if (page._attempts !== 2) fail('FD', `expected 2 tries (one retry), saw ${page._attempts}`)
      if ((await addr.inputValue()) !== typed) fail('FD', `the field holds ${JSON.stringify(await addr.inputValue())}, not what was typed`)
      const retry = rowButton(page, 6, 'Try again')
      if (!(await retry.isVisible())) return fail('FD', 'no Try again')
      page._abort = false
      await retry.click()
      if (!(await waitFor(() => page._attempts === 3))) return fail('FD', `Try again sent ${page._attempts - 2} request(s)`)
      if (!(await waitFor(() => savedShown(page, 6), 3000))) fail('FD', 'no "Saved ✓" after Try again')
    },
  }),

  editorFlow('flow-fe-browser-identity', 4, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/4')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 4)
      // The preset among the headers (the Last problem box has one too,
      // used in FE3).
      await rowButton(page, 4, 'Use a browser identity').last().click()
      if (!(await waitFor(() => page._patches.length >= 1))) return fail('FE', 'no PATCH after Use a browser identity')
      const headers = page._patches[0].custom_headers || {}
      if (!('User-Agent' in headers)) fail('FE', `PATCH body is ${JSON.stringify(page._patches[0])}`)
      const names = page.locator(`${ROW(4)} input[aria-label="header name"]`)
      if (!(await waitFor(async () => (await names.count()) === 1 && (await names.first().inputValue()) === 'User-Agent', 3000))) {
        fail('FE', 'the headers did not show the saved User-Agent')
      }
      await rowButton(page, 4, 'Add header').click()
      await names.last().fill('Cookie')
      await names.last().blur()
      if (!(await page.locator(ROW(4)).getByText("Popping can't send a Cookie header.").isVisible())) fail('FE', 'no message for a Cookie header')
      await sleep(300)
      if (page._patches.length !== 1) fail('FE', `a refused header sent ${page._patches.length - 1} PATCH(es)`)
    },
  }),

  editorFlow('flow-fe2-add-header-keeps-focus', 6, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      await rowButton(page, 6, 'Add header').click()
      await page.locator(`${ROW(6)} input[aria-label="header name"]`).last().fill('X-Test')
      await rowButton(page, 6, 'Add header').click()
      await sleep(300)
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      if (focused !== 'header name') fail('FE2', `focus is on ${JSON.stringify(focused)}, expected the new header name`)
      if (page._patches.length) fail('FE2', `sent ${page._patches.length} PATCH(es)`)
      if (await page.locator(ROW(6)).getByText('Fill in both to save this header.').count()) fail('FE2', '"Fill in both" shows while still typing')
    },
  }),

  editorFlow('flow-fe3-preset-skips-half-row', 4, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/4')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 4)
      await rowButton(page, 4, 'Add header').click()
      await page.locator(`${ROW(4)} input[aria-label="header name"]`).last().fill('X-Half')
      // The Last problem box's button: it saves from outside the headers,
      // so they reload from the saved map once the save lands.
      await rowButton(page, 4, 'Use a browser identity').first().click()
      if (!(await waitFor(() => page._patches.length >= 1))) return fail('FE3', 'no PATCH after the preset')
      await sleep(300)
      if (page._patches.length !== 1) fail('FE3', `expected 1 PATCH, saw ${page._patches.length}`)
      const headers = page._patches[0].custom_headers || {}
      if (!('User-Agent' in headers)) fail('FE3', `no User-Agent in ${JSON.stringify(headers)}`)
      if ('X-Half' in headers) fail('FE3', `the half-filled row was sent: ${JSON.stringify(headers)}`)
      // The reload keeps the row still being typed.
      const names = page.locator(`${ROW(4)} input[aria-label="header name"]`)
      await waitFor(async () => (await names.evaluateAll((els) => els.map((e) => e.value))).includes('User-Agent'), 3000)
      const kept = await page.locator(`${ROW(4)} input[aria-label="header name"]`).evaluateAll((els) => els.map((e) => e.value))
      if (!kept.includes('X-Half')) fail('FE3', `the half-filled row was dropped: ${JSON.stringify(kept)}`)
    },
  }),

  editorFlow('flow-ff-done-while-saving', 6, {
    before: async ({ page }) => {
      await delayPatches(page, 6, 4000)
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const typed = 'https://slickdeals.net/ff.xml'
      await field(page, 6, 'Address').fill(typed)
      await page.locator('button[aria-label="close settings"]').click()
      await page.locator(SETTINGS).waitFor({ state: 'detached', timeout: 6000 })
      // Done must not wait for the save: the sheet is gone while the
      // server is still holding the PATCH (whatever the machine's load).
      if (page._patchesReleased) fail('FF', 'the sheet closed only after the save finished')
      if (!(await waitFor(() => page._patches.length === 1, 2000))) return fail('FF', 'Done did not save the address')
      if (!(await waitFor(() => page._patchesReleased === 1, 6000))) return fail('FF', 'the delayed save never finished')
      await sleep(300)
      await openEditor(page, 6)
      const value = await field(page, 6, 'Address').inputValue()
      if (value !== typed) fail('FF', `reopened with ${JSON.stringify(value)}`)
    },
  }),

  editorFlow('flow-ff2-done-save-fails', 6, {
    expectedFailedLoads: ['/api/sources/6'],
    before: async ({ page }) => {
      await page.route(
        (u) => new URL(u).pathname === '/api/sources/6',
        (route) => (route.request().method() === 'PATCH' ? route.abort('failed') : route.fallback()),
      )
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const typed = 'https://slickdeals.net/ff2.xml'
      await field(page, 6, 'Address').fill(typed)
      await closeSettings(page)
      const toastText = page.getByText(/^Couldn't save the address for Slickdeals Frontpage: Couldn't reach Popping/)
      if (!(await waitFor(() => toastText.isVisible(), 6000))) return fail('FF', 'no toast for the failed save')
      if ((await page.locator('[role="status"]').count()) !== 1) fail('FF', 'more than one toast')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await waitEditor(page, 6)
      const value = await field(page, 6, 'Address').inputValue()
      if (value !== typed) fail('FF', `Open shows ${JSON.stringify(value)}, not the typed address`)
      if (!(await page.locator(ROW(6)).getByText("Couldn't reach Popping. Check your connection.").isVisible())) fail('FF', 'Open does not show the reason')
    },
  }),

  editorFlow('flow-fh-interval-coalesce', 6, {
    before: async ({ page }) => {
      await delayPatches(page, 6, 800)
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const select = page.locator('#fe-refresh-6')
      const current = await select.inputValue()
      const values = await select.evaluate((el) => [...el.options].map((o) => o.value))
      const picks = values.filter((v) => v !== current).slice(0, 3)
      for (const v of picks) await select.selectOption(v)
      await waitFor(() => page._patches.length >= 2, 4000)
      await sleep(1200)
      if (page._patches.length !== 2) return fail('FH', `expected 2 PATCHes for 3 quick picks, saw ${page._patches.length}`)
      const last = page._patches[1].refresh_interval_seconds
      if (last !== Number(picks[2])) fail('FH', `the second PATCH carries ${last}, expected ${picks[2]}`)
    },
  }),

  editorFlow('flow-fi-stale-poll-keeps-save', 6, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const stale = await page.evaluate(() => fetch('/api/sources').then((r) => r.json()))
      await stalePoll(page, '/api/sources', stale, 1500)
      await startPoll(page)
      await sleep(100)
      await page.locator('#fe-category-6').selectOption('tech')
      if (!(await waitFor(() => page._patches.length === 1))) return fail('FI', 'no PATCH')
      await sleep(2200)
      const value = await page.locator('#fe-category-6').inputValue()
      if (value !== 'tech') fail('FI', `a poll from before the save put the category back to ${JSON.stringify(value)}`)
    },
  }),

  editorFlow('flow-fk-fixed-fields', 1, {
    run: async ({ page, fail }) => {
      await waitEditor(page, 1)
      if ((await field(page, 1, 'Address').getAttribute('readonly')) == null) fail('FK', "the built-in's Address is editable")
      // The name is only a label, so a built-in can be renamed too.
      if ((await field(page, 1, 'Name').getAttribute('readonly')) != null) fail('FK', "the built-in's Name is read-only")
      if (await page.locator('#fe-refresh-1').count()) fail('FK', 'the built-in has an interval picker')
      if (!(await page.locator(ROW(1)).getByText(/\(built-in feed\)$/).isVisible())) fail('FK', 'no "(built-in feed)" interval text')
      if (await rowButton(page, 1, 'Add header').count()) fail('FK', 'the built-in has a Headers section')
      await page.locator(`${ROW(7)} button[aria-expanded]`).click()
      await waitEditor(page, 7)
      if (await rowButton(page, 7, 'Add header').count()) fail('FK', 'the subreddit has a Headers section')
      if (!(await field(page, 7, 'Subreddit').isVisible())) fail('FK', 'the subreddit address is not labelled Subreddit')
    },
  }),

  dashFlow('flow-fl-rename-keeps-filter-and-view', {
    before: async ({ page, context }) => {
      const preset = { id: 'p1', name: 'Deals view', activeSources: ['slickdeals_frontpage', 'rfd_hot_deals'], columnPrefs: {} }
      prefMock(context).seed({ filter_presets: [preset] })
      page._puts = await record(page, 'PUT', '/api/preferences/filter_presets')
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await openMenu(page)
      await page.locator(`${MENU} input[aria-label="filter by Slickdeals Frontpage"]`).check()
      await page.locator('button[aria-label="remove Slickdeals Frontpage from filter"]').waitFor({ state: 'visible' })
      await openEditor(page, 6)
      const name = field(page, 6, 'Name')
      // Typed as the user wants it shown: capitals and spaces kept.
      await name.fill('Slickdeals Renamed')
      await name.press('Enter')
      if (!(await waitFor(() => page._patches.length === 1))) return fail('FL', 'no PATCH for the rename')
      const body = page._patches[0]
      if (body.display_name !== 'Slickdeals Renamed' || 'name' in body) fail('FL', `the rename sent ${JSON.stringify(body)}`)
      await waitFor(() => savedShown(page, 6), 3000)
      if ((await name.inputValue()) !== 'Slickdeals Renamed') fail('FL', `the field shows ${JSON.stringify(await name.inputValue())}`)
      await closeSettings(page)
      if (!(await page.locator('button[aria-label="remove Slickdeals Renamed from filter"]').isVisible())) fail('FL', 'the filter chip did not show the new name')
      if (await page.locator('button[aria-label="remove Slickdeals Frontpage from filter"]').count()) fail('FL', 'the old name is still in the filter')
      // The feed's internal id didn't change, so the saved view needs no rewrite.
      await sleep(1500)
      if (page._puts.length) fail('FL', 'the saved view was rewritten for a label change')
    },
  }),

  dashFlow('flow-fm-phone-tab-follows', {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/16')
      page._patches11 = await record(page, 'PATCH', '/api/sources/11')
    },
    run: async ({ page, fail }) => {
      // The only feed in its column moves to another category.
      await page.locator(`${STRIP} [role="tab"]`).filter({ hasText: /nhl/i }).first().click()
      if (!/nhl/i.test(await selectedTab(page))) return fail('FM', 'could not select the NHL tab')
      await openEditor(page, 16)
      await page.locator('#fe-category-16').selectOption('news')
      if (!(await waitFor(() => page._patches.length === 1))) return fail('FM', 'no PATCH for the category')
      await waitFor(() => savedShown(page, 16), 3000)
      await closeSettings(page)
      await sleep(300)
      const tabs = await tabTexts(page)
      if (!tabs.length) return fail('FM', 'the tab bar is gone')
      if (tabs.some((t) => /nhl/i.test(t))) fail('FM', `the emptied NHL tab is still there: ${JSON.stringify(tabs)}`)
      const now = await selectedTab(page)
      if (!now || /nhl/i.test(now)) fail('FM', `selected tab is ${JSON.stringify(now)}`)
      if (!(await page.locator(`${MOBILE_MAIN} article[data-card-id]`).count())) fail('FM', 'the selected column shows nothing')

      // Another feed moves into a new column; the phone stays on Video.
      await page.locator(`${STRIP} [role="tab"]`).filter({ hasText: /video/i }).first().click()
      await openEditor(page, 11)
      await rowButton(page, 11, 'New category').click()
      await page.fill('#fe-category-11', 'Hockey')
      await rowButton(page, 11, 'Add').click()
      if (!(await waitFor(() => page._patches11.length === 1))) return fail('FM', 'no PATCH for the new category')
      await waitFor(() => savedShown(page, 11), 3000)
      await closeSettings(page)
      await sleep(300)
      if (!(await tabTexts(page)).some((t) => /hockey/i.test(t))) fail('FM', 'no Hockey tab after the move')
      const after = await selectedTab(page)
      if (!/video/i.test(after)) fail('FM', `the phone moved to ${JSON.stringify(after)} instead of staying on Video`)
    },
  }),

  // --- PR1b: tabs by key ------------------------------------------------------

  // Saving a story fills the Saved tab in front of News: the phone stays
  // on News, stores it by key, and opens it again after a reload.
  dashFlow('flow-tab-stays-on-star', {
    run: async ({ page, fail, shot }) => {
      await tap(page, phoneTab(page, /^news/i))
      if (!/^news/i.test(await selectedTab(page))) return fail('TAB-STAR', 'could not select the News tab')
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      await tap(page, card.locator('button[aria-label="save for later"]'))
      const saving = () => harnessLog(page).then((h) => h.fetches.some((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries'))
      if (!(await waitFor(saving, 3000))) return fail('TAB-STAR', 'the save sent no PATCH')
      await sleep(300)
      const now = await selectedTab(page)
      if (!/^news/i.test(now)) fail('TAB-STAR', `saving moved the phone to ${JSON.stringify(now)}`)
      const heading = ((await page.locator(`${MOBILE_MAIN} section header h2`).first().textContent()) || '').trim()
      if (heading !== 'News') fail('TAB-STAR', `the phone shows the ${JSON.stringify(heading)} column under the News tab`)
      await shot('saved')
      if ((await storedTab(page)) !== 'cat:news') fail('TAB-STAR', `the stored tab is ${JSON.stringify(await storedTab(page))}`)
      // The save is in the store before the reload.
      if (!(await waitFor(() => (prefMock(page.context()).value('starred_entries') || []).length === 1, 3000))) return fail('TAB-STAR', 'the save never reached the store')
      await page.reload()
      await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible' })
      // The preferences read back: Saved holds the story.
      if (!(await waitFor(() => page.evaluate(() => !!document.querySelector('[aria-label="remove from saved"]')), 3000))) return fail('TAB-STAR', 'the save was not read back after the reload')
      await sleep(300)
      const reloaded = await selectedTab(page)
      if (!/^news/i.test(reloaded)) fail('TAB-STAR', `the reload opened ${JSON.stringify(reloaded)}`)
    },
  }),

  // Unsaving the only saved story empties Saved, which stays (PR7a): the
  // phone stays on it, it says "No stories yet", and a save from For You
  // fills it again without moving the phone.
  dashFlow('flow-unsave-last-saved', {
    before: async ({ context }) => {
      prefMock(context).seed({ starred_entries: [103] })
    },
    run: async ({ page, fail, shot }) => {
      const savedTab = phoneTab(page, /^saved/i)
      if (!(await waitFor(() => answered(page, 'GET', '/api/preferences'), 3000))) return fail('UNSAVE', 'the preferences were not read')
      // A new phone opens on For You, even with Saved in front of it.
      const first = await selectedTab(page)
      if (!/^for you/i.test(first)) fail('UNSAVE', `a new phone opened on ${JSON.stringify(first)}`)
      await tap(page, savedTab)
      const cards = page.locator(`${MOBILE_MAIN} article[data-card-id]`)
      if ((await cards.count()) !== 1) return fail('UNSAVE', `Saved shows ${await cards.count()} stories, expected 1`)
      await tap(page, cards.first().locator('button[aria-label="remove from saved"]'))
      if (!(await waitFor(async () => (await cards.count()) === 0, 3000))) return fail('UNSAVE', 'Saved still shows the story after unsaving it')
      await sleep(300)
      if (!(await savedTab.count())) return fail('UNSAVE', 'the Saved tab went with its last story')
      const stayed = await selectedTab(page)
      if (!/^saved/i.test(stayed)) return fail('UNSAVE', `after unsaving, the phone shows ${JSON.stringify(stayed)}, expected Saved`)
      if ((await storedTab(page)) !== 'meta:saved') fail('UNSAVE', `the stored tab is ${JSON.stringify(await storedTab(page))} after unsaving`)
      if (!(await page.locator(MOBILE_MAIN).getByText('No stories yet', { exact: true }).isVisible())) fail('UNSAVE', 'the empty Saved tab does not say "No stories yet"')
      // Feeds of your own: no first-feed button.
      if (await page.locator(`${MOBILE_MAIN} [data-first-feed]`).count()) fail('UNSAVE', 'an empty Saved offers "Add your first feed" although there are feeds')
      await shot('empty')
      await tap(page, phoneTab(page, /^for you/i))
      await tap(page, cards.first().locator('button[aria-label="save for later"]'))
      await sleep(300)
      const now = await selectedTab(page)
      if (!/^for you/i.test(now)) fail('UNSAVE', `saving from For You moved the phone to ${JSON.stringify(now)}`)
      if ((await storedTab(page)) !== 'meta:foryou') fail('UNSAVE', `the stored tab is ${JSON.stringify(await storedTab(page))}`)
      await shot('end')
    },
  }),

  // A phone that stored the old column index opens on the tab at that
  // place, stores it as a key and drops the index, but only once the
  // preferences have loaded: here they arrive 1.5 s late, after the
  // stories, and bring the saved story that put Saved at index 0. Migrated
  // before them, index 0 would be For You.
  dashFlow('flow-tab-migrates-index', {
    // The strip, not a card: a wrong migration can land on any tab.
    wait: `${STRIP} [aria-selected="true"]`,
    before: async ({ page, context }) => {
      await page.addInitScript(() => localStorage.setItem('popping.v1.mobileCol.last', '0'))
      prefMock(context).seed({ starred_entries: [103] })
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences',
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback()
          await sleep(1500)
          return route.fallback()
        },
      )
    },
    run: async ({ page, fail }) => {
      const stored = () => page.evaluate(() => [localStorage.getItem('popping.v1.mobileTab'), localStorage.getItem('popping.v1.mobileCol.last')])
      const hasSaved = async () => (await tabTexts(page)).some((t) => /^saved/i.test(t))
      if (!(await waitFor(hasSaved, 5000))) return fail('TAB-MIGRATE', 'no Saved tab once the preferences loaded')
      if (!(await waitFor(async () => (await stored())[0] !== null, 3000))) return fail('TAB-MIGRATE', 'the old index was never migrated')
      await sleep(300)
      // Index 0 was Saved, the first column when it has stories.
      const now = await selectedTab(page)
      if (!/^saved/i.test(now)) fail('TAB-MIGRATE', `the old index 0 opened ${JSON.stringify(now)}, expected Saved`)
      const after = await stored()
      if (after[0] !== 'meta:saved') fail('TAB-MIGRATE', `the stored tab is ${JSON.stringify(after[0])}`)
      if (after[1] !== null) fail('TAB-MIGRATE', `the old index is still stored: ${JSON.stringify(after[1])}`)
    },
  }),

  // A stored tab whose category went while the phone was away opens on
  // For You (the fresh-device tab), not on Brief, which is all the strip
  // holds before the first refresh; For You is then the stored tab.
  dashFlow('flow-tab-gone-on-load', {
    wait: `${STRIP} [aria-selected="true"]`,
    before: async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('popping.v1.mobileTab', 'cat:gone'))
    },
    run: async ({ page, fail }) => {
      if (!(await waitFor(async () => (await storedTab(page)) !== 'cat:gone', 3000))) return fail('TAB-GONE', 'the missing tab is still stored')
      const now = await selectedTab(page)
      if (!/^for you/i.test(now)) fail('TAB-GONE', `a stored tab that went opened ${JSON.stringify(now)}, expected For You`)
      if ((await storedTab(page)) !== 'meta:foryou') fail('TAB-GONE', `the stored tab is ${JSON.stringify(await storedTab(page))}`)
    },
  }),

  // Clearing the source filter brings the phone back to its tab, even while
  // the unfiltered stories are still on the way: until they land the strip
  // holds only the filtered feed's category, so News looks gone.
  dashFlow('flow-filter-clear-keeps-tab', {
    run: async ({ page, fail }) => {
      await tap(page, phoneTab(page, /^news/i))
      if (!/^news/i.test(await selectedTab(page))) return fail('FILTER-TAB', 'could not select the News tab')
      await openMenu(page)
      await page.locator(`${MENU} input[aria-label="filter by Slickdeals Frontpage"]`).check()
      await page.locator('button[aria-label="remove Slickdeals Frontpage from filter"]').waitFor({ state: 'visible' })
      // The filtered refresh has landed: Brief and the filter's column.
      if (!(await waitFor(async () => (await tabTexts(page)).length === 2, 3000))) return fail('FILTER-TAB', `the filter left ${JSON.stringify(await tabTexts(page))}`)
      await sleep(500)
      if ((await storedTab(page)) !== 'cat:news') fail('FILTER-TAB', `the filter replaced the stored tab with ${JSON.stringify(await storedTab(page))}`)
      await page.route(
        (u) => new URL(u).pathname === '/api/entries',
        async (route) => {
          await sleep(1500)
          return route.fallback()
        },
      )
      await tap(page, page.getByRole('button', { name: 'clear all' }))
      // The unfiltered refresh is still on the way.
      await sleep(700)
      if ((await storedTab(page)) !== 'cat:news') fail('FILTER-TAB', `clearing the filter stored ${JSON.stringify(await storedTab(page))} before the stories came back`)
      if (!(await waitFor(async () => (await tabTexts(page)).some((t) => /^news/i.test(t)), 5000))) return fail('FILTER-TAB', 'no News tab after clearing the filter')
      await sleep(300)
      const now = await selectedTab(page)
      if (!/^news/i.test(now)) fail('FILTER-TAB', `after clearing the filter the phone shows ${JSON.stringify(now)}, expected News`)
      if ((await storedTab(page)) !== 'cat:news') fail('FILTER-TAB', `the stored tab is ${JSON.stringify(await storedTab(page))}`)
    },
  }),

  // A For You request that fails empties the tab for one refresh, but it
  // stays (PR7a): the phone stays on For You, keeps it as its tab, and
  // shows its stories again when For You loads.
  dashFlow('flow-foryou-fails-keeps-tab', {
    expectedFailedLoads: ['/api/foryou'],
    run: async ({ page, fail }) => {
      if (!/^for you/i.test(await selectedTab(page))) return fail('FY-FAIL', `a new phone opened on ${JSON.stringify(await selectedTab(page))}`)
      if (!(await waitFor(async () => (await storedTab(page)) === 'meta:foryou', 3000))) return fail('FY-FAIL', `the stored tab is ${JSON.stringify(await storedTab(page))}`)
      let failing = true
      await page.route(
        (u) => new URL(u).pathname === '/api/foryou',
        (route) => (failing ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }) : route.fallback()),
      )
      const cards = page.locator(`${MOBILE_MAIN} article[data-card-id]`)
      await startPoll(page)
      if (!(await waitFor(async () => (await cards.count()) === 0, 3000))) return fail('FY-FAIL', 'For You kept its stories after its request failed')
      await sleep(300)
      if (!(await tabTexts(page)).some((t) => /^for you/i.test(t))) fail('FY-FAIL', 'the For You tab went while its request fails')
      if (!/^for you/i.test(await selectedTab(page))) fail('FY-FAIL', `while For You fails the phone shows ${JSON.stringify(await selectedTab(page))}`)
      if ((await storedTab(page)) !== 'meta:foryou') fail('FY-FAIL', `a failed For You request stored ${JSON.stringify(await storedTab(page))}`)
      failing = false
      await startPoll(page)
      if (!(await waitFor(async () => (await cards.count()) > 0, 3000))) return fail('FY-FAIL', 'For You did not show its stories again')
      await sleep(300)
      const now = await selectedTab(page)
      if (!/^for you/i.test(now)) fail('FY-FAIL', `when For You came back the phone stayed on ${JSON.stringify(now)}`)
    },
  }),

  // While For You stays down (an empty tab, PR7a), only what hangs on it
  // waits: a new phone shows its first tab with stories without storing
  // it, but a tap stores a tab at once, and unsaving Saved's last story
  // leaves the phone on Saved.
  dashFlow('flow-foryou-down-settles', {
    expectedFailedLoads: ['/api/foryou'],
    before: async ({ page, context }) => {
      await page.route(
        (u) => new URL(u).pathname === '/api/foryou',
        (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }),
      )
      prefMock(context).seed({ starred_entries: [103] })
    },
    run: async ({ page, fail, shot }) => {
      const cards = page.locator(`${MOBILE_MAIN} article[data-card-id]`)
      if (!(await waitFor(() => page.evaluate(() => !!document.querySelector('[aria-label="remove from saved"]')), 3000))) return fail('FY-DOWN', 'the saved story was not read')
      if (!(await tabTexts(page)).some((t) => /^for you/i.test(t))) return fail('FY-DOWN', 'no For You tab while its request fails')
      await sleep(500)
      const first = await selectedTab(page)
      if (!/^saved/i.test(first)) fail('FY-DOWN', `with For You down a new phone opened on ${JSON.stringify(first)}, expected Saved`)
      if ((await storedTab(page)) !== null) fail('FY-DOWN', `a new phone stored ${JSON.stringify(await storedTab(page))} while For You is down`)
      await tap(page, phoneTab(page, /^saved/i))
      if ((await storedTab(page)) !== 'meta:saved') return fail('FY-DOWN', `a tap on Saved stored ${JSON.stringify(await storedTab(page))}`)
      await tap(page, cards.first().locator('button[aria-label="remove from saved"]'))
      if (!(await waitFor(async () => (await cards.count()) === 0, 3000))) return fail('FY-DOWN', 'Saved still shows the story after unsaving it')
      await sleep(300)
      const now = await selectedTab(page)
      if (!/^saved/i.test(now)) fail('FY-DOWN', `unsaving moved the phone to ${JSON.stringify(now)}`)
      if ((await storedTab(page)) !== 'meta:saved') fail('FY-DOWN', `after unsaving the stored tab is ${JSON.stringify(await storedTab(page))}`)
      await shot('empty')
    },
  }),

  // While For You stays down, a phone with nothing stored (or only the old
  // index) shows a tab without storing it. Saving a story there fills
  // Saved in front of it; the phone stays on that tab and still stores
  // nothing.
  ...[
    ['flow-foryou-down-holds-fresh', null],
    ['flow-foryou-down-holds-index', '1'],
  ].map(([name, index]) =>
    dashFlow(name, {
      expectedFailedLoads: ['/api/foryou'],
      before: async ({ page }) => {
        if (index != null) await page.addInitScript((i) => localStorage.setItem('popping.v1.mobileCol.last', i), index)
        await page.route(
          (u) => new URL(u).pathname === '/api/foryou',
          (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }),
        )
      },
      run: async ({ page, fail }) => {
        if (!(await tabTexts(page)).some((t) => /^for you/i.test(t))) return fail('FY-HOLD', 'no For You tab while its request fails')
        await sleep(500)
        const before = await selectedTab(page)
        if (/^(brief|saved|for you)/i.test(before)) return fail('FY-HOLD', `the phone opened on ${JSON.stringify(before)}, an empty tab`)
        if ((await storedTab(page)) !== null) fail('FY-HOLD', `stored ${JSON.stringify(await storedTab(page))} while For You is down`)
        const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
        await tap(page, card.locator('button[aria-label="save for later"]'))
        if (!(await waitFor(() => (prefMock(page.context()).value('starred_entries') || []).length === 1, 3000))) return fail('FY-HOLD', 'the save never reached the store')
        await sleep(300)
        const now = await selectedTab(page)
        if (now !== before) fail('FY-HOLD', `saving moved the phone from ${JSON.stringify(before)} to ${JSON.stringify(now)}`)
        if ((await storedTab(page)) !== null) fail('FY-HOLD', `saving stored ${JSON.stringify(await storedTab(page))} while For You is down`)
        if (index != null) {
          const old = await page.evaluate(() => localStorage.getItem('popping.v1.mobileCol.last'))
          if (old !== index) fail('FY-HOLD', `the old index was migrated while For You is down (now ${JSON.stringify(old)})`)
        }
      },
    }),
  ),

  // A failed GET /api/preferences leaves Saved unread, not gone: a phone
  // that stored Saved keeps it stored, and (from PR7a, where Saved is
  // always a tab) shows it, empty, until the preferences load.
  dashFlow('flow-prefs-fail-keeps-saved', {
    expectedFailedLoads: ['/api/preferences'],
    // Saved is empty while its preferences are unread: no card to wait for.
    wait: `${STRIP} [aria-selected="true"]`,
    before: async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('popping.v1.mobileTab', 'meta:saved'))
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' })
            : route.fallback(),
      )
    },
    run: async ({ page, fail }) => {
      await sleep(1000)
      const now = await selectedTab(page)
      if (!/^saved/i.test(now)) fail('PREFS-FAIL', `the phone shows ${JSON.stringify(now)}, expected Saved`)
      if ((await storedTab(page)) !== 'meta:saved') fail('PREFS-FAIL', `a failed preferences load stored ${JSON.stringify(await storedTab(page))}`)
      // A later poll doesn't settle it either.
      await startPoll(page)
      await sleep(1000)
      if ((await storedTab(page)) !== 'meta:saved') fail('PREFS-FAIL', `after a poll the stored tab is ${JSON.stringify(await storedTab(page))}`)
    },
  }),

  // Tapping the tab already shown scrolls its list to the top: smoothly,
  // or at once under reduced motion. Another tab opens at its own top.
  // Only the phone list carries data-scroller.
  dashFlow('flow-tap-tab-scrolls-top', {
    run: async ({ page, fail, shot }) => {
      await tap(page, phoneTab(page, /^news/i))
      const count = await page.locator('[data-scroller]').count()
      if (count !== 1) fail('TAP-TOP', `${count} elements carry data-scroller, expected 1`)
      const list = page.locator(`${MOBILE_MAIN} section [data-scroller]`)
      const top = () => list.evaluate((el) => el.scrollTop)
      const down = async () => {
        await list.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        return waitFor(async () => (await top()) > 200, 2000)
      }
      if (!(await down())) return fail('TAP-TOP', 'the News list did not scroll down')
      await tap(page, phoneTab(page, /^news/i))
      if (!(await waitFor(async () => (await top()) === 0, 3000))) fail('TAP-TOP', `a tap on the shown tab left the list at ${await top()}`)
      if (!/^news/i.test(await selectedTab(page))) fail('TAP-TOP', `the tap moved the phone to ${JSON.stringify(await selectedTab(page))}`)
      await shot('top')

      await page.emulateMedia({ reducedMotion: 'reduce' })
      if (!(await down())) return fail('TAP-TOP', 'the News list did not scroll down again')
      await tap(page, phoneTab(page, /^news/i))
      const at = await top()
      if (at !== 0) fail('TAP-TOP', `under reduced motion the list is at ${at} right after the tap, expected 0`)
      await page.emulateMedia({ reducedMotion: null })

      if (!(await down())) return fail('TAP-TOP', 'the News list did not scroll down a third time')
      await tap(page, phoneTab(page, /^deals/i))
      if (!/^deals/i.test(await selectedTab(page))) return fail('TAP-TOP', 'could not select the Deals tab')
      await sleep(100)
      const deals = await top()
      if (deals !== 0) fail('TAP-TOP', `Deals opened at ${deals}, not at its top`)
    },
  }),

  // --- PR1c: Newest | Best, Reset scope, Brief needs an AI provider ------------

  // Newest | Best reorders the tab, is stored as the tab's row, and a
  // saved view's chip no longer overwrites it. For You opens on Best,
  // which is the order the server sent.
  dashFlow('flow-sort-best', {
    run: async ({ page, fail, shot }) => {
      // A saved view that captured News as Newest (what an older build's
      // chip would have put back) and no source filter.
      await putPrefs(page, {
        filter_presets: [{ id: 'p-1', name: 'Morning', activeSources: [], columnPrefs: { news: { sort: 'newest', minScore: 0, maxAgeHours: null } } }],
      })
      const writes = await prefWrites(page)
      const ids = () => page.locator(`${MOBILE_MAIN} article[data-card-id]`).evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-card-id'))))
      const entry = (id) => F.ENTRIES.find((e) => e.id === id)
      const byTime = (list) => [...list].sort((a, b) => Date.parse(entry(b).published_at) - Date.parse(entry(a).published_at))
      const byScore = (list) => [...list].sort((a, b) => entry(b).composite_score - entry(a).composite_score)

      // For You opens on Best: the server's order, untouched.
      if (!/^for you/i.test(await selectedTab(page))) return fail('SORT', `the phone opened on ${JSON.stringify(await selectedTab(page))}`)
      const fy = await ids()
      const fyServer = F.FOR_YOU.map((e) => e.id).filter((id) => fy.includes(id))
      if (JSON.stringify(fy) !== JSON.stringify(fyServer)) fail('SORT', `For You shows ${fy}, the server sent ${fyServer}`)
      await tap(page, page.locator(`${MOBILE_MAIN} button[aria-label="column preferences"]`))
      const pressed = (v) => page.locator(`${MOBILE_MAIN} [data-column-popover] button[data-sort="${v}"]`).getAttribute('aria-pressed')
      if ((await pressed('best')) !== 'true') fail('SORT', 'For You does not show Best as its sort')
      await tap(page, page.locator(`${MOBILE_MAIN} button[aria-label="column preferences"]`))

      await tap(page, phoneTab(page, /^news/i))
      const before = await ids()
      if (before.length < 5) return fail('SORT', `News shows ${before.length} stories`)
      if (JSON.stringify(before) !== JSON.stringify(byTime(before))) fail('SORT', `News opens as ${before}, not newest first`)
      await tap(page, page.locator(`${MOBILE_MAIN} button[aria-label="column preferences"]`))
      await page.locator(`${MOBILE_MAIN} [data-column-popover]`).waitFor({ state: 'visible' })
      if ((await pressed('newest')) !== 'true') fail('SORT', 'News does not show Newest as its sort')
      if (await page.locator(`${MOBILE_MAIN} [data-column-popover] input[type="range"]`).count()) fail('SORT', 'the minimum score slider is still there')
      await tap(page, page.locator(`${MOBILE_MAIN} [data-column-popover] button[data-sort="best"]`))
      if (!(await waitFor(async () => JSON.stringify(await ids()) === JSON.stringify(byScore(before)), 3000))) {
        return fail('SORT', `after Best, News shows ${await ids()}, expected ${byScore(before)}`)
      }
      if ((await pressed('best')) !== 'true') fail('SORT', 'Best is not shown as chosen')
      await shot('best')
      if (!(await waitFor(() => writes.some((w) => w.key === 'column_prefs:news'), 3000))) return fail('SORT', 'Best sent no column_prefs PUT')
      const row = writes.find((w) => w.key === 'column_prefs:news')
      if (row.method !== 'PUT' || !row.value || row.value.sort !== 'best') fail('SORT', `the News row was written as ${JSON.stringify(row)}`)

      // The chip changes the filter only.
      writes.length = 0
      await tap(page, page.locator('[role="toolbar"][aria-label="saved filter presets"] button', { hasText: 'Morning' }).first())
      await sleep(1200)
      const prefsPuts = writes.filter((w) => w.key.startsWith('column_prefs:'))
      if (prefsPuts.length) fail('SORT', `the chip wrote ${JSON.stringify(prefsPuts)}`)
      const after = await ids()
      if (JSON.stringify(after) !== JSON.stringify(byScore(before))) fail('SORT', `after the chip, News shows ${after}, not Best`)

      // Saved has no sort to pick.
      await tap(page, page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().locator('button[aria-label="save for later"]'))
      if (!(await waitFor(async () => (await tabTexts(page)).some((t) => /^saved/i.test(t)), 3000))) return fail('SORT', 'no Saved tab after saving')
      await tap(page, phoneTab(page, /^saved/i))
      await tap(page, page.locator(`${MOBILE_MAIN} button[aria-label="column preferences"]`))
      await page.locator(`${MOBILE_MAIN} [data-column-popover]`).waitFor({ state: 'visible' })
      if (await page.locator(`${MOBILE_MAIN} [data-column-popover] button[data-sort]`).count()) fail('SORT', 'Saved offers Newest | Best')
    },
  }),

  // Saved lists saves newest first by published, else fetched time: a
  // page with no publish date fetched a minute ago leads; stories with
  // neither date come last, the higher id first.
  dashFlow('flow-saved-order', {
    before: async ({ page }) => {
      // The mock is a context route, so a page route can't edit what it
      // answers; the page's fetch drops the dates on the way in instead.
      await page.addInitScript((undated) => {
        const orig = window.fetch
        window.fetch = async (...args) => {
          const res = await orig(...args)
          const path = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).pathname
          if (path !== '/api/entries' && path !== '/api/entries/by-ids') return res
          const rows = await res.clone().json()
          if (!Array.isArray(rows)) return res
          const out = rows.map((e) => (undated[e.id] ? { ...e, ...undated[e.id] } : e))
          return new Response(JSON.stringify(out), { status: res.status, statusText: res.statusText, headers: res.headers })
        }
      }, {
        110: { published_at: null, fetched_at: new Date(F.NOW - 60000).toISOString() },
        111: { published_at: null, fetched_at: null },
        112: { published_at: null, fetched_at: null },
      })
    },
    run: async ({ page, fail }) => {
      await putPrefs(page, { starred_entries: [105, 111, 103, 112, 110] })
      if (!(await waitFor(async () => (await tabTexts(page)).some((t) => /^saved/i.test(t)), 3000))) return fail('SAVED-ORDER', 'no Saved tab')
      await tap(page, phoneTab(page, /^saved/i))
      const want = '110,103,105,112,111'
      const ids = () => page.locator(`${MOBILE_MAIN} article[data-card-id]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id')).join(','))
      if (!(await waitFor(async () => (await ids()) === want, 3000))) fail('SAVED-ORDER', `Saved shows ${await ids()}, expected ${want}`)
    },
  }),

  // With no AI provider, every Generate and Regenerate (and the desktop
  // header's Brief) reads "Brief needs an AI provider · Set up"; Set up
  // opens Settings › AI, and closing Settings after setting one up
  // brings the buttons back without a reload.
  dashFlow('flow-brief-needs-ai', {
    before: async ({ page }) => {
      page._llm = { configured: false, brief: false, statusGets: 0 }
      const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      await page.route(
        (u) => new URL(u).pathname === '/api/llm/status',
        (route) => {
          page._llm.statusGets++
          return route.fulfill(json({ configured: page._llm.configured, backend: null, model: null }))
        },
      )
      await page.route(
        (u) => new URL(u).pathname === '/api/brief/latest',
        (route) => route.fulfill(json(page._llm.brief ? [BRIEF] : [])),
      )
    },
    run: async ({ page, fail, shot }) => {
      const setUp = page.locator(`${MOBILE_MAIN} [data-brief-action="set-up-ai"]`)
      const action = (name) => page.locator(`${MOBILE_MAIN} [data-brief-action="${name}"]`)
      const label = 'Brief needs an AI provider · Set up'
      const check = async (state, gone) => {
        if (!(await waitFor(() => setUp.isVisible(), 3000))) {
          fail('BRIEF-AI', `${state}: no Set up button`)
          return false
        }
        const text = ((await setUp.textContent()) || '').trim()
        if (text !== label) fail('BRIEF-AI', `${state}: the button reads ${JSON.stringify(text)}`)
        const h = (await setUp.boundingBox())?.height ?? 0
        if (h < 43.5) fail('BRIEF-AI', `${state}: the button is ${h}px tall`)
        if (await action(gone).count()) fail('BRIEF-AI', `${state}: ${gone} is still there`)
        return true
      }
      // The chevron: the middle of the header may be a button of its own.
      const collapse = () => tap(page, page.locator(`${MOBILE_MAIN} [aria-expanded="true"][role="button"] > span[aria-hidden="true"]`).first())

      // 1. No brief: the phone's Brief starts expanded, then collapsed.
      await tap(page, phoneTab(page, /^brief/i))
      if (!(await check('no brief, expanded', 'generate'))) return
      await shot('no-brief')
      await collapse()
      if (!(await check('no brief, collapsed', 'generate-compact'))) return

      // 2. One brief: both Regenerate states.
      page._llm.brief = true
      await tap(page, phoneTab(page, /^for you/i))
      await tap(page, phoneTab(page, /^brief/i))
      if (!(await waitFor(() => page.locator(`${MOBILE_MAIN} header[role="button"]`).isVisible(), 3000))) return fail('BRIEF-AI', 'the brief did not load')
      if (!(await check('a brief, expanded', 'regenerate'))) return
      await collapse()
      if (!(await check('a brief, collapsed', 'regenerate-compact'))) return

      // 3. Set up opens Settings › AI; a provider is set up there; Done.
      await tap(page, setUp)
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      const tab = await page.evaluate(() => new URL(location.href).searchParams.get('tab'))
      if (tab !== 'llm') fail('BRIEF-AI', `Set up opened Settings on ${JSON.stringify(tab)}`)
      page._llm.configured = true
      await closeSettings(page)
      if (!(await waitFor(() => action('regenerate-compact').isVisible(), 3000))) return fail('BRIEF-AI', 'Regenerate did not come back after closing Settings')
      if (await setUp.count()) fail('BRIEF-AI', 'Set up stayed after closing Settings')

      // 4. Desktop: the header's Brief, after the app comes back to the
      // front with the provider gone again.
      page._llm.configured = false
      const gets = page._llm.statusGets
      await setHidden(page, true)
      await setHidden(page, false)
      if (!(await waitFor(() => page._llm.statusGets > gets, 3000))) return fail('BRIEF-AI', 'coming back did not read the AI status again')
      await page.setViewportSize({ width: 1280, height: 800 })
      const header = page.locator('header[data-app-header] [data-brief-action="set-up-ai"]')
      if (!(await waitFor(() => header.isVisible(), 5000))) return fail('BRIEF-AI', 'the desktop header has no Set up')
      if (((await header.textContent()) || '').trim() !== label) fail('BRIEF-AI', `the header reads ${JSON.stringify(await header.textContent())}`)
      if (await page.locator('header[data-app-header]').getByRole('button', { name: 'Brief', exact: true }).count()) fail('BRIEF-AI', 'the header still offers Brief')
      await header.click()
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      if ((await page.evaluate(() => new URL(location.href).searchParams.get('tab'))) !== 'llm') fail('BRIEF-AI', 'the header Set up did not open Settings › AI')
      page._llm.configured = true
      await closeSettings(page)
      if (!(await waitFor(() => page.locator('header[data-app-header]').getByRole('button', { name: 'Brief', exact: true }).isVisible(), 3000))) fail('BRIEF-AI', 'the header Brief did not come back')
    },
  }),

  // A save records `bookmark`; an unsave (☆ again) doesn't. The menu's
  // Save / Unsave and keyboard `b` are desktop paths (on a phone the
  // press is the system's link menu): flow-bookmark-on-save-desktop.
  dashFlow('flow-bookmark-on-save', {
    before: async ({ page }) => {
      await recordInteractions(page)
    },
    run: async ({ page, fail }) => {
      await tap(page, phoneTab(page, /^news/i))
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      const bookmarks = () => bookmarksFor(page, id)
      await tap(page, card.locator('button[aria-label="save for later"]'))
      if (!(await waitFor(() => bookmarks() === 1, 3000))) return fail('BOOKMARK', `a save sent ${bookmarks()} bookmark events, expected 1`)
      await tap(page, page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"] button[aria-label="remove from saved"]`))
      await sleep(800)
      if (bookmarks() !== 1) fail('BOOKMARK', `an unsave sent a bookmark (${bookmarks()} in all)`)
    },
  }),

  // The card menu's Save for later records `bookmark` once and its Unsave
  // doesn't; keyboard `b` twice (save, then unsave) records one.
  dashFlow('flow-bookmark-on-save-desktop', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page }) => {
      await recordInteractions(page)
    },
    run: async ({ page, fail }) => {
      const menuButton = (name) => page.locator('#card-context-menu').getByRole('button', { name, exact: true })
      // The menu opens at the pointer and runs downwards, so right-click
      // a card in the top half of the window (For You's row, at the top).
      const rightClick = async (id) => {
        const at = await page.evaluate((cardId) => {
          for (const a of document.querySelectorAll(`article[data-card-id="${cardId}"]`)) {
            const r = a.getBoundingClientRect()
            const x = r.left + 24
            const y = r.top + 24
            if (r.width && y < innerHeight / 2 && document.elementFromPoint(x, y)?.closest('article[data-card-id]') === a) return { x, y }
          }
          return null
        }, id)
        if (!at) return false
        await page.mouse.click(at.x, at.y, { button: 'right' })
        return true
      }
      const id = await page.evaluate(() => {
        for (const a of document.querySelectorAll('article[data-card-id]')) {
          const r = a.getBoundingClientRect()
          if (r.width && r.top > 80 && r.top < innerHeight / 2) return Number(a.getAttribute('data-card-id'))
        }
        return null
      })
      if (id == null) return fail('BOOKMARK', 'no desktop card starts in the top half of the window')
      if (!(await rightClick(id))) return fail('BOOKMARK', `card ${id} can't be right-clicked`)
      await menuButton('Save for later').click()
      if (!(await waitFor(() => bookmarksFor(page, id) === 1, 3000))) return fail('BOOKMARK', `the menu's Save sent ${bookmarksFor(page, id)} bookmark events, expected 1`)
      if (!(await rightClick(id))) return fail('BOOKMARK', `card ${id} can't be right-clicked after saving`)
      await menuButton('Unsave').click()
      await sleep(800)
      if (bookmarksFor(page, id) !== 1) fail('BOOKMARK', `the menu's Unsave sent a bookmark (${bookmarksFor(page, id)} in all)`)

      // Keyboard: select a card, then b (save) and b (unsave). The arrow
      // keys walk the grid's columns, and the first is Saved, empty again
      // (PR7a keeps it): step to the next column first.
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowDown')
      const sel = 'article[data-card-id][tabindex="0"]'
      if (!(await waitFor(async () => (await page.locator(sel).count()) > 0, 3000))) return fail('BOOKMARK', 'ArrowDown selected no card')
      const kid = Number(await page.locator(sel).first().getAttribute('data-card-id'))
      const before = bookmarksFor(page, kid)
      await page.keyboard.press('b')
      if (!(await waitFor(() => bookmarksFor(page, kid) === before + 1, 3000))) return fail('BOOKMARK', `b (save) sent ${bookmarksFor(page, kid) - before} bookmark events, expected 1`)
      await waitFor(async () => (await page.locator(sel).count()) > 0, 2000)
      await page.keyboard.press('b')
      await sleep(800)
      if (bookmarksFor(page, kid) !== before + 1) fail('BOOKMARK', `b (unsave) sent a bookmark (${bookmarksFor(page, kid) - before} in all)`)
    },
  }),

  // Reset takes the reading state (read marks, last visits, tab prefs,
  // section folds, History grouping) and keeps saves, hides, votes and
  // saved views. Of a read mark and a save still queued when Reset is
  // tapped, the save goes before the DELETEs and is kept; the read mark is
  // dropped, and nothing for a key Reset deletes goes after the DELETEs
  // (the reload's leave flush would otherwise write the read marks back).
  dashFlow('flow-reset-keeps-saves', {
    before: async ({ page }) => {
      await installClock(page)
    },
    run: async ({ page, fail }) => {
      await putPrefs(page, {
        starred_entries: [103],
        hidden_entries: [104],
        voted_entries: { 105: 'up' },
        filter_presets: [{ id: 'p-1', name: 'Morning', activeSources: [], columnPrefs: {} }],
        history_group_by: 'none',
        'read_entries:news': [101],
        'last_viewed:news': new Date(F.NOW).toISOString(),
        'column_prefs:news': { sort: 'best', minScore: 0, maxAgeHours: null },
        'column_sections:news': { newCollapsed: false, historyCollapsed: true },
      })
      const writes = await prefWrites(page)
      // A read mark and a save wait in the 1 s batch (the clock is held).
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      await tap(page, phoneTab(page, /^news/i))
      const id = await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().getAttribute('data-card-id')
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"]`)
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await tap(page, card.locator('button[aria-label="mark this card as read"]'))
      await sleep(300)
      if (writes.length) return fail('RESET', `the queued writes went before Reset: ${JSON.stringify(writes)}`)
      await page.evaluate((u) => {
        history.pushState({ popping: 'settings' }, '', u)
        dispatchEvent(new PopStateEvent('popstate'))
      }, '/?view=settings&tab=reset')
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      await page.locator(SETTINGS).getByRole('button', { name: 'Reset reading state', exact: true }).click()
      const loaded = page.waitForEvent('load')
      await page.locator(SETTINGS).getByRole('button', { name: 'Reset', exact: true }).click()
      await loaded
      await page.clock.resume()
      await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible' })
      const firstDelete = writes.findIndex((w) => w.method === 'DELETE')
      const resetKey = (k) => k === 'history_group_by' || /^(read_entries|last_viewed|column_prefs|column_sections):/.test(k)
      const after = writes.slice(firstDelete).filter((w) => w.method !== 'DELETE' && resetKey(w.key))
      if (after.length) fail('RESET', `writes after the DELETEs: ${JSON.stringify(after)}`)
      const saveAt = writes.findIndex((w) => w.method === 'PATCH' && w.key === 'starred_entries' && (w.body.add || []).includes(Number(id)))
      if (saveAt < 0) fail('RESET', `the queued save was never sent: ${JSON.stringify(writes)}`)
      else if (saveAt > firstDelete) fail('RESET', 'the queued save went after the DELETEs, not before them')
      const saves = prefMock(page.context()).value('starred_entries') || []
      if (!saves.includes(103) || !saves.includes(Number(id))) fail('RESET', `the store's saves are ${JSON.stringify(saves)}, expected 103 and ${id}`)
      if (writes.some((w) => resetKey(w.key) && w.method !== 'DELETE')) fail('RESET', `a write for a key Reset deletes went: ${JSON.stringify(writes.filter((w) => resetKey(w.key) && w.method !== 'DELETE'))}`)
      const deleted = writes.filter((w) => w.method === 'DELETE').map((w) => w.key)
      for (const k of ['starred_entries', 'hidden_entries', 'filter_presets', 'voted_entries']) {
        if (deleted.includes(k)) fail('RESET', `Reset deleted ${k}`)
      }
      for (const k of ['read_entries:news', 'last_viewed:news', 'column_prefs:news', 'column_sections:news', 'history_group_by']) {
        if (!deleted.includes(k)) fail('RESET', `Reset kept ${k} (deleted: ${JSON.stringify(deleted)})`)
      }
      const left = await page.evaluate(async () => ((await (await fetch('/api/preferences')).json()).items || []).map((r) => r.key).sort())
      const kept = ['filter_presets', 'hidden_entries', 'starred_entries', 'voted_entries']
      if (JSON.stringify(left) !== JSON.stringify(kept)) fail('RESET', `after Reset the server holds ${JSON.stringify(left)}`)
      if (!(await waitFor(async () => (await tabTexts(page)).some((t) => /^saved/i.test(t)), 3000))) fail('RESET', 'no Saved tab after Reset')
    },
  }),

  // --- PR2b: preferences sync by change ------------------------------------

  // A GET that can't know about a hide still on its way doesn't bring the
  // story back: one answered while the hide's PATCH is held, and one sent
  // while it was held but answered with the old set after the PATCH's
  // answer (sync rule 5).
  dashFlow('flow-prefs-resync', {
    before: async ({ page, context }) => {
      // A row for the hides already exists, without the story.
      prefMock(context).seed({ hidden_entries: [999] })
      page._held = []
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/hidden_entries',
        async (route) => {
          if (route.request().method() !== 'PATCH') return route.fallback()
          await new Promise((r) => page._held.push(r))
          return route.fallback()
        },
      )
    },
    run: async ({ page, context, fail, shot }) => {
      const gets = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'GET' && f.path === '/api/preferences').length)
      await tap(page, phoneTab(page, /^news/i))
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      const shown = () => page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"]`).count().then((n) => n > 0)
      await tap(page, card.locator('button[aria-label="hide"]'))
      if (!(await waitFor(async () => !(await shown()), 2000))) return fail('PREFS-RESYNC', `story ${id} still shows after Hide`)
      if (!(await waitFor(() => page._held.length === 1, 3000))) return fail('PREFS-RESYNC', 'the hide sent no PATCH')

      // 1. Back to the front (a full GET) while the PATCH is held: the
      // store still has only 999.
      let before = await gets()
      await startPoll(page)
      if (!(await waitFor(async () => (await gets()) > before, 3000))) return fail('PREFS-RESYNC', 'coming back sent no GET /api/preferences')
      await sleep(500)
      if (await shown()) return fail('PREFS-RESYNC', `a GET answered while the hide was on its way brought story ${id} back`)

      // 2. A GET sent now, answered with the old set only after the
      // PATCH's answer has been taken in.
      let release
      const stale = new Promise((r) => (release = r))
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences',
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback()
          await stale
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [{ key: 'hidden_entries', value: [999], updated_at: new Date(F.NOW).toISOString() }] }),
          })
        },
        { times: 1 },
      )
      before = await gets()
      await startPoll(page)
      if (!(await waitFor(async () => (await gets()) > before, 3000))) return fail('PREFS-RESYNC', 'the second return sent no GET')
      page._held[0]()
      const stored = () => (prefMock(context).value('hidden_entries') || []).includes(id)
      if (!(await waitFor(stored, 3000))) return fail('PREFS-RESYNC', 'the PATCH never reached the store')
      await sleep(500)
      release()
      await sleep(800)
      if (await shown()) return fail('PREFS-RESYNC', `a GET sent before the hide's answer, answered with the old set, brought story ${id} back`)
      await shot('hidden')

      // 3. A GET sent after the answer is taken in as it is.
      before = await gets()
      await startPoll(page)
      if (!(await waitFor(async () => (await gets()) > before, 3000))) return fail('PREFS-RESYNC', 'the third return sent no GET')
      await sleep(500)
      if (await shown()) fail('PREFS-RESYNC', `story ${id} came back after the hide was saved`)
    },
  }),

  // Leaving the app right after a save loses nothing: hiding the page
  // sends the save at once, with keepalive, inside its 1 s batch.
  dashFlow('flow-visibility-flush', {
    before: async ({ page }) => {
      await installClock(page)
    },
    run: async ({ page, context, fail }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await sleep(400)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries'))
      if ((await patches()).length) return fail('VIS-FLUSH', 'the save went out before its batch')
      await setHidden(page, true)
      if (!(await waitFor(async () => (await patches()).length === 1, 3000))) return fail('VIS-FLUSH', 'hiding the page sent no PATCH of the save')
      const [sent] = await patches()
      if (!sent.keepalive) fail('VIS-FLUSH', 'the PATCH sent when the page hid has no keepalive')
      if (!(await waitFor(() => (prefMock(context).value('starred_entries') || []).includes(id), 3000))) fail('VIS-FLUSH', `story ${id} is not in the store`)
      // Answered while hidden: coming back doesn't send it again.
      if (!(await waitFor(() => answered(page, 'PATCH', '/api/preferences/starred_entries'), 3000))) return fail('VIS-FLUSH', 'the PATCH was never answered')
      await setHidden(page, false)
      await page.clock.runFor(5000)
      await sleep(300)
      if ((await patches()).length !== 1) fail('VIS-FLUSH', `${(await patches()).length} PATCHes of one save`)
    },
  }),

  // A save that the server can't take (503) is tried again after 2 s,
  // with a save made meanwhile folded in: both end up stored, with no
  // error toast.
  dashFlow('flow-prefs-retry', {
    expectedFailedLoads: ['/api/preferences/starred_entries'],
    before: async ({ page, context }) => {
      await installClock(page)
      prefMock(context).fail(503, { key: 'starred_entries' })
    },
    run: async ({ page, context, fail }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries').length)
      const cards = page.locator(`${MOBILE_MAIN} article[data-card-id]`)
      const a = Number(await cards.nth(0).getAttribute('data-card-id'))
      const b = Number(await cards.nth(1).getAttribute('data-card-id'))
      await tap(page, cards.nth(0).locator('button[aria-label="save for later"]'))
      await page.clock.runFor(1000)
      if (!(await waitFor(() => prefMock(context).faultsLeft() === 0, 3000))) return fail('PREFS-RETRY', 'the first save was not sent')
      // Its retry is timed from the 503's arrival, so the clock waits for it.
      if (!(await waitFor(() => answered(page, 'PATCH', '/api/preferences/starred_entries'), 3000))) return fail('PREFS-RETRY', 'the 503 was never taken in')
      await tap(page, page.locator(`${MOBILE_MAIN} article[data-card-id="${b}"] button[aria-label="save for later"]`))
      await page.clock.runFor(1000)
      await sleep(300)
      if ((await patches()) !== 1) return fail('PREFS-RETRY', `${await patches()} PATCHes before the retry, expected 1 (the second save waits for it)`)
      await page.clock.runFor(1500)
      if (!(await waitFor(async () => (await patches()) === 2, 3000))) return fail('PREFS-RETRY', `no retry 2 s after the 503 (${await patches()} PATCHes)`)
      const stored = () => prefMock(context).value('starred_entries') || []
      if (!(await waitFor(() => stored().includes(a) && stored().includes(b), 3000))) fail('PREFS-RETRY', `the store holds ${JSON.stringify(stored())}, expected ${a} and ${b}`)
      for (const id of [a, b]) {
        if (!(await page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"] button[aria-label="remove from saved"]`).count())) fail('PREFS-RETRY', `story ${id} doesn't show as saved`)
      }
      if (await page.getByText(/^Couldn't save/).count()) fail('PREFS-RETRY', 'an error toast for a save that got through')
    },
  }),

  // A server rolled back to before PATCH answers 405: the save stays on
  // screen and queued (no "saved" state flips back), is tried again after
  // 2, 4 and 8 s, then shows one "Couldn't save" toast; once the server
  // takes PATCH again, leaving the page saves it.
  dashFlow('flow-prefs-405', {
    expectedFailedLoads: ['/api/preferences/starred_entries'],
    before: async ({ page, context }) => {
      await installClock(page)
      prefMock(context).fail(405, { key: 'starred_entries', times: 4 })
    },
    run: async ({ page, context, fail, shot }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries').length)
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      const saved = () => page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"] button[aria-label="remove from saved"]`).count().then((n) => n > 0)
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await page.clock.runFor(1000)
      if (!(await waitFor(async () => (await patches()) === 1, 3000))) return fail('PREFS-405', 'the save was not sent')
      for (const [i, wait] of [[2, 2000], [3, 4000], [4, 8000]]) {
        // Each retry is timed from the 405's arrival.
        if (!(await waitFor(() => answered(page, 'PATCH', '/api/preferences/starred_entries'), 3000))) return fail('PREFS-405', `answer ${i - 1} was never taken in`)
        if (!(await saved())) return fail('PREFS-405', `after ${i - 1} answers of 405 the story no longer shows as saved`)
        await page.clock.runFor(wait)
        if (!(await waitFor(async () => (await patches()) === i, 3000))) return fail('PREFS-405', `no retry ${wait / 1000} s after a 405 (${await patches()} PATCHes)`)
      }
      if (!(await waitFor(() => page.getByText(/^Couldn't save your latest changes/).count().then((n) => n === 1), 3000))) fail('PREFS-405', 'no toast once the retries were used up')
      if (!(await saved())) fail('PREFS-405', 'the save no longer shows after the retries')
      if (prefMock(context).value('starred_entries') !== undefined) fail('PREFS-405', 'a 405 stored the save')
      await shot('unsaved')
      await page.clock.runFor(30_000)
      await sleep(300)
      if ((await patches()) !== 4) fail('PREFS-405', `${await patches()} PATCHes; no timed retry after the third`)
      // The server takes PATCH again: leaving sends the queued save.
      await setHidden(page, true)
      if (!(await waitFor(() => (prefMock(context).value('starred_entries') || []).includes(id), 3000))) fail('PREFS-405', 'leaving did not save the queued change')
      await setHidden(page, false)
    },
  }),

  // The preferences GET fails, so the page doesn't know the saves the
  // server holds. A save then adds to them (a PATCH) instead of writing a
  // one-story list over them (PR1b's notes), and the next return reads
  // them all in.
  dashFlow('flow-prefs-fail-save-keeps-list', {
    expectedFailedLoads: ['/api/preferences'],
    before: async ({ page, context }) => {
      prefMock(context).seed({ starred_entries: [103] })
      page._prefsDown = true
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences',
        (route) =>
          route.request().method() === 'GET' && page._prefsDown
            ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' })
            : route.fallback(),
      )
    },
    run: async ({ page, context, fail, shot }) => {
      const writes = await prefWrites(page)
      // Unread: no story shows as saved.
      if (await page.locator('[aria-label="remove from saved"]').count()) return fail('PREFS-FAIL-SAVE', 'a story shows as saved although the preferences failed')
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]:not([data-card-id="103"])`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      await tap(page, card.locator('button[aria-label="save for later"]'))
      const stored = () => prefMock(context).value('starred_entries') || []
      if (!(await waitFor(() => stored().includes(id), 3000))) return fail('PREFS-FAIL-SAVE', `the save of ${id} never reached the store`)
      if (!stored().includes(103)) fail('PREFS-FAIL-SAVE', `the save wrote over the server's saves: the store holds ${JSON.stringify(stored())}`)
      const sent = writes.filter((w) => w.key === 'starred_entries').map((w) => `${w.method} ${JSON.stringify(w.body ?? w.value)}`)
      if (sent.join() !== `PATCH {"add":[${id}]}`) fail('PREFS-FAIL-SAVE', `the save sent ${JSON.stringify(sent)}, expected one PATCH adding ${id}`)
      // The server is back: the next return reads every save in.
      page._prefsDown = false
      await startPoll(page)
      await tap(page, phoneTab(page, /^saved/i))
      for (const want of [103, id]) {
        if (!(await waitFor(() => page.locator(`${MOBILE_MAIN} article[data-card-id="${want}"]`).count().then((n) => n > 0), 3000))) fail('PREFS-FAIL-SAVE', `story ${want} is not in Saved`)
      }
      await shot('saved')
    },
  }),

  // Back in front with the hide's keepalive PATCH still unanswered (not
  // yet at the server): it is given up on (sync rule 4) and not sent again,
  // also once it does get through.
  dashFlow('flow-prefs-return-before-answer', {
    before: async ({ page }) => {
      await installClock(page)
      page._held = []
      page._holdPatch = false
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/starred_entries',
        async (route) => {
          if (route.request().method() !== 'PATCH' || !page._holdPatch) return route.fallback()
          page._holdPatch = false
          await new Promise((r) => page._held.push(r))
          return route.fallback()
        },
      )
    },
    run: async ({ page, context, fail }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries'))
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      page._holdPatch = true
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await sleep(400)
      if ((await patches()).length) return fail('PREFS-RETURN', 'the save went out before its batch')
      await setHidden(page, true)
      if (!(await waitFor(() => page._held.length === 1, 3000))) return fail('PREFS-RETURN', 'hiding the page sent no PATCH')
      await setHidden(page, false)
      await page.clock.runFor(5000)
      await sleep(500)
      const atReturn = (await patches()).length
      page._held[0]()
      if (!(await waitFor(() => (prefMock(context).value('starred_entries') || []).includes(id), 3000))) fail('PREFS-RETURN', `story ${id} is not in the store`)
      await page.clock.runFor(35_000)
      await sleep(500)
      const n = (await patches()).length
      if (n !== 1) fail('PREFS-RETURN', `${n} PATCHes of one save (${atReturn} by the return)`)
    },
  }),

  // The hide's keepalive PATCH lands but its answer is held (iOS suspends
  // the page); meanwhile another device unsaves the story; then the page
  // comes back. The other device's unsave stands: the save is not sent
  // again, and the story shows unsaved after the return's full GET.
  dashFlow('flow-prefs-landed-unread', {
    before: async ({ page, context }) => {
      await installClock(page)
      page._held = []
      page._holdAnswer = false
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/starred_entries',
        async (route) => {
          if (route.request().method() !== 'PATCH' || !page._holdAnswer) return route.fallback()
          page._holdAnswer = false
          const body = route.request().postDataJSON() || {}
          const cur = prefMock(context).value('starred_entries') || []
          const next = cur.filter((x) => !(body.remove || []).includes(x))
          for (const x of body.add || []) if (!next.includes(x)) next.push(x)
          prefMock(context).seed({ starred_entries: next })
          await new Promise((r) => page._held.push(r))
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ key: 'starred_entries', value: next, updated_at: new Date(F.NOW + 50).toISOString() }),
          })
        },
      )
    },
    run: async ({ page, context, fail }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries'))
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      const saved = () => page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"] button[aria-label="remove from saved"]`).count().then((c) => c > 0)
      page._holdAnswer = true
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await sleep(400)
      await setHidden(page, true)
      if (!(await waitFor(() => page._held.length === 1, 3000))) return fail('PREFS-LANDED', 'hiding the page sent no PATCH')
      if (!(prefMock(context).value('starred_entries') || []).includes(id)) return fail('PREFS-LANDED', 'the keepalive PATCH did not land')
      // Another device unsaves it while this page is away.
      prefMock(context).seed({ starred_entries: [] })
      await setHidden(page, false)
      await page.clock.runFor(5000)
      await sleep(800)
      page._held[0]()
      await page.clock.runFor(35_000)
      await sleep(800)
      const n = (await patches()).length
      const stored = prefMock(context).value('starred_entries') || []
      if (stored.includes(id)) fail('PREFS-LANDED', `the other device's unsave was undone: the store holds ${JSON.stringify(stored)} after ${n} PATCHes`)
      if (n !== 1) fail('PREFS-LANDED', `${n} PATCHes of one save`)
      if (await saved()) fail('PREFS-LANDED', `story ${id} still shows as saved after the return`)
    },
  }),

  // The save's PATCH has gone (its 1 s batch ran) but not been answered
  // when the story opens, with nothing else queued. Hiding the page sends
  // the save again with keepalive, which gets through; the first request
  // only fails after the return (iOS cut it off), when sync rule 4 has
  // given it up. The save is stored, and nothing more goes.
  dashFlow('flow-prefs-hide-while-sending', {
    expectedFailedLoads: ['/api/preferences/starred_entries'],
    before: async ({ page }) => {
      await installClock(page)
      page._held = []
      page._holdPatch = false
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/starred_entries',
        async (route) => {
          if (route.request().method() !== 'PATCH' || !page._holdPatch) return route.fallback()
          page._holdPatch = false
          await new Promise((r) => page._held.push(r))
          return route.abort('failed')
        },
      )
    },
    run: async ({ page, context, fail }) => {
      const now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      const patches = () => harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'PATCH' && f.path === '/api/preferences/starred_entries'))
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const id = Number(await card.getAttribute('data-card-id'))
      const saved = () => page.locator(`${MOBILE_MAIN} article[data-card-id="${id}"] button[aria-label="remove from saved"]`).count().then((c) => c > 0)
      const stored = () => (prefMock(context).value('starred_entries') || []).includes(id)
      page._holdPatch = true
      await tap(page, card.locator('button[aria-label="save for later"]'))
      await page.clock.runFor(1000)
      if (!(await waitFor(() => page._held.length === 1, 3000))) return fail('PREFS-HIDE-SENDING', 'the save sent no PATCH after its batch')
      const [first] = await patches()
      if (first.keepalive) return fail('PREFS-HIDE-SENDING', 'the batch PATCH was sent with keepalive')
      await setHidden(page, true)
      if (!(await waitFor(async () => (await patches()).length === 2, 3000))) return fail('PREFS-HIDE-SENDING', 'hiding the page did not send the save on its way again')
      if (!(await patches())[1].keepalive) fail('PREFS-HIDE-SENDING', 'the second PATCH has no keepalive')
      if (!(await waitFor(stored, 3000))) return fail('PREFS-HIDE-SENDING', `story ${id} is not in the store after the keepalive PATCH`)
      if (!(await waitFor(() => answered(page, 'PATCH', '/api/preferences/starred_entries'), 3000))) return fail('PREFS-HIDE-SENDING', 'the keepalive PATCH was never answered')
      await setHidden(page, false)
      await page.clock.runFor(2000)
      await sleep(300)
      // The first request fails only now.
      page._held[0]()
      await sleep(300)
      await page.clock.runFor(35_000)
      await sleep(500)
      const n = (await patches()).length
      if (n !== 2) fail('PREFS-HIDE-SENDING', `${n} PATCHes of one save, expected 2`)
      if (!stored()) fail('PREFS-HIDE-SENDING', `story ${id} is no longer in the store`)
      if (!(await saved())) fail('PREFS-HIDE-SENDING', `story ${id} doesn't show as saved after the return`)
      if (await page.getByText(/^Couldn't save/).count()) fail('PREFS-HIDE-SENDING', 'an error toast for a save that got through')
    },
  }),

  dashFlow('flow-fn-quiet-poll', {
    before: async ({ page }) => {
      await installClock(page)
    },
    run: async ({ page, fail }) => {
      let polls = 0
      page.on('request', (r) => {
        if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/sources') polls++
      })
      await page.clock.runFor(65_000)
      await sleep(800)
      if (!polls) fail('FN', 'no poll ran in 65 s')
      if (await page.getByText(/^(refreshed|\d+ new since last refresh)$/).count()) fail('FN', 'the background poll showed a toast')
    },
  }),

  editorFlow('flow-fo-legacy-header', 17, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/17')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 17)
      if (!(await page.locator(ROW(17)).getByText('Header names use letters, numbers and dashes.').isVisible())) {
        fail('FO', 'the stored bad header shows no error on open')
      }
      await rowButton(page, 17, 'Add header').click()
      await page.locator(`${ROW(17)} input[aria-label="header name"]`).last().fill('X-Test')
      const value = page.locator(`${ROW(17)} input[placeholder="Value"]`).last()
      await value.fill('1')
      await value.blur()
      await sleep(300)
      if (page._patches.length) return fail('FO', 'a header was saved while another row is refused')
      await page.locator(`${ROW(17)} button[aria-label="remove header Bad Header"]`).click()
      if (!(await waitFor(() => page._patches.length === 1))) return fail('FO', 'removing the bad row saved nothing')
      const sent = JSON.stringify(page._patches[0].custom_headers)
      if (sent !== '{"X-Test":"1"}') fail('FO', `PATCH headers are ${sent}`)
    },
  }),

  dashFlow('flow-fv-card-source-tap', {
    run: async ({ page, fail }) => {
      const card = page.locator(`${MOBILE_MAIN} article[data-card-id]`).first()
      const button = card.locator('button[aria-label^="edit feed"]')
      const headline = card.locator('a[aria-label="open in new tab"]').first()
      const clear = await headline.evaluate((a) => {
        const r = a.getBoundingClientRect()
        const at = document.elementFromPoint(r.left + r.width / 2, r.bottom - 1)
        return !(at && at.closest('button[aria-label^="edit feed"]'))
      })
      if (!clear) fail('FV', "the source button reaches into the headline's bottom edge")
      await button.click()
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      const m = /[?&]source=(\d+)/.exec(page.url())
      if (!m) return fail('FV', `no source in the URL: ${page.url()}`)
      if (!(await waitFor(() => page.locator(`${ROW(m[1])} button[aria-expanded="true"]`).count().then((n) => n > 0), 3000))) {
        fail('FV', `feed ${m[1]}'s editor did not open`)
      }
    },
  }),

  dashFlow('flow-fg2-toast-edit-reentry', {
    run: async ({ page, fail }) => {
      await page.evaluate(() => history.pushState(null, '', '/?start=1'))
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: /^Settings/ }).click()
      await openAddTab(page)
      // capture.cjs answers Auto-add with BBC News, which is already added.
      await page.fill('input[aria-label="link to add"]', 'https://www.bbc.co.uk/news')
      await page.getByRole('button', { name: 'Auto-add', exact: true }).click()
      await page.getByText('Already added: BBC News').waitFor({ state: 'visible', timeout: 5000 })
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await waitEditor(page, 1)
      await closeSettings(page)
      await page.goBack()
      await sleep(400)
      if (await page.locator(SETTINGS).count()) fail('FG2', 'Back after Done reopened Settings')
      const u = new URL(page.url())
      if (!/^https?:$/.test(u.protocol)) fail('FG2', `Back left the app: ${page.url()}`)
      for (const k of ['view', 'tab', 'source']) if (u.searchParams.has(k)) fail('FG2', `the URL still has ${k}: ${page.url()}`)
    },
  }),

  editorFlow('flow-fw-delete-during-stale-poll', 16, {
    run: async ({ page, fail }) => {
      await waitEditor(page, 16)
      const [sources, entries] = await page.evaluate(() =>
        Promise.all([fetch('/api/sources').then((r) => r.json()), fetch('/api/entries?perCategoryLimit=100').then((r) => r.json())]),
      )
      if (!entries.some((e) => e.source_id === 16)) return fail('FW', 'the fixtures have no NHL stories to check')
      // Polls after the delete are slow, so the stale one lands first and
      // the app itself has to keep the deleted feed out.
      for (const pathname of ['/api/sources', '/api/entries']) {
        await page.route(
          (u) => new URL(u).pathname === pathname,
          async (route) => {
            if (route.request().method() !== 'GET') return route.fallback()
            await sleep(6000)
            return route.fallback()
          },
        )
      }
      await stalePoll(page, '/api/sources', sources, 1500)
      await stalePoll(page, '/api/entries', entries, 1500)
      await startPoll(page)
      await sleep(100)
      await rowButton(page, 16, 'Delete feed…').click()
      await rowButton(page, 16, 'Delete').click()
      await page.locator(ROW(16)).waitFor({ state: 'detached', timeout: 3000 })
      await sleep(2000)
      if (await page.locator(ROW(16)).count()) fail('FW', 'the stale poll brought the deleted feed back')
      await closeSettings(page)
      const tabs = await tabTexts(page)
      if (tabs.some((t) => /^other/i.test(t.trim()))) fail('FW', `an "Other" column appeared: ${JSON.stringify(tabs)}`)
      if (tabs.some((t) => /nhl/i.test(t))) fail('FW', `the deleted feed's column is still there: ${JSON.stringify(tabs)}`)
    },
  }),
  // Switching apps mid-edit (the field still focused) saves what was typed.
  editorFlow('flow-save-app-switch', 6, {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await waitEditor(page, 6)
      const typed = 'https://slickdeals.net/switch.xml'
      const addr = field(page, 6, 'Address')
      await addr.fill(typed)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      if (!(await waitFor(() => page._patches.length === 1, 2000))) return fail('SAVE-SWITCH', `switching apps sent ${page._patches.length} PATCH(es), expected 1`)
      if (page._patches[0].url !== typed) fail('SAVE-SWITCH', `PATCH body is ${JSON.stringify(page._patches[0])}`)
    },
  }),

  // Back (Safari tab, desktop) closes Settings without a blur; the typed
  // address is saved anyway.
  dashFlow('flow-save-back', {
    before: async ({ page }) => {
      page._patches = await record(page, 'PATCH', '/api/sources/6')
    },
    run: async ({ page, fail }) => {
      await openEditor(page, 6)
      const typed = 'https://slickdeals.net/back.xml'
      await field(page, 6, 'Address').fill(typed)
      await page.goBack()
      await page.locator(SETTINGS).waitFor({ state: 'detached', timeout: 3000 })
      if (!(await waitFor(() => page._patches.length === 1, 2000))) return fail('SAVE-BACK', `Back sent ${page._patches.length} PATCH(es), expected 1`)
      if (page._patches[0].url !== typed) fail('SAVE-BACK', `PATCH body is ${JSON.stringify(page._patches[0])}`)
    },
  }),
  // --- PR8: the AI tab saves on its own ------------------------------------

  // Switching provider is one PUT that also clears both models.
  aiFlow('flow-fx-ai-provider', { provider: null }, {
    run: async ({ page, fail }) => {
      await page.locator('#ai-provider').waitFor({ state: 'visible' })
      await page.locator('#ai-provider').selectOption('ollama')
      if (!(await waitFor(() => page._puts.length >= 1))) return fail('FX', 'no PUT after picking Ollama (local)')
      await sleep(400)
      if (page._puts.length !== 1) fail('FX', `expected 1 PUT, saw ${page._puts.length}`)
      const body = JSON.stringify(page._puts[0])
      if (body !== '{"provider":"ollama","model_brief":"","model_scoring":""}') fail('FX', `PUT body is ${body}`)
    },
  }),

  // A provider whose key isn't saved here asks for it, and the key is
  // one more PUT with only that key.
  aiFlow('flow-fx2-ai-provider-needs-key', { provider: null, anthropic: false, configured: false }, {
    run: async ({ page, fail }) => {
      await page.locator('#ai-provider').waitFor({ state: 'visible' })
      await page.locator('#ai-provider').selectOption('anthropic')
      if (!(await waitFor(() => page._puts.length >= 1))) return fail('FX2', 'no PUT after picking Anthropic')
      const first = JSON.stringify(page._puts[0])
      if (first !== '{"provider":"anthropic","model_brief":"","model_scoring":""}') fail('FX2', `provider PUT body is ${first}`)
      const settings = page.locator(SETTINGS)
      if (!(await settings.getByText("If your Anthropic key isn't in the server's settings file, paste it here.").isVisible())) {
        fail('FX2', 'no key field hint for Anthropic')
      }
      if (!(await waitFor(() => settings.getByText('Popping has no Anthropic key yet. Paste one above.').isVisible(), 3000))) {
        fail('FX2', 'no "Popping has no Anthropic key yet" line')
      }
      const key = page.locator('#ai-key-anthropic')
      await key.fill('sk-ant-test-not-real')
      await key.blur()
      if (!(await waitFor(() => page._puts.length >= 2))) return fail('FX2', 'no PUT after leaving the key field')
      await sleep(400)
      if (page._puts.length !== 2) fail('FX2', `expected 2 PUTs, saw ${page._puts.length}`)
      const keys = Object.keys(page._puts[1])
      if (JSON.stringify(keys) !== '["anthropic_api_key"]') fail('FX2', `key PUT has fields ${JSON.stringify(keys)}`)
    },
  }),

  // A key saves on leave: an empty field sends nothing; a typed one sends
  // exactly that key, then the field empties and says "Key saved".
  aiFlow('flow-fy-ai-key-on-leave', {}, {
    run: async ({ page, fail }) => {
      const key = page.locator('#ai-key-groq')
      await key.waitFor({ state: 'visible' })
      await key.focus()
      await key.blur()
      await sleep(300)
      if (page._puts.length) return fail('FY', `an empty key field sent ${page._puts.length} PUT(s)`)
      await key.fill('gsk-test-not-real')
      await key.blur()
      if (!(await waitFor(() => page._puts.length >= 1))) return fail('FY', 'no PUT after leaving a typed key')
      await sleep(300)
      if (page._puts.length !== 1) fail('FY', `expected 1 PUT, saw ${page._puts.length}`)
      const keys = Object.keys(page._puts[0])
      if (JSON.stringify(keys) !== '["groq_api_key"]') fail('FY', `PUT has fields ${JSON.stringify(keys)}`)
      if ((await key.inputValue()) !== '') fail('FY', 'the key stays in the field after saving')
      if (!(await waitFor(() => page.locator(SETTINGS).getByText('Key saved').isVisible(), 3000))) fail('FY', 'no "Key saved"')
    },
  }),

  // Reset asks inline, never with a browser dialog.
  flow('flow-fz-reset-inline', {
    url: '/?view=settings&tab=reset',
    run: async ({ page, fail }) => {
      let dialogs = 0
      page.on('dialog', () => dialogs++)
      await page.locator(SETTINGS).getByRole('button', { name: 'Reset reading state', exact: true }).click()
      const keep = page.locator(SETTINGS).getByRole('button', { name: 'Keep', exact: true })
      if (!(await keep.isVisible())) return fail('FZ', 'no inline confirm after Reset reading state')
      if (!(await page.locator(SETTINGS).getByRole('button', { name: 'Reset', exact: true }).isVisible())) fail('FZ', 'the confirm has no Reset')
      await keep.click()
      if (await keep.count()) fail('FZ', 'Keep did not close the confirm')
      if (dialogs) fail('FZ', `a browser dialog opened ${dialogs} time(s)`)
    },
  }),
  // --- PR9: no browser prompts ---------------------------------------------

  // Save current view names the view in the Menu itself; renaming a
  // chip is the same inline field.
  dashFlow('flow-fpr-save-view-inline', {
    run: async ({ page, fail }) => {
      let dialogs = 0
      page.on('dialog', () => dialogs++)
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: /^Save current view/ }).click()
      const name = page.locator(`${MENU} input[aria-label="name for this view"]`)
      await name.waitFor({ state: 'visible' })
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      if (focused !== 'name for this view') fail('FPR', `focus is on ${JSON.stringify(focused)} after the tap, expected the name field`)
      if (!(await page.locator(MENU).getByRole('button', { name: 'Save', exact: true }).isDisabled())) fail('FPR', 'Save is enabled with an empty name')
      await name.fill('Hockey')
      await name.press('Enter')
      const chip = page.locator('[role="toolbar"][aria-label="saved filter presets"]').getByRole('button', { name: 'Hockey', exact: true })
      if (!(await waitFor(() => chip.isVisible(), 3000))) return fail('FPR', 'no "Hockey" chip after saving')
      if (!(await page.getByText('Saved view “Hockey”').isVisible())) fail('FPR', 'no "Saved view “Hockey”" toast')

      // Rename: the field starts with the name; leaving it unchanged does nothing.
      await page.getByRole('button', { name: 'options for preset Hockey', exact: true }).click()
      await page.getByRole('button', { name: 'rename preset Hockey', exact: true }).click()
      const rename = page.locator('input[aria-label="new name for Hockey"]')
      await rename.waitFor({ state: 'visible' })
      if ((await rename.inputValue()) !== 'Hockey') fail('FPR', `the rename field holds ${JSON.stringify(await rename.inputValue())}`)
      await rename.press('Enter')
      await sleep(200)
      if (await page.getByText(/^Renamed to/).count()) fail('FPR', 'an unchanged name was saved as a rename')
      if (!(await chip.isVisible())) fail('FPR', 'the chip is gone after an unchanged rename')
      if (dialogs) fail('FPR', `a browser dialog opened ${dialogs} time(s)`)
    },
  }),

  // --- H1: the harness checks itself -----------------------------------------

  // A known 2-tap path (≡, then Settings) counts 2, passes taps(…, 2) and
  // fails taps(…, 1).
  dashFlow('flow-h1-taps', {
    run: async ({ page, fail }) => {
      await tap(page, page.locator('button[aria-label="open menu"]'))
      await menuOpened(page)
      await tap(page, page.locator(MENU).getByRole('button', { name: /^Settings/ }))
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      if (page._taps !== 2) return fail('H1-TAPS', `Menu → Settings counted ${page._taps} taps, expected 2`)
      if (!taps(page, 2, 'H1-TAPS')) return
      const real = page._fail
      const caught = []
      page._fail = (rule, detail) => caught.push([rule, detail])
      const passed = taps(page, 1, 'H1-TAPS')
      page._fail = real
      if (passed || caught.length !== 1 || caught[0][0] !== 'H1-TAPS') {
        fail('H1-TAPS', `taps(page, 1) after 2 taps returned ${passed} and reported ${JSON.stringify(caught)}`)
      }
    },
  }),

  // touchDrag does nothing off Chromium; on Chromium an upward drag
  // scrolls the phone list and counts as one tap.
  dashFlow('flow-h1-touch-drag', {
    run: async ({ page, fail }) => {
      const webkit = { context: () => ({ browser: () => ({ browserType: () => ({ name: () => 'webkit' }) }) }) }
      // A stand-in page that only answers the browser check: anything
      // past the early return throws.
      const ran = await touchDrag(webkit, { from: { x: 100, y: 600 }, to: { x: 100, y: 200 } }).catch((e) => `a throw (${e.message})`)
      if (ran !== false || webkit._taps) fail('H1-DRAG', `off Chromium touchDrag returned ${ran} and counted ${webkit._taps || 0} taps`)
      if (!isChromium(page)) return
      const scroller = page.locator(`${MOBILE_MAIN} section div.overflow-y-auto`).first()
      const box = await scroller.boundingBox()
      if (!box) return fail('H1-DRAG', 'no phone list to drag')
      const top = () => scroller.evaluate((el) => el.scrollTop)
      const start = await top()
      const x = box.x + box.width / 2
      if (!(await touchDrag(page, { from: { x, y: box.y + box.height * 0.8 }, to: { x, y: box.y + box.height * 0.2 } }))) {
        return fail('H1-DRAG', 'touchDrag did not run on Chromium')
      }
      if (!(await waitFor(async () => (await top()) > start, 2000))) fail('H1-DRAG', 'an upward drag did not scroll the phone list')
      if (page._taps !== 1) fail('H1-DRAG', `a drag counted ${page._taps} taps, expected 1`)
    },
  }),

  // setHidden sets both visibilityState and hidden; coming back runs the
  // app's quiet poll.
  dashFlow('flow-h1-set-hidden', {
    run: async ({ page, fail }) => {
      let polls = 0
      page.on('request', (r) => {
        if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/sources') polls++
      })
      const read = () => page.evaluate(() => JSON.stringify([document.visibilityState, document.hidden]))
      await setHidden(page, true)
      if ((await read()) !== '["hidden",true]') fail('H1-HIDDEN', `hidden page reads ${await read()}`)
      await sleep(300)
      const hiddenPolls = polls
      await setHidden(page, false)
      if ((await read()) !== '["visible",false]') fail('H1-HIDDEN', `shown page reads ${await read()}`)
      if (!(await waitFor(() => polls > hiddenPolls, 3000))) fail('H1-HIDDEN', 'coming back to the page sent no quiet poll')
    },
  }),

  // The fetch wrapper records keepalive: the load-time GET without it, and
  // the views still queued when the page hides with it (beacon refused).
  dashFlow('flow-h1-keepalive', {
    before: async ({ page }) => {
      // Views stay queued (no idle callback) and the beacon is refused, so
      // hiding the page has to send them with fetch and keepalive.
      await page.addInitScript(() => {
        window.requestIdleCallback = () => 0
        Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => false })
      })
    },
    run: async ({ page, fail }) => {
      const { fetches } = await harnessLog(page)
      const load = fetches.find((f) => f.method === 'GET' && f.path === '/api/preferences')
      if (!load) fail('H1-KEEPALIVE', `the load-time GET /api/preferences was not recorded: ${JSON.stringify(fetches)}`)
      else if (load.keepalive) fail('H1-KEEPALIVE', 'the load-time GET /api/preferences was recorded with keepalive')
      if (fetches.some((f) => f.keepalive)) fail('H1-KEEPALIVE', `a keepalive fetch before the page hid: ${JSON.stringify(fetches)}`)
      await setHidden(page, true)
      const sent = () => harnessLog(page).then((h) => h.fetches.some((f) => f.method === 'POST' && f.path === '/api/interactions/batch' && f.keepalive))
      if (!(await waitFor(sent, 3000))) {
        fail('H1-KEEPALIVE', `hiding the page sent no keepalive POST /api/interactions/batch: ${JSON.stringify((await harnessLog(page)).fetches)}`)
      }
    },
  }),

  // capture.cjs keeps preferences: a PUT is read back (all, since, by
  // key), a DELETE removes it, and a reload still sees what was written.
  // PATCH changes a set key as the server does (PR2b): `remove` before
  // `add`, `set` with null clearing a vote, 400 for a key that isn't a
  // set key, 422 for the wrong change; a queued fault answers once.
  dashFlow('flow-h1-pref-store', {
    // The read after DELETE is a 404 on purpose, and so are the refused
    // PATCHes.
    expectedFailedLoads: ['/api/preferences/column_prefs:news', '/api/preferences/filter_presets', '/api/preferences/starred_entries', '/api/preferences/voted_entries'],
    run: async ({ page, context, fail }) => {
      const call = (method, path, body) =>
        page.evaluate(
          async ([m, p, b]) => {
            const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
            return { status: r.status, body: r.status === 204 ? null : await r.json() }
          },
          [method, path, body],
        )
      const keys = (res) => res.body.items.map((i) => i.key).sort().join(',')
      const a = await call('PUT', '/api/preferences/column_prefs:news', { value: { sort: 'best', minScore: 0, maxAgeHours: null } })
      const b = await call('PUT', '/api/preferences/filter_presets', { value: [] })
      if (a.body.updated_at >= b.body.updated_at) fail('H1-PREFS', `writes are out of order: ${a.body.updated_at}, ${b.body.updated_at}`)
      const all = await call('GET', '/api/preferences')
      if (keys(all) !== 'column_prefs:news,filter_presets') fail('H1-PREFS', `GET lists ${keys(all)}`)
      const since = await call('GET', `/api/preferences?since=${encodeURIComponent(a.body.updated_at)}`)
      if (keys(since) !== 'filter_presets') fail('H1-PREFS', `GET since the first write lists ${keys(since)}`)
      const one = await call('GET', '/api/preferences/filter_presets')
      if (JSON.stringify(one.body.value) !== '[]') fail('H1-PREFS', `GET by key returns ${JSON.stringify(one.body)}`)
      await call('DELETE', '/api/preferences/column_prefs:news')
      if ((await call('GET', '/api/preferences/column_prefs:news')).status !== 404) fail('H1-PREFS', 'a deleted key still reads back')

      // PATCH, as on the server.
      const patch = (key, body) => call('PATCH', `/api/preferences/${encodeURIComponent(key)}`, body)
      await patch('starred_entries', { add: [3, 1, 2] })
      const changed = await patch('starred_entries', { add: [1, 4], remove: [1, 2] })
      if (JSON.stringify(changed.body.value) !== '[3,1,4]') fail('H1-PREFS', `remove before add gave ${JSON.stringify(changed.body.value)}, expected [3,1,4]`)
      await patch('voted_entries', { set: { 5: 'up', 6: 'down' } })
      const votes = await patch('voted_entries', { set: { 5: null, 6: 'up' } })
      if (JSON.stringify(votes.body.value) !== '{"6":"up"}') fail('H1-PREFS', `votes ${JSON.stringify(votes.body.value)}, expected {"6":"up"}`)
      const seen = await patch('seen:News/Tech', { add: [9] })
      if (seen.status !== 200 || JSON.stringify(prefMock(context).value('seen:News/Tech')) !== '[9]') fail('H1-PREFS', `seen:News/Tech PATCH: ${JSON.stringify(seen)}`)
      if ((await patch('filter_presets', { add: [1] })).status !== 400) fail('H1-PREFS', 'PATCH of a key that is not a set key was not a 400')
      if ((await patch('starred_entries', { set: { 1: 'up' } })).status !== 422) fail('H1-PREFS', 'set on an id list was not a 422')
      if ((await patch('voted_entries', { add: [1] })).status !== 422) fail('H1-PREFS', 'add on voted_entries was not a 422')
      for (const [key, body] of [
        ['starred_entries', { add: [0] }],
        ['starred_entries', { add: ['5'] }],
        ['starred_entries', { add: [1], extra: true }],
        ['voted_entries', { set: { 5: 'sideways' } }],
        ['voted_entries', { set: { '05': 'up' } }],
      ]) {
        if ((await patch(key, body)).status !== 422) fail('H1-PREFS', `PATCH ${key} ${JSON.stringify(body)} was not a 422`)
      }
      prefMock(context).fail(503, { key: 'starred_entries' })
      if ((await patch('starred_entries', { add: [7] })).status !== 503) fail('H1-PREFS', 'the queued fault did not answer')
      if ((await patch('starred_entries', { add: [7] })).status !== 200) fail('H1-PREFS', 'the fault answered twice')
      if (JSON.stringify(prefMock(context).value('starred_entries')) !== '[3,1,4,7]') fail('H1-PREFS', `starred_entries is ${JSON.stringify(prefMock(context).value('starred_entries'))}`)

      await page.reload()
      await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible' })
      const loaded = await harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'GET' && f.path === '/api/preferences').length)
      if (loaded !== 1) fail('H1-PREFS', `the reload sent ${loaded} GET /api/preferences`)
      const kept = 'filter_presets,seen:News/Tech,starred_entries,voted_entries'
      if (keys(await call('GET', '/api/preferences')) !== kept) fail('H1-PREFS', 'the store did not survive a reload')
    },
  }),

  // The 1280 width is a desktop (mouse, no touch, desktop grid), and the
  // stubs catch Copy link and Open in new tab from a card's context menu.
  dashFlow('flow-h1-desktop', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    run: async ({ page, context, fail }) => {
      const env = await page.evaluate(() => ({
        hover: matchMedia('(hover: hover)').matches,
        coarse: matchMedia('(pointer: coarse)').matches,
        touchPoints: navigator.maxTouchPoints,
        phoneShown: !!document.querySelector('main.md\\:hidden')?.getClientRects().length,
      }))
      if (!env.hover || env.coarse || env.touchPoints || env.phoneShown) fail('H1-DESKTOP', `1280 is not a desktop: ${JSON.stringify(env)}`)
      const menuButton = (name) => page.locator('#card-context-menu').getByRole('button', { name, exact: true })
      // The menu opens at the pointer and runs downwards, so right-click a
      // card that starts in the top half of the window.
      const at = await page.evaluate(() => {
        for (const a of document.querySelectorAll('article[data-card-id]')) {
          const r = a.getBoundingClientRect()
          if (r.width && r.top > 80 && r.top < innerHeight / 2) return { x: r.left + 24, y: r.top + 24 }
        }
        return null
      })
      if (!at) return fail('H1-DESKTOP', 'no desktop card starts in the top half of the window')
      await page.mouse.click(at.x, at.y, { button: 'right' })
      await menuButton('Copy link').click()
      await page.mouse.click(at.x, at.y, { button: 'right' })
      await menuButton('Open in new tab').click()
      const log = await harnessLog(page)
      if (log.copied.length !== 1 || !/^https?:/.test(log.copied[0])) fail('H1-DESKTOP', `the clipboard stub holds ${JSON.stringify(log.copied)}`)
      if (log.opened.length !== 1 || log.opened[0].target !== '_blank') fail('H1-DESKTOP', `the window.open stub saw ${JSON.stringify(log.opened)}`)
      if (context.pages().length !== 1) fail('H1-DESKTOP', `${context.pages().length} pages are open; window.open was not stubbed`)
    },
  }),

  // --- PR1r: reload on a new build -------------------------------------------

  // The phone moves onto a new build when it comes back after 10 min or
  // more away: not sooner, not when it hid right after opening a story,
  // not when the user presses a key first, not onto a script that isn't
  // there, not with the Menu open or text in a field, not while a save
  // that didn't get through is still unsaved, only once the pending
  // writes are saved, and once per build. A check cut off by hiding
  // doesn't hold up the next return's, and a save the server refuses for
  // good (400, 409), or can't take at all (405: rolled back to before
  // PATCH), doesn't hold up the reload.
  dashFlow('flow-reload-on-new-build', {
    // Step 4's HEAD of the missing script and steps 6-8's refused saves
    // fail on purpose.
    expectedFailedLoads: ['/static/index-gone.js', '/api/preferences/starred_entries'],
    before: async ({ page }) => {
      await installClock(page)
      page._reload = await newBuild(page)
      // Saves (PATCH starred_entries): while `page._refuse` lists
      // statuses, each one is answered with the next of them (counted in
      // page._refused); the rest are held 500 ms and marked done just
      // before they are answered, so a reload that didn't wait for one
      // comes first. (Playwright reports a request a navigation cut short
      // as failed even when the page had its response, so
      // requestfinished can't tell.)
      page._refuse = []
      page._refused = 0
      page._saves = 0
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/starred_entries',
        async (route) => {
          if (route.request().method() !== 'PATCH') return route.fallback()
          page._saves++
          if (page._refuse.length) {
            const status = page._refuse.shift()
            await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: `refused (${status})` }) })
            page._refused++
            return
          }
          await sleep(500)
          page._reload.events.push('save-done')
          return route.fallback()
        },
      )
    },
    run: async ({ page, fail }) => {
      const log = page._reload
      const quiet = async (rule, what, checks) => {
        await sleep(1200)
        if (log.checks !== checks) fail(rule, `${what}: the update check fetched / (${log.checks} checks, expected ${checks})`)
        if (log.navs) fail(rule, `${what}: the page reloaded`)
      }
      const saveButton = () => page.locator(`${MOBILE_MAIN} button[aria-label="save for later"]`).first()
      const reloaded = async (navs) => {
        await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible', timeout: 20000 })
        await sleep(500)
        return log.navs === navs
      }

      // 1. Nine minutes away: no check at all.
      await away(page, 9)
      await quiet('RELOAD-AWAY', 'back after 9 min', 0)

      // 2. Hid right after opening a story (its thumbnail): left alone.
      await tap(page, page.locator(`${MOBILE_MAIN} [role="button"][aria-label^="open "][aria-label$=" in new tab"]`).first())
      if ((await harnessLog(page)).opened.length !== 1) return fail('RELOAD-OPEN', 'the thumbnail opened no story')
      await away(page, 11)
      await quiet('RELOAD-OPEN', 'back 11 min after opening a story', 0)

      // 3. A key pressed while the check is under way calls it off.
      let release
      page._hold = new Promise((r) => (release = r))
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 1, 3000))) return fail('RELOAD-INPUT', `back after 11 min ran ${log.checks} checks, expected 1`)
      await page.keyboard.press('Shift')
      release()
      page._hold = null
      await sleep(1200)
      if (log.heads.length || log.navs) fail('RELOAD-INPUT', `a key during the check still went on: ${JSON.stringify(log)}`)

      // 4. The new entry script isn't served: no reload.
      page._nextScript = '/static/index-gone.js'
      await away(page, 11)
      if (!(await waitFor(() => log.heads.length === 1, 3000))) return fail('RELOAD-HEAD', `no HEAD of the new entry script: ${JSON.stringify(log)}`)
      await sleep(1200)
      if (log.navs) fail('RELOAD-HEAD', 'reloaded onto a build whose entry script is a 404')
      page._nextScript = '/static/index-next.js'

      // 5. The Menu is open: no reload (it stops before the HEAD).
      await tap(page, page.locator('button[aria-label="open menu"]'))
      await menuOpened(page)
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 3, 3000))) return fail('RELOAD-BUSY', `back with the Menu open ran ${log.checks} checks, expected 3`)
      await sleep(1200)
      if (log.heads.length !== 1 || log.navs) fail('RELOAD-BUSY', `reloading went on with the Menu open: ${JSON.stringify(log)}`)
      await tap(page, page.locator(`${MENU} button[aria-label="close menu"]`))
      await page.locator(`${MENU}[inert]`).waitFor({ state: 'attached', timeout: 5000 })

      // 5b. Text typed in the header search (no sheet): no reload (it
      // stops before the HEAD).
      await tap(page, page.locator('button[aria-label="open search"]'))
      const search = page.locator('#app-search')
      await search.waitFor({ state: 'visible', timeout: 5000 })
      await search.fill('reload')
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 4, 3000))) return fail('RELOAD-FIELD', `back with text in the search field ran ${log.checks} checks, expected 4`)
      await sleep(1200)
      if (log.heads.length !== 1 || log.navs) fail('RELOAD-FIELD', `reloading went on with text in the search field: ${JSON.stringify(log)}`)

      // 5c. A check cut off by hiding (iOS suspends the page with its
      // fetch of / on the way) doesn't keep the next return from checking.
      // The field still holds text, so neither check goes on to a reload.
      let releaseHeld
      page._hold = new Promise((r) => (releaseHeld = r))
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 5, 3000))) return fail('RELOAD-RECHECK', `back after 11 min ran ${log.checks} checks, expected 5`)
      await away(page, 11)
      const rechecked = await waitFor(() => log.checks === 6, 3000)
      releaseHeld()
      page._hold = null
      if (!rechecked) return fail('RELOAD-RECHECK', 'back again while the cut-off check was still on the way: no check')
      await sleep(1200)
      if (log.heads.length !== 1 || log.navs) fail('RELOAD-RECHECK', `a check went on with text in the search field: ${JSON.stringify(log)}`)
      await tap(page, page.locator('button[aria-label="clear search"]'))
      await page.locator('button[aria-label="open search"]').waitFor({ state: 'visible', timeout: 5000 })

      // 6. A save the server refuses for good (400: a key a reverted
      // server doesn't take; it would refuse it every time) is neither
      // retried nor kept, and the next return reloads without sending it
      // again.
      let saves = page._saves
      page._refuse = [400, 400, 400]
      await tap(page, saveButton())
      if (!(await waitFor(() => page._saves === saves + 1, 3000))) return fail('RELOAD-REFUSED', 'the save was not sent')
      await sleep(2500)
      if (page._saves !== saves + 1) return fail('RELOAD-REFUSED', `a save refused with 400 was sent again (${page._saves - saves} PATCHes)`)
      await away(page, 11)
      if (!(await waitFor(() => log.navs === 1, 6000))) return fail('RELOAD-REFUSED', `a save refused with 400 kept the page from reloading: ${JSON.stringify(log)}`)
      if (page._saves !== saves + 1) fail('RELOAD-REFUSED', `the flush sent the refused save again (${page._saves - saves} PATCHes)`)
      if (!(await reloaded(1))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 1`)
      page._refuse = []

      // Away for `minutes` once the save sent when the page hid has had
      // its answer (`refused` refusals in all), so its fate is settled
      // before the page comes back.
      const awayAfterAnswer = async (minutes, refused) => {
        await setHidden(page, true)
        if (!(await waitFor(() => page._refused >= refused, 3000))) return false
        if (!(await waitFor(() => answered(page, 'PATCH', '/api/preferences/starred_entries'), 3000))) return false
        const at = await page.evaluate(() => Date.now())
        await page.clock.setSystemTime(at + minutes * 60_000)
        await setHidden(page, false)
        return true
      }

      // 7. Another build. A save waits in its 1 s batch (the clock is
      // paused); hiding the page sends it, the server refuses it with 409
      // ("reload to keep saving"), and coming back still reloads.
      page._nextScript = '/static/index-next2.js'
      let now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      saves = page._saves
      await tap(page, saveButton())
      await sleep(400)
      if (page._saves !== saves) return fail('RELOAD-REFUSED', 'the save went out before the page hid; nothing was pending')
      page._refuse = [409, 409, 409]
      if (!(await awayAfterAnswer(11, page._refused + 1))) return fail('RELOAD-REFUSED', 'hiding the page did not send the pending save')
      if (!(await waitFor(() => log.navs === 2, 6000))) return fail('RELOAD-REFUSED', `a pending save refused with 409 kept the page from reloading: ${JSON.stringify(log)}`)
      if (page._saves !== saves + 1) fail('RELOAD-REFUSED', `${page._saves - saves} PATCHes of the save, expected 1 (refused with 409)`)
      await page.clock.resume()
      if (!(await reloaded(2))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 2`)
      page._refuse = []

      // 8. Another build, and a save waits in its batch again. Hiding
      // sends it and the server can't take it (503); coming back sends it
      // again (the return and the reload's flush) and it still fails, so
      // the page stays.
      page._nextScript = '/static/index-next3.js'
      now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      saves = page._saves
      const events = log.events.length
      await tap(page, saveButton())
      await sleep(400)
      if (page._saves !== saves) return fail('RELOAD-FLUSH', 'the save went out before the page hid; nothing was pending')
      page._refuse = Array(8).fill(503)
      if (!(await awayAfterAnswer(11, page._refused + 1))) return fail('RELOAD-FLUSH', 'hiding the page did not send the pending save')
      if (!(await waitFor(() => page._saves >= saves + 2, 3000))) return fail('RELOAD-FLUSH', `coming back did not send the unsaved save again: ${page._saves - saves} PATCHes`)
      await sleep(1200)
      if (log.navs !== 2) return fail('RELOAD-SAVED', 'reloaded although the pending save did not get through')

      // 8b. Away again: hiding sends it and it fails again, and so does
      // the return. It still keeps the page. (Each hide waits for the
      // answer: a request still unanswered on the return is given up on,
      // not sent again, sync rule 4.)
      let before = page._saves
      if (!(await awayAfterAnswer(11, page._refused + 1))) return fail('RELOAD-FLUSH', 'hiding the page did not send the unsaved save')
      if (!(await waitFor(() => page._saves >= before + 2, 3000))) return fail('RELOAD-FLUSH', `coming back did not resend the unsaved save: ${page._saves - before} PATCHes`)
      await sleep(1200)
      if (log.navs !== 2) return fail('RELOAD-SAVED', 'reloaded although the save failed again')

      // 8c. The server takes it again once the save sent by the hide has
      // failed: back once more, the save is sent, and the page reloads only
      // once it is saved.
      page._refuse = [503]
      before = page._saves
      if (!(await awayAfterAnswer(11, page._refused + 1))) return fail('RELOAD-FLUSH', 'hiding the page did not send the unsaved save')
      if (!(await waitFor(() => log.navs === 3, 6000))) return fail('RELOAD-FLUSH', `back after 11 min with a new build: no reload: ${JSON.stringify(log)}`)
      const after = log.events.slice(events)
      if (after[0] !== 'save-done') fail('RELOAD-FLUSH', `the reload started before the pending save was done: ${after.join(', ')}`)
      if (page._saves < before + 2) fail('RELOAD-FLUSH', 'the save was not sent again before the reload')
      await page.clock.resume()
      if (!(await reloaded(3))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 3`)

      // 8d. Another build, served by a server rolled back to before PATCH:
      // every save answers 405. Hiding sends the pending save; the return
      // and the reload's flush send it again and get 405 too. Only the
      // reload onto the served build can cure that, so it goes ahead.
      page._nextScript = '/static/index-next4.js'
      now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      saves = page._saves
      await tap(page, saveButton())
      await sleep(400)
      if (page._saves !== saves) return fail('RELOAD-ROLLBACK', 'the save went out before the page hid; nothing was pending')
      page._refuse = Array(12).fill(405)
      if (!(await awayAfterAnswer(11, page._refused + 1))) return fail('RELOAD-ROLLBACK', 'hiding the page did not send the pending save')
      if (!(await waitFor(() => log.navs === 4, 6000))) return fail('RELOAD-ROLLBACK', `saves answered 405 kept the page from reloading onto the served build: ${JSON.stringify(log)}`)
      if (page._saves < saves + 2) fail('RELOAD-ROLLBACK', `the save was not sent again before the reload (${page._saves - saves} PATCHes)`)
      await page.clock.resume()
      if (!(await reloaded(4))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 4`)
      page._refuse = []

      // 9. The reloaded page still runs the old build (vite preview), and
      // the server still names the new one: it checks, but doesn't reload
      // again for the same build.
      const checks = log.checks
      await away(page, 11)
      if (!(await waitFor(() => log.checks === checks + 1, 3000))) return fail('RELOAD-ONCE', 'the reloaded page ran no check')
      await sleep(1200)
      if (log.navs !== 4) fail('RELOAD-ONCE', `reloaded again for the same build (${log.navs} reloads)`)
    },
  }),

  // The desktop never reloads by itself: back after 11 min with a new
  // build it shows "New version · Reload", with or without input during
  // the check, and the button goes once the server serves the page's own
  // build again. Clicking it reloads.
  dashFlow('flow-reload-desktop-button', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page }) => {
      await installClock(page)
      page._reload = await newBuild(page)
    },
    run: async ({ page, fail, shot }) => {
      const log = page._reload
      const button = page.getByRole('button', { name: 'New version · Reload', exact: true })
      if (await button.count()) return fail('RELOAD-DESKTOP', 'the Reload button shows before any check')

      // Back with no input at all: the button, and no reload.
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 1, 3000))) return fail('RELOAD-DESKTOP', `back after 11 min ran ${log.checks} checks, expected 1`)
      await sleep(1200)
      if (log.navs) return fail('RELOAD-DESKTOP', 'the desktop reloaded by itself')
      if (!(await button.isVisible())) return fail('RELOAD-DESKTOP', `no Reload button after 11 min away: ${JSON.stringify(log)}`)

      // The server serves the page's own build again: the button goes.
      page._nextScript = null
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 2, 3000))) return fail('RELOAD-DESKTOP', `back after 11 min ran ${log.checks} checks, expected 2`)
      if (!(await waitFor(async () => !(await button.count()), 3000))) return fail('RELOAD-DESKTOP', 'the Reload button stayed with the server serving this build')
      page._nextScript = '/static/index-next.js'

      // A new build again, with input during the check: the button comes back.
      let release
      page._hold = new Promise((r) => (release = r))
      await away(page, 11)
      if (!(await waitFor(() => log.checks === 3, 3000))) return fail('RELOAD-DESKTOP', `back after 11 min ran ${log.checks} checks, expected 3`)
      await page.mouse.wheel(0, 40)
      await page.keyboard.press('Shift')
      release()
      page._hold = null
      if (!(await waitFor(() => button.isVisible(), 3000))) return fail('RELOAD-DESKTOP', `no Reload button after 11 min away: ${JSON.stringify(log)}`)
      await shot('button')
      await sleep(1200)
      if (log.navs) return fail('RELOAD-DESKTOP', 'the desktop reloaded by itself')
      await button.click()
      if (!(await waitFor(() => log.navs === 1, 5000))) return fail('RELOAD-DESKTOP', `clicking Reload did not reload: ${JSON.stringify(log)}`)
      // The flow ends on the loaded page: closing the context while the
      // reload is still being fetched would throw in smoke's CSP route.
      await page.locator('main.grid article[data-card-id]').first().waitFor({ state: 'visible', timeout: 20000 })
      if (await button.count()) fail('RELOAD-DESKTOP', 'the Reload button is still there after the reload')
    },
  }),
  // --- PR7a: tab order and hiding ---------------------------------------------

  // Edit, ↑, Done moves a tab one place in 3 taps and one PUT; Edit, Move
  // to top, Done takes the last tab to second place (after Brief). Focus
  // stays on the pressed arrow, or goes to the opposite one when the
  // pressed one is now disabled, and the live line says where the tab is.
  dashFlow('flow-tabs-reorder', {
    run: async ({ page, fail, shot }) => {
      const writes = await prefWrites(page)
      const before = await stripLabels(page)
      const at = before.indexOf('News')
      if (at < 2) return fail('TABS-REORDER', `unexpected strip ${JSON.stringify(before)}`)
      await openTabsEditor(page)
      if ((await announced(page)) !== '') fail('TABS-REORDER', `the live line reads ${JSON.stringify(await announced(page))} before any move`)
      await tap(page, editorButton(page, 'Move News up'))
      await sleep(200)
      if ((await focusedLabel(page)) !== 'Move News up') fail('TABS-REORDER', `after ↑ focus is on ${JSON.stringify(await focusedLabel(page))}`)
      const live = `News, ${at} of ${before.length}`
      if ((await announced(page)) !== live) fail('TABS-REORDER', `the live line reads ${JSON.stringify(await announced(page))}, expected ${JSON.stringify(live)}`)
      await shot('editor')
      await closeTabsEditor(page)
      taps(page, 3, 'TABS-REORDER')
      const want = [...before]
      want.splice(at - 1, 0, ...want.splice(at, 1))
      const after = await stripLabels(page)
      if (JSON.stringify(after) !== JSON.stringify(want)) fail('TABS-REORDER', `the strip reads ${JSON.stringify(after)}, expected ${JSON.stringify(want)}`)
      if (!(await waitFor(() => layoutWrites(writes).length >= 1, 3000))) return fail('TABS-REORDER', 'the move sent no category_layout write')
      await sleep(500)
      const sent = layoutWrites(writes).map((w) => w.method)
      if (sent.join() !== 'PUT') fail('TABS-REORDER', `the move sent ${JSON.stringify(sent)}, expected one PUT`)
      // A move stores the whole order (every tab but Brief).
      const order = (prefMock(page.context()).value('category_layout') || {}).order || []
      const keyOf = (l) => (l === 'Saved' ? 'meta:saved' : l === 'For You' ? 'meta:foryou' : `cat:${l.toLowerCase()}`)
      if (JSON.stringify(order) !== JSON.stringify(want.slice(1).map(keyOf))) fail('TABS-REORDER', `the stored order is ${JSON.stringify(order)}, the strip ${JSON.stringify(want)}`)
      if ((await focusedLabel(page)) !== 'Edit tabs') fail('TABS-REORDER', `after Done focus is on ${JSON.stringify(await focusedLabel(page))}, expected the Edit pill`)

      // The last tab to second place.
      page._taps = 0
      const last = after[after.length - 1]
      await openTabsEditor(page)
      await tap(page, editorButton(page, `Move ${last} to top`))
      await sleep(200)
      if ((await focusedLabel(page)) !== `Move ${last} down`) fail('TABS-REORDER', `after Move to top focus is on ${JSON.stringify(await focusedLabel(page))}, expected Move ${last} down`)
      const top = `${last}, 2 of ${after.length}`
      if ((await announced(page)) !== top) fail('TABS-REORDER', `the live line reads ${JSON.stringify(await announced(page))}, expected ${JSON.stringify(top)}`)
      if (!(await editorButton(page, `Move ${last} up`).isDisabled())) fail('TABS-REORDER', `Move ${last} up is enabled at the top`)
      await closeTabsEditor(page)
      taps(page, 3, 'TABS-REORDER-TOP')
      const moved = await stripLabels(page)
      if (moved[0] !== 'Brief' || moved[1] !== last) fail('TABS-REORDER', `after Move to top the strip reads ${JSON.stringify(moved)}`)
      await sleep(500)
      if (layoutWrites(writes).length !== 2) fail('TABS-REORDER', `${layoutWrites(writes).length} category_layout writes for two moves`)
      await shot('end')
    },
  }),

  // The desktop grid and the Jump list follow the same order. The tab
  // editor opens from the Menu there (no strip), and focus goes back to ≡.
  dashFlow('flow-tabs-reorder-desktop', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    run: async ({ page, fail, shot }) => {
      const before = await gridLabels(page)
      if (before[0] !== 'Saved' || before.includes('For You')) fail('TABS-DESK', `the grid reads ${JSON.stringify(before)}`)
      await openMenu(page)
      await page.locator(MENU).getByRole('button', { name: 'Edit tabs' }).click()
      await page.locator(TABS_EDITOR).waitFor({ state: 'visible' })
      await page.locator(TABS_EDITOR).getByRole('button', { name: 'Move News to top', exact: true }).click()
      await page.locator(TABS_EDITOR).getByRole('button', { name: 'Done', exact: true }).click()
      await page.locator(TABS_EDITOR).waitFor({ state: 'detached' })
      await sleep(300)
      if ((await focusedLabel(page)) !== 'open menu') fail('TABS-DESK', `after Done focus is on ${JSON.stringify(await focusedLabel(page))}, expected ≡`)
      const grid = await gridLabels(page)
      const want = ['News', ...before.filter((l) => l !== 'News')]
      if (JSON.stringify(grid) !== JSON.stringify(want)) fail('TABS-DESK', `the grid reads ${JSON.stringify(grid)}, expected ${JSON.stringify(want)}`)
      await openMenu(page)
      const jump = await jumpLabels(page)
      const wantJump = ['News', 'Saved', 'For You', ...before.filter((l) => l !== 'News' && l !== 'Saved')]
      if (JSON.stringify(jump) !== JSON.stringify(wantJump)) fail('TABS-DESK', `Jump to column reads ${JSON.stringify(jump)}, expected ${JSON.stringify(wantJump)}`)
      await shot('end')
    },
  }),

  // Show off hides a tab from the strip and Jump to column, keeps its
  // stories in For You, and keeps its place: Show on brings it back there.
  dashFlow('flow-tab-hide', {
    run: async ({ page, fail, shot }) => {
      const writes = await prefWrites(page)
      const before = await stripLabels(page)
      await openTabsEditor(page)
      const sw = showSwitch(page, 'News')
      if ((await sw.getAttribute('aria-checked')) !== 'true') return fail('TAB-HIDE', 'News starts hidden')
      await tap(page, sw)
      if ((await sw.getAttribute('aria-checked')) !== 'false') fail('TAB-HIDE', 'the switch did not turn off')
      await closeTabsEditor(page)
      taps(page, 3, 'TAB-HIDE')
      const after = await stripLabels(page)
      if (JSON.stringify(after) !== JSON.stringify(before.filter((l) => l !== 'News'))) fail('TAB-HIDE', `the strip reads ${JSON.stringify(after)}`)
      if (!(await waitFor(() => layoutWrites(writes).length === 1, 3000))) return fail('TAB-HIDE', 'hiding sent no category_layout write')
      const stored = prefMock(page.context()).value('category_layout') || {}
      if (JSON.stringify(stored.hidden) !== '["cat:news"]') fail('TAB-HIDE', `the stored hidden list is ${JSON.stringify(stored.hidden)}`)
      // Hiding orders nothing: with no move, the order stays the default.
      if ((stored.order || []).length) fail('TAB-HIDE', `hiding stored an order: ${JSON.stringify(stored.order)}`)
      // Its stories stay in For You (101 is a News story).
      await tap(page, phoneTab(page, /^for you/i))
      if (!(await page.locator(`${MOBILE_MAIN} article[data-card-id="101"]`).count())) fail('TAB-HIDE', 'a News story left For You with its tab')
      await openMenu(page)
      const jump = await jumpLabels(page)
      if (jump.includes('News')) fail('TAB-HIDE', `Jump to column still offers News: ${JSON.stringify(jump)}`)
      if (JSON.stringify(jump) !== JSON.stringify(after.slice(1))) fail('TAB-HIDE', `Jump to column reads ${JSON.stringify(jump)}, the strip ${JSON.stringify(after)}`)
      await page.locator('button[aria-label="close menu"]').click()
      await sleep(500)
      await shot('hidden')
      // Shown again, in its old place.
      await openTabsEditor(page)
      await tap(page, showSwitch(page, 'News'))
      await closeTabsEditor(page)
      const back = await stripLabels(page)
      if (JSON.stringify(back) !== JSON.stringify(before)) fail('TAB-HIDE', `shown again, the strip reads ${JSON.stringify(back)}, expected ${JSON.stringify(before)}`)
    },
  }),

  // The arrow keys (desktop) never stop on a hidden tab, and the grid
  // leaves it out.
  dashFlow('flow-tab-hide-desktop', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ context }) => {
      prefMock(context).seed({ category_layout: { v: 1, order: [], hidden: ['cat:news'] } })
    },
    run: async ({ page, fail }) => {
      const grid = await gridLabels(page)
      if (grid.includes('News')) return fail('TAB-HIDE-DESK', `the grid still shows News: ${JSON.stringify(grid)}`)
      // One ArrowRight per grid column, each followed by ArrowDown: the
      // selected card's column, null where nothing is selected (Saved is
      // first and empty). For You, the row above the grid, is no stop.
      const visited = []
      for (let i = 0; i < grid.length + 1; i++) {
        if (i > 0) await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowDown')
        await sleep(150)
        visited.push(
          await page.evaluate(() => {
            const card = document.querySelector('main.grid article[data-card-id][tabindex="0"]')
            const h = card && card.closest('section') && card.closest('section').querySelector('header h2')
            return h ? h.textContent.trim() : null
          }),
        )
      }
      if (visited.includes('News')) fail('TAB-HIDE-DESK', `the arrow keys reached the hidden News: ${JSON.stringify(visited)}`)
      // The last press stays on the last column.
      const want = [null, ...grid.slice(1), grid[grid.length - 1]]
      if (grid[0] !== 'Saved') fail('TAB-HIDE-DESK', `the grid starts with ${JSON.stringify(grid[0])}`)
      if (JSON.stringify(visited) !== JSON.stringify(want)) fail('TAB-HIDE-DESK', `the arrow keys visited ${JSON.stringify(visited)}, expected ${JSON.stringify(want)}`)
    },
  }),

  // With a stored order, a new category goes at the end of the strip and
  // of Jump to column; the feed editor's category picker lists categories
  // in that order.
  dashFlow('flow-new-category-at-end', {
    before: async ({ page, context }) => {
      page._patches11 = await record(page, 'PATCH', '/api/sources/11')
      prefMock(context).seed({ category_layout: { v: 1, order: ['cat:video', ...DEFAULT_ORDER.filter((k) => k !== 'cat:video')], hidden: [] } })
    },
    run: async ({ page, fail }) => {
      const before = await stripLabels(page)
      if (before[1] !== 'Video') return fail('NEWCAT-END', `the stored order was not applied: ${JSON.stringify(before)}`)
      await openEditor(page, 11)
      const picked = await page.locator('#fe-category-11 optgroup[label="Your categories"] option').evaluateAll((els) => els.map((o) => o.value))
      if (picked[0] !== 'video' || picked.indexOf('deals') > picked.indexOf('news')) fail('NEWCAT-END', `the category picker lists ${JSON.stringify(picked)}, not in tab order`)
      await closeSettings(page)
      if ((await newHockeyCategory(page, fail, 'NEWCAT-END')) !== true) return
      const after = await stripLabels(page)
      if (after[after.length - 1] !== 'Hockey') fail('NEWCAT-END', `the new category is not last: ${JSON.stringify(after)}`)
      await openMenu(page)
      const jump = await jumpLabels(page)
      if (jump[jump.length - 1] !== 'Hockey') fail('NEWCAT-END', `Jump to column ends with ${JSON.stringify(jump[jump.length - 1])}`)
    },
  }),

  // With no stored order, a new category lands in label order, as it
  // always did.
  dashFlow('flow-new-category-alpha', {
    before: async ({ page }) => {
      page._patches11 = await record(page, 'PATCH', '/api/sources/11')
    },
    run: async ({ page, fail }) => {
      if ((await newHockeyCategory(page, fail, 'NEWCAT-ALPHA')) !== true) return
      const after = await stripLabels(page)
      if (after.indexOf('Hockey') !== after.indexOf('Deals') + 1) fail('NEWCAT-ALPHA', `the new category is out of label order: ${JSON.stringify(after)}`)
    },
  }),

  // Saved and For You are always tabs, right after Brief: empty, Saved
  // says "No stories yet" (no first-feed button: there are feeds).
  dashFlow('flow-saved-always', {
    run: async ({ page, fail, shot }) => {
      const tabs = await stripLabels(page)
      if (tabs[0] !== 'Brief' || tabs[1] !== 'Saved' || tabs[2] !== 'For You') return fail('SAVED-ALWAYS', `the strip reads ${JSON.stringify(tabs)}`)
      await tap(page, phoneTab(page, /^saved/i))
      if (await page.locator(`${MOBILE_MAIN} article[data-card-id]`).count()) return fail('SAVED-ALWAYS', 'Saved shows stories before anything was saved')
      if (!(await page.locator(MOBILE_MAIN).getByText('No stories yet', { exact: true }).isVisible())) fail('SAVED-ALWAYS', 'the empty Saved does not say "No stories yet"')
      if (await page.locator(`${MOBILE_MAIN} [data-first-feed]`).count()) fail('SAVED-ALWAYS', 'an empty Saved offers "Add your first feed" although there are feeds')
      if ((await storedTab(page)) !== 'meta:saved') fail('SAVED-ALWAYS', `a tap on the empty Saved stored ${JSON.stringify(await storedTab(page))}`)
      await shot('empty')
    },
  }),

  // A new device opens on For You whatever the stored order puts first.
  dashFlow('flow-fresh-device-opens-foryou', {
    before: async ({ context }) => {
      prefMock(context).seed({
        starred_entries: [103],
        category_layout: { v: 1, order: ['cat:news', 'meta:saved', 'meta:foryou'], hidden: [] },
      })
    },
    run: async ({ page, fail }) => {
      if (!(await waitFor(async () => (await stripLabels(page))[1] === 'News', 3000))) return fail('FRESH-FY', `the stored order was not applied: ${JSON.stringify(await stripLabels(page))}`)
      if (!(await waitFor(async () => (await storedTab(page)) !== null, 3000))) return fail('FRESH-FY', 'a new device stored no tab')
      const now = await selectedTab(page)
      if (!/^for you/i.test(now)) fail('FRESH-FY', `a new device opened on ${JSON.stringify(now)}`)
      if ((await storedTab(page)) !== 'meta:foryou') fail('FRESH-FY', `a new device stored ${JSON.stringify(await storedTab(page))}`)
    },
  }),

  // Only built-in feeds and no stories: For You (where a new device
  // opens) says "No stories yet" with "Add your first feed", which opens
  // Settings → Feeds.
  dashFlow('flow-first-feed-empty-meta', {
    wait: `${STRIP} [aria-selected="true"]`,
    before: async ({ page }) => {
      const builtIns = ['bbc_news', 'hn_top', 'nvd_recent', 'cisa_kev', 'rfd_hot_deals']
      const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      await page.route(
        (u) => new URL(u).pathname === '/api/sources',
        (route) => (route.request().method() === 'GET' ? route.fulfill(json(F.SOURCES.filter((src) => builtIns.includes(src.name)))) : route.fallback()),
      )
      await page.route((u) => /^\/api\/(entries|foryou)(\/|$)/.test(new URL(u).pathname), (route) => route.fulfill(json([])))
    },
    run: async ({ page, fail, shot }) => {
      const button = page.locator(`${MOBILE_MAIN} [data-first-feed]`)
      if (!(await waitFor(() => button.isVisible(), 3000))) return fail('FIRST-FEED', 'no "Add your first feed" button')
      const now = await selectedTab(page)
      if (!/^for you/i.test(now)) fail('FIRST-FEED', `a new device opened on ${JSON.stringify(now)}`)
      if (!(await page.locator(MOBILE_MAIN).getByText('No stories yet', { exact: true }).isVisible())) fail('FIRST-FEED', 'For You does not say "No stories yet"')
      const box = await button.boundingBox()
      if (!box || box.height < 43.5) fail('FIRST-FEED', `the button is ${box ? box.height : 0}px tall`)
      await shot('empty')
      await tap(page, button)
      await page.locator(SETTINGS).waitFor({ state: 'visible' })
      const tab = await page.evaluate(() => new URLSearchParams(location.search).get('tab'))
      if (tab !== 'feeds') fail('FIRST-FEED', `the button opened Settings on ${JSON.stringify(tab)}`)
      taps(page, 1, 'FIRST-FEED')
    },
  }),

  // A first load that fails says nothing about the owner's feeds: the
  // error banner shows, and an empty For You or Saved offers no "Add your
  // first feed". The button comes once a refresh brings the feed list
  // back with only built-ins.
  dashFlow('flow-first-feed-load-fails', {
    wait: `${STRIP} [aria-selected="true"]`,
    expectedFailedLoads: ['/api/sources'],
    before: async ({ page }) => {
      const builtIns = ['bbc_news', 'hn_top', 'nvd_recent', 'cisa_kev', 'rfd_hot_deals']
      const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      page._sourcesDown = true
      await page.route(
        (u) => new URL(u).pathname === '/api/sources',
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback()
          if (page._sourcesDown) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' })
          return route.fulfill(json(F.SOURCES.filter((src) => builtIns.includes(src.name))))
        },
      )
      await page.route((u) => /^\/api\/(entries|foryou)(\/|$)/.test(new URL(u).pathname), (route) => route.fulfill(json([])))
    },
    run: async ({ page, fail, shot }) => {
      const button = page.locator(`${MOBILE_MAIN} [data-first-feed]`)
      const empty = page.locator(MOBILE_MAIN).getByText('No stories yet', { exact: true })
      if (!(await waitFor(() => page.locator('[role="alert"]').isVisible(), 3000))) return fail('FIRST-FEED-FAIL', 'no error banner after the first load failed')
      for (const re of [/^for you/i, /^saved/i]) {
        await tap(page, phoneTab(page, re))
        if (!(await waitFor(() => empty.isVisible(), 3000))) fail('FIRST-FEED-FAIL', `${re.source} does not say "No stories yet"`)
        await sleep(200)
        if (await button.count()) fail('FIRST-FEED-FAIL', `${re.source} offers "Add your first feed" after a failed load`)
      }
      await shot('failed')
      // The feeds load (only built-ins): now the button shows.
      page._sourcesDown = false
      await startPoll(page)
      if (!(await waitFor(() => button.isVisible(), 3000))) fail('FIRST-FEED-FAIL', 'no "Add your first feed" once only built-in feeds loaded')
    },
  }),

  // Desktop: the arrow-key selection follows its column, not its place.
  // Moving the selected card's column (Edit tabs) keeps that card
  // selected, and ArrowDown goes on down the same column. Hiding the
  // column drops the card, and the selection moves to the column now at
  // its place.
  dashFlow('flow-desktop-select-follows-tab', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ context }) => {
      // Saved has a story, so the column that takes News's place has one
      // to select.
      prefMock(context).seed({ starred_entries: [103] })
    },
    run: async ({ page, fail }) => {
      const SEL = 'main.grid article[data-card-id][tabindex="0"]'
      const selected = () =>
        page.evaluate((sel) => {
          const card = document.querySelector(sel)
          const h = card && card.closest('section') && card.closest('section').querySelector('header h2')
          return card ? { id: card.getAttribute('data-card-id'), column: h ? h.textContent.trim() : null } : null
        }, SEL)
      const editTabs = async (name, role = 'button') => {
        await openMenu(page)
        await page.locator(MENU).getByRole('button', { name: 'Edit tabs' }).click()
        await page.locator(TABS_EDITOR).waitFor({ state: 'visible' })
        await page.locator(TABS_EDITOR).getByRole(role, { name, exact: true }).click()
        await page.locator(TABS_EDITOR).getByRole('button', { name: 'Done', exact: true }).click()
        await page.locator(TABS_EDITOR).waitFor({ state: 'detached' })
        await sleep(300)
      }
      const grid = await gridLabels(page)
      const at = grid.indexOf('News')
      if (at < 2) return fail('SELECT-KEY', `unexpected grid ${JSON.stringify(grid)}`)
      for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await sleep(150)
      const first = await selected()
      if (!first || first.column !== 'News') return fail('SELECT-KEY', `the arrow keys selected ${JSON.stringify(first)}, expected a News card`)

      await editTabs('Move News to top')
      const moved = await gridLabels(page)
      if (moved[0] !== 'News') return fail('SELECT-KEY', `Move News to top left the grid as ${JSON.stringify(moved)}`)
      const kept = await selected()
      if (!kept || kept.id !== first.id || kept.column !== 'News') fail('SELECT-KEY', `after moving News the selection is ${JSON.stringify(kept)}, expected card ${first.id} in News`)
      await page.keyboard.press('ArrowDown')
      await sleep(150)
      const down = await selected()
      if (!down || down.column !== 'News' || down.id === first.id) fail('SELECT-KEY', `ArrowDown after the move selected ${JSON.stringify(down)}, expected the next News card`)

      await editTabs('Show News', 'switch')
      const hidden = await gridLabels(page)
      if (hidden.includes('News')) return fail('SELECT-KEY', `hiding News left the grid as ${JSON.stringify(hidden)}`)
      if (await page.locator(SEL).count()) fail('SELECT-KEY', `a card is still selected after its column was hidden: ${JSON.stringify(await selected())}`)
      await page.keyboard.press('ArrowDown')
      await sleep(150)
      const next = await selected()
      if (!next || next.column !== hidden[0]) fail('SELECT-KEY', `ArrowDown after hiding News selected ${JSON.stringify(next)}, expected a card in ${hidden[0]}`)
    },
  }),

  // Desktop: an empty For You still has its row (it is a shown tab), so
  // Jump to column's For You lands on it.
  dashFlow('flow-foryou-empty-desktop', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page }) => {
      await page.route((u) => new URL(u).pathname === '/api/foryou', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    },
    run: async ({ page, fail, shot }) => {
      // The desktop row, not the phone's (hidden) For You column.
      const row = page.locator('section').filter({ visible: true, has: page.locator('header h2', { hasText: /^For You$/ }) })
      if (!(await waitFor(async () => (await row.count()) === 1, 3000))) return fail('FY-EMPTY-DESK', 'no For You row while For You is empty')
      if (!(await row.getByText('No stories yet', { exact: true }).isVisible())) fail('FY-EMPTY-DESK', 'the empty For You row does not say "No stories yet"')
      if (await row.locator('[data-first-feed]').count()) fail('FY-EMPTY-DESK', 'the empty For You row offers "Add your first feed" although there are feeds')
      await openMenu(page)
      if (!(await jumpLabels(page)).includes('For You')) return fail('FY-EMPTY-DESK', 'Jump to column has no For You')
      await page.locator(MENU).locator('h3:text-matches("jump to column", "i")').locator('xpath=../..').getByRole('button', { name: 'For You', exact: true }).click()
      await sleep(800)
      const top = await row.evaluate((el) => el.getBoundingClientRect().top)
      if (top < 0 || top > 200) fail('FY-EMPTY-DESK', `after Jump to For You its row starts at ${top}px`)
      await shot('empty')
    },
  }),

  // Filtered to one feed with no stories, the column says how that feed
  // is doing (slice 19): cisa_kev's last check failed.
  dashFlow('flow-filter-one-feed-status', {
    before: async ({ page }) => {
      await page.route(
        (u) => new URL(u).pathname === '/api/entries' && new URL(u).searchParams.getAll('source').length > 0,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      )
    },
    run: async ({ page, fail, shot }) => {
      await openMenu(page)
      await page.locator(MENU).getByRole('checkbox', { name: /^filter by cisa kev$/i }).check()
      await page.keyboard.press('Escape')
      if (!(await waitFor(async () => (await tabTexts(page)).length === 2, 3000))) return fail('FILTER-STATUS', `the filter left ${JSON.stringify(await tabTexts(page))}`)
      const status = page.locator(MOBILE_MAIN).getByText(/^last fetch failed: HTTP 503/)
      if (!(await waitFor(() => status.isVisible(), 3000))) {
        const text = ((await page.locator(MOBILE_MAIN).textContent()) || '').trim().slice(0, 200)
        return fail('FILTER-STATUS', `the empty one-feed filter does not show the feed's last error: ${JSON.stringify(text)}`)
      }
      await shot('status')
    },
  }),
  // --- PR3a: desktop single scroller and batching ----------------------------

  // The desktop scrolls as one page. With 25 For You cards (a row taller
  // than the window) the grid keeps its height instead of shrinking to
  // its padding, the document never scrolls, and the one data-scroller
  // is the wrapper around it all. A 70-story column renders 30 cards,
  // then 30 more once the wrapper scrolls to within 600px of its end.
  dashFlow('flow-desktop-layout', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page }) => {
      await withStories(page, moreNhl(67))
      const forYou = F.ENTRIES.slice(0, 25)
      await page.route((u) => new URL(u).pathname === '/api/foryou', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forYou) }))
    },
    run: async ({ page, fail, shot }) => {
      const row = page.locator('section').filter({ visible: true, has: page.locator('header h2', { hasText: /^For You$/ }) })
      if (!(await waitFor(async () => (await cardCount(row)) === 25, 5000))) return fail('DESK-LAYOUT', `the For You row has ${await cardCount(row)} cards, expected 25`)
      const scrollers = await page.evaluate(() =>
        [...document.querySelectorAll('[data-scroller]')].map((el) => ({ grid: !!el.querySelector('main.grid'), shown: el.getClientRects().length > 0 })),
      )
      if (scrollers.length !== 1 || !scrollers[0].grid || !scrollers[0].shown) fail('DESK-LAYOUT', `data-scroller is on ${JSON.stringify(scrollers)}, expected only the wrapper around the grid`)
      const box = await page.evaluate(() => {
        const sc = document.querySelector('[data-scroller]')
        const fy = [...document.querySelectorAll('section')].find((s) => s.getClientRects().length && s.querySelector('h2')?.textContent?.trim() === 'For You')
        return {
          grid: document.querySelector('main.grid').getBoundingClientRect().height,
          forYou: fy ? fy.getBoundingClientRect().height : 0,
          doc: document.scrollingElement.scrollHeight - innerHeight,
          scroller: sc ? sc.scrollHeight - sc.clientHeight : 0,
        }
      })
      if (box.forYou <= 800) fail('DESK-LAYOUT', `the For You row is ${box.forYou}px tall; the flow needs one taller than the window`)
      if (box.grid <= 300) fail('DESK-LAYOUT', `the grid is ${box.grid}px tall under a ${box.forYou}px For You row, expected more than 300px`)
      if (box.doc > 1) fail('DESK-LAYOUT', `the document scrolls by ${box.doc}px; only the wrapper should`)
      if (box.scroller <= 0) fail('DESK-LAYOUT', 'the wrapper has nothing to scroll')

      const nhl = page.locator('main.grid section').filter({ has: page.locator('header h2', { hasText: /^nhl$/i }) })
      if ((await nhl.count()) !== 1) return fail('DESK-LAYOUT', 'no NHL column in the grid')
      await sleep(500)
      const before = await cardCount(nhl)
      if (before !== 30) fail('DESK-LAYOUT', `the 70-story NHL column renders ${before} cards before any scroll, expected 30`)
      // The sentinel 300px under the wrapper's bottom edge: the next 30
      // load before the end of the column comes into view.
      if (!(await sentinelBelow(nhl, 300))) return fail('DESK-LAYOUT', 'the NHL column has no "load more" sentinel')
      if (!(await waitFor(async () => (await cardCount(nhl)) === 60, 3000))) return fail('DESK-LAYOUT', `with the wrapper scrolled to 300px above the column's end it renders ${await cardCount(nhl)} cards, expected 60`)
      await sleep(500)
      const after = await page.evaluate(() => ({ win: scrollY, wrapper: document.querySelector('[data-scroller]').scrollTop }))
      if ((await cardCount(nhl)) !== 60) fail('DESK-LAYOUT', `the column went on to ${await cardCount(nhl)} cards without another scroll`)
      if (after.win !== 0 || after.wrapper <= 0) fail('DESK-LAYOUT', `the scroll moved the window by ${after.win}px and the wrapper by ${after.wrapper}px; only the wrapper should move`)
      await shot('scrolled')
    },
  }),

  // A long tab grows as you scroll: 30 cards, then 60 once the list is
  // within 600px of its end, then all 70, with no "load more" row left.
  dashFlow('flow-auto-append', {
    before: async ({ page }) => {
      await withStories(page, moreNhl(67))
    },
    run: async ({ page, fail, shot }) => {
      await tap(page, phoneTab(page, /^nhl/i))
      if (!/^nhl/i.test(await selectedTab(page))) return fail('AUTO-APPEND', 'could not select the NHL tab')
      const column = page.locator(`${MOBILE_MAIN} section`)
      const list = page.locator(`${MOBILE_MAIN} section [data-scroller]`)
      const toEnd = () => list.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      if (!(await waitFor(async () => (await cardCount(column)) >= 30, 3000))) return fail('AUTO-APPEND', `the NHL tab renders ${await cardCount(column)} cards`)
      await sleep(500)
      if ((await cardCount(column)) !== 30) fail('AUTO-APPEND', `before any scroll the NHL tab renders ${await cardCount(column)} cards, expected 30`)
      // 300px short of the end: the next 30 load before the end shows.
      if (!(await sentinelBelow(column, 300))) return fail('AUTO-APPEND', 'the NHL list has no "load more" sentinel')
      if (!(await waitFor(async () => (await cardCount(column)) === 60, 3000))) return fail('AUTO-APPEND', `scrolled to 300px above the end, the list has ${await cardCount(column)} cards, expected 60`)
      await sleep(500)
      if ((await cardCount(column)) !== 60) fail('AUTO-APPEND', `the list went on to ${await cardCount(column)} cards without another scroll`)
      await toEnd()
      if (!(await waitFor(async () => (await cardCount(column)) === 70, 3000))) return fail('AUTO-APPEND', `after a second scroll to the end the list has ${await cardCount(column)} cards, expected 70`)
      if (await column.locator('[data-more]').count()) fail('AUTO-APPEND', 'the "load more" sentinel is still there with every card rendered')
      // The last batch went in below the scroll position: scroll to the
      // end again so the shot shows the last card, where the sentinel was.
      await toEnd()
      await sleep(300)
      const last = await list.evaluate((el) => {
        const cards = el.querySelectorAll('article[data-card-id]')
        const r = cards[cards.length - 1].getBoundingClientRect()
        const box = el.getBoundingClientRect()
        return r.bottom > box.top && r.top < box.bottom
      })
      if (!last) fail('AUTO-APPEND', 'the end shot does not show the last card')
      await shot('end')
    },
  }),
  // Crossing 768px hands the scroller over without a remount: the phone
  // list carries data-scroller (and is the sentinel root and the
  // tap-to-top target) only on the phone, the wrapper only on the
  // desktop. The stored section row keeps the Column's memo holding
  // across the flip, as on any tab whose Fresh or History was ever
  // toggled, so only a prop the memo compares can re-render it.
  dashFlow('flow-scroller-rotate', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page, context }) => {
      await withStories(page, moreNhl(67))
      await page.addInitScript(() => localStorage.setItem('popping.v1.mobileTab', 'cat:nhl'))
      prefMock(context).seed({ 'column_sections:nhl': {} })
    },
    run: async ({ page, fail }) => {
      const scrollers = () =>
        page.evaluate(() => [...document.querySelectorAll('[data-scroller]')].map((el) => (el.querySelector('main.grid') ? 'wrapper' : el.closest('main.md\\:hidden') ? 'phone' : 'other')))
      const one = (want) => waitFor(async () => JSON.stringify(await scrollers()) === JSON.stringify([want]), 3000)
      if (!(await one('wrapper'))) fail('ROTATE', `at 1280 data-scroller is on ${JSON.stringify(await scrollers())}, expected only the wrapper`)

      await page.setViewportSize({ width: 390, height: 844 })
      if (!(await one('phone'))) return fail('ROTATE', `after 1280 → 390 data-scroller is on ${JSON.stringify(await scrollers())}, expected only the phone list`)
      if (!/^nhl/i.test(await selectedTab(page))) return fail('ROTATE', `the phone shows ${JSON.stringify(await selectedTab(page))}, expected the NHL tab`)
      const column = page.locator(`${MOBILE_MAIN} section`)
      const list = page.locator(`${MOBILE_MAIN} section [data-scroller]`)
      if (!(await sentinelBelow(column, 300))) return fail('ROTATE', 'the NHL list has no "load more" sentinel')
      if (!(await waitFor(async () => (await cardCount(column)) === 60, 3000))) fail('ROTATE', `after 1280 → 390, scrolled to 300px above the end, the list has ${await cardCount(column)} cards, expected 60`)
      const top = () => list.evaluate((el) => el.scrollTop)
      if ((await top()) <= 200) return fail('ROTATE', 'the NHL list did not scroll down')
      // A click: this context (a desktop one) has no touch.
      await phoneTab(page, /^nhl/i).click()
      if (!(await waitFor(async () => (await top()) === 0, 3000))) fail('ROTATE', `after 1280 → 390 a tap on the shown tab left the list at ${await top()}`)

      await page.setViewportSize({ width: 1280, height: 800 })
      if (!(await one('wrapper'))) fail('ROTATE', `after 390 → 1280 data-scroller is on ${JSON.stringify(await scrollers())}, expected only the wrapper`)
    },
  }),
  // ArrowDown past the first 30 cards: the selected card is rendered
  // (the batch grows to reach it), selected and scrolled into view.
  dashFlow('flow-desktop-keys-past-batch', {
    widths: [1280],
    wait: 'main.grid article[data-card-id]',
    before: async ({ page }) => {
      await withStories(page, moreNhl(67))
    },
    run: async ({ page, fail }) => {
      const grid = await gridLabels(page)
      const at = grid.findIndex((l) => /^nhl$/i.test(l))
      if (at < 0) return fail('KEYS-BATCH', `no NHL column in ${JSON.stringify(grid)}`)
      for (let i = 0; i < at; i++) await page.keyboard.press('ArrowRight')
      for (let i = 0; i < 31; i++) await page.keyboard.press('ArrowDown')
      const nhl = page.locator('main.grid section').filter({ has: page.locator('header h2', { hasText: /^nhl$/i }) })
      const sel = nhl.locator('article[data-card-id][tabindex="0"]')
      if (!(await waitFor(async () => (await sel.count()) === 1, 3000))) return fail('KEYS-BATCH', `after 31 ArrowDowns no NHL card is selected (${await cardCount(nhl)} rendered)`)
      const ids = await nhl.locator('article[data-card-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id')))
      const id = await sel.getAttribute('data-card-id')
      if (ids.indexOf(id) !== 30) fail('KEYS-BATCH', `the selected card is number ${ids.indexOf(id) + 1} of the column, expected 31`)
      if (ids.length !== 60) fail('KEYS-BATCH', `the column renders ${ids.length} cards, expected 60 (the batch grown to reach the selection)`)
      if (!(await waitFor(() => sel.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight
      }), 3000))) fail('KEYS-BATCH', 'the selected card was not scrolled into view')
    },
  }),
]
