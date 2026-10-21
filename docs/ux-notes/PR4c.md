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
    An unsave drops the id from the cache and the negative cache, and a
    response that lands after an unsave isn't kept.
  - Each save is drawn from the tabs' copy (the freshest), else the
    cache, else the copy drawn last time, so a save a poll just dropped
    doesn't blink out while its fetch is out. Hidden saves stay out
    (hide wins), and so do stories of a feed no longer in `sources` (the
    server deletes a feed's stories with it, and the tabs already drop
    them). While the same stories are drawn the same array comes back,
    so a poll that changed nothing in Saved doesn't redraw it.
  - **Hide Undo:** a hide (`hideEntry`, `toggleHideEntry`) keeps the
    story and its index in `entries` and in `forYou`
    (`hiddenStoriesRef`, the latest 100). The Undo (`restoreHiddenEntry`,
    and `toggleHideEntry`'s unhide) puts it back there with `reinsert`.
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
  a `phoneIds(page)` helper.
- `frontend/scripts/iphone-audit/README.md`: the three flows and the
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
- **Keep set.** `starredEntries` has been in the keep set since PR3b,
  and the by-id cache only ever holds saved ids (an unsave drops the
  id), so adding the cache changes nothing today; it is there as the
  spec asks, so the rule holds if the cache ever outlives a save.
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
no failing test when removed: the saves are in the keep set anyway
(Deviations).

## Risks and data-compatibility notes

- Revert is safe: Saved falls back to the stories the tabs loaded, by
  date. Nothing new is stored; `starred_entries` keeps its shape.
- Undo on an unsave ("Removed from Saved · Undo") saves the story again,
  which appends it: it comes back at the top of Saved, not at its old
  place. Putting it back in place would need a whole-list write of a set
  key, which PR2b removed.
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

- Open Menu → Settings → Saved and note the stories it lists, then close Settings and open the Saved tab. Pass: the tab lists the same stories, each with its picture where it has one, including ones older than anything in the other tabs.
- Save one story, then another, then open Saved. Pass: the second one is at the top, the first right under it.
- In Saved, tap the bookmark on a story to remove it, then force-quit and reopen the app. Pass: it is gone from Saved and stays gone.
- On For You, hide a story and tap Undo on the toast, then open that story's category tab. Pass: the story is back in For You and in its tab.
- (If you have a desktop) On the laptop, search for an older story the phone's tabs don't show and save it, then wait a minute with Popping open on the phone. Pass: it shows at the top of Saved on the phone, with its picture.
