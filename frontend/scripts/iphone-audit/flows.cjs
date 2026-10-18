// Behaviour flows for smoke.cjs (REDESIGN_PLAN.md section 12). Each flow
// has the same shape as a smoke state, with `checks: false` and a `run`
// that calls fail(rule, detail) for each problem. They run at 390 only.
//
// Flows record the requests they care about with page routes, which run
// before capture.cjs's context mock and then fall through to it.
// smoke.cjs requires this file, so it must not require smoke.cjs.
'use strict'

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

const flow = (name, fields) => ({
  name,
  url: '/?view=settings&tab=feeds',
  widths: [390],
  checks: false,
  ...fields,
})

// PR5 flows run from the dashboard.
const dashFlow = (name, fields) => flow(name, { url: '/', ...fields })

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
]
