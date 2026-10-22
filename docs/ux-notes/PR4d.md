# PR4d: Window UI (frontend track)

On main 352c6f5, which has PR3b (#45), PR3c (#46) and PR4c (#47).
PR4b (#31, merged) gives `/api/entries` and `/api/foryou` their window
parameters and the by-ids projection; PR4c's Saved-by-id cache keeps old
saves in Saved whatever the window; PR7a (#42, merged) builds the tab
list from `category_layout`. PR5a (the Reddit card) is being verified in
parallel and rewrites Card.tsx, so the Card change here is one branch of
the time label and nothing else, and the App.tsx changes stay local to
the window, `extraByTab`, the calls, the counts, the categories and the
keep set.

A first pass of this unit stopped partway (its work was committed as a
WIP commit and folded into this one). This pass reviewed it against the
spec, kept it, added `flow-tab-window-in-order` (the one rule no flow
proved: a wider tab's rows go in at their place, not at the end), made
`flow-quiet-tab-kept`'s last step wait on the strip rather than on a
card, fixed a capture.cjs comment, and ran the whole local loop.

## What changed

Every tab shows what arrived in the last 2 days (D5), at most the 25
best-scoring stories per feed in them (D28), from the feeds that aren't
paused. ⋯ → Show stories from offers 1 day, 2 days, 7 days or All, per
tab. A quiet category keeps its tab and says "Nothing in 2 days · Show 7
days". Saved lists every save. On this day reads "On this day".

- `frontend/src/lib/window.ts` (new, pure, no imports): `Window` (`'1d'
  | '2d' | '7d' | 'all'`), `DEFAULT_WINDOW` (`'2d'`), `WINDOWS` (the
  control's rows), `windowHours` (24, 48, 168, 8760), `isWider` (7 days
  and All fetch their own rows), `windowOf(row)` (an explicit `window`
  wins; the legacy `maxAgeHours` of 1, 4 or 24 reads as 1 day only
  without one; null, missing or anything else is 2 days: null meant All
  to the old control, but every stored row has it, so reading it as
  anything but the default would change every tab), `inWindow(fetched_at,
  w, now)` (a story with no arrival time, or one that doesn't parse, is
  kept, as the old age filter kept it) and `widerWindow` (the empty
  state's offer: 7 days from 1 or 2 days, All from 7, nothing from All).
- `frontend/src/lib/sorting.ts`: `TabPrefs` is `{sort, minScore,
  window}`. `prefsFor` reads the window with `windowOf` and returns the
  stored row as it is only when it already has that shape with no
  `maxAgeHours`; otherwise one merged object per row (the WeakMap cache,
  as before), so Column's memo holds. A write is a spread of what
  `prefsFor` gave, so every write sets `window` and drops `maxAgeHours`.
  `NEWEST_PREFS` and `BEST_PREFS` carry `window: '2d'`.
  `lib/preferences.tsx`'s `ColumnPrefsValue` has `window?` and
  `maxAgeHours?` (rows older builds wrote keep the latter until their
  next write).
- `frontend/src/api.ts`: `entries` takes `maxAgeHours`, `perSourceCap`
  and `activeOnly`; `forYou` takes `maxAgeHours`.
- `frontend/src/App.tsx`:
  - **Calls.** `refresh` asks `entries({perCategoryLimit: 100,
    maxAgeHours: 48, perSourceCap: 25, activeOnly: true})` (the filter
    path: `{source, limit: 200, …}` with the same three) and
    `forYou({limit: 50, maxAgeHours: 48})`.
  - **Window.** `columns` cuts each tab's stories to its window
    (`inWindow`; Saved never) and names it in the tab's `order`
    (`newest|7d`), so a new window starts a new snapshot (PR3b) by
    itself. Each column also carries its `sort` and `window`.
  - **Wider tabs** (`extraByTab`, state: tab key → rows). A tab at 7 days
    or All fetches its own rows while it is on screen (the phone's tab;
    on the desktop every grid column, one at a time): when it comes on
    screen or widens (`widerScope`, the shown wider tabs' keys and
    windows) and after every applied refresh (`refreshTick`). A category
    asks `entries({category, limit: 200, maxAgeHours: h, perSourceCap:
    25, activeOnly: true})`, For You `forYou({limit: 50, maxAgeHours:
    h})`, the filter column (until PR8b) `entries({source, limit: 200,
    …})`. An answer older than the tab's latest request is dropped
    (`widerSeqRef`); a failed one leaves the rows as they were and shows
    the banner (`setError`), which the next poll that works clears. The
    rows stay across tab switches, so a tab opened again draws at once.
    A tab's first answer since it came on screen at that window starts
    its snapshot over (`resetSnapshot`), so the older rows go in at their
    place and what was read goes under the marker, unless the list was
    touched meanwhile (its scroller is off the top, or a story was
    opened since: `lastStoryOpenAt`) or the answer changed nothing; later
    answers, and a touched list, sort the rows in (`inOrder`, below).
  - **Drawing.** `widened` (memo) builds each wider tab's stories: its
    own rows first (For You's Best is the server's order; a story the
    2-day load also holds is drawn from that copy), then the 2-day
    stories they don't hold (the newest arrivals), in the tab's sort,
    hidden stories and rows outside the window out. `asFeedTab` hands
    those to the partition in place of the tab's 2-day stories, and
    `inOrder` names the rows only the fetch brought.
  - **Counts.** `countFor` is unchanged: a drawn tab's badge, marker and
    Earlier come from its partition (the window's stories, wider rows
    included); a tab not on screen counts its 2-day data.
  - **Keep set.** `keepIdsFor` takes `extra`, every wider tab's rows.
  - **Categories.** `categories` is the union of the active feeds'
    categories and `byCategory`'s keys; `availableTabs` has a tab for
    each, with `NO_ENTRIES` where no story is held. So a quiet category
    keeps its tab (and the one control that widens it); a category whose
    feeds are all paused leaves (its stories stop coming, `activeOnly`).
    PR7a's `orderColumns` orders them as before (by label until the
    owner edits the order).
  - **The desktop For You row** shows `visibleForYou.slice(0, 6)`
    (`FORYOU_ROW_TOP`); its "N entries" count line is gone.
- `frontend/src/lib/feedOrder.ts`: `partitionTab` takes `inOrder(e)`: a
  story new to the snapshot that goes in at its place in `entries` (the
  tab's order), not at the end of its group: after every story before it
  there, before the first story after it, or before the arrivals
  appended out of order (the first break in the group's order); a story
  the input no longer holds is stepped over. It still waits with the
  arrivals while `hold` is on. `Held` gains `extra`.
  `lib/useFeedOrder.ts` passes `inOrder` through.
- `frontend/src/components/Column.tsx`: the ⋯ popover's "Hide if older
  than" select is replaced by "Show stories from", a 4-way group of 44px
  buttons (`button[data-window]`, `aria-pressed`), not on Saved. An empty
  category tab (`cat:` keys) at 1, 2 or 7 days reads "Nothing in 1 day ·
  Show 7 days", "Nothing in 2 days · Show 7 days" or "Nothing in 7 days ·
  Show all" (`EMPTY_WINDOW_LINES`, `[data-window-empty]`); the offer
  (`button[data-show-wider]`) writes the next window through the same
  setter as the control. A feed's own trouble (auto-disabled, last
  error, never fetched) still says so first; the line comes before "no
  entries match the current filters", since the window is the filter.
  At All the slice-19 messages stand.
- `frontend/src/lib/labels.ts`: `categoryLabel('on_this_day')` is "On
  this day" (`KNOWN_CATEGORIES`).
- `frontend/src/lib/feedRules.ts`: `HISTORICAL_SOURCES`
  (`['wikipedia_on_this_day']`) and `isHistorical(name)`, pinned against
  `brief._HISTORICAL_SOURCE_SLUGS` in
  `test_frontend_feed_editor_rules.py`.
- `frontend/src/components/Card.tsx`: a historical feed's card shows "On
  this day" in place of the time. One branch around the `<time>` element
  and one import; nothing else, for PR5a's rewrite.
- `frontend/scripts/iphone-audit/capture.cjs`: `/api/entries` honours
  `max_age_hours` (against `F.NOW`), `per_source_cap` (each feed's best
  by score, `fetched_at`, id; 422 without the window, as on the server)
  and `active_only`; `/api/foryou` honours `max_age_hours` and never
  returns a paused feed's story (PR4b's unconditional filter).
- `frontend/scripts/iphone-audit/fixtures.cjs`: nhl gains 604 (3 days
  old, score 45) and 605 (10 days, score 50): under Best they fall among
  the 2-day ones (601, 605, 602, 604, 603), so a row appended at the end
  instead of at its place shows; 304 (the paused krebs_on_security) is in
  `FOR_YOU_IDS`, so the mock (which serves `FOR_YOU_RANKED`) has to drop
  it; `FOR_YOU`, what the flows expect For You to show, leaves it out.
- `frontend/scripts/iphone-audit/flows.cjs`: `flow-window-default`,
  `flow-tab-window-7d`, `flow-tab-window-in-order`, `flow-badge-in-window`, `flow-paused-hidden`,
  `flow-paused-hidden-desktop`, `flow-quiet-tab-kept`; the `oldDevice`
  helper; `DEFAULT_ORDER` gains `cat:<CATEGORY_40>` (source 15's category
  has a tab now).
- `frontend/scripts/iphone-audit/smoke.cjs`: `column-popover` checks the
  window control at 390 and 320.
- `frontend/scripts/iphone-audit/README.md`: the state, the flows, the
  helper and the mock's window rules.
- `backend/tests/test_frontend_feed_editor_rules.py` pins
  `HISTORICAL_SOURCES`;
  `test_frontend_slice19_empty_column_source_status.py` pins the
  "Nothing in 2 days · Show 7 days" line and its offer.
- `docs/DEVICE_CHECKS.md`: nine lines under Pending (`#<pr>`).

## Deviations from the spec

- **The stored shape.** The spec says new writes set `window` and drop
  `maxAgeHours`. `TabPrefs` (what Column reads and writes) therefore has
  `window` and no `maxAgeHours`; `windowOf` reads the legacy field from
  the stored row. `ColumnPrefsValue` keeps both as optional so rows older
  builds wrote still type as what they are.
- **"Touched since the switch"** is read as: the tab's scroller is off
  its top, or a story was opened since the tab came on screen at that
  window. An answer that changes nothing (the same ids as held) never
  starts the snapshot over either, so a tab opened again with its rows
  already held isn't bumped by the refetch.
- **`partitionTab` changed** (PR3b's lib) for "sorted into unseen or
  Earlier by the tab's sort, never appended out of order": the `inOrder`
  predicate above. The arrivals' rule is untouched (they still append,
  and still wait on `hold`).
- **Desktop For You.** The row shows the top 6 and loses its count line
  ("50 entries" over 6 cards would read wrong). It draws the 2-day For
  You only: For You's window (set from the phone's ⋯) widens the phone's
  For You tab, not the desktop row, which has no ⋯ of its own. The grid's
  columns widen one at a time, as the spec says.
- **The filter column** (`meta:filter`, until PR8b) also widens, with
  `entries({source, …})`: it has the same ⋯, so a window picked there
  does something.
- **The empty line at 1 and 7 days.** The spec names the 2-day line; the
  same line reads "Nothing in 1 day · Show 7 days" at 1 day and "Nothing
  in 7 days · Show all" at 7 days, and nothing at All (the end is the
  end). The 2-day text is pinned verbatim.
- **D33's baseline and wider windows.** On a device whose first load of
  the read model was after a story arrived minus 48 h, that story counts
  as seen (PR3b, D33), so widening to 7 days on such a device puts the
  older stories under "Earlier", not above the marker. That is D33 by
  design; the flows seed `popping.v1.firstRunAt` a month back
  (`oldDevice`) so the 3- and 10-day fixture stories are unseen, as
  stories that arrived since the deploy are on a phone.
- **A failed wider fetch** shows the banner (`setError`), as a failed
  poll does; the spec doesn't say.
- **`windowOf`'s legacy map** is exact: only 1, 4 and 24 (what the old
  control could write) read as 1 day; any other number reads as 2 days.
- **The mock's For You** drops paused feeds' stories unconditionally, as
  PR4b's server does (`flow-paused-hidden` needs 304 in the mock's For
  You list to prove it).
- **FU** (`flow-fu-jump-to-column`): with CATEGORY_40's tab the last
  Jump row is still Video (by label, "Regional Politics and Municipal
  Councils" sorts before Security). The flow is unchanged and passes;
  PR7a's note that FU would see CATEGORY_40 last doesn't hold (the
  category isn't last by label).
- **No flow draws an On this day card:** the fixtures have no
  historical feed, and adding one would add a tab to every state. The
  list is pinned by pytest and the Card branch is one line; the device
  check covers it.

## Tests

- **Unit:** `window.test.ts` (new): an explicit window (with and without
  `maxAgeHours` next to it); legacy 1, 4 and 24; null, missing and
  anything else; a row through `filter_presets`; `prefsFor` writes set
  `window` and drop `maxAgeHours`; `windowHours`, `isWider`,
  `widerWindow`; `inWindow` at each edge. `sorting.test.ts` follows the
  new shape. `feedOrder.test.ts`: `inOrder` places a wider tab's rows at
  their place (unseen and Earlier) with arrivals still at the end, and
  waits with them on `hold`; `keepIdsFor` takes `extra`.
- **pytest:** `test_historical_sources_match_brief`;
  `test_empty_state_offers_a_wider_window`.
- **`flow-tab-window-7d` and the snapshot reset.** On Newest a wider
  row is always older than the 2-day ones, so it is last whether it is
  placed or appended, and the new window's `order` already starts a new
  snapshot before the answer lands. `flow-tab-window-7d` keeps the
  spec's steps (order after away and back, and on a cold load);
  `flow-tab-window-in-order` adds the Best case that tells the three
  apart: the untouched first answer (reset), and an answer that lands
  after a story was opened (no reset, the row placed in order, the read
  story left where it is).
- **Flows** (`frontend/scripts/iphone-audit/README.md` has each in
  full): `flow-window-default`, `flow-tab-window-7d`,
  `flow-tab-window-in-order`, `flow-badge-in-window`, `flow-paused-hidden`,
  `flow-paused-hidden-desktop` (1280), `flow-quiet-tab-kept`.
  `flow-saved-by-id` stays green with the window on.
- **Smoke:** `column-popover` at 390 and 320 checks the window control.

## Verification

Local loop on this container (database `popping_test_f2`, preview on
127.0.0.1:4174):

- `npm run lint`: 0 errors (the 4 react-refresh warnings main has).
- `npm run build`: ok. `git diff --exit-code package.json
  package-lock.json`: clean.
- Unit tests (`node --experimental-strip-types --test
  'scripts/unit/*.test.ts'`): 247 pass, 0 fail.
- Backend pytest (full, `popping_test_f2`): 1753 passed, 13 failed; the
  13 are exactly the DNS-only baseline (`/root/popping-env/baseline.txt`).
- Strict smoke (`smoke.cjs --csp --strict`, every state and flow): one
  failure, `flow-reload-on-new-build` (RELOAD-REFUSED), a PR1r flow this
  unit doesn't touch, while the other lane loaded the machine; alone it
  passed 3 runs out of 3. Everything else ok.
- The seven PR4d flows (`flow-window-default`, `flow-tab-window-7d`,
  `flow-tab-window-in-order`, `flow-badge-in-window`,
  `flow-paused-hidden`, `flow-paused-hidden-desktop`,
  `flow-quiet-tab-kept`): 5 runs in a row, 0 failures. `column-popover`
  at 390 and 320, `flow-saved-by-id` and FU (`flow-fu-jump-to-column`)
  ok.

Mutation checks (each guarded line broken, `npm run build`, the one
flow or test run, then restored and rebuilt):

| Broken | Run | Failed with |
|---|---|---|
| `refresh` without `maxAgeHours`/`perSourceCap` | `flow-window-default` | WINDOW: the first load asked `…per_category_limit=100&active_only=true` |
| `widerTabs` never wider | `flow-tab-window-7d` | WINDOW-7D: 7 days sent 0 requests for Nhl |
| App's `inOrder` always false | `flow-tab-window-in-order` | WINDOW-ORDER: 601,602,604,603,605 (605 appended) |
| first answer resets even when touched | `flow-tab-window-in-order` | WINDOW-ORDER: 605,602,604,603 (the read 601 folded under Earlier) |
| `columns` without the window cut | `flow-badge-in-window` | BADGE-WINDOW: at 1 day Video shows 501,502,503,504 |
| `refresh` without `activeOnly` | `flow-paused-hidden` | PAUSED: Security shows 304, 305 |
| the desktop row without `slice(0, 6)` | `flow-paused-hidden-desktop` | PAUSED-DESK: 8 stories, expected its top 6 |
| `categories` without `s.active` | `flow-quiet-tab-kept` | QUIET: with its only feed paused, Nhl is still a tab |
| `categories` without the sources | `flow-quiet-tab-kept` | QUIET: no Nhl tab |
| window buttons never `aria-pressed` | `column-popover` | POPOVER: 2 days is not shown as chosen (390 and 320) |
| `HISTORICAL_SOURCES` renamed | `test_historical_sources_match_brief` | failed |
| the 2-day empty line reworded | `test_empty_state_offers_a_wider_window` | failed |
| `windowOf`: legacy `null` read as 1 day | `window.test.ts` | 2 fail |
| `windowOf`: legacy hours before `window` | `window.test.ts` | 3 fail |
| `partitionTab` ignores `inOrder` | `feedOrder.test.ts` | 2 fail (the PR4d cases) |
| `keepIdsFor` without `extra` | `feedOrder.test.ts` | 1 fail |

WebKit results come only from CI.

## Open items for later units

- **PR5a** rewrites Card.tsx: keep the `isHistorical(sourceName)` branch
  ("On this day" in place of the time).
- **PR5b** (muted feeds): leave muted feeds out of `categories` (the
  active-sources union) and of `extraByTab`'s drawn rows (`widened`
  filters hidden ids; `isRemoved` covers the snapshot). `extraByTab` is
  `ReadonlyMap<ColKey, Entry[]>`, one array per tab, as fetched.
- **PR6b** (`checkTabNow`): a wider tab refetches after every applied
  refresh (`refreshTick`); a check-now that calls `refresh` gets that for
  free.
- **PR7b** rewrites the empty states: keep `EMPTY_WINDOW_LINES` and the
  `window` / `onShowWider` props of `EmptyColumnMessage`.
- **PR8a** (custom tabs): a custom tab widens the way the filter column
  does here (`entries({source, limit: 200, maxAgeHours, perSourceCap,
  activeOnly})`).
- **PR8b** removes the filter column and with it the `FILTER_KEY` branch
  of `fetchWider`.
