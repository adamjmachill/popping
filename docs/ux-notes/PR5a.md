# PR5a: Reddit card, action sheet, Hide hold (frontend track)

Built on main 8516098 (PR3b and PR3c merged). PR4c (Saved by id) and
PR4d (window UI) are built in parallel and land first; this unit is
rebased onto them before it merges, so its App.tsx changes stay local
(`hideStory` calls the existing `hideEntry`; the hide internals and the
tab ⋯ are untouched). A first session built most of it and stopped
before running the local loop; a second reviewed every change against
the spec, finished it and ran every check (below).

## Anchors

The spec's line numbers are from before PR1r through PR3c; every anchor was
found again by name on `stack-pr5a` at f85917a.

| Spec anchor | Where it is now | Holds? |
|---|---|---|
| `modalOpen` with PR5a's marked place (App.tsx) | `const modalOpen = drawerOpen \|\| settingsOpen \|\| shortcutsOpen \|\| tabsEditorOpen` | yes; `actionSheetOpen` joins it |
| the four "Entry hidden." closures and the `h` key | `onHide` on SearchResults and the desktop For You row, `onHideEntry` on both Columns, `toggleHideEntry` in `onKey` | yes; all call `hideStory` now |
| `toggleHideEntry` / `unmarkEntryRead` | `toggleHideEntry` present; `unmarkEntryRead` already gone (PR3b) | `toggleHideEntry` deleted |
| the save toasts (5 places) | the `b` key, SearchResults `onStar`, the For You row, both Columns' `onStarEntry` | yes; all go through `starStory` |
| Card's header line, meta row, action bar, eye button, context menu | `Card.tsx` (the meta row under the title, the vote footer, `onContextMenu` with Save / votes rows) | yes |
| `timeAgo` "ago" | `timeAgo` in Card.tsx | yes |
| swipe clamp and the touchmove deps `[onHideToggle]` | the touchmove effect, `commitHideToggle` | yes |
| `_cardPropsEqual` with `hidden` | Card.tsx | yes |
| Column Props / ColumnSection `onHideToggle`, `hiddenSet` | `Props`, `ColumnInner`'s destructuring, `cardProps`, `CardListProps`, `CardList`, `_columnPropsEqual` | yes (ColumnSection is `CardList` since PR3b) |
| SearchResults `onHideToggle`, `hiddenSet` | SearchResults.tsx | yes |
| `interactions.ts` batch queue and `onPageHide` | `queue`, `onPageHide`, the `pagehide` / `visibilitychange` listeners | yes |
| `Toast.tsx` | the singleton host with its 3 s / 5 s timer | yes |
| `test_slice30_safe_external_url.py` "Open in new tab" regex | `test_card_uses_safe_external_url_for_entry_url` | yes; now "Open in browser" |
| `test_slice21_column_memo.py` `hiddenSet` | the comparator parametrize list | yes |
| Drawer's focus trap, inert, Esc capture | Drawer.tsx; TabsEditor.tsx has the mounted-only variant | yes; the sheet follows TabsEditor |
| `smoke.cjs` `C12_ROOTS` | line 76 | yes |
| FV (`flow-fv-card-source-tap`) | flows.cjs, checks the headline's bottom edge | yes; now the top edge |
| list projection: `_CARD_COLUMNS`, `_card_out`, For You's `_Row`, by-ids | `routes/entries.py`, `routes/foryou.py` | yes |
| `_clean_summary` | `routes/entries.py` | yes |

## What changed

The card is a Reddit post (D1): the feed's icon, name and "5h" on a 44px
header line, the title with its preview text (D34) and thumbnail, then one
action bar of six 44×44 buttons: ▲ ▼ (orange / blue when on, the card
stays, a second tap takes the vote back), a bookmark, Share, the Summary
chevron and ⋯. ⋯ opens a bottom sheet with Hide, Edit feed, Copy link and
Open in browser (and Cancel). A swipe left hides; a swipe right is dead.
Hide's Undo fully undoes it: the ranking's `never` is held on the device
until the toast closes without Undo (D25). Saving is silent; unsaving says
"Removed from Saved · Undo". No ✓, no eye, no vote or save toasts.

- `backend/app/routes/entries.py`: `card_preview(title, cached_summary,
  feed_summary)` (pure): the cached AI summary when it has text, else
  `meta.summary` cleaned with `_clean_summary`, with Reddit's
  "submitted by … [link] [comments]" trailer dropped (`_REDDIT_TRAILER_RE`),
  cut on a word boundary at 300 (`_PREVIEW_MAX_CHARS`) with "…"; None when
  empty or when it only repeats the title (letters and digits, lower-cased).
  `_CARD_COLUMNS` gains `meta->>'summary'` as `feed_summary_text`, which
  `_card_out` pops into `preview`. `list_entries`, its search and
  `/entries/by-ids` go through `_card_out`.
- `backend/app/routes/foryou.py`: the same column and `card_preview` in
  `_Row`.
- `backend/app/schemas.py`: `EntryListOut.preview: Optional[str] = None`.
  No column, no migration; old bundles ignore the field.
- `frontend/src/api.ts`: `Entry.preview?: string | null`.
- `frontend/src/components/ActionSheet.tsx` (new): `openActionSheet({title,
  actions, from})` and `<ActionSheetHost onOpenChange/>`. A
  `role="dialog" aria-modal aria-label="story actions"` bottom sheet,
  mounted only while open, 44px rows in an iOS grouped card (16px in from
  the edges, so C12 holds) and a Cancel row; the focus trap of TabsEditor;
  Esc in the capture phase, stopped; a tap on the backdrop closes;
  `overflow-y-auto overscroll-contain` body; motion-safe transitions; safe
  area bottom padding. Focus starts on Cancel. On close, focus returns to
  `from` (the ⋯ button, handed over by the Card because iOS gives a tapped
  button no focus) when it is still in the page; otherwise to the next
  card's headline, the previous one's, or the selected tab. The cards of
  the opener's list are noted at open time, so "next" is the first still in
  the page after the opener's place. When a row opened another sheet
  (Edit feed → Settings, which takes no focus itself and doesn't inert
  the page), nothing is focused: an open `[aria-modal]` dialog that
  isn't inert and doesn't hold `from` has the page, and focus must not
  land on a control under it.
- `frontend/src/components/Card.tsx`:
  - the header line above the title: `SourceIcon` (16px, from
    `sourceFaviconPath`), the feed button (still `edit feed <name>`, still
    `onSourceTap` until PR8a), "·", and `timeAgo` without "ago" ("now",
    "5m", "5h", "3d"); the "·" goes with an empty time;
  - the headline link holds the title and, under it, `[data-preview]`
    (`text-ios-body text-label-secondary line-clamp-2 md:line-clamp-3`),
    gone while the Summary panel is open; the thumbnail keeps its own
    `onOpen` → `onActivate`, so the three are one open target;
  - the action bar (`-ml-3 -mr-2`, 264px): ▲ ▼ (`aria-pressed`,
    `text-orange-500` / `text-indigo-400`, no toasts), the bookmark
    (`save` / `unsave`, `data-star`, `bookmark` recorded on a save only),
    Share (`data-card-share`, disabled unless `entry.url` is http(s);
    `navigator.share({title, url: entry.url})` called in the tap handler,
    `share` recorded when it resolves, nothing on a rejection; `copyUrl`
    without `navigator.share`), then `ml-auto`: the chevron (unchanged
    selector) and ⋯ (`more actions`, `data-card-more`, `aria-haspopup`);
  - `buildActions()` feeds both ⋯ and the right-click menu: Hide (when
    `onHide`), Edit feed (when `onSourceTap`), Copy link and Open in
    browser (both disabled for a non-http(s) address; Open in browser
    records the `click` and calls `onActivate`, as every other way out);
  - the swipe: left calls `onHide` (no `never` recorded in the Card any
    more), right clamped dead, the touchmove deps `[onHide]`;
  - removed: the eye button, `hidden`, `onHideToggle`, `commitHideToggle`,
    the vote toasts, the context menu's Save / Unsave / vote rows,
    `StarIcon`; `_cardPropsEqual` drops `hidden`; `voteInteractionEvents`
    is exported for App's `a` / `z`; `copyUrl`'s toasts read "Link copied"
    and "Couldn't copy the link"; the context menu's rows take
    `SheetAction` (disabled, destructive); `isHttpUrl`, `BookmarkIcon`,
    `ShareIcon`, `MoreIcon`; the two-state `EyeIcon` (open for the eye
    button, closed for the swipe reveal) is the one-state `EyeOffIcon`,
    since only the reveal draws it now.
- `frontend/src/components/Toast.tsx`: `onExpire`, run once when a toast
  goes without its action: its timer, or another toast replacing it
  (called from the listener and the timer, never from an effect's
  cleanup, which StrictMode runs twice). Undo marks the event `acted`.
- `frontend/src/lib/interactions.ts`: the held slot. `holdInteraction(ev)`
  → `{release, cancel}`; `onPageHide` and `flushNow` move held events to
  the front of the queue first (`queueHeld`); `heldCount()` for tests.
- `frontend/src/App.tsx`:
  - `actionSheetOpen` (from `ActionSheetHost`'s `onOpenChange`) joins
    `modalOpen`;
  - `hideStory(id)` (`useCallback`, slice 21): `hideEntry(id)`, then
    `holdInteraction({type: 'never'})` and the "Hidden · Undo" toast whose
    Undo cancels the hold and calls `restoreHiddenEntry`, and whose
    `onExpire` releases it;
  - `starStory(id)` (`useCallback`): `toggleStarEntry`, and on an unsave
    the "Removed from Saved · Undo" toast (Undo: `setStarred(id, true)`, an
    add);
  - `toggleHideEntry` deleted; the four "Entry hidden." closures and the
    five save toasts are gone: `onHide={hideStory}` / `onHideEntry` and
    `onStar={starStory}` / `onStarEntry` on SearchResults, the desktop For
    You row and both Columns;
  - `onKey` returns early while `modalOpen`; `b` → `starStory` (the
    `bookmark` recorded on a save, from `latestPrefs()`), `h` →
    `hideStory`, `a` / `z` vote on the selected card through
    `voteInteractionEvents` + `voteEntry`, all ignoring meta / ctrl / alt;
  - `<ActionSheetHost onOpenChange={setActionSheetOpen}/>` next to
    `ToastHost`.
- `frontend/src/components/Column.tsx` and `SearchResults.tsx`: `onHideToggle`
  and `hiddenSet` gone (Props, destructuring, `cardProps`, `CardList`, the
  memo comment and `_columnPropsEqual`).
- `frontend/src/components/ShortcutsSheet.tsx`: rows for `b`, `h`, `a`, `z`.
- `backend/tests/test_slice21_column_memo.py`: `hiddenSet` out; `hideStory`
  and `starStory` in HANDLERS. `test_slice30_safe_external_url.py`: "Open
  in browser". `backend/tests/test_entry_preview.py` (new).
- `frontend/scripts/iphone-audit/fixtures.cjs`: `preview` on every entry
  (`previewOf`, the server's rule), `preview: null` on 103.
- Flows, states and the README (below); `docs/DEVICE_CHECKS.md` (the unit's
  lines under Pending as `#<pr>`, Gate 2's two PR5a lines refined);
  `docs/ux-notes/PROGRESS.md`.

## Deviations from the spec

- **The preview's 300-character cut applies to the cached summary too.**
  The spec words the cut for the feed blurb path; D34 calls the preview "a
  short blurb … about 300 characters" whichever its source. The cached
  summary can be 800 characters, the card clamps it at 2-3 lines anyway,
  and the Summary arrow shows the full text, so the cut keeps every list
  row bounded. One line to change if the owner wants the whole summary in
  the field.
- **Reddit's trailer is dropped from self posts too**, not only detected on
  link posts: a self post's blurb otherwise ends with "submitted by /u/x
  [link] [comments]". A link post's blurb is only the trailer, so it is
  None, as specified. The detection doesn't look at the URL: a link post's
  `url` is the external site, not reddit.com.
- **Preview text size**: "body text" is read as `text-ios-body` (17px),
  the codebase's body size, in `text-label-secondary` with the normal
  weight (the title is medium). The tailwind config has only body and
  caption sizes; one class to change.
- **The sheet has a Cancel row** under the four action rows (iOS action
  sheets do; it is also where focus starts, as Drawer's starts on Done, so
  a Space that opened the sheet from ⋯ lifts on a harmless row). The spec
  counts four rows: the flow checks exactly four `[data-sheet-action]`
  rows and the smoke state five buttons.
- **Copy link and Open in browser are disabled for a non-http(s)
  address**, with Share (the spec disables Share only). A `javascript:`
  address is nothing to copy or open either.
- **Open in browser records the `click`** (`noteOpen`), where the old
  context-menu "Open in new tab" only called `noteStoryOpened` and
  `onActivate`: every way out of a card records it (PR3b).
- **Toast group `hide`**: `Toast.tsx` gains groups in PR5b, so `hideStory`
  passes none yet; the merged "2 hidden · Undo" is PR5b's.
- **`heldCount()`** was added to `interactions.ts` beside `pendingCount()`
  (tests only).
- `test_slice21`'s HANDLERS also gets `starStory` (the same kind of handler
  as `hideStory`; the spec names only `hideStory`).
- The `unmarkEntryRead` the spec deletes was already gone (PR3b).
- `copyUrl`'s toast reads "Link copied" (the spec's wording; it read "link
  copied").

## Tests

- pytest `test_entry_preview.py`: the pure rules (cached over blurb, an
  empty cached summary falls through, cleaning, the 300 cut on a word
  boundary for the blurb and the cached summary, title repeats with case /
  punctuation / tags, Reddit link post → None and self post → the OP text,
  nothing → None) and the endpoints (`/api/entries`, its search,
  `/api/entries/by-ids` in input order, `/api/foryou`; no `feed_summary_text`
  or `meta` in the response).
- Flows (`flows.cjs`): `flow-card-votes`, `flow-card-save`,
  `flow-card-share`, `flow-card-sheet`, `flow-hide-undo`,
  `flow-swipe-left-hide`, `flow-swipe-right-dead`, `flow-card-preview`
  (each described in the audit README; `flow-card-sheet` has a step the
  spec doesn't list: Edit feed opens that feed in Settings and the focus
  doesn't go back to the ⋯ under it). Changed: `flow-prefs-resync`
  (hides through the sheet), `flow-bookmark-on-save-desktop` (the
  bookmark, not the menu's Save), `flow-h1-desktop` ("Open in browser"),
  `flow-fv-card-source-tap` (the feed button above the headline's top
  edge), `flow-earlier-keys-fold` (the toast regex), and every
  `save for later` / `remove from saved` selector → `save` / `unsave`.
- Smoke: `card-action-sheet` (390, 320; `C12_ROOTS`), `card-preview-long`
  and `card-no-preview` (390, 320, 312). `dashboard` at 312 runs C7 on the
  bar. `card-summary`'s selector is unchanged.
- Helpers: `SHEET`, `sheetRow`, `openSheet`, `hideViaSheet`, `neversFor`,
  `eventsFor`, `undoButton`, `swipeCard`.

## Verification

Local loop on `stack-pr5a` on main 8516098, the frontend's `node_modules`
linked in, Postgres 16 database `popping_test_f`, `vite preview` on
127.0.0.1:4173 (pid file `preview-pr5a.pid`). Another lane shares the
4-CPU machine on 4175 / `popping_test`.

- Backend `pytest -q -ra` (full, because the projection changed): 1763
  passed, 13 failed; the 13 are exactly `/root/popping-env/baseline.txt`
  (no DNS in this container: example.com lookups and two network hook
  tests). `test_entry_preview.py`: 9 passed. `test_slice21_column_memo.py`
  and `test_slice30_safe_external_url.py`: 51 passed.
- `git diff --exit-code package.json package-lock.json`: clean.
- `npm run lint`: 0 errors, 6 warnings, all `react-refresh/only-export-
  components`. Four are main's (SourceIcon, Toast, preferences ×2); two
  are this unit's and the same pattern as Toast's `toast()`:
  `openActionSheet` next to `ActionSheetHost`, and `voteInteractionEvents`
  exported from Card.tsx for App's `a` / `z`. CI runs `eslint .` with no
  warnings cap.
- `npm run build`: ok. Unit tests (`node --experimental-strip-types
  --test 'scripts/unit/*.test.ts'`): 222 passed.
- The new states and flows alone (`--only card-action-sheet,
  card-preview-long,card-no-preview,flow-card-votes,flow-card-save,
  flow-card-share,flow-card-sheet,flow-hide-undo,flow-swipe-left-hide,
  flow-swipe-right-dead,flow-card-preview`, `--csp --strict`): 0 failures,
  0 warnings.
- Full `smoke.cjs --csp --strict` (every state and flow, Chromium): 0
  failures, 0 warnings, 528 s. Run again for the `flow-card-sheet` step
  added after it (Edit feed and the focus): 0 failures.
- Gesture and timing flows looped 5 times (`flow-swipe-left-hide`,
  `flow-swipe-right-dead`, `flow-hide-undo`, `flow-card-save`,
  `flow-card-votes`, one build): 5 of 5 runs 0 failures, 0 warnings.
- Lint, build and the unit tests run again on the final sources: the same
  0 errors / 6 warnings, built, 222 passed. A second full
  `smoke.cjs --csp --strict` on the final build: 0 failures, 0 warnings, 518 s.
- WebKit results come only from CI.

### Mutation checks (test → broken line → failing rule)

Each: break the line, run the one test (pytest) or `npm run build` and
`--only` that flow or state, confirm the failure, restore with
`git checkout` and `git diff --exit-code` (ActionSheet.tsx, edited after
the WIP commit, from a saved copy, compared with `cmp`).

| Test | Broken line | Failed on |
|---|---|---|
| `test_entry_preview.py` | the title-repeat rule in `card_preview` removed | `test_a_blurb_that_repeats_the_title_is_dropped` and the three endpoint tests (`bare` got a preview) |
| `test_entry_preview.py` | `_REDDIT_TRAILER_RE.sub` dropped | `test_reddit_link_post_trailer_is_dropped` |
| `test_entry_preview.py` | `_card_out` sets `preview = None` | `test_list_entries_carries_preview`, `test_search_and_by_ids_carry_preview` |
| `test_entry_preview.py` | `_PREVIEW_MAX_CHARS = 100000` | `test_cut_on_a_word_boundary_at_300` |
| `test_entry_preview.py` | For You's `_Row.preview = None` | `test_for_you_carries_preview` |
| `test_slice30_safe_external_url.py` | the sheet row labelled "Open in new tab" again | `test_card_uses_safe_external_url_for_entry_url` |
| `test_slice21_column_memo.py` | `hideStory` as a plain arrow, no `useCallback` | `test_app_handler_uses_usecallback[hideStory]`, `test_app_handler_not_naked_arrow[hideStory]` |
| `flow-card-sheet` | ActionSheet's `if (covered) return` (focus not returned under another dialog) removed | `SHEET: after Edit feed the focus went back to the card's ⋯ under Settings` |
| `flow-card-sheet` | App's `if (modalOpen) return` in `onKey` removed | `SHEET: \`/\` opened the search behind the sheet` (and the focus-trap steps, since `/` moved focus to the search field) |
| `flow-card-sheet` | that guard and the sheet's Esc `stopPropagation` both removed | the above and `SHEET: Esc on the sheet cleared the search: ""`, `Esc on the sheet took the search results away` |
| `flow-card-sheet` | the sheet's Esc `stopPropagation` alone removed | **no failure**: App's `onKey` returns on `modalOpen` before its Esc branch, so the capture-phase stop is defence in depth (kept, as the spec and Drawer / ShortcutsSheet have it); the `modalOpen` guard is the rule the flow pins (previous rows) |
| `flow-card-votes` | a `toast('Vote recorded')` after `onVote(next)` on ▲ | `VOTES: ▲ showed a toast: "Vote recorded"` |
| `flow-card-save` | `bookmark` recorded on every tap, not only a save | `SAVE: an unsave sent a bookmark (2 in all)` |
| `flow-card-share` | Share's `disabled={!canShare}` → `disabled={false}` | `SHARE: Share is enabled for a javascript: address` |
| `flow-hide-undo` | `hideStory` records `never` at once instead of `holdInteraction` | `HIDE-UNDO: Hide then Undo sent 1 never events` (and the two timing checks after it) |
| `flow-swipe-left-hide` | `SWIPE_COMMIT_PX = 1000` | `SWIPE-LEFT: a swipe left did not hide the story` |
| `flow-swipe-right-dead` | the `dx > 0` clamp dropped from the touchmove handler | `SWIPE-RIGHT: the card moved with a swipe right: ["translateX(27px)", …, "translateX(88px)"]` |
| `flow-card-preview` | the preview shown while the Summary panel is open (`entry.preview ?? null`) | `PREVIEW: the preview stays while the Summary panel is open` |
| `card-action-sheet` | the rows' `min-h-[44px]` → `min-h-[32px]` | `C7: tap target: height 32px < 43.5px` on "Hide" (8 per width) |
| `card-preview-long` | `line-clamp-2 md:line-clamp-3` removed | `PREVIEW: the line clamp is "none", expected 2` (and "more than 2 lines") at 390, 320 and 312 |
| `card-no-preview` | a stand-in preview when the server sent `null` | `PREVIEW: story 103 shows a preview although the server sent none` at every width |
| `flow-fv-card-source-tap` | the header line pulled 32px down over the headline (`-mb-8`) | `FV: the feed button is not above the headline` and the top-edge check |

## Open items for later units

- PR5b: `buildActions()` gains Hide stories from <feed>; `Toast.tsx` gains
  `group` / `count` and merges quick hides (each merged hide's hold is
  released when the merged toast expires, Undo cancels them all: the
  `holdInteraction` handles are what to keep per merged event);
  `hideStory`'s toast joins group `hide`, `starStory`'s group `save`.
- PR4c / PR4d rebase: `hideStory` calls `hideEntry` and the toast's Undo
  calls `restoreHiddenEntry`; PR4c's `keepHiddenStories` /
  `putBackHiddenStories` put-back belongs in those two, not in
  `hideStory`. `starStory` wraps `toggleStarEntry` the same way.
- PR8a: the feed button opens a one-feed view; Edit feed stays in ⋯ (D26).
- PR6b: a left swipe and a pull: the card's direction lock (dead zone,
  ratio) already lets a mostly vertical drag through; the pull's reducer
  should leave a horizontally locked touch alone.
- Known limit (D25, by the spec): the page hiding sends a held `never` at
  once, so a hide taken back after a return from another app has already
  reached the ranking. Restore from Activity removing the signal stays
  deferred (D19).
- `ARCHITECTURE.md`: no change. The held slot is browser memory; the
  preview is computed per request, nothing stored.

## Data compatibility and rollback

- No new key, no new column. `preview` is an additive response field;
  old bundles ignore it, and a bundle on an older server shows no preview
  (`entry.preview` undefined).
- Hides and unsaves go through PR2b's `addIds` / `removeIds` as before.
- Revert brings back the eye and the immediate `never` (which old builds
  sent anyway). As a git revert PR5a stands alone until PR5b merges.
