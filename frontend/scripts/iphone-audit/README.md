# iPhone layout scripts

Everything here renders the built app in a browser with iPhone emulation
(390x844 at 3x and 320x568 at 2x, touch on; a few states also at 312x675, a
390 phone with Page Zoom at 125%) against a fully mocked API
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
         [--browser chromium|webkit] [--out <dir>] [--only <state>[,<state>...]]

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
  screenshots are taken (CI cannot retrieve them anyway).
- `--only`: run only the named states (comma-separated).

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
and `clock.setFixedTime(F.NOW)`, so relative times ("12m ago") are stable. Then:

1. `mockApi(context, { onUnmocked })`, the runtime listeners (C8) and, with
   `--csp`, the CSP route (C9); then the state's `before` hook (extra routes);
2. open `url`, wait for a phone card (`main.md\:hidden article[data-card-id]`)
   or the state's `wait` selector, let requests settle and the load-time
   "refreshed" toast go away;
3. run the state's `setup`, let requests settle, wait 400 ms;
4. run the layout rules, take the screenshot, then run the rules that
   temporarily change the page (C2b, C6), which put everything back.

### States (PR2)

| State | What it shows |
|---|---|
| `dashboard` | the phone dashboard at 390, 320 and 312 (also runs C2b and C16); the top bar must hold exactly search, refresh and the Menu button, and no settings gear |
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
| `settings-notifications`, `settings-history`, `settings-hidden`, `settings-starred` (Saved), `settings-voted` (Downvoted), `settings-reset` | one per tab via `?view=settings&tab=` |
| `brief-empty` | 320 only: the phone Brief tab with `/api/brief/latest` returning `[]` |

Selectors avoid visible labels that the redesign changes: feed-manager tabs are
picked by position, headers by `aria-label` (`close settings`, `close menu`).

To add a state, append to `STATES` in `smoke.cjs`:

    { name, url, widths, wait, before({ page, context }), setup({ page, settle }),
      extra: ['C16'], checks: false, run({ page, fail }) }

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

    node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp
    node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --browser webkit   # report only

The WebKit step is `continue-on-error`: WebKit on Linux is not iOS Safari.
PR9 adds `--strict` to the Chromium command.

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
| `flow-menu-closed-inert` | closing the Menu puts focus back on ≡, and Tab never reaches the closed Menu |

Run one with `--only <name>`; PR6 and PR8 add the PATCH and PUT counting flows.

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
