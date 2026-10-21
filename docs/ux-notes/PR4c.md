# PR4c: Saved by id (frontend track)

Stacked on PR3b (`claude/ux-pr3b`, #45, in its re-check), built as if it
were merged. PR4b (#31, merged) provides the by-ids projection. PR3c
(seen on scroll) is being built at the same time in another worktree and
lands between PR3b and this unit; nothing here touches seen-on-scroll
code, and the App.tsx changes stay inside Saved, the hide Undo and the
keep set.

## What changed

Saved now lists every save, newest save first, whatever the tabs loaded
(D5). A save the tabs don't hold (an old story, or one saved on another
device) is fetched by id, with its picture, instead of being missing.
Undo on a hide puts the story back everywhere, even after a poll dropped
it.

- `frontend/src/lib/saved.ts` (new, pure, no imports):
  - `savedStories(starred, find, isRemoved)`: the saves to draw, newest
    save first. `starred_entries` holds the saves in the order they were
    made (a save appends its id, on the client in `applyIdDelta` and on
    the server's PATCH), so Saved walks it from the end. A save with no
    copy yet is left out until its fetch lands; `isRemoved` keeps "hide
    wins over saved".
  - `savedToFetch(starred, skip)`: the ids to fetch, newest save first,
    so the first chunk of 200 is the top of Saved.
  - `reinsert(list, item, at)`: a hidden story back at its place, or the
    same list when a poll already brought it back.
- `frontend/src/lib/feedOrder.ts`: `keepSet(...groups)`, the keep set a
  `seen:` key is pruned against, built from stories or bare ids.
- `frontend/src/App.tsx`:
  - **Saved** (replaces `visibleStarred`'s `entries.filter`): `savedById`
    (state) is the by-id cache. An effect fetches, with
    `api.entriesByIds` (200 per call, chunked), only the saves that the
    tabs (`entries`, `forYou`) and the cache don't hold, that aren't
    hidden, that the server didn't already fail to return and that
    aren't already being fetched. It runs once the preferences have
    answered and the first refresh is done, so a save the tabs bring is
    never fetched too, and again whenever the saves or the tabs' stories
    change: a save made on another device arrives through PR2b's resync
    (`starredEntries` changes) and is fetched; a save a poll stops
    returning is fetched then. Ids the server no longer returns go into
    `savedGoneRef` (the negative cache), so no poll asks for them again.
    An unsave drops the id from the negative cache but keeps the story
    in the by-id cache (review fix), so the unsave's Undo draws it again
    at once, with no request and offline too; a response that lands
    after an unsave is kept the same way. Saved draws only saved ids, so
    a cached unsaved story isn't drawn. The cache is bounded lazily:
    once it holds more than `MAX_STARRED` (1000, the saves' own cap)
    stories, the unsaved ones leave it.
  - Each save is drawn from the tabs' copy (the freshest), else the
    cache, else the copy drawn last time, so a save a poll just dropped
    doesn't blink out while its fetch is out. Hidden saves stay out
    (hide wins), and so do stories of a feed no longer in `sources` (the
    server deletes a feed's stories with it, and the tabs already drop
    them). While the same stories are drawn the same array comes back,
    so a poll that changed nothing in Saved doesn't redraw it.
  - **Hide Undo:** every hide (`hideEntries`; `hideEntry` and
    `toggleHideEntry` for one story, Settings › Voted's "Hide all
    downvoted" for many) keeps each story and its index in `entries`
    and in `forYou` (`keepHiddenStories`, `hiddenStoriesRef`: the latest
    `KEPT_HIDDEN` = 100, and never fewer than the hide's own, so a bulk
    hide keeps all of its stories and pushes out none of the 100 before
    it). Every Undo (`restoreHiddenEntries`; `restoreHiddenEntry`,
    `toggleHideEntry`'s unhide, Settings' Hidden list, and the bulk
    hide's Undo) puts them back there with `reinsertAll` (each at its
    own index, lowest first).
    For two minutes (`SOURCE_CHANGE_TTL_MS`, the same window
    `sourceChangesRef` uses for feeds) `refresh` lays a put-back story
    over a poll that doesn't return it yet (the server answered before
    the Undo's change, sent in a 1 s batch, reached it), until a poll
    returns it, it is hidden again or its feed is deleted
    (`restoredRef`). A story only Saved holds needs nothing kept: the
    by-id cache still has it.
  - **Keep set:** `keepIds` is `keepSet(entries, forYou, starredEntries,
    savedById.keys())`.
  - `byNewest` is no longer imported (Saved isn't sorted by date).
- `frontend/src/lib/sorting.ts`: the header comment says Saved lists
  saves newest save first.
- `frontend/scripts/iphone-audit/capture.cjs`:
  - `GET /api/entries/by-ids` mirrors the real route: at most 200 valid
    ids, in the order asked, ids with no row or whose feed is gone
    dropped, and each row the card projection (`_CARD_COLUMNS`, never
    `meta`) plus `source_name` (`byIdRow`).
  - `GET /api/entries` (without `q`) and `GET /api/foryou` leave out the
    store's `hidden_entries`, as the server has since PR4b.
- `frontend/scripts/iphone-audit/flows.cjs`: `flow-saved-by-id` and
  `flow-hide-undo-after-poll` (new), `flow-saved-order` (rewritten), and
  a `phoneIds(page)` helper; with the review fixes also
  `flow-saved-drops-hidden-and-deleted`, `flow-hide-all-downvoted-undo`
  and a `keepOutOfTabs(page, ids)` helper.
- `frontend/scripts/iphone-audit/README.md`: the flows and the
  mock's by-ids and hidden rules.

## Deviations from the spec

- **Saved's order.** PR1c's `flow-saved-order` pinned Saved by
  `byNewest` (published, else fetched). The spec says "newest save
  first", so Saved now follows the save order and the flow is rewritten
  to pin that (saved as 103, 105, 111, 101 it reads 101, 111, 105, 103;
  by date it would read 101, 103, 105, 111). The spec doesn't name this
  flow; it is named here as the rules ask.
- **Hide Undo.** The spec says the Undo "re-inserts the cached Entry".
  PR3b's snapshot cache already redraws a hidden story in its tab after
  the Undo, but only in a tab that is drawn and only until its next
  snapshot; For You, the other tabs the story belongs to and Saved build
  from `entries` / `forYou`. So the hide keeps its own copy and the
  Undo puts it back into those lists. Beyond the spec, a put-back story
  is also laid over polls for two minutes, as feeds are: a poll sent
  between the Undo and its PATCH (a 1 s batch) would otherwise drop the
  story again until the next poll.
- **Keep set.** `starredEntries` has been in the keep set since PR3b.
  Since the review fixes the by-id cache also holds recently unsaved
  stories (bounded at 1000), so the cache in the keep set now also keeps
  those stories' seen marks from being pruned first while they may
  still come back through an Undo.
- **Mock fidelity.** The spec asks only for the by-ids projection. The
  mock now also leaves hidden stories out of `/api/entries` and
  `/api/foryou`, which the server has done since PR4b; without it no
  flow could reproduce the poll that drops a hidden story.
- **New pure lib.** `lib/saved.ts` isn't in the Rules' list of new pure
  libs; it follows the same rules (no imports, runs under strip-types),
  and `scripts/unit/saved.test.ts` tests it.
- `ARCHITECTURE.md` is about the backend's process-local state; the
  by-id cache is per page, so it isn't listed there.

## Tests

- **Unit** (`node --experimental-strip-types --test`):
  - `feedOrder.test.ts`: `keepSet` (stories and bare ids, each once) and
    the spec's keep-set case: `seen:news` one over its cap, with an old
    save (id 3) held only by the Saved-by-id cache: `pruneIds` drops the
    smallest mark outside the keep set (5) and keeps 3; without the
    cache in the keep set, 3 would go first.
  - `saved.test.ts` (new): newest save first; a save with no copy left
    out; hide wins; an id stored twice drawn once; `savedToFetch` order
    and skip; `reinsert` at its place, clamped, the input unchanged, and
    the same list when the story is already there.
- **Flows:**
  - `flow-saved-by-id`: 503 and 402 never reach a tab (the page's fetch
    drops them). Saved lists 105, 503, 103 with 503's thumbnail loaded,
    from one by-ids request for `999999,503` (the saves no tab holds,
    newest first; 999999 has no row). A save from another device (seeded
    in the store, then a return to the front) shows at the top after one
    request for `402` alone; an unsave takes 503 out; after two more
    polls, 999999 was never asked for again.
  - `flow-hide-undo-after-poll`: hide 101 on For You, a poll without it,
    Undo, a poll sent at once (before the Undo's 1 s batch, so the
    server still leaves 101 out), then News: 101 is there, and the
    store loses the hide.
  - `flow-saved-order`: newest save first (above).

## Verification

- `npm run lint`: 0 errors (the base's 4 warnings, none in files this
  unit touches). `npm run build` passes. Unit tests: 202 of 202 (PR3b's
  193 plus 9).
- `git diff --exit-code package.json package-lock.json`: clean.
- Backend pytest, the tests that pin frontend source plus
  `test_entries_by_ids_projection.py` (11 files): 214 passed.
- Full backend pytest on `popping_test`: 1712 passed and 13 failed. The
  13 are exactly the DNS-only baseline list
  (`/root/popping-env/baseline.txt`).
- Full strict smoke (`--csp --strict`, CI fonts, port 4175) on the final
  build: 173 states and flows, 0 failures, 0 warnings (457 s, with the
  other units' smoke running on the same container). An earlier full run
  on the build before the last change (Saved's array reused while
  unchanged) had one failure in `flow-fl-rename-keeps-filter-and-view`
  ("the field shows \"Slickdeals Renamed\"": the value it expected, read
  a moment later), a feed-editor flow this unit doesn't touch; it passed
  on its own straight after, and in the final full run.
- Screenshot looked at (not committed): `390-flow-saved-by-id-saved`.
  Saved reads 105, 503, 103; 503, which no tab holds, is a full card with
  its thumbnail, feed name and time.

### Mutation checks (test → broken line → failing rule)

Each was a scratch edit, then a rebuild, `--only` on the flows (or the
unit file), a restore from a backup copy and a byte compare (`cmp`).

| Test | Broken line | Fails on |
|---|---|---|
| `flow-saved-by-id` | the by-id effect never fetches (`want.length >= 0`) | SAVED-BY-ID: "Saved shows 105,103, expected 105,503,103" |
| `flow-saved-by-id` | the negative cache never filled (`savedGoneRef.current.add` dropped) | SAVED-BY-ID x3: by-ids asked for `["999999,503","999999"]`, then 999999 again on every poll |
| `flow-saved-by-id` | the by-id cache not counted as held (`savedById.has(id)` → `false`) | SAVED-BY-ID x3: 503 asked for again on every render |
| `flow-saved-order`, `flow-saved-by-id` | `savedStories` walks the saves oldest first | SAVED-ORDER: "103,105,111,101, expected 101,111,105,103"; SAVED-BY-ID: "103,503,105" |
| `flow-hide-undo-after-poll` | `restoreHiddenEntry` doesn't put the story back | HIDE-UNDO: "News shows 102,…,112, without 101" (For You still drew it from its snapshot, as PR3b intends) |
| `flow-hide-undo-after-poll` | `refresh` doesn't lay the put-back story over the poll | HIDE-UNDO: "News shows 102,…,112, without 101" |
| `feedOrder.test.ts` | `keepSet` reads only its first two groups | both `keepSet` cases |
| `saved.test.ts` | `savedStories` ignores `isRemoved` | "hide wins over saved" |

The keep-set wiring in App (`savedById.keys()` passed to `keepSet`) has
no failing test when removed: no flow fills a `seen:` key past its cap
of 1000 marks.

## Review fixes (second commit, "PR4c: review fixes")

Review step: /code-review medium. Five findings, four distinct (two
reported the same bulk-hide gap); all fixed, none skipped.

1. **An unsave dropped the story from the by-id cache**, so its Undo
   had to fetch it again and drew nothing offline. The by-id effect no
   longer evicts on an unsave: Saved draws only saved ids
   (`savedStories` walks `starredEntries`), so a cached unsaved story is
   never drawn. The cache is bounded lazily instead: past `MAX_STARRED`
   (1000) stories the unsaved ones go. A by-id response that lands after
   an unsave is kept the same way (it was dropped before), and the
   effect no longer reads `latestPrefs`.
2. **"Hide all downvoted" (Settings › Voted) didn't keep or put back
   its stories** (two findings). `keepHiddenStory` /
   `putBackHiddenStory` became `keepHiddenStories` /
   `putBackHiddenStories` (lists), behind `hideEntries` /
   `restoreHiddenEntries`; `hideEntry`, `restoreHiddenEntry` and
   `toggleHideEntry` call them with one id, and the bulk hide and its
   Undo with `added`. The keep cap is `KEPT_HIDDEN` (100) plus the
   hide's own count, so a bulk hide keeps all of its stories and pushes
   out none of the 100 kept before it (the toast is a single slot, so
   only Settings' Hidden list could still restore those). Stories put
   back together go in with the new pure `reinsertAll` (lowest index
   first, so each lands at its own place); `refresh`'s lay-over of
   put-back stories uses it too.
3. **The first device check failed falsely when a save is also
   hidden**: Settings › Saved lists hidden saves, the Saved tab doesn't
   (hide wins). The line in `docs/DEVICE_CHECKS.md` (and below) now
   excepts "any you also hid".
4. **No test guarded App's Saved filter** (hide wins over saved; a
   deleted feed's saves leave). New flow
   `flow-saved-drops-hidden-and-deleted`.

### Tests added or changed

- `flow-saved-by-id`: after the unsave of 503 (held only by the by-id
  cache), by-ids is made to fail (`route.abort`), Undo is tapped, and
  Saved must show 503 again with no new by-ids request; then 503 is
  unsaved again and the old poll checks run. The Undo's place is
  either the top or 503's old place (whether the unsave was sent before
  the Undo; Risks), so the flow accepts both.
- `flow-saved-drops-hidden-and-deleted` (new): saves 103, 105 and 503
  (503 kept out of the tabs by the page's fetch, as in
  `flow-saved-by-id`; the helper is now `keepOutOfTabs`). Hiding 105
  from its card in Saved takes it out before and after a poll; deleting
  feed 14 in the store (another device) takes 503 out after the next
  poll.
- `flow-hide-all-downvoted-undo` (new): Settings › Voted with 101 and
  103 downvoted, Hide all downvoted, a poll without them, Undo, a poll
  before the Undo's batch, then News shows 101 and 103 and the store
  loses both hides.
- `saved.test.ts`: `reinsertAll` (any input order, one already back,
  nothing to do, input unchanged).

### Mutation checks (review fixes)

| Test | Broken line | Fails on |
|---|---|---|
| `flow-saved-by-id` | the old eviction (`savedById.size > MAX_STARRED &&` dropped) | SAVED-BY-ID: "offline, after the unsave's Undo Saved shows 402,105,103"; "the unsave's Undo asked by-ids again: [\"999999,503\",\"402\",\"503\"]" |
| `flow-hide-all-downvoted-undo` | the bulk Undo only `removeIds` (no put-back) | HIDE-ALL-UNDO: "News shows 102,104,…,112, without 101 and 103" |
| `flow-hide-all-downvoted-undo` | the bulk hide only `addIds` (nothing kept) | the same |
| `flow-saved-drops-hidden-and-deleted` | `visibleStarred`'s `hiddenSet.has(e.id)` → `false` | SAVED-DROPS: "after hiding 105 Saved shows 503,105,103", and the same after the poll |
| `flow-saved-drops-hidden-and-deleted` | the `sourcesById` clause dropped | SAVED-DROPS: "after its feed was deleted Saved shows 503,103" |
| `saved.test.ts` | `reinsertAll` without its sort | "reinsertAll: stories put back together each land at their own place" |

Each was a scratch edit, a rebuild, `--only` on the flow (or the unit
file), then a restore from a copy and `cmp`. The `+ added` in the keep
cap has no failing test: no flow hides more than 100 stories.

### Verification (review fixes)

- `npm run lint`: 0 errors (the base's 4 warnings). `npm run build`
  passes. Unit tests: 203 of 203 (202 plus `reinsertAll`).
- `git diff --exit-code package.json package-lock.json`: clean.
- Backend pytest, the 10 files that read frontend source plus
  `test_entries_by_ids_projection.py`: 187 passed and 2 failed, both
  in the DNS-only baseline list
  (`test_reserved_category_names.py`, `/root/popping-env/baseline.txt`).
  No backend file changed.
- The five Saved and hide flows (`flow-saved-by-id`,
  `flow-saved-drops-hidden-and-deleted`, `flow-hide-all-downvoted-undo`,
  `flow-hide-undo-after-poll`, `flow-saved-order`): 0 failures, and the
  four timing ones looped 5 times, 0 failures each.
- Full strict smoke (`--csp --strict`, CI fonts) on the final build: 175
  states and flows, 0 failures, 0 warnings (539 s). It ran on port 4176:
  port 4175 was taken by a review agent's leftover `vite preview` of a
  scratch copy (its mutated build), which this session didn't start and
  left running.

## Risks and data-compatibility notes

- Revert is safe: Saved falls back to the stories the tabs loaded, by
  date. Nothing new is stored; `starred_entries` keeps its shape.
- Undo on an unsave ("Removed from Saved · Undo") saves the story again.
  If the unsave was already sent (a 1 s batch), the save appends it and
  it comes back at the top of Saved; if not, the two cancel out and it
  stays in its old place. Putting it back in place every time would need
  a whole-list write of a set key, which PR2b removed.
- A device with many old saves no tab holds fetches them once per load,
  200 per request (1000 saves at most, the key's cap: 5 requests).
- Saved stories fetched by id keep the copy fetched (score, comment
  count, cached summary) until the next load, unless a tab brings the
  story again.

## Open items for later units

- PR4d: the keep set also takes every `extraByTab` row (`keepSet` takes
  any number of groups). With the 2-day window, most saves will come
  from the by-id cache; `flow-saved-by-id` must stay green with the
  window on.
- PR5a: Hide moves to the action sheet and swipe; its Undo should keep
  calling `restoreHiddenEntry` (or `putBackHiddenStory`) so the story
  comes back after a poll. PR5a's held `never` signal (D25) is separate.
- PR8a: a custom tab built from `entries` gets put-back stories the same
  way.

## Device checks

Added under Pending in `docs/DEVICE_CHECKS.md` (`#<pr>` until the PR has
a number):

- Open Menu → Settings → Saved and note the stories it lists, then close Settings and open the Saved tab. Pass: the tab lists the same stories, except any you also hid, each with its picture where it has one, including ones older than anything in the other tabs.
- Save one story, then another, then open Saved. Pass: the second one is at the top, the first right under it.
- In Saved, tap the bookmark on a story to remove it, then force-quit and reopen the app. Pass: it is gone from Saved and stays gone.
- On For You, hide a story and tap Undo on the toast, then open that story's category tab. Pass: the story is back in For You and in its tab.
- (If you have a desktop) On the laptop, search for an older story the phone's tabs don't show and save it, then wait a minute with Popping open on the phone. Pass: it shows at the top of Saved on the phone, with its picture.
