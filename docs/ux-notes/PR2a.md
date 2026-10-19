# PR2a: Preference PATCH routes

Backend track. Backend changes and pytest only; no frontend, flows or smoke states. It adds
routes but nothing calls them yet (PR2b is the caller).

## What changed

All in `backend/app/routes/preferences.py`, plus the body model in `backend/app/schemas.py`.

- **Keys that contain `/`.** GET, PUT, DELETE and the new PATCH on `/preferences/{key}` now take
  the rest of the path as the key. A category can contain `/` (`read_entries:News/Tech`), the
  client sends `encodeURIComponent(key)`, and the server decodes `%2F` before routing, so the old
  `{key}` (which stops at `/`) gave a silent 404. The route parameter is
  `{key:preference_key}`, a convertor registered in this module (see Deviations).
- **`_validate_key`** still enforces the allowlist on every single-key route:
  - `fullmatch` instead of `match`. The pattern ends in `$`, which with `match` also accepted
    `hidden_entries\n`.
  - A key over 60 characters is a 400. The column is `String(60)`, so before this it was a
    Postgres truncation error (a 500).
  - New suffixed namespace `seen:<category>`, for PR3b's seen marks.
- **`SET_KEY_CAPS`**: the set keys and their caps: `starred_entries` 1000, `hidden_entries`
  1000, `voted_entries` 2000, `read_entries:*` 1000, `seen:*` 1000. Only these take PATCH.
- **`PATCH /api/preferences/{key}`**:
  - Body `UserPreferencePatchIn` (`extra="forbid"`): `add` / `remove` (lists of strict ints from
    1 to 2**63-1, at most 1000 each) for the id-list keys, `set` (`{"<id>": "up" | "down" |
    null}`, at most 2000 keys) for `voted_entries`.
  - A key that isn't a set key gives 400. A wrong pairing (`set` on a list key, `add` or `remove`
    on `voted_entries`) gives 422.
  - One transaction: `INSERT … ON CONFLICT DO NOTHING`, `SELECT value … FOR UPDATE`, coerce the
    locked value (a non-list, or for votes a non-dict, becomes empty; anything that isn't a valid
    id or vote is dropped, and so are duplicates), `remove` before `add`, trim down to the cap
    smallest entry id first (votes by numeric id), then `UPDATE … value, updated_at = now()`,
    and return `UserPreferenceOut`.
  - Stored order is kept. New ids are appended in body order.
- **`GET /api/preferences?since=<iso>`** returns only rows with `updated_at > since`. `since` is
  an `AwareDatetime`, so a naive timestamp gives 422. Without `since` it returns every row, as
  before. The server stays on `now()` (the transaction start time). The docstring explains why a
  client has to poll with an overlap.
- `backend/tests/test_preferences_anonymous.py`: the "NOT covered here" note about `/` in a
  column id now points to the new slash-key test.

## Tests

`backend/tests/test_preferences_delta.py` (db, except the cap pin), 68 cases:

- **FOR UPDATE, deterministically.** Session A takes `SELECT … FOR UPDATE` on the row. PATCH B
  runs as a task and isn't done after 0.2 s. A writes `[1, 2]` and commits, and B ends with
  `[1, 2, 3]`.
- **First write.** A holds an uncommitted insert of the key. PATCH B waits on the unique index,
  then extends A's row. A third case runs 8 concurrent first PATCHes on a new key, and all 8
  land.
- `remove` before `add` in one body. Add is idempotent, and removing an absent id does nothing.
- **Cap, smallest ids first.** The newer survivors keep their stored order. An added id smaller
  than everything stored is the one trimmed. An over-cap row written by PUT is trimmed on its
  next PATCH. Votes: set, clear with `null`, and the cap trims by number, not by string ("10"
  survives while "1" and "2" go).
- **Malformed rows coerced, not a 500:** a string, a dict on a list key, `null`, mixed elements
  (strings, floats, bools, nulls, negatives, 0, out-of-range ints, nested values, duplicates),
  `true` on its own, and for votes a list, a string, and a dict with bad ids and values.
- **400:** PATCH of every non-set key (`column_prefs:*`, `last_viewed:*`, `column_sections:*`,
  `filter_presets`, `history_group_by`) and of unknown keys (`seen:`, bare `seen`,
  `hidden_entries:x`). A 61-character key gives 400 on all four methods, and 60 characters
  still work. A trailing or embedded newline gives 400 on all four methods, and no row is
  written.
- **422:** an unknown field, ids 0, 2**63 and -1, `"5"`, `5.0`, `true`, `null`, a list over the
  cap (`add` and `remove`), `set` on list keys, `add` and `remove` on votes, vote values other
  than up/down/null, vote keys `"07"`, `"0"`, `"abc"` and 2**63, more than 2000 vote keys, and a
  naive `since`. Each case also checks that no row was written. The largest valid ids and full
  lists are accepted.
- **Anonymous:** the row is stored under `anonymous`. PATCH is per user: a `current_user`
  override as `alice` doesn't touch the anonymous row.
- Suffixed `read_entries:*` and `seen:*` keys are separate rows.
- **`since`:** returns only later rows, and nothing for a future instant. Overlap: PATCH 1
  starts and waits on a row lock. PATCH 2 on another key starts later and commits first, and a
  poll's watermark becomes PATCH 2's timestamp. PATCH 1 then commits with an older
  `updated_at`. A since-GET from the exact watermark misses it; with the 60 s overlap it returns
  both rows.
- **Slash keys:** `read_entries:News/Tech` and `seen:News/Tech`, percent-encoded, through PUT,
  PATCH, GET (single and bulk) and DELETE: 200 / 204 and the row back.
- **Caps pinned** (no_db): `SET_KEY_CAPS` against `MAX_HIDDEN`, `MAX_STARRED` and `MAX_VOTED`
  in `frontend/src/lib/preferences.tsx`.

## Verification

- Full backend pytest on local Postgres (`popping_test`), after rebasing onto main d74b159
  (PR1a): **13 failed, 800 passed**. The 13 failures diff clean against the DNS-only baseline
  list in `/root/popping-env/baseline.txt`. 800 = PR1a's 732 + the 68 new cases. Before the
  rebase (on c02ddaa): 13 failed, 787 passed (719 + 68).
- `test_oidc_route_gating.py` passes: PATCH is inside `main.py`'s `_api_deps` loop and returns
  401 with OIDC on.
- `test_preferences_delta.py` and `test_preferences_anonymous.py` run 5 times in a row: 75
  passed each time (the lock tests use 0.2 s waits).
- No frontend files changed, so frontend lint, build, unit tests and smoke were not needed.
- Mutation checks. For each, the guarded line was broken, the delta tests were run, and the file
  was restored from a copy and compared byte for byte:

  | Broken line | Failing test(s) |
  |---|---|
  | `.with_for_update()` removed | `test_patch_waits_for_the_row_lock_and_keeps_both_changes` (`[1, 3] != [1, 2, 3]`), `test_concurrent_first_patches_on_a_new_key_all_land` |
  | `INSERT … ON CONFLICT DO NOTHING` removed | `test_first_write_waits_for_a_concurrent_insert`, `test_concurrent_first_patches_on_a_new_key_all_land` |
  | `fullmatch` back to `match` | `test_newline_in_key_is_400[hidden_entries\n-GET/PUT/DELETE]` (PATCH still 400s, because the key isn't a set key) |
  | convertor regex `(?s:.*)` back to `.*` | all 8 `test_newline_in_key_is_400` cases |
  | routes back to plain `{key}` | both `test_slash_keys_round_trip_through_every_route` cases (404) |
  | 60-character check removed | `test_key_longer_than_60_is_400` (truncation error on PUT and PATCH, 404 on GET) |
  | `remove` applied after `add` | `test_remove_is_applied_before_add` |
  | id trim by position instead of smallest id | `test_cap_trims_smallest_ids_first` |
  | vote trim by string instead of number | `test_votes_set_clear_and_cap` |
  | `type(v) is int` loosened to `isinstance` | `test_malformed_list_row_is_coerced[True, False, 3]`. This case was added after the first run of this mutation survived: there, `true` came after `1` and was dropped as a duplicate either way. |
  | `since` filter removed | both `since` tests |
  | `set`-on-list-key check removed | the two `set` on list key 422 cases |
  | `strict=True` removed from the id type | the `"5"`, `5.0` and `true` 422 cases |

- **Security checklist** (self-check; the `/security-review` step is separate):
  - PATCH is on the existing preferences router inside `_api_deps`, and the OIDC gating test
    passes.
  - PATCH takes a Pydantic JSON body with `extra="forbid"` and length bounds. The new GET
    parameter has no side effects.
  - Client-written JSON read back by the server (the locked row) is coerced and capped before
    use.
  - No network I/O.
  - The custom convertor only widens what the key parameter matches to newlines. The allowlist
    still decides which keys are valid, and keys are bound parameters in SQL.

## Deviations from the spec

- **`{key:preference_key}` instead of `{key:path}`.** Starlette builds the route regex as
  `^/preferences/(?P<key>.*)$`. `.` stops at a newline and `$` matches before a trailing one, so
  with `{key:path}`, `hidden_entries%0A` routed as `hidden_entries` (the handler never saw the
  newline) and a newline inside a key gave 404. The spec's "trailing newline returns 400" can't
  hold that way. `_PreferenceKeyConvertor` is the path convertor with `(?s:.*)`, registered once
  with `register_url_convertor` in `routes/preferences.py`, so the handler gets the decoded key
  exactly as sent and `_validate_key` refuses it. Nothing else changes: `/` still matches, and
  the OpenAPI path is still `/api/preferences/{key}`.
- **`seen:*` still accepts PUT.** The spec calls it "PATCH-only", but its own slash-key test
  PUTs `seen:News/Tech` and expects 200, and PR2c's 409 list includes `seen:*`. So "PATCH-only"
  is how the client writes it, and the server enforces it in PR2c along with the other set keys.
  No bundle PUTs `seen:*` today.
- **The constant is `SET_KEY_CAPS`, a dict of key pattern to cap.** PR2c's single `SET_KEYS`
  constant can be its keys (`tuple(SET_KEY_CAPS)`), so the PATCH allowlist and the PUT refusal
  share one list.
- **Vote keys must be canonical digit strings** (`[1-9][0-9]{0,18}`, at most 2**63-1). The spec
  says "a digit string". Refusing `"0"` and leading zeros matches the id range used for `add` /
  `remove`, and stops `"7"` and `"07"` from naming the same story twice.
- **Ids are strict ints.** `"5"`, `5.0` and `true` get 422 instead of being coerced, because the
  stored lists hold JSON numbers.
- **The per-key list-length check in the route can't fire yet.** Every list cap is 1000, the same
  as the schema's outer bound (`MAX_PATCH_IDS`), so Pydantic answers first. It's kept for
  `muted_sources` (PR5b), whose cap may differ. No mutation check was possible for it.
- **The caps pin doesn't cover `read_entries:*` or `seen:*`.** `MAX_READ_PER_KEY` doesn't exist
  in `preferences.tsx` yet; PR2b adds it (frontend track). The test asserts the server's 1000
  directly until then.
- An empty body (`{}`) is accepted. It makes sure the row exists and bumps `updated_at`. It's
  harmless, but PR2b shouldn't send empty deltas.

## Open items for later units

- **PR2b:** add `MAX_READ_PER_KEY = 1000` to `preferences.tsx` and pin it in
  `test_set_key_caps_match_the_frontend`. Poll with `since = watermark − 60 s` and advance the
  watermark only from GET responses (the overlap test shows why). Don't send empty PATCH bodies.
  The `capture.cjs` PATCH mock should match the server: `remove` before `add`, and `set` with
  `null` clearing a vote.
- **PR2c:** derive `SET_KEYS` from `SET_KEY_CAPS`, return 409 for PUT of those keys, and rewrite
  `test_preferences_anonymous.py:30-81`, which still PUTs `read_entries:1` and
  `read_entries:For You`.
- **PR5b:** add `muted_sources` to `SET_KEY_CAPS`. If its cap is over 1000, raise
  `MAX_PATCH_IDS` in `schemas.py` to match. The route's per-key length check then starts to
  matter, so it should get its own test.
- **Side effect today:** the current bundle's whole-list PUTs to `read_entries:<column name>`
  for a tab whose name contains `/` used to 404 silently, so those marks never persisted. They
  now persist. Nothing else about PUT changed.
- **Device checks:** none. The Summary table says this unit has nothing to notice on the phone
  ("the PATCH save route, with no caller"), so `docs/DEVICE_CHECKS.md` is unchanged.
