# PR3b: Read model: open marks seen, marker, Earlier, badges (frontend track)

Started stacked on PR3a (`claude/ux-pr3a`, itself on PR7a #42 and main's
PR2b #40), built as if those were merged. Rebased onto main `e1f0390`
once PR3a merged (#43): it branches from main, with no unmerged parent.

## Plan (written before the code)

The unit is "plan first". The plan below was written before any code, from
an inventory of every call site the spec's delete and rewire lists name.
The spec's line numbers are from main 4be8766, before PR1r, PR1b, PR1c,
PR2b, PR7a and PR3a, so everything was found again by name.

### Inventory (stack-pr3b at 7015ffd)

`frontend/src/App.tsx`

| Spec item | Where it is now | What happens |
|---|---|---|
| `HIDDEN_RESET_MS` (2 min) | :95 | becomes `RETURN_RESET_MS` (10 min), C1 |
| `readEntriesKey` | :179 | goes (new code never writes `read_entries:*`) |
| `MAX_SEEN_ENTRY_IDS`, `capSetFIFO` | :181-197 | go |
| `SectionCollapse`, `ColumnSections` types | :200-206 | go |
| `setLastViewed`, `clearLastViewed` aliases | :762-766 | go |
| `setColumnSections` alias, `columnSections` | :749, :771-774 | go |
| `lastViewedRef`, `columnSectionsRef` and their effects | :790-803 | go |
| `seenEntryIdsRef` | :850 | goes; its uses at :1145, :1257-1273, :1864-1868, :2326-2330 go |
| `hiddenAtRef` | :852, :1260-1273, :1501 | its `seenEntryIdsRef` use goes; C1's time away moves to the update check's stamp (see C1) |
| `columns` memo's `totalCount` | :1072-1094 | goes ("X of Y" goes) |
| `globalReadIds` | :1120-1126 | becomes `seenIds`: every `seen:*` row and every legacy `read_entries:*` row |
| `newCountByColumn` | :1143-1160 | goes (badges come from the partition) |
| `unreadIdsByColumn` | :1172-1182 | goes |
| `sectionsByColumn` | :1193-1206 | goes, replaced by `useFeedOrder` |
| `refresh()`'s seen-set and toast | :1257-1273, :1301-1304 | the seen-set goes; the manual toast reads "N new" / "Nothing new" from the ids held before the request, and a manual refresh resets the snapshots |
| `resetLocalState` keys | :1376-1411 | also deletes `seen:*` rows, and drops their queued writes |
| visibility handler | :1499-1510 | keeps the poll; C1 runs from the update check's return (below) |
| `unmarkColumnRead` | :1851-1871 | becomes Mark all's Undo: `removeIds` of exactly the added ids per `seen:<category>` key, then a reset |
| `unmarkEntryRead`, `markEntryRead`, `toggleEntryRead` | :1878-1933 | go |
| `toggleHideEntry`'s mark-read and its Undo's unmark | :1964-2000 | go: a hide no longer marks the story read (after PR3b a story is used up only by opening it or by Mark all) |
| keyboard `m` | :2183-2193, deps :2270 | goes |
| ArrowUp / ArrowDown | :2167-2177 | walk the partition: unseen, then Earlier |
| `markColumnRead` | :2295-2349 | becomes Mark all (keeps its name: slice 21 pins it) |
| `setColumnSection`, `sectionsCollapsedCache`, `sectionsCollapsedFor` | :2552-2602 | go |
| SearchResults `readIds` / `onMarkRead` | :2979, :2982 | become `onOpenEntry` |
| desktop For You row `unread` / `onMarkRead` | :3080-3091 | go; the row's cards get `onActivate` |
| desktop Column wiring | :3139-3189 | `sections` from the partition; `newCount`, `onRefresh`, `onMarkRead`, `onMarkEntryRead`, `totalCount`, `sectionsCollapsed`, `onToggleSection` go; `unseenCount`, `nextTab`, `generation`, `onMarkAll`, `onOpenEntry`, `onOpenTab`, `onHoldChange` come |
| phone tab badge | :3238-3272 | the unseen count, `99+`, `aria-label="<tab>, N new"`, none on Saved |
| phone Column wiring | :3319-3371 | as the desktop wiring |

`frontend/src/components/Column.tsx`: props `newCount` (:73), `onMarkRead`
(:82), `onRefresh` (:89), `onMarkEntryRead` (:97), `totalCount` (:106),
`sectionsCollapsed` / `onToggleSection` (:159-162); the header's
`role="button"`, `tabIndex`, handlers and `title` (:336-378, :414-421); the
chip (:434-467); "X of Y" (:468-473); the Fresh / History sections
(:600-712) and `ColumnSection` (:731-861); the comparator lines (:1008,
:1019, :1026). The ⋯ already shows on For You (PR1c).

`frontend/src/components/Card.tsx`: `mountTime` (:382-390); `readRevealRef`
(:314, :529-531, :866-875); `commitMarkRead` (:543-555) and its commit
branch (:684); the right-swipe clamp (:654); the context menu's "Mark as
read" (:727-735); the unread ring (:840-844); the action bar's `onMarkRead`
term (:1280); ✓ (:1379-1414); `CheckIcon` (:1522-1550); the `onMarkRead`
prop (:51-61). `unread` becomes `dimmed`. `onActivate` (:46) is called only
by the headline (:933-940); it is threaded to the Thumbnail (:1742-1798),
the Reddit-thread link (:1018-1045), Listen (:1093-1114) and the context
menu's "Open in new tab" (:815-824).

`frontend/src/components/SearchResults.tsx`: `readIds` / `onMarkRead`
(:28-32, :52-53, :95, :98).

`frontend/src/components/ShortcutsSheet.tsx`: the `m` row (:43).

`frontend/src/lib/preferences.tsx`: `seen:*` rows are ignored by
`decodeState` (:242); `setLastViewed`, `clearLastViewed` and
`setColumnSections` lose their last caller.

`backend/tests/test_slice21_column_memo.py`: the parametrize list (:94-115),
HANDLERS (:141-151) and `test_sections_collapsed_uses_memo_cache`
(:178-202). `test_frontend_slice19_empty_column_source_status.py:138`: the
`<Column\b[^>]*>` regex stops at the first `>`, so no prop with an arrow may
come before `sourcesByName=` at either Column site.

`frontend/scripts/iphone-audit/flows.cjs`: `flow-reset-keeps-saves` taps ✓
(:1824); FN's toast regex (:2252); `flow-desktop-layout` and
`flow-auto-append` gain their PR3b steps.

### Design

**`lib/feedOrder.ts` (pure, no imports).**
- `partitionTab({entries, isSeen, isRemoved, order, snapshot, hold, reset})
  → {unseen, earlier, snapshot, unseenCount, unseenIds}`. `entries` come in
  the tab's sort (App's `columns` memo sorts once). `order` is the tab's
  order as a string (its sort now; PR4d adds the window): a different
  `order` from the snapshot's starts a new snapshot, so a Sort change resets
  the tab whichever device made it.
- New snapshot (none, `reset`, or another `order`): unseen holds what isn't
  seen, earlier what is, both in the entries' order. The generation is the
  old one plus one.
- Kept snapshot: ids keep their group and place; ids new to the input
  append to the end of unseen, unless `hold`, which keeps them in `held`
  (counted, not drawn) until a call without `hold`. Each call refreshes the
  cached Entry of every id the input has; an id the input no longer has is
  drawn from its cached Entry until the next snapshot. `isRemoved` is
  applied to every id, cached ones too, at output time, so a hidden story
  leaves at once and an Undo puts it back in its place.
- The output arrays are rebuilt each call and compared element by element
  with the last ones: equal, the last arrays come back (Column's and Card's
  memos compare by reference); one Entry replaced by a poll, a new array.
- `unseenCount`: unseen-group ids not seen, held arrivals included.
  `unseenIds` is that list (Mark all marks exactly these).
- `countUnseen(entries, isSeen)` for tabs that aren't partitioned.
- `seenTest(ids, firstRunAt)`: D33. A story counts as seen when its id is
  marked, or when it was fetched more than 48 h before `firstRunAt`.
- `seenKey(category)`: `seen:<category>`.
- `nextTab(tabs, current, count)`: C8, the next shown tab after `current`
  (wrapping) with a count above 0, never Brief or Saved.

**`lib/useFeedOrder.ts` (React glue).** Holds `Map<tabKey, Snapshot>` in a
ref and partitions the tabs App draws on every render. A tab not drawn in a
render is marked for reset, so a tab switch resets both tabs (the one left
and the one opened). Nothing is kept until the app is ready (preferences
answered and the first refresh done), so the first snapshot sees the stored
marks. `resetSnapshot(key?)` (one tab or all) and `setHold(key, hold)` are
stable; `latest(key)` reads the last partition from the ref, for Mark all.

**Seen.** `seenIds` is the union of every `seen:*` row and every legacy
`read_entries:*` row. `preferences.tsx` decodes `seen:*` rows into
`seenEntries` (the per-column map pattern). New marks go only to
`seen:<category>` through `addIds(key, ids, keep)`, where `keep` is every
fetched id (entries, For You, saves): PR2b's `pruneIds` drops ids outside it
first. PR4c and PR4d add the Saved-by-id cache and `extraByTab` rows to it.

**D33.** `STORAGE_KEYS.firstRunAt`, read and written through
`safeGetItem` / `safeSetItem`; when storage throws, this load's time. Nothing
is written to the server.

**Opening.** `openEntry(entry)` (stable, reads refs) calls `addIds` under
the story's `seen:<category>` key synchronously and `noteStoryOpened()`
(PR1r's open stamp, which C1's guard reads). Both Columns, SearchResults and
the desktop For You row pass it; Card calls `onActivate` from the headline,
the Thumbnail, the Reddit link, Listen and the context menu's "Open in new
tab". Opening still records `click` as today; no `dwell` is sent.

**Mark all.** `markColumnRead(key)` marks the partition's `unseenIds` under
each story's `seen:<category>` key, resets the tab, and shows "Marked N as
read" with Undo. The Undo removes exactly those ids per key and resets the
tab again. The ⋯'s first row (44px, disabled at 0, absent on Saved) and the
end row's "N not seen · Mark as read" both call it.

**C1.** `useUpdateCheck(isDesktop, onReturn)`: the hook already stamps the
hide and measures time away with `Date.now`. On every return it starts
PR1r's check first (as before, only in a production build), then calls
`onReturn({away, openedBefore})`. App: at least `RETURN_RESET_MS` away and
not hidden within 2 s of an open → reset every snapshot and scroll the phone
list (and the desktop wrapper) to the top, then the return's silent refresh
runs (App's own visibility listener, registered after the hook's). The
refresh that return starts resets the snapshots again when it lands, so the
stories that arrived while away are sorted in, not appended.

**Column.** The header is the label, "N new" on md+ and ⋯. The list is the
first 30 unseen cards and the `[data-more]` sentinel; once every unseen card
is drawn, the `[data-caught-up]` row (✓ "You're all caught up" at 0, a 44px
"N not seen · Mark as read" button above 0), C8's 44px next-tab row (only
when caught up), and the folded 44px `button[data-earlier][aria-expanded]`
"Earlier (N)". Earlier draws dimmed cards 30 at a time. None of the rows is
`role="status"` or a `<section>`. Saved has no rows. An empty tab keeps
`EmptyColumnMessage`. Column owns the two limits and `earlierOpen`, resets
them when `generation` changes, opens Earlier when `selectedId` is in it,
and grows the limits to reach `selectedId`. It reports whether its marker is
above the viewport (`onHoldChange`, an IntersectionObserver on the marker
with `sentinelRoot` as root), which holds new arrivals back (Safari has no
scroll anchoring). Data props `unseenCount`, `nextTab` and `generation` join
`_columnPropsEqual` and slice 21.

**Removals.** ✓, swipe-right, `m`, the context menu's "Mark as read", the
header tap, the chip, "X of Y", Fresh / History and their folds, the unread
ring, `lastViewed` writes, `toggleEntryRead`, the hide toggle's mark-read.

**Hook points left for later units.** PR3c: Column's `setCardRef` is where
`trackSeen` registers unseen cards; `addSeenMarks(entries)` in App is the
one path seen marks take, which PR3c's collector calls; `useFeedOrder`
keeps `setHold`. PR4c / PR4d: the keep set, `order` (window) and the
partition counts within the window. PR5b: `isRemoved` (muted feeds). PR8a:
`resetSnapshot(key)` for a custom tab's feed edit. PR6b: the manual refresh
toast is the one PR6b replaces with its status row.

**Tests.** `feedOrder.test.ts` (each partition rule, the reference rules,
the generation, the order reset, D33, `nextTab`); slice 21; the flows and
smoke states the spec lists; the harness stubs `<a target="_blank">` clicks
(nothing leaves the page, as with `window.open`).

**Risks checked in the plan.** A category longer than 55 characters can't
take a `seen:` key (PR2a's 60-character limit). `sources.category` has
been `VARCHAR(40)` since migration 0001 (`backend/app/models.py:49`,
`alembic/versions/0001_initial.py:34`), so no category in use can be
longer than 40 and every `seen:` key fits (45 at most). No VPS query is
needed.

## What changed

Opening a story now uses it up. Each tab shows the stories not seen yet,
then "You're all caught up" (or "N not seen · Mark as read"), then the seen
ones folded under "Earlier (N)". The list stays still while you read, and
the tab badges count what isn't seen yet. ✓, swipe-right, `m`, the context
menu's "Mark as read", the header tap, the "+N new" chip and Fresh /
History are gone, so a story is used up only by opening it or by Mark all
(PR3c adds scrolling past it on the phone).

- `frontend/src/lib/feedOrder.ts` (new, pure, no imports): `partitionTab`
  (the snapshot rules), `countUnseen`, `seenTest` (the marks plus D33's
  48-hour baseline), `seenKey`, `nextTab` (C8).
- `frontend/src/lib/useFeedOrder.ts` (new, React glue): one snapshot per
  tab in a ref; `partition(tabs, {isSeen, isRemoved, ready})` once per
  render; stable `resetSnapshot(key?)`, `setHold(key, hold)` and
  `latest(key)`. A tab not drawn in a render is reset, which is the tab
  switch's reset of both tabs. Nothing is kept until the preferences have
  answered and the first refresh is done.
- `frontend/src/lib/preferences.tsx`: `seen:*` rows decode into
  `state.seenEntries` (per category, the per-column map pattern);
  `PREFERENCE_KEYS.seen`. `setLastViewed`, `clearLastViewed` and
  `setColumnSections` went with their last caller (Reset still deletes
  those rows; they are still decoded so it can find them).
- `frontend/src/lib/storage.ts`: `STORAGE_KEYS.firstRunAt` (D33). Reset
  wipes every `popping.*` key (PR1c), this one too, so after a Reset the
  device starts like a new one: its baseline is the reload's time, and
  the `seen:*` rows are gone with it.
- `frontend/src/lib/useUpdateCheck.ts`: `useUpdateCheck(isDesktop,
  onReturn)`. Every return starts PR1r's check first (only in a production
  build, as before), then reports `{away, openedBefore}` to `onReturn`.
  The listeners now attach in a dev build too (the check doesn't run
  there). `OPEN_GUARD_MS` is exported.
- `frontend/src/App.tsx`:
  - `seenIds` (every `seen:*` and legacy `read_entries:*` row) and
    `isSeen` (with D33's `firstRunAt`) replace `globalReadIds`;
    `newCountByColumn`, `unreadIdsByColumn` and `sectionsByColumn` go,
    and `useFeedOrder` partitions the drawn tabs (the phone's tab; on the
    desktop every grid column, and the hidden phone tab). Saved isn't
    partitioned: it lists every save above no marker.
  - `isRemoved`: hidden, or from a feed no longer in `sources` (PR5b adds
    muted feeds).
  - `countFor(col)`: the partition's count for a drawn tab, `countUnseen`
    of its stories otherwise; the badge (`99+`, `aria-label="<tab>, N
    new"`, none on Saved), the marker, the md+ "N new" and C8 use it.
  - `addSeenMarks(stories)`: the one path seen marks take, grouped by
    `seen:<category>`, one `addIds` per key with the keep set (entries,
    For You, saves). `openEntry(entry)` calls it synchronously and stamps
    `noteStoryOpened()`. Both Columns, SearchResults and the desktop For
    You row pass it as `onActivate`.
  - `markColumnRead(key)` is Mark all: the partition's `unseenIds`,
    marked, the tab reset, "Marked N as read" with Undo;
    `unmarkColumnRead(key, added)` removes exactly those per key and
    resets the tab.
  - C1: `onReturn` resets every tab and scrolls the phone list and the
    desktop wrapper to the top after `RETURN_RESET_MS` (10 min) away,
    unless the page hid within 2 s of an open; the refresh that return
    starts resets the tabs again when it lands.
  - A refresh that isn't silent (Refresh, `r`) resets every tab when its
    stories land and toasts "N new" (ids held before the request) or
    "Nothing new". Polls never reset.
  - C8: `nextTabFor(key)` walks `columns` (`orderColumns().shown`), one
    cached object per tab while its value holds; `openTab` jumps there
    like the Menu's Jump to column.
  - The arrow keys walk the partition (unseen, then Earlier).
  - Gone: `HIDDEN_RESET_MS`, `readEntriesKey`, `MAX_SEEN_ENTRY_IDS`,
    `capSetFIFO`, `seenEntryIdsRef`, `hiddenAtRef`, the section-fold
    types, refs and handlers (`setColumnSection`, `sectionsCollapsedFor`),
    `lastViewedRef` and the `lastViewed` write, `markEntryRead`,
    `unmarkEntryRead`, `toggleEntryRead`, the `m` key, `manualRefresh`,
    the columns memo's `totalCount`. `toggleHideEntry(id)` no longer
    marks the story read.
  - Reset deletes `seen:*` rows too, and drops their queued writes.
- `frontend/src/components/Column.tsx`: props `sections` (`{unseen,
  earlier}`), `unseenCount`, `nextTab`, `generation`, `onOpenEntry`,
  `onMarkAll`, `onOpenTab`, `onHoldChange`; gone `newCount`,
  `totalCount`, `sectionsCollapsed`, `onToggleSection`, `onMarkRead`,
  `onMarkEntryRead`, `onRefresh`. The header is the label, "N new" on md+
  (`data-new-count`) and ⋯, whose first row is Mark all as read
  (`data-mark-all`, 44px, disabled at 0, absent on Saved). The list:
  unseen cards 30 at a time, then the `[data-caught-up]` row, C8's
  `[data-next-tab]` row (caught up only), the folded
  `button[data-earlier][aria-expanded]`, and Earlier's dimmed cards 30 at
  a time. C8's row is named like the tab in the strip ("News, 12 new").
  Each card run is a `div[data-group]`. Both limits and
  `earlierOpen` reset on `generation`; Earlier opens and the limits grow
  for the keyboard selection. An IntersectionObserver on the marker
  (root `sentinelRoot`) reports whether it is above the screen.
  `ColumnSection` became `CardList`.
- `frontend/src/components/Card.tsx`: ✓ and `CheckIcon`, the right-swipe
  reveal and commit, `commitMarkRead`, `mountTime`, the context menu's
  "Mark as read", the unread ring and `onMarkRead` are gone; `unread` is
  `dimmed`. `onActivate` is called by the headline, the Thumbnail
  (`onOpen`), the Reddit-thread link, Listen and the context menu's "Open
  in new tab".
- `frontend/src/components/SearchResults.tsx`: `onOpenEntry` replaces
  `readIds` / `onMarkRead`.
- `frontend/src/components/ShortcutsSheet.tsx`: the `m` row is gone.
- `backend/tests/test_slice21_column_memo.py`: the comparator list drops
  `newCount`, `totalCount`, `sectionsCollapsed` and adds `unseenCount`,
  `nextTab`, `generation`; HANDLERS drop `setColumnSection` and
  `sectionsCollapsedFor`; `test_sections_collapsed_uses_memo_cache` is
  deleted.
- Tests and harness: `frontend/scripts/unit/feedOrder.test.ts`; the flows
  and smoke states below; the flow harness keeps a new-tab link's click on
  the page (recorded in `opened`); `docs/DEVICE_CHECKS.md`;
  `frontend/scripts/iphone-audit/README.md`.

## Deviations from the spec

- **`onOpenEntry` takes the Entry, not the id.** The mark goes under the
  story's category, so App needs the story's feed; with the Entry in
  hand there is no id lookup across tabs, For You and search.
- **C1 runs from the update check's return report.** `useUpdateCheck`
  already stamps the hide and measures time away; it now hands every
  return to App (`onReturn`) after starting its check, which is what
  "run PR1r's update check first" asks. App's `hiddenAtRef` went with its
  last reader, so there is one hide stamp for both rules. Beyond the
  spec: the refresh the return starts resets the tabs once more when it
  lands (reset only before it, the stories that came in while away would
  be appended at the end of the unseen ones, not sorted first, which C1
  promises); the desktop wrapper scrolls to the top too; the open guard
  applies on both layouts (PR1r's guard stays phone-only for the reload).
- **A Sort change resets through the snapshot's `order`**, not a
  `resetSnapshot` call: the tab's order string (its sort and its "Hide if
  older than", the window until PR4d) is part of the snapshot, so a sort
  changed on another device resets too. The source filter's column adds
  the filter and the scope its fetch loaded to its order: it is another
  tab per filter, and until the filter's own fetch lands it shows that
  filter's stories from the unfiltered fetch (`flow-filter-one-feed-status`
  showed the difference).
- **The tab-switch reset is the hook's**: a tab not drawn in a render is
  reset, so a switch resets the tab left and the tab opened without App
  tracking switches.
- **An arrival already seen goes at the end of Earlier**, not the end of
  the unseen ones: it isn't new (marked on another device first).
- **C8's row shows only under "You're all caught up"**, as C8 words it
  ("under a caught-up tab's marker"); under "N not seen · Mark as read"
  there is no next tab yet. On the desktop it scrolls to that column.
- **Saved has no read model**: no partition, no marker, no Mark all row,
  no badge, no dimming ("Saved has no marker").
- **A hide no longer marks the story read** (the eye button and `h` did);
  the spec's removal list doesn't name it, but after PR3b a story is used
  up only by opening it or by Mark all, and Hide's Undo now puts it back in
  its place.
- **`markColumnRead` keeps its name** (slice 21 pins it); it is Mark all.
- **Mark all's Undo shows no second toast** ("Column restored." went).
- The md+ "N new" is CSS (`hidden md:inline`): the spec says "on md+",
  and Column doesn't know the layout.
- **The longest category was checked in the schema, not on the VPS.** The
  spec's Risks ask to check the longest category in use before merging;
  `sources.category` is `VARCHAR(40)` since migration 0001, so every
  `seen:` key is 45 characters at most and no device-check query is
  needed.
- `flow-foryou-fails-keeps-tab` was rewritten: a failed For You poll now
  leaves its stories in the tab until it starts over (the "a poll drops a
  story" rule), so the flow checks they stay, then switches away and back
  to see the empty tab and the phone still on it.
- `flow-scroller-rotate` lost its `column_sections:nhl` seed: it kept the
  phone Column's memo holding across the flip, which it now does anyway.

## Tests

- Unit `frontend/scripts/unit/feedOrder.test.ts` (18 cases): a new
  snapshot (unseen, then Earlier, each in the tab's order); a story seen
  after it keeps its group and place and stops counting; arrivals at the
  end of the unseen ones; an arrival already seen at the end of Earlier;
  arrivals held (and counted) while the marker is above the screen, then
  let go in arrival order; a poll-dropped story stays from its kept copy
  until the next snapshot; removed stories leave at once (cached ones too)
  and come back in place; a hidden or deleted snapshot story leaves while
  a poll-dropped one stays; a removed story leaves (and stops counting)
  even while the input still has it; unchanged input returns the same
  arrays; one updated story comes back in a new array; the generation
  goes up on a reset and only then; a reset re-sorts; an order change
  (sort, and the window as PR4d will encode it) starts a new snapshot;
  D33; `countUnseen`; `seenKey`; `nextTab`.
- pytest `test_slice21_column_memo.py`: `[unseenCount]`, `[nextTab]` and
  `[generation]` replace `[newCount]`, `[totalCount]` and
  `[sectionsCollapsed]`; HANDLERS drop `setColumnSection` and
  `sectionsCollapsedFor`; `test_sections_collapsed_uses_memo_cache` is
  deleted.
- New flows (390 unless said; the README has each step): 
  `flow-open-marks-seen` (a Column, search, the desktop For You row, and
  the keepalive PATCH when the page hides straight after an open),
  `flow-badge-cap` (99+, the tab's name with the full count, none at 0),
  `flow-caught-up`, `flow-next-tab` (C8, the row's name, a hidden tab
  never named),
  `flow-mark-all-read`, `flow-new-arrival-appends` (append, and hold
  while the marker is above the screen), `flow-return-after-10-min` (C1:
  9 min nothing; 11 min reset, the arrival first and the list at its top;
  an open straight before leaving: nothing), `flow-refresh-resets` (a poll
  appends without a toast; Refresh starts the tab over, "1 new" then
  "Nothing new").
- Changed flows: `flow-auto-append` ends with the marker;
  `flow-desktop-layout` adds a Mark all step; `flow-reset-keeps-saves`
  seeds `seen:news` and opens a story where it tapped ✓;
  `flow-foryou-fails-keeps-tab` and `flow-scroller-rotate` as under
  Deviations. FN's toast regex is `/^(\d+ new|Nothing new)$/`, looked for
  in the toast (`[role="status"]`) only, since the md+ header's "N new"
  matches it too. `flow-sort-best` and FM pass unchanged.
- Harness: a click on a new-tab link (`a[target="_blank"]`) that the app
  didn't handle itself is recorded in `opened` and kept on the page
  (bubble phase), so opening a story leaves the flow on Popping.
  Helpers: `withArrivals`, `arrivalNhl`, `groupIds`, `markerText`,
  `badge`, `textNow`, `openStory`, `seenAdded`, `seenRemoved`.
- Smoke states (390 and 320): `caught-up`, `not-seen-row`,
  `earlier-open`: rows 44px, the marker not a status region and not a
  nested `<section>`, Earlier's cards at opacity 0.6.

## Verification

Local loop on `stack-pr3b`, based on origin/main `e1f0390` (PR3a #43;
origin/main had not moved at commit time), with the frontend's
`node_modules` linked in, Postgres 16 database `popping_test_f`, and
`vite preview` on 127.0.0.1:4173.

- **No mutant left behind.** The work resumed after a container restart in
  the middle of a mutation run. Before anything else, every original line
  of the four mutation batches (45 edits) was found exactly once in the
  tree, and `Column.tsx` matched the last batch's backup copy byte for
  byte.
- **Review of the WIP against the spec.** It turned up, and this pass
  fixed: a unit mutant that had survived (a removed story drawn while the
  input still has it; new case 9); three placeholder rows in the mutation
  table, filled from a re-run of that batch; C8's row read as "Podcast dot
  2" to VoiceOver (it now has the tab strip's name, "Podcast, 2 new", and
  `flow-next-tab` checks it); a device check that said no badge reads 99+,
  which a busy tab can rightly show (reworded to what D33 promises); the
  category-length VPS query (not needed, see Deviations); and comments
  that still named ✓, the "+N new" chip or the "refreshed" toast.
- `npm run lint`: 0 errors (the 4 react-refresh warnings main has).
  `npm run build` (tsc, then vite): clean. `git diff --exit-code
  package.json package-lock.json`: clean.
- Unit tests (`node --experimental-strip-types --test
  'scripts/unit/*.test.ts'`): 193 of 193 pass (`feedOrder.test.ts`: 18).
- Backend pytest, the whole suite: 1712 passed, 13 failed; the 13 are
  exactly the DNS-only failures listed in the container's baseline. The
  ten tests that read frontend source (slice 21, slice 19, the feed editor
  and preference contracts, and the rest that open `frontend/`), run
  again after the last edit: 210 passed.
- Strict smoke (`smoke.cjs --csp --strict`), every state and flow, on the
  final build: 0 failures, 0 warnings (169 runs, 421 s). The same run on
  the WIP build before this pass's edits: 0 failures (419 s).
- The PR3b flows and states with every flow this unit changed or leans on
  (`flow-open-marks-seen`, `flow-badge-cap`, `flow-caught-up`,
  `flow-next-tab`, `flow-mark-all-read`, `flow-new-arrival-appends`,
  `flow-return-after-10-min`, `flow-refresh-resets`, `flow-auto-append`,
  `flow-desktop-layout`, `flow-reset-keeps-saves`,
  `flow-foryou-fails-keeps-tab`, `flow-scroller-rotate`,
  `flow-fn-quiet-poll`, `flow-sort-best`, `flow-filter-one-feed-status`,
  `flow-desktop-keys-past-batch`, and `caught-up`, `not-seen-row`,
  `earlier-open` at 390 and 320): 23 runs, looped 5 times, 0 failures
  each time (74 to 76 s a loop).
- Screenshots (`--out`, not committed) of `caught-up`, `not-seen-row`,
  `earlier-open` at 390 and 320 and `flow-next-tab`'s row: the marker,
  C8's row and "Earlier (N)" close the list as one end, and Earlier's
  cards are dimmed.
- Security checklist: no route, fetch or server-side read changes. The
  new `seen:*` rows go only through PR2b's PATCH (`addIds` /
  `removeIds`) under PR2a's allowlisted prefix, and are read back through
  `coerceIds`.
- WebKit results come only from CI.

### Mutation checks (test → broken line → failing rule)

Each was a scratch edit, then a rebuild, `--only` on the flows (or the
unit file, or the pytest file), a restore from a backup copy and a byte
compare. Every one failed where the table says (a unit test by its place
in `feedOrder.test.ts`).

| Test | Broken line | Fails on |
|---|---|---|
| `flow-open-marks-seen` | Column's cards get no `onActivate` | OPEN-SEEN: "opening story 101 sent no PATCH adding it to seen:news" |
| `flow-open-marks-seen` | SearchResults' cards get no `onActivate` | OPEN-SEEN: "opening a search result sent no PATCH adding 601 to seen:nhl" |
| `flow-open-marks-seen` | the desktop For You row's cards get no `onActivate` | OPEN-SEEN: "opening a card in the desktop For You row sent no PATCH adding 301 to seen:security" |
| `flow-open-marks-seen` | the open's mark deferred by 1.5 s | OPEN-SEEN: "hiding right after an open sent no keepalive PATCH of seen:news"; "story 102 ... never reached the store" |
| `flow-open-marks-seen`, `flow-caught-up` | the count ignores seen marks | OPEN-SEEN: the badge reads "12", expected "11"; CAUGHT-UP: the end row reads "40 not seen" after two opens |
| `flow-open-marks-seen`, `flow-next-tab` | the badge counts every story | OPEN-SEEN: badge "12"; NEXT-TAB: no next-tab row under the caught-up NHL tab |
| `flow-badge-cap` | `{count > 99 ? '99+' : count}` → `{count}` | BADGE: "the NHL tab's badge reads "103" with 103 unseen, expected "99+"" |
| `flow-badge-cap` | the tab's `aria-label` dropped | BADGE: "the NHL tab is named null, expected "NHL, 103 new"" |
| `flow-caught-up` | the end row's tap does nothing | CAUGHT-UP: "after Mark as read 40 stories are still above the marker" |
| `flow-caught-up` | C8's row shown while stories are unseen | CAUGHT-UP: "C8's row shows while stories are unseen" |
| `flow-next-tab` | C8's row without its `aria-label` | NEXT-TAB: "the row is named null, expected "Podcast, 2 new"" |
| `flow-next-tab` | `nextTab` walks the hidden tabs too | NEXT-TAB: "with Podcast hidden the row reads "Podcast · 2", expected "Security · 9"" |
| `flow-caught-up`, `flow-mark-all-read` | Undo doesn't reset the tab | CAUGHT-UP: "Undo brought nothing back above the marker"; MARK-ALL: after Undo nothing above the marker, Earlier still there |
| `flow-mark-all-read`, `flow-desktop-layout` | Mark all doesn't reset the tab | MARK-ALL: "Mark all left stories above the marker"; DESK-LAYOUT: "the NHL column still draws 60 cards above the marker" |
| `flow-new-arrival-appends` | arrivals go first | ARRIVAL: above the marker `[7901,601,602]`, expected the newest at the end |
| `flow-new-arrival-appends` | App ignores the hold | ARRIVAL: "with the marker above the screen the arrival went in" |
| `flow-return-after-10-min` | the open guard ignored | RETURN: "back 11 min after opening a story the list moved"; "is at 0, expected 400" |
| `flow-return-after-10-min` | `RETURN_RESET_MS` 2 min | RETURN: "back after 9 min the list moved" |
| `flow-return-after-10-min` | no reset on return, none when its refresh lands | RETURN: the arrival is last, not first; "the opened story is not folded under Earlier (1)" |
| `flow-return-after-10-min` | no second reset when the return's refresh lands | RETURN: `[102,…,112,7951]`, expected the arrival first |
| `flow-return-after-10-min` | no scroll to the top | RETURN: "the list is at 232, expected its top" |
| `flow-refresh-resets` | Refresh doesn't reset | REFRESH: the new stories at the end, not first; Earlier empty |
| `flow-foryou-fails-keeps-tab` | a poll-dropped story leaves at once | FY-FAIL: "the failed poll changed For You from 8 stories to 0" |
| `flow-foryou-fails-keeps-tab` | a tab switch resets nothing (the hook) | FY-FAIL: "For You kept its stories after its request failed and the tab started over" |
| `flow-filter-one-feed-status` | the filter column's order without the filter and its scope | FILTER-STATUS: the empty one-feed filter shows the unfiltered fetch's stories, not the feed's error |
| smoke `caught-up` | the marker not rendered | SETUP: the state can't be reached |
| smoke `not-seen-row` | the marker row `role="status"` | READ-MODEL: "is a status region" |
| smoke `earlier-open` | Earlier's cards not dimmed | READ-MODEL: opacity `["1","1"]`, expected 0.6 |
| unit | no reuse of the previous arrays | 10 (unchanged input) |
| unit | D33 off | 15 |
| unit | an order change keeps the snapshot | 14 |
| unit | `nextTab` doesn't wrap | 18 |
| unit | the hold ignored | 5 |
| unit | an arrival already seen goes into the unseen ones | 4 |
| unit | the generation not bumped | 12, 14 |
| unit | removed stories drawn once the input dropped them (kept copies) | 7, 8 |
| unit | removed stories drawn while the input still has them | 9 (this case was added after an earlier run left the mutant alive) |
| unit | removed stories still counted | 7, 9 |
| pytest | the comparator ignores `generation` / `unseenCount` / `nextTab` | `test_column_comparator_checks_prop[generation]` / `[unseenCount]` / `[nextTab]` (each run alone) |

## Open items for later units

- PR3c: register unseen cards in Column's `setCardRef` when `trackSeen`;
  drain the seen-on-scroll collector through App's `addSeenMarks`
  (grouped by category, with the keep set) and `registerBeforeFlush`;
  count the open sheets in `modalOpen`. The marker element
  (`[data-caught-up]`) and its observer are where the end rule can hook.
- PR4c: add the Saved-by-id cache to `keepIds`; Saved stays outside the
  partition.
- PR4d: put the window in the columns memo's `order` (it already holds
  "Hide if older than"), add `extraByTab` rows to `keepIds`, and count
  within the window (`countFor`).
- PR5a: the eye button and the left swipe are still Card's; "Hide" keeps
  its Undo-in-place through `isRemoved`.
- PR5b: muted feeds join `isRemoved` (category tabs, For You, search).
- PR6b: the manual refresh toast ("N new" / "Nothing new") is the one the
  status row replaces; `resetSnapshot()` on a manual check stays.
- PR7b: the tab sheet's Mark all row calls `markColumnRead(key)` (disabled
  at `countFor(col) === 0`).
- PR8a: `resetSnapshot(key)` after a custom tab's feed edit; each custom
  tab's rows join `keepIds`.
- `ARCHITECTURE.md`: no change. The snapshots are browser memory and
  `firstRunAt` is a localStorage value; nothing server-side.

## Data compatibility and rollback

- New marks go only to `seen:<category>` (PR2a's PATCH-only prefix, cap
  1000). Legacy `read_entries:*` rows are read, never written, so an old
  bundle that still PUTs them can only overwrite its own rows.
- Revert restores ✓. Marks made under `seen:*` are invisible to the old
  build, so stories used up here show as unread there until they age out.
- `firstRunAt` is per device and local; a revert leaves it unused.
- A category longer than 55 characters couldn't take a `seen:` key (PR2a
  rejects keys over 60), but `sources.category` is `VARCHAR(40)` and has
  been since migration 0001, so none is.
- As a git revert, PR3b stands alone until PR3c merges; it deploys only
  together with PR3c (D33).
