# PR1r: Build stamp and reload on a new build (frontend track)

Settings shows which build a page runs, and a page that has been away for
10 minutes or more moves onto a newer build: the phone reloads by itself on
its return, the desktop shows "New version · Reload". Pending writes are
saved first, and a page someone is using never reloads.

## What changed

- `frontend/vite.config.ts`: `define: { __BUILD_TIME__ }` (the build time as
  an ISO string), declared in the new `frontend/src/build.d.ts`. `define`
  inlines a literal, so the CSP is unaffected. `package.json` is untouched.
- `frontend/src/lib/buildId.ts` (new, pure, import-free):
  - `buildIdFromUrls(urls)`: the `/static/` ones, deduplicated, sorted and
    joined; `''` under the dev server.
  - `buildUrlsFromHtml(html)` / `buildIdFromHtml(html)`: the `src` of every
    `<script type="module">` and the `href` of every
    `<link rel~="stylesheet">`, outside HTML comments, any quoting or case.
  - `entryScriptFromHtml(html)`: the module script under `/static/`, or null.
  - `shortId(id)`: 8 hex characters (32-bit FNV-1a).
  - `formatBuildTime(iso)`: "19 Oct, 14:02", local time.
- `frontend/src/lib/useUpdateCheck.ts` (new, React glue):
  - `liveBuildId()` reads `script[type="module"][src]` and
    `link[rel~="stylesheet"][href]` from the live document.
  - `useUpdateCheck(isDesktop)` runs only when `import.meta.env.PROD`. It
    stamps the time on `visibilitychange` → hidden and on `pagehide`, and
    checks on `visibilitychange` → visible, or `pageshow` with `persisted`,
    after `RETURN_CHECK_MS` (10 min) or more by `Date.now`.
  - The check fetches `/` (`cache: 'no-store'`, 10 s timeout covering the
    body) and compares ids by inequality, so a revert counts too.
  - Desktop: sets `ready`; App shows a non-modal "New version · Reload"
    button in the desktop sub-row (not `role="status"`). The click asks for
    the new entry script, flushes, then reloads; if the writes don't all
    save it stays and toasts "Couldn't save your latest changes yet. Try
    Reload again."
  - Phone: reloads unless the page hid within 2 s of opening a story; input
    (`pointerdown`, `touchstart`, `keydown`, `wheel`) came after the return;
    a sheet is open or a text field holds text; the new entry script's HEAD
    isn't a 200 with a JavaScript type; the flush didn't save everything
    within 3 s; or `sessionStorage` already records a reload for that build
    id (or can't be written). Any of these leaves it for the next return.
- `frontend/src/lib/preferences.tsx`:
  - `flushPending(): Promise<boolean>` on the context. It sends what waits
    for the 250 ms debounce and every value the server refused, as ordinary
    PUTs, waits for those and the writes already on the way, and is true
    only when all of them were saved and nothing is left unsaved.
  - `put` returns its promise and records refused values in `unsavedRef`
    (with the retry timer, or given up after the retry). A newer write for
    the key supersedes a retry, an "unsaved" mark and the late failure of
    an older write (`writeSeqRef`). The retry timer still skips when a
    newer value is queued.
  - The tab-close keepalive flush also sends refused values.
  - `clearLastViewed`'s DELETE is tracked and supersedes the key.
- `frontend/src/lib/interactions.ts`: `flushNow()` waits for the batch it
  sends and every batch or immediate POST already on the way. `recordImmediate`
  with type `click` stamps the story-open time (`noteStoryOpened`,
  `lastStoryOpenAt`).
- `frontend/src/components/Card.tsx`: the two paths that open a story
  without a `click` event (the context menu's "Open in new tab", the
  alternatives under a card) call `noteStoryOpened()`.
- `frontend/src/lib/sourceSaves.ts`: `whenAllIdle()`, every feed's `whenIdle`.
- `frontend/src/components/Settings.tsx`: `BuildLine` under Reset's card:
  "Build 3f9a1c2e · 19 Oct, 14:02" ("Build dev" under the dev server). PR12a
  moves it into General.
- `frontend/src/App.tsx`: calls `useUpdateCheck(isDesktop)` and renders the
  desktop button.
- Tests: `frontend/scripts/unit/buildId.test.ts`; flows
  `flow-reload-on-new-build` and `flow-reload-desktop-button` with helpers
  `newBuild(page)` and `away(page, minutes)` in `flows.cjs`.
- Docs: `frontend/scripts/iphone-audit/README.md` (the two flows, `away` and
  `newBuild`, the build line in `settings-reset`), `docs/DEVICE_CHECKS.md`
  (two Pending lines), this file.

## Deviations from the spec

- **Which URLs make the id.** The spec has `buildIdFromHtml` collect "every
  `/static/` src and href" while the hook reads only `script[type=module]`
  and `link[rel=stylesheet]`. Both sides now use the hook's rule (module
  scripts and stylesheets), so the two can't disagree if `index.html` ever
  gains a `/static/` icon or preload link. JS and CSS both count, so a
  CSS-only change still changes the id. Extra pure helpers
  (`buildIdFromUrls`, `buildUrlsFromHtml`, `entryScriptFromHtml`,
  `formatBuildTime`) keep the hook thin and the rules unit-tested.
- **The flush is a real save, not a fire-and-forget.** The spec names the
  preferences pagehide flush (keepalive, errors swallowed) and the
  interactions flush. Here the reload waits for ordinary PUTs and reloads
  only when they were all saved: keepalive bodies share a 64 KB budget
  (`voted_entries` alone can be large), a swallowed failure would drop the
  change, and if input calls the reload off the page lives on with normal
  retry and error handling. Hitting the 3 s cap means no reload (the spec
  doesn't say what the cap leads to; reloading would cut the PUTs off).
  The flush also waits for feed saves (`whenAllIdle`) and in-flight
  engagement POSTs. A value the server refused, including one given up on
  after its retry, is sent again by the next flush and blocks the reload
  until it is saved, so an automatic reload never drops a change the page
  knows is unsaved.
- **More reasons not to reload.** D22 says never while the page is visible;
  the check necessarily runs as the page becomes visible, so "visible" is
  read as "being used": input after the return calls the reload off, and so
  does an open sheet (the Menu, Settings) or a text field with text. The
  phone open guard (2 s after opening a story) applies only to the phone:
  on the desktop, opening a story is the usual way to leave the tab, and the
  desktop never reloads by itself.
- **Desktop.** On the desktop, input during the check doesn't stop the
  button from appearing, and the once-per-build guard also hides the button
  after a click that landed on the same build. The click shows a toast when
  the flush fails.
- **Story-open time.** The spec's guard is "like C1's", which arrives in
  PR3b. Until then the open time is stamped where every story open already
  goes: `recordImmediate({type: 'click'})`, plus the two `window.open` paths
  in Card that record no click. PR3b's `openEntry` can take this over.
- **Tests beyond the spec.** The phone flow has the spec's three checks
  (no reload under 10 min, one reload after 11 min with the flush first,
  no second reload for the same id) plus the open guard, input, a 404 entry
  script, the open Menu, a refused save and a save refused twice. A desktop
  flow covers the button. Mutation checks cover each rule.
- **Two device-check lines.** The build line (the merge condition), and the
  automatic reload after the next deploy, which no flow can test (iOS
  suspending a page).
- `ARCHITECTURE.md` is unchanged: this adds no server process-local state.
- Local loop housekeeping: port 4173 was held by a `vite preview` whose
  worktree had been deleted (it answered 404 to everything); it was stopped
  by PID before this unit's preview started.

## Verification

Local loop on this container (Postgres 16 + pgvector, database
`popping_test_f`, preview on 127.0.0.1:4173, `fonts-ci.conf`, Chromium from
`/opt/pw-browsers`). Built and smoked on main 1d45413; then rebased onto
main 4f019bc (PR4a, #30), which changed no file under `frontend/` or
`.github/`, so the bundle and the smoke results stand. The only conflict
was `docs/DEVICE_CHECKS.md` (both units' Pending lines kept). Pytest ran
again on the rebased tree.

- `npm run lint`: 0 errors (the same 6 warnings as main).
- `npm run build`: ok.
- Unit tests: 72 passed (63 before plus the 9 in `buildId.test.ts`).
- `git diff --exit-code package.json package-lock.json`: clean.
- Backend pytest (pins frontend source): 814 passed, 13 failed on
  1d45413; 895 passed, 13 failed after the rebase onto 4f019bc (PR4a's new
  tests). The 13 are exactly the DNS-only baseline list both times.
- Strict smoke, every state and every flow, 5 runs in a row: 105 runs each
  (103 on main plus the two new flows), 0 failures and 0 warnings in all
  five: 200 s, 201 s, 199 s, 201 s, 205 s. `flow-reload-on-new-build`:
  ok in 14.5, 15.0, 14.4, 14.5 and 14.6 s; `flow-reload-desktop-button`: ok
  in 3.5, 3.3, 3.2, 3.7 and 3.5 s.
- `settings-reset` passes C14 at 390 and 320 with the build line.

### Mutation checks

Each: break one line (on a copy), build, run `--only <flow>` (or the unit
test), restore from the pristine copy and compare byte for byte.

| Rule | Broken line | Failing rule |
|---|---|---|
| no check under 10 min | useUpdateCheck `away < RETURN_CHECK_MS` → `away < 0` | `RELOAD-AWAY`: "back after 9 min: the update check fetched / (2 checks, expected 0)" and "the page reloaded" |
| open guard | `justOpened = false` | `RELOAD-OPEN`: "back 11 min after opening a story: … the page reloaded" |
| input calls it off | `onInput` no longer bumps `epoch` | `RELOAD-INPUT`: "a key during the check still went on" |
| entry script served | drop `entryServed(next.entry)` | `RELOAD-HEAD`: "no HEAD of the new entry script" |
| open sheet | drop the first `pageBusy()` | `RELOAD-BUSY`: "reloading went on with the Menu open" |
| flush first | `const saved = true` instead of `await flushWrites(…)` | `RELOAD-SAVED`: "reloaded although the pending save was refused" |
| reload only when saved | drop `!saved` | `RELOAD-SAVED`: same |
| prefs flush waits and reports | `flushPending` returns `true` at once | `RELOAD-SAVED`: same |
| refused values are resent | drop the `unsavedRef` resend loop in `flushPending` | `RELOAD-FLUSH`: "coming back did not resend the refused save: 1 PUTs" |
| a value given up on stays unsaved | drop `unsavedRef.set(key, { value, retry: null })` | `RELOAD-FLUSH`: "the reload started before the pending save was done: nav" and "2 PUTs of the save, expected 3" |
| once per build | drop `reloadedFor() === next.id` | `RELOAD-ONCE`: "reloaded again for the same build (2 reloads)" |
| desktop shows the button | `if (!desktopRef.current)` | `RELOAD-DESKTOP`: "no Reload button after 11 min away" |
| desktop input doesn't hide it | `if (stale()) return` before the desktop branch | `RELOAD-DESKTOP`: same |
| CSS counts | drop the stylesheet branch in `buildUrlsFromHtml` | unit: 6 of 9 `buildId.test.ts` tests fail, including "a CSS-only change changes the id" |

### Review

`/code-review high`, two rounds.

- Round 1 (10 findings), fixed: input during the check hid the desktop
  button; the open guard applied on the desktop; a PUT waiting for its
  retry was dropped by the reload; the flush's keepalive sends bypassed
  retry and error handling and shared the 64 KB budget; a page with typed
  text or an open sheet could reload; a hung request blocked later checks;
  `flushNow` didn't wait for POSTs already on the way; the desktop ignored
  the once-per-build guard. Not taken: an `openStory(url)` helper for Card's
  six `window.open` sites (an open item for PR3b, which threads
  `onActivate` through them).
- Round 2 (8 findings), fixed: the timeout didn't cover reading the body; a
  value given up on after its retry let the reload through; a stale retry
  or a late failure of an older PUT could overwrite a newer value; two
  failures of one value shared a retry entry; the tab-close flush dropped
  values waiting to retry; `clearLastViewed`'s DELETE wasn't awaited;
  `flush()` had two handlers for one promise. Not taken: checking a desktop
  tab that never hides (the spec's triggers are returns; an open item).

## Open items for later units

- PR3b: the C1 return branch runs this check first. Today the hook installs
  its own visibility listeners; PR3b can call it from C1 instead, and its
  `openEntry`/`lastOpenAt` can replace `noteStoryOpened`/`lastStoryOpenAt`.
- PR2b: `registerBeforeFlush` plus the prefs flush becomes the body of
  `flushPending`; keep its contract (true only when everything was saved,
  and the reload waits otherwise).
- PR12a moves the build line into General.
- A desktop tab that never hides never checks. If that matters, the visible
  poll could run the check on the desktop.
- The `pageshow` with `persisted` path has no flow (headless Chromium's
  back-forward cache); WebKit results come only from CI.
- API writes outside preferences, interactions and feed saves aren't awaited
  by the flush. They all follow a tap, and input after the return calls the
  reload off.
- Card has six `window.open(safeExternalUrl(…), '_blank', …)` sites; one
  `openStory` helper would keep the open stamp in one place (PR3b or PR5a).
