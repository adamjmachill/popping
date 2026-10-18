# Popping redesign plan

Status: complete enough to execute; a verification pass is running and will revise sections 2 to 14. Written 2026-10-18 by a Claude Code session on top of main after PR #12 (mark as unread).
This file is the plan a fresh Claude Code session executes. The design sections (5 to 9, 12) were written from the code readings in the working notes; the deep-dive design panel was cut short to save quota, so the implementation session should re-check each file:line before changing it.

Scope agreed with the owner:

1. A feed editor you reach in fewer steps, that saves on its own (no save link).
2. A category picker fed by the categories you already have, with an easy way to add a new one.
3. Header settings without JSON.
4. One button in the top bar (no gear plus menu plus settings-inside-menu).
5. A sweep of the whole app for iPhone problems (screens not fitting, focus zoom, overflow) and basic ease-of-use gaps (dropdowns, autosave, obvious buttons).
6. YouTube links that will not add.
7. Text that overflows rows and boxes on the phone.
8. Nothing that touches VPS exposure: no new ports, services or daemons.

Also published as a Claude doc: https://claude.ai/artifact/6EWfrW14on6HFUc4ibmk1R

---

## 1. Model and effort

Run it in one Claude Code session on **Claude Fable 5.1 at xhigh effort**, with the message in section 14 pasted in first.

| Setting | Pick | Why |
| --- | --- | --- |
| Model | Claude Fable 5.1 | The three files that change most are large and tangled (App.tsx about 3,000 lines, FeedManager.tsx 1,800, Settings.tsx 1,700). Autosave and the back button have subtle failure modes. You will not be reviewing the code, so the model has to catch its own mistakes. |
| Effort | xhigh | The design is settled here, so the job is careful execution and self-checking. xhigh is the Claude Code default for coding and the level where long tasks benefit. max spends more on reasoning without a better result, because lint, type checks, the build and iPhone screenshots do the verifying. |
| Budget option | Claude Opus 5.5 at xhigh | Fine for the two sweep PRs, which are mechanical once the checklist exists. Keep Fable 5.1 for the editor, picker, headers and top bar. |
| Ultracode | On, for review passes only | This environment runs two agents at a time (4 CPUs), so a workflow is slow for building but fine for an adversarial review before each push. |

## 2. Safety and security

Nothing in this plan opens a port, adds a service, or changes how the VPS is reached. The code is written in a Claude Code cloud container and lands as pull requests on GitHub; the VPS changes only when you run popping-update, which pulls the new images and restarts the same containers.

| What | Today | After this plan |
| --- | --- | --- |
| Published ports | Only the frontend, bound to 127.0.0.1:14789 (docker-compose.yml) | Unchanged |
| Backend and Postgres | No published ports; reachable only inside the Docker network | Unchanged |
| Internet exposure | None unless you set POPPING_FRONTEND_HOST=0.0.0.0 or enable the Cloudflare tunnel yourself | Unchanged |
| Background processes | The same three containers (postgres, backend, frontend), plus cloudflared or guard-proxy only if you enabled those profiles | Unchanged |
| Outbound requests | RSS, article, podcast, YouTube and LLM fetches, all through the SSRF guard in backend/app/url_safety.py and the optional egress proxy | Same paths. The YouTube fix changes how one existing lookup is made; the optional API key adds one call to googleapis.com |
| Browser security headers | nginx sets a strict Content-Security-Policy (self only) | Unchanged; the new UI loads no fonts, scripts or styles from outside |
| Files the PRs may touch | | frontend/src, frontend/scripts, frontend/package.json and its lockfile (Playwright as a dev dependency only), backend/app/youtube.py, backend/app/config.py, backend/app/schemas.py, backend/app/scheduler.py, backend/app/routes/sources.py, backend/tests, README.md, .env.example, and one added step in the frontend job of .github/workflows/build.yml with no new permissions or secrets. Not docker-compose.yml, Dockerfiles, nginx.conf.template, egress-proxy or ops |

Checks before each merge:

- The PR diff touches only the files listed above. Any change outside them is a stop.
- Run the security-review skill on the diff and read its findings before merging.
- CI (backend tests, frontend lint and build, both image builds) is green.

Checks after popping-update on the VPS:

- `docker compose ps` lists only `127.0.0.1:14789->8080` under ports.
- `ss -ltnp` shows no listener that was not there before.
- The app loads and a feed still refreshes.

Rollback if anything looks wrong: set `POPPING_IMAGE_TAG=sha-<previous commit>` in .env and run `docker compose up -d`. The README documents this.

Not changed by this plan: the app has no login unless OIDC or local auth is enabled in .env. Keep the 127.0.0.1 binding and Cloudflare Access in front, as now.

## 3. YouTube links that will not add

Adding a YouTube channel works by turning the link into the channel's RSS feed, which needs the channel's internal id (UC plus 22 characters). Only a link that already contains `/channel/UC...` skips the network. Every other shape (an @handle, a /c/ name, a video link, a youtu.be link) makes the server fetch the YouTube page and search it for one exact marker, `"channelId":"UC..."` (backend/app/youtube.py lines 38 to 40 and 107 to 113).

That fails on a server for two reasons, and the code handles neither:

- The fetch identifies itself as `Popping/0.2`, not a browser (backend/app/config.py line 392). YouTube answers requests from datacenter addresses without browser cookies with a consent page or a "confirm you're not a bot" page. Neither carries the marker, so the result is "couldn't find a channel on this YouTube page", or an HTTP error wrapped as "couldn't resolve the YouTube link".
- Pasting the channel's real RSS link (`youtube.com/feeds/videos.xml?channel_id=UC...`) also fails: it does not match the /channel/ pattern, so the server fetches the feed XML and looks for a JSON marker that XML never has.

Not reproduced live: this environment's proxy blocks youtube.com, and the CI tests are deliberately written to pass with no network. The fix is built so every shape either needs no network at all or degrades to a clear next step.

The fix, in backend/app/youtube.py:

1. Resolve with no network for every shape that already carries the id: `/channel/UC...`, `feeds/videos.xml?channel_id=UC...`, a bare `UC...` id pasted on its own (the YouTube app's About > Share > Copy channel ID gives exactly that), and `/user/NAME` (YouTube's feed accepts `?user=NAME` directly).
2. For @handle, /c/NAME, watch?v= and youtu.be links, fetch the page the way a browser would: a browser User-Agent, `Accept-Language: en`, and the consent cookies (`SOCS=CAI; CONSENT=YES+`) that skip the consent wall. Same SSRF guard and redirect checks as now.
3. Look for every marker YouTube uses, not one: the canonical link tag to `/channel/UC...`, `"externalId"`, `"channelId"`, `"browseId"`, and the og:url meta. First hit wins.
4. Optional `YOUTUBE_API_KEY` in .env. When set, resolve through the YouTube Data API (`channels?forHandle=`, `channels?forUsername=`, `videos?id=`) with no page scraping; one quota unit per lookup against a free daily allowance of 10,000. Documented in .env.example as optional.
5. When nothing works, the error says what to do: "YouTube blocked the lookup from the server. In the YouTube app open the channel, tap About, then Share, then Copy channel ID, and paste that here."

In the Add form (frontend/src/components/FeedManager.tsx lines 1600 to 1670): label the field "YouTube channel link, video link, or channel ID", keep the Test button, and show the resolved feed link it already returns.

Tests to add in backend/tests/test_youtube.py: saved HTML snippets for each marker, a consent-page response that resolves through the API path when a key is set and fails with the new message when not, the bare id, the feed link, and the /user/ shape. All without network, like the existing tests.

After the next popping-update, try adding one channel by @handle on the phone. If it still fails, the message now names the reason, and pasting the channel id works regardless.

## 4. Text that overflows rows and boxes

Measured, not guessed: the built app was rendered in Chromium with iPhone emulation (390x844 at 3x and 320x568 at 2x, touch on, so the `(pointer: coarse)` rule is in force) against a mocked API with long names, long titles and long URLs. Every element was scanned for text or boxes extending past their container. Screenshots and the scan live in the scratchpad folder `shots/` of this session; the re-run recipe is in section 13.

Root cause, in one sentence: rows are flex layouts that mix fixed-width pieces (a 176px search box, a 112px thumbnail, 44px icon buttons, inputs at their natural width) with text that is allowed to shrink, and nothing was ever laid out for a 320px to 390px screen. The 16px rule from PR #11 is not what causes the overflow; it only makes some controls look mismatched (item 11).

Defects, ranked by how often you will hit them:

| # | Where (file:line) | What you see | Cause | Real fix |
| --- | --- | --- | --- | --- |
| 1 | Settings.tsx:265 | Feeds tab has no side margin: the tab pills, the feed rows, the Add form inputs and buttons touch both screen edges. This is the literal "inputs outside boxes". | The feeds tab wrapper is `pt-4`; every other tab is `pt-4 px-4`. | `pt-4 px-4` on that wrapper. |
| 2 | App.tsx:2227 and 2237 | Open search and the title collapses to "P…" at 390; at 320 the icon buttons run 16px past the screen edge. The search field itself is only 104px wide. | Fixed `w-44` search box beside three fixed `w-11` buttons; the title is the only thing allowed to shrink. | Below `sm`, hide the title and the standalone refresh icon while search is open; make the search box `flex-1 min-w-0` so the field takes the width. |
| 3 | Card.tsx about 901 and 1731 | A long headline beside a thumbnail becomes a 10-line ribbon at 390 and 17 lines with mid-word breaks ("Saskatchewa/n") at 320. | Fixed `w-28` thumbnail beside the title on a 250px to 325px card leaves the title 44% to 56% of the width. | Below `sm`, do not put the thumbnail beside the headline: full-width 16:9 above or below the title, or a small square. |
| 4 | Card.tsx about 948 | Time stamp wraps to "12m / ago" with a stray dot, next to a long source name. | Source name and time both shrink; neither has `min-w-0` or `shrink-0`. | `min-w-0 truncate` on the source name, `shrink-0 whitespace-nowrap` on the dot and time. |
| 5 | Card.tsx about 975 to 1015 and 1061 to 1093 | "Discussed on / Reddit", "· 403 / comments", "Summarize / comments", "Listen · 2:26:53" wrap mid-phrase. | Row is `nowrap` so each control shrinks and wraps inside itself. | `flex-wrap gap-x-3 gap-y-1` on the row, `whitespace-nowrap` on each control, so a second control drops to its own line whole. |
| 6 | FeedManager.tsx about 1258 | At 320 the Auto-add button sits 49px outside the sheet ("Aut" visible). Fits at 390 with 8px to spare, so iPhone page zoom breaks it too. | Input is `flex-1` without `min-w-0`, so it cannot shrink below its natural 266px. | `min-w-0 w-full` on the input. |
| 7 | FeedManager.tsx about 745 to 815 | Feed names in Settings clip early ("Risky Business Pod…") because five fixed chips share the line. | Category, status, warning, score and chevron are all `shrink-0` on the name line. | Move status chips to the second line (updated … · every …); keep category and chevron on the name line. |
| 8 | App.tsx:2227 | At 320 the "Popping" title reads "Pop…" even at rest. | 34px title plus four 44px buttons leaves 100px. | Drop the standalone refresh icon on narrow phones (the menu has refresh) or use a smaller title below 360px. |
| 9 | Settings.tsx:209 to 222 | At 320 "Settings → Notifications" wraps to two lines and squeezes Done to 38px. | Done lacks `shrink-0`; the heading lacks `min-w-0 truncate`. | Add both; drop the "Settings → " prefix below `sm`. |
| 10 | FeedManager.tsx about 270 to 285 | "My feeds (14)" wraps inside its pill at 320; labels touch the pill edges at 390. | Pills have no horizontal padding and allow wrapping. | `px-2 whitespace-nowrap truncate` on the pill. |
| 11 | styles.css:24 | 17px fields shrink to 16px; 13px controls (the refresh interval select, the headers textarea) jump to 16px on an 18px line height, so the textarea's third line is clipped. Cosmetic, but it is the duct tape. | The `!important` override from PR #11. | Design every input, select and textarea at 16px with a 24px line height and rows sized for that, then delete the override. The feed editor redesign (section 6) does this for the editor; the sweep does it for the rest. |
| 12 | Card.tsx:1177, FeedManager.tsx about 690 and 700, App.tsx:2710 | 9px and 10px text (tone chip, headers helper lines, new-count badge). | Fixed tiny sizes. | 11px minimum. |
| 13 | App.tsx:2239 | Two clear buttons in the search field (the browser's own and the app's). | `type="search"` draws a native cancel button; the app adds its own. | `type="text" inputMode="search" enterKeyHint="search"`. |

What already works: no page-level horizontal scroll at 390; long unbroken URLs and 90-character tokens wrap cleanly in titles and summaries; the Drawer truncates every row correctly; the AI tab, the API-key rows and the Notifications tab fit at both widths; the feed edit form inputs sit inside their labels.

Two things about Safari versus this test: the container renders text in Inter rather than SF Pro, which is a few percent wider, but every defect above comes from a fixed-width box, not glyph widths, so they reproduce on an iPhone. And iPhone Page Zoom or the Larger Text setting multiplies CSS pixels: at 125% an iPhone 14 lays out at 312 CSS pixels, so the 320 findings apply to a normal-size phone with zoom on.

So this class of bug cannot come back: the sweep PR adds a Playwright smoke test (the capture script from this audit, trimmed) that renders the dashboard, a card, Settings and the Add form at 390 and 320 with a mocked API and fails when any element's text or box extends past its parent. It runs in CI next to lint and build.

## 5. What you will see on the phone

Top bar: the Popping title, a search icon, one Menu button. Nothing else.

Menu (the panel that slides in from the right): Settings as the first row, then Refresh now, New brief, Save this view, the Sources filter list, and Sign out when you are signed in. "Jump to column" goes away on the phone because the column tabs already do that.

Editing a feed, three ways to get there, all ending in the same editor:

1. Menu > Settings > Feeds > tap the feed. Three taps.
2. On any card, open its options (the chevron under the card) > "Edit this feed". Two taps.
3. In the Menu's Sources list, tap the arrow beside a feed. Two taps.

The editor is a sheet that slides up over whatever you were doing. It is a grouped list, like iOS Settings:

- Name
- Address
- Category (shows the current one; tap to pick from your categories or add a new one)
- Refresh every (picker)
- Paused (switch)
- Headers (a short list of name and value rows, hidden for built-in feeds and subreddits)
- Test fetch (shows "Looks good, 23 items" or the reason it failed)
- Delete (asks once, right there)

There is no save button. Each row saves when you leave it or pick a value, shows a small tick for a moment, and shows a red line under the row if the server refused the change, with your text kept so you can fix it. Done, swipe down, or Back closes the sheet.

## 6. Feed editor that saves on its own

New files:

- `frontend/src/components/FeedEditorSheet.tsx`: the sheet. Props: `source`, `sources` (for the category list), `onClose`, `onSaved(updated)`, `onRenamed(old, new)`, `onDeleted(id)`. Rendered by App next to Settings, above it in stacking order (z-50 after Settings), so it opens from Settings, from a card, or from the Menu.
- `frontend/src/components/sheet/Sheet.tsx`: the shared bottom sheet (backdrop, slide-up, safe-area top and bottom, `overscroll-contain`, Esc and swipe-down to close, `visualViewport` sizing so the keyboard never covers a field). Settings and the Drawer move onto it in the sweep PR; the editor uses it from day one.
- `frontend/src/components/sheet/Row.tsx`: a 44px grouped-list row with label, control slot, and a status slot (saving spinner, tick, or error line).
- `frontend/src/lib/useAutosave.ts`: the hook described below.
- `frontend/src/components/CategoryPicker.tsx` and `HeadersEditor.tsx`: sections 7 and 8.

Opening and closing: App keeps `editingSourceId` in state and in the URL as `?edit=<id>` with pushState, the same pattern as `?view=settings` (App.tsx 394 to 444), so Back closes it. Done calls `history.back()` when the sheet was opened in this session, else replaceState. The same fix applies to `closeSettings`.

Autosave, field by field:

- Each row owns a local value seeded from `source`. Text rows commit on blur and on Enter; pickers and switches commit on change. Nothing is sent per keystroke, because every effective PATCH makes the backend rebuild the feed's schedule and fetch immediately (scheduler.py about 2461).
- A commit compares the trimmed value with `source`. Unchanged: nothing happens. Changed: client-side validation first (name `^[a-z0-9_]{1,120}$`; address parses as a URL; category non-empty, at most 40 characters, not a reserved column name; built-in feeds cannot change name, address or headers, so those rows are read-only with a one-line note). A validation failure shows the error under the row and sends nothing.
- The PATCH body holds only that field: `api.updateSource(id, { category: 'deals' })`. One queue per source: a commit that arrives while a PATCH is in flight waits for it, then sends; the last write wins. The hook exposes `status: 'idle' | 'saving' | 'saved' | 'error'` and `error: string` per row; "saved" shows a tick for 1.5 seconds.
- On a 4xx the row keeps the user's text and shows the backend's `detail` in plain words (the API already returns readable messages such as "category 'For You' is reserved for a built-in column"). On a network error: "Couldn't reach the server. Try again." and a Retry link. Errors never go to the dashboard banner behind the sheet.
- After a successful PATCH the hook calls `onSaved(updated)`; App replaces the source in its list without a full refetch, and on a rename calls the existing filter remap (`onRenamed`, FeedManager.tsx about 554).
- Closing mid-save: the sheet closes at once; the in-flight PATCH finishes; a failure shows an error toast with the field name.

Backend changes in the same PR (backend/app/routes/sources.py and schemas.py):

- `SourceOut.builtin: bool` computed from the plugin registry, so the frontend drops its hardcoded KNOWN_BUILT_INS list (FeedManager.tsx:108), which is already wrong (6 names, 7 built-ins).
- Strip the category in the route before persisting (today only validated stripped, stored unstripped).
- Skip the scheduler job rebuild when a PATCH changes only `category`, `name` or `custom_headers`.
- Fix the subreddit Test path: import `fetch_subreddit` from `app.reddit_client` (sources.py:1008).
- Reject blank or non-token header names (sources.py:325).
- Route tests via `app_client` for: each validation error, the built-in lock, the no-rebuild rule, the reddit Test path.

Tests that grep the FeedManager source text (backend/tests/test_frontend_slice15_add_generic_scrape.py, test_source_create_sitemap_link_pattern.py 199 to 280) must be rewritten in this PR to check the new files, or CI goes red.

## 7. Category picker

Tap the Category row and a list slides up: every category you already use (derived from `sources`, in column order, labelled with `categoryLabel` from frontend/src/lib/labels.ts), the current one ticked, then "New category…". Picking one commits and closes the list. "New category…" reveals a text field with `autoCapitalize="none"`; the value is trimmed and lowercased; Enter or Done commits.

Rules, checked before anything is sent: not empty, at most 40 characters (the column is `String(40)`), and not one of the reserved column names the backend refuses (the exact list is `_RESERVED_CATEGORIES` near sources.py:154; the picker reads a copy exported from `frontend/src/lib/labels.ts`, and the backend remains the authority). A reserved or long name shows "That name is used by a built-in column" or "Keep it under 40 characters" under the field.

What happens to columns: App builds the dashboard columns from the categories present in `sources`, so moving the last feed out of a category removes that column and the feed appears under its new one on the next render. The phone remembers the open tab by index today (App.tsx 835 to 841), which makes tabs shift; the sweep PR changes that to remember the column by name, and this PR must not make it worse (after a category change, keep the user on the same column name if it still exists, else the first column).

The Add custom form uses the same picker instead of its `<select>` (FeedManager.tsx 1722 to 1740).

## 8. Headers without code

The Headers section of the editor is a list of rows, each with a Name field and a Value field and a remove button, plus an "Add header" row. Two preset chips sit above the list: "Pretend to be a browser" (adds `User-Agent` with a current Safari string) and "Language" (adds `Accept-Language: en-CA,en`). A one-line note explains why anyone needs this: "Some sites block automated readers. A browser identity usually fixes it."

Saving: each row commits on blur like every other field. The editor sends the whole map in one PATCH: `{ custom_headers: { 'User-Agent': '...' } }`; an empty list sends `null`, which the backend treats as "use defaults" (sources.py 754 to 760). Rows with a blank name are dropped before sending. Names the backend forbids (`Cookie`, `Authorization` and the rest of the deny list near sources.py:164) are refused inline before sending: "Popping can't send that header."

Hidden for built-in feeds (the backend ignores headers there) and for subreddits (the fetch does not use them, dynamic_reddit.py:171).

Test fetch uses the headers currently in the editor, because the test endpoint honours `custom_headers` (sources.py 855 to 870), so the user sees "Looks good" before the next scheduled fetch.

The Add custom form keeps its hidden `default_headers` from recommendations (FeedManager.tsx 1042 to 1050) and shows the same HeadersEditor under an Advanced disclosure.

## 9. One button in the top bar

Remove the gear (App.tsx 2272 to 2301) and its `data-settings-gear` attribute. The Hamburger (App.tsx:2306) stays and is labelled "Menu". The search icon stays. The standalone refresh icon leaves the top bar on phones narrower than 360px and moves into the Menu as "Refresh now" (it is already the second path to refresh).

The Drawer becomes the Menu (Drawer.tsx):

- Row 1: Settings, with a gear glyph, opening Settings on the Feeds tab (`onOpenSettings('feeds')`). The Drawer closes as Settings opens.
- Rows: Refresh now, New brief, Save this view (inline name field, no `window.prompt`), then the Sources filter list, each row with an arrow that opens the feed editor.
- Remove "Jump to column" on the phone (the tab strip does it); on desktop fix the ref so it scrolls (App.tsx:2598 attaches the ref to a `display: contents` element).
- Add Sign out when `user` is set (today only in a desktop-only row).
- Delete the dead `onResetLocalState` prop, the unused sheetUp animation, and the comments describing a bottom sheet.
- Header: title on the left, Done on the right, 44px, matching Settings after the sweep.

Settings keeps its tabs for now; the sweep PR regroups them (Feeds, AI, Lists, Advanced). The URL contract stays: `?view=settings&tab=` with the allow-list exported once as `SETTINGS_TABS` from Settings.tsx and imported by App.

Keyboard shortcut and deep links that open Settings (`openSettings` callers: Drawer rows, the History row, the BriefCard pills) keep working because `openSettings` does not change.

## 10. iPhone sweep checklist

From the code audit, high and medium confidence. Not independently verified: the implementation session confirms each one at the file before fixing it, and strikes any that do not reproduce. The overflow items from section 4 join this list. File:line as of main 721713e.

Real bugs, not polish:

- App.tsx:2022 and 2598: the menu's "Jump to column" does nothing on the phone (it scrolls desktop refs that are not mounted) and nothing on desktop either (the ref is a `display: contents` element). Fix: set the phone column (`setMobileCol`) and attach the ref to a boxed element, or drop the section on the phone since the tab strip covers it.
- Column.tsx:314 to 324: the whole column header is a button that marks every entry read; the only hint is a tooltip. One stray tap clears a column. Fix: an explicit "Mark all read" control; the header stops being a button.
- LoginPage.tsx:72: the username field has no `autoCapitalize="none"`, so iOS types "Adam" for "adam" and local sign-in fails. Same for the feed-name, subreddit, URL and category fields in FeedManager.tsx (1245, 1532, 1655, 605). Fix: `autoCapitalize="none" autoCorrect="off" spellCheck={false}` and `inputMode="url"` where it is a URL.
- App.tsx:433 to 444: Done pushes a new history entry instead of going back, so Back reopens Settings. Fix: `history.back()` when Settings was opened by pushState in this session.
- App.tsx:2594: the phone/desktop switch is `md` (768px); an iPhone in landscape (812 to 932px) gets the desktop multi-column grid. Fix: gate the desktop layout on width and height (or pointer), not width alone.
- App.tsx:2401: `z-15` is not a Tailwind class, so the sticky error banner has no z-index. Fix: `z-10`.
- App.tsx:2826, 306 and Settings.tsx:413: `window.prompt` and `window.confirm` for saving a view, renaming it, and resetting. In a home-screen app these look foreign. Fix: inline name field and the two-tap confirm pattern the feed delete already uses.
- Settings.tsx:1526 and 1598: empty states tell a phone user to right-click or press keys. Fix: touch wording ("Tap the eye on a card").
- Settings.tsx:204: the Settings sheet ignores the keyboard (no visualViewport handling), so a field near the bottom hides under the keyboard. Fix: size the sheet from `window.visualViewport`.

Tap targets under 44px (one shared fix: a 44px minimum on every control, with padding rather than visual size):

- FeedManager.tsx 658 to 671 and 790 to 920: edit-form save/cancel and row actions are 13px text links about 18px tall.
- FeedManager.tsx 1069 to 1127 and 278: "find more feeds" 28px, Recommended "Add" 28px, tab pills 36px.
- App.tsx 282 to 374, 2383, 2246 to 2258, 2677, 2703: preset chip buttons, filter chips, the search clear, the mobile column tabs.
- Settings.tsx 215, 349 to 359, 763 to 768, 1403 to 1454; Drawer.tsx 318: Done buttons are 32px; Restore, Clear all, Retry, Edit and Cancel are text links.
- Card.tsx 976 to 1121: the inline text actions (Discussed on Reddit, Summarize, Listen, Related coverage).

Other phone defects:

- Card.tsx:513: the swipe transition class is left on during the drag, so the card lags the finger. Fix: no transition while dragging, 180ms on release.
- Card.tsx:585: a 500ms long-press silently copies the URL and collides with the native link callout. Fix: drop it, or make long-press open an action sheet.
- Drawer.tsx:262: the closed Drawer stays mounted and focusable off-screen. Fix: `inert` and `aria-hidden` when closed.
- Drawer.tsx:303: the grabber ignores the top safe-area inset. Drawer.tsx:334, Settings.tsx:263 and the column scrollers: no `overscroll-contain`, so scrolling past the end rubber-bands the page.
- App.tsx:2210 and 2655: only the top safe-area inset is handled; landscape needs left and right.
- App.tsx:2188: inline `minHeight: 100dvh` fights the `height: 100%` chain in styles.css. Pick one.
- Toast.tsx:259 to 261: toast text is truncated to one line, so error toasts lose their message. Fix: two or three lines.
- Settings.tsx:779 and other native selects: no chevron on iOS, so a select looks like a text box. Fix: one shared select style with a drawn chevron.
- Settings.tsx:1436: Hidden and Saved rows truncate titles to one line. Fix: two lines.
- Card.tsx:1690: the thumbnail is a div, not a link, so it has no native long-press menu.
- Column.tsx:237: the column options popover closes on `mousedown`, which iOS does not send for taps on empty space.
- App.tsx:2341 to 2364: there is no way to sign out on the phone (the sign-out badge is in a desktop-only row).
- Sub-11px text: see section 4, item 12.

## 11. Ease-of-use sweep checklist

Same caveat as section 10.

Behaviour that misleads:

- App.tsx:1112 and 1245 to 1249: `refresh()` toasts "refreshed" on every run, including the 60-second poll and every return to the app. Fix: toast only on a manual refresh.
- Column.tsx:341 to 350: the "+N new" chip triggers a full refresh and the count never changes. Fix: make it scroll to the new items or clear, not refresh.
- App.tsx:1615 and 748 to 751: hiding a card says "moved to history" but the card is filtered out of every column including history. Fix: one wording ("Hidden. Undo").
- App.tsx:835 to 841: the Saved and For You columns are inserted only when non-empty, but the phone remembers the tab by index, so tabs shift under the user. Fix: remember the column by name.
- Settings.tsx:1403 to 1410 and App.tsx:2860: "Clear all" and "Hide all downvoted" act at once with no confirm and no Undo. Fix: Undo toast or inline confirm.
- FeedManager.tsx:411 and 379: deleting a feed is permanent, with a confirm that cancels itself after 4 seconds. Fix: offer Pause first; keep the confirm until answered.
- lib/preferences.tsx:527 to 627: failed saves of read, star and hide marks are swallowed. Fix: one error toast and a retry.
- Card.tsx:1392: the star tooltip names the wrong shortcut.

Developer language where plain words belong:

- api.ts:284: raw "500 Internal Server Error for /api/entries?..." is shown to the user. Fix: a plain message per status ("The server had a problem. Try again.").
- FeedManager.tsx:1531 to 1540: Add custom asks the user to invent a slug ("lowercase letters, digits, underscore"). Fix: derive the id from the title or host; show a "Display name" field.
- FeedManager.tsx:1110 and Drawer.tsx:415 to 477: Recommended and the Drawer show raw ids and categories while My feeds shows labels. Fix: use `sourceLabel` and `categoryLabel` everywhere.
- FeedManager.tsx:1281: "generic_scrape", "Sitemap URL", "Link pattern" exposed. Fix: "Website (no feed)" with the two fields under Advanced.
- Settings.tsx:757 to 834: the AI tab says "set provider in env", free-text model names, "Scoring model". Fix: a model picker per provider with "Other…", plainer names, save on change.
- Settings.tsx:361 to 371: Notifications tab tells the user to edit .env and restart. Fix: on/off status with the setup note under Advanced.
- Column.tsx:425 to 460: "Top (composite score)", a 0 to 100 min-score slider. Fix: "Best first / Newest / Oldest" and a simple switch.
- Column.tsx:836: empty states mention "Feed Manager" and "the scheduler". Fix: name the real screen and say what will happen.
- Settings.tsx:1165: a history row renders the literal text "◯ with strike" as its icon.
- UserBadge.tsx:37 and App.tsx:2344: "(local bypass)" and a raw health status.
- FeedManager.tsx:740 to 754, 705 to 713, 843 to 848: a feed's last error only lives in tooltips. Fix: show it as a line under the row.

Structure:

- Settings.tsx:229: eight scrolling tabs (Feeds, AI, Notifications, History, Hidden, Saved, Voted, Reset). Fix: group into Feeds, AI, Lists, Advanced; rename Voted to Downvoted.
- Settings.tsx:211 to 222 and Drawer.tsx:314 to 325: Done on the left, title on the right, 32px tall. iOS puts the title left and Done right at 44px.
- App.tsx:2839 and FeedManager error paths: every feed error goes to the dashboard banner behind the Settings sheet, where the user cannot see it. Fix: error toasts above the sheet, or an inline error line under the form.
- Toast.tsx:93 to 120: info toasts vanish after 1.5 seconds. Fix: 3 to 4 seconds, two lines.
- BriefCard.tsx:562: the expanded header row does not wrap on the phone.

## 12. Build order (PR-sized steps)

Each PR: branch from main, run the recipe in section 13, open a draft PR, let CI go green, merge, then popping-update on the VPS when you want it live. Order matters: C before D.

| PR | Scope | Files | Done when |
| --- | --- | --- | --- |
| A | Overflow fixes (section 4, all 13 items) and the Playwright smoke test in CI | Card.tsx, App.tsx, Settings.tsx, FeedManager.tsx, styles.css, frontend/scripts/iphone-audit, .github/workflows/build.yml (one new step in the frontend job only) | The audit scan reports zero flagged elements at 390 and 320; screenshots look right; the CI step fails on a deliberately broken row and passes after |
| B | One top-bar button and the Menu (section 9), Back closes Settings | App.tsx, Drawer.tsx, Hamburger.tsx, Settings.tsx | Top bar shows title, search, Menu; every Menu row works on the phone; Back closes Settings and the Menu; no dead props left |
| C | Backend: `builtin` flag, category strip, no-rebuild rule, reddit Test fix, header-name rule, YouTube fix (section 3), tests | backend/app/routes/sources.py, schemas.py, scheduler.py, youtube.py, config.py, .env.example, backend/tests | pytest green in CI with the new tests; `GET /api/sources` carries `builtin`; a YouTube feed link and a bare channel id both resolve without network in tests |
| D | Feed editor sheet, category picker, headers editor, autosave (sections 5 to 8); migrate the source-text tests | New files in section 6, FeedManager.tsx, App.tsx, api.ts, Card.tsx options menu, Drawer.tsx rows, backend/tests (the two grep tests) | Every flow in section 5 works in the Playwright run with a mocked API, including a 422 and a network failure; no field sends more than one PATCH per commit; built-in rows are read-only where they must be |
| E | Ease-of-use sweep (section 11) and the remaining iPhone items (section 10) not covered above; Settings regrouped; Sheet shared by Settings and Menu | Across frontend/src | Each checklist item is either fixed with a file:line in the PR description or struck with a one-line reason |

Each PR description lists the checklist items it closes. A PR that needs a change outside the files in section 2 stops and asks.

## 13. How to verify

Facts established so far in this environment:

- `cd frontend && npm ci` works. `npm run lint` passes (0 errors, 6 warnings). `npx tsc --noEmit` passes. `npm run build` passes.
- Node 22, npm 10, Python 3.13, Playwright CLI at /opt/node22/bin/playwright, Chromium under /opt/pw-browsers. No Docker, no Postgres, so backend pytest runs only in CI.
- Outbound to youtube.com is blocked by the environment's proxy.
- The workflow tool runs at most two agents at a time here.

Recipe for every PR in this plan, run in the Claude Code container before pushing:

```
cd frontend
npm run lint
npx tsc --noEmit
npm run build
bash scripts/iphone-audit/run.sh    # screenshots + overflow scan at 390 and 320
```

The audit scripts are in `frontend/scripts/iphone-audit/` (added on this branch). Look at the PNGs it writes, not only the scan: the scan catches boxes past their parent, your eyes catch "this looks wrong". Backend changes are checked by CI's pytest job (Postgres is not available in the container). The sweep PR turns the audit into a smoke test that fails the frontend CI job on any overflow.

Browser-level checks that only a real iPhone can do, after popping-update: focus a text field (no zoom), open Settings (sheet fits under the status bar), rotate to landscape (no clipped buttons), and try Page Zoom at 125% (everything still fits).

## 14. How to start the session

Open a new Claude Code session on this repository with Claude Fable 5.1 at xhigh effort, ultracode on, and paste:

```
Implement REDESIGN_PLAN.md from the claude/redesign-plan branch (merge PR #13 first, or read the file from that branch). Work PR by PR in the order of section 12, one draft PR each, branching from main. Before every push run the recipe in section 13 and look at the screenshots. Respect section 2: touch only the files it lists; if a change needs anything else, stop and ask. Re-check every file:line in the plan against the current code before editing, since line numbers drift. Plain, non-technical wording in every string the app shows. When a PR is green, tell me what to look at on the phone after popping-update, in three lines or fewer.
```

If you only have quota for one PR, start with A: it is independent, visible immediately, and installs the test that keeps overflow from coming back.

---

## Working notes (chronological)

- PR #12 (mark as unread) merged at 04:22 UTC; main is 721713e.
- Deep-dive workflow launched: 10 code readers, 3 designs (minimal change, iOS-native UX, structural), 3 judges, 1 synthesis, 7 adversarial verifiers, 1 completeness critic.
- Read directly: App.tsx settings routing (lines 380 to 445: `?view=settings&tab=` drives the overlay via pushState/popstate), top bar (gear at 2272 to 2301, hamburger at 2306), FeedManager inline edit form (436 to 700: text category with a datalist, JSON textarea for headers, tiny "save" link), Drawer "All settings..." row (384 to 387), native `window.prompt` for presets (App.tsx 306 and 2826) and `window.confirm` for reset (Settings.tsx 413).
- iPhone overflow audit done (agent, 92 tool calls): 13 measured defects, section 4. Scripts preserved in frontend/scripts/iphone-audit/.
- Backend facts that shape the editor (reader report): any effective PATCH on an active feed rebuilds its scheduler job and sets the next fetch to now (scheduler.py about 2461), so autosave must send one PATCH per committed change (on blur or picker change), never per keystroke, and the backend should skip the job rebuild when only category or headers changed. `_validate_category` checks the stripped value but the routes persist it unstripped (sources.py 518, 617, 779); strip once in the route. The frontend's hardcoded KNOWN_BUILT_INS list (FeedManager.tsx:108) has 6 names while the backend registers 7 (rfd_hot_deals is missing); add a `builtin` flag to SourceOut instead. The header validator accepts blank keys (sources.py:325); the key/value editor must drop blank rows. The Test endpoint for subreddits imports `fetch_subreddit` from a module that does not define it (sources.py:1008 versus sources/reddit.py:41), so Test on a subreddit fails today; fix in the editor PR. Reddit rows store custom headers but the fetch ignores them (dynamic_reddit.py:171); hide the headers section for reddit and built-in rows.
- Tests that pin the current FeedManager source text: backend/tests/test_frontend_slice15_add_generic_scrape.py (68 to 341) and test_source_create_sitemap_link_pattern.py (199 to 280) grep FeedManager.tsx and api.ts for literal strings. A rewrite must update those tests in the same PR or CI goes red.
- Settings tab allow-list is duplicated in App.tsx 409 to 418, Settings.tsx 40 to 48 and 233; export one SETTINGS_TABS array.
- Dead code to remove with the top-bar change: Drawer `onResetLocalState` prop (Drawer.tsx 61 to 92, App.tsx 2810), the `data-settings-gear` attribute (App.tsx:2309), the unused sheetUp animation, and Drawer header comments that describe a bottom sheet that no longer exists.
- Fixed a contradiction: section 2 forbade .github and omitted schemas.py, scheduler.py and config.py, while PRs A and C need them. The allowed list now matches section 12.
- Deep-dive workflow stopped at 98% quota after 9 of 10 readers; the design panel, judges and verifiers did not run. Sections 5 to 9 and 12 are my synthesis from the readings.
- Deployment surface read: docker-compose.yml, nginx.conf.template, egress-proxy, ops/popping-update.sh. See section 2.
- Reader reports done so far: feed editor, Settings overlay. Constraints they pinned down (each must hold in the redesign):
  - Settings tab identity is URL state (`?view=settings&tab=`), parsed by an allow-list in App.tsx 394 to 428 and set by pushState in 430 to 444. Settings.tsx 238 to 246 switches tabs with replaceState plus a synthetic popstate that App listens to. Any new tab or rename must be added in both places, and the Drawer deep-links by tab id (Drawer.tsx 345 and 384).
  - Stacking order to keep: Settings z-50, Drawer z-30/z-40, ShortcutsSheet z-40, Toast z-50 rendered after Settings.
  - The mobile Settings sheet is pinned by its top edge with env(safe-area-inset-top), never a vh height (PR #11), and keeps env(safe-area-inset-bottom) at the bottom.
  - On touch screens every input, textarea and select is forced to 16px by styles.css 24 to 26 (`!important`). New controls must be designed at 16px or more so that rule can go.
  - FeedManager's PATCH surface is `api.updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? })` (api.ts 424 to 434); custom_headers is a flat string-to-string map and null clears it.
  - Desktop breakpoint is md (768px); iPads get the 480px right-hand panel.
- Session switched to Claude Opus 5.5 at the owner's request (quota at 81%). Deep-dive workflow resumed from cache with the owner's three later requirements (VPS safety, YouTube, overflow) and two extra verifiers (YouTube, VPS security). It reads this file and will produce corrections to sections 2 to 14.
