# iPhone layout scripts

Everything here renders the built app in a browser with iPhone emulation
(390x844 at 3x and 320x568 at 2x, touch on; a few states also at 312x675, a
390 phone with Page Zoom at 125%; desktop flows at 1280x800 with no touch)
against a fully mocked API
(`capture.cjs` `mockApi`, data in `fixtures.cjs`). All scripts are CommonJS
(`.cjs`) because `frontend/package.json` is `"type": "module"`, and card
locators are scoped to `main.md\:hidden` because App renders the hidden
desktop grid too.

| File | What it is |
|---|---|
| `smoke.cjs` | The layout guard. Runs in CI on every push; exit 1 on any failure. |
| `flows.cjs` | Behaviour flows: what the app sends when a person uses it. `smoke.cjs` loads it and runs each flow at 390. |
| `capture.cjs` | The original audit: screenshots plus a raw overflow scan per state. Exports `mockApi` and `IOS_UA`. |
| `probe.cjs` | Targeted measurements behind the audit. |
| `fixtures.cjs` | Sources, entries and settings the mock serves, plus the long strings the checks lean on. |
| `run.sh` | Local wrapper: build, preview on 4173, then capture, analyze and probe. |

## Requirements

Node 22 and the `playwright` package resolvable with `require()` plus a
browser it can launch. Nothing is added to `package.json`.

- Claude Code cloud container: `playwright` is
  `/opt/node-tools/node_modules/playwright` (on `NODE_PATH`) and Chromium is in
  `/opt/pw-browsers`, so set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Never
  run `playwright install` there (the CDN is blocked). WebKit is not available.
- CI: `npm install --no-save ... playwright@1.56.1` and
  `npx playwright install --with-deps chromium webkit` (see below).
- Elsewhere: install `playwright` outside the repo (or `--no-save`) and
  `npx playwright install chromium`.

`smoke.cjs` never sets `PLAYWRIGHT_BROWSERS_PATH`; the caller does.
`run.sh` exports it because it is the local-only wrapper.

## smoke.cjs

    node scripts/iphone-audit/smoke.cjs <base> [--csp] [--strict] \
         [--browser chromium|webkit] [--out <dir>] [--only <state>[,<state>...]] \
         [--states-only]

- `<base>`: where `vite preview` serves the build, e.g. `http://127.0.0.1:4173`.
- `--csp`: serve every document with the production Content-Security-Policy,
  read from `frontend/nginx.conf.template` with one regex, and fail on any
  "Refused to" console message (rule C9). Chromium only; ignored with a note
  under `--browser webkit`. Exits 1 if the template has no CSP.
- `--strict`: C6 and C7 fail the run instead of warning (from PR9).
- `--browser webkit`: Playwright's `devices['iPhone 13']` with the viewport set
  explicitly to each width (the descriptor's own viewport is 390x664).
  Chromium uses an iOS Safari user agent with `isMobile` and `hasTouch`.
- `--out <dir>`: write `<width>-<state>.png` for every state. Without it no
  screenshots are taken (CI cannot retrieve them anyway). That picture is
  taken before a flow's `run`, so it shows where a flow starts; a flow saves
  its later steps with `shot(label)`, written as `<width>-<state>-<label>.png`.
- `--only`: run only the named states (comma-separated).
- `--states-only`: skip the behaviour flows (`flows.cjs`). CI's WebKit
  report-only run uses it.

After the summary, the 10 slowest flows are listed with their times.

Local run, from `frontend/` (section 13 of the plan):

    npm ci && npm run build
    ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
    P=$!
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
      node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --out "$SCRATCHPAD/smoke"
    kill $P

Look at every PNG afterwards: the rules catch overflow, your eyes catch "this
looks wrong".

### How a state runs

For each width, each state gets a fresh browser context (never
`setViewportSize`: long sessions gave false `pointer: coarse` readings) with
`colorScheme: 'dark'`, the `en-CA` locale, the `America/Vancouver` time zone
and `clock.setFixedTime(F.NOW)`, so relative times ("12m ago") are stable.
`setFixedTime` freezes `Date.now` but timers keep running. The phone widths
have `isMobile`, `hasTouch` and an iOS user agent. The 1280 width
(`desktop: true`, not in the default widths) has neither, uses a desktop
Safari user agent and skips C1; only states and flows that list it run there,
and they need `wait: 'main.grid article[data-card-id]'`, because the default
wait looks for a phone card in the hidden `main.md:hidden`. Then:

1. `mockApi(context, { onUnmocked })`, the runtime listeners (C8) and, with
   `--csp`, the CSP route (C9); then the state's `before` hook (extra routes);
2. open `url`, wait for a phone card (`main.md\:hidden article[data-card-id]`)
   or the state's `wait` selector, let requests settle and the load-time
   "refreshed" toast go away;
3. run the state's `setup`, let requests settle, wait 400 ms;
4. run the layout rules, take the screenshot, then run the rules that
   temporarily change the page (C2b, C6), which put everything back;
5. run the state's `run({ page, context, width, settle, fail, shot })`.

### States (PR2)

| State | What it shows |
|---|---|
| `dashboard` | the phone dashboard at 390, 320 and 312 (also runs C2b and C16); the App's top bar (`header[data-app-header]`, not the Column headers) must hold exactly search, refresh and the Menu button, and no settings gear |
| `card-summary` | summaries open on card 101 (180-character title, thumbnail, 60-character source) and 102 (90-character unbroken token) |
| `search-x` | search open with "x" typed |
| `search-60` | search with the 60-character `F.SEARCH_QUERY_60` (results header) |
| `menu` | the Menu (≡, `open menu`) after its slide-in, at 390, 320 and 312 |
| `settings-feeds` | Settings → Feeds (`?view=settings&tab=feeds`) |
| `settings-add-youtube` | Feeds → the third feed-manager tab (Add), YouTube selected, long name and URL typed |
| `settings-add-error` | Add, YouTube, a Test that fails with YouTube's longest message (`F.YOUTUBE_BLOCKED_MESSAGE`) |
| `settings-add-newcat` | Add, the category picker's New-category field with a long name |
| `settings-add-headers` | Add, Advanced open: a browser identity and a refused `Cookie` header |
| `settings-suggested` | Feeds → the second feed-manager tab (Suggested) |
| `settings-llm` | the AI tab |
| `settings-notifications`, `settings-history`, `settings-hidden`, `settings-starred` (Saved), `settings-voted` (Downvoted), `settings-reset` | one per tab via `?view=settings&tab=`; `settings-reset` also holds the build line (PR1r), which passes C14 at 320 |
| `brief-empty` | 320 only: the phone Brief tab with `/api/brief/latest` returning `[]` |
| `brief-needs-ai` | PR1c, at 390, 320 and 312: `/api/llm/status` says `configured: false`; the phone Brief tab, expanded, with no brief: "Brief needs an AI provider · Set up" on its own 44px row, on one line |
| `brief-needs-ai-compact` | PR1c, the same at 390, 320 and 312 with one brief, collapsed: the Set up row under "Brief" and its time |

Selectors avoid visible labels that the redesign changes: feed-manager tabs are
picked by position, headers by `aria-label` (`close settings`, `close menu`).

To add a state, append to `STATES` in `smoke.cjs`:

    { name, url, widths, wait, before({ page, context }), setup({ page, settle }),
      extra: ['C16'], checks: false, run({ page, fail, shot }) }

Every field but `name` is optional. `extra` adds rules for that state only;
`checks: false` skips the layout rules; `run` does assertions after the checks
and reports with `fail(rule, detail)`.

### Rules

| Rule | Check |
|---|---|
| C1 | `matchMedia('(pointer: coarse)')` matches (the harness really is a touch phone). |
| C2 | `body.scrollWidth` and `#root.scrollWidth` ≤ `innerWidth` (`html` hides overflow behind `overflow-x: clip`). Names the widest box outside any scroller. |
| C2b | `dashboard` only: with `#root` given a 34px bottom padding (the home indicator; Chromium's `env()` is 0), `document.scrollingElement.scrollHeight` ≤ `innerHeight + 1`, and no in-flow child of `#root` ends below its content box. The second half is needed because `#root` is border-box, so Chromium shows the overlap that iOS turns into a scroll range. |
| C3 | Every visible box has `left ≥ -1` and `right ≤ innerWidth + 1`. Only descendants of `[data-hscroll]` are skipped. |
| C4 | Every visible vertical scroller (computed `overflow-y` auto or scroll; not `[data-hscroll]` strips, not form controls) has `scrollWidth ≤ clientWidth + 1` and `overscroll-behavior-y: contain`. |
| C5 | Each line of every text node lies inside its nearest ancestor whose `overflow-x` is not visible (or the viewport), unless an ancestor up to that box has `text-overflow: ellipsis` or `-webkit-line-clamp`, a `[data-hscroll]` strip is in between, or the box is ≤ 1px or `clip: rect(0 0 0 0)` (sr-only). |
| C6 | With the `(pointer: coarse)` 16px `!important` rule deleted through CSSOM, every visible input (not checkbox, radio, range), select and textarea is ≥ 16px. The rule is put back afterwards. Warning until `--strict`. |
| C7 | Inside `[role=dialog]`, the Menu, `header`, `[role=tablist]` and toast buttons: every button, link, select, `[role=button/tab/switch]` is ≥ 43.5px tall, and ≥ 43.5px wide when it has no text; checkboxes and radios are measured on their `label`; `[data-tap-exempt]` is skipped. Warning until `--strict`. |
| C8 | No `pageerror`, no console error except the expected `/auth/me` 404, no request the mock does not answer, no `alert`/`confirm`/`prompt`. |
| C9 | With `--csp`: no "Refused to" console message. |
| C11 | Text inside `button`, `[role=tab]`, `time`, `[data-one-line]` or a `nowrap` link sits on one line. |
| C12 | Inside the phone `main`, the Settings dialog and the Menu: every text line and every input, select and button is ≥ 8px from both screen edges, unless inside `[data-bleed]` or `[data-hscroll]`. |
| C13 | A card headline is ≥ 55% of the card's content box; no text block is taller than 8 lines while narrower than 160px. |
| C14 | A box with `text-overflow: ellipsis` is at least `min(96px, its scrollWidth)` wide. |
| C15 | No visible `input[type=search]`. |
| C16 | The top bar's title (`header h1`) is not cut off (`scrollWidth <= clientWidth`). |
| C17 | Every state and flow: no `PUT /api/preferences/<key>` of a set key (`starred_entries`, `hidden_entries`, `voted_entries`, `read_entries:*`, `seen:*`). From PR2b they change only by PATCH; PR2c makes the server refuse the PUT. The mock reports it (`onSetKeyPut`). |

"Visible" means: has client rects, not `visibility: hidden`, no ancestor at
opacity 0, not inside `[inert]` or `[aria-hidden="true"]`, not inside the
closed Menu (its panel starts at or past `innerWidth`), and, while an
`aria-modal` dialog is open, inside that dialog (or a `[role=status]` toast):
the Settings sheet and the Menu cover the page behind them.

Each rule reports the outermost offender only (a failing button is reported,
its label text is not reported again under the same rule).

Markers the rules understand: `data-hscroll` (an intentional horizontal strip),
`data-bleed` (edge-to-edge on purpose), `data-one-line` (must not wrap),
`data-tap-exempt` (prose links inside cards).

### Output

Each state prints one progress line. Then every failure is printed in full:

    FAIL <width> <state> <rule>: <what is wrong>
        at   <selector path>
        rect l=… t=… r=… b=… (w x h)
        text "<text>"

When `GITHUB_ACTIONS` is set the failures are also `::error::` annotations
(CI screenshots cannot be retrieved and annotations stay readable when raw
logs are not). GitHub keeps only the first few annotations of a step, so there
is one annotation per distinct problem (rule, element, text) naming every
width and state it failed in. Each warning rule gets one `::warning::` summary.
Warnings (C6, C7 without `--strict`) are listed once per width, rule and
element, with the states they appeared in. A summary of counts per width,
state and rule closes the output. Exit 1 on any failure, 2 on a usage error.

### CI

`.github/workflows/build.yml`, job `frontend-checks`, after `npm run build`:
installs `playwright@1.56.1` with `--no-save` (and proves `package.json` and
the lockfile are untouched), installs Chromium and WebKit, starts
`vite preview` on 127.0.0.1:4173, then runs

    node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --strict
    node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --browser webkit --states-only   # report only

The WebKit step is `continue-on-error`: WebKit on Linux is not iOS Safari.
It skips the flows, which drive Chromium's touch input and would add about
as much time again for a report nobody gates on. The job has a 30-minute
timeout.

Read CI failures with
`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`.

## flows.cjs

Each flow is shaped like a state with `checks: false` and a `run`, and runs at
390 in its own context with the same mock, clock, CSP and C8 listeners. A flow
records the requests it cares about with a page route (`record()`), which runs
before `capture.cjs`'s context mock and then falls through to it, or answers
for it. `flows.cjs` must not require `smoke.cjs` (smoke requires it).

| Flow | What it proves |
|---|---|
| `flow-fj-youtube-handle` | YouTube, `@handle`, Name blank: Test and Add are enabled; Add sends the resolved feed and `somehandle_yt` |
| `flow-fj2-youtube-video-link` | a watch link with Name blank says "Name is chosen after Test."; Add runs one Test, then one POST named `channel_<id6>_yt` |
| `flow-fp-auto-subreddit` | Auto-add with `r/python` fills the form as Subreddit and sends nothing |
| `flow-fq-new-category` | New category "NEWS" lands in "news"; Add feed waits while a new category is pending; "Hockey" shows as "Hockey (new)" and is sent as typed |
| `flow-fr-headers` | a half-filled header holds Test and Add with its message; switching to Subreddit drops the headers from the POST |
| `flow-fs-auto-already-added` | Auto-add answering with a feed already followed shows "Already added: …" |
| `flow-fg-settings-back` | Menu → Settings opens Feeds; after Done, history grew by at most one entry and Back stays in the app with Settings closed |
| `flow-ft-menu-edit-feed` | a source row's › in the Menu opens that feed in Settings, in view; a `?source=` change while Settings is open moves to another feed |
| `flow-fu-jump-to-column` | Jump to column selects that phone tab and scrolls it into the strip |
| `flow-tab-stays-on-star` | PR1b: on News, saving a story adds the Saved tab in front of it; the phone stays on News, stores `cat:news` (`popping.v1.mobileTab`), and after the save's PATCH a reload opens News |
| `flow-unsave-last-saved` | PR1b, with one saved story (seeded in the store): a new phone opens on For You; unsaving the only saved story takes Saved away and the phone moves to For You, now its stored tab; saving from For You brings Saved back without moving the phone |
| `flow-tab-migrates-index` | PR1b: a stored old index (`mobileCol.last` = 0) with the preferences 1.5 s late (they bring the saved story, seeded in the store, that made index 0 Saved) opens Saved, stores `meta:saved` and drops the index; migrated before them it would be For You |
| `flow-tab-gone-on-load` | PR1b: a stored tab whose category is gone opens For You, not Brief, and stores it |
| `flow-filter-clear-keeps-tab` | PR1b: on News, a source filter leaves `cat:news` stored; clearing it while the unfiltered stories are 1.5 s late stores nothing in between and lands back on News |
| `flow-foryou-fails-keeps-tab` | PR1b: a new phone stores For You; a refresh whose For You request fails (503) takes the tab away but keeps `meta:foryou` stored, and the phone is back on For You when it loads again |
| `flow-foryou-down-settles` | PR1b, For You failing (503) throughout: a new phone shows Saved but stores nothing; a tapped Saved that empties gives way to its neighbour, which is stored, and saving again doesn't move the phone |
| `flow-foryou-down-holds-fresh` | PR1b, For You failing (503) and nothing stored: the phone shows a category without storing it; saving a story there adds Saved in front of it, and the phone stays on that category and still stores nothing |
| `flow-foryou-down-holds-index` | PR1b: the same with only an old index stored (`mobileCol.last` = 1); the index isn't migrated while For You is down |
| `flow-prefs-fail-keeps-saved` | PR1b: `GET /api/preferences` fails (500) with `meta:saved` stored; the phone shows another tab, and `meta:saved` stays stored, also after a poll |
| `flow-tap-tab-scrolls-top` | PR1b: only the phone list carries `data-scroller`; tapping the shown tab scrolls that list to the top (at once under reduced motion) without moving the phone; another tab opens at its own top |
| `flow-sort-best` | PR1c: For You opens on Best, in the server's order; News opens Newest (newest first) with no minimum score slider; Best reorders it by score and stores `column_prefs:news` with `sort: 'best'`; tapping a saved view's chip that captured News as Newest writes no `column_prefs` and keeps Best; Saved's ⋯ has no Newest \| Best |
| `flow-brief-needs-ai` | PR1c, `/api/llm/status` saying `configured: false`: the phone Brief's four Generate / Regenerate states (no brief expanded and collapsed, then one brief expanded and collapsed) each read "Brief needs an AI provider · Set up" (44px); Set up opens Settings › AI; with a provider set up, closing Settings brings Regenerate back; with it gone again, coming back to the front reads the status again, and at 1280 (`setViewportSize`) the header's Brief is the same Set up, which opens Settings › AI, and comes back as Brief after Done |
| `flow-bookmark-on-save` | PR1c: ☆ on a story sends one `bookmark` interaction; ☆ again (unsave) sends none |
| `flow-bookmark-on-save-desktop` | PR1c, 1280: the card menu's Save for later sends one `bookmark`, its Unsave none; keyboard `b` on the selected card (save, then unsave) sends one in all |
| `flow-saved-order` | PR1c: Saved lists saves newest first by published, else fetched time (a page fetched a minute ago with no publish date leads, then the dated saves, then the two with neither date, the higher id first) |
| `flow-reset-keeps-saves` | PR1c: with saves, hides, votes, a saved view and News's read marks, last visit, prefs and section folds stored, Reset reading state deletes the reading-state rows and `history_group_by` but never `starred_entries`, `hidden_entries`, `voted_entries` or `filter_presets`; after the reload the server holds only those four and the Saved tab is back. PR2b: a save and a read mark still queued (the clock paused inside their 1 s batch) when Reset is tapped are dropped: no PATCH or PUT after the DELETEs |
| `flow-prefs-resync` | PR2b, sync rule 5: a hide's PATCH is held; a full GET answered meanwhile (the store without it) leaves the story hidden, and so does a GET sent while it was held but answered with the old set only after the PATCH's answer was taken in; a GET sent after that is taken in as is |
| `flow-visibility-flush` | PR2b: a save inside its 1 s batch (clock paused), then the page hides: one PATCH of it goes at once with `keepalive`, and it is in the store |
| `flow-prefs-retry` | PR2b, sync rule 2: the first save's PATCH answers 503 (`prefMock(context).fail`); a second save waits for the retry, which goes 2 s later with both ids; both are stored and show saved, with no error toast |
| `flow-prefs-405` | PR2b: PATCH answers 405 (a server rolled back to before PR2a) four times: the story keeps showing saved through the retries at 2, 4 and 8 s, then one "Couldn't save" toast; nothing is stored and no timed retry follows; once the server takes PATCH again, hiding the page saves it |
| `flow-menu-closed-inert` | closing the Menu puts focus back on ≡, and Tab never reaches the closed Menu |
| `flow-h1-taps` | the harness: ≡ then Settings counts 2 taps, passes `taps(page, 2, …)` and fails `taps(page, 1, …)` |
| `flow-h1-touch-drag` | the harness: `touchDrag` does nothing off Chromium; on Chromium an upward drag scrolls the phone list and counts 1 |
| `flow-h1-set-hidden` | the harness: `setHidden` sets `visibilityState` and `hidden`; coming back runs the app's quiet poll |
| `flow-h1-keepalive` | the harness: the fetch log shows the load-time `GET /api/preferences` without keepalive, and the views still queued when the page hides (beacon refused) sent with it |
| `flow-h1-pref-store` | the mock: a preference PUT reads back in the list, with `since` and by key; DELETE removes it; PATCH applies `remove` before `add`, `set` with null clears a vote, takes `seen:` keys with a `/`, answers 400 for a key that isn't a set key and 422 for the wrong change or a body the server's schema refuses (an id of 0 or a string, an unknown field, a vote other than up / down / null, a non-canonical vote id); a queued fault answers once; a reload loads the rows with one GET and still sees them |
| `flow-h1-desktop` | the harness at 1280: a mouse desktop with the desktop grid; a card's Copy link and Open in new tab land in the clipboard and `window.open` stubs |
| `flow-reload-on-new-build` | PR1r, the phone, with a new build served (`newBuild`): back after 9 min nothing is checked; back after 11 min it is not checked when the page hid right after opening a story; a key pressed during the check, a 404 for the new entry script, the Menu being open, or text in the search field stops the reload; a check cut off by a hide doesn't keep the next return from checking; a save (PATCH) refused with 400 is not retried or resent and the next return reloads, and so does a pending save that hiding sends and the server refuses with 409 (each on its own build); a pending save that hiding sends and the server can't take (503), sent again on the return and by the flush, keeps the page, and so does the same save failing again on the next return; once the server takes it, the return after that sends it and reloads only once it is saved; the reloaded page checks again but doesn't reload for the same build |
| `flow-reload-desktop-button` | PR1r at 1280: back after 11 min with a new build and no input, the desktop shows "New version · Reload" and doesn't reload by itself; back with its own build served, the button goes; back with a new build again, a scroll and a key during the check don't stop the button; clicking it reloads, and the button is gone after |

Run one with `--only <name>`; PR6 and PR8 add the PATCH and PUT counting flows.

### Helpers (H1)

Every flow made with `flow()` (and so `dashFlow`, `editorFlow`, `aiFlow`)
gets `installHarness(page)` before the page loads: `window.open`,
`navigator.share` and `navigator.clipboard` are stubs that record their
calls, and fetches to `/api/preferences` and `/api/interactions` are recorded
with their `keepalive` flag, which Playwright's Request does not expose, and
`answered`, true once the app has read the response body (or the request
failed). `harnessLog(page)` returns `{ fetches: [{ method, path, keepalive,
answered }], opened, shared, copied }`, and `answered(page, method, path)`
says whether the latest such request has been taken in: flows wait for it
before moving the clock or the page's visibility, so a retry timed from an
answer, or a return to the front, doesn't race the answer. `sendBeacon` is
not stubbed.

| Helper | What it does |
|---|---|
| `tap(page, locator)` | `locator.tap()`, and one more in `page._taps` (0 when `run` starts) |
| `taps(page, max, id)` | fails the flow under rule `id` when more than `max` taps were used; returns false then |
| `touchDrag(page, { from, to, steps = 10, stepMs = 50, holdMs = 150 })` | one finger from `from` to `to` (`{ x, y }`, CSS px) through CDP `Input.dispatchTouchEvent`, after two animation frames and 300 ms; holds `holdMs` before lifting; counts as one tap. Chromium only: elsewhere it returns false and does nothing |
| `setHidden(page, hidden)` | sets `document.visibilityState` and `document.hidden`, then fires `visibilitychange` |
| `installClock(page, time = F.NOW)` | `page.clock.install`; `touchDrag` then waits in Node instead of on animation frames |
| `putPrefs(page, rows)` | seeds the mock's preference store (`prefMock`) with `rows`, then reloads |
| `prefWrites(page)` | every PUT, PATCH and DELETE to `/api/preferences/<key>` from then on, in order, as `{ method, key, value, body }` |
| `prefMock(context)` (capture.cjs) | the mock's preference store: `seed(rows)`, `value(key)`, `keys()`, `fail(status, { method = 'PATCH', key, times = 1 })` (the next requests answer `status` and change nothing), `faultsLeft()` |

Tap-count flows prove "at most N taps". They start from their URL and reach
the target only with `tap`, `touchDrag` (a swipe is one tap) and `fill`
(typing is free): no `evaluate`, `pushState`, `.click()`, `.check()`,
`selectOption` or `startPoll`. They assert outcomes (a request sent or not, a
card hidden, a transform, `defaultPrevented`), never exact scroll offsets.
`tap` needs a touch context, so it is for the phone widths.

Chromium doesn't deliver page touch moves under about 40px, so rules about
small movements are unit-tested in `scripts/unit/`. Moves closer than about
50 ms apart fling to different offsets from run to run, hence the defaults.
Flows about seen-on-scroll and IntersectionObserver drive the scroller's
`scrollTop` or `scrollBy`; touch drags are for gestures.

Time: flows that assert dwell, batch, toast, poll or arrival timing call
`installClock(page)` in `before` and move time with `page.clock.runFor`
(`flow-fn-quiet-poll`). A timer set during load can fire hundreds of
milliseconds late in real time, so real pauses have no margin over a short
delay. `runFor` also fires the regular visible poll, so GET counts allow for
it. Where real time is kept (for example "a fling marks nothing"), pause at
least twice the delay under test.

Time away (PR1r): `away(page, minutes)` hides the page, moves the page's
`Date.now` on with `page.clock.setSystemTime` (no timers fire) and shows it
again. `newBuild(page)` makes the update check's fetches of `/` (fetch-type
requests only, so page loads still get the real build) return `index.html`
with its entry script renamed to `page._nextScript` (`index-next*.js`; null
serves the page's own build), answers that script's HEAD (a 404 when its
name says `gone`), and counts the checks, the HEADs and the reloads.
`page._hold` holds those fetches (each is counted before it waits); one the
page aborted meanwhile is dropped. Under `vite preview` the live and served ids match, so no other
flow sees a reload. A flow that makes the page reload waits for the reloaded
page before it ends: closing the context while the reload is still being
fetched throws in smoke's CSP route.

### The mutation check

Every new flow, and every new behavioural pytest, is shown to catch what it
guards:

1. Name the one product line it guards.
2. Break that line as a scratch edit.
3. `npm run build`, then `smoke.cjs <base> --only <flow>` (or the single
   pytest).
4. Confirm it fails on the expected rule or assertion.
5. Restore with `git checkout -- <file>`, then `git diff --exit-code`.
6. Record "flow → broken line → failing rule" in the unit's notes,
   `docs/ux-notes/<unit>.md`.

Gesture and timing flows also pass 5 runs in a row before they merge.

## capture.cjs, probe.cjs, run.sh

The original audit:

    bash frontend/scripts/iphone-audit/run.sh

builds, serves on 127.0.0.1:4173 and writes next to the scripts:
`<width>-<nn>-<state>.png` screenshots, `<width>-overflow-scan.json`
(flagged elements per state with computed styles and rects), `summary.json`,
`analysis.txt`, `probe-output.json`. These outputs are git-ignored.

`mockApi(context, { onUnmocked })` matches on the request's pathname
(`/api/`, `/auth/`, `/assets/`), keeps its own deep copy of the sources and
entries per call (POST, PATCH and DELETE change that copy; GET reads it), and
calls `onUnmocked({ method, path, url })` for anything it does not answer.
Preferences are a per-call store too, empty at the start: `PUT
/api/preferences/<key>` stores `{ key, value, updated_at }` and `DELETE`
removes it; `PATCH` changes a set key as the server does (400 for any other
key, 422 for `set` on an id list or `add` / `remove` on `voted_entries`
or for a body `schemas.UserPreferencePatchIn` refuses,
`remove` before `add`, `null` clears a vote, trimmed to the cap smallest id
first); `GET /api/preferences` lists the rows (only those updated after
`since` when it is given) and `GET /api/preferences/<key>` returns one or 404.
`updated_at` is `F.NOW` plus one millisecond per write. Any other method on a
preference key is unmocked (C8). A PUT of a set key is stored but reported
through `onSetKeyPut({ key })` (smoke rule C17). `prefMock(context)` gives
flows the store: seed rows before the page loads, read them, and queue
faults (see Helpers). Answering `GET /api/preferences` with a fixed body
from a flow would bring it back on every poll and every return to the
front, which re-read the preferences since PR2b; seed the store instead.

`capture.cjs` and `probe.cjs` open Settings the way a person does since PR5:
the Menu (`open menu`), then its Settings row.

## Matching CI's fonts locally

GitHub's ubuntu runner renders `system-ui` in DejaVu Sans, which is wider
than the Inter this container defaults to (and wider than SF Pro on an
iPhone). A label that fits locally can fail C14 in CI. To measure with
CI's fonts, run the guard with the bundled fontconfig file:

```bash
FONTCONFIG_FILE=$PWD/scripts/iphone-audit/fonts-ci.conf \
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp
```

`fc-match system-ui` with that variable set should print DejaVu Sans.
Run it this way before every push.

## Local loop

What a session runs before pushing. CI stays authoritative, and WebKit
results come only from CI. The database is a throwaway test cluster, not an
app process.

Backend, from the repository root:

    apt-get update && apt-get install -y postgresql-16-pgvector   # Ubuntu noble universe
    pg_ctlcluster 16 main start
    su postgres -c "psql -c \"CREATE ROLE popping_test LOGIN SUPERUSER PASSWORD 'popping_test'\""
    su postgres -c "createdb -O popping_test popping_test"
    PGPASSWORD=popping_test psql -h localhost -U popping_test -d popping_test \
      -c 'CREATE EXTENSION IF NOT EXISTS vector'
    python3.12 -m venv /path/outside/the/repo/venv && . /path/outside/the/repo/venv/bin/activate
    TORCH_VERSION=$(sed -n 's/^ARG TORCH_VERSION=//p' backend/Dockerfile)
    pip install --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}"
    pip install --no-deps -r backend/requirements-dev.lock
    pip install --no-deps -e backend
    cd backend && POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=popping_test \
      POSTGRES_PASSWORD=popping_test POSTGRES_DB=popping_test pytest -ra

- `conftest.py` and `0001_initial.py` need the `vector` extension.
- CI uses Python 3.12; a container's default `python3` may be newer.
- apt.postgresql.org may be blocked; the Ubuntu package is enough.
- In a cloud environment the setup script does the installs once; a session
  only starts the cluster (`pg_ctlcluster 16 main start`).
- Two sessions at once use two databases (for example `popping_test` and
  `popping_test_f`), and a git worktree sets `PYTHONPATH=<worktree>/backend`
  so `app` is imported from the worktree.

Frontend, from `frontend/`:

    npm ci
    git diff --exit-code package.json package-lock.json
    npm run lint && npm run build
    node --experimental-strip-types --test 'scripts/unit/*.test.ts'
    nohup ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort > /tmp/preview.log 2>&1 &
    FONTCONFIG_FILE=$PWD/scripts/iphone-audit/fonts-ci.conf PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
      node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --strict

- Playwright is installed without saving it (`npm install --no-save
  playwright@1.56.1`, as CI does), and the `git diff` above stays clean.
- `vite preview` serves `dist/` from disk, so a rebuild needs no restart.
  Stop it by its PID, not `pkill -f` (the pattern matches the shell running it).
- The strict smoke takes about 3 minutes and reports 0 failures on main.
