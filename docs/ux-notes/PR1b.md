# PR1b: Tab keys, resolveTab, tap-to-top, phone scroller (frontend track)

The phone remembers its tab by name (a key) instead of by its place in the
strip. Saving or unsaving a story, or a feed moving between categories, no
longer moves the phone to another tab. A new phone opens on For You.
Tapping the tab you are on scrolls it back to the top.

## What changed

- `frontend/src/lib/columns.ts` (new, pure, import-free):
  - Keys `meta:brief`, `meta:saved`, `meta:foryou`, `meta:search`,
    `meta:filter` (PR8b removes it with the filter) and `cat:<name>`, plus
    `colKey(category)` and `parseColKey(raw)` (anything that isn't one of
    those, or is longer than 200 characters, reads as null).
  - `readStoredTab(rawKey, rawIndex)`: the stored key wins; the old index
    (`mobileCol.last`, -1 = Brief) is read only when no key is stored.
  - `freshTabIndex(tabs)`: For You when it has stories, else the first tab
    after Brief with stories, else the first tab after Brief.
  - `resolveTab(tabs, wanted, lastIndex, {loaded, filterActive})` returns
    the tab to show and the key to store (or null to keep what is stored):
    - the wanted key is in the strip: show it;
    - it is missing: show the tab now at `lastIndex` (its neighbour), or the
      fresh-device tab when it never stood anywhere this session or was the
      filter's column. Once loaded and with no filter on, that tab becomes
      the stored one; before that, or under the filter, the key is kept;
    - an old index: the tab at that place after Brief (clamped), -1 = Brief,
      stored once loaded;
    - nothing stored: the fresh-device tab, stored once loaded, and only
      when it has stories (an install with no stories yet would otherwise
      store Brief or an empty Saved and stay there once For You fills).
    - Brief never replaces a stored tab: with only Brief left (every story
      hidden, every feed deleted) Brief is shown and the key is kept.
- `frontend/src/lib/storage.ts`: `mobileTab` (`popping.v1.mobileTab`).
  `mobileColLast` is only read to migrate and is removed on the first
  write of `mobileTab`.
- `frontend/src/App.tsx`:
  - Columns carry `key` (both the all-tabs and the filter memos).
  - `mobileTab` state (`StoredTab`) replaces `mobileCol`, `loadMobileCol`,
    `followTabRef`, `mobileColRef`, `columnsRef` and the old clamp-and-write
    effect. The desktop `selectedColumnIndex` clamp is its own effect.
  - `selectTab(key)` (useCallback) replaces `selectMobileCol` at the Brief
    tab, the column tabs and `jumpToCategory`. It is the only writer of the
    stored key; the resolve effect calls it to settle a tab.
  - `firstRefreshDone`: set after the first applied refresh, success or
    error. The first-load skeleton shows while it is false (and, as
    before, while an empty dashboard refreshes).
  - The resolve gate (`tabsLoaded`) is `!prefs.loading && firstRefreshDone`,
    plus two conditions the spec doesn't name (see Deviations):
    - `tabsLoadedFor === filterScope(activeSources)`: the last applied
      refresh loaded the tabs for the filter in force (compared by value);
    - For You: while its request fails, a stored For You, a fresh device
      and an old index wait; any other stored tab still settles.
  - `lastTabIndex` (state): where the stored tab last stood, set only when
    the stored tab itself is shown.
  - The resolve effect stores `tabChoice.store`, on the phone only
    (`!isDesktop`); the desktop leaves the phone's tab alone.
  - Phone scroller: `const [phoneScroller, setPhoneScroller] =
    useState<HTMLElement | null>(null)`, and the phone Column is
    `<Column key={phoneCol.key} scrollerRef={setPhoneScroller} …>` (the
    setter itself, before `sourcesByName=`, so slice19's `<Column\b[^>]*>`
    regex still matches). A keyed remount means every tab opens at its own
    top and later scroller hooks rebind.
  - The phone Column's `selectedId` compares `selectedColumnIndex` with the
    index of the shown key.
  - `onPhoneTabTap(key)`: another tab is selected. The tab shown scrolls to
    the top (`behavior: 'auto'` under `prefers-reduced-motion: reduce`,
    else `'smooth'`); Brief scrolls the body wrapper (`phoneBodyRef`), any
    other tab the list. A tap on a tab that only stands in for the stored
    one (while loading) also selects it; the filter's column never does.
  - `applyServerSource` no longer records a tab to follow: the phone
    follows its key.
- `frontend/src/components/Column.tsx`: optional `scrollerRef` prop,
  attached as a callback ref on the story list, which is then marked
  `data-scroller`. Only the phone Column gets it, so only the phone list
  carries `data-scroller`. The memo comparator ignores it (stable setter);
  the comparator comment says so.

## Tests

- Unit `frontend/scripts/unit/columns.test.ts` (14 tests): key parsing and
  the stored-tab read; Saved appearing in front of the shown tab; the
  neighbour fallback (kept while loading and under the filter, stored once
  loaded); a missing key with no last place; index migration and -1 →
  Brief; no migration before the first refresh, including with meta tabs
  present; a fresh device skipping an empty Saved and Brief; nothing
  stored for an empty fresh pick; only Brief left; a stored filter column.
- Flows (`flows.cjs`, all at 390):
  - `flow-tab-stays-on-star` (News; the fixtures have no tech tab), with a
    reload at the end;
  - `flow-unsave-last-saved`;
  - `flow-tap-tab-scrolls-top`;
  - `flow-tab-migrates-index`: the old index with preferences 1.5 s late;
  - `flow-tab-gone-on-load`: a stored category that went opens For You;
  - `flow-filter-clear-keeps-tab`: clearing the filter while the unfiltered
    stories are 1.5 s late;
  - `flow-foryou-fails-keeps-tab`: one failed For You refresh keeps
    `meta:foryou` stored;
  - `flow-foryou-down-settles`: For You failing throughout; a fresh phone
    stores nothing, a stored Saved that empties still settles.
  - FM (`flow-fm-phone-tab-follows`) and FU (`flow-fu-jump-to-column`)
    are unchanged and green.
  - Four flows call `shot()` at their end state (`saved`, `end`, `top`,
    `moved`); without `--out` nothing is written.
- pytest: slice19 keeps its literal and its `<Column` regex; slice21's
  comparator checks pass.

## Verification

- `npm run lint`: 0 errors, the same 6 react-refresh warnings as main.
  `npm run build` (tsc + vite) clean. Unit tests: 86 of 86.
- Strict smoke (`--csp --strict`, fonts-ci.conf): 0 failures, 0 warnings,
  run twice in full (the second after the review fixes).
- The PR1b flows plus FM and FU looped 5 times after the review fixes:
  0 failures each time.
- Backend pytest that pins frontend source (`popping_test_f`):
  `test_frontend_slice19_empty_column_source_status.py`,
  `test_slice21_column_memo.py` and `test_preferences_anonymous.py` pass;
  `test_reserved_category_names.py`'s two failures are on the 13-test DNS
  baseline list. No backend code changed.
- `package.json` and the lockfile untouched.

### Mutation checks (flow → broken line → failing rule)

| Flow / test | Broken line | Fails on |
|---|---|---|
| `flow-tab-stays-on-star` | `allSubsColumns`: `key: colKey(cat)` → a key by position (`colKey(String(out.length))`), i.e. tabs named by place | TAB-STAR: stored tab is `cat:2`, the reload opened Deals (4 failures) |
| `columns.test.ts` | `if (at >= 0)` → `if (at >= 0 && lastIndex == null)` | "Saved appearing in front of the shown tab does not move it" and 2 more |
| `flow-unsave-last-saved` | neighbour fallback returns `store: null` | UNSAVE: stored tab is `meta:saved`; saving from For You moved the phone to Saved |
| `flow-tab-migrates-index` | gate without `!prefs.loading` | TAB-MIGRATE: index 0 opened For You, stored `meta:foryou` |
| `flow-tab-gone-on-load` | missing key with no last place → `pick(0)` | TAB-GONE: opened Brief, stored `meta:brief` |
| `flow-filter-clear-keeps-tab` | gate without `tabsLoadedFor === activeScope` | FILTER-TAB: phone shows Deals, stored `cat:deals` |
| `flow-foryou-fails-keeps-tab` | `setForYouLoaded(forYouOk)` → `true` | FY-FAIL: stored `cat:deals`; stayed on Deals |
| `flow-foryou-down-settles` | For You condition → `forYouLoaded` alone | FY-DOWN: Saved went but stays the stored tab |
| `flow-foryou-down-settles` | For You condition without `storedKey != null` | FY-DOWN: a new phone stored `meta:saved` while For You is down |
| `flow-tap-tab-scrolls-top` | `scrollTo` removed | TAP-TOP: list left at 2133 (both taps) |
| `flow-tap-tab-scrolls-top` | `behavior: 'smooth'` always | TAP-TOP: under reduced motion the list is at 2133 right after the tap |
| `flow-tap-tab-scrolls-top` | `key={phoneCol.key}` removed | TAP-TOP: Deals opened at 1455 |
| `columns.test.ts` | `settle = !filterActive` | the loading, fresh-device and no-migration tests |
| `columns.test.ts` | `freshTabIndex` ignores size | "a fresh device opens on For You, skipping an empty Saved and Brief" |
| `columns.test.ts` | `wanted.index === -1` → `-2` | index migration; no-migration test |
| `columns.test.ts` | Brief neighbour stored | "with only Brief left, a tab that went is not replaced by Brief" |

Each mutation was restored and checked by checksum (`md5sum -c`).

### Review (/code-review high) and screenshots

- The first run reviewed the main checkout by mistake (PR10a); it was
  rerun on this branch. Fixed from its findings:
  - a For You that stays down blocked every settle, which brought the jump
    back (now only what depends on For You waits; new flow);
  - the neighbour fallback could store Brief when only Brief was left (now
    kept; new unit test);
  - the filter scope was compared by Set identity (now by value).
- Not changed, with reasons:
  - Tapping the filter's column from Brief stores `meta:filter`, so after
    clearing the filter the phone lands on For You rather than the tab from
    before the filter. Showing a tab needs it stored; PR8b removes the
    filter.
  - `lastTabIndex` stays state, not a ref: `resolveTab` runs in render,
    and reading a ref there breaks React's render rules. The extra commit
    happens only when the stored tab's index moves.
  - `selectTab` writes localStorage on every tab change; cheap, and only
    on taps or settles.
  - Nothing scrolls the shown tab's chip into view on load or settle; the
    old index storage had the same gap. Open item below.
- 390px screenshots looked at (not committed, not sent): `dashboard` at
  390/320/312 (For You selected on a fresh phone, no Saved tab);
  `flow-tab-stays-on-star-saved` (Saved tab added in front, News still
  selected, its header "NEWS 12"); `flow-unsave-last-saved-end` (Saved back,
  For You still selected); `flow-tap-tab-scrolls-top-top` (News at its top
  after the tap); `flow-foryou-down-settles-moved` (no For You tab, Deals
  selected after Saved went).

## Deviations from the spec

- The resolve gate has two more conditions than `!prefs.loading &&
  firstRefreshDone`:
  - the filter scope: after the filter is cleared, until the unfiltered
    refresh lands the strip holds only the filtered feed's categories, so
    the stored tab looks gone and would be replaced;
  - For You: `refresh()` turns a failed For You request into `[]`, which
    takes the tab away for that refresh; a stored For You would otherwise
    be replaced by its neighbour, and a new phone would store another tab.
  Both serve the spec's intent (only settle a tab that has really gone).
- `resolveTab` keeps the stored key when the neighbour would be Brief, and
  doesn't store an empty fresh pick. The spec doesn't say; both stop a
  phone being left on Brief or an empty tab.
- A stored `meta:filter` that went resolves to the fresh-device tab rather
  than its old place.
- ARCHITECTURE.md is unchanged: it lists the backend's process-local state,
  and this unit adds only a per-device localStorage key, documented in
  `lib/storage.ts`.

## Open items for later units

- PR7a: walk tabs with `orderColumns().shown`; Saved and For You are always
  present then, so the For You-failure and empty-Saved cases change shape
  (the skeleton already keys on `firstRefreshDone`, not `columns.length`).
- PR3a/PR3c/PR6b: take `phoneScroller` as an effect dependency.
- PR8b: drop `meta:filter`, `filterActive` and the filter scope.
- Scroll the shown chip into view when the phone opens on, or settles to,
  a tab far along the strip.

## Revert

Revert is safe: the old build reads `mobileCol.last`, which this build
removes once it stores a key, so a reverted phone opens on tab 0. As a git
revert, PR1b stands alone only until PR1c merges.
