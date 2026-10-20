# PR2b: prefSync client and sync rules (frontend track)

Saves, hides, votes and read marks go to the server as changes (PATCH
`add` / `remove`, or `set` for votes), not as whole lists, so two devices,
or two taps in one tick, never undo each other's. The app re-reads the
preferences on every poll (`?since=`) and on every return to the front (a
full GET), so something saved on the laptop shows on the phone within a
minute. Leaving the app sends what is still queued with `keepalive`.

From this build on, no code path PUTs `starred_entries`, `hidden_entries`,
`voted_entries`, `read_entries:*` or `seen:*`. That is PR2c's condition:
once both devices run this build, the server can refuse those PUTs.

## Plan (written before the code)

The unit was planned first (plan mode's stand-in: this section, written
before any code). It was started by one session, which stopped at the
org's spend limit after the plan, `lib/prefSync.ts` with its unit tests,
and the provider, `api.ts` and App changes; it was partway through
`capture.cjs` and the flows. A second session reviewed that work against
the spec, kept it, fixed what is listed under "Review of the earlier
work", finished the flows, and ran the local loop and the mutation checks.

- The sync rules go in `lib/prefSync.ts` as an engine with every effect
  injected (requests, clock, timers, visibility, a change callback), so
  every rule runs under `node --experimental-strip-types --test`.
  `preferences.tsx` is the React glue: one engine per provider, `state`
  decoded from the engine's rows with references kept, and the DOM
  listeners.
- The engine keeps, per key: `base` (the server's value last adopted, from
  a GET or a write's answer), the writes on the way (`flights`) and one
  folded queued write. What the screen shows is
  `base ⊕ flights ⊕ queued`, recomputed per key, with the old reference
  kept when the value is equal. One request counter orders sends, settles
  and GETs (sync rule 5 without clocks).
- App's handlers move to `addIds` / `removeIds` / `setVotes`, each Undo is
  the explicit inverse of what its action did, and handlers that decide on
  the current set read `prefs.latest()` instead of refs mirrored in
  effects.
- `capture.cjs` gets PATCH (as the server applies it), fault hooks, and a
  report of any whole-list PUT of a set key, which a new smoke rule (C17)
  fails in every state and flow.

## What changed

- `frontend/src/lib/prefSync.ts` (new, pure, no imports):
  - Keys and caps: `isSetKey`, `isVoteKey`, `capFor`; `MAX_HIDDEN` 1000,
    `MAX_STARRED` 1000, `MAX_VOTED` 2000 and the new `MAX_READ_PER_KEY`
    1000 (`read_entries:*` and `seen:*`), equal to the server's
    `SET_KEY_CAPS`. The caps moved here from `preferences.tsx`; App no
    longer imports any.
  - Values and changes: `coerceIds` / `coerceVotes` (the server's coercion,
    the same reference when already clean), `normalizeValue`, `sameValue`,
    `diffIds`, `foldDelta` (later op per id wins), `applyIdDelta` (remove,
    then add, new ids last), `applyVoteDelta`, `pruneIds(ids, keep, cap)`
    (ids outside `keep` first, then the smallest; returns `dropped`),
    `applyWrites`, `mergeIncoming(prev, rows, pending, {full})`,
    `stampMicros` / `laterStamp` (the `updated_at` string compared in
    microseconds), `classifyWriteError`, `legacySeedPlan`, and from the
    review fixes `foldWrite`, `splitDelta` (one PATCH's worth) and
    `overridden` (what an earlier request that landed late undid).
  - `createPrefSync(deps)`: `addIds(key, ids, keep?)`, `removeIds`,
    `setVotes`, `put` and `delete` (both throw for a set key), `resync`,
    `leave`, `resume`, `flushPending`, `discardPending`,
    `registerBeforeFlush`, `rows()`.
- `frontend/src/lib/preferences.tsx`:
  - The provider holds one engine. `state` is decoded from its rows by
    `decodeState`, which reuses each part (a per-column map, a list) whose
    rows didn't change, so a resync that brings nothing re-renders nothing.
  - New context fields: `addIds`, `removeIds`, `setVotes`, `latest`,
    `resync`, `registerBeforeFlush`, `discardPending`. Gone:
    `setReadEntries`, `setHiddenEntries`, `setStarredEntries`,
    `setEntryVote`, the `MAX_*` exports and `MAX_PER_COLUMN`.
    `flushPending` keeps PR1r's contract. `loaded` now also turns true on a
    later full GET when the first one failed (PR1b's open item).
  - Listeners: `visibilitychange: hidden`, `pagehide` and `beforeunload`
    call `leave()`; `visibilitychange: visible` calls `resume()`.
  - The localStorage seed no longer writes at mount. The legacy values are
    read once; after the first full GET that succeeds, set keys go through
    `addIds` (only the ids the server lacks) and other keys are PUT only
    where the server has no row. The legacy keys are removed and the seed
    flag set only then, so a failed GET keeps them for the next launch.
  - Toasts: "Couldn't save your latest changes to Popping. They'll be lost
    when the app reloads." once retries are used up (unchanged text), and
    "Couldn't save that change. Reload Popping to try again." when the
    server refuses one; at most one per 30 s.
- `frontend/src/api.ts`: `patchPreference(key, delta, {keepalive})` (empty
  lists are left out of the body), `getPreferences(since?, signal?)`, and
  `keepalive` on `setPreference` and `deletePreference`.
- `frontend/src/App.tsx`:
  - `hideEntry`, `restoreHiddenEntry`, `toggleHideEntry`, `toggleStarEntry`
    (now over `setStarred(id, on)`), `markEntryRead`, `unmarkEntryRead`,
    `markColumnRead`, `unmarkColumnRead`, `toggleEntryRead`, the votes
    (`voteEntry`), Hide all downvoted, the Settings closures
    (`onRestoreHidden`, `onRestoreAllHidden`, `onUnstarAll` and its Undo,
    `onUnstarEntry`) and every Undo use the new calls.
  - `toggleStarEntry` returns whether the story was saved, read from
    `latestPrefs()`, and the five save sites use that for the toast and
    the Undo (`setStarred(id, wasStarred)`), so the Undo puts back exactly
    what the toggle changed.
  - The set-key aliases, the three set-key refs and their effects,
    `MAX_PER_COLUMN` and every App-side slice are gone.
  - `refresh()` calls `prefs.resync()`; the visibility handler calls
    `prefs.resync({ full: true })` on return; `resetLocalState` awaits
    `prefs.discardPending()` before its DELETEs, then reloads.
- `frontend/scripts/iphone-audit/capture.cjs`: PATCH on the preference
  store in the server's order (the body's shape as
  `UserPreferencePatchIn` checks it, 422; a key that isn't a set key, 400;
  `set` on an id list or `add` / `remove` on votes, 422; a list over the
  key's cap, 422; then `remove` before `add`, `null` clears a vote, the
  stored value coerced and trimmed smallest id first). `prefMock(context)`
  gives flows the store (`seed`, `value`, `keys`, `fail(status, {method,
  key, times})`, `faultsLeft`). `onSetKeyPut` reports every PUT of a set
  key.
- `frontend/scripts/iphone-audit/smoke.cjs`: rule C17 (no whole-list PUT of
  a set key) in every state and flow.
- `frontend/scripts/iphone-audit/flows.cjs`: new flows, `putPrefs` seeds
  the store directly, `prefWrites` records PATCH bodies, and the flows that
  answered `GET /api/preferences` with a fixed body seed the store instead
  (a fixed body would come back on every poll and return, which now
  re-read the preferences).
- `backend/tests/test_preferences_delta.py`: the caps pin reads
  `prefSync.ts` and pins `MAX_READ_PER_KEY` for `read_entries:*` and
  `seen:*`.
- `frontend/scripts/iphone-audit/README.md`: C17, the new flows and
  helpers, the mock's PATCH.

### Sync rules as built

1. At most one write in flight per key, PATCH and PUT alike. A queued
   write for a busy key goes in the first batch after the ack. Leaving the
   page is the exception (see Leaving): the earlier request is then kept
   as stale and its answer checked.
2. No answer, a 5xx, 404, 405, 408 or 429: the write is folded back ahead
   of the queued one (`foldDelta`; a PUT is dropped when a newer value is
   queued) and stays on screen. Retries go 2, 4 and 8 s after each
   failure; a key waiting on its retry timer is left out of batches. Once
   they are used up, one toast for the round; the write stays queued, and
   a later batch for the key, a return to the front, the reload flush or
   the leave flush sends it again (a return starts a new round of
   retries). Failures after the toast don't toast again until a new round.
3. 400, 409, 422 and any other 4xx: the write is dropped, the screen falls
   back to the server's value plus what is still pending, the next resync
   is full, and a toast says so. The key's round of retries ends.
4. A write with no answer 30 s after it was sent (`Date.now`), or, once
   the page is back in front, one sent before it last hid or while it was
   hidden, is given up on: it stops blocking its key, its late answer is
   ignored, and it is not sent again. The next resync is full, and the
   first answer about the key after that (that GET, or a later write's
   answer) is adopted as it is. Until then the change stays on screen, so
   a save doesn't flicker off and back on when the page returns. Not
   sending it again is the point: it may have landed, and another device
   may have changed the same story since (a laptop's unsave), which a
   second send would undo.
5. A GET's row is ignored for a key that has a write on the way, or one
   that settled after the GET was sent (request numbers, not clocks). A
   queued write is re-applied on top of the row rather than ignoring it.
   PUT keys are covered the same way.
6. `mergeIncoming(prev, rows, pending, {full})`: full mode deletes a key
   missing from the response unless it is skipped or a pending write
   keeps it; since mode leaves missing keys alone; an empty list or object
   is a value; equal values keep their reference, and with nothing
   changed `prev` itself comes back.
7. One GET at a time. A poll during any GET, or within 1 s of the last
   GET being sent, is answered by it; a full request during a since GET
   runs right after it. Hiding the page aborts the GET on the way; a GET
   gives up after 20 s.
8. The watermark is the newest `updated_at` string seen in GET responses,
   never in PATCH or PUT answers. Polls send `since = watermark − 60 s`.
   No watermark yet, no successful full GET yet, or a refused write makes
   the resync full.
9. `discardPending()` clears the queue, the batch and retry timers and the
   GET, ignores what the writes on the way answer, waits for them for at
   most 3 s (`DISCARD_WAIT_MS`, like PR1r's `FLUSH_CAP_MS`; one rule 4
   has given up on isn't waited for), and from then on sends nothing, not
   even from the leave flush or a write made meanwhile. Reset calls it
   before its DELETEs and reloads after. The wait is capped because an
   iOS fetch may never settle: uncapped, one stuck write left Reset doing
   nothing while every later change stayed unsent. A write that lands
   after the DELETEs can at worst put back a few read marks or one tab's
   setting.

- Batches: set keys in a fixed 1 s batch, the others (PUT or DELETE) in a
  fixed 250 ms batch; neither is a debounce.
- Bodies within the server's limits: a PATCH carries at most the key's
  cap per list (1000 ids, 2000 votes), which is what
  `UserPreferencePatchIn` and the route allow. Before a change goes, a
  remove (or a cleared vote) of an id that is neither in base nor added by
  a write sent since base was last set is dropped: that id was added and
  taken back, or pruned, before it ever reached the server. A change still
  over the cap (a long failing stretch) goes in parts, one after the other
  under rule 1: removes and cleared votes first, adds last, so the server's
  trim after each part ends where one PATCH would. The rest stays queued.
- Leaving (`visibilitychange: hidden`, `pagehide`, `beforeunload`): every
  `registerBeforeFlush` function runs, then every queued key goes at once
  with `keepalive`, one key per request (a change over the cap sends its
  first part; the rest goes on the return). A key with a write still on
  the way sends that change again folded with the queued one: the page may
  not come back to send it after the answer. The earlier request is kept
  as stale: its answer never sets base, and if it comes after the
  keepalive request's answer and its row shows it undid part of that
  request (an Undo just before the hide), that part goes again, at once
  with `keepalive` while the page is hidden. When it answers first, it
  most likely landed first, and nothing more goes. (Not by `updated_at`,
  which is the transaction start, not the lock order.)
- Back in front: the provider's `resume()` gives up on writes sent before
  or during the hide (rule 4) and sends everything queued; App asks for
  the full resync.
- `flushPending()` (PR1r's reload): runs the before-flush functions, sends
  each queued key (a busy key after its ack, a change over the cap part by
  part), waits, doesn't send again a write it sent that failed, and
  returns whether nothing is left to retry.
- Pruning: `addIds` prunes against what is shown with `pruneIds` (the
  added ids and `keep` are kept unless they alone pass the cap) and sends
  the dropped ids it held in the same PATCH's `remove`. `setVotes` clears
  the smallest other ids past `MAX_VOTED` as `null` in the same PATCH.

## Review of the earlier work

The second session read the WIP against the spec and `routes/preferences.py`
and kept it. Fixed:

- A refused write (rule 3) left the key's retry count where it was, so the
  next failure on that key waited 4 or 8 s instead of 2. A refusal now ends
  the round.
- `addIds` put every pruned id in `remove`, new ids included. Adding more
  ids than the cap holds at once could then send a `remove` list past the
  cap (a 422). Only ids held now go in `remove`.
- The save sites read "was it saved" from the render's `starredSet` and
  toggled from `latestPrefs()`; the two could disagree, and the Undo
  (`setStarred(id, wasStarred)`) would then put back the wrong state.
  `toggleStarEntry` now returns the state it read.
- The PATCH mock didn't check bodies. It now answers 422 where
  `UserPreferencePatchIn` does (an id of 0 or a string, an unknown field, a
  vote other than up / down / null, a non-canonical vote id, a list over
  the key's cap), in the server's order (body, then key, then pairing).
- The `discardPending` test didn't guard its `closed` flag (the mutation
  survived); it now makes a write and a resync after the discard and
  asserts neither goes out.
- Flow timing: under load (three smokes in parallel) `flow-visibility-flush`
  failed once in nine with "2 PATCHes of one save": the flow came back to
  the front before the page had taken in the keepalive PATCH's answer, so
  rule 4, as first built, sent it again. (The review fixes below make rule
  4 give such a write up instead.) The retry flows had the same race
  (a retry is timed from the answer, and the flows moved the fake clock
  after a fixed real-time sleep). H1's fetch wrapper now records
  `answered` (the app has read the body, or the request failed) and
  `answered(page, method, path)` reads it; the flows wait for it before
  moving the clock or the visibility. Two earlier sequential runs, right
  after the mutation runs' last rebuild, also had one failure each; their
  output wasn't kept, and 16 sequential runs after them passed, so that
  cause is the likely one but not proven.
- New flow `flow-prefs-fail-save-keeps-list` for the path PR1b's notes
  recorded: with the preferences GET failing, a save sent a one-story
  `starred_entries` PUT over the server's list.

## Tests

- Unit `frontend/scripts/unit/prefSync.test.ts` (31 tests, against a fake
  server that applies PATCH as `routes/preferences.py` does, a fake clock
  and requests a test answers when it wants): the helpers; two adds in one
  tick; add then remove; two devices; an in-flight change surviving a stale
  GET; a PUT key in flight surviving a stale full GET; reference identity;
  caps and prune order (smallest first, dropped ids in `remove`, client and
  server holding the same set, more new ids than the cap); votes; a failed
  change folded back ahead of newer ones with retries at 2, 4 and 8 s and
  one toast; 405 kept, 400 and 422 dropped, a refusal ending the retries; a
  full request during a since GET; the watermark only from GETs with the
  60 s overlap; the in-flight deadline; coming back after a hide; leaving
  (collectors first, a busy key's change resent folded); `flushPending`;
  `discardPending`; the first full GET failing; the legacy seed producing
  no set-key PUT and removing no server id; set keys refused by `put` and
  `delete`.
- Flows (390): `flow-prefs-resync`, `flow-visibility-flush`,
  `flow-prefs-retry`, `flow-prefs-405`, `flow-prefs-fail-save-keeps-list`
  (new); `flow-reset-keeps-saves` extended (a save and a read mark queued
  when Reset is tapped: no PATCH or PUT after the DELETEs);
  `flow-h1-pref-store` covers PATCH and its 400s and 422s;
  `flow-reload-on-new-build` steps 6-8 follow the PATCH and the leave
  flush (the pending save now goes when the page hides, not on return);
  `flow-tab-stays-on-star` waits for the PATCH; `flow-unsave-last-saved`,
  `flow-tab-migrates-index`, `flow-foryou-down-settles` and
  `flow-fl-rename-keeps-filter-and-view` seed the store instead of a fixed
  GET body. FL's `filter_presets` write stays a PUT.
- Smoke rule C17 in every state and flow: any `PUT /api/preferences/<key>`
  of `starred_entries`, `hidden_entries`, `voted_entries`, `read_entries:*`
  or `seen:*` fails the run.
- Backend: `test_set_key_caps_match_the_frontend` reads `prefSync.ts`.

## Verification

- `npm run lint`: 0 errors, 5 warnings, as on main (four
  `react-refresh/only-export-components` and the old `toast` dependency in
  `markColumnRead`). `npm run
  build` (tsc + vite) clean. Unit tests 128 of 128 (31 in
  `prefSync.test.ts`). `git diff --exit-code` on `package.json` and the
  lockfile: clean. The `node_modules` symlink was made for the loop and
  removed before the commit.
- Full strict smoke (`--csp --strict`, fonts-ci.conf, preview on 4173):
  0 failures, 0 warnings, 317 s, on the final code (and 0 failures on the
  WIP before the fixes).
- The PR2b flows plus `flow-reset-keeps-saves`, `flow-h1-pref-store`,
  `flow-h1-keepalive` and `flow-reload-on-new-build`: 10 sequential runs
  (before the `answered` wait), then after it 3 rounds of 3 parallel runs
  and 2 rounds of 5 parallel runs (with the PR1b save flows added): 0
  failures in all 19 stressed runs.
- Backend pytest (`popping_test_f`): 1238 passed, 13 failed, the 13 being
  exactly the DNS-only baseline list. The tests that pin frontend source
  (`test_preferences_delta.py`, `test_preferences_anonymous.py`, slice19,
  slice21, slice15, slice30, the sitemap link pattern, reserved category
  names) re-run on the final tree: 168 passed, the 2 baseline DNS failures.
- Screenshots looked at (not committed): `flow-prefs-405`'s end (the story
  still shows saved under one "Couldn't save your latest changes" toast),
  `flow-prefs-fail-save-keeps-list`'s end (Saved lists both the server's
  save and the new one), `flow-prefs-resync`'s end (the hidden story stays
  gone).

### Mutation checks (test → broken line → failing rule)

Applied by a script, built where needed, run alone, and restored with
`git checkout` plus `git diff --exit-code`.

| Test | Broken line | Fails on |
|---|---|---|
| `prefSync.test.ts` | rule 5: no skip for a key settled after the GET was sent | "an in-flight change survives a stale GET…" |
| `prefSync.test.ts` | rule 5: no skip for a busy key | the same, and "a PUT key in flight survives a stale full GET" |
| `prefSync.test.ts` | rule 1: a busy key sent anyway | "add then remove…", the deadline test, "coming back after a hide…" |
| `prefSync.test.ts` | rule 2: the failed change folded after the queued one | the deadline test (the queued remove lost to the old add) |
| `prefSync.test.ts` | rule 3: every error retried | "405 keeps… 400 and 422 drop it", `flushPending` |
| `prefSync.test.ts` | rule 3: a refusal keeps the retry count | "405 keeps…" (retried 2000 ms after the failure) |
| `prefSync.test.ts` | rule 6: full mode deletes nothing | "full mode deletes a missing key…" |
| `prefSync.test.ts` | rule 6: an empty list from the server ignored | the same |
| `prefSync.test.ts` | rule 7: a full request during a since GET answered by it | "a full request during a since GET runs right after it" |
| `prefSync.test.ts` | rule 8: a PATCH answer moves the watermark | "the watermark moves only with GETs" |
| `prefSync.test.ts` | rule 8: no 60 s overlap | the same |
| `prefSync.test.ts` | rule 4: no 30 s deadline | the deadline test never finishes (killed at 60 s: the held batch re-arms at once) |
| `prefSync.test.ts` | rule 4: no expiry on return | "coming back after a hide…" |
| `prefSync.test.ts` | rule 9: `discardPending` leaves `closed` false | `discardPending` (after the test was strengthened; it survived before) |
| `prefSync.test.ts` | `pruneIds` drops the largest first | `pruneIds`, caps, votes |
| `prefSync.test.ts` | `addIds` sends every dropped id in `remove` | caps (more new ids than the cap) |
| `prefSync.test.ts` | `mergeIncoming` never keeps a reference | three reference tests |
| `prefSync.test.ts` | the legacy seed writes set keys whole | "legacy localStorage lists plus server rows…" |
| `prefSync.test.ts` | leaving sends without `keepalive` | the retry test, "coming back…", "leaving…" |
| `prefSync.test.ts` | a second change replaces the queued one | "two adds in one tick", two devices, the retry test |
| `prefSync.test.ts` | `flushPending` always true | `flushPending` |
| `prefSync.test.ts` | `put` takes set keys | "set keys are never written whole" |
| `flow-prefs-resync` | rule 5 settled skip removed | PREFS-RESYNC: a GET sent before the hide's answer, answered with the old set, brought story 101 back |
| `flow-prefs-resync` | rule 5 busy skip removed | the same (the GET's base outranks the PATCH's answer) |
| `flow-visibility-flush` | `visibilitychange: hidden` doesn't call `leave()` | VIS-FLUSH: hiding the page sent no PATCH of the save |
| `flow-visibility-flush` | the transport drops `keepalive` | VIS-FLUSH: the PATCH sent when the page hid has no keepalive |
| `flow-prefs-retry` | a 5xx refused, not retried | PREFS-RETRY: 2 PATCHes before the retry, expected 1 |
| `flow-prefs-405` | 405 refused, not retried | PREFS-405: after 1 answers of 405 the story no longer shows as saved |
| `flow-reset-keeps-saves` | Reset's DELETEs without `discardPending()` | RESET: writes after the DELETEs (PATCH starred_entries, PATCH read_entries:news); the server kept read_entries:news |
| `flow-prefs-fail-save-keeps-list` | `setStarred` PUTs the list it holds (the old path) | C17; PREFS-FAIL-SAVE: the store holds [101]; the save sent PUT [101] |
| `flow-tab-stays-on-star` (C17) | the same | C17: PUT /api/preferences/starred_entries |
| `flow-h1-pref-store` | the mock ignores `remove` | H1-PREFS: remove before add gave [3,1,2,4] |
| `flow-h1-pref-store` | the mock's 422 for bad bodies removed | H1-PREFS: PATCH starred_entries {"add":[0]} was not a 422 (and two more) |
| `flow-reload-on-new-build` | `flushPending` always true | RELOAD-SAVED: reloaded although the pending save did not get through |
| `test_set_key_caps_match_the_frontend` | `MAX_READ_PER_KEY` 999 | the `read_entries:*` assert |

The flows whose waits changed (`flow-visibility-flush`, `flow-prefs-retry`,
`flow-prefs-405`, `flow-reload-on-new-build`) were mutation-checked again
after the change, with the same results.

## Review fixes (second commit)

The review agents confirmed eight findings on the first commit. All eight
are fixed; none was skipped. Two of them (a major and a minor) were the
same problem from two angles.

- **A queued change could grow past what one PATCH may carry** (major,
  plus the `voted_entries` duplicate). While writes kept failing, every
  add on a key at its cap pruned one id into the folded `remove`, with no
  upper bound, so after a long offline stretch the server's 422 (lists
  over the cap) dropped every change made meanwhile. Fixed in `send()`:
  a remove or cleared vote of an id that is neither in base nor added by a
  write sent since base was last set is dropped (such an id never reached
  the server). The adds of failed or given-up writes count as sent: a
  request whose answer was lost may still have landed. Whatever is still
  over the cap goes in parts (`splitDelta`), removes and cleared votes
  first, adds last, one at a time under rule 1, with the rest queued.
  `flushPending` sends every part.
- **Rule 4 sent an unanswered write again** (major). On a return, or past
  the 30 s deadline, the first commit put the write back in the queue and
  sent it again. If the keepalive had landed and the laptop had since
  unsaved the story, the second send saved it again on every device. Rule
  4 now follows the spec: the write is given up on and not sent again,
  and the next resync is full. Its change stays on screen until the first
  answer about the key after that, so the return doesn't flicker. The
  claim that a second send is harmless is gone from the code and these
  notes. The grace-period open item is gone too; the safe resend is a
  plan change (see Open items).
- **The leave flush could be overtaken** (minor). It sends a busy key's
  change folded with the one still on the way. If the keepalive request
  landed first and the earlier one after it, an Undo made just before the
  hide was undone. The earlier request is now kept as stale (`by` points
  at the keepalive request): its answer never sets base, and when it comes
  after the keepalive request's answer and its row shows what the
  keepalive request reversed (`overridden`), that part is queued again,
  ahead of anything newer, and sent at once with `keepalive` while the
  page is hidden. When the earlier request answers first, nothing more
  goes. Order is not read from `updated_at`.
- **Reset waited with no limit** (minor). `discardPending` now waits at
  most `DISCARD_WAIT_MS` (3 s), and not at all for a write rule 4 has
  given up on, so Reset always goes on to its DELETEs and the reload.
- **A "Couldn't save" toast on the return** (minor). The return called
  `expire()`, which counted a retry for a key whose retries were used up
  and toasted before anything was sent. `expire()` no longer touches
  retries (rule 4 sends nothing again), and the toast is once per round
  of retries, so a long failing stretch shows one toast, not one every
  30 s.
- **The airplane-mode device check could fail on working code** (minor).
  Control Center doesn't hide the page, and nothing listens for `online`.
  The check now switches to the Settings app and back, and its pass
  allows for the laptop's 60 s poll.
- **README** (minor): rows for `flow-prefs-fail-save-keeps-list`, and the
  reload flow's changed steps.

Also changed, because rule 4 changed:

- A write sent while the page is hidden (a batch timer that ran before
  iOS suspended the page, or the stale check's resend) is given up on at
  the return as well (`whileHidden`), like one sent before the hide.
  Otherwise it would hold its key for up to 30 s after the return.
- `flow-reload-on-new-build` steps 8b and 8c relied on a resend at the
  return. Each hide now waits for its answer (`awayAfterAnswer`), and 8c
  has the server refuse the save sent by the hide once, so the return
  sends it and the reload must wait for it.

### Tests added or rewritten

`prefSync.test.ts`, now 43 tests. The fake server answers 422 for a list
or a votes map past the cap, as the route does, and the harness has an
offline mode where every request fails at once.

- Rewritten for rule 4: "an in-flight record is cleared by its deadline"
  (not sent again, late answer ignored, the next resync is full, its GET
  settles the key; a change queued behind goes alone) and "coming back
  after a hide" (given up on, still shown until the full GET, which keeps
  it when it landed and drops it when it didn't).
- New: another device unsaves while this page is hidden with its
  keepalive answer unread, and the unsave stands after the return; a
  write sent while hidden holds nothing up after the return; the return
  after the retries were used up shows no second toast, and the next
  failure starts a fresh 2, 4, 8 s round; the leave flush overtaken (the
  Undo goes again with `keepalive`, the server ends empty) and not
  overtaken (no extra PATCH); `discardPending` capped at
  `DISCARD_WAIT_MS` and not waiting for a given-up write; a key at its
  cap with 1200 adds while offline (every PATCH after reconnecting within
  the cap, two of them, the second without removes, the server and the
  screen on the newest 1000, one toast, nothing refused); the same for
  2100 votes, given 50 at a time; `hidden_entries` at its cap with Remove all, a hide and its
  Undo while offline (one PATCH, the server empty), and the variant where
  the hide reached the server but its answer was lost (the Undo goes in
  its own PATCH after the first part); a vote set and cleared before it
  goes sends nothing; `splitDelta`; `overridden`.
- Changed: "add then remove" (an id added and removed before it went is
  nothing to send).

### Verification of the fixes

- `npm run lint`: 0 errors, 5 warnings (as before). `npm run build`
  clean. Unit tests 140 of 140 (43 in `prefSync.test.ts`). `git diff
  --exit-code` on `package.json` and the lockfile: clean.
- Full strict smoke (`--csp --strict`, fonts-ci.conf, preview on 4173):
  0 failures, 0 warnings, 333 s.
- The PR2b flows, `flow-reset-keeps-saves`, `flow-h1-pref-store`,
  `flow-h1-keepalive`, `flow-reload-on-new-build`,
  `flow-tab-stays-on-star` and `flow-unsave-last-saved`: 18 sequential
  runs, 3 of them with the unit mutation script running alongside. 17
  ended with 0 failures and 0 warnings. One (the second, with a backend
  pytest running alongside) ended in Node's crash footer with no summary.
  Only its last line was kept, so its stack is lost; the 13 runs after
  it kept full logs, and none crashed. The footer fits Playwright
  rethrowing a "target closed" error from a route callback still running
  when `smoke.cjs` closes the context: `_onRoute` is called without a
  catch, and smoke closes contexts without `unrouteAll({ behavior:
  'ignoreErrors' })`. That is the harness from H1, not this unit's code,
  so it is an open item and not changed here; but it is not proven.
- Backend `test_preferences_delta.py` and `test_preferences_anonymous.py`
  (`popping_test_f`, they pin `prefSync.ts`): 89 passed.

### Mutation checks of the fixes

Unit mutations ran on a scratch copy of `prefSync.ts` and the test file;
the flow mutation was built into `dist`, run alone, and the file restored
from a copy (`cmp` clean).

| Test | Broken line | Fails on |
|---|---|---|
| `prefSync.test.ts` | `forServer` returns the change as it is | "add then remove", the vote set-and-cleared test, the three cap tests |
| `prefSync.test.ts` | `forServer` ignores the adds sent since base | the retry test, both leave-overtaken tests, the read and `hidden_entries` cap tests |
| `prefSync.test.ts` | the vote filter off | the vote set-and-cleared test, the votes cap test |
| `prefSync.test.ts` | no `noteSent` | the same five as ignoring the adds sent |
| `prefSync.test.ts` | no split (one PATCH of everything) | the three cap tests (422, refused) |
| `prefSync.test.ts` | the adds ride with the first remove part | `splitDelta`, the read cap test |
| `prefSync.test.ts` | `flushPending` stops after one part | the read and vote cap tests |
| `prefSync.test.ts` | rule 4 puts the write back in the queue (the old code) | the deadline test, "coming back", the hidden-send test, the other-device test |
| `prefSync.test.ts` | a later answer keeps the given-up change on screen | the deadline test, "coming back", the other-device test |
| `prefSync.test.ts` | giving up doesn't make the next resync full | the deadline test |
| `prefSync.test.ts` | a write sent while hidden is waited for | the hidden-send test |
| `prefSync.test.ts` | stale answers not checked | the overtaken test |
| `prefSync.test.ts` | the stale fix waits for a batch while hidden | the overtaken test |
| `prefSync.test.ts` | the adds sent are forgotten while a stale request is out | the overtaken test |
| `prefSync.test.ts` | `discardPending` waits with no limit | the `discardPending` cap test |
| `prefSync.test.ts` | `discardPending` waits for given-up writes | the same |
| `prefSync.test.ts` | a toast on every failure past the retries | the read and vote cap tests |
| `prefSync.test.ts` | the return keeps the retry count | the toast-on-return test |
| `flow-reload-on-new-build` | `flushPending` always true | RELOAD-SAVED: reloaded although the pending save did not get through |

One survivor, equivalent: checking a stale answer before the keepalive
request's answer is in. The fix it queues is then dropped by the filter
once that answer sets base (the id is in neither base nor the adds sent),
or folds into the same change when that request failed, so nothing
observable differs.

## Deviations from the spec

- The sync rules live in `lib/prefSync.ts` as an engine
  (`createPrefSync`) with injected effects, not in `preferences.tsx`: the
  rules need a queue, timers and requests, and only injected effects let
  the spec's unit tests run without React. `preferences.tsx` wires it to
  React and the DOM.
- Rule 1 covers PUT keys too, so two whole values can't land out of
  order. Leaving the page is the one exception: a busy key's queued change
  goes at once, folded with the change still on the way, because the page
  may never come back to send it after the answer; holding it back would
  lose it outright when the page doesn't come back. The earlier request is
  kept as stale (review fix). If the keepalive request overtakes it and it
  then undoes part of it (an Undo made just before the hide), its answer,
  read after the keepalive request's answer, shows that, and that part
  goes again. Still uncovered: both answers unread when the page comes
  back (rule 4 gives both up and the full GET decides), and the earlier
  request landing last but answering first.
- Rule 2 also retries 408 and 429, which are transient. After the third
  retry the change stays queued and on screen (one toast) instead of
  waiting only for a return: a later batch for the key, the reload flush
  and the leave flush send it too.
- Rule 4 follows the spec since the review fixes: a write past its
  deadline, or unanswered when the page comes back, is given up on, not
  sent again, and the next full GET is adopted for the key. (The first
  commit sent it again and called that harmless; it isn't, because it
  undoes a change another device made meanwhile.) Two additions: the
  change stays on screen until that answer, so a save doesn't flicker off
  and on at the return; and a write sent while the page was hidden is
  given up on at the return too, since it is as likely to have been
  suspended. The cost, which the spec accepts: a keepalive that iOS never
  delivered is lost.
- Rule 5: a queued (unsent) write doesn't make a GET's row ignored; the
  write is re-applied on top of it. The row is newer than anything the
  queue has sent, so it is the right base. Writes on the way and writes
  settled after the GET was sent are skipped as the spec says, for PUT
  keys too.
- Rule 7 adds a 1 s window: a poll within 1 s of a GET being sent is
  answered by it (the mount's full GET and the first refresh's poll start
  together). Hiding aborts the GET on the way, and a GET gives up after
  20 s, so a request iOS suspended can't block the next one.
- Rule 8: `since` is the watermark string read to the millisecond minus
  60 s. Only comparisons use microseconds; the overlap makes the lost
  microseconds irrelevant.
- The localStorage seed stays, but writes only after the first successful
  full GET: set keys by `addIds` (only ids the server lacks), other keys
  only where the server has no row (the spec's "if any seeding stays").
- The provider gains `latest()` (the state as of now) for handlers that
  Column's memo keeps; it replaces App's set-key refs mirrored in effects.
- The caps moved from `preferences.tsx` to `prefSync.ts`; the backend pin
  reads them there.
- `api.patchPreference` leaves empty lists out of the body. The server
  takes a missing list as empty, and answers 422 when `add` or `remove`
  appears at all on `voted_entries`.
- Extra: smoke rule C17 (the assertion that no path PUTs a set key),
  `flow-prefs-fail-save-keeps-list`, the mock's body checks, and H1's
  `answered` flag.

## Data compatibility and rollback

- Stored rows keep their shapes (id lists, the votes map). This build
  needs PR2a's PATCH and `since` (merged in #28).
- Old bundles still PUT whole lists until PR2c. This build's resync adopts
  what they write, which is why PR2c refuses those PUTs once both devices
  run this build (the first new Device checks line).
- `read_entries:<column>` now holds up to 1000 ids (App sliced to 200). An
  old bundle's next whole-list PUT of that key cuts it back to its own 200.
- Revert: safe while PR2c isn't merged; PR2a's routes are then unused and
  the old bundle PUTs again. After PR2c merges, revert PR2c first (it
  would refuse the reverted bundle's PUTs with 409). After PR7a merges,
  PR2b no longer reverts alone.

## Open items for later units

- PR2c: refuse set-key PUTs once both devices show this build; the mock's
  PUT answers 409 for set keys then (C17 reports them today).
- PR3b: new seen marks go to `seen:<category>` through `addIds(key, ids,
  keep)` (the ids on screen as `keep`), its collectors drain through
  `registerBeforeFlush`, Mark all's Undo is `removeIds` of the added ids,
  and Reset adds `seen:*` to its deletions. `decodeState` ignores `seen:*`
  until then. PR3b deletes `toggleEntryRead` and turns `unmarkColumnRead`
  into Mark all's Undo.
- PR5b: `muted_sources` joins the set keys in `isSetKey` / `capFor`, the
  mock's `SET_KEY_RE` and `setKeyCap`, and the server's `SET_KEY_CAPS`.
- PR7a (`category_layout`) and PR8a (`custom_tabs`) are PUT keys, covered
  by rules 1 and 5 as `column_prefs:*` is.
- For the owner, a possible plan change: under rule 4 a keepalive that
  never landed is lost. Resending it safely needs the server to say
  whether it landed, for example a client write id that the PATCH stores
  and the row echoes. A blind resend undoes other devices' changes.
- Not in this unit: a save made offline while staying in the app goes out
  only with a later write's batch, a hide and return, or a flush. Nothing
  listens for `online`. Sending on `online` would be new behaviour for its
  own unit or the owner's approval; the device check leaves the app and
  comes back instead.
- Harness (H1's `smoke.cjs`): one loop run in 18 crashed with no summary
  (see Verification of the fixes). If it shows up again, keep the whole
  log; if the stack names a route callback, call
  `context.unrouteAll({ behavior: 'ignoreErrors' })` before
  `context.close()`.
- ARCHITECTURE.md is unchanged: this unit adds no server process state.
