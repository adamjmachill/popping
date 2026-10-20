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
// their keepalive flag, which Playwright's Request does not expose
// (harnessLog()).
//
// Time. Flows that assert dwell, batch, toast, poll or arrival timing call
// installClock(page) in `before` and move time with page.clock.runFor (as
// flow-fn-quiet-poll does). runFor also fires the regular visible poll, so
// GET counts allow for it. Where real time is kept, pause at least twice
// the delay under test.
'use strict'

const F = require('./fixtures.cjs')

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
    try {
      const req = input instanceof Request ? input : null
      const url = new URL(req ? req.url : String(input), location.href)
      if (/^\/api\/(preferences|interactions)(\/|$)/.test(url.pathname)) {
        h.fetches.push({
          method: String((init && init.method) || (req && req.method) || 'GET').toUpperCase(),
          path: url.pathname,
          keepalive: !!(init && 'keepalive' in init ? init.keepalive : req && req.keepalive),
        })
      }
    } catch {
      // A URL the wrapper can't read is still fetched as usual.
    }
    return realFetch.apply(this, arguments)
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
// { fetches: [{ method, path, keepalive }], opened, shared, copied }.
const harnessLog = (page) => page.evaluate(() => window.__harness)

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
    before: async ({ page }) => {
      const preset = { id: 'p1', name: 'Deals view', activeSources: ['slickdeals_frontpage', 'rfd_hot_deals'], columnPrefs: {} }
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: [{ key: 'filter_presets', value: [preset], updated_at: new Date(F.NOW).toISOString() }] }),
              })
            : route.fallback(),
      )
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
      await page.locator(SETTINGS).getByRole('button', { name: 'Clear local state', exact: true }).click()
      const keep = page.locator(SETTINGS).getByRole('button', { name: 'Keep', exact: true })
      if (!(await keep.isVisible())) return fail('FZ', 'no inline confirm after Clear local state')
      if (!(await page.locator(SETTINGS).getByRole('button', { name: 'Clear', exact: true }).isVisible())) fail('FZ', 'the confirm has no Clear')
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
  dashFlow('flow-h1-pref-store', {
    // The read after DELETE is a 404 on purpose.
    expectedFailedLoads: ['/api/preferences/hidden_entries'],
    run: async ({ page, fail }) => {
      const call = (method, path, body) =>
        page.evaluate(
          async ([m, p, b]) => {
            const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
            return { status: r.status, body: r.status === 204 ? null : await r.json() }
          },
          [method, path, body],
        )
      const keys = (res) => res.body.items.map((i) => i.key).sort().join(',')
      const a = await call('PUT', '/api/preferences/hidden_entries', { value: [101] })
      const b = await call('PUT', '/api/preferences/starred_entries', { value: [102] })
      if (a.body.updated_at >= b.body.updated_at) fail('H1-PREFS', `writes are out of order: ${a.body.updated_at}, ${b.body.updated_at}`)
      const all = await call('GET', '/api/preferences')
      if (keys(all) !== 'hidden_entries,starred_entries') fail('H1-PREFS', `GET lists ${keys(all)}`)
      const since = await call('GET', `/api/preferences?since=${encodeURIComponent(a.body.updated_at)}`)
      if (keys(since) !== 'starred_entries') fail('H1-PREFS', `GET since the first write lists ${keys(since)}`)
      const one = await call('GET', '/api/preferences/starred_entries')
      if (JSON.stringify(one.body.value) !== '[102]') fail('H1-PREFS', `GET by key returns ${JSON.stringify(one.body)}`)
      await call('DELETE', '/api/preferences/hidden_entries')
      if ((await call('GET', '/api/preferences/hidden_entries')).status !== 404) fail('H1-PREFS', 'a deleted key still reads back')
      await page.reload()
      await page.locator(`${MOBILE_MAIN} article[data-card-id]`).first().waitFor({ state: 'visible' })
      const loaded = await harnessLog(page).then((h) => h.fetches.filter((f) => f.method === 'GET' && f.path === '/api/preferences').length)
      if (loaded !== 1) fail('H1-PREFS', `the reload sent ${loaded} GET /api/preferences`)
      if (keys(await call('GET', '/api/preferences')) !== 'starred_entries') fail('H1-PREFS', 'the store did not survive a reload')
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
  // good (400, 409) doesn't hold up the reload.
  dashFlow('flow-reload-on-new-build', {
    // Step 4's HEAD of the missing script and steps 6-8's refused saves
    // fail on purpose.
    expectedFailedLoads: ['/static/index-gone.js', '/api/preferences/starred_entries'],
    before: async ({ page }) => {
      await installClock(page)
      page._reload = await newBuild(page)
      // Saves (PUT starred_entries): while `page._refuse` lists statuses,
      // each one is answered with the next of them; the rest are held
      // 500 ms and marked done just before they are answered, so a reload
      // that didn't wait for one comes first. (Playwright reports a
      // request a navigation cut short as failed even when the page had
      // its response, so requestfinished can't tell.)
      page._refuse = []
      page._savePuts = 0
      await page.route(
        (u) => new URL(u).pathname === '/api/preferences/starred_entries',
        async (route) => {
          if (route.request().method() !== 'PUT') return route.fallback()
          page._savePuts++
          if (page._refuse.length) {
            const status = page._refuse.shift()
            return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: `refused (${status})` }) })
          }
          await sleep(500)
          page._reload.events.push('put-done')
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
      let puts = page._savePuts
      page._refuse = [400, 400, 400]
      await tap(page, saveButton())
      if (!(await waitFor(() => page._savePuts === puts + 1, 3000))) return fail('RELOAD-REFUSED', 'the save was not sent')
      await sleep(2500)
      if (page._savePuts !== puts + 1) return fail('RELOAD-REFUSED', `a save refused with 400 was sent again (${page._savePuts - puts} PUTs)`)
      await away(page, 11)
      if (!(await waitFor(() => log.navs === 1, 6000))) return fail('RELOAD-REFUSED', `a save refused with 400 kept the page from reloading: ${JSON.stringify(log)}`)
      if (page._savePuts !== puts + 1) fail('RELOAD-REFUSED', `the flush sent the refused save again (${page._savePuts - puts} PUTs)`)
      if (!(await reloaded(1))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 1`)
      page._refuse = []

      // 7. Another build. A save waits in the debounce (the clock is
      // paused) while the page is away; coming back sends it, the server
      // refuses it with 409 ("reload to keep saving"), and the page still
      // reloads.
      page._nextScript = '/static/index-next2.js'
      let now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      puts = page._savePuts
      await tap(page, saveButton())
      await sleep(400)
      if (page._savePuts !== puts) return fail('RELOAD-REFUSED', 'the save went out before the page hid; nothing was pending')
      page._refuse = [409, 409, 409]
      await away(page, 11)
      if (!(await waitFor(() => log.navs === 2, 6000))) return fail('RELOAD-REFUSED', `a pending save refused with 409 kept the page from reloading: ${JSON.stringify(log)}`)
      if (page._savePuts !== puts + 1) fail('RELOAD-REFUSED', `${page._savePuts - puts} PUTs of the save, expected 1 (refused with 409)`)
      await page.clock.resume()
      if (!(await reloaded(2))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 2`)
      page._refuse = []

      // 8. Another build, and a save waits in the debounce again. Coming
      // back sends it, the server can't take it (503), and the page stays.
      page._nextScript = '/static/index-next3.js'
      now = await page.evaluate(() => Date.now())
      await page.clock.pauseAt(now + 1000)
      puts = page._savePuts
      const events = log.events.length
      await tap(page, saveButton())
      await sleep(400)
      if (page._savePuts !== puts) return fail('RELOAD-FLUSH', 'the save went out before the page hid; nothing was pending')
      page._refuse = [503]
      await away(page, 11)
      if (!(await waitFor(() => page._savePuts >= puts + 1, 3000))) return fail('RELOAD-FLUSH', `coming back did not send the pending save: ${JSON.stringify(log)}`)
      await sleep(1200)
      if (log.navs !== 2) return fail('RELOAD-SAVED', 'reloaded although the pending save did not get through')

      // 8b. Back again: the flush sends it once more (its retry timer is
      // paused) and it fails a second time. Given up on, it still keeps
      // the page.
      page._refuse = [503]
      await away(page, 11)
      if (!(await waitFor(() => page._savePuts >= puts + 2, 3000))) return fail('RELOAD-FLUSH', `coming back did not resend the unsaved save: ${page._savePuts - puts} PUTs`)
      await sleep(1200)
      if (log.navs !== 2) return fail('RELOAD-SAVED', 'reloaded although the save failed twice')

      // 8c. Back again: the flush sends it a third time, and the page
      // reloads only once it is saved.
      await away(page, 11)
      if (!(await waitFor(() => log.navs === 3, 6000))) return fail('RELOAD-FLUSH', `back after 11 min with a new build: no reload: ${JSON.stringify(log)}`)
      const after = log.events.slice(events)
      if (after[0] !== 'put-done') fail('RELOAD-FLUSH', `the reload started before the pending save was done: ${after.join(', ')}`)
      if (page._savePuts !== puts + 3) fail('RELOAD-FLUSH', `${page._savePuts - puts} PUTs of the save, expected 3 (failed twice, then saved)`)
      await page.clock.resume()
      if (!(await reloaded(3))) return fail('RELOAD-ONCE', `${log.navs} reloads, expected 3`)

      // 9. The reloaded page still runs the old build (vite preview), and
      // the server still names the new one: it checks, but doesn't reload
      // again for the same build.
      const checks = log.checks
      await away(page, 11)
      if (!(await waitFor(() => log.checks === checks + 1, 3000))) return fail('RELOAD-ONCE', 'the reloaded page ran no check')
      await sleep(1200)
      if (log.navs !== 3) fail('RELOAD-ONCE', `reloaded again for the same build (${log.navs} reloads)`)
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
]
