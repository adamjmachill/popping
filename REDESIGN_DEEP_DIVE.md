# Redesign deep dive: raw results

Generated from the deep-dive workflow journal. Raw agent output, not edited. REDESIGN_PLAN.md is the curated plan; this file is the evidence behind it and survives if the session ends.

Progress: 10 code readers, 3 designs, 3 judges, synthesis done, 4 verifiers, critic not yet.

## Verifier findings

### Category picker (§7, plus the category parts of §6, §12 and the guard test): backend _validate_category and reserved names, labels.ts, how App derives columns from categories, column and localStorage state when a category gains or loses its last feed, and the "New category…" flow before PATCH. HEAD is c7a95e6 on claude/redesign-plan, which differs from origin/main 721713e only in plan and audit-script files, so the line numbers below hold for 721713e.

- [confirmed] _validate_category (sources.py:287-303) rejects empty, more than 40 characters and reserved names on the stripped value, while POST, /auto and PATCH store the unstripped body.category. Returning the stripped value fixes this.
  - Evidence: sources.py:287-303 checks stripped and returns None. POST stores category=body.category at :518, /auto at :617, PATCH passes body.category to scheduler.update_source at :779 (validated at :752). So ' '+40 chars+' ' passes the check, is stored as 42 characters into String(40) (models.py:46), and Postgres returns a 500. The discover route (:1142-1144) already strips locally.
  - Correction: Keep the change. Also switch the discover route at :1143 to `category = _validate_category(body.category)` so there is one code path. Add a test for a 40-character value with surrounding spaces: it must be stored as 40 characters and must not return a 500.
- [needs_change] The reserved names are {'saved','for you'}, compared case-insensitively (sources.py:162), and the client mirrors them as RESERVED_CATEGORIES.
  - Evidence: sources.py:162 is `_RESERVED_CATEGORY_NAMES = {"saved", "for you"}` and :299 checks `stripped.lower()`. labels.ts:64-68 categoryLabel splits on `[_\s-]+` and title-cases, so 'for_you', 'For-You' and 'saved_' pass both checks yet display as 'For You' and 'Saved', identical to the built-in columns (App.tsx:838-840) in the tab bar and Column header (Column.tsx:332).
  - Correction: In resolveNewCategory, also reject when `label(input).toLowerCase()` is a reserved name; label is already passed in. Optionally make the backend compare `re.sub(r'[_\s-]+',' ',stripped.lower())`. Add 'for_you' and 'saved_' cases to test_source_editor_contract.py. In the no_db guard test, assert that RESERVED_CATEGORIES equals _RESERVED_CATEGORY_NAMES, not just that it contains both names.
- [confirmed] Keep the case as typed, because lower-casing 'NHL' would show as 'Nhl' since nhl is not in ACRONYMS (labels.ts:21-25).
  - Evidence: labels.ts:21-25 ACRONYMS has 'nfl' but not 'nhl'. categoryLabel returns the name unchanged when /[A-Z]/ matches (:66), otherwise it calls titleWord, which gives 'Nhl'. Backend recency (scoring/recency.py:30) and personal scoring (scoring/personal.py:92) lower-case and strip before lookup, so storing the typed case does not change scoring. entries.py:366 and foryou.py:111 compare raw strings.
  - Correction: None for the backend. The frontend has a case-sensitive dependency; see the Card colour addition.
- [needs_change] Matching an existing category regardless of case reuses the existing spelling (rule 5, 'Using your existing “News” category').
  - Evidence: The rule matches only 'existing', and the plan never says whether CATEGORY_OPTIONS suggestions count as existing. Card.tsx:131-149, :171 and :192 colour cards with a case-sensitive `switch (category)` on lower-case slugs ('news', 'tech', 'video'…). Typing 'Video' or 'Tech' when no feed uses that category yet would store 'Video', and those cards would get the grey default stripe instead of pink. Variants that differ only in separator ('tech_news' vs 'Tech News') share a label and still do not match.
  - Correction: Match case-insensitively against yours ∪ suggestions, and against label(x).toLowerCase() as well. Prefer the existing raw spelling, then the suggestion slug. In Card.tsx, switch on `category?.toLowerCase().trim()` in all three colour functions. That is a class-only change and fits PR 4 or PR 5.
- [confirmed] The picker builds its list from sources.map(s => s.category), never App's `categories`, which come from visible entries (App.tsx:753-764).
  - Evidence: App.tsx:753-762 groups visibleEntries by categoriesBySourceId (:723-726, built from sources), and :764 sorts the keys. A category with no visible entries, or whose entries are all hidden, has no column and is missing from `categories`. Drawer's Jump list (:393-395) uses the same entry-derived list.
  - Correction: Keep.
- [needs_change] categoryOptions draws suggestions from CATEGORY_OPTIONS (FeedManager.tsx:80-105) while lib/categories.ts has no imports.
  - Evidence: CATEGORY_OPTIONS is a module-private const in FeedManager.tsx:80-105. A no-imports lib/categories.ts cannot read it, and node --test cannot load FeedManager.tsx. No backend guard test pins CATEGORY_OPTIONS (grep of backend/tests found nothing).
  - Correction: Move CATEGORY_OPTIONS into lib/categories.ts, export it, and import it in FeedManager.tsx (Add form type-switch logic :1594/:1609) and CategoryPicker. Alternatively pass it as a parameter, as `label` is passed.
- [needs_change] CategoryPicker({ id, value, sources, onChange, disabled, mode }) replaces the Add form's <select id="fm-category"> (:1722-1731) and the edit form's datalist (:602-618).
  - Evidence: Line ranges confirmed: FeedManager.tsx:603-619 is the input plus datalist, and :1722-1731 is the label plus select. But AddCustomTab is rendered as `<AddCustomTab onAdded={onRefresh} onError={onError} />` (:258) with no `sources`, so it cannot list 'Your categories'. In the editor, `id` is ambiguous between the HTML id and the source id. The Add form's select sits in `<div className="flex gap-2"><div className="flex-1">` next to Refresh (:1720-1735), so in new mode the input, Add and Cancel would squeeze into about 136px at 320.
  - Correction: Pass `sources` into AddCustomTab. Split the props into `inputId` (Add form 'fm-category', editor `fe-category-${source.id}` with a matching htmlFor) and keep the picker presentational: it emits onChange(final), and FeedEditor calls commitField. Make the Add form's Category full-width on its own row, with Refresh below it, so new mode fits at 320. Add a smoke state for Add form new-category mode at 320.
- [refuted] New category: maxLength={40}, and '41+ characters show an error under the field, and nothing is sent'. The smoke state types 45 characters in new-category mode.
  - Evidence: With maxLength={40} the browser blocks input past 40 UTF-16 units and truncates pastes silently, so the 41+ error can never appear through typing. The 45-character smoke state cannot be reached, or silently becomes 40. JS .length counts UTF-16 units while Python len and Postgres varchar(40) count code points, so emoji text diverges.
  - Correction: Drop maxLength. Count with `Array.from(s).length` and show the error live once the count passes 40, with 'Add' disabled, matching sources.py:291. Keep the 45-character smoke state, which then exercises the error path (C5 clipped text on the error line).
- [needs_change] Choosing __new__ renders the input with autoFocus, so the keyboard comes up.
  - Evidence: The switch happens in the select's change handler, and React mounts the input in a later commit. iOS Safari only raises the keyboard for focus() called synchronously inside a user-gesture handler such as touchend or click; a select change fired when the wheel is dismissed is not one. The plan itself uses flushSync plus focus in the same tap for 'Add header' (§8) for this very reason. Expect a focused-looking field with no keyboard, which is one more tap.
  - Correction: Either put a separate 44px '+ New category' button under the select (onClick → flushSync(setMode('new')) → inputRef.focus()) and drop the __new__ option, or keep the option and accept a tap on the field. Add 'keyboard appears after New category' to the PR 4 on-phone checklist either way.
- [needs_change] 'Return or Add commits. Blur does not commit.' and the Settings close path 'runs the registered editor flushers (commits any dirty, valid text draft)'.
  - Evidence: §6's Settings close path and visibility flush call each FeedEditor's flush(). The plan does not say whether a half-typed new-category draft counts as a text draft. If it does, closing Settings or switching apps would save a name that blur deliberately does not save, contradicting F2.
  - Correction: State that flush() never commits a CategoryPicker new-mode draft, and that the draft is discarded on close. In the Add form, while the picker is in new mode with a non-empty draft, either resolve it on 'Add feed' (same rules, error shown inline) or disable 'Add feed' with the hint 'Finish or cancel the new category'. Without that, the feed silently lands in the previous category.
- [confirmed] Moving the last feed out of a category makes that column disappear on the next render; a tab that is open lands on the neighbouring column, otherwise the same column by name.
  - Evidence: categoriesBySourceId comes from `sources` (App.tsx:723-726). applyServerSource updates sources, byCategory regroups (:753-762), and allSubsColumns drops the category (:831-846). The current index-based clamp (:1359-1367) only handles length shrink, so removing an earlier column shifts the tab today.
  - Correction: Keep the name-based tab, but see the next verdict about persistence.
- [needs_change] Phone tab by name: if the stored name is not found and columns is non-empty, 'show the column at the last rendered index… and store its name'; never write while columns is empty.
  - Evidence: Columns are briefly incomplete while non-empty. 'Saved' depends on starredEntries, which start [] until the preferences GET resolves (preferences.tsx:179, 458-462, loading=true). 'For You' is dropped when forYou fails (`.catch(() => [])`, App.tsx:1080). Hidden entries are not filtered until hiddenEntries load, so a category of only-hidden entries appears and then vanishes. In multisub mode, columns is a single filter-named column (:898). Storing the fallback name in any of these cases permanently loses the user's tab (for example a stored 'Saved' is overwritten with 'For You' on every cold start).
  - Correction: Persist mobileColName only on an explicit user choice: a tab tap, a swipe, Jump to column, or the one-time index migration. On a missing name, render the fallback index without writing. Also skip resolution while `prefs.loading` is true or before the first refresh resolves. In multisub mode, neither read nor write the key. Add a flow: stored name 'Saved', preferences GET delayed by 1 s → after load the Saved tab is selected.
- [needs_change] The '__brief__' sentinel for the Brief tab and the '__new__' option value.
  - Evidence: The backend accepts any 1-40 character category except saved/for you (sources.py:287-303), so a user category '__brief__' or '__new__' collides with these sentinels.
  - Correction: Store the Brief tab as a separate flag (for example the value '' or a JSON {"brief":true}), or add '__brief__' and '__new__' to the client-side reserved list in resolveNewCategory. Cheapest: reject names matching /^__.*__$/ on the client.
- [needs_change] Flow FA: pick 'Tech' → exactly 1 PATCH, body {"category":"tech"} (existing lower-case 'tech' reused).
  - Evidence: fixtures.cjs:46-62 has only the categories news, deals, security, podcast and video. There is no 'tech' row, so 'tech' comes from the Suggestions group, with value equal to the CATEGORY_OPTIONS slug. The body is still 'tech', but the stated reason is wrong, and the reuse path is not tested.
  - Correction: Rename FA to 'pick suggestion Tech → body tech'. Add FA2: New category, type 'NEWS', Add → 1 PATCH with body {"category":"news"} and the line 'Using your existing “News” category'. Add FA3: type 'For You' or 'for_you' → 0 PATCHes and the reserved error visible.
- [needs_change] Flow FM: phone tab on 'News'; recategorise its last feed so the News column disappears.
  - Evidence: In fixtures.cjs, news has 4 sources (ids 1-4). Columns exist only for categories with visible entries (App.tsx:753-764), so the flow needs a category with exactly one source that has entries.
  - Correction: Add a fixture category with one source that has entries, for example 'nhl' with one rss row and 3 entries. Run FM on that category, and assert the selected tab's name and that localStorage `popping.v1.mobileCol.name` was not overwritten by the fallback.
- [needs_change] Test endpoint: 'call _validate_category when the body has a category'.
  - Evidence: SourceTestRequest.category is `str = "news"` (schemas.py:207), so it is always present, and today's frontend testSource sends it only optionally (api.ts:389-400).
  - Correction: Validate when `'category' in body.model_fields_set`, or always, since the default 'news' passes. State which one, so the invalid_category test is unambiguous.
- [confirmed] fieldSaveMessage matches the backend detail strings for category errors.
  - Evidence: sources.py:290 'category cannot be empty', :297 'category must be 40 characters or fewer' (contains '40 characters'), :302 "category 'X' is reserved for a built-in column".
  - Correction: None. For the reserved message, use the server's quoted value (parse it from the detail), not the picked value.

Additions:
- Column order: App.tsx:764 `Array.from(byCategory.keys()).sort()` sorts by UTF-16 code unit, so typed names like 'Hockey' and 'NHL' sort before every lower-case category ('deals', 'news'). Sort by `categoryLabel(c)` with localeCompare(undefined, { sensitivity: 'base' }) so the tab bar, desktop grid and Jump list match the picker order (PR 4).
- Card colour stripe, border and source text (Card.tsx:131-149, 171, 192) compare category case-sensitively. Use `category?.toLowerCase().trim()` so typed-case categories keep their colour (PR 4, class logic only).
- Per-column server preferences are keyed by the raw column name: columnPrefs (sort, min score, max age), columnSections and lastViewed (App.tsx:906, 966, 1188-1196). When a category loses its last feed, its preferences are orphaned on the server, and they come back if the name is reused. A new category starts with DEFAULT_PREFS. Read state is global (globalReadIds, App.tsx:970), so moved stories do not turn unread. Document this as expected. Moving prefs on a 'rename' is out of scope, consistent with open decision 2.
- Clarify that only STORAGE_KEYS.mobileColLast (storage.ts:52) is in localStorage. Column prefs are server-backed (storage.ts:20-40), so the 'localStorage column prefs' concern applies only to the phone tab key. The new key `popping.v1.mobileCol.name` belongs in STORAGE_KEYS with a comment, and the storage.ts header ("Only two keys remain") must be updated.
- Desktop selectedColumnIndex (App.tsx:671, used at 1802/1822/1873) is index-based and never clamped. When a column disappears after a recategorise, keyboard j/k/o can target the wrong column or undefined. Clamp it in the same effect, or track it by name (PR 4).
- AutoFeedBlock today calls api.autoAddSource(trimmed) with the default category 'other' (FeedManager.tsx:1213, api.ts:409). The plan changes this to 'news' for non-YouTube pastes with no picker. Either keep 'other', or reuse the Add form's current category through the picker so the user can see and choose it.
- For the Add form (no source id), categoryOptions should put the default 'news' in Suggestions rather than inventing a 'Your categories' entry with count 0 when no feed uses it.
- Legacy rows may carry leading or trailing whitespace, because POST and PATCH stored unstripped values before PR 1. The '(raw)' suffix should show the raw value quoted, e.g. 'News (“news ”)', so whitespace twins are visible. The equal() check for category must compare exact strings, so moving 'news ' to 'news' still sends a PATCH.
- Backend tests to add in test_source_editor_contract.py: a 40-character value plus surrounding spaces is stored stripped (no 500); 'for_you' and 'saved_' are rejected if the label-based reserved rule is adopted; the discover route strips through the same helper.
- Unit tests in scripts/unit/categories.test.ts: reuse via a suggestion slug ('Tech' becomes 'tech'); label-equal reuse ('tech_news' vs 'Tech News'); 41 code points rejected while 21 emoji (42 UTF-16 units) are accepted; '__brief__' and '__new__' rejected; reserved checks after whitespace collapse and on the label.

### Feed editor and autosave: the PATCH flow from the planned FeedEditor and lib/sourceSaves.ts through frontend/src/api.ts to backend/app/routes/sources.py and scheduler.update_source. Covers state, the no-debounce rationale, coalescing, rollback, 422 mapping, built-in locks, closing mid-save, keepalive, and the source list refresh after a save. Baseline: origin/main 721713e. The branch's frontend/ and backend/ trees match it.

- [confirmed] api.ts: updateSource(id, body, opts?: {keepalive, signal}) can pass keepalive and signal to fetch.
  - Evidence: api.ts:273-274: jsonFetch does fetch(url, { credentials: 'include', ...init }), so keepalive and signal pass through. A network failure rejects with TypeError (Safari's 'Load failed'). An abort rejects with a DOMException named AbortError, which is not a TypeError. Non-2xx throws ApiError(message, detail) (api.ts:264-287).
  - Correction: None. Classify errors in this order: AbortError (by name), then TypeError, then ApiError by status.
- [confirmed] The PATCH response carries net_vote_score: 0 (sources.py:398-403), so applyServerSource must keep the local score.
  - Evidence: PATCH returns SourceOut.model_validate(row) at sources.py:798, and schemas.py:62 defaults net_vote_score to 0. Lines 398-403 are the GET list that fills scores in.
  - Correction: Cite sources.py:798 and schemas.py:62, not :398-403. The behaviour is as described.
- [needs_change] The updateSource body type gains sitemap_url/link_pattern, and the comment changes from '{}' to 'send null to clear'. These are the api.ts changes the editor needs.
  - Evidence: api.ts:424-444: the body lacks sitemap_url and link_pattern, and the comment says to send {}. Beyond that, the Source interface (api.ts:117-147) has no sitemap_url or link_pattern, though the backend returns both (schemas.py:28-34).
  - Correction: Also add `sitemap_url: string | null; link_pattern: string | null` to the Source interface. Without them the Website rows and commitField's getSource(id)[field] comparison do not type-check, or they read undefined.
- [confirmed] deleteSource throws ApiError with detail (api.ts:446-452).
  - Evidence: api.ts:446-452 throws a plain Error with no detail. DELETE returns 204 with no body (sources.py:801-805).
  - Correction: Keep the hand-rolled fetch, parse the JSON detail only when !resp.ok, and throw ApiError. Do not route it through jsonFetch, which calls resp.json() on success and throws SyntaxError on a 204.
- [confirmed] No time-based debounce, because every effective PATCH on an active feed rebuilds its job with next_run_time=now (scheduler.py:2462-2469 -> :2144).
  - Evidence: scheduler.py:2461 calls _add_or_replace_dynamic_job(_scheduler, row, stagger=False). With stagger off, first_run=now and next_run_time=first_run (:2120-2144). The no-change early return is at :2346-2357. Built-ins return earlier, at :2437-2442.
  - Correction: None. Cite :2461. test_reddit_throttle_cooldown.py:116-135 pins the call literal `_add_or_replace_dynamic_job(_scheduler, row`. The early return for a category-only change must leave that call in place.
- [confirmed] scheduler change 2: a category-only change can skip the job rebuild, because ingest reads the category from the DB row.
  - Evidence: scheduler.py:431 uses source.category from a fresh session. The plugin's self.category (dynamic_rss.py:58, youtube.py:36, podcast.py:37, generic_scrape.py:360) is read only by _upsert_source, when it creates a missing row (scheduler.py:117-133).
  - Correction: None.
- [confirmed] scheduler change 1: replace `if active is False:` with `if not row.active:` after the built-in check.
  - Evidence: scheduler.py:2444 `if active is False:`, after the registered-names return at :2437-2442. Today a headers or url PATCH on a paused row re-adds the job, and ingest then skips it (scheduler.py:387).
  - Correction: None.
- [refuted] Built-ins can still be paused, recategorised, re-intervaled and deleted.
  - Evidence: Re-intervaling a built-in does nothing. update_source returns before any job change for registered names (scheduler.py:2437-2442), and built-in jobs use plugin_cls.refresh_interval_seconds (scheduler.py:1802, :500, :565). The PATCH still stores the value, and the UI would show 'Saved ✓' for a setting the scheduler ignores. Pause works (ingest checks source.active at :387). Category works (read at :431).
  - Correction: In FeedEditor, show 'Check for new items' read-only for built-ins, for example 'Checked every 5 min by Popping' from the row value. Or hide it. Drop 're-intervaled' from §6, and add flow FK: no interval select on the built-in fixture.
- [needs_change] fieldSaveMessage table: 400 containing 'built-in' maps to 'Built-in feeds keep their name and address.'; 400 containing 'reserved for a built-in source' maps to 'That name belongs to a built-in feed.'
  - Evidence: sources.py:681-685 returns detail "name 'x' is reserved for a built-in source", which also contains 'built-in'. sources.py:765-771 returns "built-in source 'x' cannot be renamed or re-URLed". Matching in table order gives the wrong message for a name that collides with a registry name.
  - Correction: Test 'reserved for a built-in source' before the generic 'built-in' rule, or match 'cannot be renamed or re-URLed' for the built-in lock.
- [needs_change] Any other 4xx with a string detail is shown as is.
  - Evidence: Developer text reaches the user this way. 404 'source not found' (sources.py:666, :797) happens when another device deleted the feed or a queued save outlives a delete. Others: 'name must match ^[a-z0-9_]{1,120}$ …' (:111-116), 'url must be http or https' / 'url must include a host' / 'url is not a valid URL' (:220-228), "reddit url must be a subreddit reference (e.g. 'r/python' …)" (:256-262), and link_pattern 'must start with '/' (path prefix, not a full URL)' (:722-731).
  - Correction: Map 404 to 'This feed was deleted.' and call removeSource(id). Map the name regex to 'Use lowercase letters, numbers and underscores.', the url scheme and host messages to 'Use a web address that starts with https://', the reddit message to 'Type a subreddit, like r/python.', and link_pattern to 'Start it with /'. Pass through only the YouTube and Apple resolver messages.
- [needs_change] Switching apps mid-edit also saves (sent with keepalive): setPageHiding(true), blur, run flushers, and the queued PATCHes go out with keepalive.
  - Evidence: The store sends one PATCH per source at a time, one key per body (§6 step 4). If two fields are dirty, or a non-keepalive PATCH is already in flight, at hide time, only the first leaves before iOS freezes JS. The rest wait for a response that is never handled. The 2 s network retry is a timer, and timers do not run while the page is suspended.
  - Correction: While pageHiding, have pump send every queued item at once with keepalive: true, without waiting for the in-flight one. Different fields are independent columns, and update_source touches only changed attributes. Also call pump synchronously inside the visibilitychange/pagehide handler, with no microtask or setTimeout. Add a unit test: two dirty fields plus hide gives two keepalive calls.
- [needs_change] Failure: a TypeError not yet retried is retried once after 2000 ms by putting the item back at the front; finally clears in-flight state and calls pump; whenIdle resolves when the queue is empty and nothing is in flight.
  - Evidence: Design only (lib/sourceSaves.ts is new). As written, during the 2 s wait the item is neither queued nor in flight. whenIdle(id) can resolve, so Delete or Check now runs with a save still pending. commitField step 1 compares against the server value, and the FB/FD PATCH counts become timing-dependent.
  - Correction: Add a 'retrying' slot per source that counts as busy for whenIdle and pump, and is compared in step 1 like in-flight. Either keep the item at the front of the queue with a notBefore timestamp, or keep the in-flight flag set through the delay.
- [needs_change] Same-field coalescing caps rapid select changes at two PATCHes (first in flight + newest); flow FH: three quick selectOption calls give at most 2 PATCHes.
  - Evidence: The logic holds. But smoke mocks reply at once (capture.cjs mockApi), so the first PATCH can finish before the second selectOption, and three PATCHes are legitimate. FH would be flaky or vacuous.
  - Correction: In FH, delay the PATCH route by about 800 ms (as FF does) before the three selectOption calls. Then assert exactly 2 PATCHes and that the second body holds the last value.
- [confirmed] Settings' and Drawer's onRefreshSources (:2805, :2838) become () => refresh({silent:true}) so FeedManager's await onRefresh() really waits; the 'refreshed' toast fires on every poll.
  - Evidence: App.tsx:2805 and :2838 are `async () => { void refresh() }`, which resolve at once. App.tsx:1112 toasts on every refresh, and the interval at :1247-1249 and visibility at :1255-1257 call refresh().
  - Correction: None. refresh is a useCallback on [activeSources] (App.tsx:1119). Adding an opts parameter is safe for `onClick={refresh}`-style callers, because a MouseEvent has no .silent.
- [needs_change] Polling overlay: record startedAt, keep the local row for ids written at or after startedAt, and drop ids deleted at or after startedAt, so a poll that began before a save cannot undo it.
  - Evidence: App.tsx:1057-1102: setSources(prev => reconcileById(prev, s)), and reconcileById (:106-113) returns exactly next's ids. The overlay covers PATCH and DELETE, but not rows added from the Add or Suggested tabs. A background poll that started before createSource and resolves after onAdded's refresh removes the new row for up to 60 s. Overlapping refreshes (interval, visibility, filter debounce, manual) can also resolve out of order.
  - Correction: Add a monotonically increasing refresh sequence. Apply a result only if its seq is greater than the last applied seq; drop older ones. Keep the per-id write and delete overlay. Also record insert times (insertSource, and after createSource/autoAddSource) and keep those rows when the poll lacks them.
- [needs_change] removeSource(id): filter it out of sources, record the delete time, dropSource(id); this keeps the dashboard right after Delete.
  - Evidence: Today Delete calls await onRefresh(), which refetches entries (FeedManager.tsx:415-425). Under the plan, entries and forYou still hold the deleted feed's items. byCategory falls back to `categoriesBySourceId.get(e.source_id) ?? 'other'` (App.tsx:723-726, 753-760), so those stories jump into an 'Other' column until the next poll. activeSources and filterPresets[].activeSources also keep the dead name.
  - Correction: removeSource also runs setEntries(prev => prev.filter(e => e.source_id !== id)) and the same for forYou. It removes the name from activeSources and from each preset's activeSources, then calls refresh({silent:true}).
- [confirmed] onSourceRenamed also remaps filterPresets[].activeSources with prefs.setFilterPresets via filterPresetsRef (App.tsx:627, 1994-2003).
  - Evidence: App.tsx:1994-2003 remaps only activeSources. filterPresetsRef is at :627, synced at :647-649. App calls the setter as setFilterPresets (destructured; see :1690, :1701, :1712).
  - Correction: Call setFilterPresets(filterPresetsRef.current.map(...)), not prefs.setFilterPresets, and add setFilterPresets to the useCallback deps.
- [needs_change] Closing mid-save: blur the active element, run the editor flushers, then onClose(); nothing waits; a failure with nobody subscribed raises a dashboard toast with Open.
  - Evidence: Settings.tsx:186 `if (!open) return null` unmounts the editor, so a store that lives outside React is required, and the blur-first order is right. Today closeSettings pushes a history entry (App.tsx:438-444) and the tab strip calls replaceState(null) (Settings.tsx:241), as the plan says. Toast.tsx shows one toast at a time (:85-95), so a second onFailedAway replaces the first.
  - Correction: Keep the design. Batch onFailedAway per source over one tick into a single toast, for example 'Couldn't save 2 changes for The Verge' with Open. Keep the failed value and error in the store, so the editor restores the draft and the error message when reopened from Open. Otherwise reopening shows the server value with no explanation.
- [needs_change] Headers commit when focus leaves the whole group (onBlur on the container with !contains(relatedTarget)); iOS gives a null relatedTarget when tapping outside, which also commits.
  - Evidence: WebKit on iOS and macOS does not focus a <button> on tap or click. Tapping the in-group remove button, Add header or a preset therefore fires focusout with relatedTarget null, and the group commits before the button's onClick runs. If one row has a name and no value, that commit fails 'Fill in both' and the preset's own commit fails as well, because the whole map is sent or nothing is. The same applies to the Undo and Try again buttons under text fields: tapping Undo first blurs the field, which re-commits the rejected draft.
  - Correction: Give every in-group or in-editor button onPointerDown={e => e.preventDefault()} so focus stays in the input. Or set a pointerdown flag on the group container and skip the commit while it is set. Add a flow: type a name, tap 'Use a browser identity', and expect exactly 1 PATCH.
- [needs_change] commitField step 1: compare with queued, then in-flight, then getSource(id)[field]; if equal, nothing is sent.
  - Evidence: Design only. Two gaps found against the code. (1) The server rewrites url: _validate_reddit_url canonicalises to https://www.reddit.com/r/<slug> (sources.py:244-263), and the Apple and YouTube resolvers return a different URL (sources.py:688-699). If the draft keeps what was typed, every later blur compares it with the canonical value, re-sends the PATCH, re-resolves over the network and re-runs ingest. (2) A value rejected with a 4xx (409 name clash) is re-sent on every blur.
  - Correction: After a successful save, set the text draft to row[field] when the field is not focused. For any field, reseed from the server only when it is not focused, not queued or in flight, and not in error. Record lastRejected[field]=value for non-retryable 4xx and skip an identical commit until the value changes or Try again is tapped.
- [needs_change] getSaveState(id, field) + subscribe(id, field, cb) for useSyncExternalStore.
  - Evidence: React 18.3.1 under StrictMode (package.json:14, main.tsx:8). useSyncExternalStore re-renders forever if getSnapshot returns a new object on each call for an unchanged state.
  - Correction: getSaveState returns a frozen module-level IDLE constant for unknown keys and the same object until that key's state changes. The subscribe passed to useSyncExternalStore is memoised per (id, field). Add a unit test that two calls return the identical object.
- [confirmed] Validation and 422 mapping for headers mirrors the backend: deny list of exactly 9 names, 20 entries, 512 characters, ASCII after normalisation; null and {} both clear.
  - Evidence: sources.py:169-187 (deny list), :192-193 (20 and 512), :207 (_BAD_HEADER_VALUE_RE), :306-354 (`return out or None`), :754-759 (explicit null leads to None). Messages: "header 'X' cannot be overridden per-source", "value exceeds 512 chars", "contains disallowed characters", "may have at most 20 entries".
  - Correction: None. The plan's substrings match these messages.
- [confirmed] Headers are shown for rss, podcast, youtube_channel and generic_scrape, but not reddit or built-ins.
  - Evidence: Headers are used by dynamic_rss.py:71, podcast.py:43, youtube.py:42 and generic_scrape.py:391/475. dynamic_reddit.py:171 calls reddit_client.fetch_subreddit without them. (The comment at sources.py:705-711 saying generic_scrape ignores headers is stale.)
  - Correction: None.
- [confirmed] Add 'rfd_hot_deals' to KNOWN_BUILT_INS; a no_db guard test pins KNOWN_BUILT_INS to registered_plugin_names() (7 names).
  - Evidence: FeedManager.tsx:108-115 lists 6 names. The registry names are cisa_kev, github_releases, hn_top, nvd_recent, rfd_hot_deals, bbc_news and wikipedia_on_this_day (rfd.py:177 and the other plugin files). registered_plugin_names is `from app.sources import list_sources as registered_plugin_names` (routes/sources.py:49).
  - Correction: The registry fills only as plugin modules are imported, so the no_db test must import app.routes.sources (or app.main) before calling list_sources(). Otherwise it compares against an empty or partial set.
- [needs_change] FeedEditor.tsx (new file) uses REFRESH_PRESETS, isBuiltIn/KNOWN_BUILT_INS, refreshLabel, and CATEGORY_OPTIONS from FeedManager.tsx.
  - Evidence: In FeedManager.tsx these are module-private and not exported (:57, :80-105, :108-119, :121-128, :135-155). Exporting them from a component file adds react-refresh/only-export-components warnings; tested with eslint --stdin, 2 warnings for an exported Set plus a function. The lint baseline is exactly 6 warnings (verified). FeedManager importing FeedEditor while FeedEditor imports FeedManager is also circular. lib/categories.ts is meant to have no imports but needs CATEGORY_OPTIONS.
  - Correction: Move these constants and helpers (and timeAgo/isStale) to a new import-free lib/feedRules.ts, or put CATEGORY_OPTIONS in lib/categories.ts. Both FeedManager and FeedEditor import from there. Point the guard test's KNOWN_BUILT_INS regex at that file.
- [refuted] `export const SETTINGS_TABS = [...] as const` in Settings.tsx is fine because allowConstantExport permits it.
  - Evidence: Ran eslint --stdin with the repo config: `export const SETTINGS_TABS = ['feeds','llm'] as const` next to a component gives a react-refresh/only-export-components warning. allowConstantExport covers only primitive literals. That would be warning 7 against the plan's 'at most the 6 of the baseline'.
  - Correction: Put SETTINGS_TABS and SettingsTab in a non-component module (for example lib/settingsTabs.ts) and import it from Settings.tsx and App.tsx.
- [refuted] CI/unit: `node --experimental-strip-types --test scripts/unit/` runs the sourceSaves, categories and headers tests.
  - Evidence: Reproduced on Node v22.22.0 (CI pins node-version "22", build.yml:111). A directory argument fails with `Cannot find module '.../scripts/unit'` and 'not ok 1 - scripts/unit'. The glob form `node --experimental-strip-types --test 'scripts/unit/*.test.ts'` passes. frontend/package.json has "type": "module" and tsconfig has allowImportingTsExtensions, so `import … from '../../src/lib/x.ts'` works.
  - Correction: Use `node --experimental-strip-types --test 'scripts/unit/*.test.ts'` in §13, the build.yml step and the PR 4 acceptance. Note that the lib modules must use erasable TS only (no enum, namespace or parameter properties), because type stripping rejects them.
- [confirmed] FeedManager.tsx must use only string-literal placeholders because slice15 reads the first `placeholder={`.
  - Evidence: test_frontend_slice15_add_generic_scrape.py:212-230 runs re.search(r"placeholder=\{([\s\S]+?)\}") on the whole file and then requires the generic_scrape branch value. The [name, url, sourceType] deps and `new URL(trimmedUrl)` are pinned at :169-188, and the 'Track page'/'no RSS' label at :120-136.
  - Correction: None.
- [needs_change] FeedEditor 'Last problem' shows e.g. 'upstream returned HTTP 403'; a browser-identity button appears when last_error matches /\b(401|403)\b|forbidden/i.
  - Evidence: last_error has the form '[<category>] <ExcType>: <first line, 200 chars>' (scheduler.py:220-241, :519-527), for example "[blocked] HTTPStatusError: Client error '403 Forbidden' for url 'https://…'". The regex matches, but the text shown is developer text, which conflicts with the plain-words requirement.
  - Correction: Match /^\[blocked\]/ (this also covers 402). Map the category prefix to a plain sentence: blocked: 'The site refused Popping (HTTP 403).' not found: 'The address returned Not Found.' network: 'Couldn't reach the site.' upstream error: 'The site had a server error.' Put the raw text behind the More toggle.
- [needs_change] _validate_category returns the stripped value; POST (:469->:518), /auto (:608->:617) and PATCH (:752->:779) store it.
  - Evidence: /auto also stores body.category in its generic_scrape branch at sources.py:638. The feed-recommendations discover route calls _validate_category at :1143 and uses category at :1152.
  - Correction: Store the returned value at :638 too, and at :1143-1152, or confirm there that the value comes in stripped.
- [needs_change] The open row stays put while editing; one openRowId; li id feed-<id>.
  - Evidence: applyServerSource maps in place, but every 60 s poll replaces the order with the server's ORDER BY category, name (sources.py:397). After a category change or rename, the open editor's row moves within the list while the user edits it (MyFeedsTab renders sources.map in array order, FeedManager.tsx:318-340).
  - Correction: MyFeedsTab sorts with a stable local order: by name, or freeze the order captured while a row is open. Or scroll the open row back into view only when its index changes.

Additions:
- frontend/src/api.ts:117-147: add sitemap_url and link_pattern (string | null) to the Source interface; the backend already returns them (backend/app/schemas.py:28-34).
- frontend/src/components/FeedEditor (new): hide the refresh-interval select for built-ins or make it read-only. Built-in jobs use plugin_cls.refresh_interval_seconds (backend/app/scheduler.py:1802, :500), and update_source returns before any job change for registered names (scheduler.py:2437-2442).
- lib/sourceSaves.ts (new): treat a pending 2 s network retry as busy, so whenIdle, pump and the step 1 equality check all see it. Otherwise Delete or Check now can run during the gap.
- lib/sourceSaves.ts (new): while pageHiding, send every queued item at once with keepalive and don't wait for the in-flight PATCH. Call pump synchronously inside the visibilitychange/pagehide handler.
- lib/sourceSaves.ts (new): getSaveState must return a stable snapshot (a module-level IDLE constant, and the same object until it changes) for useSyncExternalStore under React 18.3.1 StrictMode (frontend/src/main.tsx:8).
- lib/sourceSaves.ts (new): remember the last value rejected with a non-retryable 4xx per field and do not re-send it on later blurs until it changes or Try again is tapped.
- FeedEditor text fields: after a successful save, set the draft to the server's value (reddit canonicalisation sources.py:244-263; Apple and YouTube resolution sources.py:688-699). Reseed from the server only when the field is not focused, queued, in flight or in error.
- FeedEditor and HeadersEditor: give every button inside the group or editor (remove, Add header, presets, Undo, Try again, Add/Cancel in New category) onPointerDown preventDefault. WebKit does not focus buttons on tap, so focusout reports a null relatedTarget and commits before the click. Add a flow that taps a preset while one header row is half-filled and expects exactly 1 PATCH.
- lib/apiErrors.ts fieldSaveMessage: check 'reserved for a built-in source' before the generic 'built-in' 400 (sources.py:681-685 vs :765-771). Map 404 'source not found' (sources.py:666, :797) to 'This feed was deleted.' and call removeSource. Map the name-regex, url-scheme, reddit and link_pattern 422s (sources.py:111-116, :220-228, :256-262, :722-731) to plain words.
- App.tsx removeSource: also prune entries and forYou by source_id, because otherwise they fall into an 'Other' column via `?? 'other'` at App.tsx:753-760. Remove the name from activeSources and from each filterPresets[].activeSources, then call refresh({silent:true}).
- App.tsx refresh (App.tsx:1057-1119): add a sequence guard that drops results older than the last applied refresh. Extend the overlay to recently inserted rows (createSource, autoAddSource, Suggested add) so a stale poll cannot hide a just-added feed.
- App.tsx onSourceRenamed: call setFilterPresets (destructured; see App.tsx:1690), not prefs.setFilterPresets, and add it to the deps.
- onFailedAway: batch per source over one tick into one toast, because Toast.tsx keeps a single current toast. Keep the failed value in the store so Open restores the draft and the error.
- MyFeedsTab: keep row order stable while a row is open, because polls reorder by category and name (sources.py:397) after a recategorise or rename.
- Move KNOWN_BUILT_INS, REFRESH_PRESETS, CATEGORY_OPTIONS, isBuiltIn, refreshLabel, timeAgo and isStale out of FeedManager.tsx (:57-155) into an import-free lib module. Exporting them from a component file adds react-refresh warnings beyond the 6-warning baseline (verified), and FeedEditor importing FeedManager is circular. Point the KNOWN_BUILT_INS guard test at the new path.
- Put SETTINGS_TABS in a non-component module. Exporting it from Settings.tsx adds a react-refresh warning (verified with eslint --stdin).
- §13, build.yml and PR 4 acceptance: run `node --experimental-strip-types --test 'scripts/unit/*.test.ts'`. The directory form fails on Node 22.22.0 (verified). Keep lib modules to erasable TS syntax.
- backend/tests/test_frontend_feed_editor_rules.py: import app.routes.sources (or app.main) so the plugin registry is populated before calling list_sources().
- PR 1 _validate_category return value: also store it in /auto's generic_scrape branch (sources.py:638) and the discover route (sources.py:1143-1152).
- FeedEditor Last problem: parse the '[category] ExcType: msg' format (scheduler.py:220-241, :519-527) into plain sentences; trigger the browser-identity button on /^\[blocked\]/.
- Flow FH: delay the PATCH route (about 800 ms) so coalescing is actually exercised; assert exactly 2 PATCHes, the second carrying the last value.
- Flow FK: assert there is no interval select (or a read-only interval) on the built-in fixture.
- Low, pre-existing: _ingest finds the row by plugin name (scheduler.py:117-133). An ingest already running when a rename commits can recreate a phantom row under the old name. Autosave sends one rename on blur, as today, so the risk is unchanged. Note it in Risks.

### Headers editor (§8, F3, the headers parts of §6 and PR 1): backend _validate_custom_headers, PATCH null-vs-omitted handling, SourceOut.custom_headers, which plugins honour headers, the Add form and recommendations default_headers path, the test-fetch path. Checked against origin/main 721713e. The working tree differs from it only under frontend/scripts/iphone-audit.

- [confirmed] The header deny list is at sources.py:169-187 and holds exactly cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url and x-rewrite-url, compared lower-cased. The UI can mirror it and a no_db guard test can pin it.
  - Evidence: backend/app/routes/sources.py:169 _HEADER_DENYLIST={cookie,authorization,host}; :177-186 _HEADER_DENYLIST_EXTRA (6 x-* names); :187 _HEADER_DENYLIST_ALL is the union. :330 checks k.lower() in _HEADER_DENYLIST_ALL.
  - Correction: None needed. The guard test should also check the other direction: every name in headers.ts HEADER_DENYLIST is in _HEADER_DENYLIST_ALL. That way a UI-only ban cannot drift silently.
- [confirmed] The backend accepts blank or arbitrary header keys today (sources.py:325-334). The new token-format name rule and the case-insensitive duplicate rule close this gap.
  - Evidence: sources.py:324-353 checks only isinstance(str), the deny list, value length (512) and _BAD_HEADER_VALUE_RE on VALUES (:208). Header NAMES are never pattern-checked. '', 'Bad Header', 'X\r\nY' and non-ASCII names are all stored. Case variants ('X-A', 'x-a') are both kept.
  - Correction: Keep the change. Also cap name length (for example 100 characters, mirrored in headers.ts and pinned by the guard test). Today the only limit on names is the request body size, while values are capped at 512.
- [confirmed] {} and null both clear: the backend stores both as NULL (sources.py:354, :754-759). An omitted custom_headers is left untouched (model_fields_set).
  - Evidence: sources.py:354 `return out or None`, so {} becomes None. :753-759: headers=_UNSET unless 'custom_headers' in body.model_fields_set; an explicit null becomes None. scheduler.py:2331-2334 headers_changed compares against row.custom_headers; :2400-2403 assigns only when not _UNSET. tests/test_source_patch_unset_regression.py:41-57 already pins 'category PATCH leaves custom_headers untouched'.
  - Correction: None needed for the semantics. In PR 1, also fix the misleading comment at schemas.py:186-188 (SourceUpdate), which says '``None`` leaves the column untouched'. An explicit null clears it. This is comment-only, so it fits the 'docstrings only' allowance. Also fix the api.ts:432-436 comment as planned.
- [needs_change] Headers are honoured by rss, podcast, youtube_channel and generic_scrape; reddit (dynamic_reddit.py:171) and built-ins ignore them. The editor shows Headers only for those four types on non-built-in rows.
  - Evidence: Honoured fully: dynamic_rss.py:71, sources/podcast.py:43 and sources/youtube.py:42 all call fetch_rss(url, headers=row.custom_headers), which merges at rss.py:375. Reddit: dynamic_reddit.py:171 reddit_client.fetch_subreddit(sub, ...) takes no headers. Built-ins (rss.py:537 BbcNews etc., rfd.py:168) call fetch_rss(self.url) with no row headers. generic_scrape honours headers only for article-page fetches (generic_scrape.py:475 → _extract_one → fetch_html(custom_headers)). Sitemap discovery (:435 discover_sitemap_urls) and page_links discovery (:343 fetch_html(page_url)) send default headers only. The Test probe also ignores headers (sources.py:996-1004). fetch_html swallows HTTP errors and returns None (article_extract.py:118-120), so a generic_scrape row never gets a 403 last_error.
  - Correction: Keep Headers visible for generic_scrape, but give it a footnote: 'Used when Popping opens each article. The site's page list is still read without these.' Do not promise that Test reflects headers for 'Website' rows. Also correct the stale comment at sources.py:711-715, which says headers are 'stored-but-ignored for generic_scrape' and contradicts the B4 fix.
- [needs_change] F3 / FeedEditor 'Last problem' shows 'upstream returned HTTP 403' and offers 'Use a browser identity' when last_error matches /\b(401|403)\b|forbidden/i.
  - Evidence: 'upstream returned HTTP {code}' is the Test endpoint's text (sources.py:1023). The stored last_error is built at scheduler.py:522-527 as `[{category}] {ExcType}: {msg[:200]}`, so a 403 reads "[blocked] HTTPStatusError: Client error '403 Forbidden' for url 'https://…'". _classify_error (scheduler.py:231-234) also marks 402 as 'blocked'.
  - Correction: Detect a block with /^\[blocked\]/ OR /\b40[123]\b/. Do not show the raw text: map the prefix to plain words in lib/apiErrors.ts, for example [blocked] → 'This site is refusing Popping (HTTP 403).', [not found] → 'The address no longer exists (HTTP 404).', [network] → 'Couldn't reach the site.' Show the raw string only behind 'More'. Fix the F3 wording in §5 to match.
- [needs_change] The plan's header-name regex ^[!#$%&'*+.^_`|~0-9A-Za-z-]+$ (fullmatch, RFC 7230 token) with message `header {k!r} isn't valid`, and the duplicate message `header {k!r} is listed twice`.
  - Evidence: The regex is the correct token set. The fieldSaveMessage table in §6 maps 'isn't valid' but has no row for 'listed twice', so that detail falls through to 'the detail as is' and shows the raw text "header 'x-a' is listed twice".
  - Correction: Add the row 422 'listed twice' → 'Already added.' Prefer explicit wording that cannot collide with other details, for example `header name {k!r} is not a valid HTTP header name`, and match on 'not a valid HTTP header name'. Run the name check before the deny-list check, so 'Coo kie' reports as invalid rather than slipping through.
- [needs_change] Test-fetch path: the Add form sends its local headers map to api.testSource (api.ts:389-400, already accepted), and the forbidden hint tells the user to add a browser identity and Test again.
  - Evidence: api.ts:387-395 accepts custom_headers. sources.py:966-981 validates them, but on failure returns error_kind="unknown" with the raw detail. FeedManager.tsx:184-186 then renders 'Something went wrong — header 'Cookie' cannot be overridden per-source'. Headers reach fetch_rss for rss/podcast/youtube (:995). They are ignored for generic_scrape (:1004). For reddit they go to a non-existent app.sources.reddit.fetch_subreddit (sources/reddit.py defines only normalize_subreddit), which PR 1 replaces with reddit_client.fetch_subreddit, which takes no headers. The forbidden hint is at FeedManager.tsx:171, not :174.
  - Correction: In PR 1, return error_kind='invalid_headers' from /test on header validation failure, add it to the SourceTestResult docstring (schemas.py:212+) and to the api.ts:158-167 union, and map it in friendlyTestError. In local mode the Add form must run the same headers.ts validation before Test and Add. If any row is half-filled or invalid, block both buttons and show the row error. Otherwise rowsToMap silently drops the incomplete row and the user believes a User-Agent was sent. Send custom_headers only when the selected type is rss, podcast, youtube_channel or generic_scrape, so switching to Reddit does not post a hidden map.
- [needs_change] Discrete controls (category, interval, pause, header remove and presets) roll back to the saved value on failure, because the store has no pending value. HeadersEditor reseeds only when no input is focused, no save is pending, and the server map differs from the last seeded map.
  - Evidence: The HeadersEditor rows are component state seeded from Object.entries(value). After a failed remove or preset, the server map has not changed, so it still equals the last seeded map and the reseed rule never fires. The removed row stays gone on screen while the server keeps it. In the other direction, after a successful save the server map differs from the last seeded map, so a reseed fires. Postgres JSONB (models.py:93) returns keys sorted by length and then bytewise, so rows can reorder and remount (new keys), losing the user's order.
  - Correction: Treat headers like the text fields: on error, keep the draft rows and show the message with Undo (reseed from source.custom_headers) and, for network or 5xx, Try again. On a successful commit, set lastSeeded = canonical(sent map), so the server echo does not trigger a reseed. When a reseed does happen, keep the existing row order for keys that are still present and append new keys.
- [needs_change] Commit trigger: onBlur on the group container when !e.currentTarget.contains(e.relatedTarget). iOS gives a null relatedTarget when tapping outside, which also commits.
  - Evidence: iOS and macOS Safari do not focus <button> on tap, so tapping the in-group 'Add header', remove (−) or preset buttons also gives relatedTarget=null. The group then 'commits' mid-edit. On a half-filled row this flashes 'Fill in both to save this header.' just as the user adds a row. A remove tap while another input is focused sends two PATCHes (a blur commit, then a remove commit). The store only coalesces items that are queued and not yet started.
  - Correction: Put onPointerDown={e => e.preventDefault()} on every button inside the headers group, so focus stays in the input and no focusout fires. Or defer the check one frame with requestAnimationFrame and commit only if document.activeElement is outside the group. Suppress the 'fill in both' error until focus has actually left the group. Add a flows.cjs case: type a name, tap Add header, expect 0 PATCHes and no error.
- [confirmed] Header values are stored and returned as plain text by GET /api/sources (SourceOut.custom_headers), and the editor warns against secrets.
  - Evidence: schemas.py:44 SourceOut.custom_headers: Optional[dict]; sources.py:393-404 list and :777-797 the PATCH response return it unmasked. main.py:290 applies require_user only when settings.oidc_enabled, so without OIDC the values are readable by anyone who can reach /api.
  - Correction: Keep the warning. The plan's wording is right.
- [confirmed] The recommendations default_headers path keeps working under the new rules.
  - Evidence: FeedManager.tsx:1039-1051 forwards rec.default_headers as custom_headers to POST /api/sources. The only seeded value is cbc_top {"User-Agent": "Mozilla/5.0 … Chrome/126…"} (alembic 0017:53-58). It passes the token rule, has no duplicates and is under 512. feed_recommendations.py:111 only reads the column. The plan never mentions this path.
  - Correction: Name it in PR 1. Add a test_source_editor_contract case: POST with the cbc_top default_headers returns 200. Route the Suggested-tab add error through reportError, as planned for onError.
- [needs_change] Presets 'Use a browser identity' (Safari 18 User-Agent) and 'Prefer English' (Accept-Language: en-CA,en;q=0.9), each hidden when that header already exists (case-insensitive).
  - Evidence: Both values pass _BAD_HEADER_VALUE_RE and the 512 limit. But fetch_rss merges with a case-sensitive dict, {**_DEFAULT_HEADERS, **headers} (rss.py:375; defaults 'User-Agent' and 'Accept' at rss.py:44-47), and fetch_html does the same at article_extract.py:98-100. If a user types 'user-agent' in lower case, both keys survive. httpx Headers keeps both entries, so two User-Agent headers go out, the Popping/0.2 one first, and a blocked site stays blocked.
  - Correction: Canonicalise names in _validate_custom_headers: a lower-case match to user-agent, accept or accept-language is rewritten to 'User-Agent', 'Accept' or 'Accept-Language'. Simpler still, title-case each dash-separated part. Mirror this in headers.ts canonicalName() so the row shows what will be stored. Add a backend test: {'user-agent': 'X'} is stored as {'User-Agent': 'X'}. This avoids touching rss.py and article_extract.py, which are outside the allowed path list.
- [needs_change] Row layout: name input with autoCapitalize=none autoCorrect=off spellCheck=false at 17px; value input (placeholder 'Value'); values have smart punctuation normalised.
  - Evidence: The plan gives the iOS text attributes only for the name input. The value input holds User-Agent strings, where iOS autocapitalisation and autocorrect would alter tokens ('Khtml', 'Gecko,'). The old textarea (FeedManager.tsx:637-645) set only spellCheck={false}.
  - Correction: Give the value input the same attributes: autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done", type="text". Apply the dash and quote normalisation to names as well as values before validation.
- [needs_change] Add form: a <details> with <summary className="min-h-[44px] flex items-center …"> holds <HeadersEditor mode="local">.
  - Evidence: Older WebKit does not reliably lay out <summary> as a flex container and shows the native disclosure marker unless it is hidden with list-style:none and ::-webkit-details-marker. The guard's C7 measures [role=button] and button elements. A bare <summary> matches neither, so its 44px height is not enforced.
  - Correction: Use a <button type="button" aria-expanded aria-controls> toggle (44px, matching the CategoryPicker and FeedEditor patterns) instead of details/summary. If details is kept, put the flex layout on an inner <span>, hide the marker, and add 'summary' to C7's selector list.
- [confirmed] Backend tests for headers: POST and PATCH reject 'Bad Header', '' and 'Cookie' and accept 'X-Ok'; {'X-A':'1','x-a':'2'} gives 422; \r\n gives 422; 21 headers give 422; 513 characters give 422; null and {} both clear.
  - Evidence: No existing test covers the deny list, CRLF or limits (grep for 'cannot be overridden' and 'disallowed characters' in tests/ finds nothing). The only fixture key in use is 'X-Test-Header' (test_source_patch_unset_regression.py:39), which passes the new token rule, so existing tests keep passing.
  - Correction: Add these cases: /api/sources/test with an invalid header returns error_kind 'invalid_headers'; a lower-case 'user-agent' is canonicalised; a name over the length cap gives 422; the cbc_top default_headers POST gives 200; a PATCH of custom_headers on a built-in row is accepted (stored, ignored) and not 400, so the UI hiding is a UI choice only.

Additions:
- backend/app/routes/sources.py:169-187 (PR 1): extend the deny list with framing and hop-by-hop names: content-length, transfer-encoding, connection, keep-alive, te, trailer, upgrade, expect, proxy-authorization, proxy-connection. A user-set Content-Length or Transfer-Encoding on a GET makes h11 fail or mis-frame the request. Proxy-* headers would reach the optional squid guard-proxy (docker-compose.yml:69-75, egress-proxy/squid.conf) for plain-http feeds. Mirror the list in headers.ts and pin both directions in test_frontend_feed_editor_rules.py. This hardening fits owner requirement 8 and touches only allowed files.
- backend/app/routes/sources.py:306-354 (PR 1): add a header-name length cap (for example _HEADER_NAME_MAX = 100) and canonicalise known names (user-agent→User-Agent, accept→Accept, accept-language→Accept-Language). rss.py:375 and article_extract.py:98-100 merge case-sensitively, so a lower-case key sends a duplicate User-Agent.
- backend/app/routes/sources.py:966-981 (PR 1): return error_kind='invalid_headers' instead of 'unknown' on header validation failure. Document it in schemas.py SourceTestResult, add it to the api.ts:158-167 union, and map it in friendlyTestError.
- backend/app/schemas.py:186-188 and backend/app/routes/sources.py:711-715: fix the stale comments (an explicit null clears custom_headers; generic_scrape does use headers for article fetches since B4).
- frontend lib/apiErrors.ts (PR 4): add lastErrorMessage(last_error) that maps the scheduler's '[blocked]', '[not found]', '[upstream error]', '[network]' and '[http error]' prefixes (scheduler.py:220-242, :522-527) to plain sentences. Raw 'HTTPStatusError: Client error …' text appears only behind 'More'. The browser-identity button keys off '[blocked]', which also covers 402.
- frontend fieldSaveMessage table (§6): add 'listed twice' → 'Already added.' and the new 'not a valid HTTP header name' and name-length messages.
- HeadersEditor (§8): on a commit error keep the draft rows, with Undo and Try again, instead of 'show the saved value'. Set lastSeeded to the committed map on success. Keep the user's row order across reseeds, because JSONB (models.py:93) reorders keys by length.
- HeadersEditor (§8): put onPointerDown preventDefault on the in-group Add header, remove and preset buttons, or use a rAF activeElement check. Without it, iOS Safari's null relatedTarget on button taps commits mid-edit. Add a flows.cjs case: type a header name, tap Add header, expect 0 PATCHes and no 'Fill in both' error.
- Add form (FeedManager.tsx AddCustomTab, PR 4): in local mode, validate the headers with headers.ts before Test and Add, and disable both with the row error shown when any row is incomplete or invalid. Send custom_headers only for rss, podcast, youtube_channel and generic_scrape. Clear the local headers map when the type changes to reddit.
- FeedEditor (§6 item 6): for generic_scrape rows, add the footnote that headers apply to article pages only, not to sitemap or page discovery (generic_scrape.py:343, :435) or to Test (sources.py:996-1004). For reddit rows that already store custom_headers from the old JSON textarea, there is no UI to clear them. That is harmless because reddit ignores them, but say so in the PR body.
- Existing rows may already store header names that fail the new token rule. The UI will seed them, and any headers commit is then blocked until the bad row is fixed or removed. Show the row error at once on open (not only after blur), so the user knows why nothing saves. Add a flows case with a fixture source whose custom_headers has {'Bad Header': 'x'}.
- test_source_editor_contract.py (PR 1): add cases for cbc_top default_headers POST → 200 (alembic/versions/0017_feed_recommendation_candidates.py:53-58); lower-case 'user-agent' stored canonically; /test with a 'Cookie' header → error_kind 'invalid_headers'; omitting custom_headers on a PATCH of url leaves the map unchanged (alongside the existing category-only test at test_source_patch_unset_regression.py:41-57).
- Value input in HeadersEditor: autoCapitalize=none, autoCorrect=off, spellCheck=false, enterKeyHint=done, so iOS cannot alter User-Agent strings. Replace the <details>/<summary> Advanced toggle with a 44px aria-expanded button, so the C7 tap-target rule covers it.

### Top bar and navigation: gear removal, Menu as the only Settings entry, Drawer rows, pushState/popstate, Back closing, chip bar, search/refresh placement, keyboard shortcuts, other openSettings callers. Working tree frontend/src matches origin/main 721713e (no diff), so the line numbers below are baseline lines.

- [needs_change] PR 3 deletes the gear at App.tsx:2296-2331 (comment, data-settings-gear button, SVG)
  - Evidence: App.tsx:2296 is the Refresh button's <RefreshIcon> and 2297 is its </button>. 2298 is blank, the gear comment starts at 2299, data-settings-gear is at 2309, and the gear's </button> is at 2329. Lines 2330-2332 are the three-line Hamburger comment, and <Hamburger> is at 2333.
  - Correction: Delete App.tsx:2298-2329 only. If the Hamburger comment is removed too, remove all of 2330-2332. Deleting only 2330-2331 leaves a dangling `*/}` and breaks the JSX. Deleting from 2296 breaks the Refresh button.
- [confirmed] Nothing else references the gear
  - Evidence: `data-settings-gear` appears only at App.tsx:2309. No backend test reads it: the only backend tests that read App.tsx are test_slice21_column_memo.py and test_frontend_slice19, and neither touches the header. The aria-label "open settings" is used by frontend/scripts/iphone-audit/capture.cjs:486 and probe.cjs:72.
  - Correction: None for src. Update capture.cjs:486 and probe.cjs:72 to Menu → Settings in the same PR 3 commit, or the audit scripts fail. The plan already lists this.
- [confirmed] The only openSettings callers are App.tsx:2307 and :2811; no keyboard shortcut or BriefCard pill opens Settings
  - Evidence: A grep of src finds openSettings defined at App.tsx:430 and called at 2307 (gear) and 2811 (Drawer's onOpenSettings). The Drawer calls it at Drawer.tsx:345 ('history') and :384 (no arg). The keydown handler (App.tsx:1753-1894) handles / ? Esc, the arrows, Enter, m, s, b, h and r, and none of them opens Settings. ShortcutsSheet has no settings entry.
  - Correction: None. The new signature openSettings(tab='feeds', sourceId?) stays compatible with `(tab) => openSettings(tab ?? 'feeds')` at 2811.
- [confirmed] Done re-pushes history so Back reopens Settings (App.tsx:438-444); Settings.tsx:241 replaceState(null) wipes the flag
  - Evidence: closeSettings (App.tsx:438-444) calls pushState(null,…) after deleting view and tab. Settings.tsx:241 calls replaceState(null, '', u), then :246 dispatches a synthetic popstate. No other code writes history.
  - Correction: None.
- [needs_change] openSettings pushes {popping:'settings'}; closeSettings calls history.back() when that state is present, else replaceState; one Back never reopens Settings
  - Evidence: In PR 4, onFailedAway's toast 'Open' action calls openSettings('feeds', id), and the toast sits at z-[60], above the open Settings sheet (z-50). Calling openSettings while Settings is open pushes a second settings entry. Done → back() then lands on the first settings entry, so Settings stays open on the old tab and Done needs two taps. Also, history.back() is async: the plan's close path only calls back(), so the sheet stays up until popstate arrives. That contradicts F8's 'Settings closes immediately'. sync() (App.tsx:395-424) currently never clears any source state.
  - Correction: (a) In openSettings, if the current URL already has view=settings, use replaceState(window.history.state ?? {popping:'settings'}, '', url) instead of pushState. Read the URL, not state, so the useCallback keeps empty deps. (b) In closeSettings, call setSettingsOpen(false) and setSettingsSourceId(null) synchronously in both branches, then back() or replaceState. (c) In sync(), set settingsSourceId to null when `source` is absent or view≠settings. (d) Add a flow-FG variant: open from the Menu, trigger openSettings again while open, then Done → closed after one tap, and goBack keeps it closed.
- [refuted] export const SETTINGS_TABS = [...] as const from Settings.tsx is allowed by allowConstantExport
  - Evidence: eslint.config.js:39-41 sets react-refresh/only-export-components to 'warn' with allowConstantExport. In node_modules/eslint-plugin-react-refresh 0.5.3, skipTSWrapper strips `as const`, and constantExportExpressions is only {Literal, UnaryExpression, TemplateLiteral, BinaryExpression}. An ArrayExpression is not allowed, so Settings.tsx (which exports a component) gets a new warning. That breaks §13's 'warnings at most the 6 of the baseline'.
  - Correction: Put `SETTINGS_TABS` and `type SettingsTab` in a new src/lib/settingsTabs.ts with no component exports. Import it in App.tsx and Settings.tsx, and re-export the type from Settings.tsx (`export type { SettingsTab }`) so the Drawer import at Drawer.tsx:34 keeps working.
- [refuted] PR 3 acceptance: grep -rn 'data-settings-gear\|onResetLocalState' frontend/src is empty
  - Evidence: onResetLocalState is a live Settings prop: Settings.tsx:80 (type), :129 (destructure), :414 (the Reset tab calls it). App.tsx:2846 passes it to <Settings>. Only the Drawer prop (Drawer.tsx:61-66, 89-92; App.tsx:2810) is dead.
  - Correction: Replace it with: `grep -n 'onResetLocalState' frontend/src/components/Drawer.tsx` is empty, `grep -rn 'data-settings-gear' frontend/src` is empty, and App's <Drawer> call no longer passes onResetLocalState. Settings keeps its prop.
- [needs_change] PR 2 changes the search input to type="text" inputMode="search"
  - Evidence: App.tsx:1762, in the global keydown handler, clears search on Esc only when `ae instanceof HTMLInputElement && ae.type === 'search'`. With type=text, Esc inside the field no longer blurs or clears it, and the early return at 1767 swallows the key. The '/' shortcut (App.tsx:1769-1772) calls getElementById('app-search')?.focus(), but #app-search exists only while searchOpen (2230), so '/' already does nothing when search is collapsed.
  - Correction: In PR 2, change 1762 to `ae instanceof HTMLInputElement && ae.id === 'app-search'`. On Esc it should also call setSearchOpen(false), because onBlur at 2244 reads a stale non-empty searchInput. Change '/' to setSearchOpen(true) followed by the existing rAF focus. Add onKeyDown Enter → e.currentTarget.blur() so iOS's Search key dismisses the keyboard and keeps the query.
- [confirmed] Removing the gear gives the title 148px at 320 (R7)
  - Evidence: The header row is px-4 (App.tsx:2220), leaving 288px at 320. The cluster is gap-1 (2224) holding search, refresh (sm:hidden, so shown on phones) and Hamburger, all w-11: 3×44 + 2×4 = 140. 288 − 140 = 148.
  - Correction: None.
- [confirmed] Search row fix: h1 hidden while searchOpen below sm, cluster flex-1 min-w-0, pill flex-1 min-w-0 sm:w-72, refresh hidden while searching, clear ✕ w-11 h-11
  - Evidence: App.tsx:2221 h1 is truncate. 2231 pill is `w-44 sm:w-72`. 2294 refresh is `sm:hidden`. 2248-2257 clear button has no size and uses onMouseDown preventDefault, which must be kept.
  - Correction: Keep onMouseDown={e=>e.preventDefault()} on the enlarged clear button, or the blur at 2240-2245 races the click.
- [confirmed] Drawer line references (header 314-325, grabber 303-306, History 336-351, Save 366-376, All settings 377-390, Jump 393-409, footnote 415, Clear 420-426, sources 454-479, category 477, dead prop 61-66/89-92)
  - Evidence: Every range matches Drawer.tsx at baseline. Done (315-321) is min-h-[32px] min-w-[32px] with pl-10 on the leading edge. The grabber is `absolute top-3 left-2` (305).
  - Correction: When swapping title and Done: (1) move the grabber clearance from Done's pl-10 to the title (e.g. pl-3 md:pl-0 on the h2), because the grabber is at left-2 w-1 and only 4px from a px-4 title; (2) rewrite the stale comments at Drawer.tsx:266-273 (says Done is rendered first) and 307-313 (says title on the right, Done on the left), as well as 3-9, 71-75 and 257-261; (3) keep aria-label="close menu", which firstFocusableRef (274-276) and capture.cjs:482 query.
- [needs_change] Menu: Settings row first ('gear icon'), replacing All settings…
  - Evidence: GroupedRow (Drawer.tsx:556-604) takes only title, subtitle, onClick, showChevron and tone; it has no icon slot. The group label is 'Quick settings' (Drawer.tsx:335), which reads oddly above a row called Settings.
  - Correction: Add an optional `icon?: React.ReactNode` to GroupedRow, rendered shrink-0 before the text, or drop 'gear icon' from the spec. Rename the section label (e.g. no label, or 'Menu') in the same PR.
- [needs_change] Sign out row in the Menu when user is set, mirroring UserBadge
  - Evidence: UserBadge.tsx:5-10 says that for auth_method 'bypass' sign-out is a no-op server-side. After the plan's reload the user is signed straight back in, so the row would do nothing. LoginPage.tsx:72 (username) still autocapitalises until PR 5. The audit says this makes local sign-in fail ('Adam'), yet Sign out ships on the phone in PR 3.
  - Correction: Pass onSignOut only when `user && user.auth_method !== 'bypass'`. Move the LoginPage.tsx:72/84 iOS attributes (autoCapitalize=none autoCorrect=off spellCheck=false, enterKeyHint) from PR 5 into PR 3, so the first phone sign-out cannot lock the owner out. Give the row tone 'destructive'.
- [needs_change] Sources rows: wrapper div with the existing label (flex-1 min-w-0 pl-4) and a 44px › sibling button calling onEditSource then onClose
  - Evidence: The category span at Drawer.tsx:476-478 is `shrink-0` and untruncated. The aside is w-[88vw] (293), so at 320 the card is about 249px wide. That leaves 16 checkbox + 12 gap + 18 icon + 12 gap + 44 ›, plus the plan's 40-character category fixture, and the row overflows (C3/C5 in the Menu state). The label's `border-b border-hairline last:border-b-0` (459) also has to move to the wrapper, or every row loses its divider because each label becomes its wrapper's last child. The checkbox aria-label uses the raw s.name (468).
  - Correction: Make the category span `min-w-0 max-w-[40%] truncate` (or put it on a second line under the name). Move border-b/last:border-b-0 to the wrapper div. Use sourceLabel(s.name) in the checkbox aria-label. The sibling (not nested) button is right, because toggleSourceAndMaybeClose (App.tsx:2013-2017) must not fire.
- [confirmed] jumpToCategory is a no-op on phone and desktop; fix with setMobileCol(idx) and el.firstElementChild.scrollIntoView
  - Evidence: App.tsx:2022-2030 sets only selectedColumnIndex. The ref is the `className="contents"` wrapper at 2598 inside `hidden md:grid` (2594). The phone uses mobileCol (2722-2792).
  - Correction: Also: (1) scroll the newly selected phone tab into view in the horizontal strip (App.tsx:2668-2717), e.g. `[role=tab][aria-selected=true]`.scrollIntoView({inline:'nearest', block:'nearest'}); (2) if showSearchView is true (App.tsx:2436), clear the search first, because columns are not rendered while searching and the jump is otherwise invisible.
- [confirmed] Closed Drawer stays focusable; add inert and aria-hidden via a ref effect
  - Evidence: The aside (Drawer.tsx:262-295) is always mounted with role=dialog aria-modal=true and only translate-x-full when closed. React is ^18.3.1 (package.json:14), which has no inert prop.
  - Correction: Also return focus to the Hamburger when the Drawer closes, unless Settings opened. Capture document.activeElement on open, or pass a ref. Add aria-expanded={drawerOpen} and aria-haspopup="dialog" to Hamburger.tsx:13-16, which becomes more than a comment-only change.
- [needs_change] FeedManager in PR 3: single openRowId initialised from focusSourceId, scrollIntoView feed-${id}
  - Evidence: The row's expanded state is local to each SourceRow (FeedManager.tsx:384 `const [open, setOpen] = useState(false)`, toggled at 687-689). The edit form is a separate editingRowId in FeedManager (:215), passed through MyFeedsTab (:327). With only an initial value, a later focusSourceId change while FeedManager stays mounted does nothing: Settings open on Feeds, then the toast 'Open' for another feed.
  - Correction: In PR 3, lift `open` into MyFeedsTab as openRowId and pass isOpen/onToggle to SourceRow. Also set editingRowId to the focused id, so ≡ → › lands in the edit form (2 taps) before PR 4. Drive both from a useEffect keyed on focusSourceId (plus a nonce from App, so re-focusing the same id works), and force tab='mine'. Put the li id on FeedManager.tsx:321.
- [confirmed] Settings close path (Done, Esc, backdrop) blurs, flushes, then calls onClose
  - Evidence: Done is at Settings.tsx:213-218. The backdrop onClick is at :190-194. The Esc capture listener (Settings.tsx:167-180) calls onClose directly, with deps [open, onClose].
  - Correction: Route all three through one local handleClose, including the Esc effect, so Esc also blurs and flushes. With closeSettings in useCallback the Esc listener stops re-registering every App render.
- [confirmed] Settings tab buttons replaceState(window.history.state) and delete source; keep the synthetic popstate
  - Evidence: Settings.tsx:237-247. App's sync listens to popstate only (App.tsx:425-427), so the synthetic event is the only way App re-reads the tab.
  - Correction: FeedManager's replaceState that drops `source` should not dispatch popstate, to avoid re-running sync mid-edit, but App's settingsSourceId must not be read again afterwards. Rely on correction (c) above.
- [needs_change] Filter chip bar App.tsx:2369 gets data-hscroll; chip/clear-all tap targets in PR 5
  - Evidence: App.tsx:2369-2393: the chips render the raw source name (`{src} ✕` at 2384, aria-label at 2382) while the Drawer shows sourceLabel. The 'filtering:' footnote (Drawer.tsx:415) has the same problem, and the plan fixes only that one.
  - Correction: Use sourceLabel(src) for the chip text and aria-label in PR 3, alongside the Drawer label fixes. Keep `key={src}` raw.
- [needs_change] PR 6: header sm: switches at App.tsx:2231, 2290, 2342 become md:
  - Evidence: The sm: classes in the header are at App.tsx:2220 (pt/pb), 2224 (gap), 2231 (pill sm:w-72), 2294 (refresh sm:hidden) and 2341 (sub-row hidden sm:flex). Line 2290 is `disabled={refreshing}` and 2342 is the health span. After PR 2 the h1 and cluster also carry the new `sm:` search classes.
  - Correction: List 2220, 2224, 2231, 2294 and 2341, plus the PR 2 `hidden sm:block` and `sm:flex-none` search classes, all switched to md: together. Otherwise iPhone landscape (sm but not md) shows the phone refresh icon hidden while the sub-row is visible, which is inconsistent.
- [needs_change] F1/PR 3 phone check: Done, the browser's Back, or Esc closes Settings; after PR 3 'Done, then the back gesture: Settings stays closed'
  - Evidence: The owner uses a home-screen web app. iOS standalone web apps show no Back button, and an edge-swipe Back is not reliably available. The history fix is observable mainly in a Safari tab and on desktop. This is from platform knowledge and was not verifiable in the container.
  - Correction: Word the phone check as 'in a Safari tab (not the home-screen icon): open via ≡ → Settings, Done, swipe back → Settings stays closed'. Flow FG in Playwright is the real gate.
- [confirmed] Stacking: header z-20 < Drawer z-30/40 < Settings z-50 < Toast z-[60]
  - Evidence: Header z-20 (App.tsx:2210), backdrop z-30 (Drawer.tsx:253), aside z-40 (:289), Settings z-50 (Settings.tsx:189). The error banner uses `z-15` (App.tsx:2401), which Tailwind does not emit.
  - Correction: None.

Additions:
- App.tsx:430-444: openSettings must reuse the current entry (replaceState) when view=settings is already in the URL. This prevents a double history entry from the PR 4 toast 'Open' action while Settings is open.
- App.tsx:438-444 and 395-424: closeSettings sets settingsOpen false and settingsSourceId null synchronously before history.back(). sync() nulls settingsSourceId whenever `source` is absent.
- frontend/src/lib/settingsTabs.ts (new): SETTINGS_TABS and SettingsTab live here, not in Settings.tsx, to avoid a react-refresh/only-export-components warning (eslint.config.js:39-41; plugin 0.5.3 allows only Literal/Unary/Template/Binary constants). Drawer.tsx:34 keeps importing the type through a Settings.tsx re-export.
- App.tsx:1762: the Esc-in-search check moves from ae.type === 'search' to ae.id === 'app-search' in the same PR 2 commit that changes the input to type=text. Esc also calls setSearchOpen(false).
- App.tsx:1769-1772: '/' opens search (setSearchOpen(true) + rAF focus); today it only works when search is already open.
- App.tsx:2233-2246: Enter in the search field blurs it (dismisses the iOS keyboard) and keeps the query.
- PR 3 acceptance grep: replace `grep -rn 'data-settings-gear\|onResetLocalState' frontend/src` with a Drawer-scoped check. Settings.tsx:80/129/414 and App.tsx:2846 legitimately keep onResetLocalState.
- Drawer.tsx:556-604: add an `icon` prop to GroupedRow if the Settings row is to carry a gear icon. Rename the 'Quick settings' label (Drawer.tsx:335).
- Drawer.tsx:476-478: the category span becomes min-w-0 truncate with a max width so the new 44px › button and the 40-character category fixture fit at 320. Move border-b/last:border-b-0 from the label (459) to the new wrapper. The checkbox aria-label at 468 uses sourceLabel.
- Drawer.tsx:307-321: move the grabber clearance (Done's pl-10) to the left-aligned title. Rewrite the stale comments at 266-273 and 307-313.
- Sign out row: hide it for auth_method 'bypass' (UserBadge.tsx:5-10). Ship the LoginPage.tsx:72/84 autoCapitalize/autoCorrect/spellCheck fix in PR 3, not PR 5, so a phone sign-out cannot strand the owner at a login that autocapitalises the username.
- Hamburger.tsx:13-16: add aria-expanded={open} and aria-haspopup="dialog"; App.tsx:2333 passes drawerOpen. On Drawer close, restore focus to the Hamburger unless Settings is opening.
- FeedManager.tsx:384 and :215: in PR 3, lift SourceRow's local `open` state to MyFeedsTab and also set editingRowId for the focused feed, driven by an effect on focusSourceId plus a nonce, so ≡ → › opens the edit form in 2 taps before PR 4 and re-focus while mounted works.
- App.tsx:2668-2717: after jumpToCategory or any tab change, scroll the selected phone tab into view inside the horizontal strip. Clear the search first when showSearchView (App.tsx:2436) is active.
- App.tsx:2379-2385: active filter chips show sourceLabel(src) instead of the raw slug, in text and aria-label (PR 3, with the Drawer label fixes).
- PR 6: the header breakpoint list should be App.tsx:2220, 2224, 2231, 2294 and 2341, plus the PR 2 search classes. The plan's 2290 and 2342 are wrong lines.
- Settings.tsx:167-180: the Esc capture listener must call the same blur/flush handleClose as Done and the backdrop.
- §9 'Where Settings lives' should also list the onFailedAway toast 'Open' action (PR 4) as an entry point. It is the case that needs the openSettings re-entry guard.
- Optional: Drawer swipe-to-dismiss is leftward (Drawer.tsx:11-13, 175) on a right-anchored panel that slides out to the right. Consider dismissing on a rightward drag, or document it as intentional.
- Optional, desktop: removing the gear makes Settings 2 clicks on desktop. A ',' keyboard shortcut in App.tsx:1753-1894 and ShortcutsSheet.tsx:29 would restore one-step access without adding a top-bar button.

## Synthesized plan

Replaces sections 2 to 14 of REDESIGN_PLAN.md. Section 1 (model and effort) stays as it is. Baseline is origin/main 721713e (PR #12). Unless marked "new", every file:line refers to that tree. Re-check each line before editing, because lines drift between PRs.

**Approach.** Start from the winning minimal-change design. Edit FeedManager, Settings, App and Drawer in place. Add no router, no new runtime dependency and no change to package.json. Add judged-best ideas from the other designs where the code shows they are needed:
- categories are stored as typed;
- the save queue merges rapid changes and keeps a save store that survives the editor closing;
- saves are flushed with keepalive when the app is hidden;
- a timeout on saves;
- the sheet follows the iOS keyboard at top and bottom;
- the phone remembers its tab by column name;
- saved views are remapped when a feed is renamed;
- the AI tab saves on its own;
- the landscape breakpoint;
- a container-query thumbnail;
- a stronger overflow guard (vertical scrollers, clipped text, visible errors, no Save button);
- ESLint mobile bans;
- YouTube tests that keep the real SSRF guard in the path.

**Goals mapped to the ten owner requirements**

| # | Requirement | Where it is solved | PR |
|---|---|---|---|
| 1 | Edit a feed in fewer steps | Menu → › beside a feed opens its editor (2 taps); from PR 5 a card's source name opens it (1 tap). One tap on a row opens every field, already editable. §5, §6, §9 | 3, 4, 5 |
| 2 | Category is a blank text box | Native picker with your categories, suggestions and "New category…"; new names are kept as typed and matched to existing names regardless of case. §7 | 4 |
| 3 | Nothing saves on its own | Every field saves when you leave it or pick a value. "Saving…", then "Saved ✓", or an error under the field. No Save button anywhere in Settings, the AI tab included. §6, §11 | 4, 5 |
| 4 | Headers typed as JSON | Name and value rows, "Use a browser identity", "Prefer English". §8 | 4 |
| 5 | Too many top-bar buttons | The gear is gone. The ≡ Menu is the only menu/settings button, and Settings is its first row. §9 | 3 |
| 6 | iPhone problems fixed by default | Overflow root-cause fixes, every control at 17px by design (the `!important` 16px rule is deleted), keyboard-aware sheet, 44px targets, safe areas, landscape. Enforced by a CI guard and lint rules. §4, §10 | 2 to 6 |
| 7 | Ease of use by default | Pickers instead of free text, autosave everywhere, inline confirms instead of native dialogs, plain wording, undo for bulk actions. Enforced by lint and smoke rules. §11 | 4, 5 |
| 8 | Safety of the VPS | No infra file touched, no new port, process, job, route or outbound host. Path allow-list check on every PR. §2 | all |
| 9 | YouTube links will not add | Offline resolution for every link that already carries the id; a browser-like lookup with consent cookies kept across redirects; seven page markers; plain errors that teach the channel ID; an /auto YouTube branch; offline tests through the real SSRF guard. §3 | 1, 4 |
| 10 | Text overflow, no duct tape | Root-cause fixes per defect, plus a guard that measures page width, vertical scrollers, viewport escape, clipped text and field size. §4 | 2, kept current in 3 to 6 |

## 2. Safety and security

Nothing in this plan opens a port, starts a process or changes how the VPS is reached. Code is written in the Claude Code container and lands as pull requests. The VPS changes only when the owner runs popping-update, which pulls the new images and restarts the same three containers.

| Item | After this plan |
|---|---|
| Published ports | Unchanged: only the frontend, `127.0.0.1:14789->8080` (docker-compose.yml). |
| Containers, services, daemons, cron jobs, background tasks | Unchanged. No new asyncio task: the new /auto YouTube branch does not start the discovery task the RSS branch starts (routes/sources.py:617-624). No new API route. No service worker. |
| Outbound hosts | Unchanged. The YouTube lookup still goes only to youtube.com hosts, through `check_url_safe` (entry), `ssrf_event_hook` (every redirect hop) and the final-URL check. No googleapis.com: the optional API key is a non-goal (§12). |
| What a YouTube lookup sends | A desktop Safari User-Agent, `Accept-Language: en-US,en;q=0.9`, and two fixed consent cookies (`SOCS=CAI`, `CONSENT=YES+`) scoped to `.youtube.com`. No user data, credentials or keys. |
| Header deny list (routes/sources.py:169-187) | Unchanged, and the backend stays the authority. The backend gains two stricter input rules: a token-format header name and no case-insensitive duplicates. The UI mirrors the list. |
| Header values | Stored as plain text and returned by GET /api/sources, as today. The editor says so ("Saved as plain text. Don't put passwords or keys here."). No new storage. |
| CSP (frontend/nginx.conf.template:29) | Unchanged. No external fonts, scripts or styles. The select chevron is a `data:` SVG, which `img-src 'self' data:` allows. The CI smoke test injects the production CSP and fails on any "Refused to". |
| Docker images | Same Dockerfiles. package.json and the lockfile are unchanged, so the build stage is identical. Playwright is installed only on the GitHub runner with `npm install --no-save`. |
| CI | Steps are added to the existing `frontend-checks` job only. No new job, trigger, permission, secret or action. |

**Files a PR may touch:**
- `frontend/src/**`
- `frontend/scripts/iphone-audit/**`
- `frontend/scripts/unit/**` (new)
- `frontend/eslint.config.js`
- `frontend/tailwind.config.js` (PR 6 only: `screens` and one stale comment)
- `backend/app/youtube.py`
- `backend/app/routes/sources.py`
- `backend/app/scheduler.py` (inside `update_source` only)
- `backend/app/schemas.py` (docstrings only)
- `backend/tests/**`
- `README.md` (YouTube how-to and the smoke test)
- `.github/workflows/build.yml` (steps inside `frontend-checks` only)

**Files no PR may touch:**
- docker-compose*.yml, any Dockerfile, frontend/nginx.conf.template, egress-proxy/**, ops/**
- frontend/package.json, frontend/package-lock.json, .github/dependabot.yml
- backend/app/config.py, backend/app/main.py, backend/app/url_safety.py, backend/requirements*.lock, .env.example

**Before each merge:**
1. Path check. This must print nothing:
   ```
   git diff --name-only origin/main...HEAD | grep -vE '^(frontend/src/|frontend/scripts/(iphone-audit|unit)/|frontend/(eslint|tailwind)\.config\.js$|backend/app/(youtube|scheduler|schemas)\.py$|backend/app/routes/sources\.py$|backend/tests/|README\.md$|\.github/workflows/build\.yml$)'
   ```
2. For a build.yml change, `git diff origin/main...HEAD -- .github/workflows/build.yml` shows only lines inside `frontend-checks` and no `permissions:` or `secrets.`.
3. Run the security-review skill on the diff and read every finding.
4. `grep -n 'event_hooks={"request": \[ssrf_event_hook\]}' backend/app/youtube.py` still matches.
5. All four check runs are green: `backend tests`, `frontend lint + build`, `backend image`, `frontend image`.

**Owner go/no-go before merging** (no phone preview exists before main):
- The implementer sends the 390-wide PNGs of the changed screens with SendUserFile, plus three lines on what to look for.
- The owner replies go or no-go.

**After popping-update on the VPS:**
- `docker compose ps` shows only `127.0.0.1:14789->8080` under ports.
- `ss -ltnp` shows no new listener.
- The app loads and a feed refreshes.
- After PR 1: `docker compose logs backend | grep "youtube: lookup"` shows the sanitized lookup line.

**Rollback:** set `POPPING_IMAGE_TAG=sha-<previous commit>` in .env, then run `docker compose up -d`. No migration exists in this plan, so rolling back is always safe.

## 3. YouTube

### Causes found in the code

**Backend:**
- **B1. Bot-like request.** The page fetch sends `User-Agent: Popping/0.2` (config.py:392 via youtube.py:41) with no Accept-Language and no consent cookies. Requests from a datacenter get consent.youtube.com or a bot check. Neither carries the marker.
- **B2. One marker.** Only `"channelId":"UC…"` is searched (youtube.py:38).
- **B3. Shapes that already carry the id still fail.**
  - A feed link (`feeds/videos.xml?channel_id=UC…`) does not match `/channel/` (youtube.py:37). It is fetched as a page, and the XML has no JSON marker.
  - A bare `UC…` id, or a link pasted without `https://`, is not a URL and gets a 422.
- **B4. /auto has no YouTube branch** (routes/sources.py:573-644). It creates an rss row called `youtube_com`, or a generic_scrape row, or fails.
- **B5. Raw httpx text is echoed** to the user (youtube.py:107-108).

**Frontend:**
- **F1. Add and Test stay grey with no reason.**
  - `nameError` blocks while Name is empty (FeedManager.tsx:1372-1375, 1399).
  - `urlError` blocks `@handle`, `youtube.com/@x` and bare ids (`new URL`, :1397-1424).
  - Neither error is ever rendered.
- **F2. Every Add failure goes to `onError`**, which is App's banner under the z-50 sheet (:1430, :1470). Nothing visibly happens.
- **F3. Add sends the original URL, not `resolvedUrl` from Test** (:1446-1458), so YouTube is fetched twice.

### Every link shape and how it resolves (backend/app/youtube.py, PR 1)

| # | Pasted | Result | Network |
|---|---|---|---|
| 1 | `https://www.youtube.com/channel/UC…` with any suffix (`/videos`, `?si=…`), on www, m. or music. | feed URL | none |
| 2 | `…/feeds/videos.xml?channel_id=UC…` (extra params dropped) | canonical feed URL | none |
| 3 | `…/feeds/videos.xml?user=NAME` or `?playlist_id=PL…` | canonical feed URL | none |
| 4 | `…/playlist?list=PL…` (no `v=`) | `feeds/videos.xml?playlist_id=PL…` | none |
| 5 | bare `UC` + 22 characters, surrounding spaces allowed | feed URL | none |
| 6 | scheme-less `youtube.com/…`, `www.`, `m.`, `music.`, `youtu.be/…` | `https://` added, then rows 1-11 | as that row |
| 7 | bare `@handle`, only when the caller allows it (type youtube_channel, PATCH of a youtube_channel row, /auto) | `https://www.youtube.com/@handle`, then row 8 | page lookup |
| 8 | `https://www.youtube.com/@handle` (+ `/videos`, `?si=`) | page lookup | yes |
| 9 | `/c/NAME` | page lookup | yes |
| 10 | `/user/NAME` | page lookup. If YouTube blocks it, fall back to `feeds/videos.xml?user=NAME` and let Test show whether YouTube still serves it | yes |
| 11 | `watch?v=ID`, `youtu.be/ID`, `/shorts/ID`, `/live/ID`, `/embed/ID` | rewritten to `https://www.youtube.com/watch?v=ID`, then page lookup | yes |
| 12 | `youtube.com.evil.example` or any other host | passthrough, then normal URL validation (`is_youtube_url` is unchanged) | as today |

**Code shape** (public names kept: `is_youtube_url`, `resolve_channel_feed_url`, `YouTubeResolutionError`):

```python
_TRANSPORT: httpx.AsyncBaseTransport | None = None   # test seam; None = real network
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
_PAGE_HEADERS = {"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                 "Accept-Language": "en-US,en;q=0.9"}          # no Cookie header here
_MAX_BODY = 3_000_000
class YouTubeBlockedError(YouTubeResolutionError): ...
class YouTubeNotFoundError(YouTubeResolutionError): ...
def normalize_youtube_input(text: str, *, allow_bare_handle: bool = False) -> str
def channel_id_from_html(html: str) -> str | None        # pure
def is_blocked_page(final_url: str, status: int, html: str) -> bool   # pure
def youtube_source_slug(original: str, feed_url: str) -> str          # pure
async def resolve_channel_feed_url(url: str, *, allow_bare_handle: bool = False) -> str
```

**Page lookup:**
- Build a cookie jar: `jar = httpx.Cookies(); jar.set("SOCS", "CAI", domain=".youtube.com"); jar.set("CONSENT", "YES+", domain=".youtube.com")`.
  - Cookies must sit on the client, not in a `Cookie` header. httpx 0.28.1 (requirements.lock:85) drops the Cookie header on every redirect (`_redirect_headers`, `headers.pop("Cookie")`).
  - Verified in this container: header cookies were lost on the youtube.com → www → consent.youtube.com hops, and jar cookies were sent on all three.
- Client: `httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True, max_redirects=5, cookies=jar, transport=_TRANSPORT, event_hooks={"request": [ssrf_event_hook]})`. Keep that event-hook literal exactly; test_youtube.py:77-88 pins it.
- Keep the entry `check_url_safe` and the final-URL check.
- Read with `client.stream("GET", …)` and stop at 3,000,000 bytes. Decode with `errors="replace"`.

**Markers.** The first hit wins. `"browseId"` is excluded because it names other channels on shelves.
1. `<link rel="alternate" type="application/rss+xml" href=".../feeds/videos.xml?channel_id=(UC…)">`
2. `<link rel="canonical" href=".../channel/(UC…)">`
3. `<meta property="og:url" content=".../channel/(UC…)">`
4. `<meta itemprop="channelId|identifier" content="(UC…)">`
5. `"videoDetails":{…"channelId":"(UC…)"`, with no nested braces
6. `"externalId":"(UC…)"`
7. `"channelId":"(UC…)"`

Match tags first, then read their attributes, so attribute order does not matter.

**Blocked page.** Any of these is blocked:
- the final host ends with `consent.youtube.com` or `consent.google.com`;
- status 429;
- the body contains `action="https://consent.youtube.com`, `Before you continue to YouTube`, `confirm you’re not a bot`, `confirm you're not a bot`, or `Sign in to confirm`.

A 404 is not-found.

**Logging.** One INFO line per lookup: `youtube: lookup host=<final host> status=<code> result=<marker name | blocked:<rule> | not_found | network>`. Never log the query string or the body.

**Error wording.** The user sees exactly these. Raw exception text is never included.

| Case | Message |
|---|---|
| Blocked | "YouTube didn't let Popping look this channel up. Paste the channel ID instead: open the channel in YouTube, tap “more about this channel”, then Share channel, then Copy channel ID. It starts with UC." |
| 404 | "YouTube says this channel or video doesn't exist." |
| No marker | "Couldn't find the channel on that YouTube page. Paste the channel ID instead. It starts with UC." |
| Other HTTP status | "YouTube answered with an error (HTTP <code>). Try again later, or paste the channel ID. It starts with UC." |
| Network or timeout | "Couldn't reach YouTube. Try again in a minute." |

Check the YouTube app's wording ("more about this channel", "Share channel") on the phone after PR 1 deploys, and adjust the string if it differs.

### Routes (backend/app/routes/sources.py, PR 1)

- **POST /api/sources** (:445-451): call `resolve_channel_feed_url(body.url, allow_bare_handle=(body.type == "youtube_channel"))`.
- **PATCH** (:694-699): pass `allow_bare_handle=(pre.type == "youtube_channel")`.
- **POST /api/sources/test** (:878-892): pass the same flag as POST. Return the message as `error`, keeping `error_kind="invalid_url"`.
- **/auto** (:573). Before `_validate_url`:
  1. `url = normalize_youtube_input(body.url.strip(), allow_bare_handle=True)`.
  2. If `is_youtube_url(url)`: `_validate_category(body.category)`, then resolve. A 422 carries the message.
  3. Name: `await _free_source_name(session, youtube_source_slug(url, feed_url))`.
     - The slug is `<handle or c or user name>_yt` (slugified to `[a-z0-9_]`, at most 100 characters), else `channel_<last 6 of id, lower-cased>_yt`.
     - labels.ts already shows `_yt` as " (YouTube)".
  4. `scheduler.add_source(session, name=…, type_="youtube_channel", category=<stripped category>, url=feed_url, refresh=_YOUTUBE_DEFAULT_REFRESH)`.
  5. `return SourceAutoResult(found=True, kind="youtube_channel", source=…)`. `kind` is `Optional[str]` (schemas.py:142), so the schema is unchanged. Update only its docstring.
  6. No discovery task.
- Otherwise /auto continues exactly as today with `url`.

### Frontend (PR 4, FeedManager.tsx Add tab)

**`normalizeFeedInput(type, raw)`**, used by `validateForm`, the re-validate effect, `test` and `submit`:
- trim;
- youtube: `^@[\w.-]+$` becomes `https://www.youtube.com/@x`; `^UC[0-9A-Za-z_-]{22}$` becomes `https://www.youtube.com/channel/UC…`;
- any non-reddit type: a value with no `://` but a dot gets `https://` in front.
- Keep `new URL(trimmedUrl)` and the `[name, url, sourceType]` deps in the effect; test slice15:169-188 pins them.

**Name is optional.**
- Label "Name (optional)". `suggestName(type, normalizedUrl, existingNames)` uses the same YouTube rule as the backend, `r_<sub>` for reddit, and the hostname slug for everything else (the same operations as `trackAnyway`, :1175-1186). Dedupe with `_2`, `_3`.
- Show it as hint text, "Will be saved as: <slug>". It must not be a `placeholder={…}`.

**Errors and results.**
- Render `nameError` and `urlError` under their fields (`text-ios-caption text-red-300`).
- Add failures render in the result box (`setTestResult({ kind: 'err', message })`), not `onError`.
- `submit` sends `testResult?.kind === 'ok' && testResult.resolvedUrl ? testResult.resolvedUrl : normalized`.
- Add `noValidate` on the `<form>`.

**Labels.**
- YouTube URL label: "YouTube channel link or channel ID". Hint: "A channel link, video link, @handle or channel ID (starts with UC)". Keep the `'Page URL'` branch and `htmlFor="fm-url"`.
- `friendlyTestError('invalid_url', raw)` returns `raw` alone, without the "Invalid URL —" prefix.

**AutoFeedBlock classifies the paste before calling anything:**
- YouTube host, bare UC id or `@handle`: `api.autoAddSource(url, 'video')`. Success toast: "Added <sourceLabel(name)>".
- `r/x` or reddit.com/r/…: call new prop `onPrefill('reddit', url)`. AddCustomTab sets the type and URL and scrolls the form into view.
- podcasts.apple.com: `onPrefill('podcast', url)`.
- Anything else: `api.autoAddSource(url, 'news')`.
- Errors go to `setAutoMessage({ kind: 'err', text })`. Keep the "couldn't find a feed" / "Track this URL anyway" literals inside the `autoMessage.kind === 'err'` branch; test slice15:240-255 pins them.

**api.ts:** the `autoAddSource` return `kind` union gains `'youtube_channel'`.

### Offline tests (PR 1, backend/tests/test_youtube.py)

**Fixtures:**
- An autouse fixture sets `app.youtube._TRANSPORT` to a `MockTransport` whose default handler calls `pytest.fail(f"unexpected network call {request.url}")`.
- A `fake_dns` fixture monkeypatches `app.url_safety.socket.getaddrinfo`: youtube.com, www.youtube.com, m.youtube.com, consent.youtube.com map to `142.250.0.1`; `evil.internal` maps to `10.0.0.5`. The real `check_url_safe` and `ssrf_event_hook` therefore run. Do not stub them.

**Tests:**
1. Rows 1-6 and 12 of the table resolve with zero handler calls (assert a call counter is 0). This includes a bare id with spaces and a feed link with `&foo=1`.
2. `channel_id_from_html`:
   - one snippet per marker;
   - precedence: the canonical link beats a different `"channelId"`;
   - a watch page whose first `"channelId"` is another channel resolves through `videoDetails`;
   - a page with only `"browseId"` returns None.
3. `is_blocked_page`: true for a consent host, a 429, and each body phrase; false for a normal page.
4. `@handle?si=abc` lookup:
   - the request URL has no `si`;
   - the User-Agent contains "Safari";
   - Accept-Language is present;
   - the `cookie` header contains `SOCS=CAI` on the first request **and** on a redirected `www` hop (handler returns 301 from youtube.com to www).
5. A 302 to `https://consent.youtube.com/m?…` raises `YouTubeBlockedError`; the message contains "channel ID" and contains no "http".
6. `/user/NAME` blocked returns `…feeds/videos.xml?user=NAME`.
7. 404 raises the not-found message.
8. A redirect to `http://127.0.0.1/admin` and one to `http://evil.internal/` raise `YouTubeResolutionError`, and the handler never sees those hosts.
9. A 5 MB body with the marker after byte 3,000,000 gives the no-marker error.
10. Rewrite `test_resolve_channel_feed_url_raises_for_nonexistent_handle` (:115-121) and the two route tests at :125-133 and :164-177 to use a mocked 404 instead of the live network.
11. Route tests (DB):
    - POST /api/sources/test with `type=youtube_channel` and a mocked consent page gives `ok False`, `error_kind 'invalid_url'`, and an error containing "channel ID";
    - POST /api/sources with a bare id gives 200 and the stored url is the feed URL;
    - POST /api/sources/auto with `https://www.youtube.com/@somehandle` and `app.routes.sources.resolve_channel_feed_url` monkeypatched gives a row with `type youtube_channel`, name `somehandle_yt` and refresh 21600, and `kind == "youtube_channel"`.

## 4. Text overflow

### Root causes (measured at 390×844@3 and 320×568@2: shots/*-overflow-scan.json, REDESIGN_PLAN §4)

- **R1. A flexible text child without `min-w-0`, next to fixed or `shrink-0` siblings.** The search pill `w-44`, the Auto-add input `flex-1` without `min-w-0` (it pushes the Settings body to scrollWidth 369 at 320), and five `shrink-0` chips on the feed name line.
- **R2. No shared gutter.** The Feeds tab is `pt-4` while every other tab is `pt-4 px-4` (Settings.tsx:265).
- **R3. Rows of controls that do not wrap,** so each control wraps inside itself: Card inline actions and the meta row.
- **R4. Fixed widths sized for 390+.** The `w-28` thumbnail beside a headline on a 250-330px card.
- **R5. Controls authored at 13px and forced to 16px by `!important`** (styles.css:24-26). Line heights mismatch, and the cause is hidden.
- **R6. Hand-rolled 9-11px sizes.**
- **R7. Header crowding:** a 34px title and four 44px buttons.
- **R8. 320 is the design floor.** Page Zoom at 125% turns a 390 phone into about 312 CSS px. Larger Text and Dynamic Type do not scale px web text, so they are out of scope (§12).

### Fixes

**PR 2 (class and CSS changes only):**

**Search row** (App.tsx:2220-2262, R1 and R7):
- h1 gets `${searchOpen ? 'hidden sm:block' : ''}`.
- The cluster div gets `${searchOpen ? 'flex-1 min-w-0 justify-end sm:flex-none' : ''}`.
- The pill becomes `flex-1 min-w-0 sm:flex-none sm:w-72`.
- The refresh icon is hidden while search is open.
- The clear ✕ becomes `w-11 h-11 -mr-3 flex items-center justify-center shrink-0`.
- The input becomes `type="text" inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}` with `text-ios-body`. This also removes the second native clear button.

**Card meta row** (Card.tsx:955-963, R1): source `min-w-0 truncate`; dot and `<time>` `shrink-0 whitespace-nowrap`.

**Card text actions** (Card.tsx:976-1135, R3):
- Rows become `flex flex-wrap items-center gap-x-4 gap-y-1`.
- Each action becomes `inline-flex items-center whitespace-nowrap min-h-[44px] -my-2`.
- Keep `data-card-interactive` and the stopPropagation handlers.

**Card thumbnail** (Card.tsx:905, 1734, R4), a container-query rule rather than a smaller box. In styles.css `@layer components`:
```css
@media (max-width: 767px) {
  .card-body { container: card / inline-size; }
  @container card (max-width: 379px) { .card-thumb { width: 72px; aspect-ratio: 1 / 1; } }
  @container card (max-width: 299px) {
    .card-title-row { flex-direction: column; }
    .card-thumb { width: 100%; aspect-ratio: 16 / 9; }
  }
}
```
- Add `card-body` to the element that wraps the title row.
- Add `card-title-row` to the title row (Card.tsx:905), and change `items-center` to `items-start`.
- Add `card-thumb` to the thumbnail wrapper (Card.tsx:1734).
- iOS 15 and older keep today's look. Desktop is unaffected because of the media query.

**Text sizes** (R6): Card.tsx:1171 and 1174 and App.tsx:2709 become `text-[11px]`. FramingWatch.tsx:81, 106 and 111 become `text-[11px]`. SourceIcon.tsx:68 (the decorative letter) stays at 9px, with `aria-hidden` and a lint disable comment.

**Settings header** (Settings.tsx:211-222):
- Reorder: h2 first, `min-w-0 flex-1 truncate`, always "Settings".
- Done second (trailing edge), `shrink-0 min-h-[44px] min-w-[44px] px-2 text-ios-body font-semibold text-accent`.

**Settings gutter** (Settings.tsx:265): `pt-4 px-4`.

**Scrollers:** Settings.tsx:263, Drawer.tsx:334, Column.tsx:489 and App.tsx:2720 get `overscroll-contain`. Add `html, body { overscroll-behavior-y: none; }` to styles.css base.

**Drawer header** (Drawer.tsx:314-325): title "Menu" first, `min-w-0 flex-1`. Done trailing, 44px, keeping `aria-label="close menu"`.

**FeedManager TabButton** (FeedManager.tsx:264-287):
- `flex-1 min-w-0 min-h-[44px] px-2 rounded-ios text-ios-caption font-semibold whitespace-nowrap truncate`.
- Labels "My feeds (N)", "Suggested", "Add a feed".

**Auto feed row** (FeedManager.tsx:1245-1266):
- Input `flex-1 min-w-0 min-h-[44px] px-3 text-ios-body`, `type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"`. The placeholder literal is unchanged.
- Button `min-h-[44px] shrink-0`.

**Feed rows** (FeedManager.tsx:695-786): move the auto-disabled, paused, ⚠ and score chips to the caption line. Category chip and caption become `text-ios-caption`.

**Toast** (Toast.tsx):
- :122 `truncate` becomes `line-clamp-3 break-words`.
- :93 durations: info 3000 ms, error 5000 ms, with an action 5000 ms.
- :117 `z-50` becomes `z-[60]`, so the toast sits above Settings regardless of DOM order.
- The bottom offset follows the keyboard: `bottom: calc(1.5rem + env(safe-area-inset-bottom) + <kbInset>px)` from `useVisualViewport()` (new frontend/src/lib/visualViewport.ts, below).

**BriefCard** (BriefCard.tsx:562): `flex-wrap`, like :673. Generate becomes `w-full sm:w-auto`.

**PR 3:** removing the gear gives the title 148px at 320 (R7).

**PR 4:** the editor and the Add form are built at 17px and 44px.

**PR 5:** every remaining form control moves to 16px or more **by design**, so the `!important` rule can be deleted:

| Control | Change |
|---|---|
| Settings.tsx:776, 796, 804, 812, 847, 855 (provider and model selects or inputs) and :897 (API keys) | `min-h-[44px] text-ios-body px-3`; selects also `select-ios` |
| Column.tsx:418, 462 (sort, max-age selects) | same |
| LoginPage.tsx:72, 84 | already 44px with `text-ios-body`; add the iOS attributes only |
| App.tsx:2233 (search) | done in PR 2 |
| FeedManager.tsx:577-655, 825 (old edit form, interval select) | deleted in PR 4; its replacements are already 17px |
| FeedManager.tsx:1532, 1655, 1692, 1709, 1723, 1736 (Add form) | done in PR 4 |
| Checkboxes, radios, range (Drawer.tsx:463, FeedManager.tsx:1558-1619, Column.tsx:434) | exempt: no text |

Then:
- Delete styles.css:22-26 (the comment and the `@media (pointer: coarse)` rule).
- Add a non-important default in `@layer base`: `input, select, textarea { font-size: 17px; line-height: 22px; }`. Any control without a text class is then body size. Tailwind utilities still override it.
- Add a `.select-ios` component class: `appearance: none; padding-right: 2rem; background: url("data:image/svg+xml,…chevron…") no-repeat right 0.75rem center / 12px;`.

**Lint.** It bans `text-[Npx]` below 11 and `min-h-[<44px]`. The guard's C5 measures every control with the rule gone.

### The guard: frontend/scripts/iphone-audit/smoke.cjs (new, CommonJS, PR 2)

**Usage:** `node smoke.cjs <base> [--csp] [--strict] [--browser chromium|webkit] [--out <dir>]`.

**Setup:**
- Reuse `mockApi` and `IOS_UA` from capture.cjs (exported at :560). Fix capture.cjs:53 to anchor on the pathname: `ctx.route((u) => /^\/(api|auth|assets)\//.test(new URL(u).pathname), …)`.
- Add fixtures to fixtures.cjs:
  - a 60-character feed name, a 120-character URL, a 90-character unbroken title token;
  - a source with `custom_headers` holding a long User-Agent;
  - an auto_disabled source with a 300-character `last_error`;
  - a youtube_channel source and a generic_scrape source with a sitemap;
  - `rfd_hot_deals`;
  - a 40-character category.
- Use a fresh browser context per state per width, with no `setViewportSize`. Long sessions gave false `pointer: coarse` readings.
- Contexts: 390×844@3 and 320×568@2, `isMobile`, `hasTouch`, IOS_UA, dark. `clock.setFixedTime(F.NOW)`.
- WebKit mode uses `devices['iPhone 13']` for 390 and the same device with a 320×568 viewport.
- Per state: goto, wait for `main.md\:hidden article[data-card-id]`, run the setup, wait 400 ms, run the checks, take a screenshot.

**States:**
1. dashboard
2. card summary open
3. search open with "x" typed
4. Menu open
5. Settings → Feeds
6. Settings → Add a feed with YouTube selected and long text
7. AI tab
8. Notifications, History, Hidden, Saved, Downvoted, Reset (one state each, via URL)
9. From PR 4: the editor via `?view=settings&tab=feeds&source=<id>` (custom with headers; built-in; auto-disabled); the editor in "New category…" mode with 45 characters typed; two header rows, one invalid
10. From PR 5: the column ⋯ popover and the login page
11. From PR 6: landscape 844×390

**Checks.** A failure exits 1 and prints width, state, rule, selector path, rect and text.

| Rule | Check | From |
|---|---|---|
| C1 harness | `matchMedia('(pointer: coarse)').matches` | PR 2 |
| C2 page width | `body.scrollWidth` and `#root.scrollWidth` ≤ innerWidth. `html` alone misses overflow because of `overflow-x: clip` (styles.css:36). | PR 2 |
| C3 viewport escape | Every visible element (has rects, not `visibility:hidden`, opacity > 0, not inside `[inert]` or `[aria-hidden="true"]`, not inside a closed Drawer whose aside starts at or beyond innerWidth) has `left ≥ -1` and `right ≤ innerWidth + 1`. Skip only descendants of an element marked `data-hscroll` (deliberate horizontal strips: the Settings tab strip Settings.tsx:228, the mobile tab strip App.tsx:2668, the filter chip bar App.tsx:2369, the preset strip). Do **not** skip descendants of `overflow-x:auto/hidden` ancestors in general. | PR 2 |
| C4 vertical scrollers | Every visible element whose computed `overflow-y` is auto or scroll (Settings body, Drawer nav, phone scroller, Column list) has `scrollWidth ≤ clientWidth + 1`, unless it has `data-hscroll`. This catches the measured Settings body 369/320 that C2 and C3 miss. | PR 2 |
| C5 clipped text | For every non-whitespace text node, each `Range.getClientRects()` rect lies inside its nearest ancestor whose `overflow-x` is not visible (or the viewport). Exception: an ancestor up to that clipper has `text-overflow: ellipsis` or `-webkit-line-clamp`, or a `data-hscroll` strip is in between. At 320 on the dashboard, the h1 "Popping" is not ellipsized. | PR 2 |
| C6 field font | Delete the coarse-pointer rule through CSSOM: find the `CSSMediaRule` whose `conditionText` includes `pointer: coarse`, then `deleteRule`. Every visible input (not checkbox, radio or range), select and textarea must then compute ≥ 16px. Warn-only until `--strict`. After PR 5 the rule no longer exists and the check runs as is. | warn PR 2, strict PR 5 |
| C7 tap targets | Inside `[role="dialog"]`, `aside[aria-label="menu"]`, `header`, `[role="tablist"]`, `[role="status"] button`: every visible `button`, `a[href]`, `select`, `[role=button\|tab\|switch]` measures ≥ 43.5px tall, and ≥ 43.5px wide when it has no text. Checkboxes and radios are measured on `closest('label')`. Elements inside `[data-tap-exempt]` (article prose) are skipped. | warn PR 2, strict PR 5 |
| C8 runtime | Fail on any `pageerror`, any console error other than the known `/auth/me` 404, and any `!! UNMOCKED` request. Fail on any `page.on('dialog')` event (native prompt, confirm or alert). | PR 2 (dialog rule enforced from PR 5) |
| C9 CSP (`--csp`, preview, chromium only) | Fulfill documents through `route.fetch()` + `route.fulfill({ response, headers: { ...h, 'content-security-policy': CSP } })`. CSP is read from nginx.conf.template:29 by regex at runtime. Fail on any console "Refused to". | PR 2 |
| C10 no Save | No visible button whose accessible name matches `/^save$/i` inside `[role=dialog][aria-label=settings]`. | PR 5 |

**Behaviour flows** (PR 4, in `flows.cjs` required by smoke.cjs; count `request` events with `method() === 'PATCH'`): listed in §12, PR 4.

**Fix existing scripts in PR 2:**
- run.sh:13-15: use `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &`. `$!` is then the server and the trap kills it.
- README.md in the folder: document smoke.cjs.
- capture.cjs and probe.cjs selectors are updated in PR 3 and PR 4 when the UI changes:
  - `open settings` becomes Menu → Settings;
  - `edit refresh interval`, `` edit ${name} `` and the textarea go away;
  - probe.cjs:27 and :37 `header > div.flex` are rechecked.

**CI** (.github/workflows/build.yml, inside `frontend-checks`, after `npm run build`):
```yaml
      - name: iPhone layout smoke test
        run: |
          npm install --no-save playwright@1.56.1
          npx playwright install --with-deps chromium webkit
          ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
          for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 0.5; done
          node --experimental-strip-types --test scripts/unit/
          node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp
      - name: iPhone layout smoke test (Safari engine)
        continue-on-error: true
        run: node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --browser webkit
```
- PR 5 adds `--strict` to both commands and removes `continue-on-error`, once the WebKit run has been green on PR 3 and PR 4.
- The `scripts/unit` line arrives in PR 4. Before PR 4 that folder does not exist, so leave the line out until then.
- `--no-save` leaves package.json, the lockfile, the Docker build stage and dependabot untouched.
- The preview server started in the first step survives into the second step only if both steps run in one shell. **Put both commands in the same step**, or start a new preview server in the second step. Use one step with `|| echo "Safari-engine run reported problems (not blocking yet)"` after the webkit command until PR 5.

**ESLint mobile bans** (frontend/eslint.config.js, core rules only, no new dependency). Add a config block with `files: MOBILE_SCOPE`, as errors:
- `no-restricted-globals` and `no-restricted-properties` for `prompt`, `confirm`, `alert` and `window.prompt`, `window.confirm`, `window.alert`.
- `no-restricted-syntax` with each message naming the fix:
  - `JSXOpeningElement[name.name='datalist']`;
  - `Literal[value=/\btext-\[(?:[0-9]|10)px\]/]` and the same on `TemplateElement[value.raw=…]`;
  - `Literal[value=/\bmin-h-\[(?:[0-9]|[1-3][0-9]|4[0-3])px\]/]` and the same on `TemplateElement`;
  - `Literal[value=/\b(?:min-|max-)?h-screen\b|\d+vh\]/]`;
  - `CallExpression[callee.property.name='addEventListener'][arguments.0.value='mousedown']`.

`MOBILE_SCOPE` grows as files are cleaned:
- PR 2: `src/components/Card.tsx`, `src/components/Toast.tsx`, `src/components/BriefCard.tsx`, `src/components/FramingWatch.tsx`, `src/components/SourceIcon.tsx`
- PR 3: adds `Drawer.tsx`, `Hamburger.tsx`
- PR 4: adds `src/components/feeds/**`, `src/lib/**`
- PR 5: `src/**/*.{ts,tsx}`

Allowed `// eslint-disable-next-line no-restricted-syntax -- <reason>`: SourceIcon.tsx:68 (decorative letter) and the desktop-only Card context menu (Card.tsx:1795-1855).

## 5. What you will see on the phone

**Top bar (every phone width):** the "Popping" title, Search, Refresh (phones only, as today) and one Menu button (≡). The gear is gone. While searching, the title and Refresh hide and the field takes the width. Clearing the field and tapping elsewhere closes search, as today.

**Menu** (the right-hand panel; title "Menu" on the left, Done on the right at 44px):
- **First group:**
  1. **Settings**: "Feeds, AI, notifications, saved and hidden". Opens Settings on Feeds.
  2. **History**
  3. **Save this view**: tapping it turns the row into a name field. Return saves. Inline from PR 5; `window.prompt` until then.
  4. **Sign out**: only when signed in.
- **Jump to column:** now switches the phone's tab.
- **Sources:** each row has the filter checkbox (unchanged) and a 44px › button that opens that feed's editor.

**F1. Change a feed's category** (today: gear → row → edit → field → type the exact spelling → save):
1. Tap ≡.
2. Tap › beside "The Verge". The Menu closes; Settings opens on Feeds with The Verge's editor open and scrolled into view.
3. Tap **Category**. The iOS picker lists "Your categories" (Deals, News, NHL…), then "Suggestions", then "New category…".
4. Pick "Tech". The label row shows "Saving…", then "Saved ✓" for 1.5 s. The feed's stories move to the Tech column.
5. Done (top right), the browser's Back, or Esc closes Settings. One Back never reopens it.

Result: 4 taps, no typing, no Save.

**F2. New category.** Steps 1-3, then:
- Pick "New category…". A field appears with the keyboard up (capital letters at the start of words, no autocorrect). Placeholder "e.g. Hockey".
- Type "Hockey". The live line reads "Shows as “Hockey”".
- Tap Return or **Add** (44px). It saves as typed: "Hockey".
- Typing "news" when "News" exists shows "Using your existing “News” category" and saves "News".
- "Saved", "For You" or 41+ characters show an error under the field, and nothing is sent.
- Tapping elsewhere does **not** save a half-typed name. **Cancel** puts the picker back.

**F3. A site blocks the reader.** The editor's "Last problem" line shows "upstream returned HTTP 403" and a **Use a browser identity** button.
- Tap it: a User-Agent row appears and saves. Popping fetches the feed again right away, and the line updates within about 15 s.
- Without a problem line: tap ≡ → › → **Headers** → **Use a browser identity**.

**F4. Pause:** ≡ → › → **Pause feed**. "Saved ✓". The button becomes **Resume feed** and the row name is struck through.

**F5. Check for new items:** ≡ → › → **Check for new items** → pick (+ the wheel's Done).

**F6. Delete:** ≡ → › → **Delete feed…**. The row becomes "Delete The Verge? This can't be undone. Pausing keeps it." with **Pause instead**, **Delete** and **Keep**, all 44px and with no timer. Delete → toast "Deleted The Verge" → the row disappears.

**F7. Rename or change the address.** Tap the field and edit. Return or tapping elsewhere saves.
- Spaces become underscores in names, and the hint previews the label.
- A server refusal shows plain words under the field, for example "Another feed already uses this name." The text is kept, with **Undo**.
- No connection: one silent retry after 2 s, then "Couldn't reach Popping. Check your connection." with **Try again**.
- After 8 s a slow save reads "Still saving…". After 35 s it gives up with "That took too long. Try again."

**F8. Close mid-save.** Type a new address and tap Done at once.
- The field saves as it loses focus, and Settings closes immediately.
- The dashboard updates when the save lands.
- If it fails, a red toast on the dashboard says "Couldn't save the address for The Verge: <reason>" with **Open**.
- Switching apps mid-edit also saves (sent with keepalive).

**F9. Through Settings:** ≡ → **Settings** (opens on Feeds) → tap a row → its editor.

**F10. Add a YouTube channel:**
- **Quick:** ≡ → Settings → **Add a feed** → paste a channel link, video link, @handle or channel ID into **Auto feed** → **Auto-add** (or the keyboard's Go). Toast "Added Mkbhd (YouTube)".
- **Form:** tap **YouTube**, paste, leave Name blank ("Will be saved as: mkbhd_yt") → **Test** ("✓ Looks good, 15 items" and "Resolved to the real feed: …") → **Add feed**. Add reuses the resolved link.
- **Failure:** a red box above the buttons explains it, for example "YouTube didn't let Popping look this channel up. Paste the channel ID instead: …".

**F11. One tap to a feed** (PR 5): tap the source name under any card ("The Verge · 12m ago"). Settings opens on that feed's editor.

**F12. AI settings** (PR 5): ≡ → Settings → AI.
- Provider and model are pickers that save when picked. "Other…" reveals a field that saves when you leave it.
- An API key saves when you leave the field and then shows "Key saved".
- There is no Edit button and no Save button. Brief length stays as chosen after a reload.

| Task | Today | After |
|---|---|---|
| Open a given feed's editor | 3 (gear → row → edit) | 2 (≡ → ›); 1 from a card (PR 5) |
| Change category | 5 + exact spelling | 4, no typing (3 from a card) |
| Browser identity | 5 + JSON | 3 (2 from the problem line via a card) |
| Pause | 3 | 3 |
| Check interval | 4 | 4 |
| Delete | 4 within 4 s | 4, no timer |
| Sign out on the phone | impossible | 2 |
| Open Settings | 1 | 2 (the cost of one button) |

Desktop (md and up) keeps the 480px right-hand panel and the sub-row. Only the gear is removed.

## 6. Feed editor

### Where things live

| File | Contents |
|---|---|
| frontend/src/components/FeedManager.tsx | Keeps MyFeedsTab, the slimmed SourceRow, RecommendedTab ("Suggested"), AutoFeedBlock and AddCustomTab, with every literal the guard tests pin. Loses the old edit form, JSON parser, `saveEdit`, re-seed effect, "edit", "every X", "save" and "cancel" links, the 4 s timer, `editingRowId`/`editingInterval`, and `parseApiError`/`friendlyTestError` (moved). **Rule: any new attribute in this file uses a string-literal `placeholder="…"`, never `placeholder={…}`**, because slice15:212-230 reads the first `placeholder={`. |
| components/feeds/FeedEditor.tsx (new) | `export function FeedEditor(props: { source: Source; sources: Source[]; onCheckNow(): Promise<void>; onDeleted(id: number): void })`, mounted under an open row. |
| components/feeds/CategoryPicker.tsx (new) | §7 |
| components/feeds/HeadersEditor.tsx (new) | §8 |
| components/feeds/SaveStatus.tsx (new) | `SaveStatus({ state })`: a `role="status" aria-live="polite"` `text-ios-caption` span. "Saving…" in `text-label-tertiary`; "Still saving…" after 8 s; "Saved ✓" in `text-emerald-400` for 1.5 s. The error renders under the control in `text-red-300` with `role="alert"`. Reused by the AI tab in PR 5. |
| lib/sourceSaves.ts (new, **no imports**, testable with `node --test`) | The save store (below) |
| lib/categories.ts, lib/headers.ts (new, **no imports**) | §7 and §8 rules |
| lib/apiErrors.ts (new) | `parseApiError` and `friendlyTestError` moved from FeedManager.tsx:163-210; `errorMessage(err)`; `fieldSaveMessage(err, field)` |
| lib/visualViewport.ts (new) | `useVisualViewport(): { height, offsetTop, kbInset, keyboardOpen }`, rAF-throttled on visualViewport `resize`/`scroll`. `kbInset = max(0, round(documentElement.clientHeight - vv.height - vv.offsetTop))`; `keyboardOpen = clientHeight - vv.height > 120`. Without visualViewport it returns zeros. |
| scripts/unit/sourceSaves.test.ts, categories.test.ts, headers.test.ts (new) | Node's runner with type stripping. Files outside `src`, so tsc never sees `node:test`. |

### SourceRow (slimmed)

- A header button `min-h-[44px] aria-expanded` holding the icon, the name (`min-w-0 truncate`), the category chip, the vote badge and the chevron.
- A caption line that is always shown, `flex flex-wrap text-ios-caption`: "updated 4m ago · every 1 hour" plus the chips "paused", "stopped after 6 failed checks" or "⚠ 3".
- `<li id={`feed-${id}`}>`.
- MyFeedsTab owns one `openRowId` (only one row open), initialised from `focusSourceId`.

### FeedEditor, top to bottom

Every control is `min-h-[44px] text-ios-body`. Labels are `text-ios-caption`. Each label row is `flex justify-between` with `<SaveStatus>` on the right.

1. **Last problem** (only when `last_error` is set):
   - "Last problem: <last_error>", `text-ios-caption text-red-300 break-words line-clamp-3` with a "More" toggle.
   - If `auto_disabled`: "Popping stopped checking after <error_count> failed tries. Fix the address or headers, then tap Resume feed."
   - If `last_error` matches `/\b(401|403)\b|forbidden/i`, the type takes headers (below), and no User-Agent is set: a **Use a browser identity** button that commits the preset (§8).
2. **Name.**
   - `type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"`.
   - Hint: "Shows as “<sourceLabel(draft)>”."
   - Read-only for built-ins, with "Built-in feed: its name and address are fixed."
3. **Address.** Label "Subreddit" for reddit rows.
   - `type="url" inputMode="url"`, same attributes. Read-only for built-ins.
   - While the draft differs from the saved value: "Its icon refreshes on the next check."
   - If the server returns a different URL (YouTube or Apple resolution): show it with "Saved as the channel's feed link".
4. **Category:** `<CategoryPicker>`.
5. **Check for new items:** `<select className="select-ios …">` over `REFRESH_PRESETS` (FeedManager.tsx:57). If the stored value is not a preset (HN's 5 minutes), put `<option value={v}>every {refreshLabel(v)}</option>` first.
6. **Headers:** `<HeadersEditor mode="autosave">`. Shown only when `!isBuiltIn(source) && ['rss','podcast','youtube_channel','generic_scrape'].includes(type)`. reddit (dynamic_reddit.py:171) and built-ins ignore headers.
7. **Website rows** (`generic_scrape` only): **Sitemap address** (`type="url"`) and **Only links starting with** (text; must start with "/", else "Start it with /"). Empty sends `null`.
8. **Actions** (`flex flex-wrap gap-2`, each 44px):
   - **Pause feed** or **Resume feed**.
   - **Check now**: POST /api/ingest/{name} with the existing toasts (FeedManager.tsx:869-883).
   - **Delete feed…**: inline confirm, no timer, with **Pause instead**, **Delete**, **Keep**.

**Built-in detection.** Add `'rfd_hot_deals'` to `KNOWN_BUILT_INS` (FeedManager.tsx:108-115). A no_db guard test pins it to the backend registry (§12, PR 4). Built-ins can still be paused, recategorised, re-intervaled and deleted.

### The save store (lib/sourceSaves.ts)

```ts
export type Field = 'name' | 'url' | 'category' | 'refresh_interval_seconds' | 'active' | 'custom_headers' | 'sitemap_url' | 'link_pattern'
export type SaveState = { status: 'idle' | 'saving' | 'slow' | 'saved' | 'error'; pending?: unknown; message?: string; retry?: () => void }
export function configureSourceSaves(deps: {
  patch: (id: number, body: Record<string, unknown>, opts: { keepalive: boolean; signal: AbortSignal }) => Promise<SourceRow>
  getSource: (id: number) => SourceRow | undefined
  onServerRow: (row: SourceRow) => void
  onRenamed: (oldName: string, newName: string) => void
  onFailedAway: (id: number, label: string, message: string) => void
  message: (err: unknown, field: Field) => string
  equal: (field: Field, a: unknown, b: unknown) => boolean
}): void
export function commitField(id: number, field: Field, value: unknown, label: string): void
export function getSaveState(id: number, field: Field): SaveState
export function subscribe(id: number, field: Field, cb: () => void): () => void   // for useSyncExternalStore
export function whenIdle(id: number): Promise<void>
export function dropSource(id: number): void
export function setPageHiding(hiding: boolean): void
```

`SourceRow` is a local structural type (`{ id: number; name: string } & Record<string, unknown>`), so the module has no imports. App calls `configureSourceSaves` once in an effect, with refs to its latest state.

**Triggers** (no time-based debounce):

| Field | Commits on |
|---|---|
| Name, Address, Sitemap, Link pattern | `onBlur`, and `onKeyDown` Enter → `e.currentTarget.blur()` |
| Category, Check for new items | `onChange` of the native select |
| Pause | tap |
| Headers | focus leaves the whole headers group, a row is removed, or a preset is tapped (§8) |

Why there is no debounce timer: every effective PATCH on an active feed rebuilds its job with `next_run_time=now` (scheduler.py:2462-2469 → :2144), which is a fetch. A timer would save half-typed addresses and fetch on every pause in typing.

**commitField algorithm:**
1. If the field is `queued`, compare with its queued value. Else, if it is in flight, compare with the in-flight value. Else compare with `getSource(id)[field]`. If `equal(...)`, clear a stale error when the value equals the server value, then return. Nothing is sent and "Saved" is not shown.
2. If the same field is already queued and not started, **replace its value**: the newest wins. Otherwise append `{ field, value, label }` to the per-source queue, a `Map<Field, item>` in insertion order. This absorbs an iOS picker that fires `change` on every wheel stop.
3. Set the state to `{ status: 'saving', pending: value }` and notify subscribers.
4. `pump(id)`: if nothing is in flight and the queue is not empty, take the first item.
   - Create `AbortController`; set a 35 s timeout that aborts; set an 8 s timer that sets `slow`.
   - Call `patch(id, { [field]: value }, { keepalive: pageHiding, signal })`. Each body holds **one key**, so a 422 belongs to one field. Different fields are never merged.
5. **Success** (`row`):
   - `prev = getSource(id)`; `onServerRow(row)`; if `prev && prev.name !== row.name`, then `onRenamed(prev.name, row.name)`.
   - If no newer value for this field is queued: set `saved`, then `idle` after 1500 ms.
6. **Failure:**
   - A `TypeError` (network) that has not been retried: retry once after 2000 ms by putting the item back at the front.
   - Otherwise set `{ status: 'error', message: message(err, field), retry: () => commitField(id, field, value, label) }`.
   - If nobody is subscribed to (id, field), the editor or picker is gone: call `onFailedAway(id, label, message)`.
   - A later success for the same field clears the error.
7. `finally`: clear the timers and in-flight state, then `pump(id)`.
8. `dropSource(id)` clears queued items. A result that arrives for a dropped id is ignored.
9. `whenIdle(id)` resolves when the queue is empty and nothing is in flight.

**api.ts:**
- `updateSource(id, body, opts?: { keepalive?: boolean; signal?: AbortSignal })` passes `keepalive` and `signal` to `fetch`. A keepalive body must stay under 64 KB; a PATCH is tiny.
- The body type gains `sitemap_url?: string | null; link_pattern?: string | null`.
- The comment changes to say "send null to clear" (it says `{}` at :434-437).
- `deleteSource` throws `ApiError` with `detail` (:446-452).

**Rollback on failure:**
- **Text fields** (name, address, sitemap, link pattern) keep the user's draft. The error shows under the field with **Undo** (sets the draft to the saved value, clears the error) and, for network, timeout or 5xx, **Try again** (calls `retry`).
- **Discrete controls** (category, interval, pause, header remove and presets) show the saved value again, because the store has no pending value. The message appears under the control.
- The backend's text is shown through `fieldSaveMessage`:

| Response | Message |
|---|---|
| 409 | "Another feed already uses this name." |
| 400 with "built-in" | "Built-in feeds keep their name and address." |
| 400 with "reserved for a built-in source" | "That name belongs to a built-in feed. Pick another." |
| 422 "category cannot be empty" | "Pick a category." |
| 422 "reserved for a built-in column" | "“<value>” is used by the app. Pick another name." |
| 422 "40 characters" | "Keep it to 40 characters or fewer." |
| 422 "cannot be overridden" | "Popping can't send a <Name> header." |
| 422 "exceeds 512" | "Too long (512 characters max)." |
| 422 "disallowed characters" | "Use plain letters, numbers and punctuation." |
| 422 "at most 20" | "20 headers at most." |
| 422 "isn't valid" (new header-name rule) | "Header names use letters, numbers and dashes." |
| 422 "not reachable" | "That address isn't reachable from Popping." |
| any other 4xx with a string detail (including the YouTube messages) | the detail as is |
| 401 | "Please sign in again." |
| 5xx | "Popping had a problem saving. Try again." |
| TypeError | "Couldn't reach Popping. Check your connection." |
| AbortError | "That took too long. Try again." |

**Validation the client does before any PATCH.** A failure shows the error, sends nothing and keeps the draft.
- **Name:** `trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')`, then `^[a-z0-9_]{1,120}$`. Empty: "Type a name." Matching a `KNOWN_BUILT_INS` name: "That name belongs to a built-in feed. Pick another."
- **Address** (non-reddit): trim; add `https://` when there is no `://` and the value has a dot; `new URL(v)` with protocol `http:` or `https:`, else "Use a web address that starts with https://". YouTube shapes go through `normalizeFeedInput`.
- **Address** (reddit): non-empty. The backend canonicalises it.
- **Category:** §7. **Headers:** §8. **Link pattern:** starts with "/" and has no "://".

**What the backend still rejects** (the client mirrors the first five; the rest arrive as messages):
- name regex 422 (sources.py:111, 680); registry name 400 (:681-685); built-in rename or re-URL 400 (:765-771); name collision 409 (:786-795);
- URL scheme, netloc or SSRF 422 (:220-241); Apple/YouTube resolution 422; reddit validation 422;
- category empty, over 40 or reserved 422 (:287-303);
- headers: not an object, more than 20, non-string, denylisted, over 512, non-printable, and (new) bad name or case-insensitive duplicate 422;
- `refresh_interval_seconds` is clamped silently to [60, 86400].

### App wiring (App.tsx)

**`applyServerSource(row)`:**
- `setSources(prev => prev.map(s => s.id === row.id ? { ...row, net_vote_score: s.net_vote_score } : s))`. The PATCH response carries `net_vote_score: 0` (sources.py:398-403).
- `localWritesRef.current.set(row.id, Date.now())`.

**`removeSource(id)`:** filter it out, `localDeletesRef.current.set(id, Date.now())`, then `dropSource(id)`.

**`insertSource(row)`:** append, then sort by (category, name).

**Polling overlay** in `refresh()` (App.tsx:1057):
- Record `startedAt = Date.now()` before `Promise.all`.
- On resolve, before `reconcileById`:
  - drop ids whose delete time is ≥ `startedAt`;
  - for ids whose write time is ≥ `startedAt`, keep the previous local row;
  - prune entries older than 120 s.
- A poll that began before a save or delete can no longer undo it, and other rows still update.

**`refresh(opts?: { silent?: boolean })`:** the "refreshed" / "N new" toast and the error toast fire only when not silent. Errors still set the dashboard banner.
- The interval becomes `() => void refresh({ silent: true })`.
- Pass `{ silent: true }` at visibility (:1263), initial load (:1271) and the filter debounce (:1343).
- Settings' and Drawer's `onRefreshSources` (:2805, :2838) become `() => refresh({ silent: true })`. They return the promise, so FeedManager's `await onRefresh()` really waits.
- The phone refresh icon, the desktop Refresh button, the `r` key and Column's chip keep calling `refresh()` with no argument. Column gets a stable `const manualRefresh = useCallback(() => refresh(), [refresh])`. Column's memo comparator ignores callbacks.

**Follow-up check.** After a successful `url` or `custom_headers` save on an active feed, call `refresh({ silent: true })` once, 15 s later (one timer per source id). The "Last problem" line then shows the result of the fetch the PATCH started.

**`onFailedAway(id, label, msg)`:** `toast(`Couldn't save the ${label} for ${sourceLabel(name)}: ${msg}`, { kind: 'error', action: { label: 'Open', onClick: () => openSettings('feeds', id) } })`.

**`onSourceRenamed`** (App.tsx:1994-2003):
- Also remap `filterPresets[].activeSources` with `prefs.setFilterPresets(presets.map(p => p.activeSources.includes(old) ? { ...p, activeSources: p.activeSources.map(n => n === old ? nw : n) } : p))`.
- Use `filterPresetsRef` (App.tsx:627) so the callback stays stable.

**Phone tab remembered by name** (App.tsx:445, 1358-1367; storage.ts:52):
- Add a `STORAGE_KEYS.mobileColName = 'popping.v1.mobileCol.name'`.
- State: `mobileColName: string` (`'__brief__'` for the Brief tab). It is initialised from that key, or migrated once from the index key: once `columns` is non-empty, map the stored index to `columns[i]?.name`.
- Derive `mobileCol = name === '__brief__' ? -1 : columns.findIndex(c => c.name === name)`.
- If the result is -1 and `columns.length > 0`, the column vanished: show the column at the last rendered index (kept in a ref), clamped to `columns.length - 1`, and store its name.
- `setMobileCol(i)` becomes `setMobileColName(i === -1 ? '__brief__' : columns[i].name)`.
- Never write the key while `columns` is empty.

**Moving the last feed out of a category.** That column disappears on the next render, because columns are grouped from visible entries (App.tsx:753-764). If it was the open phone tab, the user lands on the neighbouring column. Otherwise the user stays on the same column by name.

### Settings wiring (Settings.tsx)

- `const reportError = useCallback((m: string) => toast(m, 'error'), [])`, defined before `if (!open) return null`. Pass it as FeedManager's and HistoryTab's `onError` (:269, :398) instead of App's `setError`.
- **Keyboard** (from `useVisualViewport()`). While `keyboardOpen`:
  - the panel's inline style is `top: calc(env(safe-area-inset-top) + 0.75rem + ${offsetTop}px)` and `bottom: ${documentElement.clientHeight - (offsetTop + height)}px`;
  - the body drops its safe-area bottom padding.
  - On each viewport resize, the focused element gets `scrollIntoView({ block: 'nearest' })`.
  - Done and the focused field both stay visible.
  - Desktop (`md:`) ignores this, because the style is applied only when `matchMedia('(max-width: 767px)').matches`.
- **Close path** (Done, Esc, backdrop):
  1. `(document.activeElement as HTMLElement | null)?.blur()`. The blur commits a pending text field.
  2. Run the registered editor flushers (each FeedEditor registers `flush()` in a module `Set`; it commits any dirty, valid text draft).
  3. `onClose()`. Nothing waits.
- **App switching:** while Settings is open, a `visibilitychange` (hidden) and a `pagehide` listener call `setPageHiding(true)`, blur the active element and run the flushers. Those PATCHes go out with `keepalive: true`. `setPageHiding(false)` runs on `visible`.
- **Check now and Delete:** `await whenIdle(id)` first, then use `getSource(id).name`. A pending rename therefore cannot make `/api/ingest/<old name>` 404.
- **Delete success:** `removeSource(id)`, then toast "Deleted <label>".

## 7. Category picker

`CategoryPicker({ id, value, sources, onChange, disabled, mode: 'autosave' | 'form' })` in components/feeds/CategoryPicker.tsx. It replaces the edit form's `<input list>` + `<datalist>` (FeedManager.tsx:602-618, deleted) and the Add form's `<select id="fm-category">` (:1722-1731). Keep `id="fm-category"` on the select in the Add form.

**Source of categories:** `sources.map(s => s.category)`, never App's `categories`, which come from visible entries and miss empty categories (App.tsx:753-764). lib/categories.ts:
- `categoryOptions(sources, label)` returns `{ yours: Array<{ value, text, count }>, suggestions: string[] }`.
  - **yours:** unique exact strings, plus `value` if it is missing, sorted by `label(value)`. `text = label(value)`. If two raw values share a label ("news" and "News"), the text becomes `${label} (${raw})` so they can be told apart.
  - **suggestions:** `CATEGORY_OPTIONS` (FeedManager.tsx:80-105) minus anything already in "yours", compared without case. On a fresh install this is the only group.
- `label` is passed in as `categoryLabel` (labels.ts:64-68). The module has no imports.

**Rendering:** one native `<select className="select-ios w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline px-3 text-ios-body">` with `<optgroup label="Your categories">`, `<optgroup label="Suggestions">`, and a last `<option value="__new__">New category…</option>`. A native select gives the iOS wheel. A datalist is invisible on iOS Safari.

**"New category…" flow:** choosing `__new__` sets `mode='new'` and renders:
- `<input type="text" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={40} placeholder="e.g. Hockey" autoFocus>`. Focus is allowed because the user asked for the field.
- A live line: "Shows as “<categoryLabel(normalised)>”".
- 44px **Add** and **Cancel** buttons.
- **Return or Add commits. Blur does not commit.** Cancel returns to the select with the current value.

**Rules** (lib/categories.ts `resolveNewCategory(input, existing)`):
1. Normalise: `trim()`, then collapse inner whitespace to one space. **Keep the case as typed.** Lower-casing would turn "NHL" into "nhl", which `categoryLabel` shows as "Nhl" because `nhl` is not in ACRONYMS (labels.ts:21-25).
2. Empty: "Type a name."
3. Longer than 40 (`CATEGORY_MAX = 40`, models.py:46): "Keep it to 40 characters or fewer."
4. Lower-cased equal to an entry in `RESERVED_CATEGORIES = ['saved', 'for you']` (sources.py:162): "“<input>” is used by the app. Pick another name."
5. Equal to an existing category ignoring case: return the existing spelling with `reused: true`. The line reads "Using your existing “News” category".

**Commit:**
- In the editor: `commitField(id, 'category', final, 'category')`. The select shows `pending ?? source.category`.
- In the Add form: `setCategory(final)`.

**Reserved names** are also mirrored for picking from Suggestions; the backend stays the authority.

**Backend (PR 1):** `_validate_category` returns the stripped value. POST (:469 → :518), /auto (:608 → :617) and PATCH (:752 → :779) store the returned value. No lower-casing, because entries.py:366 compares raw strings.

**Existing case or space duplicates:** the "(raw)" suffix makes them visible, and the user can move feeds one by one. A bulk merge is a non-goal (§12).

## 8. Headers

`HeadersEditor({ value, onCommit, disabled, mode: 'autosave' | 'local', status })` in components/feeds/HeadersEditor.tsx. Rules live in lib/headers.ts.

**Rows:**
- State is `Array<{ key: number; name: string; value: string }>`, seeded from `Object.entries(value ?? {})`.
- Reseed only when no header input is focused, no headers save is pending, and the server map differs from the last seeded map (canonical JSON).
- Layout per row, at 320 width (`grid grid-cols-[1fr_auto] gap-2`):
  - First line: the name input (`placeholder="Header name"`, `autoCapitalize="none" autoCorrect="off" spellCheck={false}`, 17px) and a 44×44 remove button (`aria-label="remove header <name>"`, a minus-circle icon).
  - Second line: the value input spanning both columns (`placeholder="Value"`).
  - Errors appear under the row.

**Below the rows:**
- **Add header** (44px, outline). `flushSync` adds a row, then its name input is focused in the same tap, so iOS opens the keyboard. Hidden at 20 rows.
- **Presets.** Each is hidden when that header already exists (case-insensitive):
  - **Use a browser identity:** `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`.
  - **Prefer English:** `Accept-Language: en-CA,en;q=0.9`.
- Footnote: "Some sites block automated readers. A browser identity usually fixes it. Saved as plain text, so don't put passwords or keys here."

**Commit triggers:**
- `onBlur` on the group container when `!e.currentTarget.contains(e.relatedTarget as Node)`. iOS gives a null `relatedTarget` when you tap outside, which also commits.
- Removing a row commits.
- Tapping a preset commits.
- Return in a value field blurs it.

In `local` mode (Add form), commit just calls `onCommit`, which sets form state.

**Validation before sending.** Either the whole map is sent or nothing is.
- **Normalise values:** “ ” become ", ‘ ’ become ', en and em dashes become -, … becomes "...", then trim. Trim names.
- **Both empty:** the row is dropped silently. The backend accepts blank keys (sources.py:325-334), so the client must drop them.
- **Only one filled:** "Fill in both to save this header." The row stays as a draft and nothing is sent.
- **Name not matching `^[!#$%&'*+.^_`|~0-9A-Za-z-]+$`:** "Header names use letters, numbers and dashes."
- **Name in `HEADER_DENYLIST`** (exactly sources.py:169-187: cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url; compared lower-cased): "Popping can't send a <Name> header."
- **Duplicate name** ignoring case: "Already added."
- **Value over `HEADER_VALUE_MAX = 512`:** "Too long (512 characters max)."
- **Value outside `^[\t\x20-\x7e]*$`:** "Use plain letters, numbers and punctuation."
- **More than `HEADERS_MAX = 20` rows:** "20 headers at most."

**Empty rows → null versus {}:**
- `rowsToMap(rows)` returns an object of the complete rows, or `null` when there are none.
- `sameHeaders(a, b)` compares key-sorted JSON and treats `null` and `{}` as equal.
- The client always sends `null` to clear. The backend stores both `{}` and `null` as NULL (sources.py:354, :754-759).
- No request is sent when the map equals the saved one.
- In the editor: `commitField(id, 'custom_headers', map, 'headers')`.

**Add form** (FeedManager.tsx AddCustomTab):
- A `<details>` with `<summary className="min-h-[44px] flex items-center …">Advanced: headers for sites that block readers</summary>` holds `<HeadersEditor mode="local">`.
- Its map goes to `api.testSource({ …, custom_headers })` (api.ts:389-400, already accepted) and to `api.createSource`.
- `friendlyTestError('forbidden')` (FeedManager.tsx:174) reads: "This site blocks automated readers. Open “Advanced” below, tap “Use a browser identity”, then Test again."

**Backend (PR 1, `_validate_custom_headers`, sources.py:306-354):**
- After the type check, reject a key not matching `_HEADER_NAME_RE = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")` (`fullmatch`). Message: `header name {k!r} isn't valid`.
- Reject a key whose lower-case form was already seen. Message: `header {k!r} is listed twice`.

## 9. Top bar

**The one button** is the existing Hamburger (≡, Hamburger.tsx:11-33, `aria-label="open menu"`). Search and the phone-only Refresh stay: one is an action and the other is a field, not menus. Pull-to-refresh is a non-goal.

**Deleted (PR 3):**
- The gear button App.tsx:2296-2331 (the comment, the button with `data-settings-gear`, the SVG). Nothing else references it.
- Drawer's "All settings…" wording.
- The dead `onResetLocalState` prop (Drawer.tsx:61-66, 89-92; App.tsx:2810).
- Stale comments at App.tsx:2-17 and 2211-2219, and Drawer.tsx:3-9, 71-75 and 257-261.

**Menu (Drawer.tsx) contents:**
1. **Settings** (gear icon), subtitle "Feeds, AI, notifications, saved and hidden". `onOpenSettings?.('feeds'); onClose()`. The first row of the first group. It replaces "All settings…" at Drawer.tsx:377-390.
2. **History** (Drawer.tsx:336-351, unchanged).
3. **Save this view** (Drawer.tsx:366-376). From PR 5 it is an inline field: tapping the row turns it into a 17px input with a 44px **Save**. Return or Save calls `onSavePreset(name)`. App's `onSavePreset` becomes `(name: string) => { savePreset(name); toast(`Saved view “${name}”`, 'info') }`, and the `window.prompt` at App.tsx:2812-2832 is deleted.
4. **Sign out**: a GroupedRow, only when the new prop `onSignOut` is set. App passes `user ? async () => { try { await api.logout() } finally { window.location.reload() } } : undefined`, mirroring UserBadge.tsx:20-29. Subtitle `user.name || user.email`.
5. **Jump to column** (Drawer.tsx:393-409). `jumpToCategory` (App.tsx:2022-2030) also calls `setMobileCol(idx)`, which becomes the name-based setter in PR 4. The desktop scroll target becomes `(el?.firstElementChild as HTMLElement | null)?.scrollIntoView(…)`, because the ref is a `display: contents` div (App.tsx:2598).
6. **Sources** (Drawer.tsx:454-479):
   - Each row becomes `<div className="flex items-center border-b border-hairline last:border-b-0">` containing the existing `<label className="flex flex-1 min-w-0 items-center gap-3 pl-4 min-h-[44px] …">` and a sibling `<button type="button" aria-label={`edit ${sourceLabel(s.name)}`} className="w-11 h-11 shrink-0 flex items-center justify-center text-label-tertiary active:bg-bg-elevated" onClick={() => { onEditSource?.(s.id); onClose() }}><ChevronRight /></button>`.
   - New prop `onEditSource?: (id: number) => void`. App passes `(id) => openSettings('feeds', id)`.
   - `{s.category}` (:477) becomes `{categoryLabel(s.category)}`. The footnote (:415) uses `sourceLabel`.
   - "Clear" (:420-426) gets `min-h-[44px] px-2 -mr-2`.

**Other Drawer fixes:**
- Header: title left, Done right (§4).
- Grabber (Drawer.tsx:303-306): `top-3` becomes `top-[calc(env(safe-area-inset-top)+0.75rem)]`.
- While closed, the aside is `inert`: an effect does `asideRef.current?.toggleAttribute('inert', !open)` and sets `aria-hidden`, because React 18 has no `inert` prop. The closed Drawer then leaves the tab order.
- Backdrop and panel transitions get the `motion-safe:` prefix.

**Where Settings lives:** the same z-50 overlay with the same `?view=settings&tab=` contract, reached only from the Menu row, the History row, the Menu's ›, a card's source name (PR 5), or a URL.

**Settings routing (App.tsx):**
- **Focus parameter.** New state `settingsSourceId: number | null`. `sync()` (App.tsx:395-424) reads `source` with `/^\d+$/`. Settings passes `focusSourceId` to FeedManager. FeedManager sets its tab to 'mine' and `openRowId`, then on the next frame calls `document.getElementById(`feed-${id}`)?.scrollIntoView({ block: 'start' })`.
- **`openSettings(tab = 'feeds', sourceId?: number)`,** wrapped in `useCallback`, with no deps. It sets `view`, `tab` and `source` (or deletes `source`), calls `window.history.pushState({ popping: 'settings' }, '', url)`, then sets the state.
- **`closeSettings`,** also `useCallback`:
  - If `window.history.state?.popping === 'settings'`, call `window.history.back()`. popstate then runs `sync`, which closes Settings.
  - Otherwise (opened by deep link, or state lost): delete `view`, `tab` and `source`, call `replaceState(null, '', url)`, then `setSettingsOpen(false)`.
  - Result: Done, Esc and the backdrop add no history entry, and one Back after Done does not reopen Settings.
- **Settings tab buttons** (Settings.tsx:238-246): `u.searchParams.delete('source')` and `window.history.replaceState(window.history.state, '', u.toString())`, which keeps the flag (today it passes `null` at :241). Keep the synthetic popstate.
- **FeedManager** removes `source` the same way (replaceState with the current state) when the user collapses or changes the open row, so reload and Back do not refocus it.
- **One tab list:** `export const SETTINGS_TABS = ['feeds','llm','notifications','history','hidden','starred','voted','reset'] as const` in Settings.tsx, with `export type SettingsTab = typeof SETTINGS_TABS[number]`. Use it for the strip (Settings.tsx:229) and the App allow-list (App.tsx:409-418) as `(SETTINGS_TABS as readonly string[]).includes(t)`. `allowConstantExport` permits this.
- **Panel animation:** `motion-safe:animate-sheet-up md:animate-none` (the keyframe exists at tailwind.config.js:97-100 and is unused).
- **Settings tab pills** (Settings.tsx:248): `min-h-[44px]`; the strip gets `data-hscroll`.
- **Stacking:** header z-20 < Drawer z-30/40 < Settings z-50 < Toast z-[60]. Esc capture listeners are unchanged.

## 10. iPhone checklist

Merged from the audit reports and de-duplicated. Each line was checked against the code. The full list with file:line, fix and confidence is in the audit checklist output; the PR that closes each item is in §12.

**Overflow (§4):**
- Feeds tab gutter (Settings.tsx:265)
- Search row at 320 (App.tsx:2220-2262)
- Thumbnail ribbon (Card.tsx:905, 1734)
- Meta row wrap (Card.tsx:955-963)
- Inline actions wrap (Card.tsx:976-1135)
- Auto-add off-screen and the Settings body at 369/320 (FeedManager.tsx:1245-1266)
- Feed names clipped by chips (FeedManager.tsx:695-786)
- Title "Pop…" at 320 (App.tsx:2296-2331)
- Settings title and Done (Settings.tsx:211-222)
- Pills wrap (FeedManager.tsx:264-287)
- 16px override (styles.css:22-26)
- 9 and 10px text (Card.tsx:1174, App.tsx:2709, FramingWatch.tsx:81/111)
- Double clear button (App.tsx:2235)
- BriefCard header (BriefCard.tsx:562)
- Toast one line (Toast.tsx:122)

**Keyboard and viewport:**
- The Settings sheet ignores the keyboard (Settings.tsx:204)
- The toast sits under the keyboard (Toast.tsx:117)
- Inline `minHeight: 100dvh` fights the `height: 100%` chain (App.tsx:2188)

**Safe areas:**
- The Drawer grabber sits under the status bar (Drawer.tsx:303-306)
- Side insets in landscape (App.tsx:2210, 2655, 2668; Drawer.tsx:288; Settings.tsx:204)

**Landscape:** an iPhone in landscape gets the desktop grid (App.tsx:2594, 2655; FramingWatch.tsx:175; BriefCard.tsx:372). PR 6.

**Tap targets under 44px:**
- Done buttons (Settings.tsx:215, Drawer.tsx:318)
- Settings pills (Settings.tsx:248)
- Feed row links (FeedManager.tsx:790-920)
- Suggested buttons (FeedManager.tsx:1069-1127)
- Mobile tabs (App.tsx:2677, 2703)
- Filter chips (App.tsx:2380-2393)
- Preset chips (App.tsx:282-374)
- Search clear (App.tsx:2250)
- Error ✕ (App.tsx:2404-2410)
- Column ⋯ (Column.tsx:393) and "+N new" (Column.tsx:349)
- Settings text links (Settings.tsx:346, 765, 831, 910, 1230, 1238, 1406, 1450)
- BriefCard tone pills (BriefCard.tsx:312)
- ShortcutsSheet close (ShortcutsSheet.tsx:93)
- Card action icons at 40px (Card.tsx:1254-1431)

**Inputs:**
- Auto-capitalisation and autocorrect on the login username (LoginPage.tsx:72) and the feed name, subreddit, URL and category fields
- Selects look like text boxes (Settings.tsx:776, 812, 855; Column.tsx:418, 462)
- The datalist is invisible on iOS (FeedManager.tsx:605-618)

**Gestures:**
- Card swipe lags the finger (Card.tsx:513)
- Long-press copy fights the native link callout (Card.tsx:585-593)
- The popover ignores taps on empty space (Column.tsx:244)
- No overscroll containment on any scroller

**Overlays and history:**
- Done re-pushes history, so Back reopens Settings (App.tsx:438-444, Settings.tsx:241)
- The closed Drawer can still be focused (Drawer.tsx:262-295)
- Errors are hidden under the sheet (App.tsx:2397-2411)
- `z-15` emits nothing (App.tsx:2401)

**Dead or misleading UI:**
- "Jump to column" does nothing (App.tsx:2022-2030, 2598)
- No sign-out on the phone (App.tsx:2364)

**False positives removed after checking the code:**
- "Card options chevron → Edit this feed": the chevron toggles the summary, and the card menu is right-click only (Card.tsx:708-808, bound at :879).
- "A keyboard shortcut and BriefCard pills open Settings": the only callers are App.tsx:2307 and :2811.
- "The headers textarea's third line is clipped by line height": moot once the textarea is deleted.
- "The draft guard's 'beyond parent' rule": it flags the intentional `-ml-3`/`-mr-2` hit areas about 25 times per state (shots/390-overflow-scan.json). Replaced by C3-C5.
- "Toast at Toast.tsx:256-261": the file has 143 lines; the right lines are 117 and 122.
- "The rAF focus fallback (App.tsx:2270) fails on iOS": `autoFocus` already opens the keyboard. No change.
- "Card context menu ignores insets (Card.tsx:1832)": desktop only.
- "No service worker or offline mode": not a defect, and a service worker would be a background process. Non-goal.
- "The coarse-pointer rule misses iPads with trackpads": moot once the rule is deleted and controls are 17px by design.

## 11. Ease-of-use checklist

The full list is in the audit checklist output. In short:

**Saving:**
- Autosave for the feed editor (PR 4) and the AI tab (PR 5): provider and model pickers save on change with an "Other…" field; API keys save on blur; delete the LLM save button (Settings.tsx:928-934) and the Edit/Cancel toggle (:763-768).
- Brief length is remembered per device (`popping.v1.brief.tone` in storage.ts; App.tsx:457).
- Preference save failures show one error toast per burst and retry once (preferences.tsx:523-532; fix the stale comment at :28-30).

**Pickers instead of free text:** category (PR 4); AI models (PR 5); the column "Min score" slider becomes a picker "Show: All / Top half / Top stories" mapping to minScore 0/40/70 (Column.tsx:432-456).

**No native dialogs:**
- Save this view and preset rename become inline fields (App.tsx:2826, 306).
- Reset uses an inline two-step confirm (Settings.tsx:413).
- Lint and smoke C8 enforce this.

**Undo and confirms:**
- Saved "Clear all" and "Hide all downvoted" show an Undo toast that restores the previous array (App.tsx:2860-2887).
- Feed delete confirm has no timer and offers "Pause instead" (FeedManager.tsx:379, 433-437).

**Misleading behaviour:**
- The "refreshed" toast fires every minute (App.tsx:1112, 1247-1249).
- The "+N new" chip refreshes and the count never changes (Column.tsx:341-357). It becomes a non-interactive badge.
- A column header tap marks everything read (Column.tsx:314-325). The header becomes static on touch (`matchMedia('(hover: hover)')`), and a 44px "Mark all as read" becomes the first item in the ⋯ popover, inside `popoverRef`.
- Hiding a card says "moved to history" (App.tsx:1615). It becomes "Hidden." with Undo, like App.tsx:2452.

**Plain words:**
- Raw "500 … for /api/…" errors become `errorMessage` at App.tsx:1114-1115, SearchResults.tsx:81, LoginPage.tsx:105, Settings.tsx:336/923/926/1099/1416 and BriefCard.tsx:594/785.
- "Feed Manager" and "scheduler" (Column.tsx:824, 836; App.tsx:2495).
- "Top (composite score)" (Column.tsx:425).
- "(local bypass)" (UserBadge.tsx:37).
- The star tooltip shows "(s)"; it should be "(b)" (Card.tsx:1392).
- ".env" copy on the Notifications tab (Settings.tsx:361-371).
- "set provider in env", "Scoring model" (Settings.tsx:759, 843).
- The literal "◯ with strike" (Settings.tsx:1110, 1165) becomes the eye-off icon from TabIcon.
- Right-click and keyboard empty states (Settings.tsx:1526, 1598, 1683).
- Suggested feeds show raw slugs (FeedManager.tsx:1110-1111).
- "generic_scrape" and "Track page (no RSS)" wording (FeedManager.tsx:1281; keep "Track page" and "no RSS" in the radio label because slice15:127-133 pins them).
- "fetch" becomes "Check now".
- "Voted" becomes "Downvoted"; the id stays `voted`.

**Truncation:** Hidden and Saved titles get two lines (Settings.tsx:1436). Feed errors move from tooltips to on screen (FeedManager.tsx:704-754).

**One tap to edit:** the card's source name opens its editor (Card.tsx:961). PR 5.

## 12. Build order

Every PR:
- branches from up-to-date main;
- runs the §13 recipe before pushing;
- is opened as a draft PR to main (CI runs only for base main, build.yml:14-18);
- passes the §2 path check;
- gets the owner go/no-go;
- is merged only when all four check runs are green. Poll them with `gh api repos/adamjmachill/popping/commits/<sha>/check-runs`; `gh pr view` hits a GraphQL 403.

The PR body lists the checklist items it closes, with file:line. Run `pytest -m no_db` (4 s) before every push that touches FeedManager.tsx, Column.tsx, App.tsx, Card.tsx or api.ts.

**PR 1. Backend: YouTube, header rules, category strip, reddit Test, scheduler fixes, tests.**

Files: backend/app/youtube.py, backend/app/routes/sources.py, backend/app/scheduler.py, backend/app/schemas.py (docstrings), backend/tests/test_youtube.py, backend/tests/test_source_editor_contract.py (new), README.md (YouTube how-to).

Changes:
- **YouTube:** §3.
- **Reddit Test** (sources.py:1007-1009): `from app.reddit_client import fetch_subreddit` and `from app.sources.reddit import normalize_subreddit`. `slug = normalize_subreddit(url)`; `items = await fetch_subreddit(slug, listing="hot", limit=25) if slug else []`. When the list is empty, return `ok=False, error_kind="not_found", error="Reddit returned no posts. The subreddit may be private, banned or busy."`.
- **Test endpoint category:** call `_validate_category` when the body has a category. On failure return `ok=False, error_kind="invalid_category"` with the message. Document `invalid_category` in the SourceTestResult docstring.
- **Header name rules:** §8.
- **Category strip:** §7.
- **scheduler.update_source,** three changes, each with a comment:
  1. After the built-in check, replace `if active is False:` with `if not row.active:`. A PATCH of category, headers or address on a paused or auto-disabled row no longer creates a job that ingest then skips (scheduler.py:387).
  2. If `category_changed` and none of refresh, active, name, url, headers, sitemap or link_pattern changed, `return row` before `_add_or_replace_dynamic_job`. Ingest reads the category from the DB row (scheduler.py:431). Name, URL and headers still rebuild, because the job holds `args=[plugin]` built from the row (dynamic_rss.py:56, 71).
  3. If `row.active` and any of url, headers, sitemap or link_pattern changed, set `row.error_count = 0` before commit. A user trying fixes cannot trip auto-disable (`_AUTO_DISABLE_THRESHOLD = 6`, scheduler.py:206) while still editing. Paused rows keep their count, so `auto_disabled` stays meaningful.

**PR 2. Overflow root causes, the guard and lint bans.**

Files: frontend/scripts/iphone-audit/{smoke.cjs (new), run.sh, capture.cjs, fixtures.cjs, README.md}; frontend/src/styles.css; frontend/src/lib/visualViewport.ts (new); App.tsx (search row, badge, `data-hscroll` on strips, `z-15` → `z-10`); Card.tsx; BriefCard.tsx; FramingWatch.tsx; SourceIcon.tsx; Settings.tsx (header, Done, gutter, overscroll, pills 44px, `data-hscroll`); Drawer.tsx (header, Done, overscroll); FeedManager.tsx (class-only: Auto-add row, TabButton, chips to the caption line, 13px labels); Column.tsx (overscroll class only); Toast.tsx; frontend/eslint.config.js; .github/workflows/build.yml.

Steps:
1. Write smoke.cjs and confirm it fails today with C2 at 320 search, C3 and C4 on the Auto-add row, and C5 on the feed rows and pills.
2. Apply the §4 PR 2 fixes.
3. Re-run until it is green at 390 and 320.
4. Look at every PNG.
5. Add the lint block and the CI steps.

**PR 3. One Menu button, Settings history, focus links.**

Files: App.tsx, Drawer.tsx, Hamburger.tsx (comment only), Settings.tsx, FeedManager.tsx (`openRowId`, `focusSourceId`, row ids, replaceState of `source`), frontend/scripts/iphone-audit/{capture.cjs, probe.cjs, smoke.cjs} selectors and states, eslint.config.js (scope).

Steps: §9 in order: remove the gear; the Drawer rows, sign-out, ›, Clear, grabber, inert, labels and dead prop; `jumpToCategory`; the focus param and `openSettings(tab, id)`; `closeSettings`; tab `replaceState`; `SETTINGS_TABS`; FeedManager focus; smoke states for Menu → Settings and Menu → ›.

**PR 4. The editor that saves on its own, the category picker, headers, the Add form and the YouTube frontend.**

Files: FeedManager.tsx; components/feeds/{FeedEditor, CategoryPicker, HeadersEditor, SaveStatus}.tsx (new); lib/{sourceSaves, categories, headers, apiErrors}.ts (new); lib/storage.ts (`mobileColName`); Settings.tsx (reportError, keyboard, close and flush path, visibility flush); App.tsx (`configureSourceSaves`, `applyServerSource`, `insertSource`, `removeSource`, the overlay, `refresh({ silent })`, `onFailedAway`, preset remap, tab-by-name, follow-up check); api.ts; backend/tests/test_frontend_feed_editor_rules.py (new, no_db); frontend/scripts/unit/*.test.ts (new); frontend/scripts/iphone-audit/{smoke.cjs, flows.cjs (new), fixtures.cjs}; eslint.config.js (scope); build.yml (the unit-test line).

**Behaviour flows (flows.cjs):**

| Flow | Do | Expect |
|---|---|---|
| FA | ≡ → › first fixture → pick "Tech" | exactly 1 PATCH, body `{"category":"tech"}` (existing lower-case "tech" reused); "Saved ✓" visible |
| FB | type 10 characters into Address without leaving; then press Enter, then blur | 0 PATCHes while typing; exactly 1 after Enter + blur |
| FC | `page.route('**/api/sources/<id>', r => r.fulfill({ status: 422, json: { detail: "category 'For You' is reserved for a built-in column" } }))`, then pick a category | the picker shows the old value; "“For You” is used by the app…" is visible (`elementFromPoint` at its centre returns it or a descendant) |
| FD | `route.abort('failed')` twice on the Address save | "Couldn't reach Popping…" and Try again visible; typed text kept; Try again with the route removed sends 1 PATCH → "Saved ✓" |
| FE | "Use a browser identity" | 1 PATCH with a `User-Agent` key; typing the header name "Cookie" then blurring sends 0 and shows "Popping can't send a Cookie header." |
| FF | delay the PATCH by 1500 ms, change Address, tap Done | the sheet is gone immediately; after the response the row shows the new address on reopen. Variant with the PATCH aborted: a red toast with "Open" is visible on the dashboard |
| FG | open from Menu, Done, then `page.goBack()` | Settings stays closed; the URL has no view, tab or source; `history.length` grows by at most 1 per open/close cycle |
| FH | three quick `selectOption` calls on Check for new items | at most 2 PATCHes (first in flight + newest); the final row shows the last value |
| FI | a stale `GET /api/sources` (the old category) released after a PATCH | the UI keeps the new value |
| FJ | YouTube Add with `@handle`, Name empty | Test and Add are enabled; Add after a mocked Test posts `resolved_url` |
| FK | built-in fixture | Name and Address are read-only; no Headers section. Reddit fixture: no Headers |
| FL | rename a feed that is in the active filter and in a saved preset | the filter chip and the preset's `activeSources` use the new name |
| FM | phone tab on "News"; recategorise its last feed so the "News" column disappears | the tab bar still renders and the selected tab is a neighbouring column |
| FN | wait 65 s of fake time | no "refreshed" toast |

**The guard test** (test_frontend_feed_editor_rules.py, `@pytest.mark.no_db`):
- the quoted names in `KNOWN_BUILT_INS` equal `set(registered_plugin_names())`;
- every entry of `_HEADER_DENYLIST_ALL` appears quoted inside the `HEADER_DENYLIST` literal in frontend/src/lib/headers.ts;
- `CATEGORY_MAX = 40` equals `_CATEGORY_MAX`; `HEADERS_MAX = 20` and `HEADER_VALUE_MAX = 512` match;
- `RESERVED_CATEGORIES` contains 'saved' and 'for you';
- `<datalist` and `custom headers (JSON)` are absent from FeedManager.tsx.

**PR 5. The rest of the sweep, AI autosave, the strict guard, and deleting the `!important` rule.**

Files: App.tsx, Card.tsx, Column.tsx, Settings.tsx, Drawer.tsx, LoginPage.tsx, BriefCard.tsx, SearchResults.tsx, UserBadge.tsx, ShortcutsSheet.tsx, Toast.tsx, lib/preferences.tsx, lib/storage.ts, styles.css, api.ts, eslint.config.js (scope all of src), smoke.cjs (`--strict`, C10, popover and login states), build.yml (`--strict`, WebKit enforced).

It closes every remaining item in the audit checklist marked PR 5, including the card source-name button:
- In Card.tsx:961, the source `<span>` becomes `<button type="button" data-card-interactive onTouchStart={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSourceTapRef.current?.(sourceId) }} className="min-w-0 truncate -my-3 py-3 text-left">`.
- App passes a stable `onSourceTap` through a ref, because the Card and Column memo comparators ignore callbacks (Card.tsx:1460-1475, Column.tsx:881-909). Its behaviour is `openSettings('feeds', id)`.
- Keep `memo(ColumnInner` and the `useCallback` handlers (test_slice21).

**PR 6. Landscape keeps the phone layout, plus side safe areas.**

Files: frontend/tailwind.config.js, App.tsx, BriefCard.tsx, FramingWatch.tsx, Settings.tsx, Drawer.tsx, smoke.cjs (landscape state).

Changes:
- `theme.screens = { sm: '640px', md: { raw: '(min-width: 768px) and (min-height: 560px), (min-width: 1024px)' }, lg: '1024px', xl: '1280px', '2xl': '1536px' }`. No `max-*` variants are used in src; grep to confirm.
- The header's `sm:` switches (App.tsx:2231, 2290, 2342) become `md:`.
- BriefCard.tsx:372's `matchMedia` uses the same query, as `PHONE_QUERY` in lib/visualViewport.ts.
- The header, the phone `<main>`, the tab strip, the Drawer and the Settings sheet use `pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`. The main's `p-3` becomes the max form with 0.75rem.
- Fix the stale sheetUp comment (tailwind.config.js:94-96).

### Backend changes and tests to add (all PR 1)

backend/tests/test_source_editor_contract.py, route-level via `app_client` (conftest.py:198):
- **Headers:**
  - POST and PATCH reject header names "Bad Header", "" and "Cookie"; accept "X-Ok";
  - `{"X-A":"1","x-a":"2"}` gives 422;
  - a value with `\r\n` gives 422;
  - 21 headers give 422; a 513-character value gives 422;
  - `null` and `{}` both clear.
- **Category:**
  - `" Tech "` is stored as `"Tech"` (case kept);
  - empty and 41 characters give 422; "For You" gives 422.
- **Names:**
  - PATCH name or url on each of the 7 registry names (including `rfd_hot_deals`) gives 400; create the rows the way test_builtin_source_deletion.py does;
  - a name collision gives 409; a name failing the regex gives 422.
- **Refresh:** 30 is clamped to 60.
- **Reddit Test:** with `app.reddit_client.fetch_subreddit` monkeypatched to `[{"title": "x"}]`, `ok` and `item_count 1`; with `[]`, `ok False` and `error_kind 'not_found'`.
- **Test endpoint category:** category "Saved" gives `error_kind 'invalid_category'`.
- **Scheduler,** with `monkeypatch.setattr(scheduler, "_scheduler", Fake())`. `Fake` records `add_job`, `remove_job` and `get_job`; `get_job` returns None.
  - a category-only PATCH records no `add_job`;
  - a headers PATCH records one;
  - a headers PATCH on a paused row records no `add_job` and calls `remove_job`;
  - a url PATCH on an active row with `error_count=4` leaves `error_count == 0`;
  - the same on a paused row leaves 4.
- **YouTube:** the tests in §3.

### Non-goals

- A push-navigation sheet, Drawer deletion, NavStack, swipe-down to close, pull-to-refresh, or regrouping Settings into fewer tabs. They are larger regression surfaces, and the owner's complaints are met without them.
- The YouTube Data API key. It would need config.py, a secret and a new outbound host. Open decision 1.
- iOS Larger Text and Dynamic Type for web text (`-apple-system-body`, rem tokens). In a home-screen web app iOS does not scale px text; the 320 run covers Page Zoom.
- Bulk renaming or merging categories, and cleaning existing case or space duplicates. Open decision 2.
- Encrypting or masking header values; they stay plain text, with a warning.
- A service worker or offline mode, a router, Vitest or Jest, a frontend dependency, or package.json changes.
- Two-device edit conflicts. Last write wins per field; there is no version column (models.py:40-99).
- Deleting `api.deletePreference` (api.ts:818-826) and the legacy Card `onHide` path.
- An OIDC sign-in flow from the home screen (LoginPage.tsx:52). Low impact; local sign-in works.

### Risks

See the risks list. The main ones:
- the source-text guard tests;
- iOS select `change` timing;
- WebKit on Linux differing from iOS Safari;
- YouTube still blocking the VPS;
- abort semantics, where a timed-out PATCH may still apply on the server;
- the size of PR 4 and PR 5.

## 13. How to verify

**Frontend, every PR, in the container:**
```bash
cd /home/user/popping/frontend && npm ci          # never run `npx playwright install` here (CDN blocked)
npm run lint            # 0 errors; warnings at most the 6 of the baseline
npm run build           # check-html-comments + tsc --strict + vite
node --experimental-strip-types --test scripts/unit/   # from PR 4
S=/tmp/claude-0/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/scratchpad/smoke; mkdir -p $S
./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort > $S/preview.log 2>&1 &
P=$!; until curl -sf -o /dev/null http://127.0.0.1:4173/; do sleep 0.5; done
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --out $S; echo exit=$?
kill $P
```

- Look at every PNG in `$S` at 390 and 320. The rules catch overflow; your eyes catch "this looks wrong".
- Global Playwright 1.56.1 resolves through `NODE_PATH`, so the scripts stay `.cjs`.
- WebKit cannot be downloaded here. It runs only in CI.
- Guard self-test, once in PR 2 and recorded in the PR body: add `w-[500px]` to the h1. smoke exits 1 on C2 and C3. Revert it and smoke passes.

**Backend, locally** (optional; CI is the authority). Verified here: 623 passed in 24.7 s.
1. `apt-get install -y postgresql-16-pgvector`, or build pgvector v0.8.7 from source.
2. As postgres: `initdb -D /var/lib/postgresql/popping-test --auth=trust` and `pg_ctl … start`.
3. Create user and database `popping_test`, then `CREATE EXTENSION vector`.
4. Add /etc/hosts entries for example.com, example.org, example.net and reddit.com. The SSRF guard resolves names (url_safety.py:150) and the container has no DNS. The new YouTube tests do not need them: getaddrinfo is patched.
5. `uv venv --python 3.12` and `uv pip install --no-deps -r backend/requirements-dev.lock`.
6. `cd backend && PYTHONPATH=$PWD python -m pytest -m no_db -q`, then `python -m pytest -ra -q`.

**CI:** the four check runs (`backend tests`, `frontend lint + build` with the smoke steps, `backend image`, `frontend image`) via `gh api repos/adamjmachill/popping/commits/<sha>/check-runs --jq '.check_runs[]|"\(.name) \(.status) \(.conclusion)"'`.

**On-phone checks after each popping-update** (owner, 2 minutes; Chromium cannot show these):
- **After PR 1:** add a YouTube channel by @handle. If it fails, the message says what to paste, and pasting the channel ID works.
- **After PR 2:** open search at 320-like widths (or Page Zoom 125%): nothing runs off. Tap the Auto feed box: no zoom.
- **After PR 3:** ≡ → Settings, then Done, then the back gesture: Settings stays closed. ≡ → › opens that feed.
- **After PR 4:**
  - change a category with the wheel: watch for a single "Saved ✓" (this checks iOS `change` timing);
  - focus the address field: Done and the field stay visible above the keyboard;
  - switch apps mid-edit, then come back: the edit saved;
  - "Use a browser identity" on a blocked feed.
- **After PR 5:** focus every field type (search, login, AI key, editor fields): no zoom. Save this view with the inline field.
- **After PR 6:** rotate to landscape: the phone layout, with nothing under the notch.

## 14. How to start the session

Open a new Claude Code session on this repository with the model and effort from section 1, and paste:

```
Implement REDESIGN_PLAN.md from the claude/redesign-plan branch, sections 2 to 14. Work PR by PR in the order of section 12, one draft PR each, each branched from up-to-date main (CI only runs on PRs into main). Before every push run the section 13 recipe and look at the screenshots; run the section 2 path check and the security-review skill; never touch a file outside section 2's allowed list — if a change needs one, stop and ask me. Re-check every file:line against the current code before editing. In FeedManager.tsx use only string-literal placeholders and keep every literal the backend guard tests pin; run `pytest -m no_db` before pushing. Every string the app shows uses plain words, no developer terms, no exclamation points. Before merging, send me the 390-wide screenshots of the changed screens and wait for my go. When a PR is merged, tell me in three lines what to check on the phone after popping-update.
```

If there is quota for only one PR, start with PR 2. It is visible immediately and installs the guard that keeps overflow from coming back. PR 1 is independent and can run next or in parallel.

**Open decisions** (each would lead to materially different work; the default is in brackets):
1. **YouTube API key [no].** Add it only if, after PR 1 is live, @handle lookups still fail from the VPS and pasting the channel ID is not acceptable. It would touch config.py and .env.example, add a secret, and add www.googleapis.com as an outbound host, with the key sent as an `X-Goog-Api-Key` header, never in the URL (main.py:71 logs at INFO and httpx logs request URLs).
2. **Merging categories that differ only in case or spaces [no].** PR 4 shows them as "News (news)". A "Rename category for all its feeds" action would be a new Settings feature, with a bulk PATCH loop and its own error handling.

### Steps

- **PR1 Backend: YouTube that adds, header rules, category strip, reddit Test, scheduler fixes, tests** (depends on: none)
  - Files: backend/app/youtube.py, backend/app/routes/sources.py, backend/app/scheduler.py, backend/app/schemas.py, backend/tests/test_youtube.py, backend/tests/test_source_editor_contract.py, README.md
  - Change: youtube.py: add normalize_youtube_input(allow_bare_handle), offline resolution for every link that carries the id (channel, feed links, playlist, bare UC id, scheme-less), a browser-like page lookup (Safari UA, Accept-Language, SOCS/CONSENT cookies in a jar scoped to .youtube.com, never a Cookie header), _TRANSPORT test seam, a 3 MB body cap, seven ordered markers (browseId excluded), blocked and not-found detection, plain error messages with no exception text, a /user/NAME fallback when blocked, and one sanitized INFO log line per lookup. Keep the literal event_hooks={"request": [ssrf_event_hook]} and the entry and final-URL check_url_safe calls. sources.py: pass allow_bare_handle on POST, PATCH and test; add an /auto YouTube branch (normalize, validate category, resolve, name <handle>_yt via _free_source_name, add_source type youtube_channel, kind youtube_channel, no discovery task); fix the reddit Test import (reddit_client.fetch_subreddit + normalize_subreddit, empty list gives not_found); validate category in /test (invalid_category); _validate_category returns the stripped value, stored by POST, /auto and PATCH; header names must match the RFC 7230 token pattern, and case-insensitive duplicates are rejected. scheduler.update_source: remove or skip the job when not row.active; return early on a category-only change; reset error_count when an active row's url, headers, sitemap or link_pattern change. schemas.py: docstrings only (youtube_channel kind, invalid_category).
  - Acceptance: Every YouTube test in §3 passes with the autouse failing transport (no network) and the real ssrf_event_hook/check_url_safe in the path. Rows 1-6 and 12 of the link table make zero HTTP calls. The consent cookie is present on a redirected www hop. Redirects to 127.0.0.1 and evil.internal are refused before the handler sees them. No YouTube error message contains 'http' or exception text. Every case in test_source_editor_contract.py passes, including the 7 built-in names, null and {} clearing, the case-preserving strip, invalid_category, the reddit Test path and the four fake-scheduler cases. Existing tests (test_reserved_category_names, test_source_patch_unset_regression, test_feed_autodiscovery, test_apple_podcasts, slice15, sitemap guards) pass unchanged. git diff --name-only shows only the listed files. The security-review skill reports no new outbound host and no SSRF regression.
  - Verification: cd /home/user/popping/backend && PYTHONPATH=$PWD python -m pytest tests/test_youtube.py tests/test_source_editor_contract.py -ra -q && PYTHONPATH=$PWD python -m pytest -m no_db -q && PYTHONPATH=$PWD python -m pytest -ra -q (local Postgres recipe in §13); grep -n 'event_hooks={"request": \[ssrf_event_hook\]}' app/youtube.py; the §2 path check; security-review skill; gh api repos/adamjmachill/popping/commits/<sha>/check-runs shows four successes.
- **PR2 Overflow root causes, layout guard, ESLint mobile bans, CI smoke** (depends on: none)
  - Files: frontend/scripts/iphone-audit/smoke.cjs, frontend/scripts/iphone-audit/run.sh, frontend/scripts/iphone-audit/capture.cjs, frontend/scripts/iphone-audit/fixtures.cjs, frontend/scripts/iphone-audit/README.md, frontend/src/styles.css, frontend/src/lib/visualViewport.ts, frontend/src/App.tsx, frontend/src/components/Card.tsx, frontend/src/components/BriefCard.tsx, frontend/src/components/FramingWatch.tsx, frontend/src/components/SourceIcon.tsx, frontend/src/components/Settings.tsx, frontend/src/components/Drawer.tsx, frontend/src/components/FeedManager.tsx, frontend/src/components/Column.tsx, frontend/src/components/Toast.tsx, frontend/eslint.config.js, .github/workflows/build.yml
  - Change: Write smoke.cjs with rules C1-C9 (page width on body and #root; viewport escape skipping only data-hscroll strips; vertical scrollers scrollWidth <= clientWidth; clipped text ranges; field font and tap targets as warnings; runtime, unmocked and dialog errors; production CSP on preview), with a fresh context per state at 390 and 320 and a fixed clock. Anchor the capture.cjs mock on the pathname; add long-text fixtures; fix run.sh to start the vite binary with --strictPort. Apply the §4 PR 2 fixes: search row flex-1 min-w-0 with title and refresh hidden while searching and type=text inputMode=search; card meta min-w-0 and shrink-0; wrapping inline actions at 44px; container-query thumbnail (card-body/card-title-row/card-thumb in styles.css); 11px floor; Settings header title-left Done-right 44px; Feeds gutter px-4; overscroll-contain on the four scrollers and html/body overscroll-behavior-y none; Drawer header the same; TabButton min-w-0 44px; Auto feed input min-w-0 with URL keyboard; status chips to the caption line; Toast 3 lines, 3 s / 5 s, z-[60] and keyboard offset via useVisualViewport; BriefCard header flex-wrap; z-15 becomes z-10; data-hscroll on the horizontal strips. Add the ESLint mobile block for the files cleaned here. Add the CI step (npm install --no-save playwright@1.56.1, install chromium and webkit, preview, smoke --csp; webkit run not blocking yet).
  - Acceptance: Before the fixes, smoke exits 1 with C2 at 320 search and C3/C4 on the Auto-add row (record the output). After the fixes it exits 0 at 390 and 320; C6 and C7 print warnings only. Self-test: adding w-[500px] to the h1 makes it exit 1 on C2/C3; reverted, it passes (recorded in the PR body). At 320 with search open, body.scrollWidth is 320 (was 336). The Settings body scrollWidth on the Add tab is at most 320 (was 369). The h1 is not truncated at 320 on the dashboard. The headline at 320 uses at least 60% of the card width, or sits above a full-width thumbnail. npm run lint shows 0 errors with the new rules in scope and no more than 6 warnings. npm run build passes. pytest -m no_db passes. CI's new step is green.
  - Verification: cd /home/user/popping/frontend && npm run lint && npm run build; start vite preview with --strictPort as in §13; PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp --out <scratchpad>/smoke; read every PNG; cd ../backend && PYTHONPATH=$PWD python -m pytest -m no_db -q; the §2 path check; CI check-runs.
- **PR3 One Menu button, Settings history fix, feed focus links, Drawer fixes** (depends on: PR2)
  - Files: frontend/src/App.tsx, frontend/src/components/Drawer.tsx, frontend/src/components/Hamburger.tsx, frontend/src/components/Settings.tsx, frontend/src/components/FeedManager.tsx, frontend/scripts/iphone-audit/capture.cjs, frontend/scripts/iphone-audit/probe.cjs, frontend/scripts/iphone-audit/smoke.cjs, frontend/eslint.config.js
  - Change: Delete the gear (App.tsx:2296-2331) and its comments. Make 'Settings' the first Menu row (it replaces All settings…). Add the Sign out row (onSignOut), the 44px › edit button per source row (onEditSource → openSettings('feeds', id)), categoryLabel and sourceLabel in the Menu, Clear at 44px, the grabber safe-area fix, inert and aria-hidden on the closed aside, and motion-safe transitions. Delete the dead onResetLocalState prop. jumpToCategory also calls setMobileCol and scrolls el.firstElementChild. Add the settingsSourceId state, the source param in sync(), and openSettings(tab, sourceId) with pushState({popping:'settings'}). closeSettings uses history.back() when that state is present, else replaceState. Settings tabs call replaceState(window.history.state) and drop source. Export SETTINGS_TABS and use it in App. Settings panel motion-safe:animate-sheet-up. FeedManager gets a single openRowId, focusSourceId with scrollIntoView, li ids, and drops the source param on collapse. Update the audit selectors and add the Menu states.
  - Acceptance: At 390 and 320 the header has exactly title, search, refresh (phone) and Menu; no [aria-label="open settings"] exists in the DOM; grep -rn 'data-settings-gear\|onResetLocalState' frontend/src is empty. Menu → Settings opens Feeds. Menu → › opens that feed's row expanded and in view. In Playwright, open via the Menu, Done, then page.goBack() leaves Settings closed, and history.length grows by at most 1 per open/close cycle. A deep link ?view=settings&tab=history then Done leaves a clean URL. Jump to column switches the phone tab. Sign out shows only with a mocked user. With the Menu closed, Tab never focuses Menu content. Smoke is green, including the new states. Lint has 0 errors; the build passes; pytest -m no_db passes.
  - Verification: npm run lint && npm run build; smoke.cjs against preview with --csp; a scratch Playwright check in the scratchpad for the history cases (or add them to smoke.cjs as flows); grep checks above; pytest -m no_db; the path check; CI check-runs.
- **PR4 Feed editor that saves on its own, category picker, headers editor, Add form and YouTube frontend** (depends on: PR1, PR3)
  - Files: frontend/src/components/FeedManager.tsx, frontend/src/components/feeds/FeedEditor.tsx, frontend/src/components/feeds/CategoryPicker.tsx, frontend/src/components/feeds/HeadersEditor.tsx, frontend/src/components/feeds/SaveStatus.tsx, frontend/src/lib/sourceSaves.ts, frontend/src/lib/categories.ts, frontend/src/lib/headers.ts, frontend/src/lib/apiErrors.ts, frontend/src/lib/storage.ts, frontend/src/components/Settings.tsx, frontend/src/App.tsx, frontend/src/api.ts, frontend/scripts/unit/sourceSaves.test.ts, frontend/scripts/unit/categories.test.ts, frontend/scripts/unit/headers.test.ts, frontend/scripts/iphone-audit/smoke.cjs, frontend/scripts/iphone-audit/flows.cjs, frontend/scripts/iphone-audit/fixtures.cjs, frontend/eslint.config.js, .github/workflows/build.yml, backend/tests/test_frontend_feed_editor_rules.py
  - Change: Build lib/sourceSaves.ts as specified in §6: no imports; per-source queue with one PATCH in flight; same-field coalescing; equality skip; 8 s slow and 35 s abort; one network retry after 2 s; module store with subscribe; onFailedAway; whenIdle; dropSource; keepalive while the page hides. Add lib/categories.ts (store as typed, case-insensitive reuse, reserved names, 40 characters), lib/headers.ts (deny list, token, duplicates, 512, 20, ASCII after smart-punctuation normalization, rowsToMap null, sameHeaders), lib/apiErrors.ts (moved parseApiError/friendlyTestError, errorMessage, fieldSaveMessage). FeedEditor, CategoryPicker (native select, groups, New category… committing only on Return or Add), HeadersEditor (rows, presets, plain-text warning, group focus-out commit) and SaveStatus as new components. Slim SourceRow and delete the old form, JSON parser, saveEdit, re-seed effect, links and 4 s timer; add rfd_hot_deals to KNOWN_BUILT_INS. Add form: normalizeFeedInput, optional name with suggestName, rendered errors, inline Add errors, resolvedUrl reuse, CategoryPicker, Advanced headers, YouTube copy, noValidate; AutoFeedBlock classifies the paste and has an onPrefill prop. App: configureSourceSaves, applyServerSource (keeps net_vote_score), insertSource, removeSource, the poll overlay by timestamp, refresh({silent}), the follow-up check after url/headers saves, onFailedAway toast with Open, preset remap on rename, phone tab by column name with a one-time migration. Settings: reportError to toast, keyboard-aware panel (top and bottom), blur and flush on close, visibility/pagehide flush. api.ts: updateSource opts (keepalive, signal) and sitemap/link_pattern, deleteSource throws ApiError, autoAddSource kind youtube_channel, error_kind invalid_category. Add flows FA-FN, unit tests, the no_db guard test, and the CI unit-test line.
  - Acceptance: Flows FA-FN all pass at 390 against the mocked API, with the exact PATCH counts in §12. Unit tests pass under node --test. The no_db guard test passes. Smoke is green at 390 and 320 with the editor open, in new-category mode with 45 characters, with two header rows (one invalid), and on the built-in and auto-disabled editors. pytest -m no_db passes with test_frontend_slice15_add_generic_scrape.py and test_source_create_sitemap_link_pattern.py unchanged; the first placeholder={ in FeedManager.tsx is still the fm-url ternary. grep -n 'datalist\|JSON.parse\|custom headers (JSON)' frontend/src/components/FeedManager.tsx frontend/src/components/feeds is empty. Lint has 0 errors with components/feeds and lib in scope. The build passes.
  - Verification: npm run lint && npm run build && node --experimental-strip-types --test scripts/unit/; smoke.cjs --csp against preview (runs flows.cjs); read the PNGs; cd backend && PYTHONPATH=$PWD python -m pytest -m no_db -q; the path check; CI check-runs; send the editor screenshots to the owner for go/no-go.
- **PR5 Remaining iPhone and ease-of-use sweep, AI autosave, strict guard, delete the !important rule, one-tap edit from cards** (depends on: PR4)
  - Files: frontend/src/App.tsx, frontend/src/components/Card.tsx, frontend/src/components/Column.tsx, frontend/src/components/Settings.tsx, frontend/src/components/Drawer.tsx, frontend/src/components/LoginPage.tsx, frontend/src/components/BriefCard.tsx, frontend/src/components/SearchResults.tsx, frontend/src/components/UserBadge.tsx, frontend/src/components/ShortcutsSheet.tsx, frontend/src/components/Toast.tsx, frontend/src/lib/preferences.tsx, frontend/src/lib/storage.ts, frontend/src/styles.css, frontend/src/api.ts, frontend/eslint.config.js, frontend/scripts/iphone-audit/smoke.cjs, .github/workflows/build.yml
  - Change: Every audit checklist item marked PR 5. In particular: all remaining controls at min-h-[44px] text-ios-body with select-ios; delete the coarse-pointer !important rule and add the non-important 17px base rule; the AI tab autosaves (provider/model selects with Other…, keys on blur, remove-key inline confirm, no save button and no Edit/Cancel); brief tone in localStorage; inline Save this view and preset rename; inline Reset confirm; Undo toasts for Clear all and Hide all downvoted; Column header static on touch with Mark all as read in the ⋯ popover; popover closes on pointerdown; +N chip becomes a badge; card swipe without transition while dragging; long-press copy only on hover devices; plain-language copy and errorMessage everywhere; preference failure toast with one retry; card source-name button opening the editor through a stable ref; remove the inline minHeight 100dvh; ESLint scope src/**; smoke --strict with C10 and the popover and login states; the WebKit run becomes blocking.
  - Acceptance: smoke.cjs --strict is green at 390 and 320 in Chromium locally and in Chromium and WebKit in CI: every visible control is at least 16px with no coarse-pointer rule present (grep -n 'pointer: coarse' frontend/src/styles.css is empty), every scoped target is at least 44px, no Save button inside Settings, no native dialog event. grep -rn 'window\.\(prompt\|confirm\|alert\)' frontend/src is empty. Lint has 0 errors with src/** in scope (disables only at SourceIcon.tsx:68 and the desktop context menu, each with a reason). AI provider and model changes persist across a reload without a button; brief tone persists across a reload. Clear all shows Undo, which restores. Tapping a card's source name opens that feed's editor. The PR body lists every checklist item with file:line, or strikes it with a reason. test_slice19, test_slice21 and test_slice30 still pass.
  - Verification: npm run lint && npm run build && node --experimental-strip-types --test scripts/unit/; smoke.cjs --csp --strict against preview; read the PNGs; pytest -m no_db; the path check; CI check-runs including the WebKit step; owner go/no-go with screenshots.
- **PR6 Landscape keeps the phone layout; side safe areas** (depends on: PR5)
  - Files: frontend/tailwind.config.js, frontend/src/App.tsx, frontend/src/components/BriefCard.tsx, frontend/src/components/FramingWatch.tsx, frontend/src/components/Settings.tsx, frontend/src/components/Drawer.tsx, frontend/src/lib/visualViewport.ts, frontend/scripts/iphone-audit/smoke.cjs
  - Change: Override theme.screens.md with the raw query '(min-width: 768px) and (min-height: 560px), (min-width: 1024px)', keeping sm, lg, xl and 2xl at their defaults. Swap the header's sm: switches to md:. Export PHONE_QUERY and use it in BriefCard's matchMedia. Add max(1rem, env(safe-area-inset-left/right)) padding to the header, the phone main, the tab strip, the Drawer and the Settings sheet. Fix the stale sheetUp comment. Add the 844x390 landscape smoke state, asserting the phone tab bar is visible and the desktop grid is hidden.
  - Acceptance: The landscape state at 844x390 shows main.md\:hidden and hides the desktop grid; smoke --strict is green, including landscape. Screenshots at 1024x768 and 1440x900 show the desktop layout unchanged. grep -rn 'max-sm:\|max-md:' frontend/src is empty. Lint and the build pass.
  - Verification: npm run lint && npm run build; smoke.cjs --csp --strict; a desktop screenshot script at 1024 and 1440 in the scratchpad; the path check; CI check-runs; on the phone after update: rotate, check the notch side.

### Audit checklist

- [iphone][high] frontend/src/components/Settings.tsx:265: Feeds tab wrapper has no side gutter (pt-4 vs pt-4 px-4 elsewhere); pills, rows and inputs touch the screen edges. Fix: pt-4 px-4 (PR 2).
- [iphone][high] frontend/src/App.tsx:2231: With search open, the w-44 pill beside three 44px buttons makes body 336px wide at 320 and truncates the title to 'P…'. Fix: Hide the h1 and refresh while searching below sm; the pill becomes flex-1 min-w-0; clear ✕ w-11 h-11 (PR 2).
- [iphone][high] frontend/src/components/FeedManager.tsx:1245: Auto-feed input is flex-1 without min-w-0: Auto-add sits at right 369 and the Settings body scrollWidth is 369 at 320. type=text gives no URL keyboard and autocapitalises. Fix: flex-1 min-w-0 min-h-[44px] text-ios-body, type=url inputMode=url autoCapitalize=none autoCorrect=off spellCheck=false enterKeyHint=go; button shrink-0 44px (PR 2).
- [iphone][high] frontend/src/components/Card.tsx:1734: w-28 thumbnail beside the headline turns the title into a 10-17 line ribbon on 250-330px cards. Fix: Container-query rule: 72px square under 380px of card width, full-width 16:9 on its own row under 300px; title row items-start (PR 2).
- [iphone][high] frontend/src/components/Card.tsx:957: Meta row lets source name and time both shrink, so '12m / ago' wraps with a stray dot. Fix: Source min-w-0 truncate; dot and time shrink-0 whitespace-nowrap (PR 2).
- [iphone][high] frontend/src/components/Card.tsx:976: Inline text actions (Discussed on Reddit, Summarize, Listen, Related) are in a no-wrap row, wrap mid-phrase, and are about 18px tall. Fix: Row flex-wrap gap-x-4 gap-y-1; each action inline-flex whitespace-nowrap min-h-[44px] -my-2; keep data-card-interactive (PR 2).
- [iphone][high] frontend/src/components/FeedManager.tsx:695: Feed row name clipped by five shrink-0 chips on the name line. Fix: Move the status chips to the caption line (PR 2); FeedEditor shows last_error inline (PR 4).
- [iphone][high] frontend/src/components/FeedManager.tsx:264: Sub-tab pills wrap 'My feeds (14)' at 320 and are 36px tall. Fix: flex-1 min-w-0 min-h-[44px] px-2 whitespace-nowrap truncate text-ios-caption; labels My feeds (N) / Suggested / Add a feed (PR 2).
- [iphone][high] frontend/src/components/Settings.tsx:211: Header: 'Settings → X' wraps at 320 and squeezes a 32px Done on the leading edge. Fix: Title first min-w-0 flex-1 truncate, always 'Settings'; Done trailing min-h-[44px] min-w-[44px] (PR 2).
- [iphone][high] frontend/src/components/Drawer.tsx:318: Menu Done is 32px on the leading edge. Fix: Title 'Menu' left, Done right at 44px, keep aria-label 'close menu' (PR 2).
- [iphone][high] frontend/src/styles.css:24: A !important 16px override under pointer:coarse hides 13px-authored controls (interval select, headers textarea) and mismatches line heights. Fix: Author every control at text-ios-body 44px (PR 4 and PR 5), then delete the rule and add a non-important 17px base default; C6 measures with the rule removed (PR 5).
- [iphone][high] frontend/src/components/Card.tsx:1174: 9px tone chip and 11px labels below the readable floor (also App.tsx:2709 10px badge, FramingWatch.tsx:81/111). Fix: 11px floor for decorative badges, 13px (text-ios-caption) for text people read; lint ban below 11 (PR 2).
- [iphone][high] frontend/src/App.tsx:2235: type=search draws the native cancel button next to the app's own clear button. Fix: type=text inputMode=search enterKeyHint=search autoCapitalize=none autoCorrect=off (PR 2).
- [iphone][high] frontend/src/components/Toast.tsx:122: Toast message is truncated to one line; error toasts lose their reason; z-50 relies on DOM order; it sits under the keyboard. Fix: line-clamp-3 break-words; z-[60]; bottom offset follows visualViewport (PR 2).
- [iphone][medium] frontend/src/components/BriefCard.tsx:562: First-run expanded header does not wrap; Generate can be clipped on a phone. Fix: flex-wrap like :673; Generate w-full sm:w-auto (PR 2).
- [iphone][medium] frontend/src/components/Settings.tsx:263: No overscroll containment on the Settings body (also Drawer.tsx:334, Column.tsx:489, App.tsx:2720); scroll chains to the page behind. Fix: overscroll-contain on each; html,body overscroll-behavior-y none (PR 2).
- [iphone][high] frontend/src/App.tsx:2401: z-15 is not a Tailwind class, so the error banner has no z-index. Fix: z-10 (PR 2).
- [iphone][medium] frontend/src/components/Settings.tsx:204: Sheet ignores the iOS keyboard: Done pans off the top and lower fields stay under the keyboard. Fix: useVisualViewport sets top and bottom while the keyboard is open; scrollIntoView nearest on resize (PR 4).
- [iphone][high] frontend/src/App.tsx:442: closeSettings pushes a new entry, so Back reopens Settings; Settings.tsx:241 replaceState(null) would wipe any opened-by-us flag. Fix: pushState({popping:'settings'}) on open; history.back() on close when that state is present, else replaceState; tabs keep window.history.state (PR 3).
- [iphone][high] frontend/src/components/Drawer.tsx:262: The closed Drawer stays mounted off-screen and focusable. Fix: inert and aria-hidden on the aside while closed via a ref effect (PR 3).
- [iphone][medium] frontend/src/components/Drawer.tsx:303: Grabber at top-3 ignores the safe-area inset and sits under the status bar. Fix: top-[calc(env(safe-area-inset-top)+0.75rem)] (PR 3).
- [iphone][high] frontend/src/App.tsx:2022: Jump to column never sets mobileCol (no-op on phone) and scrolls a display:contents ref (no-op on desktop). Fix: setMobileCol(idx); scroll el.firstElementChild (PR 3).
- [iphone][high] frontend/src/App.tsx:2364: Sign out exists only in the hidden sm:flex desktop sub-row. Fix: Sign out row in the Menu when user is set (PR 3).
- [iphone][high] frontend/src/components/FeedManager.tsx:605: Category uses a datalist that iOS Safari does not show, and autocapitalises. Fix: CategoryPicker native select with your categories, suggestions and New category… (PR 4).
- [iphone][high] frontend/src/components/LoginPage.tsx:72: Username autocapitalises ('Adam'), so local sign-in fails. Fix: autoCapitalize=none autoCorrect=off spellCheck=false enterKeyHint=go (PR 5).
- [iphone][medium] frontend/src/components/Settings.tsx:776: Native selects (also :812, :855, Column.tsx:418, :462) have no chevron on iOS, are 36px, and use no text size class. Fix: min-h-[44px] text-ios-body select-ios (PR 5).
- [iphone][high] frontend/src/components/Card.tsx:513: Swipe sets transition '' during the drag, so the class's 200ms transition makes the card trail the finger. Fix: el.style.transition = animate ? 'transform 180ms ease-out' : 'none' (PR 5).
- [iphone][medium] frontend/src/components/Card.tsx:585: 500ms long-press copies the URL silently and fights the native link callout on the headline. Fix: Arm the timer only when matchMedia('(hover: hover)') matches (PR 5).
- [iphone][medium] frontend/src/components/Column.tsx:244: Popover closes on document mousedown; iOS sends none for taps on empty space. Fix: Listen to pointerdown (PR 5).
- [iphone][high] frontend/src/App.tsx:2677: Mobile column tabs about 30px tall (also :2703); filter chips and clear all :2380-2393, preset chips :282-374, error ✕ :2404-2410 under 44px. Fix: min-h-[44px] buttons with an inner visual pill; data-hscroll on strips (PR 5).
- [iphone][high] frontend/src/components/Settings.tsx:1230: History group pills 28px (also :1238); text-link actions :346, :765, :831, :910, :1406, :1450 have no height. Fix: 44px segmented control and min-h-[44px] buttons (PR 5).
- [iphone][high] frontend/src/components/Column.tsx:393: Column ⋯ button is 32px; '+N new' chip py-0.5. Fix: w-11 h-11; the chip becomes a non-interactive badge (PR 5).
- [iphone][high] frontend/src/components/BriefCard.tsx:312: Tone pills min-h-[28px]. Fix: min-h-[44px] (PR 5).
- [iphone][high] frontend/src/components/ShortcutsSheet.tsx:93: Close button 32px. Fix: w-11 h-11 (PR 5).
- [iphone][medium] frontend/src/components/Card.tsx:1324: Card action icons are 40px (also :1254, :1281, :1368, :1396, :1431). Fix: Raise to 44px, keeping the data-* hooks (PR 5).
- [iphone][medium] frontend/src/App.tsx:2188: Inline minHeight 100dvh fights html/body/#root height:100%, causing a double scroll range in Safari tab mode. Fix: Remove the inline minHeight (PR 5).
- [iphone][high] frontend/src/App.tsx:2594: An iPhone in landscape (812-932px) gets the desktop grid because md is width-only (also :2655, FramingWatch.tsx:175, BriefCard.tsx:372). Fix: Raw md screen with a height condition; header sm: becomes md: (PR 6).
- [iphone][medium] frontend/src/App.tsx:2210: Only the top safe-area inset is handled; landscape notch overlaps the title and Menu (also :2655, :2668, Drawer.tsx:288, Settings.tsx:204). Fix: pl/pr max(1rem, env(safe-area-inset-left/right)) (PR 6).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:657: Edits save only through a tiny 'save' link; nothing autosaves; errors go behind the sheet. Fix: FeedEditor with field autosave, SaveStatus, inline errors (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:635: Custom headers are typed as JSON. Fix: HeadersEditor rows with browser-identity and English presets (PR 4).
- [ease-of-use][high] frontend/src/App.tsx:2305: Gear plus Menu plus 'All settings…' duplicate the same overlay. Fix: Delete the gear; Settings becomes the first Menu row (PR 3).
- [ease-of-use][high] frontend/src/App.tsx:2839: Settings and FeedManager errors go to App's banner, hidden under the z-50 sheet. Fix: reportError → toast at z-[60], plus inline errors (PR 4).
- [ease-of-use][high] frontend/src/App.tsx:1112: The 'refreshed' toast fires on every 60 s poll and every return to the app. Fix: refresh({silent}); toast only on a manual refresh (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:465: Re-seed effect keyed on the custom_headers object overwrites in-progress edits on polls. Fix: Deleted; drafts are component-owned and reseed only when not focused, dirty or saving (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:108: KNOWN_BUILT_INS lacks rfd_hot_deals, so its name and address look editable and the backend returns 400. Fix: Add it, plus a no_db guard test against registered_plugin_names() (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:379: Delete confirm cancels itself after 4 s. Fix: Inline confirm with no timer, offering Pause instead (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:740: A feed's last_error, the auto-disable reason and staleness exist only in title tooltips. Fix: 'Last problem' line in the editor with a one-tap browser identity on 401/403 (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:1372: Add form requires an invented slug; nameError and urlError are never rendered, so Add stays grey with no reason. Fix: Optional name with suggestName; render errors; normalizeFeedInput for @handle and bare ids (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:1446: Add sends the original URL instead of Test's resolvedUrl, so YouTube is fetched twice. Fix: submit uses resolvedUrl after a successful Test (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:174: The forbidden hint points at 'Advanced → Custom headers', which does not exist in the Add form. Fix: Add an Advanced headers section to the Add form and rewrite the hint (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:1110: Suggested list shows raw slugs and categories; buttons 28px (:1069-1127). Fix: sourceLabel/categoryLabel; 44px buttons (PR 4).
- [ease-of-use][high] frontend/src/components/FeedManager.tsx:825: Interval select shows the wrong value when the stored interval is not a preset (HN 5 min). Fix: Put the current value as the first option (PR 4).
- [ease-of-use][high] frontend/src/App.tsx:1358: Phone tab remembered by index; Saved/For You insertion or a category change moves the user to another column. Fix: Remember the column name (popping.v1.mobileCol.name) with a one-time migration (PR 4).
- [ease-of-use][high] frontend/src/App.tsx:1994: Rename remaps the active filter but not saved views' activeSources, which then silently filter nothing. Fix: Remap filterPresets[].activeSources via prefs.setFilterPresets (PR 4).
- [ease-of-use][high] frontend/src/api.ts:446: deleteSource throws a plain Error with no detail; api.ts:284 raw '<status> for <url>' text is shown to users. Fix: deleteSource throws ApiError (PR 4); errorMessage() at every call site (PR 5).
- [ease-of-use][high] frontend/src/components/Settings.tsx:928: AI tab needs Edit, then a lowercase 'save'; free-text model names; 'set provider in env'; 'Scoring model'. Fix: Autosaving selects with Other…, keys on blur, no Save/Edit, plain labels (PR 5).
- [ease-of-use][high] frontend/src/App.tsx:457: Brief tone is plain useState and resets on reload. Fix: Persist in localStorage popping.v1.brief.tone (PR 5).
- [ease-of-use][high] frontend/src/App.tsx:2826: window.prompt for Save this view (and rename at :306); window.confirm for reset at Settings.tsx:413. Fix: Inline name field in the Menu row and on the chip; inline two-step confirm; lint ban and smoke dialog rule (PR 5).
- [ease-of-use][high] frontend/src/App.tsx:2860: Saved 'Clear all' and 'Hide all downvoted' (:2876-2887) act at once with no Undo. Fix: Action toast with Undo restoring the previous array (PR 5).
- [ease-of-use][high] frontend/src/components/Column.tsx:314: The whole column header is a hidden mark-all-read button with only a tooltip. Fix: Header static on touch (hover:hover check); 44px 'Mark all as read' first in the ⋯ popover inside popoverRef (PR 5).
- [ease-of-use][high] frontend/src/components/Column.tsx:341: '+N new' chip refreshes and the count never changes. Fix: Non-interactive badge (PR 5).
- [ease-of-use][high] frontend/src/App.tsx:1615: Hide toast says 'Entry moved to history.' while the card is filtered out of every column. Fix: 'Hidden.' with Undo, same as :2452 (PR 5).
- [ease-of-use][high] frontend/src/components/Column.tsx:425: 'Top (composite score)' and a 0-100 Min score slider (:432-456); empty states mention 'Feed Manager' and 'the scheduler' (:824, :836; App.tsx:2495). Fix: 'Best first / Newest / Oldest'; a 'Show: All / Top half / Top stories' select; plain empty-state copy naming Settings → Feeds (PR 5).
- [ease-of-use][high] frontend/src/components/Settings.tsx:1526: Empty states tell phone users to right-click or press keys (also :1598, :1683). Fix: 'Tap the eye / star / ▼ on a card' (PR 5).
- [ease-of-use][high] frontend/src/components/Settings.tsx:1165: History row renders the literal text '◯ with strike' (also :1110). Fix: Eye-off icon from TabIcon (PR 5).
- [ease-of-use][high] frontend/src/components/Settings.tsx:1436: Hidden and Saved titles truncated to one line. Fix: line-clamp-2 break-words (PR 5).
- [ease-of-use][high] frontend/src/components/Settings.tsx:361: Notifications tab tells the user to edit .env and restart the backend. Fix: 'Push notifications: Off. Whoever runs your Popping server can turn them on.' (PR 5).
- [ease-of-use][high] frontend/src/components/UserBadge.tsx:37: Shows '(local bypass)'; the desktop health line shows a raw status (App.tsx:2344). Fix: Drop the suffix; status reads 'All good' or 'Problem' (PR 5).
- [ease-of-use][high] frontend/src/components/Card.tsx:1392: Star tooltip names shortcut (s); it is b. Fix: '(b)' (PR 5).
- [ease-of-use][medium] frontend/src/lib/preferences.tsx:527: Preference write failures are swallowed; the header comment claims they revert. Fix: One error toast per failure burst plus one retry; fix the comment at :28-30 (PR 5).
- [ease-of-use][medium] frontend/src/components/Card.tsx:961: No touch path from a card to its feed's settings. Fix: Source name becomes a data-card-interactive button opening the editor through a stable ref (PR 5).
- [ease-of-use][high] frontend/src/components/Drawer.tsx:477: Menu shows raw category and raw names in the footnote (:415) while rows use labels. Fix: categoryLabel and sourceLabel (PR 3).

### Open decisions

- YouTube Data API key (default: no). Add it only if, after PR 1 is live, @handle lookups still fail from the VPS and pasting the channel ID is not acceptable. It would touch backend/app/config.py and .env.example, need a Google Cloud key from the owner, and add www.googleapis.com as an outbound host. The key must go in an X-Goog-Api-Key header, never in the URL, because main.py:71 logs at INFO and httpx logs full request URLs.
- Merging categories that differ only in case or spaces (default: no). PR 4 makes duplicates visible as 'News (news)' and lets the user move feeds one at a time. A 'Rename this category for all its feeds' action would be a new Settings feature: a bulk PATCH loop over every feed in the category, partial-failure handling, and its own tests.

### Risks

- Source-text guard tests: test_frontend_slice15_add_generic_scrape.py and test_source_create_sitemap_link_pattern.py read FeedManager.tsx literals. The first `placeholder={` must stay the fm-url ternary, and the radio label must keep 'Track page' and 'no RSS'. Mitigation: the editor lives in new files, FeedManager.tsx uses only string-literal placeholders, and pytest -m no_db runs before every push.
- iOS select `change` timing (wheel stop versus dismiss) cannot be verified in Chromium. If it fires per stop, same-field coalescing caps it at two PATCHes, so at most two fetches. It is on the PR 4 phone checklist.
- WebKit on Linux in CI is not iOS Safari. The run is report-only until it has been green on PR 3 and PR 4, then becomes blocking in PR 5. A WebKit-only failure that cannot be reproduced locally is diagnosed from the CI log.
- Chromium on Linux lays out with a fallback font, not SF Pro, so near misses at 390 can still overflow on the phone. Mitigation: 320 is the enforced floor, roughly 18% narrower than the owner's phone.
- YouTube may still block the VPS IP even with consent cookies and a browser UA. Mitigation: plain messages that teach the channel ID, offline resolution of ids and feed links, the /user fallback, the sanitized lookup log for diagnosis, and open decision 1.
- A PATCH aborted after 35 s may still be applied on the server. The UI shows an error and offers Try again (same value, idempotent), and the next poll reconciles.
- keepalive flushes depend on iOS delivering visibilitychange or pagehide before suspension. If the app is killed with a field still focused, that one edit is lost.
- Polling overlay and save store bugs could show stale values. Flows FF, FI and FL, plus unit tests on the pure queue, pin the behaviour.
- history.back() in closeSettings is used only when history.state.popping === 'settings', so it can never leave the app. A deep link or reload without that state uses replaceState. Flow FG covers it.
- Scheduler changes (category-only skip, removing the job for paused rows, error_count reset) alter when ingests happen. Each is pinned by a fake-scheduler route test, and name, URL and header changes still rebuild by design.
- Container queries need iOS 16 or later. Older Safari keeps today's thumbnail beside the title.
- PR 4 and PR 5 are large. Split PR 5 by area (cards and columns; Settings and AI; dialogs and copy) if review gets hard. Each item is independent and revertable by image tag.
- Header values are stored and returned as plain text. The UI warns against secrets, but a user could still paste one. The backend deny list keeps Cookie and Authorization out.
- Changing the md breakpoint (PR 6) affects every layout switch. It is isolated in the last PR, with desktop screenshots at 1024 and 1440 and a one-line revert.
- Playwright installed with --no-save in CI pins 1.56.1. A future runner image change could break `--with-deps`, but nothing reaches the Docker images or dependabot.

## Judges

### Judge 1: winner Minimal-change plan (inline autosaving editor in FeedManager.tsx, hamburger as the one Menu, YouTube fix, smoke.cjs guard)

- Minimal-change plan (inline autosaving editor in FeedManager.tsx, hamburger as the one Menu, YouTube fix, smoke.cjs guard): total 40 (coverage 8, fit 9, low risk 8, effort 9, iOS feel 6). Strongest fit with the code. Checked claims: (1) the first `placeholder={` in FeedManager.tsx is :1660, the fm-url ternary that test_url_placeholder_uses_generic_scrape_specific_text reads (slice15:212-230), so the 'string-literal placeholders only' rule is a real and necessary guard. (2) Settings.tsx:241 does `replaceState(null, …)`, which would wipe a history.state flag; the fix to keep `window.history.state` is correct. (3) PATCH returns net_vote_score 0 (sources.py:393-404 fills it only in the list endpoint), so keeping the old score is needed. (4) Passing consent cookies on the client rather than as a Cookie header is correct: httpx 0.28.1 (requirements.lock:85) strips Cookie in _redirect_headers. (5) Built-ins are only inserted when missing (scheduler.py:110-134), so recategorising a built-in survives a restart. Safety posture is the tightest of the three: no scheduler.py/config.py/schemas.py change, no new secret or outbound host, no package.json or lockfile change (Playwright via `npm install --no-save` in CI), one CI step. The PRs are sized well: backend, then guard and layout, then menu and history, then editor, then sweep, with class-only overflow fixes landing before the editor rewrite. Weaknesses: (a) Landscape is deferred. Rotating the phone gives the desktop grid (md: at App.tsx:2594/2655), a 'screens not fitting' iPhone problem that complaint 6 says should not need reporting. (b) The 8-pill Settings tab strip stays and Done stays on the leading edge, so the result is less iOS-like. (c) New categories are lowercased, so 'NHL' is stored as 'nhl' and categoryLabel shows 'Nhl' ('nhl' is not in ACRONYMS, labels.ts:21-25). (d) The phone tab is still remembered by index, so a category change that removes a column puts the user on a different column; the existing clamp only prevents a crash. (e) FeedManager.tsx grows to about 1,850 lines. (f) Renames don't remap the saved presets' activeSources. (g) Rapid category changes send one PATCH each, with no coalescing, and each PATCH triggers an immediate ingest. (h) The '.hit-44' ::after utility is close to the 'duct tape' the owner rejected; it is acceptable only because the C6 guard measures it.
- iOS-first: one Menu sheet with a NavStack (Drawer and Settings container deleted), feed page, card source-label tap, pull-to-refresh: total 30 (coverage 9, fit 6, low risk 3, effort 3, iOS feel 9). Best iPhone experience and the most thorough YouTube work. Strengths: cookie jar scoped to .youtube.com; offline tests patch app.url_safety.socket.getaddrinfo so the real SSRF guard stays in the path; a test for a redirect to a private IP; a 3 MB body cap; seven ordered markers with browseId excluded; never echoing raw httpx text, which today happens at youtube.py:107-108. Its other corrections also check out: category-only rebuild skip (dynamic_rss.py:56/71 binds name and headers into the job); keep categories as typed so categoryLabel doesn't produce 'Nhl'; remap presets on rename; remember the phone tab by name in the same PR; 1-tap edit from the card source label. As a maintainer I would not take it whole. It deletes Drawer.tsx (including its focus trap, swipe-dismiss and Esc contract) and the Settings container. It adds sheetRoute, NavStack, Sheet, gestures, inert on #root, a portal Toast and pull-to-refresh, all at once in PR 3. Pull-to-refresh replaces the phone refresh icon even though it depends on WebKit negative scrollTop and cannot be tested in Chromium; if it fails, refresh goes from 1 tap to 2. It also removes desktop 'Jump to column' instead of fixing it. The optional YOUTUBE_API_KEY goes in the URL query (`&key=…`). httpx's own INFO logger records full request URLs, so 'never log the key' is not guaranteed; use the X-Goog-Api-Key header instead. It touches config.py, schemas.py, scheduler.py and .env.example and adds a new outbound host. Allowed today, but more surface than the owner's safety ask needs. It never notes the first-`placeholder={` trap, although its AddFeedPage reshuffle keeps the slice15 literals in FeedManager.tsx. Too much risk and effort for a single owner to review.
- Structural: components/ui primitives, one save model, Menu plus Settings on a shared Sheet with pushed pages, ESLint and smoke enforcement, 8 PRs: total 30 (coverage 8, fit 6, low risk 4, effort 4, iOS feel 8). The best answer to the owner's 'no duct tape' (#10): rules are carried by primitives (Row/FieldRow/TextField kind/Select/Sheet), the smoke rules are well thought out (painted-ancestor spill, label-wrap, R9 dialogs, R11 elementFromPoint visible-error, R12 no Save button), it has unit-testable pure modules (saveQueue/categories/headers via node --test), a correct category-only scheduler skip, the API key sent in an X-Goog-Api-Key header, and fake-scheduler route tests. Maintainer concerns: (1) There is a YouTube bug. _PAGE_HEADERS puts the consent cookie in a literal 'Cookie' header, and httpx 0.28.1 drops Cookie on every redirect (_redirect_headers pops it). Any youtube.com→www or @handle redirect then loses consent and lands on the consent wall, which is exactly the failure it is fixing. (2) Playwright becomes a package.json devDependency. That changes the lockfile, so frontend/Dockerfile's `npm ci` build stage installs it, and Dependabot will try to bump it. Avoidable with `--no-save`. (3) PR 5 deletes the 1809-line FeedManager.tsx and rewrites the slice15/sitemap guard tests, including dropping the trackAnyway slug-op assertions. That weakens existing pins and makes a very large diff. (4) ESLint no-restricted-syntax regexes over className strings are fragile, and inline disables become a maintenance tax. (5) Eight PRs, with SourceCreate.name and SourceAutoRequest.category made Optional (an API contract change), config.py, and scheduler.py. (6) It keeps 'browseId' as a channel marker, which the other two exclude as unsafe. (7) It lowercases new categories, so 'NHL' shows as 'Nhl'. (8) The phone tab is remembered by index until PR 7, even though PR 5 introduces the category picker that shifts it.

Graft:
- From iOS-first: store new categories as typed (trim, collapse spaces), match existing ones without case and reuse the stored spelling; don't lowercase. categoryLabel only title-cases all-lowercase strings, and 'nhl' is not in ACRONYMS (frontend/src/lib/labels.ts:21-38).
- From iOS-first: remember the phone tab by column name in PR 4 alongside the category picker (App.tsx:1358-1366, storage.ts:52). A category change that empties a column otherwise moves the user to a different tab.
- From iOS-first: on rename, also remap filterPresets[].activeSources (preferences.tsx:122-127) so saved views don't silently filter nothing.
- From iOS-first: YouTube offline-test pattern. Patch app.url_safety.socket.getaddrinfo (or resolve_addresses) instead of stubbing check_url_safe/ssrf_event_hook, so the real SSRF guard stays in the path. Add a redirect-to-private-IP test and a body cap of about 3 MB. Also normalize bare UC ids and scheme-less youtube.com pastes in backend youtube.py, not only in the Add form, so PATCH, /auto and /test accept them too.
- From iOS-first: one-tap 'Use a browser identity' on the 'Last problem' line when last_error looks like 401/403 and the feed accepts headers.
- From iOS-first: a landscape breakpoint as a final small PR (tailwind.config.js `md: {raw: '(min-width:768px) and (min-height:560px), (min-width:1024px)'}`, plus the matching sm:→md: header swaps and BriefCard matchMedia) instead of deferring indefinitely. It is build-time CSS only.
- From Structural: make the Toast layer explicit (z-[60]) instead of relying on DOM order with Toast.tsx:117 and Settings at z-50.
- From Structural: if YOUTUBE_API_KEY is ever added, send it as an X-Goog-Api-Key header, never `key=` in the URL (httpx INFO logging records full URLs).
- From Structural: smoke flows FI (Enter then blur sends exactly 1 PATCH), FF (PATCH delayed 1.5 s, then Done: sheet closes at once and the column updates after), R9 (any `dialog` event fails the run), R11 (an induced error is actually visible via elementFromPoint), R12 (no visible /^save$/i button inside the Settings dialog). Plus fixtures with a 60-character name, a 120-character URL and a 90-character unbroken token.
- From Structural: blur the active element on visibilitychange→hidden and send the PATCH with fetch `keepalive: true`. This closes the 'iOS kills the app with a field focused' gap the minimal design accepts.
- From Structural: shared lib/apiErrors.ts `errorMessage()` (TypeError→'Couldn't reach Popping', 5xx, 401, never the raw '<status> for <url>' from api.ts:284), and make api.deleteSource throw ApiError with detail (api.ts:446-452).
- From Structural and iOS-first: optional category-only rebuild skip in scheduler.update_source (scheduler.py:2455-2461), pinned with a fake _scheduler recording add_job. Name, URL and header changes must still rebuild, because dynamic_rss.py:56/71 binds them. Low risk; saves one ingest per recategorisation.
- From Structural: a fuller route-test matrix in PR 1. Refresh clamp, null and {} both clearing headers, and the built-in 400 for all 7 registry names including rfd_hot_deals.
- From Structural: coalesce queued-but-unstarted PATCHes for the same field, so several quick changes to one select (or a select that fires change on every wheel step) send only the last value.

Shared blind spots:
- No client-side request timeout. jsonFetch (frontend/src/api.ts:273-287) has no AbortController, and all three designs put saves in a per-source serial queue. One hung PATCH (flaky cellular, or a URL PATCH that runs YouTube/Apple resolution with connect 10 s + read 15 s per hop and up to 5 redirects, youtube.py:40/88) leaves 'Saving…' up indefinitely and blocks every later save for that feed. Each design needs a timeout and a 'still saving / try again' state.
- Existing bad data is never cleaned up. Only new writes get the category strip, so categories already stored with surrounding spaces or a different case ('news' vs 'News') stay separate dashboard columns. No design offers a merge or rename-category action or a one-time normalization.
- The headers editor makes it easy to store secret-bearing headers such as X-Api-Key. Values are stored in plaintext and returned in full by GET /api/sources and every PATCH response (SourceOut.custom_headers, schemas.py:44). With OIDC off, `_api_deps` is empty (main.py:290-304). No design masks values, warns against secrets, or treats this under requirement 8.
- iOS native-select `change` timing is assumed, not verified (wheel vs menu, per-step vs on dismiss). Every effective PATCH triggers an immediate ingest (scheduler.py:2455-2461), so if change fires per wheel step it could send several PATCHes and ingests. This belongs in the on-phone checks.
- After a header or address autosave, the backend ingests right away, but none of the designs show that fetch's result automatically. The user only sees whether the fix worked after the next 60 s poll or a manual Check now/Refresh now. A follow-up refresh of that one source after the PATCH-triggered ingest would close the loop.
- The YouTube fix was designed blind (youtube.com is blocked in the container). No design adds sanitized server-side logging of what the VPS actually receives (final host, status, which marker or blocked rule matched). If the post-deploy @handle check fails, there is nothing to diagnose with except owner reports.

### Judge 2: winner Minimal-change plan: autosaving feed editor inside Settings, one Menu button, YouTube fix, overflow guard in CI

- Minimal-change plan: autosaving feed editor inside Settings, one Menu button, YouTube fix, overflow guard in CI: total 38 (coverage 7, fit 8, low risk 8, effort 9, iOS feel 6). Covers 1-5 directly. Feed editor is 2 taps away (Menu > row arrow), category is 4 taps, with no typing, no Save and no JSON. Strongest on safety (req 8): no package.json, config, schemas or scheduler changes, no new outbound host, and Playwright is installed with --no-save in CI. YouTube (req 9) is covered on both backend and frontend, and the consent cookies are set on the client, which is correct: verified that httpx 0.28.1 _client.py:569 drops a Cookie header on every redirect. Several claims were verified against the code: Settings.tsx:241 replaceState(null) wipes history.state; slice15:212-230 reads the first placeholder={ in the file; the PATCH response returns net_vote_score 0. Gaps: (1) Complaint 7 is only partly covered. The AI tab keeps its explicit 'save' button and free-text model names, brief tone is not persisted, and the 8-pill Settings strip stays, all deferred. (2) New categories are lower-cased, so 'NHL' is shown as 'Nhl' (labels.ts ACRONYMS has no nhl). (3) The FIFO send queue does not merge rapid changes to the same field. (4) The guard has a hole. C3 skips everything inside overflow-x auto/hidden ancestors, but every phone surface scrolls vertically and so computes overflow-x auto or hidden. Measured at 320: the Auto-add button sits at right=369, the Settings body has scrollWidth 369 against clientWidth 320, and body/#root are 320. C2, C3 and C4 would all pass this, which contradicts the plan's own expected C3 failure. (5) The editor is still an inline row in a long list under a pill strip, so it feels like a web page more than an iOS app.
- iOS-first: one Menu sheet with push navigation, card source label opens the feed page, pull-to-refresh: total 33 (coverage 9, fit 7, low risk 3, effort 4, iOS feel 10). Easiest editing for the owner: tapping a card's source name opens the feed page (category in 3 taps, Pause in 2). The category list shows feed counts, matches existing names regardless of case, and stores new names as typed, which correctly handles categoryLabel's case behaviour. Autosave flushes on pagehide/visibilitychange with keepalive. Includes a one-tap browser identity button on 403 errors, autosaving AI selects and a persisted brief tone. The top bar becomes exactly title, search and Menu. The YouTube work is the most complete: offline shapes, 7 markers, /user fallback, a 3MB cap, and tests that patch getaddrinfo so the real SSRF guard stays in the path. Its text-cut rule (c) would incidentally catch the measured scroller overflow. Errors checked against the code: (1) PR 1 deletes the 16px !important rule. FeedManager.tsx:829 (interval select) and :642 (headers textarea) are authored at text-ios-caption 13px, and Tailwind utilities beat the proposed @layer base max(1em,16px) rule, so both zoom on focus from PR 1 until PR 4. The PR 1 guard states never open them. (2) The optional API key is sent as ?key= in the URL. main.py:71 sets basicConfig(level=INFO), and httpx logs every request URL at INFO, so the claim 'the key is never logged' is false. (3) The highest regression surface of the three: it deletes Drawer.tsx and the Settings container; adds a NavStack plus history-depth routing, inert on #root, toast portals, swipe-down and pull-to-refresh (relies on WebKit's negative scrollTop, which Chromium cannot test); removes the phone refresh icon; and moves the thumbnail above the headline. It touches config.py, schemas.py, scheduler.py and tailwind.config.js. About 20 new files, with PR 3 and PR 4 very large.
- Structural fix: shared iOS primitives, one save model, one menu, enforced mobile contract (lint + smoke + phone checklist): total 32 (coverage 9, fit 7, low risk 4, effort 4, iOS feel 8). Best answer to 'stop the class of problems recurring' (complaints 6, 7 and req 10). Core ESLint bans (raw input/select/datalist, window.prompt/confirm, text under 11px, sub-44px min-h, vh, mousedown, title=) are scoped per PR. The smoke test adds R11 (an induced error must be visible) and R12 (no Save button in Settings). There is one save model everywhere, including the AI page, and the queue merges rapid same-field changes. Correctly avoids changing preferences.py (brief tone goes in localStorage) and sends the API key as an X-Goog-Api-Key header, so it never appears in URLs or logs. It also lists every guard test it migrates. Errors checked against the code: (1) The consent cookie is sent as a Cookie header in _PAGE_HEADERS. httpx 0.28.1 _redirect_headers pops Cookie on every redirect (verified at _client.py:569), so the consent bypass is lost on youtube.com>www or any consent redirect. Its own test asserts only the first request, so it would not catch this. Also keeps browseId as a marker. (2) R5 skips descendants of overflow-x auto/scroll ancestors, so the measured Settings-body horizontal overflow (369/320) passes. (3) Adds playwright as a package.json devDependency. It reaches the Docker build stage via npm ci and invites weekly Dependabot bumps that the owner must reject. (4) Lower-cases new categories (NHL shows as Nhl). (5) Largest effort: 8 PRs, about 35 new files, FeedManager.tsx (1809 lines) deleted in one PR, Drawer and Settings re-architected, plus a unit-test runner. The 'refreshed' toast every minute survives until PR 7 and can replace post-close save-error toasts before then.

Graft:
- From Structural (D3): add its core ESLint mobile rules to frontend/eslint.config.js as errors, scoped per PR, with no new dependency. Ban <datalist>, window.prompt/confirm/alert, text-[Npx] below 11, min-h-[<44px], h-screen/vh, and addEventListener('mousedown'). This is the cheapest way to make complaints 6 and 7 non-recurring, and Minimal-change (D1) has nothing at lint level.
- Fix the guard hole: add a rule that every element whose computed overflow-y is auto/scroll (Settings body Settings.tsx:263, phone scroller App.tsx:2721, Column list Column.tsx:489, Drawer nav Drawer.tsx:334) has scrollWidth <= clientWidth + 1. Exempt only allow-listed horizontal strips (tab strip, chip bar, Settings pills). Also add iOS-first (D2) rule (c): each text range must lie inside its nearest non-visible-overflow ancestor unless it ends in an ellipsis or is line-clamped. Measured at 320: Settings body is 369/320 while body/#root are 320, and D1's C2, C3 and C4 all pass it.
- From D2: category matching. Reuse an existing category regardless of case, but store new categories as typed (trimmed, single spaces) instead of lower-casing, so 'NHL' is not shown as 'Nhl' (labels.ts title-cases lower-case strings outside ACRONYMS). Keep D1's native <select> picker.
- From D2/D3: merge rapid changes to the same field in the per-source queue (one in flight, only the newest queued value runs). If iOS fires change as the picker wheel settles, D1's plain FIFO would send one PATCH, and one immediate ingest, per value.
- From D2/D3: flush pending text edits on visibilitychange (hidden) and pagehide, using fetch keepalive on updateSource. This closes D1's accepted gap where iOS suspends the app while a field is focused.
- From D3: bring the AI tab onto the same autosave model in PR 5. Provider and model become <select>s that save on change, with an 'Other…' free-text option. API keys commit on blur. Delete the 'save' button and the Edit/Cancel toggle. Persist brief tone in localStorage (popping.v1.brief.tone, so preferences.py is untouched). This closes D1's complaint-7 gap.
- From D3: smoke rules R11 (after an induced 422 or network error, elementFromPoint at the error's centre returns the error element) and R12 (no visible button named /^save$/i inside the Settings dialog).
- From D2: in FeedEditor's 'Last problem' line, when last_error looks like a 401/403 and headers apply, show a 'Use a browser identity' button that adds the User-Agent preset and saves it.
- From D2: put the YouTube @handle / UC id / youtube link handling in AutoFeedBlock too, not only the Add form. Pasting into 'Auto feed' should route YouTube links and bare UC ids to the new /auto YouTube branch, and open the manual form pre-set for reddit and Apple Podcasts links.
- From D2: write the YouTube tests by patching app.url_safety.socket.getaddrinfo, not by stubbing check_url_safe and ssrf_event_hook. The real SSRF guard then stays in the path. Add a redirect-to-loopback test, a body-size cap test, and a test that an id-bearing shape makes zero HTTP calls.
- From D2: in the existing onSourceRenamed, also remap filterPresets[].activeSources (preferences.tsx:122-127), so a saved view does not silently filter nothing after a rename.
- From D2/D3: put Done on the trailing edge of the Settings and Drawer headers at 44px, and use a plain-language fieldSaveMessage mapping for 409/400/422 responses, for example 'Another feed already uses this name.'
- From D2 (optional, after PR 4): make the source label in Card's meta row (Card.tsx:961) a button carrying data-card-interactive that opens ?view=settings&tab=feeds&source=<id>. Pass the callback through a stable ref because Card/Column memo comparators ignore callbacks. This takes the editor from 2 taps to 1.

Shared blind spots:
- Horizontal overflow inside scroll containers. Every phone surface scrolls vertically (overflow-y auto), so its computed overflow-x is auto or hidden. All three guards exempt that container's descendants: D1's C3 skips auto/hidden/clip ancestors, D3's R5 skips auto/scroll ancestors, and D2's rule b skips 'active horizontal scrollers'. None asserts that a vertical scroller has scrollWidth <= clientWidth. Measured on the built app at 320 (Settings > Add custom): Auto-add button right edge 369, Settings body scrollWidth 369 against clientWidth 320, body and #root 320. The sheet pans sideways, yet D1 and D3 would pass it, and D2 catches it only incidentally through its text-range rule.
- All three run the smoke test only in Chromium, because WebKit cannot be downloaded in the container. GitHub runners can download it: 'npx playwright install --with-deps webkit' with Playwright's iPhone device descriptors would exercise Safari's layout engine, select rendering and -webkit- behaviours in CI. Today nothing between Chromium and the owner's phone checks Safari.
- The owner says text 'doesn't scale right', but every design keeps px type tokens (text-ios-body 17px, text-ios-caption 13px). Each treats only Safari Page Zoom, via the 320px proxy. None considers iOS Larger Text / Dynamic Type (for example font: -apple-system-body on html with rem tokens), and none tests at an enlarged root font size.
- Real-iPhone verification happens only after merging to main and deploying to production. CI builds images only on push to main, and every design's on-phone checks come after popping-update. None gives the non-developer owner a way to try a PR on the phone before it reaches main, nor a short go/no-go script to run before merging, beyond rolling back by image tag afterwards.
- None of the guards uses a metric-compatible stand-in for SF Pro. Linux Chromium lays out with a fallback system font, so truncation and wrap widths are measured with different glyph widths than iOS. A near miss at 320 can pass CI and still overflow on the phone. Only D1 mentions this, and only as a known false negative.

### Judge 3: winner Minimal-change plan: autosaving feed editor inside Settings, one Menu button, YouTube fix, overflow guard in CI

- Minimal-change plan: autosaving feed editor inside Settings, one Menu button, YouTube fix, overflow guard in CI: total 38 (coverage 7, fit 9, low risk 8, effort 9, iOS feel 5). Checked against the code. These claims are correct: Settings.tsx:241 does call replaceState(null, ...), which wipes any opened-by-us flag. The first `placeholder={` in FeedManager.tsx is at :1660, and slice15:212-230 reads exactly that one, so the string-literal-placeholder rule is needed. SourceAutoResult.kind is Optional[str] (schemas.py:142), so /auto needs no schema change. httpx 0.28.1 _redirect_headers pops the Cookie header on every redirect (_client.py:569), so putting the consent cookies on the client is the right call. This design alone has Check now and Delete wait for the save chain and use nameRef, so a pending rename cannot 404 /api/ingest/{old}. It alone reuses resolvedUrl on Add, makes background refresh silent, and routes Settings errors to toast. Gaps: (1) Req 6/7 are left partly undone. It defers the landscape breakpoint and the side safe-area insets, which are iPhone defects the owner said he should not have to report. It keeps the LLM explicit 'save' button and the free-text model names, and brief tone still resets on reload. (2) In new-category mode, blur on a non-empty value commits, so a half-typed name ('hock') becomes a column and triggers an ingest. (3) Lower-casing new categories makes 'NHL' display as 'Nhl', because labels.ts ACRONYMS has no nhl and categoryLabel title-cases lowercase strings. (4) The epoch guard is bumped only by onSourceUpdated, so a poll that started before a Delete can bring the row back. (5) There is no visibilitychange/pagehide flush and no keepalive. (6) The keyboard handling only pads the bottom of the scroller, so the sheet header and Done still pan off-screen. (7) The phone tab is index-based (App.tsx:1358-1366), so making category changes easy will move the user to a different column; this is deferred. (8) .hit-44 ::after plus keeping the !important 16px rule is closer to a backstop than the root-cause fix the owner asked for. The thumbnail fix is a fixed 64px square. Category stays a native <select>.
- iOS-first: one Menu sheet with push navigation, card source label opens feed page, YouTube that adds, layout contract: total 33 (coverage 9, fit 6, low risk 4, effort 5, iOS feel 9). These corrections are verified. categoryLabel title-cases all-lowercase strings, so storing new categories as typed with case-insensitive reuse is right. Headers and name need the job rebuilt, because the job holds args=[plugin] (scheduler.py:2145). A domain-scoped cookie jar survives httpx redirects. It covers the most of the brief: landscape, preset remap on rename, a poll overlay that also handles deletes, tab memory by name in the editor PR, AI page autosave, and a one-tap browser-identity fix on 403. Problems: (1) The optional API path puts `key=` in the query string. main.py:71 sets the root logger to INFO, and httpx logs full request URLs at INFO, so the key would land in the container logs, which contradicts 'never log the key'. (2) It deletes Drawer.tsx and the Settings container and replaces the routing with sheetRoute plus history.go(-n), with three pushState calls for a deep open. It adds a NavStack that keeps every level mounted and makes #root inert. That is a large regression surface for a non-developer owner. (3) It removes the phone refresh icon in favour of pull-to-refresh, which depends on negative scrollTop during rubber-banding and cannot be tested in Chromium. (4) It turns the source label on every card into a button next to the swipe surface, a new mis-tap target. (5) The flush on browser Back (popstate) is not specified; it flushes only on its own pop/close. (6) Refresh Now during an in-flight rename uses the old name, and Feeds page actions don't wait for the queue. It adds config.py, schemas.py, scheduler.py and tailwind.config.js to the allowed files, which is acceptable but more surface than needed.
- Structural fix: shared ui primitives, one save model, Menu panel + Settings sheet with pushed pages, lint+smoke+unit enforcement: total 28 (coverage 8, fit 5, low risk 3, effort 4, iOS feel 8). Verified defect: _PAGE_HEADERS sends the consent values as a raw 'Cookie' header. httpx 0.28.1 drops that header on every redirect hop (_client.py:569), so SOCS/CONSENT are lost on exactly the common redirecting inputs: youtube.com to www, youtu.be to watch, m. to www. Its consent-wall fix therefore mostly does nothing. The category picker returns to the editor after 300ms while each useAutosaveField hook keeps its own status, so a 422 that arrives late has nowhere to show. The plan says the picker stays open on error, which contradicts the auto-pop. It deletes FeedManager.tsx (1809 lines) and rewrites the slice15 and sitemap guard tests. It adds playwright to package.json and the lockfile: Dependabot churn, the Docker build stage installs it, and Chromium revisions drift. It adds ESLint regex rules over class strings, Node type-stripping unit tests and 8 PRs. Sign out shows only when OIDC is on, so local-auth users still can't sign out on the phone. The poll guard (localWriteAt) ignores deletes. Strong points worth keeping: the API key goes in an X-Goog-Api-Key header and never in the URL. The Sheet blurs the focused field before closing, visibilitychange blurs it too, and saves use fetch keepalive. The pure saveQueue, categories and headers modules are unit-tested. The thumbnail uses container queries. The test endpoint validates the category (invalid_category). The backend rejects duplicate header names. Smoke rules R7, R11 and R12 check label wrap, error visibility and that no Save button appears. Clock is fixed. The refresh icon stays, so the top bar has title, search, refresh and Menu.

Graft:
- From B: make the Settings sheet follow window.visualViewport at both top and bottom (top: safe-area + offsetTop, bottom: layoutH - (offsetTop + height)), so Done and the focused field stay visible. A only pads the bottom of the scroller.
- From B: store new categories as typed, trimmed with spaces collapsed, and reuse an existing spelling case-insensitively. Do not lower-case them: labels.ts categoryLabel turns 'nhl' into 'Nhl' because ACRONYMS has no nhl. Use autoCapitalize='words' on the New Category field.
- From B: replace A's single epoch counter with a per-id overlay of local writes and deletes stamped against each poll's start time, so a poll that began before a Delete cannot bring the row back, and unrelated rows still update.
- From B: remap saved filterPresets[].activeSources on rename (preferences.tsx:125 stores names), not only the active filter chips.
- From B and C: remember the phone tab by column name (with a one-time migration from the index key) in the same PR as the category picker. Easy category changes otherwise shift App.tsx:1358-1366's index to another column.
- From B: one module-level save store keyed by (source id, field) that pages subscribe to, so a save's status or error survives the editor or picker unmounting. Add one silent network retry after 2s. Show onFailedAway as an error toast with an 'Open' action.
- From C: blur the active element in the sheet's close path and on visibilitychange→hidden, and send PATCH with fetch keepalive. This covers app switching, which A lists as a known gap.
- From B and C: drop A's commit-on-blur for the New category… text field. Commit only on Return or the Add button, so half-typed names never create a column or trigger an ingest.
- From B and C: landscape phone layout via a raw md screen ('(min-width:768px) and (min-height:560-600px), (min-width:1024px)') changing all md:/sm: switches together, plus side safe-area insets on the header, the phone main and the tab strip. It can be its own last PR, but it should be in this plan, not deferred.
- From B and C: turn the AI tab's provider and model into selects that save on change, delete the LLM 'save' button and the Edit/Cancel toggle, have API keys commit on blur, and persist brief tone. This is complaint 7.
- From C: if YOUTUBE_API_KEY is ever added, send it as an X-Goog-Api-Key header, never as a query param. main.py:71 sets root logging to INFO and httpx logs full request URLs.
- From B: in the YouTube tests, patch app.url_safety.socket.getaddrinfo (or resolve_addresses, as C does) instead of no-op'ing ssrf_event_hook and check_url_safe, so the real SSRF guard stays in the tested path. Add a test with a redirect to a private IP, and a response body cap of about 3MB.
- From B: normalise server-side: bare UC ids, scheme-less youtube.com/m./music. pastes, and stripping of si/feature/pp/t tracking params. Then the Auto-add box and PATCH accept them too, not just A's client-side normalizeFeedInput.
- From C: run _validate_category in /api/sources/test (error_kind invalid_category), reject case-insensitive duplicate header names on the backend, make api.deleteSource throw ApiError with detail, and add a central errorMessage mapping for 401, 5xx and network errors.
- From C: add sitemap_url and link_pattern to the api.updateSource type and edit them for generic_scrape rows in the editor. PATCH already accepts them (sources.py:722-748).
- From C: smoke rules R7 (short labels must not wrap or ellipsize), R11 (an induced error is visible via elementFromPoint), R12 (no visible 'Save' button inside Settings) and R9 (any native dialog event fails), plus a fixed clock and fixtures with a 60-character name, a 120-character URL and a 90-character unbroken token.
- From C: replace A's fixed 64px square thumbnail with a container-query rule (beside the title when the card is wide, on its own row when narrow). That is a real fix rather than a smaller box.
- From B and C: optionally skip the scheduler job rebuild on a category-only PATCH (ingest reloads the category from the DB). Headers, name and URL still rebuild, because the job binds args=[plugin].
- From B: a problem card on the feed editor that offers a one-tap 'Use a browser identity' when last_error looks like a 401/403 and the feed type accepts headers.

Shared blind spots:
- Autosave makes every edit trigger an immediate ingest, and failed ingests increment error_count toward _AUTO_DISABLE_THRESHOLD = 6 (scheduler.py:206, 535-552). A URL or custom_headers change does not reset error_count; only reactivation does (scheduler.py:2373-2375). A user fixing a failing feed by trying a header, then an address, can trip auto-disable while still editing. No design resets the count, or skips counting it, after a url or headers change.
- update_source tests the `active` parameter, not row.active (`if active is False`, scheduler.py:2444). A PATCH of category, headers or URL on a paused or auto-disabled row therefore re-adds a dynamic job with next_run_time=now, which ingest then skips at :387. With autosave, editing a paused feed creates stray jobs. No design notices this.
- Discrete <select> controls (interval in all three; category in A; AI model selects in B/C) commit on `change`. Whether iOS Safari's wheel picker fires change as each selection settles or only when the picker closes has not been checked on a device. If it fires per stop, one pick sends several PATCHes and ingests. No design coalesces discrete-select commits or lists this as an on-phone check.
- Toast is fixed to the layout-viewport bottom (Toast.tsx:117). With the iOS keyboard open, error and Undo toasts land under the keyboard, and A routes Settings errors to toast. No design moves the toast with visualViewport.
- The YouTube hardening covers only the channel-page lookup. Fetching the resolved feed (sources/youtube.py:42 and the Test path's fetch_rss) still sends the default 'Popping/0.2' UA, so Test or ingest from the VPS can still fail after resolution succeeds. No design checks the feed endpoint's behaviour or offers a browser-identity fallback for it.
- A PATCH that changes the address of a youtube_channel row does a live page lookup inside the request (sources.py:694-699; read timeout 15s, up to 5 redirects). Autosave on blur can show 'Saving…' for a long time, and no design handles a slow save or a timeout.

## Designs

### Minimal-change plan: an autosaving feed editor inside Settings, one Menu button, a YouTube fix, and an overflow guard in CI

Key decisions:
- Keep the feed editor inline in Settings > Feeds (FeedManager.tsx), with no new component files, sheet or router. Tapping a row opens one editor with every field already editable. FeedEditor, CategoryPicker and HeadersEditor are module-private in FeedManager.tsx, so the backend source-text guard tests keep pointing at one file.
- One top-bar button: delete the gear (App.tsx:2298-2331) and keep the hamburger as the Menu. The Drawer's 'All settings…' row (Drawer.tsx:377-390) becomes the first row, 'Settings'. Each Sources row gets a 44px › button that deep-links to that feed's editor through ?view=settings&tab=feeds&source=<id>, so a given feed's editor is 2 taps away (today 3).
- Autosave without per-keystroke saves. Text fields commit on blur or Enter; selects and buttons commit on change. Each PATCH carries one field, and a module-level FIFO per source keeps PATCHes for one source from overlapping. The backend fetches immediately after every effective PATCH (scheduler.py:2455-2461), so there is no debounce timer and scheduler.py is unchanged.
- App's sources list changes only from the PATCH response. onSourceUpdated keeps net_vote_score (the PATCH returns 0), and an epoch guard in refresh() stops an older poll from reverting a save. Inline per-field 'Saving…/Saved ✓' with aria-live; on error, text is kept with Revert and Try again, and dropdowns snap back. Unsaved address/name edits are sent when the editor closes; a failure after close appears as a red toast.
- Errors from Settings go to toast(…,'error'), which renders above the sheet, instead of App's banner hidden under the z-50 overlay. refresh() becomes silent for polls, visibility changes and FeedManager calls, so the per-minute 'refreshed' toast never buries save feedback.
- The category picker is a native <select> with 'Your categories' (from sources[].category, not App's entries-derived categories), 'Suggestions' (CATEGORY_OPTIONS) and 'New category…'. New names are trimmed and lower-cased, at most 40 characters, not 'saved'/'for you', and reuse an existing spelling when only the case differs. The Add form uses the same picker.
- Headers are key/value rows plus a one-tap 'Use a browser identity' preset. The client mirrors the backend denylist, the 20-header and 512-character limits, printable ASCII, and drops blank rows. The whole map (or null) is sent in one PATCH. Hidden for built-in and reddit rows. Also offered in the Add form under a <details> 'Advanced' section, with friendlyTestError pointing to it.
- The YouTube fix covers both sides. Backend: feed links resolve with no network, the page fetch looks like a browser (UA, Accept-Language, SOCS/CONSENT cookies on the client) with SSRF guards unchanged, five page markers instead of one, consent and bot pages detected with a 'paste the channel ID' message, and /auto gets a youtube_channel branch. Frontend: @handle and bare UC ids are accepted, the name is optional and suggested, errors show inline, and Add reuses the resolved URL from Test. YOUTUBE_API_KEY is deferred.
- The overflow guard is a new smoke.cjs that reuses capture.cjs's mockApi. Fresh context per state at 390 and 320. It checks body/#root width, elements escaping the viewport (skipping clipped and hidden subtrees, so intentional negative margins pass), visible text overflow, runtime errors and unmocked calls, and the production CSP read from nginx.conf.template. In PR 5 it also checks authored control font size ≥16 with the coarse-pointer rule removed via CSSOM, and 44px targets.
- CI gets one step in frontend-checks: npm install --no-save playwright@1.56.1, then playwright install, vite preview --strictPort, then smoke. package.json, the lockfile, the Docker build stage and dependabot are untouched. run.sh's orphaned preview server is fixed by calling the vite binary directly.
- Root-cause overflow fixes instead of patches: min-w-0/flex-1 on the flexible child of each fixed-width row (search, Auto-add input), status chips moved off the feed name line, the Feeds tab gets its missing px-4, card action rows wrap whole controls, and a 64px square thumbnail below sm. A .hit-44 ::after utility gives 44px hit areas without changing visuals.
- VPS safety: PRs touch only frontend/src, frontend/scripts/iphone-audit, backend/app/youtube.py, backend/app/routes/sources.py, backend/tests and one CI step. No config, schemas, scheduler, compose, Dockerfile, nginx, egress-proxy or ops changes. No new secrets, ports, services or outbound hosts.
- Settings closes through history.back() when it was opened by pushState with a {popping:'settings'} state. The tab switches keep that state (replaceState(window.history.state, …)) and drop the source param, so Back never reopens Settings. SETTINGS_TABS is exported once and replaces three duplicated lists.
- Small backend fixes ride along in PR 1 because they sit in the same file and serve the new UI: the reddit Test import, a header-name format check (the UI now exposes a free-text name), and storing the stripped category. Built-in drift is fixed by adding rfd_hot_deals plus a no_db guard test against registered_plugin_names(), not by adding a builtin field to the API schema.
- Five PRs in order: backend; guard plus layout; Menu plus history plus focus link; editor; sweep with the strict guard. The FeedManager class-only overflow fixes land before the editor rewrite so the editor builds on them. Larger items are deferred with reasons: landscape breakpoint, Settings tab regroup, AI model picker, tab-by-name, brief-tone persistence, preference retry.


# Popping redesign, minimal-change version (revision of REDESIGN_PLAN.md)

This revises REDESIGN_PLAN.md on branch claude/redesign-plan. I re-read the plan and checked its file:line references against the checkout (origin/main 721713e plus the plan commits; frontend/src and backend/app are unchanged from main). Approach:

- Change the existing FeedManager, Settings, App and Drawer in place.
- Add no new React component files, no router and no new runtime dependency.
- Keep the Settings overlay as the home of the feed editor.
- Ship in five PR-sized steps. Each step is green on its own.

---

## 0. Review of the draft plan

**Keep:**
- The safety posture: nothing touches docker-compose.yml, Dockerfiles, nginx.conf.template, egress-proxy or ops.
- Autosave sends one PATCH per committed change, never one per keystroke. The backend schedules an immediate fetch after every effective PATCH (backend/app/scheduler.py:2455-2461, 2144).
- The key/value headers editor with a "browser identity" preset.
- A category list built from `sources`.
- Removing the gear and keeping the hamburger as the single Menu.
- The overflow measurements in section 4.
- Adding `rfd_hot_deals` to the built-in list.
- Fixing the reddit Test import.
- Rewriting stale comments.

**Correct (wrong against the code):**
1. The draft adds a FeedEditorSheet, a Sheet, a Row, a useAutosave file and `?edit=<id>` routing. Minimal-change does without all of them. The editor stays inline in the Feeds tab: one tap on a row opens every field, already editable. Deep links ride the existing Settings URL as `?view=settings&tab=feeds&source=<id>`.
2. Draft §5 path 2 says "open a card's options (the chevron under the card) → Edit this feed". No such touch menu exists. The chevron toggles the summary, and the card menu is right-click only (Card.tsx:708-808, bound at :879). Replaced by a 44px "›" button on each feed row in the Menu's Sources list.
3. Draft §6 says skip the scheduler rebuild for category, name or header changes. A header change should fetch right away, because that is how the user sees whether the new header worked. A category change costs one extra fetch, and only when the user changes the category. Decision: no scheduler.py change.
4. Wrong names and lines in the draft:
   - The reserved-name constant is `_RESERVED_CATEGORY_NAMES` at sources.py:162, not `_RESERVED_CATEGORIES` near :154.
   - The gear is App.tsx:2298-2331 and the hamburger App.tsx:2333 (the draft says 2272-2301 and 2306).
   - The phone tab index is persisted at App.tsx:1358-1366, not 835-841.
   - The test endpoint honours headers at sources.py:988-995, and only for rss, podcast and youtube.
5. Draft §9 claims a keyboard shortcut and "BriefCard pills" open Settings. They don't. The only `openSettings` callers are the gear (App.tsx:2307) and the Drawer (App.tsx:2811).
6. Draft §3 YouTube:
   - Drop the `/user/NAME → ?user=` shortcut. It cannot be verified here.
   - Defer `YOUTUBE_API_KEY`. It needs a new secret, a config.py change and a new outbound host (googleapis.com), and a non-developer owner would have to create a Google Cloud key.
   - The draft missed four frontend causes; see §7.
7. Draft "Done calls history.back()" needs one more change to work: the Settings tab buttons call `replaceState(null, …)` (Settings.tsx:241). That wipes `history.state`, so any "opened by us" flag is lost.
8. Draft guard: "fail when any element's text or box extends past its parent" would fail on the dashboard every time.
   - The card action row's intentional `-ml-3`/`-mr-2` and the off-screen closed Drawer are flagged in every state of the existing scan (shots/analysis.txt).
   - The guard below checks against the viewport, visible text overflow and the page width, uses a fresh browser context per state, and needs no allowlist.
9. Draft §4 item 11: the headers textarea is not clipped by line-height. It is a 3-row textarea that scrolls a long UA. The point is moot once JSON is gone.
10. Draft §13 says backend pytest cannot run in the container. It can: Postgres 16 plus pgvector plus /etc/hosts entries gave 623 passed in 24.7 s. Recipe in §12.
11. Draft PR A fixes the FeedManager overflow items before the editor rewrite of the same lines. Reordered so the class-only fixes land first and the editor builds on them.
12. Draft §2 allows scheduler.py, config.py, schemas.py and .env.example. None of them are needed. Draft PR A adds Playwright to package.json. Not needed either: CI installs it with `npm install --no-save` (see §8), so the lockfile, the Docker build stage and dependabot are all untouched.

**Fill (missing from the draft):**
- **Fragile source-text tests.** `test_url_placeholder_uses_generic_scrape_specific_text` (backend/tests/test_frontend_slice15_add_generic_scrape.py:212-230) reads the first `placeholder={` in FeedManager.tsx. Any new `placeholder={…}` above the Add form's URL input breaks CI. Rule: new controls use only string-literal placeholders.
- **PATCH response score.** The PATCH response carries `net_vote_score: 0` (only the list endpoint fills it, sources.py:398-403). Applying the response as-is would wipe the vote badge. App must keep the old score.
- **Polling race.** A 60 s poll whose GET started before a PATCH can land after it and revert the row. Fixed with an epoch guard.
- **"refreshed" toast.** `refresh()` toasts "refreshed" on every poll (App.tsx:1112, 1247-1249). Every FeedManager mutation also calls it, which would bury save feedback.
- **Hidden errors.** Errors from Settings go to the App banner, which sits under the z-50 sheet (App.tsx:2397-2411, Settings.tsx:189).
- **Interval select mismatch.** The interval `<select>` shows the wrong value when the stored interval is not a preset, e.g. HN's 5 min (FeedManager.tsx:825-837).

---

## 1. Safety and VPS posture (requirement 8)

| Item | After this plan |
|---|---|
| Published ports | Unchanged: frontend only, `127.0.0.1:14789->8080` (docker-compose.yml:129). |
| Containers, services, daemons, cron | Unchanged. No new process, no background task, no new route file. |
| Files any PR may touch | `frontend/src/**`, `frontend/scripts/iphone-audit/**`, `backend/app/youtube.py`, `backend/app/routes/sources.py`, `backend/tests/**`, plus one added step in the `frontend-checks` job of `.github/workflows/build.yml` (no new permissions, secrets or triggers). |
| Files no PR may touch | docker-compose.yml, any Dockerfile, frontend/nginx.conf.template, egress-proxy/**, ops/**, frontend/package.json and package-lock.json, .github/dependabot.yml, backend config.py and schemas.py. |
| Outbound fetches | Same hosts as today. The YouTube lookup still goes to www.youtube.com through `check_url_safe` (entry), `ssrf_event_hook` (every redirect hop) and the final-URL check (youtube.py:80-104). The existing test pins the literal `event_hooks={"request": [ssrf_event_hook]}` (backend/tests/test_youtube.py:58-71). |
| What a YouTube lookup sends | A browser User-Agent, `Accept-Language`, and two fixed consent cookies (`SOCS=CAI`, `CONSENT=YES+`). No user data, no credentials, no API key. |
| Header denylist (cookie, authorization, host, x-forwarded-*, …, sources.py:169-187) | Unchanged. The UI mirrors it, and the backend gains a header-name format check (a stricter input rule). |
| CSP | Unchanged. The new UI adds no external fonts or scripts. The one new data-URI select chevron (PR 5) is allowed by `img-src 'self' data:` (nginx.conf.template:29). The CI smoke test injects the production CSP and fails on any "Refused to" console error. |
| Docker images | The runtime image is still `nginx-unprivileged` + `dist`. The build stage is identical because package.json and the lockfile are unchanged. |
| CI | The new step installs Playwright and Chromium on the GitHub runner only. Nothing reaches the VPS. |

Before each merge:
- `git diff --name-only origin/main...HEAD` lists only allowed files.
- Run the security-review skill on the diff.
- All four check runs are green: backend tests, frontend lint + build, backend image, frontend image.

After popping-update on the VPS:
- `docker compose ps` shows only `127.0.0.1:14789->8080`.
- `ss -ltnp` shows no new listener.
- The app loads and a feed refreshes.

Rollback: `POPPING_IMAGE_TAG=sha-<previous>` in .env, then `docker compose up -d`.

---

## 2. What the owner sees on the iPhone (tap by tap)

**Top bar (all phone widths):** "Popping" title, Search, Refresh (phones only, as today), and one Menu button (≡). The gear is gone.

**Menu**, the right-hand panel, with Done at 44px:
- **Quick settings**
  1. **Settings**: "Feeds, AI, notifications, saved and hidden". Opens Settings on Feeds.
  2. **History**
  3. **Save current view**: an inline name field from PR 5.
  4. **Sign out**: only when signed in with OIDC or local auth.
- **Jump to column**: now switches the phone's column tab.
- **Sources**: each row has the filter checkbox (unchanged) and a 44px "›" button that opens that feed's editor.

**F1. Change a feed's category.** Today this takes 5 taps plus typing the exact spelling: gear → row → edit → field → type → save.
1. Tap ≡.
2. Tap › beside "The Verge". The Menu closes, Settings opens on Feeds → My feeds, and The Verge's editor is open and scrolled to the top.
3. Tap **Category**. It is a native picker showing "News". iOS lists "Your categories" (Deals, News, Security…), then "Suggestions" (Tech, Science…), then "New category…".
4. Pick "Tech". The label row shows "Saving…", then "Saved ✓" for 1.5 s. The Tech column on the dashboard has the feed as soon as the save succeeds.
5. Done, the browser's Back, or Esc closes Settings.

Result: 4 taps, no typing, no save button.

**F2. New category.** Steps 1-3 of F1, then:
- Pick "New category…". A text field appears under the picker with the keyboard up. It has no auto-capital and no autocorrect, placeholder "e.g. hockey".
- Type "Hockey" and tap Return (or the 44px **Add** button). It is stored as `hockey`, with "Saving…" then "Saved ✓".
- Inline errors, nothing sent: "Type a name", "Keep it under 40 characters", "That name is used by a built-in column".
- Typing an existing category in any case ("NEWS") reuses the existing spelling.
- **Cancel** puts the picker back on the current category.

**F3. A site blocks the reader.** Today this takes 5 taps plus hand-written JSON.
1. Tap ≡.
2. Tap ›.
3. Scroll to **Headers** and tap **Use a browser identity**. A User-Agent row appears and saves immediately.
4. Tap **Check now**. A toast shows "Fetched 23 from The Verge (4 new)".

Custom header: tap **Add header**, type the name, type the value, tap anywhere outside the headers block. It saves, or shows an error under that row and sends nothing.

**F4. Pause:** ≡ → › → **Pause feed** (44px). "Saving…", "Saved ✓". The button changes to **Resume feed** and the row name is struck through.

**F5. Refresh interval:** ≡ → › → **Check for new items** picker → pick. 4 taps; today it is 5.

**F6. Delete:** ≡ → › → **Delete feed…** → an inline row "Delete The Verge? This can't be undone. Pausing keeps it." with **Delete** and **Keep**, both 44px.
- No 4-second timer (today FeedManager.tsx:379, 433-437).
- Delete → toast "Deleted The Verge" → the row disappears.

**F7. Rename or change the address:**
- Tap **Name**. The keyboard opens with no auto-capital. Edit, then Return or tap elsewhere → "Saving…", "Saved ✓".
- Invalid input shows a red line under the field. The typed text is kept, with **Revert** (44px).
- A server refusal shows the server's message in the same place, for example "source name 'x' is already in use".
- A network failure shows "Couldn't reach the server." plus **Try again**.

**F8. Close mid-save:** type a new address and tap Done at once.
- The field's blur commits it and Settings closes immediately.
- The PATCH finishes in the background and the dashboard updates.
- If it fails, a red toast on the dashboard says "The Verge: couldn't save the address. <reason>".

**F9. Through Settings:** ≡ → **Settings** (opens on Feeds) → tap a row → editor. 3 taps, the same as today's gear → row → edit, and nothing to save.

**F10. Add a YouTube channel:**
- **Quick way:** ≡ → Settings → **Add a feed** tab → paste the link into **Auto feed** → **Auto-add**. Toast "Feed added: mkbhd_yt", shown as "Mkbhd (YouTube)".
- **Form way:**
  1. Tap **YouTube**.
  2. Paste a channel link, video link, `@handle` or channel ID (`UC…`). Name is optional ("Will be saved as: mkbhd_yt").
  3. Tap **Test**: "✓ Looks good, 15 items", plus "Resolved to the real feed: …".
  4. Tap **Add feed**. It reuses the resolved feed link, so YouTube is not fetched a second time.
- **Failure:** a red box above the buttons says why. When YouTube blocks the server: "YouTube didn't let the server look this channel up. Paste the channel ID instead: on the channel page open About (More about this channel) → Share channel → Copy channel ID."

**Tap counts**

| Task | Today | After |
|---|---|---|
| Open a given feed's editor | 3 (gear → row → edit) | 2 (≡ → ›) |
| Change category | 5 + typing exact spelling | 4, no typing |
| Browser-UA header | 5 + JSON | 3 |
| Pause | 3 | 3 |
| Refresh interval | 5 | 4 |
| Delete | 4, inside a 4 s window | 4, no timer |
| Open Settings (any tab) | 1 | 2 (the cost of having one button) |

Desktop (≥ md 768px) keeps the 480px right-hand panel. The header sub-row (Refresh, Brief, UserBadge, App.tsx:2342-2365) is unchanged. Only the gear is removed.

---

## 3. Top bar, gear, "All settings…", Settings overlay (requirement 5), PR 3

**Gear.** Delete App.tsx:2298-2331: the comment, the button with `data-settings-gear` (referenced nowhere else) and the SVG.
- The cluster becomes search + refresh (`sm:hidden`) + `<Hamburger>`.
- At 320 this alone gives the title 148px instead of 100px, which fixes audit item 8.
- Rewrite the stale comments at App.tsx:2-17 and 2211-2219.

**Hamburger** (Hamburger.tsx): unchanged, keeps `aria-label="open menu"`.

**Drawer "All settings…" row** (Drawer.tsx:377-390): becomes the first row of "Quick settings".
- Title "Settings", subtitle "Feeds, AI, notifications, saved and hidden", calling `onOpenSettings?.('feeds'); onClose()`.
- History (Drawer.tsx:336-351) stays second. It is a deep link, not a duplicate button. Save current view stays third.

**Other Drawer changes:**
- Add a "Sign out" GroupedRow after Save current view when the new prop `onSignOut` is set.
  - App passes `onSignOut={user && !oidcDisabled ? async () => { try { await api.logout() } finally { window.location.reload() } } : undefined}`, mirroring UserBadge.tsx:20-29.
  - Subtitle `user.name || user.email`.
- Sources rows (Drawer.tsx:457-479):
  - The `<label>` becomes a `<div className="flex items-center border-b border-hairline last:border-b-0">`.
  - Inside it: the existing `<label className="flex flex-1 min-w-0 items-center gap-3 pl-4 min-h-[44px] …">` (checkbox, icon, name, category), and a sibling `<button type="button" aria-label={`edit ${sourceLabel(s.name)}`} className="w-11 h-11 shrink-0 flex items-center justify-center text-label-tertiary active:bg-bg-elevated" onClick={() => { onEditSource?.(s.id); onClose() }}><ChevronRight /></button>`.
  - Reuse the module-private `ChevronRight` (Drawer.tsx:607).
  - New prop `onEditSource?: (id: number) => void`. App wires `(id) => openSettings('feeds', id)`.
- Drawer.tsx:477 `{s.category}` becomes `{categoryLabel(s.category)}`. The footnote at :415 uses `sourceLabel`.
- The "Clear" action (Drawer.tsx:420-426) gets `min-h-[44px] px-2 -mr-2`.
- Delete the dead `onResetLocalState` prop (Drawer.tsx:61-66, 89-92; App.tsx:2810).
- Grabber at Drawer.tsx:303-306: `top-3` becomes `top-[calc(env(safe-area-inset-top)+0.75rem)]`.
- Rewrite the stale comments at Drawer.tsx:3-9, 257-261, 71-75.

**Jump to column** (App.tsx:2022-2030):
- Add `setMobileCol(idx)`. The phone pager shows `columns[mobileCol]` (App.tsx:2699 maps tab i to columns[i]).
- Change the scroll target to `(el?.firstElementChild as HTMLElement | null)?.scrollIntoView(...)`. The ref is a `display: contents` div (App.tsx:2598), so scrolling the ref itself does nothing.

**Settings overlay:** stays, with the same z-50 layer and the same `?view=settings&tab=` contract.
- **Focus parameter.** App state `settingsSourceId: number | null`.
  - `sync()` (App.tsx:395-424) reads `source` with `/^\d+$/` and sets it, else null.
  - `openSettings(tab = 'feeds', sourceId?: number)` sets or deletes `source`, then calls `pushState({ popping: 'settings' }, '', url)`.
  - Pass `focusSourceId={settingsSourceId}` to Settings, which passes it to FeedManager.
- **Back-friendly close.** `closeSettings`:
  - If `window.history.state?.popping === 'settings'`, call `window.history.back()`. Popstate then runs sync, which closes Settings.
  - Otherwise (opened by deep link or reload), delete view, tab and source, call `replaceState(null, '', url)`, then `setSettingsOpen(false)`.
  - Result: Done/Esc/backdrop leave no extra history entry, and one Back does not reopen Settings.
- Settings tab buttons (Settings.tsx:238-246): `u.searchParams.delete('source')` and `replaceState(window.history.state, '', u.toString())`, which keeps the flag.
- **One tab list.** Export `SETTINGS_TABS = ['feeds','llm','notifications','history','hidden','starred','voted','reset'] as const` from Settings.tsx and derive `SettingsTab` from it.
  - Use it for the strip (Settings.tsx:229) and the App allow-list (App.tsx:409-418): `(SETTINGS_TABS as readonly string[]).includes(t)`.
  - `allowConstantExport` permits this (eslint.config.js).
- **FeedManager focus.** One open row at a time.
  - Replace `editingRowId` and `editingInterval` (FeedManager.tsx:214-215) and SourceRow's local `open` (:384) with one lifted `openRowId`, initialised from `focusSourceId`.
  - An effect on `focusSourceId` sets `tab='mine'` and `openRowId`, then on the next frame calls `document.getElementById(`feed-${id}`)?.scrollIntoView({ block: 'start' })`.
  - `<li id={`feed-${s.id}`}>`.

---

## 4. The feed editor that saves on its own (requirements 1 and 3), PR 4

All in frontend/src/components/FeedManager.tsx as module-private components, with no new files.

**Rule:** every new JSX attribute uses a string-literal `placeholder="…"`, never `placeholder={…}` (guard test at slice15:212-230).

### 4.1 Structure

**MyFeedsTab:** `<ul className="rounded-ios bg-bg-surface overflow-hidden">` (an iOS grouped card) with `SourceRow` per source.

**SourceRow** (the existing component, slimmed):
- **Header button** (`min-h-[44px]`, `aria-expanded`): icon, name (`min-w-0 truncate`), category (`text-ios-caption`), net-vote badge, chevron.
- **Caption line, always shown:** "updated 4m ago · every 1 hour", plus the status chips moved here from the name line: "paused", "auto-disabled", "⚠ 3". It is `text-ios-caption` and `flex-wrap`.
- When `openRowId === source.id`, render `<FeedEditor …/>`.
- Delete: the old inline edit form (:567-680), the JSON parser (:477-506), `saveEdit` (:508-565), the re-seed effect (:465-475), the "edit"/"every X"/"cancel"/"save" links (:798-855) and the 4 s auto-cancel (:379, 433-437).

**FeedEditor** (new module-private component, mounted only while the row is open). Its unmount is the flush point. Top to bottom, each control `min-h-[44px] text-ios-body` (17px), labels `text-ios-caption`:
1. **Problem line**, when `source.last_error` is set:
   - "Last problem: <last_error>" (`text-ios-caption text-red-300 break-words line-clamp-3`).
   - If `auto_disabled`, also: "Paused automatically after N failed checks. Fix the address or headers, then tap Resume feed."
   - This replaces the tooltip-only info at FeedManager.tsx:704-754.
2. **Name.** `type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"`.
   - Hint: "Lowercase letters, numbers and _. Shows as “<sourceLabel(draft)>”."
   - Disabled for built-ins, with the note "Built-in feed: the name and address can't be changed."
3. **Address** (label "Subreddit" for reddit rows). `type="url" inputMode="url"`, same no-capital attributes; disabled for built-ins.
4. **Category:** `<CategoryPicker>` (§5).
5. **Check for new items:** a `<select>` over REFRESH_PRESETS (FeedManager.tsx:57). If the current value is not a preset, put `<option value={v}>every {refreshLabel(v)}</option>` first so the picker never shows a wrong value.
6. **Headers:** `<HeadersEditor>` (§6). Hidden when built-in or `type === 'reddit'` (dynamic_reddit.py:171 ignores headers). Shown for rss, podcast, youtube_channel and generic_scrape (generic_scrape.py:391, 475).
7. **Actions row** (`flex flex-wrap gap-2`), 44px buttons:
   - **Pause feed** / **Resume feed**.
   - **Check now**: the existing POST /api/ingest/{name} with the existing toasts at :869-883. Renamed from "fetch".
   - **Delete feed…**: inline confirm without a timer.

**Built-in detection:** `KNOWN_BUILT_INS` (FeedManager.tsx:108-115) gains `'rfd_hot_deals'`. A no_db guard test pins it to the backend registry (§11, PR 4).

### 4.2 State

Per FeedEditor:
- `draft`: `{ name, url, category, headers }`, seeded from `source` when the editor mounts, not on every prop change.
- `dirtyRef: Record<Field, boolean>`: set on change, cleared on successful save or on Revert.
- `focusedRef: Field | null`.
- `lastSentRef: Partial<Record<Field, unknown>>`: the value currently being saved, so the unmount flush does not send it twice.
- `status: Record<Field, { state: 'idle'|'saving'|'saved'|'error'; message?: string; retry?: () => void }>`.
- `mountedRef`.

**Re-seed rule.** An effect on `[source]`. `reconcileById` (App.tsx:106-113) keeps object identity when the row is unchanged, so this fires only on real changes. For each field that is not dirty, not focused and not saving, copy the value from `source`. This fixes the re-seed bug at :465-475, where polling overwrote in-progress edits.

### 4.3 Save mechanics

**When a field commits:**

| Field | Commits on | Debounce |
|---|---|---|
| Name, Address | `onBlur`, and `onKeyDown Enter` → `e.currentTarget.blur()` | None; no per-keystroke saves |
| Category, interval | `onChange` of the native select (iOS fires on picker close) | Immediate |
| Pause | Tap | Immediate |
| Headers | Focus leaves the headers block (`onBlur` with `!e.currentTarget.contains(e.relatedTarget)`; on iOS a tapped button gives a null relatedTarget, which also commits), "Use a browser identity", or removing a row | Immediate |

**Client validation, before any request.** A failure shows an error under the field, sends nothing and leaves the field dirty.
- **Name:** `trim().toLowerCase()`, then `^[a-z0-9_]{1,120}$` (sources.py:111). Error: "Use lowercase letters, numbers and _ (no spaces)."
- **Address:** trim. For non-reddit rows, prefix `https://` when there is no `://` and the value contains a dot, then `new URL(v)`. For reddit, at least 3 characters.
- **Category:** §5. **Headers:** §6.
- **No change** (equal to `source.*` after normalising): clear the dirty flag; no request, no "Saved".

**The PATCH.** The body holds only the changed key, e.g. `{ category: 'tech' }` or `{ custom_headers: {...} | null }`, using the existing `api.updateSource` (api.ts:424-443). Requests go through a module-level FIFO per source id, so two PATCHes for one source never overlap:

```ts
const saveChains = new Map<number, Promise<unknown>>()
function enqueuePatch(id: number, body: Parameters<typeof api.updateSource>[1]): Promise<Source> {
  const prev = saveChains.get(id) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => api.updateSource(id, body))
  saveChains.set(id, next)
  next.catch(() => undefined).finally(() => { if (saveChains.get(id) === next) saveChains.delete(id) })
  return next
}
```

`commitField(field, body, label)` does the following:
1. Set `status[field]` to `saving` and `lastSentRef[field]` to the value.
2. Call `enqueuePatch`.
3. **On success, with the full row `updated`:**
   - Call `onSourceUpdated(updated)` (App level; runs even after unmount).
   - If `body.name` was sent and `updated.name !== nameAtCommit`, call `onSourceRenamed(nameAtCommit, updated.name)`. The existing App remap is at App.tsx:1994-2003.
   - If still mounted: clear dirty, set `saved`, and after 1500 ms set `idle`.
4. **On failure:**
   - Message from `parseApiError(err, …)` (FeedManager.tsx:190-210). A `TypeError` (fetch failed) becomes "Couldn't reach the server."
   - If mounted: set `error` with message and `retry: () => commitField(field, body, label)`.
     - Text fields keep the user's text and show **Revert** (sets the draft to `source.*`, clears dirty and error) and **Try again** (network errors only).
     - Discrete controls (category, interval, pause, headers presets) snap back to `source.*` and show the message, because there is no typed text to keep.
   - If unmounted: `toast(`${sourceLabel(name)}: couldn't save the ${label}. ${msg}`, 'error')`.

**"Saved" feedback.** Each field label row is `flex justify-between`, with the label on the left and a status span on the right (`role="status" aria-live="polite"`, `text-ios-caption`):
- "Saving…" in `text-label-tertiary`.
- "Saved ✓" in `text-emerald-400` for 1.5 s.
- Errors render under the control in `text-red-300`.

There is no success toast, so nothing competes with or overwrites the inline feedback, and the layout does not jump.

**Optimistic display, and when the dashboard changes.** The control shows the new value at once. App's `sources` changes only from the PATCH response, so the dashboard never shows a value the server refused. App applies it like this:

```ts
const sourcesEpochRef = useRef(0)
const onSourceUpdated = useCallback((u: Source) => {
  sourcesEpochRef.current += 1
  setSources((prev) => prev.map((s) => (s.id === u.id ? { ...u, net_vote_score: s.net_vote_score } : s)))
}, [])
```

Keeping `net_vote_score` is required because the PATCH response carries 0 (sources.py:398-403).

**Polling race.** In `refresh()` (App.tsx:1057), capture `const epoch = sourcesEpochRef.current` before `Promise.all`. Call `setSources(...)` only if `epoch === sourcesEpochRef.current`. A poll that started before a save can no longer revert it; the next poll reconciles.

**Rapid changes:**
- Category a → b → c quickly sends PATCH b then PATCH c in order. The final row is c, and each response is applied in order.
- A field whose own save is still in flight is not reseeded, so an older response for another field cannot overwrite it.

**Check now / Delete.** Each first awaits `saveChains.get(id)?.catch(() => {})`, then uses the latest name, kept in `nameRef`, updated from each response. A pending rename therefore cannot make `/api/ingest/{old_name}` 404.

**Closing mid-save** (Done, Esc, backdrop, Back, collapsing the row, opening another row, switching tab):
- On iOS, tapping Done blurs the focused input first, so the commit starts before the unmount.
- Belt and braces: FeedEditor's unmount cleanup runs `flushDirty()`. For name and address, if dirty, valid, changed and `!== lastSentRef`, it calls `commitField`. It reads drafts from a ref.
- In-flight PATCHes are never aborted. Success updates App silently; failure becomes a red toast (Toast renders above Settings, App.tsx:2895).
- Known gap: if iOS kills the app with a field still focused, that one edit is lost (§13).

**Errors no longer go to the hidden banner.**
- Settings defines `const reportError = useCallback((m: string) => toast(m, 'error'), [])` before `if (!open) return null`.
- Settings passes it as FeedManager's and HistoryTab's `onError` instead of App's `setError` (Settings.tsx:269, 398).
- Toast becomes 3 lines and 4 s for errors (PR 2).

**`refresh` becomes silent by default for background calls.**
- Signature: `refresh(opts?: { silent?: boolean })`. Toast "refreshed" / "N new" only when not silent; errors still set the banner and toast only when not silent.
- Pass `{ silent: true }` at:
  - the poll (App.tsx:1248), visibility (:1263), initial load (:1271), filter debounce (:1343);
  - Settings' and Drawer's `onRefreshSources` (App.tsx:2805, 2838), which become `() => refresh({ silent: true })`. This is awaitable, so FeedManager's existing `await onRefresh()` (Add, Delete, Check now) now really waits.
- The refresh icon, the desktop Refresh button, the 'r' key and Column's chip (`onRefresh={refresh}`, App.tsx:2605, 2740) are unchanged. Column's memo comparator ignores callbacks, so its prop must stay the same stable `refresh`.

**Keyboard-aware Settings sheet**, in Settings.tsx before the early return:
- An effect while `open` subscribes to `window.visualViewport` `resize` and `scroll` and sets `kbInset = max(0, round(innerHeight - vv.height - vv.offsetTop))`.
- The body scroller (Settings.tsx:263) uses `style={{ paddingBottom: `calc(2rem + env(safe-area-inset-bottom) + ${kbInset}px)` }}`, replacing the `pb-[…]` class, and adds `onFocus={(e) => { const t = e.target as HTMLElement; if (t.matches('input,textarea')) setTimeout(() => t.scrollIntoView({ block: 'center' }), 250) }}`.
- This keeps every editor field reachable above the keyboard.

---

## 5. Category picker (requirement 2), PR 4

`function CategoryPicker({ id, value, sources, onChange, disabled }: …)` is module-private in FeedManager.tsx. The edit form uses it in place of the `<input list>` + `<datalist>` (FeedManager.tsx:602-618), and the Add form uses it in place of `<select id="fm-category">` (:1722-1731).

**Options:**
- **Your categories:** `unique(sources.map(s => s.category))`, plus `value` if missing, sorted by `categoryLabel` (labels.ts:64-68). Option text is `categoryLabel(c)`. If two raw values have the same label ("news" and "News"), show `${categoryLabel(c)} (${c})` so the user can tell them apart and merge.
- **Suggestions:** `CATEGORY_OPTIONS` (FeedManager.tsx:80-105) minus anything already in "Your categories", compared without case. On a fresh install this is the only group.
- **"New category…":** `value="__new__"`.
- Do not use App's `categories` (App.tsx:753-764). It is built from visible entries, so it misses categories with no entries.

**Rendering:** native `<select className="w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline px-3 text-ios-body">`. A native picker is what iOS shows best; a datalist is invisible on iOS Safari.

**New mode:** choosing `__new__` sets `mode='new'` and renders:
- `<input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={40} placeholder="e.g. hockey" autoFocus>`. autoFocus is fine because the user asked for it.
- 44px **Add** and **Cancel** buttons.
- Enter or Add commits; blur with a non-empty value commits; Cancel goes back to the select.

**Normalise:** `trim()`, collapse inner whitespace to one space, lower-case.

**Validate, mirroring sources.py:287-303:**
- Empty → "Type a name".
- More than 40 characters (`CATEGORY_MAX = 40`) → "Keep it under 40 characters".
- In `RESERVED_CATEGORIES = ['saved', 'for you']` → "That name is used by a built-in column".
- Equal to an existing value without case → reuse the existing raw value.

**Commit:** `onChange(final)`. In FeedEditor that is `commitField('category', { category: final }, 'category')`; in the Add form it is `setCategory`.

**Columns:** App groups by raw category (App.tsx:753-764). Moving the last feed out of a category removes its column on the next render. The phone tab index is then clamped by App.tsx:1358-1366. Remembering the tab by name instead is deferred (§9).

---

## 6. Headers without code (requirement 4), PR 4

`function HeadersEditor({ value, onCommit, disabled }: { value: Record<string,string> | null; onCommit: (next: Record<string,string> | null) => void; disabled?: boolean })` is module-private.

**Rows:** state `Array<{ key: number; name: string; value: string }>`, seeded from `value` when not dirty.

**Phone layout** (stacks cleanly at 320), per row: `grid grid-cols-[1fr_auto] gap-2`:
- First line: header name input (`placeholder="Header name"`, `autoCapitalize="none" autoCorrect="off" spellCheck={false}`) and a 44px remove button (`aria-label="remove header"`, ✕).
- Second line: value input spanning both columns (`placeholder="Value"`).

**Below the rows:**
- **Add header** (44px, outline).
- **Use a browser identity** (44px). Sets or replaces `User-Agent` with `BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'` and commits immediately.
- Note: "Some sites block automated readers. A browser identity usually fixes it."

**Validation before sending.** The whole map is sent at once, or not at all; errors show under the offending row.
- Rows with an empty name and value are dropped silently. The backend accepts blank keys (sources.py:325-334), so the client must drop them.
- Name present, value empty → "Add a value". Value present, name empty → "Add a header name".
- Name must match `^[!#$%&'*+.^_`|~0-9A-Za-z-]+$` → "Header names can't contain spaces or symbols."
- Name in `HEADER_DENYLIST` (exactly sources.py:169-187: cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url), compared in lower case → "Popping can't send a <Name> header."
- Value longer than `HEADER_VALUE_MAX = 512` → "Too long (512 characters max)."
- Value outside printable ASCII and tab → "Use plain letters, numbers and punctuation."
- More than `HEADERS_MAX = 20` rows → "20 headers at most."
- Duplicate names, compared without case → "Already added."

**Serialise:** an object of the valid rows, or `null` when there are none. `null` is the cleared state the backend wants (sources.py:354, 754-759). No-op if it equals `source.custom_headers` (compare key-sorted JSON). Otherwise `commitField('headers', { custom_headers: map }, 'headers')`.

**Add form:**
- A `<details>` element with `<summary className="min-h-[44px] …">Advanced: headers for sites that block readers</summary>` holds a `HeadersEditor` whose `onCommit` sets local state.
- `custom_headers` is passed to `api.testSource` (already accepted, api.ts:389-400) and `api.createSource`.
- `friendlyTestError` 'forbidden' (FeedManager.tsx:~171) becomes: "This site blocks automated readers. Open “Advanced” below, tap “Use a browser identity”, then Test again."

---

## 7. YouTube links that won't add (requirement 9)

### Causes found in the code

**Frontend:**
- **F-a. Add and Test stay greyed out with no reason.**
  - `nameError` blocks while the Name field is empty. The user must invent a slug; the hint is the only clue (FeedManager.tsx:1530-1541).
  - `urlError` blocks any input without a scheme (`@mkbhd`, `youtube.com/@mkbhd`, a bare `UC…` id) because of `new URL()` (:1397-1424).
  - Neither error is ever rendered; they only set `disabled` (:1792, :1799).
- **F-b. Errors are hidden.** Every Add failure (`onError`, :1430/:1470), including the backend's 422 "couldn't resolve the YouTube link", goes to App's banner under the Settings sheet. The user sees nothing happen.
- **F-c. Add fetches YouTube twice.** After a successful Test, Add sends the original URL, not `resolvedUrl` (:1446-1458), so YouTube is fetched a second time even though the copy says "Add will use this URL".
- **F-d. Auto feed mishandles YouTube.** `/api/sources/auto` (sources.py:573-644) has no YouTube branch.
  - With the YouTube page served, it creates a `type="rss"` row named `youtube_com`.
  - With a consent page, sitemap discovery may create a generic_scrape row for youtube.com, or report "couldn't find a feed".

**Backend:**
- **B-a. Bot-shaped request.** The page fetch sends `User-Agent: Popping/0.2` (youtube.py:41; config.py:392), no Accept-Language and no consent cookies. Datacenter and EU requests get consent.youtube.com or a bot check, neither of which carries the marker.
- **B-b. One marker only.** Only `"channelId":"UC…"` is searched (youtube.py:38, 106-112).
- **B-c. Feed links don't resolve.** A pasted feed link `feeds/videos.xml?channel_id=UC…` does not match `/channel/` (youtube.py:37). It is fetched as a page, and XML never has the JSON marker.

The live failure could not be reproduced because youtube.com is blocked from this container. The fix is designed so every shape either needs no network or ends with a usable next step.

### Fix, backend (PR 1, backend/app/youtube.py, about 60 changed lines)

1. `_CHANNEL_ID_IN_URL_RE = re.compile(r"(?:/channel/|[?&]channel_id=)(UC[0-9A-Za-z_-]{22})")` replaces `_CHANNEL_ID_DIRECT_RE`, so a feed link resolves with no network.
2. Pure function `channel_id_from_html(html: str) -> str | None`. It tries, in order, first hit wins:
   - the canonical `<link rel="canonical" href="https://www.youtube.com/channel/(UC…)">`;
   - `feeds/videos\.xml\?channel_id=(UC…)` (the RSS alternate link);
   - `"externalId":"(UC…)"`;
   - `<meta itemprop="(identifier|channelId)" content="(UC…)">`;
   - `"channelId":"(UC…)"`.

   `"browseId"` is excluded: on a watch page it can point at another channel.
3. Pure function `is_blocked_page(final_url: str, html: str) -> bool`:
   - the final host ends with `consent.youtube.com` or `consent.google.com`;
   - or the HTML contains `action="https://consent.youtube.com`, `Before you continue to YouTube`, or `confirm you’re not a bot` / `confirm you're not a bot`.
4. The fetch uses `httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True, max_redirects=5, cookies=_CONSENT_COOKIES, transport=_TRANSPORT, event_hooks={"request": [ssrf_event_hook]})`.
   - Keep that event-hook literal exactly (test_youtube.py:58-71).
   - `_TRANSPORT: httpx.AsyncBaseTransport | None = None` is a test seam.
   - Headers: `_BROWSER_HEADERS = {User-Agent: desktop Safari 17.5, Accept: text/html…, Accept-Language: en-US,en;q=0.9}`. `_CONSENT_COOKIES = {"SOCS": "CAI", "CONSENT": "YES+"}`.
   - Pass the cookies on the client, not as a Cookie header, because httpx drops the Cookie header on redirect.
   - Keep the entry check and the final-URL `check_url_safe`.
5. Errors (`YouTubeResolutionError`):
   - Blocked page → `"YouTube didn't let the server look this channel up. Paste the channel ID instead: on the channel page open About (More about this channel) → Share channel → Copy channel ID."`
   - No marker → `"couldn't find a channel on this YouTube page. Paste a channel link, video link, @handle or channel ID (UC…)."`
   - HTTP error → `"couldn't reach YouTube (HTTP 403). Paste the channel ID instead: …"` with the same instruction.

### Fix, routes (PR 1, backend/app/routes/sources.py)

- **/auto:** after `_validate_url` and `_validate_category`, add `if is_youtube_url(body.url):`
  - resolve with `resolve_channel_feed_url` (422 with the message on failure);
  - name from `_youtube_name(original_url, feed_url)`: `@handle`, `/c/x` or `/user/x` gives `x`; otherwise `channel_<last 6 of id, lower-cased>`; slugified to `[a-z0-9_]`, `+ "_yt"` (labels.ts shows `_yt` as " (YouTube)"), then `_free_source_name`;
  - `scheduler.add_source(..., type_="youtube_channel", refresh=_YOUTUBE_DEFAULT_REFRESH)`;
  - `return SourceAutoResult(found=True, kind="youtube_channel", source=…)`. `kind` is `Optional[str]` (schemas.py:142), so no schema change.

### Fix, frontend (PR 4, FeedManager.tsx Add form)

- **`normalizeFeedInput(type, raw)`**, used by `validateForm`, the re-validate `useEffect` (keep `new URL(trimmedUrl)` and the `[name, url, sourceType]` deps; the guard test is at slice15:167-188), `test` and `submit`:
  - trim;
  - for youtube: `^@[\w.-]+$` becomes `https://www.youtube.com/@x`, and `^UC[0-9A-Za-z_-]{22}$` becomes `https://www.youtube.com/channel/UC…`;
  - for every non-reddit type: no `://` but a dot → prefix `https://`.
- **Name is optional:**
  - `suggestName(type, normalizedUrl, existingNames)`: youtube uses the same rule as the backend; reddit gives `r_<sub>`; everything else gives the hostname slug (the same expression as `trackAnyway`, :1175-1186). Dedupe with `_2`, `_3`.
  - Shown as static hint text "Will be saved as: <slug>". Not a `placeholder={…}`.
  - `setNameError(null)` when blank.
  - Label "Name (optional)"; the input gets `autoCapitalize="none" autoCorrect="off" spellCheck={false}`.
- **Render `nameError` and `urlError`** under their fields (`text-ios-caption text-red-300`).
- **Add errors** render in the existing result box (`setTestResult({ kind: 'err', message })`) instead of `onError`.
- **AutoFeedBlock errors** go to `setAutoMessage({ kind: 'err', text })`. The Track-anyway button only appears when the text includes "couldn't find a feed" (:1272-1288), so YouTube errors never offer scraping youtube.com.
- **`submit` reuses the Test result:** `url: testResult?.kind === 'ok' && testResult.resolvedUrl ? testResult.resolvedUrl : normalized`.
- **YouTube copy:**
  - The URL label ternary's youtube branch becomes 'YouTube channel link'. Keep 'Page URL' and the `htmlFor="fm-url"` chain (slice15:197-208).
  - Hint for youtube: "A channel link, video link, @handle or channel ID (UC…)".
  - Keep `type={sourceType === 'reddit' ? 'text' : 'url'}` as is. Note that `type=url` still lets "@x" be typed; only constraint validation is affected, and the form already does `e.preventDefault()` and validates itself. Also add `noValidate` on the `<form>` so the browser never blocks `@handle`.
- **`friendlyTestError` 'invalid_url':** return `raw` alone when present, without the "Invalid URL —" prefix, so the YouTube instructions read cleanly.
- **api.ts:** the `autoAddSource` return `kind` union gains `'youtube_channel'`. The AutoFeed toast then reads "Feed added: <name>".

### Offline tests (PR 1)

backend/tests/test_youtube.py additions; all offline and deterministic:
1. A feed link `…/feeds/videos.xml?channel_id=UC…` resolves to the feed URL. Monkeypatch the fetch to raise if called.
2. `channel_id_from_html` on five saved snippets (one per marker). Plus a precedence test: canonical beats a different `"channelId"`. Plus a watch-page snippet resolves via `"channelId"` and ignores `"browseId"`.
3. `is_blocked_page` for a consent.youtube.com final URL, for the "Before you continue" HTML, and false for a normal page.
4. The fetch path with `monkeypatch.setattr(youtube, "_TRANSPORT", httpx.MockTransport(handler))`, `check_url_safe → (True, "")`, and `ssrf_event_hook` set to an async no-op:
   - the handler asserts the outgoing request's User-Agent does not start with "Popping/", that `Accept-Language` is present, and that the `cookie` header contains `SOCS=CAI`;
   - it returns canonical HTML, and the result is the feed URL.
5. The same with a 302 to `https://consent.youtube.com/m?…` that returns a consent page → `YouTubeResolutionError` whose message contains "channel ID".
6. Route: POST /api/sources/test with `type=youtube_channel` and the transport mocked to the consent page → `ok False`, `error_kind 'invalid_url'`, error contains "channel ID".
7. Route: POST /api/sources/auto with `https://www.youtube.com/@somehandle` and `app.routes.sources.resolve_channel_feed_url` monkeypatched → the created row has `type == 'youtube_channel'`, `name == 'somehandle_yt'`, `refresh_interval_seconds == 21600`.

The existing tests stay unchanged and keep passing, including the network-agnostic non-existent-handle test and the event-hook literal test.

---

## 8. Text overflow: root causes and a guard (requirement 10)

### Root causes, measured at 390 and 320 (shots/analysis.txt, REDESIGN_PLAN §4)

- **R1.** Fixed-width siblings in flex rows where the flexible text child has no `min-w-0`, or everything is `shrink-0`: the search pill `w-44`, the Auto-add input `flex-1` without `min-w-0`, and five `shrink-0` chips on the feed name line.
- **R2.** Missing gutters: the Feeds tab wrapper is `pt-4` while every other tab is `pt-4 px-4` (Settings.tsx:265).
- **R3.** No-wrap rows of controls that each wrap inside themselves: the Card text actions and the meta row.
- **R4.** A 112px thumbnail beside a headline on a 250-330px card (Card.tsx:905, 1734).
- **R5.** Controls authored at 13px and forced to 16px (styles.css:24-26). Fixed by authoring controls at 17px; see C5.
- **R6.** Page Zoom or Larger Text at 125% turns a 390 phone into roughly 312 CSS px, so 320 is the design floor.

### Fixes, by PR

**PR 2:**
- **App.tsx:2220-2262 search row (R1; body 336px at 320):**
  - h1 gets `${searchOpen ? 'hidden sm:block' : ''}`;
  - the cluster div gets `${searchOpen ? 'flex-1 min-w-0 justify-end sm:flex-none' : ''}`;
  - the search pill `w-44 sm:w-72` becomes `flex-1 min-w-0 sm:flex-none sm:w-72`;
  - the refresh icon gets `${searchOpen ? 'hidden' : ''}`;
  - the search clear ✕ becomes `w-11 h-11 -mr-3 flex items-center justify-center shrink-0`;
  - the input `type="search"` becomes `type="text" inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"`, which also removes the double clear button (audit 13).
- **Card.tsx:905 (R4):** title row `items-center` becomes `items-start`. Thumbnail (Card.tsx:1734) `w-28 sm:w-40 aspect-video` becomes `w-16 aspect-square sm:w-40 sm:aspect-video`. This is the Apollo-style compact square.
- **Card.tsx:957-963 meta (R3):** source span `min-w-0 truncate`; dot and `<time>` `shrink-0 whitespace-nowrap`.
- **Card.tsx ~977-1135 text actions (R3):**
  - rows become `flex flex-wrap items-center gap-x-3 gap-y-1`;
  - each action gets `whitespace-nowrap hit-44`;
  - keep `data-card-interactive` and the stopPropagation handlers.
- **Card.tsx:1174:** 9px tone chip becomes `text-[11px]`.
- **App.tsx:2709:** 10px badge becomes `text-[11px]`.
- **Settings.tsx:211-222 header:** Done `min-h-[44px] min-w-[44px] shrink-0`; h2 `min-w-0 truncate` and always "Settings" (the tab strip already shows the tab).
- **Settings.tsx:265:** `pt-4 px-4`.
- **Settings.tsx:263 and Drawer.tsx:334:** add `overscroll-contain`.
- **Drawer.tsx:316-319:** Done `min-h-[44px] min-w-[44px]`.
- **FeedManager.tsx:264-287 TabButton (R1):**
  - `flex-1 min-w-0 min-h-[44px] px-2 rounded-ios text-ios-caption font-semibold whitespace-nowrap truncate`;
  - labels "My feeds (N)", "Suggested", "Add a feed" (about 275px at 13px semibold, fits 288);
  - `aria-label="feed manager tabs"` is kept.
- **FeedManager.tsx:1245-1258 Auto feed input (R1):**
  - `flex-1 min-w-0 min-h-[44px] px-3 text-ios-body`, `type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"`;
  - placeholder literal unchanged; button `min-h-[44px]`.
- **FeedManager.tsx:695-786 (R1):** move the auto-disabled/paused/⚠/score chips from the name line to the caption line. Category chip and caption: `text-[11px]` becomes `text-ios-caption`.
- **Toast.tsx:122:** `truncate` becomes `line-clamp-3 break-words`. **Toast.tsx:89-96:** errors stay 4000 ms.
- **styles.css** `@layer utilities` gains `.hit-44`: `position: relative`, plus `::after` with `content: ''`, `position: absolute`, `left: 50%`, `top: 50%`, `width: max(100%, 44px)`, `height: max(100%, 44px)`, `transform: translate(-50%, -50%)`. This gives a 44px hit area without changing the look. Do not use it on elements that are already positioned, or inside `overflow-hidden` that would clip the area.

**PR 4:** the editor and Add form controls, all `min-h-[44px] text-ios-body`, as above.

### The guard: `frontend/scripts/iphone-audit/smoke.cjs` (new, CommonJS)

**Setup:**
- Reuses `mockApi` and `IOS_UA` from capture.cjs (capture.cjs:560).
- Usage: `node smoke.cjs <base> [--csp] [--strict]`.
- For each width (390×844@3 and 320×568@2) and each state, open a fresh context (`isMobile`, `hasTouch`, IOS_UA, dark). Long sessions with `setViewportSize` gave false `pointer:coarse` readings.
- Steps per state: `mockApi(ctx)` → goto → wait for `main.md\:hidden article[data-card-id]` → setup → wait 400 ms → checks → screenshot to `scripts/iphone-audit/out/` (gitignored).

**States:**
1. dashboard
2. search open, typed "x"
3. Menu open
4. Settings → Feeds
5. feed editor via `?view=settings&tab=feeds&source=<fixture id>`
6. editor with "New category…"
7. editor with two header rows
8. Add a feed with YouTube selected and a long name
9. Settings → AI with Edit open
10. notifications, history, hidden, starred, voted, reset (via URL)
11. column ⋯ popover (from PR 5)

**Checks. A failure exits 1 and prints width, state, selector, rect and text:**
- **C1 harness:** `matchMedia('(pointer: coarse)').matches === true`.
- **C2 page width:** `document.body.scrollWidth` and `#root.scrollWidth` are at most `innerWidth`. `html` is clipped by `overflow-x: clip` (styles.css:36), so checking it alone misses overflow.
- **C3 viewport escape:** every visible element (has client rects, `visibility != hidden`, `opacity > 0`) has `rect.left >= -1` and `rect.right <= innerWidth + 1`. Skip:
  - descendants of `[aria-hidden="true"]`;
  - descendants of the closed Drawer (its `aside[aria-label="menu"]` rect starts at or beyond `innerWidth`);
  - descendants of an ancestor whose computed `overflow-x` is auto, scroll, hidden or clip, other than body and html. Clipped content does not show.

  Negative-margin action rows stay inside the card padding and pass.
- **C4 visible text overflow:** for block or flex elements with their own non-empty text nodes and computed `overflow-x: visible`: fail if `scrollWidth > clientWidth + 1` and `text-overflow` is not `ellipsis`. Plus an explicit assertion: at 320, on the dashboard, the h1 "Popping" is not truncated (`scrollWidth <= clientWidth`).
- **C5 authored control size (strict, from PR 5):**
  - delete the coarse-pointer rule through CSSOM: find the `CSSMediaRule` whose `conditionText` contains `pointer: coarse` and the inner rule `input, textarea, select`, then `deleteRule`;
  - then every visible input, select and textarea must compute a font-size of at least 16.

  This measures real sizes, so the backstop rule can never hide a regression.
- **C6 tap targets (strict, from PR 5):** inside `[role="dialog"]`, `aside[aria-label="menu"]`, `header`, `[role="tablist"]` and `[role="status"] button`:
  - every visible `button`, `a[href]`, `select`, `[role=button]` and `[role=tab]` has `max(rect.height, ::after height)` of at least 44;
  - checkboxes and radios are measured on `closest('label')`.
- **C7 runtime:** fail on any `pageerror`, any console error other than the known `/auth/me` 404, and any `!! UNMOCKED` request.
- **C8 CSP (`--csp`, preview only):**
  - route `**/*` documents (`request.resourceType() === 'document'`) through `route.fetch()` + `route.fulfill({ response, headers: { ...h, 'content-security-policy': CSP } })`;
  - `CSP` is read at runtime from frontend/nginx.conf.template:29 by regex, so it cannot drift;
  - fail on any console text containing `Refused to`.

C1-C4, C7 and C8 fail from PR 2. C5 and C6 print warnings until PR 5 turns on `--strict`.

**Fix existing scripts in PR 2:**
- **run.sh:13-15:** `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &`. Calling the binary directly makes `$!` the server, so the trap kills it and no orphan is left.
- **capture.cjs:53:** anchor the mock route on the pathname with `ctx.route((u) => /^\/(api|auth|assets)\//.test(u.pathname), …)`.
- **README.md:** document smoke.cjs.
- **capture.cjs/probe.cjs selectors:** updated in PR 3 and PR 4 where the UI changes: 'open settings' → Menu → Settings; 'edit refresh interval' and `edit ${name}` go away; the textarea goes away.

**CI** (.github/workflows/build.yml, `frontend-checks`, after `npm run build`, one step):

```yaml
      - name: iPhone layout smoke test
        run: |
          npm install --no-save playwright@1.56.1
          npx playwright install --with-deps chromium
          ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
          for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 0.5; done
          node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp
```

- `--no-save` leaves package.json, the lockfile, the Docker build stage and dependabot untouched.
- Locally, global Playwright 1.56.1 resolves through NODE_PATH with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Never run `npx playwright install` in the container.

---

## 9. iPhone and ease-of-use checklist (requirements 6 and 7)

Each item is re-checked at its file before editing. "PR" says where it lands.

| # | Problem (file:line) | Fix | PR |
|---|---|---|---|
| 1 | Feeds tab has no side margin (Settings.tsx:265) | `px-4` | 2 |
| 2 | Search open overflows at 320; title shows "P…" (App.tsx:2220-2262) | §8 | 2 |
| 3 | Thumbnail squeezes the headline (Card.tsx:905, 1734) | 64px square below sm | 2 |
| 4 | Time stamp wraps (Card.tsx:957-963) | §8 | 2 |
| 5 | Card text actions wrap mid-phrase and are 18px tall (Card.tsx:977-1135) | flex-wrap + `hit-44` | 2 |
| 6 | Auto-add button 49px off-screen at 320 (FeedManager.tsx:1245-1266) | `min-w-0`, URL keyboard, 44px | 2 |
| 7 | Feed names clipped by chips (FeedManager.tsx:695-786) | chips to the caption line | 2 |
| 8 | Title clipped at 320 at rest (App.tsx:2220) | gear removal | 3 |
| 9 | "Settings → X" wraps; Done 32px (Settings.tsx:211-222; Drawer.tsx:316) | §8 | 2 |
| 10 | Sub-tab pills wrap (FeedManager.tsx:264-287) | §8 | 2 |
| 11 | 9-11px text (Card.tsx:1174; App.tsx:2709; FeedManager.tsx:576-650, 712, 784, 1114) | 11px minimum for decoration, 13px for anything read | 2, 4 |
| 12 | Native search clear plus app clear (App.tsx:2235) | `type="text" inputMode="search"` | 2 |
| 13 | Toast cut to one line, 1.5 s (Toast.tsx:89-96, 122) | 3 lines; errors 4 s | 2 |
| 14 | Scroll chains behind sheets (Settings.tsx:263; Drawer.tsx:334) | `overscroll-contain` | 2 |
| 15 | Gear + Menu + "All settings…" (App.tsx:2298-2333; Drawer.tsx:377-390) | §3 | 3 |
| 16 | Jump to column does nothing (App.tsx:2022-2030, 2598) | `setMobileCol` + boxed scroll target | 3 |
| 17 | No sign-out on the phone (App.tsx:2363) | Menu row | 3 |
| 18 | Done re-pushes history; Back reopens Settings (App.tsx:438-444; Settings.tsx:241) | §3 | 3 |
| 19 | Raw category in the Menu (Drawer.tsx:415, 477) | `sourceLabel`/`categoryLabel` | 3 |
| 20 | Drawer grabber under the status bar (Drawer.tsx:303-306) | safe-area top | 3 |
| 21 | Category is a blank text box on iOS (FeedManager.tsx:602-618) | §5 | 4 |
| 22 | Tiny "save" link; nothing autosaves (FeedManager.tsx:508-565, 656-670) | §4 | 4 |
| 23 | JSON headers (FeedManager.tsx:630-655) | §6 | 4 |
| 24 | Editor errors hidden under the sheet (App.tsx:2397-2411, 2839) | toast or inline | 4 |
| 25 | "refreshed" toast every minute (App.tsx:1112, 1247-1249) | `silent` | 4 |
| 26 | Re-seed overwrites edits on poll (FeedManager.tsx:465-475) | §4.2 | 4 |
| 27 | `rfd_hot_deals` missing from built-ins (FeedManager.tsx:108-115) | add + guard test | 4 |
| 28 | Delete confirm expires after 4 s (FeedManager.tsx:379, 433-437) | no timer | 4 |
| 29 | Feed errors only in tooltips (FeedManager.tsx:704-754) | "Last problem" line | 4 |
| 30 | Auto-capitalise and autocorrect on name, URL, subreddit, category fields (FeedManager.tsx:577, 605, 1245, 1532, 1655) | attributes | 2, 4 |
| 31 | Add disabled with no reason; must invent a slug (FeedManager.tsx:1397-1424, 1530-1541) | §7 | 4 |
| 32 | "Advanced → Custom headers" doesn't exist (FeedManager.tsx:~171) | §6 | 4 |
| 33 | Recommended shows raw slugs; 28px buttons (FeedManager.tsx:1069-1127) | labels + 44px | 4 |
| 34 | Keyboard covers lower fields (Settings.tsx:204, 263) | visualViewport inset | 4 |
| 35 | Interval picker shows the wrong value for non-preset intervals (FeedManager.tsx:825-837) | current-value option | 4 |
| 36 | Login username auto-capitalises (LoginPage.tsx:72-78) | `autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"` | 5 |
| 37 | Column header tap silently marks all read (Column.tsx:314-324) | header click only when `matchMedia('(hover: hover)')`; a 44px "Mark all as read" button first in the ⋯ popover (Column.tsx:411), inside `popoverRef` | 5 |
| 38 | Column popover won't close on tap (Column.tsx:237-246) | also listen to `touchstart` | 5 |
| 39 | Card swipe lags the finger (Card.tsx:513) | `el.style.transition = animate ? 'transform 180ms ease-out' : 'none'` | 5 |
| 40 | Long-press copy fights the iOS link preview (Card.tsx:585-593) | don't arm the timer when the touch starts inside an `<a>` | 5 |
| 41 | `window.confirm` for reset (Settings.tsx:413) | inline two-tap | 5 |
| 42 | `window.prompt` for Save current view (App.tsx:2826) | inline name field in the Menu row (16px+ input, Save 44px) | 5 |
| 43 | `z-15` emits no CSS (App.tsx:2401) | `z-10` | 5 |
| 44 | Selects look like text boxes (Settings.tsx:776, 812, 855; Column.tsx:418, 462) | `.select-ios` chevron class (styles.css components layer, data-URI SVG) | 5 (4 for FeedManager) |
| 45 | Sub-44px links (Settings.tsx:346, 765, 831, 910, 1230, 1238, 1406, 1450; BriefCard.tsx:312; App.tsx:282-374, 2380-2393, 2404-2410, 2677, 2703) | `min-h-[44px]` or `hit-44`; Settings tab pills `min-h-[44px]` | 5 |
| 46 | Empty states say right-click or press keys (Settings.tsx:1526, 1598, 1683) | "Tap the eye / star / ▼ on a card" | 5 |
| 47 | Literal "◯ with strike" (Settings.tsx:1110, 1165) | eye-off icon from TabIcon (Settings.tsx:479-487) | 5 |
| 48 | Hidden and Saved titles are one line (Settings.tsx:1436) | `line-clamp-2` | 5 |
| 49 | Hide toast says "moved to history" (App.tsx:1615) | "Hidden." (same as :2452) | 5 |
| 50 | Saved "Clear all" with no undo (App.tsx:2860-2864) | Undo toast restoring the previous array | 5 |
| 51 | Raw "500 … for /api/…" errors (api.ts:284) | plain message per status; raw text in `console.warn` (FeedManager's `parseApiError` reads `detail` first, so it is unaffected) | 5 |
| 52 | Developer copy: Column.tsx:836 "Feed Manager", Column.tsx:824 / App.tsx:2495 "scheduler", Column.tsx:425 "Top (composite score)", UserBadge.tsx:37 "(local bypass)", Card.tsx:1392 "(s)" should be "(b)" | plain wording | 5 |
| 53 | Brief first-run header doesn't wrap (BriefCard.tsx:562) | `flex-wrap` | 5 |
| 54 | Strict guard C5 and C6 | turn on `--strict` in CI | 5 |

**Deferred, with reasons:**
- **Landscape uses the desktop grid** (`md:` at App.tsx:2594/2655, FramingWatch.tsx:175). The fix changes the breakpoint everywhere and touches iPads. Add it to the on-phone checks and do it as its own PR if the owner hits it.
- **Side safe areas in landscape:** same PR as landscape.
- **Remember the phone tab by name** (App.tsx:1358-1366): changes storage semantics; the existing clamp keeps it safe.
- **Regroup the 8 Settings tabs:** a structural change to the URL allow-list for little gain.
- **AI tab model picker** and the Notifications ".env" copy: need per-provider model lists from the backend.
- **Persist brief tone** (App.tsx:457): 7 edits in preferences.tsx.
- **Report preference sync failures** (preferences.tsx:527-627): needs a retry design.
- **Make the "+N new" chip not refresh:** the behaviour is unclear and it is not a phone defect.
- **Drawer `inert` when closed:** an accessibility issue only, and React 18 has no `inert` typing.
- **`100dvh` vs `100%`** (App.tsx:2188): no effect in the home-screen app.
- **Thumbnail as a link, OIDC from the home screen:** low impact.
- **Preset rename `window.prompt`** (App.tsx:306): rare, and it works.
- **Optional `YOUTUBE_API_KEY`:** only if the post-deploy @handle check fails; it adds a secret and a new outbound host.
- **Deleting the coarse-pointer 16px rule:** kept as a backstop. C5 measures the real sizes with the rule removed, so it masks nothing.

---

## 10. Small backend changes (PR 1, backend/app/routes/sources.py)

1. **Reddit Test** (sources.py:1008-1009): replace with `from app.reddit_client import fetch_subreddit` and `from app.sources.reddit import normalize_subreddit`.
   - `slug = normalize_subreddit(url)`; `items = await fetch_subreddit(slug, listing="hot", limit=25) if slug else []`.
   - If `not items`, return `SourceTestResult(resolved_url=resolved_url, ok=False, error_kind="not_found", error="couldn't read that subreddit")`. `fetch_subreddit` returns `[]` on any failure (reddit_client.py:677-700).
2. **Header names:** in `_validate_custom_headers` (sources.py:325-334), after the type check, `if not _HEADER_NAME_RE.fullmatch(k): 422 f"header name {k!r} must be letters, numbers or - (no spaces)"`, with `_HEADER_NAME_RE = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")`.
3. **Strip the category:** `_validate_category` returns `stripped`. POST (:469), /auto (:608) and PATCH (:752) assign the result (`body.category = _validate_category(body.category)`) before persisting (:518, :617, :779).

The scheduler, schemas and config are unchanged.

---

## 11. Implementation sequence

Every PR is branched from up-to-date main, opened as a draft PR to main (CI runs only for base main, build.yml:14-18), and gets the §12 recipe before push. Merge only when all four check runs are green. Poll them with `gh api repos/adamjmachill/popping/commits/<sha>/check-runs`; `gh pr view` hits a GraphQL 403.

### PR 1. Backend: YouTube, reddit Test, header names, category strip

**Files:** backend/app/youtube.py, backend/app/routes/sources.py, backend/tests/test_youtube.py, backend/tests/test_sources_contract.py (new).

**Steps:**
1. The youtube.py refactor (§7).
2. The /auto YouTube branch.
3. §10 items 1-3.
4. Tests, all route-level via `app_client` (conftest.py:198), in test_sources_contract.py:
   - POST and PATCH reject a header name "Bad Header", "" and "Cookie";
   - accept "X-Ok";
   - a value with `\r\n` → 422;
   - 21 headers → 422;
   - category `" tech "` is stored as `"tech"`;
   - category of 41 characters → 422;
   - PATCH name on `rfd_hot_deals` → 400 (the registry row needs the plugin row; create it as the fixture pattern does);
   - a name collision → 409;
   - reddit Test with `app.reddit_client.fetch_subreddit` monkeypatched to `[{"title": "x"}]` → `ok`, `item_count 1`; to `[]` → `ok False`, `error_kind 'not_found'`.

**Acceptance:**
- `pytest -ra` passes locally (§12) and in CI. The new YouTube tests pass with no network.
- `git diff --name-only` shows only the 4 files.
- The security-review skill reports no new outbound host and no SSRF regression.
- `event_hooks={"request": [ssrf_event_hook]}` is still literally present.

### PR 2. Overflow root causes and the layout guard

**Files:** frontend/scripts/iphone-audit/{smoke.cjs (new), run.sh, capture.cjs, README.md}, frontend/src/styles.css, App.tsx (search row, badge size), components/Card.tsx, Settings.tsx (header, Done, gutter, overscroll), Drawer.tsx (Done, overscroll), FeedManager.tsx (class-only items 6, 7, 10 and the row text sizes), Toast.tsx, .github/workflows/build.yml (one step).

**Steps:**
1. Write smoke.cjs and confirm it fails today. Expected: C2 at 320 search, C3 Auto-add at 320, C4 on feed rows and pills.
2. Apply the §8 PR 2 fixes.
3. Re-run until green at 390 and 320.
4. Look at every PNG.
5. Add the CI step.

**Acceptance:**
- smoke exits 0 locally and in CI. C5 and C6 print warnings only.
- Self-test: temporarily adding `w-[500px]` to the h1 makes smoke exit 1 on C2/C3; reverted, it passes. Record this in the PR body.
- `npm run lint` shows 0 errors and the 6 baseline warnings. `npm run build` passes.
- `pytest -m no_db` passes (FeedManager literals intact).
- The h1 is not truncated at 320 on the dashboard.

### PR 3. One Menu button, Settings history, focus links

**Files:** App.tsx, components/Drawer.tsx, Settings.tsx, FeedManager.tsx (lift `open` to `openRowId`, `focusSourceId`, row ids), frontend/scripts/iphone-audit/{capture.cjs, probe.cjs, smoke.cjs} selectors.

**Steps:** §3, in order:
1. Remove the gear and fix the comments.
2. Drawer: rows, sign-out, › buttons, Clear, grabber, labels, dead prop.
3. `jumpToCategory`.
4. Focus param and `openSettings(tab, id)`.
5. `closeSettings` with `history.back()`; tab `replaceState` keeps state and drops `source`.
6. `SETTINGS_TABS`.
7. FeedManager `openRowId` and scroll.
8. Add smoke states: Menu → Settings; Menu → › opens the editor row.

**Acceptance:**
- The top bar has exactly title, search, refresh (phone) and Menu. The DOM has no `aria-label="open settings"`.
- Menu → Settings opens Feeds. Menu → › opens that row expanded and in view.
- In Playwright, Done then `page.goBack()` does not reopen Settings, and `history.length` grows by 1 per open/close cycle at most.
- Jump to column switches the phone tab.
- Sign out shows only with a mocked user.
- Smoke is green. No dead props (`grep -n onResetLocalState frontend/src/components/Drawer.tsx` is empty).

### PR 4. Autosaving editor, category picker, headers editor, Add form, YouTube frontend

**Files:** FeedManager.tsx, Settings.tsx (reportError, `onSourceUpdated` prop, keyboard inset), App.tsx (`onSourceUpdated`, epoch guard, `refresh({ silent })`, `onRefreshSources`), api.ts (`autoAddSource` kind union; the `updateSource` comment says null clears), backend/tests/test_frontend_feed_editor_rules.py (new, no_db), frontend/scripts/iphone-audit/smoke.cjs (editor states plus behaviour checks).

**Steps:**
1. App wiring (silent refresh, `onSourceUpdated`, epoch).
2. Settings wiring.
3. `enqueuePatch` + FeedEditor + SourceRow slimming.
4. CategoryPicker.
5. HeadersEditor.
6. Add form (§7 frontend, picker, headers, inline errors, name optional, resolved URL).
7. Recommended labels and 44px.
8. Delete the old form, JSON code and timer.
9. Guard test.
10. Smoke behaviour checks.

**The guard test** (test_frontend_feed_editor_rules.py, `@pytest.mark.no_db`):
- the quoted names in FeedManager.tsx's `KNOWN_BUILT_INS` equal `set(registered_plugin_names())`;
- every entry of `_HEADER_DENYLIST_ALL` appears quoted inside the `HEADER_DENYLIST` literal;
- `CATEGORY_MAX = 40` equals `_CATEGORY_MAX`; `HEADERS_MAX = 20` and `HEADER_VALUE_MAX = 512` match;
- `RESERVED_CATEGORIES` contains 'saved' and 'for you';
- `<datalist` and `custom headers (JSON)` are absent.

**Acceptance (Playwright against the mocked API; count `request` events with `method() === 'PATCH'`):**
- Changing the category sends exactly 1 PATCH with body `{"category":"tech"}`. "Saved ✓" appears.
- Typing 10 characters into Address then blurring sends 1 PATCH. Typing without blurring sends 0.
- `page.route('**/api/sources/<id>', 422 {detail: "category 'x' is reserved for a built-in column"})` shows that text under Category and puts the picker back.
- `route.abort('failed')` on the Address save shows "Couldn't reach the server." and Try again; typed text is kept.
- Typing a URL and closing Settings immediately sends 1 PATCH. With that PATCH aborted, a red toast is visible on the dashboard.
- Two category changes in quick succession arrive in order. The final DOM and App state show the second value.
- Built-in rows have disabled Name and Address and no Headers. Reddit rows have no Headers.
- "Use a browser identity" sends 1 PATCH with a `User-Agent` key. A `Cookie` header name shows an error and sends 0 PATCHes.
- On the YouTube Add tab, `@handle` enables Test/Add with the name blank. Add after a successful Test posts the `resolved_url`.
- No "refreshed" toast during a 65 s idle window. Use a fake clock, or set REFRESH_INTERVAL via the mock timing.
- `pytest -m no_db` passes, including slice15 and sitemap guards: the first `placeholder={` is still the fm-url ternary.
- Smoke is green at 390 and 320 with the editor open, in new-category mode and with two header rows.

### PR 5. Remaining sweep and strict guard

**Files:** App.tsx, Card.tsx, Column.tsx, Settings.tsx, Drawer.tsx, LoginPage.tsx, BriefCard.tsx, styles.css, api.ts, smoke.cjs (`--strict` on, column popover state), .github/workflows/build.yml (add `--strict` to the same step).

**Steps:** checklist items 36-54.

**Acceptance:**
- Smoke `--strict` is green: every visible control is authored at 16px or more, and every scoped target is 44px or more.
- Each checklist item is listed in the PR body as fixed with file:line, or struck with a reason.
- No `window.prompt` / `window.confirm` remain except App.tsx:306 (deferred). Check with `grep -rn "window.confirm\|window.prompt" frontend/src`.

---

## 12. Verification recipe (container)

```bash
cd /home/user/popping/frontend && npm ci
npm run lint            # 0 errors; baseline 6 warnings
npm run build           # prebuild comment check + tsc + vite
F=$PWD; OUT=/tmp/claude-0/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/scratchpad/smoke; mkdir -p $OUT
$F/node_modules/.bin/vite preview $F --host 127.0.0.1 --port 4173 --strictPort > $OUT/preview.log 2>&1 &
P=$!; until curl -sf -o /dev/null http://127.0.0.1:4173/; do sleep 0.5; done
node scripts/iphone-audit/smoke.cjs http://127.0.0.1:4173 --csp; echo exit=$?
kill $P
```

Backend (optional locally; CI is the authority). Verified in this container: 623 passed in 24.7 s.
1. Install pgvector (`apt-get install -y postgresql-16-pgvector`, or a source build of v0.8.7).
2. `initdb` and `pg_ctl` as postgres on `/var/lib/postgresql/popping-test`.
3. Create user and database `popping_test`, then `CREATE EXTENSION vector`.
4. Add /etc/hosts entries for example.com, example.org, example.net and reddit.com. The SSRF guard resolves names (url_safety.py:150) and the container has no DNS.
5. `uv venv --python 3.12` and `uv pip install --no-deps -r backend/requirements-dev.lock`.
6. `PYTHONPATH=$PWD python -m pytest -m no_db -q`, then `-ra`.

On-phone checks after popping-update (owner, 2 minutes):
- ≡ → › on a feed → change the category: no Save, the feed moves column.
- Add a YouTube channel by @handle. If it fails, paste the channel ID.
- Open search at your normal text size: nothing runs off the screen.
- Tap a text field: no zoom.
- Rotate to landscape: you get the desktop layout. That is known and deferred; report it if it bothers you.

---

## 13. Risks and mitigations

- **Source-text guard tests break CI.**
  - `test_url_placeholder_uses_generic_scrape_specific_text` reads the first `placeholder={`. Mitigation: only string-literal placeholders in new code.
  - The useEffect regex needs `[name, url, sourceType]` deps and `new URL(trimmedUrl)` inside. Keep both.
  - Keep `trackAnyway`'s body, the radio markup, "Track page (no RSS)", "couldn't find a feed" / "Track this URL anyway", `setSitemapUrl` / `setLinkPattern`, `{sourceType === 'generic_scrape' && (`, and `sitemap_url: ` / `link_pattern: ` in `createSource`.
  - Run `pytest -m no_db` (4 s) before every push.
- **iOS blur ordering.** Commits run on blur plus an unmount flush with `lastSentRef` dedupe. Residual: an edit is lost if iOS kills the app while a field is focused. Accepted; it is how any iOS form behaves.
- **Stale poll overwrites a save:** epoch guard. **The PATCH response zeroes the vote score:** keep the old score.
- **Every effective PATCH triggers an immediate fetch** (scheduler.py:2455-2461): one PATCH per commit; the header preset sends one PATCH. Each costs one fetch and nothing more.
- **Rename while a filter is active:** `onSourceRenamed` with the name at commit time. **Check now or Delete during a rename:** both await the chain and use `nameRef`.
- **Category change shifts phone tab indexes:** clamped by the existing effect; name-based tabs are deferred.
- **`history.back()`** is only used when the `{ popping: 'settings' }` state is present, so it can never leave the app. Tab switches keep the state.
- **YouTube may still block the VPS IP:** the message names the fix, and pasting a channel ID or feed link needs no YouTube page fetch. The API key fallback is ready to add if needed.
- **Playwright version drift in CI:** pinned with `--no-save`. Locally, global 1.56.1 matches chromium-1194. No dependabot exposure, because package.json is not touched.
- **Guard false positives:** checks against the viewport and clipped ancestors, and a fresh context per state. False negatives: Chromium uses Inter instead of SF Pro and reports a zero safe-area inset. That is why the on-phone checks exist.
- **`.hit-44` overlap:** vertically adjacent hit areas can overlap by a few pixels. Use it only on inline text actions and chips, never inside `overflow-hidden`.
- **The Column header change for touch only** (item 37) keeps desktop click-to-mark-read via the `(hover: hover)` check, so there is no desktop regression.
- **FeedManager.tsx stays large** (about 1,850 lines after the change). This is the price of minimal churn and keeping the guard tests valid. Splitting it into files is a later refactor that would require rewriting those tests.

## 14. Constraints honoured

- **URL-driven Settings** (`?view=settings&tab=`, plus optional `source`) with the popstate sync. All entry points go through `openSettings`.
- **Esc capture listeners** unchanged. **z-order** unchanged: header z-20 < Drawer z-30/40 < Settings z-50 = Toast z-50, with Toast last in the DOM.
- **Drawer focus trap:** `aria-label="close menu"` is kept. **Hamburger:** `aria-label="open menu"` is kept.
- **Built-in locks:** name and address are locked for the 7 registry names, with a guard test. Built-ins can still be paused, re-categorised, re-intervaled and deleted.
- **Reserved categories** 'saved' / 'for you', the 40-character limit, and case-preserving storage (new categories are lower-cased by the client).
- **`custom_headers` contract:** omit = untouched, null = clear, object = replace. Denylist and limits mirrored on the client; the backend stays the authority.
- **Single-process backend:** no new tasks, jobs or processes. The /auto YouTube branch is synchronous like the existing branches.
- **Design tokens:** `text-ios-body` 17px for controls, `text-ios-caption` 13px for labels, `min-h-[44px]`, hairlines, accent #0a84ff, `rounded-ios`. No new tokens. One CSS utility (`.hit-44`) and one component class (`.select-ios`).
- **PR #11 fixes preserved:** viewport-fit=cover without maximum-scale, the sheet pinned by its top edge with the safe-area inset, the safe-area bottom padding, and the 16px coarse-pointer rule as a backstop.


### Popping on iPhone: one Menu sheet, a feed page that saves itself, YouTube that adds, text that fits (iOS-first design)

Key decisions:
- One top-bar button: the hamburger (aria-label 'open menu') opens a single Menu sheet with iOS-Settings-style push navigation. The gear (App.tsx:2305-2331), the phone refresh icon (App.tsx:2290-2297), Drawer.tsx (with 'All settings…' and Jump to column), and the Settings container with its 8-pill tab strip (Settings.tsx:182-262) are all deleted. Settings tab bodies become pushed pages through an exported SettingsPageBody.
- The URL stays the source of truth with the same param names. ?view=settings is the Menu root, &tab= is level 1 (existing ids plus a new 'filter'), &page=feed-<id>|add|suggested is level 2, and &pick=category is level 3. One SHEET_PAGES constant in lib/sheetRoute.ts replaces the three duplicated allow-lists.
- History depth is stored in history.state.poppingSheet. Back calls history.back() when depth > 1 and replaceState otherwise. Close calls history.go(-n). Opening at a feed from a card pushes the real chain (root, feeds, feed). This fixes 'Done pushes, Back reopens' (App.tsx:438-444).
- Fastest edit path: the source label in every card's meta row (Card.tsx:961) becomes a 44pt button that opens that feed's page. Category is 3 taps from the dashboard, Pause 2, 'Use a Browser Identity' 2. The draft's 'card options menu' does not exist on touch.
- Autosave has no time-based debounce, because every effective PATCH triggers an immediate fetch (scheduler.py:2455-2461). Text commits on blur or Return, pickers and switches on change, and the headers group when focus leaves the group. Pending drafts are flushed on page pop, sheet close, visibilitychange and pagehide, using fetch keepalive.
- Per-source FIFO queue with one PATCH in flight. Same-field commits coalesce and the last write wins. Different fields are never merged, so errors map to the field. Network errors retry once after 2s. The store is a module singleton, so in-flight saves survive page unmounts. A failure after the user has left the page shows an error toast with an 'Open' action.
- Rollback differs by control type. Discrete controls snap back to the saved value with a red caption. Text fields keep the user's draft, with the plain-language reason and Undo. Saved feedback is a spinner, then a check that fades after 1.2s, plus an aria-live announcement. Editor errors never go to the dashboard banner hidden under the sheet.
- App applies the PATCH response but keeps the previous net_vote_score, because PATCH returns 0 (sources.py:398-403). An overlay of local writes and deletes (by timestamp versus each poll's start time) stops stale polls from undoing saved edits.
- Category picker is a pushed checkmark list. It shows your categories with feed counts, then unused suggestions, then a 'New Category' input row, and auto-returns after a pick. New names are matched case-insensitively to existing ones and stored as typed, not lowercased, so categoryLabel keeps 'NHL'. The backend now stores the normalized value.
- Headers are iOS-style rows: a red minus button, a Name input and a Value input, plus Add Header and two presets (Use a Browser Identity, Prefer English). The client mirrors the backend deny-list and limits, adds a token rule and normalizes smart punctuation, and sends the whole map or null. The section shows only for rss, podcast, youtube_channel and generic_scrape feeds that are not built-in. A one-tap browser-identity fix appears wherever a 403 is shown.
- Corrects the draft's job-rebuild rule. Only a category-only PATCH may skip the job rebuild. Headers and name changes must rebuild, because the job holds a plugin built from the row (args=[plugin], and dynamic_rss.py:71 reads _source_row.custom_headers).
- The feed page uses Refresh Now (POST /api/ingest/{name}) instead of Test. Test on an existing feed returns name_conflict, rejects built-in types, ignores headers for generic_scrape, and is broken for reddit. Test stays on the Add page only.
- Add flow: one paste field that classifies the link. YouTube links and bare UC ids go to /api/sources/auto, which gains YouTube support. Reddit and Apple Podcasts links open the manual form with the type preset. A successful add lands on the new feed's page. AddCustomTab and AutoFeedBlock stay in FeedManager.tsx, so the backend source-text guard tests pass unchanged.
- YouTube resolution, in order. Shapes that carry the id resolve with no network: bare UC id, feeds/videos.xml?channel_id=, /channel/, and scheme-less paste. Other shapes use the optional YOUTUBE_API_KEY first, then a page fetch with browser headers and domain-scoped consent cookies through the existing SSRF guard, with a 3MB cap. Seven ordered markers are tried (browseId is excluded). The consent wall and bot checks are detected. Errors are plain and teach the user to copy the channel ID. The key and raw exception text are never shown.
- YouTube tests run fully offline. httpx.AsyncClient is monkeypatched with MockTransport, and app.url_safety.socket.getaddrinfo is patched, so the real SSRF guard stays in the path. Tests cover every shape, every marker, the consent redirect with and without an API key, a private-IP redirect, the body cap, and that the key never leaks.
- Overflow is fixed at the root by a written layout contract enforced through ui primitives. The contract covers min-w-0 text, shrink-0 siblings, no fixed widths beside text, wrapping control rows, one 16px gutter, token-only type, and controls at least 16px by construction. The !important 16px override is replaced by a non-important max(1em,16px) base rule. Below sm the card thumbnail moves above the headline.
- Overflow guard: frontend/scripts/iphone-audit/guard.cjs exits non-zero on document overflow (body and #root, not only html), controls off-screen, text cut by a clipping ancestor without ellipsis, fields under 16px, a non-coarse pointer, page errors or unmocked requests, and (from PR 3) tap targets under 44pt in the sheet and header. It runs at 320 and 390 in fresh contexts, and in CI through one build.yml step that installs playwright@1.56.1 with --no-save, so there are no package.json or Docker changes.
- iOS keyboard handling: the sheet follows window.visualViewport, both top and bottom, and scrolls the focused field into view. Sheet gestures are swipe-down on the grabber and nav bar strip only. Pull-to-refresh uses WebKit's native rubber-band (scrollTop <= -64, no preventDefault) and replaces the refresh icon. The search bar replaces the title row and has a Cancel button.
- Safety: no infra file is touched and nothing new runs on the VPS (no ports, services, daemons, cron jobs, background tasks, service worker or new routes). The only new outbound host is googleapis.com, and only when the owner sets YOUTUBE_API_KEY. Every PR runs a path-allowlist diff check and the security-review skill. tailwind.config.js joins the allowed list for the landscape breakpoint (build-time only).
- PR order: 1 overflow and guard, then 2 backend (YouTube and editor contract), which can run in parallel with 1. Then 3 one-button Menu sheet, then 4 feed page, picker and headers, then 5 the whole-app sweep with landscape. Each PR has Playwright and pytest acceptance criteria, including exact PATCH counts per interaction.

# Popping on iPhone: iOS-first redesign

The angle is the best iOS experience. The model is one button that opens one sheet, with navigation like iOS Settings. Rows are grouped lists at 44pt. Pickers are native wheels. Saving is silent, with a small spinner then a check. Errors show where they happen. Swipe down closes; pull down refreshes. Everything stays within the existing tokens: `bg-app #000`, `bg-elevated #1c1c1e` for cells, hairlines, `rounded-ios` 10px and `rounded-ios-lg` 14px, `text-ios-body` 17/22, `text-ios-caption` 13/18, `text-ios-large-title` 34, accent `#0a84ff`, plus the existing emerald and red status colours (Settings.tsx:333-366).

Baseline: repo /home/user/popping at origin/main 721713e (PR #12). Line numbers were checked on that tree on 2026-10-18. "approx" marks a line that will drift.

---

## 0. Verdict on REDESIGN_PLAN.md (keep, correct, add)

### Keep (right, adopted below)

**Safety and YouTube**
- §2 safety table and the pre-merge and post-update checks.
- §3 YouTube diagnosis:
  - the bot user-agent `Popping/0.2` (config.py:392, used at youtube.py:41)
  - the single marker `"channelId"` (youtube.py:38)
  - pasted feed links fail because the direct regex only knows `/channel/` (youtube.py:37, 75-77)

**Overflow**
- §4's 13 measured overflow defects and most of their fixes.

**Editor contract (§6)**
- Commit on blur. One PATCH per commit, never per keystroke.
- A per-source serial queue.
- A `builtin` flag on SourceOut.
- Strip the category before storing it.
- Fix the reddit Test import.
- Reject bad header names.
- Route tests for every validation.

**Category, headers, top bar (§7 to §9)**
- §7: build the category options from `sources`.
- §8: key/value header rows with presets. Drop blank rows. Send `null` to clear. Hide the section for built-in and reddit feeds.
- §9: one top-bar button, Sign out on the phone, Save view without `window.prompt`, dead-code removal.

**Checklists and process**
- §10 and §11 checklists (deduplicated in §12 here).
- PR-per-step discipline.

### Correct (wrong against the code)

- **C1. Job rebuild.** The draft skips the scheduler job rebuild when only `category`, `name` or `custom_headers` change (§6). That is unsafe for headers and name.
  - The job's args hold a plugin built from the row: `args=[plugin]` in `_add_or_replace_dynamic_job` (scheduler.py:2101-2156).
  - The plugin reads `self._source_row.custom_headers` at fetch time (dynamic_rss.py:71).
  - So skipping the rebuild after a headers change keeps fetching with the old headers until the next restart.
  - Only a category-only change is safe to skip. Dynamic ingest reloads the row by id (`session.get(Source, source_id)`, scheduler.py:~398) and reads `source.category` from the DB (scheduler.py:431).
- **C2. Test fetch in the editor won't work for an existing feed.**
  - Sending the feed's name returns `name_conflict` (sources.py:909-926).
  - Built-in types are `unsupported_type` (sources.py:867).
  - generic_scrape ignores headers (sources.py:1000-1006).
  - reddit is broken (sources.py:1008).
  - Fix: the feed page uses **Refresh Now**, which calls `POST /api/ingest/{name}` (api.ts:543-546) with the saved settings. Test stays only on the Add page.
- **C3. "Card options > Edit this feed" has no surface on touch.**
  - The chevron under a card is the inline-summary toggle.
  - The card menu is right-click only (Card.tsx:708-808, bound at :879).
  - Fix: the tap target is the source label in the card's meta row (Card.tsx:961, a plain `<span>` today).
- **C4. Two sheets and a separate Drawer.** The draft's FeedEditorSheet at z-50 over Settings, plus the Drawer as a separate right-hand Menu, gives two presentations and stacked sheets. That is the duplication the owner objected to. Replaced by one sheet with a navigation stack (§3).
- **C5. Lowercasing new categories.** `categoryLabel` leaves any string with a capital letter as is and title-cases lowercase strings (labels.ts:64-68). So "NHL" lowercased would display as "Nhl".
  - Fix: match case-insensitively to existing categories, and store new ones as typed (trimmed, single spaces).
- **C6. Wrong names and lines.**
  - The reserved set is `_RESERVED_CATEGORY_NAMES = {"saved","for you"}` at sources.py:162, not `_RESERVED_CATEGORIES` near :154.
  - The phone's tab index is persisted at App.tsx:1358-1366. Lines 835-845 are the Saved/For You column insertion.
- **C7. Rewriting the grep tests is avoidable.** Keep `AddCustomTab` and `AutoFeedBlock`, with their pinned literals, in FeedManager.tsx. Then test_frontend_slice15_add_generic_scrape.py and test_source_create_sitemap_link_pattern.py pass unchanged. The editor lives in new files.
- **C8. Use `sheetUp`, don't delete it.** It is exactly the sheet entrance animation (tailwind.config.js:97-100, :116).
- **C9. "Backend pytest runs only in CI" is false.** The full suite passed here: 623 tests with Postgres 16, pgvector and /etc/hosts entries. The recipe is in §15.
- **C10. `run.sh` is not a gate.**
  - It leaks its preview server: `$!` is the npx wrapper (run.sh:13-15).
  - It always exits 0 (capture.cjs:562).
  - Fix: a new `guard.cjs` that exits non-zero (§11).
- **C11. The 16px replacement must handle inheritance.** Tailwind preflight gives inputs `font-size: 100%`, so a raw input inside a 13px parent renders at 13px. The real fix has three parts:
  - primitives at 17px,
  - a non-important base rule `font-size: max(1em, 16px)`,
  - a guard assertion.
- **C12. Allowed files need two changes.**
  - Add `frontend/tailwind.config.js` for the landscape breakpoint. It is build-time CSS with no runtime or infra effect.
  - Drop `frontend/package.json` and the lockfile: install Playwright in the CI step with `npm i --no-save playwright@1.56.1`. That means no Dependabot churn and nothing new in the Docker build stage (frontend/Dockerfile runs `npm ci`).
- **C13. YouTube details.**
  - `browseId` is unsafe as a marker: it also names other channels (featured or related shelves). Exclude it.
  - `/user/NAME` → `feeds/videos.xml?user=` with no network is unverified. Use a page lookup first and keep `?user=` only as the fallback when YouTube blocks the lookup.
  - The current code pastes raw httpx text into the user message (youtube.py:107-108). With an API key that text would contain `key=…`. Never echo exception text.
- **C14. Editor URL.** `?edit=<id>` becomes `page=feed-<id>` inside the sheet route. The refresh icon leaves the phone top bar entirely and is replaced by pull-to-refresh. It does not only leave below 360px.
- **C15. PATCH response votes.** The PATCH response carries `net_vote_score: 0`; only the list endpoint fills it (sources.py:398-403). Replacing the row with the response zeroes the vote badge, so keep the previous value.
- **C16. Polling race.** A poll that started before a PATCH but lands after it overwrites the row through `reconcileById` (App.tsx:1079-1100). The draft does not handle this. The overlay in §7.5 does.
- **C17. Jump to column.** It is a no-op on desktop too: the ref sits on a `display: contents` element (App.tsx:2598), verified in Chromium. Remove it everywhere rather than fixing it.

### Add (missing from the draft)

- Behaviour of the Feeds list, the Add page and the Suggested page inside the new navigation.
- The undefined autosave edges: idle debounce, Return key, close and app switch, field coalescing, rollback rules per control type.
- Cards' source label opens the feed page in one tap.
- A one-tap "Use a Browser Identity" fix wherever a 403 is shown.
- Smart Add: a pasted YouTube, Reddit or Apple Podcasts link picks its own type; `/api/sources/auto` accepts YouTube links.
- iOS keyboard handling for the sheet (visualViewport), swipe-down to dismiss, pull-to-refresh, and an iOS-style search bar with Cancel.
- The BriefCard first-run header clip (BriefCard.tsx:562) joins the overflow list.
- Saved presets are remapped on feed rename.
- Toasts move above the sheet (portal, `z-[60]`).

---

## 1. Principles mapped to iOS

| iOS idiom | Here |
| --- | --- |
| One settings surface, push navigation (Settings, Mail settings) | One Menu sheet whose rows push pages; back chevron top-left; Done top-right |
| Inset grouped lists | Cells `bg-bg-elevated` on `bg-bg-app`, `mx-4 rounded-ios`, hairline separators inset to the text, rows `min-h-[44px]`, 17px titles, 13px secondary text, 13px uppercase section headers in `text-label-secondary` |
| Native pickers | A real `<select>` laid invisibly over a value row, so a tap opens the iOS wheel |
| Detail disclosure (ⓘ) | In "Show Stories From", tapping a row filters and tapping ⓘ opens the feed page |
| Silent save | Spinner, then a check that fades after 1.2s; a red caption under the row on failure |
| Sheet gestures | `animate-sheet-up` on open, drag down on the top bar to close, Esc on desktop |
| Pull to refresh | Uses the native rubber-band of the phone column scroller; no JS scroll hijack |
| Search bar | Replaces the title row while active, with a Cancel button |
| Copy | Title Case for buttons, rows and titles ("Add Feed", "Delete Feed"); sentence case for footers; no developer words; no exclamation points |

---

## 2. Requirement map

| # | Requirement | Where | PR |
| --- | --- | --- | --- |
| 1 | Editor in fewer steps | Card source label → feed page (1 tap); Menu → Feeds → feed (3) | 4 |
| 2 | Category picker from existing categories, easy new one | Category page: your categories, then suggestions, then a "New Category" field | 4 |
| 3 | Autosave, no save link | §7 | 4 (AI page in 5) |
| 4 | Headers without JSON | Header rows with presets (§9) | 4 |
| 5 | One top-bar button | Title, search, Menu; gear, refresh icon and Drawer removed (§3) | 3 |
| 6 | iPhone problems fixed by default | Overflow root fixes, guard, keyboard-aware sheet, landscape, safe areas, 44pt targets (§11, §12) | 1, 3, 5 |
| 7 | Ease of use by default | Native wheels everywhere, autosave everywhere, obvious 44pt Title Case buttons, plain copy (§12) | 3, 4, 5 |
| 8 | VPS safety | §13; no infra file touched in any PR | all |
| 9 | YouTube adds | §10, offline tests | 2 |
| 10 | Real overflow fixes plus a guard | §11, `guard.cjs` in CI | 1, kept current in 3 and 4 |

---

## 3. Navigation: one button, one sheet

### 3.1 Top bar (phone)

```
At rest:         [ Popping                        (⌕)  (≡) ]
Search active:   [ (⌕ Search…                ⓧ)   Cancel  ]
```

**At rest**
- Title: `text-ios-large-title truncate min-w-0`. Buttons: `w-11 h-11 shrink-0`.
- At 320px, 34px "Popping" (about 140px) plus 2×44 fits in 288px. This fixes overflow item 8.

**Search active (below md)**
- The title and Menu button hide.
- The field pill is `flex-1 min-w-0 h-11`.
- The input is `type="text" inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}`. This fixes items 2 and 13: there is no second native clear button.
- The clear button is `w-11 h-11 -mr-3`, inside the pill.
- Cancel is `shrink-0 min-h-[44px] px-1 text-ios-body text-accent`. It clears the query and closes search.
- Desktop (md+) keeps the inline field (App.tsx:2231, `sm:w-72` becomes `md:w-72`).

**Removed**
- The refresh icon (App.tsx:2290-2297). Replaced by pull-to-refresh on the phone column and Menu → Refresh Now. Desktop keeps the sub-row Refresh button (App.tsx:2349-2355).
- The gear (App.tsx:2305-2331), with its `data-settings-gear` attribute, on every breakpoint.

**The single button**
- The Hamburger (App.tsx:2333, Hamburger.tsx:11-33) keeps `aria-label="open menu"`. It opens the Menu root.

**Breakpoints**
- The desktop sub-row and the search width move from `sm:` to `md:` (App.tsx:2231, 2342). The header and the body then switch together.
- The landscape fix itself is in PR 5.

### 3.2 What happens to the gear, the Drawer, "All settings…" and the Settings overlay

**Gear**
- Deleted (PR 3).
- Update App.tsx:1-17, which says the bar has hamburger, search and refresh, and delete the gear comment at App.tsx:2298-2304.

**Drawer.tsx — deleted.** Each piece moves or goes:

| Drawer piece | Fate |
| --- | --- |
| History row (Drawer.tsx:336-351) | Menu → "Your Stories" section |
| Save current view (:366-376 → `window.prompt` App.tsx:2812-2832) | Menu row "Save This View" with an inline field |
| All settings… (:377-390) | Removed; the Menu is the settings, and its rows are the old tabs |
| Jump to column (:393-409) | Removed; a no-op on the phone (App.tsx:2022-2030) and on desktop (App.tsx:2598) |
| Sources filter (:411-484) | The "Show Stories From" page |
| `GroupedSection`/`GroupedRow` (:508-602) | Lifted into ui/Grouped.tsx |
| Swipe-left dismiss (:132-193) | Replaced by swipe-down on the sheet's top bar |
| Dead `onResetLocalState` | Gone with the file; App.tsx:2810 removed |

**Settings overlay**
- Its container is deleted: backdrop, panel, header, the 8-pill tab strip, and the replaceState plus synthetic popstate (Settings.tsx:182-262, 238-246).
- The tab bodies stay in Settings.tsx, exported as `SettingsPageBody({tab, ...sameProps})`. Each becomes a pushed page.
- `?view=settings&tab=<id>` still deep-links. `?view=settings` with no tab now means the Menu root.
- Rename the label "Voted" to "Downvoted"; the id stays `voted`.

### 3.3 Route model (lib/sheetRoute.ts)

URL params live on the dashboard URL, so other params survive:

| Param | Level | Values |
| --- | --- | --- |
| `view=settings` | 0, Menu root | opens the sheet (name kept for old links) |
| `tab` | 1 | `feeds`, `filter` (new), `llm`, `notifications`, `history`, `hidden`, `starred`, `voted`, `reset` |
| `page` | 2 | `feed-<id>` (under `feeds` or `filter`), `add`, `suggested` (under `feeds`) |
| `pick` | 3 | `category` (under `page=feed-<id>` or `page=add`) |

**Validation**
- Invalid combinations are cut back to the longest valid prefix. For example, `tab=feed` falls back to the root. This keeps the intent of the allow-list comment at App.tsx:402-408.
- A `page=feed-<id>` whose id is not in `sources` (once loaded) is replaced by its parent, with a toast "That feed was removed".

**Single source of truth**
- `export const SHEET_PAGES = [...] as const` in lib/sheetRoute.ts.
- `SettingsTab` = `Exclude<(typeof SHEET_PAGES)[number], 'filter'>`.
- This deletes the three duplicated lists: App.tsx:409-418, Settings.tsx:40-48 and the strip array at Settings.tsx:229-233.

**API**
- `useSheetRoute()` uses `useSyncExternalStore` and subscribes to `popstate` and a custom `popping:route` event.
- Functions: `openSheet(levels[])`, `pushLevel(r)`, `popLevel()`, `replaceLevel(r)`, `closeSheet()`.

**App.tsx changes**
- Delete `settingsOpen`/`settingsTab`, the sync effect, and `openSettings`/`closeSettings` (App.tsx:384-444).
- Use `const route = useSheetRoute()` instead.

### 3.4 History rules (fixes "Done pushes, Back reopens", App.tsx:438-444)

Every sheet navigation writes `history.state = { poppingSheet: n }`, where n is the number of sheet entries above the dashboard entry.

| Action | What happens |
| --- | --- |
| Open (Menu button) | `pushState(root, {poppingSheet: 1})` |
| Open at a feed (card source tap) | Three `pushState` calls: root (1) → `tab=feeds` (2) → `page=feed-<id>` (3), then one notify. The back chevron walks real entries, and Safari Back behaves the same. |
| Push (row tap) | `pushState(next, {poppingSheet: n+1})` |
| Back chevron, n > 1 | `history.back()` |
| Back chevron, n ≤ 1 or state missing (deep link, bookmark) | `replaceState(parent, {poppingSheet: max(n,1)})` |
| Close (Done, swipe-down, Esc, desktop backdrop, "Show Only This Feed", first filter pick) | n ≥ 1: `history.go(-n)`. State missing: `replaceState(urlWithout(view,tab,page,pick), null)` |
| Replace (Add succeeds → the new feed's page) | `replaceState(feedPage, {poppingSheet: n})` |
| Browser or iOS Back | `popstate` → route is re-read → the stack animates a pop |

Notes:
- `pushState` does not fire `popstate`, so sheetRoute dispatches `popping:route` itself.
- Double-tap guard: back and close ignore further back or close until the next `popstate`, or 500ms.
- After `go(-n)`, if the URL still carries `view=settings` (history changed outside the app), `replaceState` it clean.

### 3.5 Sheet behaviour (components/ui/Sheet.tsx)

**Layering**
- Portal into `document.body`. While the sheet is open, `#root` gets `inert`, set through a ref effect because React 18 types lack `inert`.
- ToastHost is also portaled and moves to `z-[60]` (Toast.tsx:117), so toasts sit above the sheet.
- Sheet `z-50`. ShortcutsSheet z-40 and the desktop card menu z-40/50 are unchanged.

**Phone (below md)**
- Panel: `absolute inset-x-0 bottom-0 rounded-t-ios-lg bg-bg-app flex flex-col overflow-hidden motion-safe:animate-sheet-up`.
- The top is pinned at `calc(env(safe-area-inset-top) + 0.75rem)`. This keeps PR #11 (Settings.tsx:198-204); never use vh.
- Grabber: 36×5, in normal flow (`mx-auto mt-2 h-[5px] w-9 rounded-full bg-label-tertiary`). It is not absolutely positioned, which fixes the Drawer.tsx:303-306 safe-area bug.
- Exit animation: 220ms `translateY(100%)`, from a keyframe in styles.css. The sheet stays mounted while it plays.

**Desktop (md+)**
- `md:inset-y-0 md:right-0 md:left-auto md:w-[480px] md:rounded-none md:animate-none`.
- No grabber, no drag. Backdrop click closes.

**Keyboard**
- `useVisualViewport()` returns `{height, offsetTop}`. `layoutH = document.documentElement.clientHeight`.
- While `layoutH - height > 120` (keyboard up):
  - panel `top: calc(env(safe-area-inset-top) + .75rem + offsetTop px)`
  - panel `bottom: layoutH - (offsetTop + height) px`
  - the page scroller drops its safe-area bottom padding
- On each visualViewport `resize`, the focused field is scrolled into view with `scrollIntoView({block:'nearest'})`.
- Result: Done and the focused field stay visible. This fixes audit A1 (Settings.tsx:204).

**Gesture**
- Pointer drag on the grabber and nav bar strip only (`touch-action: none` there). Drags starting on a button are ignored.
- The panel follows the finger downward.
- Release closes when dy > 120px or velocity > 0.6px/ms. Otherwise it springs back over 200ms.

**Keys and focus**
- Esc: capture-phase listener with `stopPropagation`, same as Settings.tsx:169-180.
- App's global keydown (App.tsx:1753-1894) returns early while `route.open`, so arrow keys can't move the card selection behind the sheet.
- On open, focus goes to the panel (`tabIndex=-1`). Tab cycles inside it. On close, focus returns to the opener (Menu button or card source button).

**Scrolling**
- Each page scroller: `flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(2rem+env(safe-area-inset-bottom))]`.
- styles.css adds `html, body { overscroll-behavior-y: none }`.

**Lifecycle**
- The sheet unmounts after its exit animation, as Settings did (Settings.tsx:182). Pages fetch their status on mount.

### 3.6 Navigation stack (components/ui/NavStack.tsx)

**Levels**
- Every level from root to top is mounted, so scroll positions survive Back, as on iOS.
- Each level is `absolute inset-0 flex flex-col`.
- Lower levels: `inert aria-hidden="true" -translate-x-[30%] brightness-75`.
- The top level enters from `translate-x-full` to `0` over 350ms with `cubic-bezier(0.32,0.72,0,1)`, the same curve as `sheet-up`. It renders at `translate-x-full`, then is set to `0` on the next animation frame.
- A popped level stays mounted as "leaving" and slides back to `translate-x-full`, then unmounts on `transitionend` (380ms fallback).
- Everything is `motion-safe:`. With reduced motion there is no slide.

**Nav bar (one per level)**
- `h-11 grid grid-cols-[1fr_auto_1fr] items-center px-2`.
- Leading: back button, a chevron plus the parent title, `min-h-[44px] min-w-0 truncate text-ios-body text-accent`, `aria-label="Back to <parent>"`.
- Centre: title, `text-ios-body font-semibold truncate max-w-[56vw]`.
- Trailing: Done, `justify-self-end min-h-[44px] px-2 text-ios-body font-semibold text-accent`.
- The root level has no back button. Its title is "Menu".

---

## 4. Screens

### 4.1 Menu (root)

```
                      Menu                         Done
 ┌───────────────────────────────────────────────────┐
 │ ▤  Feeds                                   14   › │
 │    2 need attention                    (red line) │
 │ ⧩  Show Stories From              All Feeds    › │
 └───────────────────────────────────────────────────┘
 SAVED VIEWS
 │ ＋ Save This View…              (input row)        │
 YOUR STORIES
 │ History                                        › │
 │ Saved                                     12   › │
 │ Hidden                                     3   › │
 │ Downvoted                                  1   › │
 APP
 │ AI & Brief                                     › │
 │ Notifications                            Off   › │
 │ Refresh Now                 Updated 2 min ago    │
 │ Sign Out                                 (red)   │
 ADVANCED
 │ Reset This Device…                             › │
 312 stories · 14 feeds · All good          (footer)
```

**Feeds row**
- The value is `sources.length`.
- The red second line appears when any feed has `auto_disabled`, or `error_count > 0 && last_error`.

**Show Stories From**
- Value: "All Feeds" when no filter; `sourceLabel(name)` when one feed; "N Feeds" when several.

**Save This View…**
- The row is itself the `<input>`: placeholder "Save This View…", `enterKeyHint="done"`, 17px. Tapping it opens the keyboard directly.
- Return calls `savePreset(name)` (App.tsx:1680-1694) and toasts `Saved view “X”`.
- Empty input does nothing. No `window.prompt`.

**Counts**
- Saved, Hidden and Downvoted counts come from App's `starredEntries`, `hiddenEntries` and `downvotedEntries`.

**Notifications value**
- Fetched on root mount (`api.notificationStatus`, as Settings.tsx:150-164 did).

**Refresh Now**
- Calls `refresh({manual: true})`. A spinner shows while `refreshing`. The subtitle is the last refresh time.

**Sign Out**
- Shown only when `user && !oidcDisabled` (App.tsx:447-449).
- Calls `api.logout()` (api.ts:770), the same as UserBadge.tsx:26.

**Footer**
- Built from `health` (App.tsx:382). Status `ok` reads "All good"; anything else reads "Problem: <status>". This gives phones the status line the desktop sub-row has (App.tsx:2343-2347).

### 4.2 Feeds (`tab=feeds`)

```
 ‹ Menu                 Feeds                      Done
 │ ＋ Add a Feed                      (accent)      › │
 │ ✦ Suggested Feeds                               › │
 NEWS · 4
 │ [ic] BBC News                                   › │
 │      Updated 5m ago · every 15 min                │
 │ [ic] The Extraordinarily Long Name of a Regio…  › │
 │      Stopped after 6 failed checks         (red)  │
 PODCAST · 2
 …
```

- One section per category, sorted by `categoryLabel`, with the feed count in the header. Rows are sorted by `sourceLabel`.
- Each row: SourceIcon 29px in a `rounded-[7px]` tile, title `sourceLabel(name)` (one line, `truncate`), subtitle `line-clamp-2`, chevron.
- The net-vote badge and inline chips leave the list. This fixes overflow item 7.
- Subtitle rules, first match wins:
  1. `auto_disabled`: red "Stopped after N failed checks"
  2. `!active`: "Paused"
  3. `error_count > 0 && last_error`: amber "Last check failed · <timeAgo(last_fetch_at)>"
  4. otherwise: "Updated <timeAgo> · every <interval>"
- Empty state footer: "No feeds yet. Add one above."

### 4.3 Feed page (`page=feed-<id>`)

```
 ‹ Feeds              The Verge                    Done
      [icon 56]
      The Verge
      News · RSS feed · your votes +2
 ┌ Last check failed 2 h ago ─────────────────── (red) ┐
 │ upstream returned HTTP 403                          │
 │ [ Use a Browser Identity ]                          │
 └─────────────────────────────────────────────────────┘
 │ Show Only This Feed                     (accent) │
 │ Refresh Now          Got 23 stories, 2 new · now │
 FEED
 │ Name        the_verge                     ⟳/✓   │
 │ Address                                          │
 │ https://www.theverge.com/rss/index.xml     ⟳/✓  │
 │ Category                          News       ›  │
 │ Check Every                    1 hour       ⌃⌄  │
 │ Paused                                  ( ○ )   │
 Changing the address resets the feed's icon.   (only while editing it)
 HEADERS   (rss, podcast, youtube_channel, generic_scrape; not built-in)
 │ ⊖ User-Agent                                     │
 │   Mozilla/5.0 (Macintosh; …                ✓    │
 │ ⊕ Add Header                                     │
 │ Use a Browser Identity   (hidden once a UA exists)│
 │ Prefer English           (hidden once present)    │
 Some sites block apps that don't look like a web browser. …
 PAGE TRACKING   (generic_scrape only)
 │ Sitemap Link   (optional)                         │
 │ Only Links Starting With   /news/                 │
 │            Delete Feed            (red, centred)  │
```

**Header block**
- Name: `text-2xl font-bold break-words`.
- Second line: category label · type label · votes. Type labels: rss "RSS feed", reddit "Subreddit", podcast "Podcast", youtube_channel "YouTube channel", generic_scrape "Web page", built-in "Built-in". Votes show only when `net_vote_score ≠ 0`.

**Problem card**
- Shown when `last_error && (error_count > 0 || auto_disabled)`.
- `last_error` is `line-clamp-3` with a "More" toggle. This puts tooltip-only text on screen (FeedManager.tsx:723-754 today).
- When the error looks like a 401/403/"forbidden", headers are allowed, and no User-Agent is set, the card shows a "Use a Browser Identity" button. It adds the preset and commits.
- When `auto_disabled`, the card reads "Popping stopped checking after N failed tries. Turn off Paused to try again."

**Show Only This Feed**
- `setActiveSources(new Set([name]))`, then `closeSheet()`.

**Refresh Now**
- Calls `api.ingest(name)`.
- The subtitle shows the result inline: "Got N stories, M new", or red `r.error`.
- Then `refresh()` runs in the background, without a toast.
- This replaces the 13px "fetch" link (FeedManager.tsx:857-891).

**Fields**
- **Name:** inline field.
  - Typing is live-slugified: lowercase, runs of other characters become `_`, at most 120 characters. Leading and trailing `_` are trimmed only at commit.
  - Footer: "Short name used in filters and links."
  - Read-only for built-ins.
- **Address:** stacked field (label above, full-width input).
  - `type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"`.
  - Read-only for built-ins.
  - When the server returns a different URL (YouTube or Apple resolution), the field shows it, with the caption "Saved as the channel's feed link".
- **Category:** value row that pushes the picker.
- **Check Every:** SelectRow with options 15 min, 1 hour, 6 hours, 24 hours (`REFRESH_PRESETS`, FeedManager.tsx:55-60). If the current value isn't a preset, it is added as "Every 5 minutes" so the wheel never lies.
- **Paused:** SwitchRow; on means `active=false`.
- Built-in footer: "Built-in feed. Its name and address are fixed. Deleting it is permanent."
- Built-in status comes from `source.builtin` (PR 2). `KNOWN_BUILT_INS` (FeedManager.tsx:108-119), which is missing `rfd_hot_deals`, is deleted.

**Delete Feed**
- The red row expands in place into: "Delete “The Verge”? You can't undo this." with two 44pt buttons, Cancel and Delete (red).
- There is no timer, replacing the 4s auto-cancel (FeedManager.tsx:379, 433-437). See §7.9 for what happens after.

### 4.4 Category picker (`pick=category`)

```
 ‹ The Verge            Category                   Done
 YOUR CATEGORIES
 │ Deals                          2 feeds           │
 │ News                           4 feeds        ✓  │
 │ Podcast                        2 feeds           │
 SUGGESTIONS
 │ Finance · Gaming · Longform …  (one row each)     │
 NEW CATEGORY
 │ ＋ New Category                (input row)        │
 Feeds in the same category share a column on the dashboard.
```

**Sections**
- "Your Categories": the unique categories in `sources`, case-insensitively deduplicated (the stored spelling wins), with a feed count, sorted by label.
- "Suggestions": `CATEGORY_OPTIONS` (FeedManager.tsx:80-105) minus those already in use.

**Picking**
- On the feed page: tap → commit → the check moves → pop after 250ms (`popLevel`).
- On the Add page: the pick sets local form state, then pops.

**New category**
- Input with placeholder "New Category", `autoCapitalize="words" autoCorrect="off" enterKeyHint="done" maxLength={40}`, 17px.
- A counter ("32/40") shows past 30 characters.
- Return validates (§8), then commits and pops.

### 4.5 Add a Feed (`page=add`)

```
 ‹ Feeds              Add a Feed                   Done
 PASTE A LINK
 │ https://…  (type=url, inputMode=url, Go)          │
 [            Add Feed  (primary, 44)            ]
 Popping finds the feed for you. YouTube links, @handles and channel IDs work too.
 (error) couldn't find a feed (or anything scrapeable) at that URL
 │ Track this URL anyway                  (accent)   │
 │ More Options                                ⌄    │   (disclosure)
   TYPE      ○ News feed (RSS / Atom) ✓ · Subreddit · Podcast · YouTube channel ·
             Track page (no RSS)  – For sites without a feed
   LINK      (label/placeholder ternaries kept)
   SHORT NAME  auto-derived, editable, live-slugified
   CATEGORY  News ›     CHECK EVERY  1 hour ⌃⌄
   ADVANCED  ⌄  → Headers rows · Sitemap link · Only links starting with (Track page only)
   [ Test ] [ Add Feed ]   (grid-cols-2, 44 each)
   (test result card, data-test-result kept)
```

**Quick add (AutoFeedBlock, kept in FeedManager.tsx)**
- The client classifies the pasted text before calling anything:

| Pasted | What happens |
| --- | --- |
| YouTube host, or a bare `UC…` id | `api.autoAddSource(url, 'video')`; the backend gains YouTube support in PR 2 |
| `r/x` or reddit.com/r/… | "More Options" opens prefilled with type Subreddit; the auto endpoint can't do Reddit |
| podcasts.apple.com | "More Options" opens prefilled with type Podcast |
| Anything else | `api.autoAddSource(url, 'news')` |

- A single default category of `news` is used for all three add paths, except `video` for YouTube. Today the paths default to `other` (api.ts:409) and `news` (FeedManager.tsx:1190).
- On success: `insertSource(row)`, then `replaceLevel(page=feed-<id>)`, and a toast "Added <label>". The user lands on the new feed's page and can rename or recategorize it at once.
- On failure, the literals "couldn't find a feed" and "Track this URL anyway" stay inside the `autoMessage.kind === 'err'` branch. `trackAnyway` stays byte-compatible with the guard at test_frontend_slice15_add_generic_scrape.py:264-305.

**Manual form (AddCustomTab, kept in FeedManager.tsx)**
- **Type:** rows are `<label>`s that wrap visually hidden native radios (`<input type="radio" name="fm-type" value=…>`, kept for the guard at :87-135), with a checkmark accessory.
  - The generic_scrape label must still contain "Track page" and "no RSS".
  - Type is auto-selected from the link host until the user taps a type.
- **Link:** keep `htmlFor="fm-url"`/`id="fm-url"` and the label and placeholder ternaries (FeedManager.tsx:1646-1670). The generic_scrape label must contain "Page URL" and its placeholder must stay exactly `'https://example.com'`. YouTube label: "YouTube link or channel ID".
- **Short name:** auto-derived until the user edits it.
  - From a host: same operations as `trackAnyway`.
  - YouTube handle: `<handle>_yt`.
  - Subreddit: `r_<name>`.
  - This replaces the "lowercase letters, digits, underscore" ask (FeedManager.tsx:1541).
- **Category:** a value row that pushes the picker (replaces the `<select id="fm-category">` at FeedManager.tsx:1722-1731).
- **Advanced:**
  - The headers editor, with local state passed to `api.testSource({custom_headers})` (api.ts:389-400) and `api.createSource`.
  - Sitemap and link pattern stay under `{sourceType === 'generic_scrape' && (`, with `onChange={(e) => setSitemapUrl(...)}` and `onChange={(e) => setLinkPattern(...)}` kept. The `sitemap_url: ` and `link_pattern: ` keys stay in the createSource call.
- **Errors:** `nameError` and `urlError` (FeedManager.tsx:1363-1364), computed but never rendered today, show as red captions under their fields.
- **Test results:** `friendlyTestError` (FeedManager.tsx:163-188) loses the "Invalid URL —" prefix (backend messages become plain). `forbidden` reads "This site blocks apps that don't look like a browser." with a button "Use a Browser Identity and Test Again".
- After Add: same as Quick add (land on the feed page).

### 4.6 Suggested Feeds (`page=suggested`)

- RecommendedTab content restyled as grouped rows.
- Title `sourceLabel(name)`. Subtitle `categoryLabel(category)` · blurb (`line-clamp-2`), plus "Found for you" when `source === 'llm'`. This replaces the raw slugs (FeedManager.tsx:1110-1111).
- Trailing "Add" pill: visually 30px, hit area `min-h-[44px] min-w-[44px]`.
- The last row is "Find More Feeds", with a spinner and a result footer.
- After Add: `insertSource(row)` and a toast "Added X" with an "Open" action that pushes `page=feed-<id>`.

### 4.7 Show Stories From (`tab=filter`)

- First row: "All Feeds", checked when `activeSources.size === 0`. Tapping it clears the filter (App.tsx:2018-2020) and closes the sheet.
- One section per category. Rows: SourceIcon, label, a check when active, and a trailing ⓘ (44×44, `aria-label="Edit <label>"`) that pushes `page=feed-<id>`.
- Tapping a row toggles the feed (App.tsx:1981).
- The first pick from an empty filter closes the sheet, keeping the deliberate behaviour of App.tsx:2013-2017. Later toggles keep it open.
- Footer: "The dashboard shows only these feeds until you choose All Feeds."

### 4.8 Other pages

- They render `SettingsPageBody` inside `px-4 pt-4` (or as grouped lists after PR 5):
  - AI & Brief: tone, LLM section and Generate (Settings.tsx:274-328).
  - Notifications, History, Saved, Hidden, Downvoted.
- Reset becomes "Reset This Device…" and uses the inline two-step confirm, replacing `window.confirm` at Settings.tsx:413.

### 4.9 Copy rules

- Never shown to the user: "slug", "generic_scrape", "scheduler", "Feed Manager", ".env", raw HTTP status lines.
- Errors say what happened and what to do.

---

## 5. Flows, tap by tap (iPhone, starting at the dashboard)

| Task | Today | New |
| --- | --- | --- |
| Change a feed's category | 5 taps + typing the exact spelling (gear → row → edit → field → save; App.tsx:2307, FeedManager.tsx:688/798/605/657) | **3**: feed name on a card → Category → pick. Auto-returns; spinner then check. Via Menu: 5 (Menu → Feeds → feed → Category → pick) |
| Create a new category | 5 + typing | **4** + typing: feed name → Category → New Category field → Return |
| Change the address | 4 + typing + tiny save | **2** + typing: feed name → Address → Return or tap elsewhere |
| Add a header | 4 + valid JSON | **4** + typing: feed name → Add Header (the name field gets focus in the same tap via `flushSync` then `focus()`) → Value → Return |
| Fix a "Forbidden" feed | Write JSON by hand | **2**: feed name → Use a Browser Identity (saves, and the backend refetches at once) |
| Pause or resume | 3 | **2**: feed name → Paused switch |
| Refresh interval | 4 | **3**: feed name → Check Every → wheel pick (+ the wheel's Done) |
| Fetch now | 3 | **2**: feed name → Refresh Now (result shown inline) |
| Delete | 4, within 4 seconds | **3**: feed name → Delete Feed → Delete |
| Add a YouTube channel | gear → Add custom → type a slug → YouTube → paste → Add; @handles fail | **4**: Menu → Feeds → Add a Feed → paste → Add Feed (or the keyboard's Go) → lands on the new feed's page |
| Show one feed only | 2 (hamburger → checkbox) | **2**: feed name on a card → Show Only This Feed. Or Menu → Show Stories From → feed (3) |
| AI settings | 2 (gear → AI pill) | **2**: Menu → AI & Brief |
| History, Saved, Hidden | 2 | **2**: Menu → row |
| Refresh | 1 (icon) | **1 gesture**: pull down. Or Menu → Refresh Now (2) |
| Save a view | 2 + native prompt | **2** + typing: Menu → Save This View… → Return |
| Sign out on the phone | Impossible | **2**: Menu → Sign Out |
| Close | 32pt Done on the left | 44pt Done on the right, swipe down on the sheet top, or Back |
| Search | 1, but at 320px the icons run off-screen | 1 + typing; Cancel closes |

---

## 6. Components and files

### New

| File | Contents |
| --- | --- |
| frontend/src/lib/sheetRoute.ts | Route parse and serialize, `SHEET_PAGES`, `useSheetRoute`, push/pop/replace/close/openSheet, depth state, double-tap guard |
| frontend/src/lib/useVisualViewport.ts | `{height, offsetTop}`, updated through rAF on visualViewport `resize`/`scroll` |
| frontend/src/lib/usePullToRefresh.ts | See §12, item P |
| frontend/src/lib/sourceSaves.ts | Autosave store (§7) |
| frontend/src/lib/categories.ts | `categoryOptions(sources)`, `matchCategory(input, existing)`, `validateCategory(s)`, `RESERVED_CATEGORIES = ['saved','for you']` (mirrors sources.py:162) |
| frontend/src/lib/headers.ts | rows ⇄ map, `HEADER_DENY` (mirrors sources.py:169-187), `TOKEN_RE`, `VALUE_RE`, limits 20 and 512, smart-punctuation normalisation, `BROWSER_UA`, `PRESETS` |
| frontend/src/lib/apiErrors.ts | `parseApiError` and `friendlyTestError`, moved from FeedManager.tsx:163-210; `userMessage(err)` per status; `fieldSaveMessage(err, field)` |
| frontend/src/lib/slug.ts | `slugifyLive`, `slugifyFinal`, `deriveName(url, type)` |
| frontend/src/components/ui/Sheet.tsx | §3.5 |
| frontend/src/components/ui/NavStack.tsx | §3.6 (NavStack + NavBar) |
| frontend/src/components/ui/Grouped.tsx | `Section`, `Row`, `ValueRow`, `ActionRow`, `DestructiveConfirmRow`. The header comment holds the layout contract (§11.3) |
| frontend/src/components/ui/Field.tsx | `FieldRow` (inline or stacked; `readOnly`; `status`; `error`) |
| frontend/src/components/ui/SelectRow.tsx | Value row with an invisible full-size `<select>` overlay (`absolute inset-0 opacity-0 text-ios-body`, so it is still at least 16px and doesn't zoom), up/down chevron, focus ring via `has-[:focus-visible]:ring-2` |
| frontend/src/components/ui/Switch.tsx | `Switch` (button `role="switch" aria-checked`, track 51×31 `bg-emerald-500`/`bg-white/20`, thumb 27px) and `SwitchRow` (the whole row toggles) |
| frontend/src/components/ui/SaveIndicator.tsx | Reserved 20px slot: spinner, check (fades 1.2s), or red ! |
| frontend/src/components/ui/icons.tsx | ChevronRight, ChevronLeft, ChevronUpDown, Check, PlusCircle, MinusCircle, Info, Spinner, Gear, Feeds, Filter (24 viewBox, stroke 1.75, `aria-hidden`) |
| frontend/src/components/menu/MenuSheet.tsx | Sheet + NavStack. Maps the route to levels and passes App props down |
| frontend/src/components/menu/MenuHome.tsx | §4.1 |
| frontend/src/components/menu/FilterPage.tsx | §4.7 |
| frontend/src/components/feeds/FeedEditorPage.tsx | §4.3 |
| frontend/src/components/feeds/CategoryPickerPage.tsx | §4.4 |
| frontend/src/components/feeds/HeadersEditor.tsx | §9, used by the feed page (autosave mode) and the Add page (local mode) |
| frontend/src/components/PullIndicator.tsx | `aria-hidden` arrow and spinner placed `absolute -top-12` inside the column scroller |
| frontend/scripts/iphone-audit/guard.cjs | §11.4 |

### Changed

| File | Change |
| --- | --- |
| App.tsx | Route; header; mount MenuSheet in place of Drawer and Settings; `sources` overlay and helpers; `onSourceTap`; manual-only refresh toast; preset remap on rename; keydown early return |
| Settings.tsx | Export `SettingsPageBody`; delete the container and strip; Reset confirm inline; labels |
| FeedManager.tsx | Export `FeedsListPage`, `AddFeedPage` (AutoFeedBlock + AddCustomTab), `SuggestedFeedsPage`. Delete the sub-tab strip, `SourceRow` and its edit form, the JSON parser, `KNOWN_BUILT_INS`, and `editingRowId`/`editingInterval`. Keep every guard literal |
| Card.tsx | Source label becomes a button; thumbnail and meta fixes |
| Column.tsx | Pass `onSourceTap`; `data-ptr-scroller`; PullIndicator slot |
| Toast.tsx | Lines, durations, portal, `z-[60]` |
| BriefCard.tsx | Header wrap |
| api.ts | `Source.builtin`; updateSource adds `sitemap_url`/`link_pattern` and a `keepalive` option; deleteSource throws `ApiError`; autoAddSource `kind` gains `'youtube_channel'` |
| styles.css | Base form-control rule; overscroll; keyframes for push, pop and sheet-down |
| LoginPage.tsx | Input attributes |
| Hamburger.tsx | Comment only |
| tailwind.config.js (PR 5) | Screens |

### Deleted

- frontend/src/components/Drawer.tsx

---

## 7. State and autosave

### 7.1 Ownership

- **App** keeps owning `sources` (App.tsx:381) and gains:
  - `applyServerSource(row)`: replaces the row by id with `{...row, net_vote_score: prev.net_vote_score}` (C15), and records a local write.
  - `insertSource(row)`
  - `removeSource(id)`: also records a local delete.
- **sourceSaves.ts** is a module singleton that App configures once:
  - `configure({ getSource, onServerRow: applyServerSource, onRenamed: onSourceRenamed, onFailedAway })`
  - The queue outlives page unmounts.
- **Field components** hold only a `draft` while focused or dirty.

### 7.2 Commit triggers

There is no time-based debounce anywhere:
- Every effective PATCH on an active feed rebuilds its job with `next_run_time = now`, which is an immediate fetch (scheduler.py:2455-2461, 2144).
- An idle timer would save half-typed URLs.
- iOS users end an edit with Return or by tapping elsewhere. Close and app-switch flushes cover the rest.

| Control | Commits when | PATCH body |
| --- | --- | --- |
| Name | blur, Return (`enterKeyHint="done"`), page pop/close/pagehide (flush) | `{name}` |
| Address | same | `{url}` |
| Category | picker tap, or Return in New Category | `{category}` |
| Check Every | `<select>` change | `{refresh_interval_seconds}` |
| Paused | toggle | `{active}` |
| Headers | focus leaves the whole headers group (`focusout` with `relatedTarget` outside it), Return in a value field, remove, preset, flush | `{custom_headers: map \| null}` |
| Sitemap link / Only links starting with | blur, Return, flush | `{sitemap_url}` / `{link_pattern}` (empty → `null`) |

### 7.3 Pipeline, queue, coalescing, races

```
commit(id, field, value):
  value = normalize(field, value)            // trim, single spaces, slugifyFinal, header map canonicalised
  effective = queued(field) ?? inFlight(field) ?? server(id, field)
  if equal(value, effective): clear a stale error for field if value == server; return
  if queued(field): replace its value        // coalesce same-field commits: last write wins
  else queue.push({field, value})
  setState(id, field, {status: 'saving', pending: value})
  pump(id)

pump(id):                                    // one PATCH in flight per source, FIFO
  if inFlight(id) or queue empty: return
  item = queue.shift(); inFlight = item
  api.updateSource(id, {[item.field]: item.value}, {keepalive: item.keepalive})
   .then(row => {
      prev = getSource(id); onServerRow(row); server(id) = row
      if prev.name != row.name: onRenamed(prev.name, row.name)
      if no newer pending for field: status 'saved' → 'idle' after 1200 ms
   })
   .catch(err => {
      if network error and !item.retried: item.retried = true; queue.unshift(item) after 2000 ms
      else status 'error' {error: fieldSaveMessage(err, field), retry: () => commit(id, field, item.value)}
           if no subscriber for (id, field): onFailedAway(source, field, message)
   })
   .finally(() => { inFlight = undefined; pump(id) })
```

**Equality**
- Strings are compared after normalisation.
- Header maps use canonical JSON (keys sorted); `null` ≡ `{}`.
- An unchanged commit sends nothing. The backend would early-return anyway (scheduler.py:2325-2364).

**Different fields are not merged into one PATCH**
- That keeps error attribution exact: a 422 belongs to the one field sent.
- Two quick edits to different fields give two sequential PATCHes. This is rare and harmless.

**Race example**
1. Pick News, then quickly Deals.
2. PATCH(News) is in flight; Deals is queued. The display shows Deals (pending).
3. News returns. The server row is applied, but the display keeps the pending Deals.
4. PATCH(Deals) is sent and returns. Final state: Deals.
- If News failed but Deals succeeds, the later success clears the error.

**Deleted feed**
- `dropSource(id)` cancels queued items. An in-flight result for a deleted id is ignored.

### 7.4 Display value and re-seeding

- The field shows `draft ?? pending ?? source[field]`.
- `draft` exists only between focus and commit. Polling can therefore never overwrite text being typed.
- The old re-seed effect, keyed on `source.custom_headers` identity (FeedManager.tsx:465-475), is deleted.
- **Headers editor:** the local rows array is seeded once per page mount. It is re-seeded only when all of these hold:
  - no header input is focused,
  - no headers write is pending,
  - the server map differs from the last seeded map.

### 7.5 Polling overlay (C16)

- `localWritesRef: Map<id, {at, fields}>` is set by `applyServerSource`. `localDeletesRef: Map<id, at>` is set by `removeSource`.
- In `refresh()` (App.tsx:1057), record `startedAt = Date.now()` before `Promise.all`. On resolve, overlay the list:
  - drop ids deleted at or after `startedAt`;
  - for writes with `at >= startedAt`, overlay the written fields;
  - prune older entries (the server reflects them).
  - Then `reconcileById` as now.
- Entries are capped to the last 60 seconds.

### 7.6 Errors and rollback

| Failure | Text fields (Name, Address, links) | Discrete controls (Category, Check Every, Paused, headers remove/preset) |
| --- | --- | --- |
| Client validation | Nothing sent. Red caption under the row; draft kept; Esc (desktop) or "Undo" restores the saved value | n/a: pickers can't produce invalid values; New Category validates in the picker |
| 4xx | Draft kept. Plain caption with the backend reason plus "Undo" | Value snaps back to the saved one, plus a caption |
| Network | One silent retry after 2s, then "Couldn't reach Popping. Check your connection." with "Try Again" | Same |
| 5xx | "Popping had a problem saving. Try Again." | Same |
| Failure after leaving the page | Error toast (4s): "Couldn't save the <field> for <label>: <reason>", with action "Open" that opens the feed page | Same |

`fieldSaveMessage` mapping:

| Backend response | Message |
| --- | --- |
| 409 | "Another feed already uses this name." |
| 400 built-in | "Built-in feeds keep their name and address." |
| 422 "category cannot be empty" | "Pick a category." |
| 422 reserved | "“<X>” is used by the app. Pick another name." |
| 422 ">40" | "Keep it to 40 characters or fewer." |
| 422 header messages | Rewritten plainly, for example "Popping can't send the Cookie header." |
| 422 "url is not reachable" | "That address isn't reachable from Popping." |
| YouTube errors | Passed through (already plain after PR 2) |

**Error surfaces**
- Editor errors never go to the dashboard banner hidden under the sheet (App.tsx:2397-2411). The banner stays for dashboard refresh failures only.

### 7.7 Saved feedback

- Spinner while saving, then a check that fades over 1.2s.
- A visually hidden `aria-live="polite"` region per page announces "Category saved" and similar.
- There is no toast on success. Toasts are only for leaving-page failures, Add, and Delete.

### 7.8 Close mid-save, page pop, app switch

- The sheet closes immediately; nothing blocks.
- Before close or pop, `flushRegistered()` runs every page's flusher:
  - a dirty valid draft commits;
  - a dirty invalid draft is discarded with the toast "<Field> wasn't saved: <reason>".
- On `visibilitychange` (hidden) and `pagehide`, flushers run with `{keepalive: true}`, so the PATCH survives app suspension (fetch keepalive).
- In-flight PATCHes complete after close and update App state. Their failures use `onFailedAway`.

### 7.9 Rename, create, delete

**Rename**
- `onSourceRenamed(old, new)` (App.tsx:1994-2003) remaps the active filter.
- PR 4 extends it to remap `filterPresets[].activeSources` (preferences.tsx:122-127), so saved views don't silently filter nothing.
- The route uses ids, so it is unaffected.

**Create**
- The create response (`SourceOut`) goes to `insertSource`. Then a background `refresh()` runs without a toast.

**Delete**
1. `api.deleteSource(id)`, now throwing `ApiError` with `detail` (api.ts:446-452).
2. `removeSource(id)` and `dropSource(id)`.
3. `history.back()` to the Feeds list (it exists in the chain) when n > 1; otherwise `replaceLevel(tab=feeds)`.
4. Toast "Deleted <label>".
- On failure, a red caption appears and the row stays.

### 7.10 Accessibility

- Captions use `role="alert"`. Switches have `role="switch"`. Selects have `aria-label`. Status icons are `aria-hidden`.
- Lower NavStack levels and `#root` are `inert`.

---

## 8. Category rules (lib/categories.ts)

**Normalise:** `trim()`, then collapse internal whitespace to one space.

**Validate, in order:**
1. Not empty: "Pick a name."
2. At most 40 characters: "Keep it to 40 characters or fewer." (String(40), models.py:46)
3. Not "saved" or "for you" (case-insensitive): "“Saved” is used by the app. Pick another name." (sources.py:162)

**Match:** if an existing category equals the input case-insensitively, use the stored spelling. This prevents the "news"/"News" duplicate columns that grouping by exact string creates (App.tsx:753-764; entries.py:366).

**New categories:** stored as typed, so "NHL" stays "NHL". `categoryLabel` displays it unchanged.

**Columns and the phone tab:** moving the last feed out of a category removes that column.
- The phone tab must stay on the same column name.
- PR 4 includes the "remember the tab by name" change from §12 item 8, because a category change otherwise shifts the index-based tab (App.tsx:1358-1366).

**Backend (PR 2):** `_validate_category` returns the normalised value, and POST, /auto and PATCH store it (sources.py:518, 617, 779).

---

## 9. Header rules (lib/headers.ts)

**Rows**
- `{key, name, value}`. Seeded from `custom_headers` in object order.
- Each row is one cell: a leading red ⊖ (44×44, `aria-label="Remove <name>"`), then a Name input (`font-medium`, placeholder "Name, e.g. User-Agent"), a hairline, then a Value input (placeholder "Value").
- Both inputs are `autoCapitalize="none" autoCorrect="off" spellCheck={false}` at 17px.

**Add Header**
- A green ⊕ row.
- `flushSync` adds the row, then the new Name input is focused in the same tap, so iOS opens the keyboard.
- Hidden at 20 rows.

**Presets** (each hidden when that header is already present):
- "Use a Browser Identity" → `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`
- "Prefer English" → `Accept-Language: en-CA,en;q=0.9`

**Validation, per row, shown as a caption**

| Rule | Caption |
| --- | --- |
| Both name and value empty | Ignored |
| Only one of the two filled | Kept as a local draft: "Fill in both to save this header." |
| Name not matching `^[!#$%&'*+.^_`\|~0-9A-Za-z-]+$` | "Header names use letters, numbers and dashes." |
| Name in the deny list (case-insensitive) | "Popping can't send this header." |
| Duplicate name (case-insensitive) | "Already added." |
| Value has more than 512 characters | "Too long (512 characters max)." |
| Value outside `^[\t\x20-\x7e]*$` after normalising (“” → ", ‘’ → ', –— → -, … → ...) | "Use plain letters, numbers and symbols." |

**Sending**
- When the group commits, it sends only if every complete row is valid.
- The map holds the complete rows; empty sends `null` (sources.py:354, 754-759).

**Visibility**
- Shown only for `type ∈ {rss, podcast, youtube_channel, generic_scrape}` and `!builtin`.
- Reddit and built-in plugins ignore headers (dynamic_reddit.py:171; built-in plugins use static headers).

**Footer:** "Some sites block apps that don't look like a web browser. A browser identity usually fixes “Forbidden” errors. Cookies and passwords can't be added here."

**Backend (PR 2):** add `_HEADER_NAME_RE` in sources.py, with 422 "header name 'X' isn't valid" for blank or non-token names (today only type and deny-list are checked, sources.py:325-334).

---

## 10. YouTube (requirement 9)

### 10.1 Resolver (backend/app/youtube.py)

The order is chosen so that every shape that already carries the id needs no network.

1. **Normalise the input.**
   - `strip()`.
   - Bare id `^UC[0-9A-Za-z_-]{22}$` → feed URL. This runs before the host check, because today a bare id falls through and 422s.
   - Add `https://` when the text starts with `youtube.com/`, `www.youtube.com/`, `m.youtube.com/` or `youtu.be/` without a scheme (iOS paste).
2. **Host check:** `is_youtube_url` (youtube.py:50-58), unchanged. Anything else passes through unchanged.
3. **Feed links:** path `/feeds/videos.xml` with `channel_id=UC…` → canonical feed URL with other params stripped. `playlist_id=` or `user=` → canonical feed URL as is.
4. **Channel path:** `/channel/(UC…)(/|?|#|$)` → feed URL. This covers `music.` and `m.` hosts.
5. **Everything else needs a lookup.** That is `@handle`, `/c/NAME`, `/user/NAME`, `watch?v=`, `youtu.be/ID`, `/shorts/ID`, `/live/ID`, `/embed/ID`.
   - Strip tracking params (`si`, `feature`, `pp`, `t`).
   - Rewrite `m.`/`music.` to `www.youtube.com`, and `youtu.be/ID` to `https://www.youtube.com/watch?v=ID`.
6. **Optional API (`settings.youtube_api_key` non-empty)** for handle, user and video shapes:
   - `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=@x&key=…`, `…channels?part=id&forUsername=x`, `…videos?part=snippet&id=ID`, taking `items[0].id` or `items[0].snippet.channelId`.
   - Same SSRF guard and hook.
   - On 403 or `quotaExceeded`, fall through to the page lookup.
   - `/c/` names always use the page lookup (search costs 100 quota units).
7. **Page lookup.** A single shared constructor:
   ```python
   httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True, max_redirects=5,
                     event_hooks={"request": [ssrf_event_hook]}, cookies=jar)
   ```
   - Keep the literal `event_hooks={"request": [ssrf_event_hook]}`, which is pinned by test_youtube.py `test_resolve_channel_feed_url_registers_ssrf_event_hook`.
   - `jar` holds `SOCS=CAI` and `CONSENT=YES+` scoped to `.youtube.com`.
   - Headers: a desktop Safari `User-Agent` (a module constant `_BROWSER_UA`, not `settings.user_agent`), `Accept: text/html,…`, `Accept-Language: en-US,en;q=0.9`.
   - Entry check with `check_url_safe`, plus the final-URL check (as youtube.py:83-106).
   - Stream the body; stop reading at 3,000,000 bytes.
8. **Markers.** Attribute-order agnostic: find each `<link …>`/`<meta …>` tag, then read its attributes. First hit wins, in this order:
   1. `<link rel="alternate" type="application/rss+xml" href=".../feeds/videos.xml?channel_id=UC…">`
   2. `<link rel="canonical" href=".../channel/UC…">`
   3. `<meta property="og:url" content=".../channel/UC…">`
   4. `<meta itemprop="channelId|identifier" content="UC…">`
   5. `"videoDetails":{…"channelId":"UC…"` (no nested braces)
   6. `"externalId":"UC…"`
   7. `"channelId":"UC…"` (legacy)
   - `browseId` is deliberately excluded (C13).
9. **Blocked detection:** any of the following raises `YouTubeBlockedError(YouTubeResolutionError)`:
   - the final host is `consent.youtube.com` or `consent.google.com`;
   - the body has a `consent.youtube.com` form or "Before you continue";
   - HTTP 429;
   - the body contains "confirm you’re not a bot" or "Sign in to confirm".
10. **`/user/NAME` fallback:** when blocked, return `https://www.youtube.com/feeds/videos.xml?user=NAME`. The Test endpoint then shows whether YouTube still serves that feed.
11. **Messages.** All plain; raw exception text is never included. Log `url` without its query, plus `exc.__class__.__name__`; never log the key.

| Case | Message |
| --- | --- |
| Blocked | "YouTube didn't let Popping look this channel up. Paste the channel ID instead: in the YouTube app, open the channel, tap its description, scroll down, tap Share Channel, then Copy Channel ID. It starts with UC." (verify the app wording on the phone during PR 2's check) |
| 404 | "YouTube says this channel or video doesn't exist." |
| No marker | "Couldn't find the channel on that YouTube page. Paste the channel ID instead (it starts with UC)." |
| Network | "Couldn't reach YouTube. Try again in a minute." |

### 10.2 Route changes (backend/app/routes/sources.py)

**Create and test paths** keep calling `resolve_channel_feed_url` (sources.py:446-451, 884-892).

**`/api/sources/auto`** (sources.py:573-644): when `is_youtube_url(url) or is_bare_channel_id(url)`:
1. Resolve. Map errors to 422 with the message.
2. Name: `_free_source_name(session, base)`, where `base` is the handle slug plus `_yt`, or `youtube_` plus `id[2:10].lower()`. `sourceLabel` renders `_yt` as " (YouTube)" (labels.ts).
3. `scheduler.add_source(type_='youtube_channel', refresh=_YOUTUBE_DEFAULT_REFRESH, category=normalised)`.
4. Return `kind='youtube_channel'`; add it to the `SourceAutoResult.kind` Literal (schemas.py:130-143).
- No auto-discovery task is spawned for YouTube.

**Config and docs**
- config.py: `youtube_api_key: str = ""`.
- .env.example: a commented, optional `YOUTUBE_API_KEY=` with one line: "Optional. Looks up @handles through Google's API instead of loading YouTube pages. Free quota: 10,000 lookups a day."
- README: a YouTube section with the channel-ID steps.

### 10.3 Offline tests (backend/tests/test_youtube.py)

**Fixture**
- Patch `app.url_safety.socket.getaddrinfo` to return a public address (`142.250.0.1`) for `*.youtube.com` and `www.googleapis.com`, and `10.0.0.5` for `evil.internal`.
- The real SSRF guard therefore stays in the path.
- Patch `app.youtube.httpx.AsyncClient` with `lambda **kw: real(transport=httpx.MockTransport(handler), **kw)`, the pattern at test_reddit_oauth_token.py:15-30.

**No-network cases** (the handler asserts zero calls):
- bare id, with surrounding spaces
- `/channel/UC…/videos`
- `feeds/videos.xml?channel_id=…&foo=1`
- `music.youtube.com/channel/…`
- scheme-less `youtube.com/channel/…`

**Lookup cases:**
- `@handle?si=abc`: the request URL has no `si`; the User-Agent contains "Safari"; the SOCS cookie and Accept-Language are sent.
- Each marker on its own: alternate link, canonical, og:url, itemprop, videoDetails, externalId, channelId.
- A watch page whose first `"channelId"` belongs to another channel but whose `videoDetails` holds the right one → the right one.
- A 302 to `consent.youtube.com`:
  - without a key → `YouTubeBlockedError` whose message contains "channel ID";
  - with `settings.youtube_api_key` monkeypatched → resolved through the mocked googleapis JSON; the API request has `forHandle=%40handle`; the error text never contains `key=`.
- A 429 page → blocked.
- 404 → not-found message.
- A redirect to `evil.internal` → rejected, and the handler never sees that host.
- A 5MB body with the marker after 3MB → no-marker error.
- `/user/NAME` blocked → `?user=NAME` feed.

**Route cases** (DB, CI, or locally with Postgres):
- `POST /api/sources` with a bare id → 200 and `url` equals the feed URL.
- `/api/sources/test` with a bare id → `resolved_url` set.
- `/api/sources/auto` with an `@handle` (resolver mocked) → row of type `youtube_channel`, name ending in `_yt`.

**Existing network-dependent test:** rewrite `test_resolve_channel_feed_url_raises_for_nonexistent_handle` against a mocked 404.

---

## 11. Overflow (requirement 10)

### 11.1 Root causes, from the measured audit (REDESIGN_PLAN.md §4; scan in shots/390-overflow-scan.json, 320-*)

- **R1. Unruled flex rows.** Text children lack `min-w-0`. Fixed-width siblings sit beside text: `w-44` search (App.tsx:2231), `w-28` thumbnail (Card.tsx:1734). Control rows don't wrap, so each control wraps inside itself (Card.tsx:976-1135).
- **R2. No shared gutter.** The Feeds tab has 0px (Settings.tsx:265) against 16px elsewhere.
- **R3. Hand-rolled type and a global override.** Sizes of 9, 10 and 11px (Card.tsx:1174, FeedManager.tsx:576-650, App.tsx:2709). The `!important` 16px override (styles.css:22-26) makes 13px controls jump to 16px on 18px lines, which clips the textarea's third line.
- **R4. Header crowding.** Four fixed 44px buttons plus a 34px title.
- **R5. One-line rows that grew features.** The feed row's name line holds 5 `shrink-0` chips (FeedManager.tsx:695-786). BriefCard's first-run header is `flex` without wrap (BriefCard.tsx:562).

### 11.2 Fixes per defect

| # | Defect | Fix | PR |
| --- | --- | --- | --- |
| 1 | Feeds tab touches the edges | Interim `pt-4 px-4` (Settings.tsx:265); replaced by grouped pages | 1, then 3 |
| 2 | Search squeezes the title; buttons off-screen at 320 | Search-bar mode (§3.1) | 1 |
| 3 | Headline beside thumbnail becomes a 10-17 line ribbon | Below `sm`, Thumbnail renders full-width `aspect-video` above the title (`order-first w-full`); the title is `min-w-0 flex-1`. From `sm` up, unchanged | 1 |
| 4 | "12m / ago" wraps | Source button `min-w-0 truncate`; dot and `<time>` `shrink-0 whitespace-nowrap` (Card.tsx:955-963) | 1 |
| 5 | Inline actions wrap mid-phrase | Row `flex flex-wrap gap-x-4 gap-y-1`; each action `inline-flex whitespace-nowrap min-h-[44px] -my-3 items-center` (Card.tsx:976-1135) | 1 |
| 6 | Auto-add button 49px off-screen at 320 | Interim: input `min-w-0 w-full`. Final: stacked field plus full-width button (§4.5) | 1, then 4 |
| 7 | Feed names clip early | Interim: chips move to the caption line. Final: Feeds list rows (§4.2) | 1, then 4 |
| 8 | "Pop…" at rest at 320 | Two-button top bar | 3 |
| 9 | Settings title wraps, Done squeezed | Interim: Done `shrink-0`, title `min-w-0 truncate`, "Settings → " dropped below `sm`. Final: NavBar | 1, then 3 |
| 10 | Sub-tab pills wrap | Interim: `px-2 whitespace-nowrap truncate`. Final: strip deleted | 1, then 4 |
| 11 | 16px override | Delete styles.css:22-26. Add `@layer base { input, select, textarea { font-size: max(1em, 16px); } }` (not important). Every new control uses `text-ios-body`. The guard asserts at least 16px | 1 |
| 12 | 9 and 10px text | 11px floor for decorative badges (tone chip, new-count badge); 13px for anything read; the 10/11px labels become `text-ios-caption` | 1 |
| 13 | Two clear buttons in search | `type="text" inputMode="search"` | 1 |
| 14 (added) | Brief tab first-run header clips Generate (BriefCard.tsx:562) | `flex-wrap` like :673; Generate full width on its own row below `sm`; pills 44pt (BriefCard.tsx:312) | 1 |
| 15 (added) | Toast clips errors to one line (Toast.tsx:122) | `line-clamp-3 break-words`; durations info 2.5s, error 4s, with action 5s (Toast.tsx:89-96) | 1 |
| 16 (added) | Hidden/Saved titles one line (Settings.tsx:1436) | `line-clamp-2 break-words` | 5 |

### 11.3 Layout contract

Written as the header comment of ui/Grouped.tsx and checked in review.

1. In a flex row, the text child is `min-w-0 flex-1`. It explicitly chooses either `truncate` (names, values) or `break-words` with `line-clamp-N` (titles, sentences, errors).
2. Every non-text sibling (icon, button, chip, time) is `shrink-0`. Short metadata is `whitespace-nowrap`.
3. No fixed widths on text or input containers on the phone. Widths come from flex, or `max-w-[50%]` for trailing values.
4. Rows with several controls use `flex-wrap gap-x-* gap-y-*`, so a whole control drops to the next line instead of wrapping inside itself.
5. One gutter: 16px (`px-4`/`mx-4`). Only full-bleed images may touch the edges.
6. Type comes only from tokens (`ios-large-title`, `ios-body`, `ios-caption`), with an 11px floor for decorative badges.
7. Form controls are at least 16px by construction. There is no global `!important`.
8. Horizontal scrollers are deliberate: `overflow-x-auto` plus a right-edge fade mask (`[mask-image:linear-gradient(to_right,black_85%,transparent)]`). They are the only places content extends past the screen.

### 11.4 The guard (frontend/scripts/iphone-audit/guard.cjs)

**Setup**
- CommonJS. Reuses `mockApi` and `IOS_UA` from capture.cjs:560.
- Fixtures added to fixtures.cjs:
  - a source with `builtin: true`
  - one with a long `custom_headers` User-Agent
  - an `auto_disabled` source with a 300-character `last_error`
  - a 40-character category
  - a YouTube source
  - a generic_scrape source with a sitemap
- The PATCH echo (capture.cjs:91-96) also returns `builtin`.
- Fix capture.cjs:53 to match on the pathname: `context.route(u => /^\/(api|auth|assets)\//.test(new URL(u).pathname), …)`.

**Run matrix**
- Widths 320×568@2x and 390×844@3x, each in a fresh context per state (avoids the late-session `pointer: coarse` flip, capture.cjs:428-431).
- Contexts use `isMobile`, `hasTouch` and the iOS user agent.
- From PR 5, also 844×390 landscape, asserting that the phone `main.md\:hidden` is displayed.

**States**

| PR | States added |
| --- | --- |
| 1 | dashboard (For You), a column with long titles, card summary open, search open, Brief tab, Settings Feeds, Add custom |
| 3 | Menu root, Feeds page, Show Stories From, AI & Brief, Notifications, History, Saved, Hidden, Reset; remove the old Settings states |
| 4 | feed page (custom with headers and long address), feed page (built-in), category picker, Add a Feed (YouTube selected, More Options open), Suggested, feed page with a 422 error caption |

**Rules (any failure → exit 1, with the element path printed)**

| Rule | Check |
| --- | --- |
| a. Document overflow | `documentElement`, `body` and `#root` scrollWidth ≤ innerWidth + 1. The body check matters: `overflow-x: clip` hides overflow from html.scrollWidth (styles.css:36). |
| b. Control off-screen | Every visible `a[href], button, input, select, textarea, [role=button], [role=switch], [role=tab]` lies within [−1, innerWidth+1] horizontally, unless an ancestor is an active horizontal scroller (`overflow-x: auto/scroll` and scrollWidth > clientWidth) |
| c. Text cut off | For every non-whitespace text node, each `Range.getClientRects()` rect lies inside its nearest ancestor with `overflow-x ≠ visible` (or the viewport), unless an ancestor up to that clipper has `text-overflow: ellipsis` or `-webkit-line-clamp` |
| d. Field font | Every `input, select, textarea` not `display: none`, including the `opacity-0` select overlays, has computed font-size ≥ 16px |
| e. Touch emulation | `matchMedia('(pointer: coarse)').matches === true` |
| f. Page health | No page errors besides the expected `/auth/me` 404, and no `!! UNMOCKED` request |
| g. Tap targets (from PR 3) | `[data-sheet] button, [data-sheet] [role=switch], header button` have a hit box ≥ 44px high, and ≥ 44px wide when icon-only. Elsewhere tap targets are warnings only |

**Visibility rule**
- An element counts as visible when its rect is larger than 1×1, `visibility` isn't hidden, and it is not inside `[inert]` or `[aria-hidden="true"]`. This skips lower NavStack levels, PullIndicator and `sr-only` legends.

**Output**
- PNGs per state go to an output folder, for eyes-on review. Wrapping that looks wrong is caught by looking, not by the rules.

**CI** (one step appended to `frontend-checks`, .github/workflows/build.yml:116-117; no new permissions or secrets):

```yaml
      - name: iPhone layout guard
        run: |
          npm i --no-save playwright@1.56.1
          npx playwright install --with-deps chromium
          ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
          for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 0.5; done
          node scripts/iphone-audit/guard.cjs http://127.0.0.1:4173 guard-out
```

**Locally:** the same, without `npm i`/`install`; the preinstalled chromium-1194 is used via `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

**run.sh fix:** use `./node_modules/.bin/vite preview … --strictPort` so `$!` is the server itself; drop the hardcoded `PLAYWRIGHT_BROWSERS_PATH` when it is already set.

---

## 12. Whole-app iPhone and ease-of-use checklist (requirements 6 and 7)

Each item: file:line, fix, PR. Items superseded by the redesign are marked.

### Real bugs

| # | Item | Fix | PR |
| --- | --- | --- | --- |
| 1 | Column header is a hidden "mark all read" (Column.tsx:314-321) | The header becomes static. Add "Mark All as Read" to the ⋯ popover, plus a 44pt text button at the end of the column list. Keep the Undo toast (App.tsx:1954-1971) | 5 |
| 2 | "+N new" chip triggers a refresh and the count never changes (Column.tsx:341-357) | Non-interactive badge | 5 |
| 3 | Login username autocapitalises (LoginPage.tsx:72-78) | `autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"`; the same on every feed field | 5; feed fields in 4 |
| 4 | Landscape iPhone gets the desktop grid (App.tsx:2594, 2655; BriefCard/FramingWatch `md:`) | tailwind.config.js `theme.screens = { sm:'640px', md:{raw:'(min-width: 768px) and (min-height: 600px), (min-width: 1024px)'}, lg:'1024px', xl:'1280px', '2xl':'1536px' }`. No `max-*` variants exist in src (checked), so this is safe. Header `sm:` becomes `md:` (App.tsx:2342) | 5 |
| 5 | `z-15` (App.tsx:2401) is not a Tailwind class | `z-10` | 1 |
| 6 | Polling toasts "refreshed" every minute (App.tsx:1112, 1245-1249) | `refresh({manual})`; toast only for manual: pull, Menu, desktop button, `r` key | 3 |
| 7 | Hide toast says "moved to history" (App.tsx:1615) while the menu path says "Entry hidden." | "Hidden" plus Undo on both paths | 5 |
| 8 | Phone tab remembered by index shifts when Saved or For You appear (App.tsx:835-845, 1358-1366) | Persist the column name under the new key `popping.v1.mobileCol.name` (storage.ts:52 area); migrate the index once; `-1` → `'__brief__'` | 4 |
| 9 | Bulk Clear all / Hide all downvoted act with no undo (Settings.tsx:1403-1410 → App.tsx:2854-2887) | Action toast with Undo restoring the previous array | 5 |
| 10 | Preference save failures are swallowed (preferences.tsx:523-532; stale comment :28-30) | One error toast per failure burst plus one retry; fix the comment | 5 |
| 11 | Native dialogs (App.tsx:306, 2826; Settings.tsx:413) | Inline field, inline chip rename, inline confirm | 3 |
| 12 | Card swipe lags the finger (Card.tsx:513) | `el.style.transition = animate ? 'transform 180ms ease-out' : 'none'` | 5 |
| 13 | Long-press copy fights the iOS link callout (Card.tsx:267, 585-593) | Gate the timer on `matchMedia('(hover: hover)')`; on touch the native callout gives Copy and Share | 5 |
| 14 | Thumbnail is a `div role=button` (Card.tsx:~1690-1760) | `<a href target=_blank rel="noopener noreferrer">` with the same click recording | 5 |
| 15 | Column popover closes on `mousedown` (Column.tsx:237-246) | `pointerdown` | 5 |
| 16 | Sign out impossible on the phone (App.tsx:2364) | Menu row | 3 |
| 17 | Drawer off-screen but focusable (Drawer.tsx:262-295) | Superseded: Drawer deleted; `inert` on `#root` and lower levels | 3 |
| 18 | Jump to column dead (App.tsx:2022-2030, 2598) | Superseded: removed | 3 |
| 19 | Back reopens Settings (App.tsx:438-444) | Superseded: §3.4 | 3 |
| 20 | Settings ignores the keyboard (Settings.tsx:204) | Superseded: §3.5 | 3 |
| 21 | No overscroll containment anywhere | §3.5, plus `overscroll-y-contain` on the phone column scroller (Column.tsx:489, App.tsx:2720) | 1 |
| 22 | Side safe areas in landscape | Header, phone `main`, tab strip: `pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`. The Sheet pads with the same | 5 |
| 23 | Inline `minHeight: '100dvh'` fights `height: 100%` (App.tsx:2188, styles.css:17) | Remove the inline minHeight | 5 |
| 24 | Native selects look like text boxes (Settings.tsx:779, 812, 855; Column.tsx:418, 462) | SelectRow, or the shared select class with an up/down chevron | 5 (feed selects in 4) |

### Tap targets (44pt, padding not visual size)

- PresetChips (App.tsx:273-370)
- filter chips and "clear all" (App.tsx:2369-2394)
- mobile column tabs (App.tsx:2677, 2703): `min-h-[44px]` button with an inner 32px pill, plus the fade mask
- card inline actions (§11.2 item 5)
- History pills (Settings.tsx:1227-1243): 44pt segmented control like Settings.tsx:299-317
- row actions in the Hidden, Saved and Downvoted lists (Settings.tsx:1446-1454)
- the AI Edit/Cancel, "type a name instead" and clear links (Settings.tsx:763-768, 828-834, 904-913)
- ShortcutsSheet close (ShortcutsSheet.tsx:93)
- card action icons 40→44 (Card.tsx:1254, 1281, 1324, 1368, 1396, 1431), keeping `data-*` hooks
- All in PR 5. Sheet and header targets are guaranteed by the primitives in PRs 3 and 4.

### Plain words

| Item | Change |
| --- | --- |
| api.ts:284 raw "500 … for /api/…" | `userMessage(err)` in lib/apiErrors.ts, used at App.tsx:1114-1115, SearchResults.tsx:81, LoginPage.tsx:105, Settings pages, BriefCard.tsx:594/785 |
| Column empty states (Column.tsx:824, 836, 844-849; App.tsx:2495) | "Waiting for the first check"; "Paused after N failed checks. Resume it in Menu → Feeds" |
| Column popover (Column.tsx:425-460) | Sort "Best First / Newest / Oldest"; the score slider becomes a SelectRow "Hide Lower-Ranked Stories: Off / Some / Most" (minScore 0/40/70) |
| AI page (Settings.tsx:540-947) | Provider and model become SelectRows, each saved on change, with an "Other…" free-text option. API keys commit on blur (write-only, blank = untouched). The save button goes. "Scoring model" becomes "Ranking model". Copy without ".env" |
| Brief tone (App.tsx:457) | Persisted per device (`popping.v1.brief.tone` in storage.ts) |
| Notifications page (Settings.tsx:361-371) | "Push notifications: Off. Whoever runs your Popping server can turn them on." |
| UserBadge "(local bypass)" (UserBadge.tsx:37), desktop health raw status (App.tsx:2344), desktop "Brief" button (App.tsx:2356-2363) | Bypass label removed; status → "All good" or "Problem"; button → "New Brief" |
| Settings.tsx:1110, 1165 literal "◯ with strike" | Eye-off icon |
| Settings.tsx:1526, 1598, 1683 right-click copy | "Tap the eye on a card…", "Tap the star…", "Tap ▼ under a card…" |
| Card.tsx:1392 star tooltip says "(s)" | "(b)" |
| Card.tsx:910 headline `aria-label` | Removed |
| README.md:283-339 Drawer chips | Updated (PR 3) |

### Pull to refresh (P, PR 3)

**Where it attaches**
- The phone column scroller (Column.tsx:489) gets `data-ptr-scroller` and `overscroll-y-contain`. iOS keeps the element's own rubber-band.
- `usePullToRefresh` attaches passive `touchstart`/`touchend`, plus a `scroll` listener, to the mobile `main` (App.tsx:2655).

**Behaviour**
- While a touch is active and `scroller.scrollTop ≤ −64`, the state is "armed" and PullIndicator flips its arrow.
- On `touchend` while armed: `refresh({manual: true})`; the spinner shows until it resolves.
- There is no `preventDefault`. Card swipes are horizontal with their own lock (Card.tsx:602-656), so they don't conflict.
- PullIndicator subscribes to a tiny module store, so Card and Column memo comparators are untouched (Column.tsx:881-909).
- The Brief tab is excluded.
- This can't be checked in Chromium (no rubber-band), so it is a manual phone check.

### Optional polish (PR 5, only if time)

- **Edge-swipe back** inside the sheet, only when `navigator.standalone === true` (the home-screen app has no system back gesture).
- Mechanics: a touch starting within 20px of the left edge with horizontal intent; the page follows the finger; release past 1/3 of the width → `popLevel()`.

---

## 13. Safety (requirement 8)

### Never touched by any PR

- docker-compose.yml, any Dockerfile, frontend/nginx.conf.template, egress-proxy/, ops/.
- No new published ports, services, daemons, containers, cron jobs or background processes.
- No new asyncio background tasks. The YouTube auto path deliberately does not spawn the discovery task.
- No new API routes; only the behaviour of existing ones changes.
- No service worker or PWA plugin (a service worker is a background process on the phone).
- No external fonts, scripts or styles (the nginx CSP is self-only, nginx.conf.template:29).

### Allowed files

- frontend/src/**
- frontend/scripts/iphone-audit/**
- frontend/tailwind.config.js (PR 5 screens; build-time CSS only)
- backend/app/youtube.py, config.py, schemas.py, scheduler.py, routes/sources.py
- backend/tests/**
- README.md, .env.example
- One step in `frontend-checks` of .github/workflows/build.yml (no `permissions`, no secrets)

### Outbound requests

| Host | When |
| --- | --- |
| youtube.com | Unchanged host; now with browser headers and consent cookies |
| www.googleapis.com | Only when the owner sets `YOUTUBE_API_KEY` |

- Every fetch goes through `check_url_safe`, `ssrf_event_hook` per hop, and the final-URL re-check (url_safety.py). If the hardened profile is on, the squid egress proxy still applies (it allows public hosts and denies private ranges, egress-proxy/squid.conf).
- The key is never logged and never echoed; error strings never contain the request URL's query.

### CI and Docker

- Playwright is installed only on the GitHub runner (`npm i --no-save`). It is not in package.json, so it never reaches the frontend Docker build stage (frontend/Dockerfile runs `npm ci` from the lockfile) or the runtime image (the nginx stage copies only `dist`).

### Per-PR gate

```
git diff --name-only origin/main...HEAD | grep -vE '^(frontend/src/|frontend/scripts/iphone-audit/|frontend/tailwind\.config\.js$|backend/app/(youtube|config|schemas|scheduler)\.py$|backend/app/routes/sources\.py$|backend/tests/|README\.md$|\.env\.example$|\.github/workflows/build\.yml$)'
```
- This must print nothing.
- Run the security-review skill on the diff.
- All four CI checks green.
- After popping-update on the VPS:
  - `docker compose ps` shows only `127.0.0.1:14789->8080`;
  - `ss -ltnp` shows no new listeners;
  - a feed refreshes.
- Rollback: `POPPING_IMAGE_TAG`, as in the plan's §2.

---

## 14. PR sequence (each branches from main, draft PR, CI green, merge)

Letters in brackets map to REDESIGN_PLAN.md §12. PR 1 and PR 2 are independent and can run in parallel. PR 3 needs PR 1 (guard). PR 4 needs PR 2 (`builtin`, header rule) and PR 3 (sheet and route).

### PR 1 [A]: Text that fits, and the guard

**Files**
- frontend/src/styles.css
- App.tsx: search-bar mode, z-10
- Card.tsx: thumbnail, meta row, inline actions, 11px tone chip
- BriefCard.tsx: header wrap, pills
- Toast.tsx: lines, durations
- Settings.tsx: interim gutter and header
- FeedManager.tsx: interim Auto-add, pills, chip line, 13px labels
- Column.tsx: `overscroll-y-contain`
- frontend/scripts/iphone-audit/guard.cjs (new), capture.cjs, fixtures.cjs, run.sh
- .github/workflows/build.yml (one step)

**Done when**
- `node guard.cjs` exits 0 at 320 and 390 for every PR 1 state.
- A scratch edit (`w-[420px]` on the search pill) makes it exit 1 naming that element, at 390. Revert the edit; it is not committed.
- `grep -rn "!important" frontend/src/styles.css` returns nothing.
- The guard's field-font rule passes, so every control is at least 16px.
- PNGs reviewed:
  - the headline reads in one column at 320;
  - "12m ago" stays on one line;
  - "Discussed on Reddit" doesn't break mid-phrase;
  - search with Cancel fits at 320;
  - the Brief tab shows Generate.
- `npm run lint` has 0 errors and at most the 6 baseline warnings; `npm run build` passes.
- CI is green, including the new step.

### PR 2 [C]: Backend: YouTube that adds, plus the editor contract

**Files**
- backend/app/youtube.py, config.py, schemas.py (`SourceOut.builtin: bool = False`; auto kind), scheduler.py (category-only change skips the job rebuild), routes/sources.py
- .env.example, README.md
- backend/tests/test_youtube.py, backend/tests/test_source_editor_contract.py (new)
- frontend/src/components/FeedManager.tsx: `friendlyTestError` `invalid_url` passes the raw text through; YouTube label "YouTube link or channel ID" and the channel-ID footer
- frontend/src/api.ts: `Source.builtin`, auto kind

**sources.py changes**
- A `_source_out(row, builtin_names)` helper used by list, get, create, auto and patch.
- `_validate_category` returns the normalised value, which is then stored.
- `_HEADER_NAME_RE`.
- Reddit Test: `from app.reddit_client import fetch_subreddit` and `fetch_subreddit(normalize_subreddit(url), listing="hot", limit=50)`. An empty list maps to `ok=False, error_kind="not_found"` with "Reddit returned no posts. The subreddit may be private, banned or rate-limited."
- The auto endpoint handles YouTube.

**Done when**
- New tests pass with the network off (`-m no_db` locally, plus DB tests via the §15 recipe), and in CI.
- `GET /api/sources` has `builtin: true` exactly for the 7 registry names, including `rfd_hot_deals`.
- PATCH `{"category":"  Tech  "}` stores "Tech".
- PATCH `{category}` alone causes no `add_job` call on a fake `_scheduler`; PATCH `{custom_headers}` and `{url}` do.
- PATCH with header `{"": "x"}` or `{"Bad Header": "x"}` → 422.
- Each existing 422/400/409 rule has a route test: deny list, 20 entries, 512 characters, CRLF, empty category, more than 40, reserved, name regex, built-in rename, collision, refresh clamp.
- YouTube: bare id, feed link and `/channel/` resolve with zero HTTP calls; a consent redirect yields the channel-ID message; with a key the API path resolves; no message contains `key=` or a stack text; the auto endpoint creates `youtube_channel`.
- Existing YouTube, sitemap and frontend-guard tests are unchanged and passing.
- Manual after deploy: on the phone, add one channel by @handle, and one by channel ID.

### PR 3 [B]: One Menu button and the Menu sheet

**Files**
- New: lib/sheetRoute.ts, lib/useVisualViewport.ts, lib/usePullToRefresh.ts, components/ui/{Sheet,NavStack,Grouped,Field,SelectRow,Switch,SaveIndicator,icons}.tsx, components/menu/{MenuSheet,MenuHome,FilterPage}.tsx, components/PullIndicator.tsx
- Changed: App.tsx, Settings.tsx (`SettingsPageBody`, Reset inline, labels), Toast.tsx (portal, `z-[60]`), Column.tsx (`data-ptr-scroller` and indicator), Hamburger.tsx (comment), README.md
- Deleted: Drawer.tsx
- Guard: states and selectors updated (capture.cjs:478-541 and probe.cjs:27-37 use the new labels)
- In this PR, the Feeds page still renders FeedManager's existing content, and the ⓘ in Show Stories From is hidden until PR 4.

**Done when**
- At 320 and 390, the header has exactly three elements: title, search, menu.
- `grep -rn "open settings\|data-settings-gear\|window.prompt\|window.confirm" frontend/src` returns nothing.
- Playwright:
  - open the Menu; push and pop every row's page; Done from depth 2 leaves `location.search` without `view`, `tab`, `page` or `pick`;
  - after Done, `history.back()` does not reopen the sheet;
  - `?view=settings&tab=history` opens History, and its back chevron shows the Menu;
  - Esc closes and focus returns to the menu button;
  - with the sheet open, Tab never reaches a card;
  - the first pick in Show Stories From closes the sheet and the Filtering column shows;
  - Save This View creates a preset chip;
  - Sign Out shows when the mock `/auth/me` returns a user.
- The poll produces no toast; Refresh Now produces one.
- Guard green, including the tap-target rule.
- Manual phone checks:
  - focus a field: the sheet stays above the keyboard and Done stays visible;
  - swipe down to close;
  - pull to refresh;
  - Back in Safari tab mode walks the pages.

### PR 4 [D]: The feed page that saves itself, category picker, headers

**Files**
- New: components/feeds/{FeedEditorPage,CategoryPickerPage,HeadersEditor}.tsx, lib/{sourceSaves,categories,headers,apiErrors,slug}.ts
- FeedManager.tsx: page exports; deletions per §6; guard literals kept
- api.ts
- App.tsx: overlay and helpers, `onSourceTap` stable through a ref, preset remap, tab-by-name
- Card.tsx: the source label becomes `<button data-card-interactive onTouchStart={e => e.stopPropagation()} onClick={e => {e.stopPropagation(); onSourceTap?.(sourceName)}} className="min-w-0 truncate font-semibold -mx-2 px-2 -my-3 py-3">`
- Column.tsx: thread `onSourceTap`. The comparators ignore callbacks (Card.tsx:1460-1475, Column.tsx:881-909), so it must stay stable.
- menu/MenuSheet.tsx, menu/FilterPage.tsx: ⓘ
- Guard states, plus guard-behaviour checks

**Done when (Playwright with the mocked API, counting `request.method() === 'PATCH'`)**
- Typing in Name without leaving it → 0 PATCHes.
- Return → exactly 1, with body `{name}`.
- Tapping a category → 1, with body `{category}`; the page pops.
- Toggling Paused → 1.
- Changing Check Every → 1.
- Editing a header's name then its value then tapping outside → 1, with body `{custom_headers:{…}}`.
- Removing the last header → `{custom_headers:null}`.
- "Use a Browser Identity" → 1, with a User-Agent.
- A page-level `route.fulfill({status:422, json:{detail:"category 'For You' is reserved for a built-in column"}})`:
  - discrete control: value rolls back and the caption shows;
  - text field: the draft is kept.
- `route.abort('failed')` twice → the "Couldn't reach Popping" caption with Try Again.
- PATCH delayed 1s, then Done → the request completes and the Feeds row shows the new value on reopen.
- A stale list response delivered after the PATCH → the UI keeps the new value.
- A built-in fixture shows read-only Name and Address and no Headers section.
- A rename remaps the active filter chip and preset names.
- Card source tap opens the feed page; back chevron → Feeds; back → Menu; Done → dashboard with a clean URL.
- Quick add with a YouTube link lands on the new feed page.
- Guard green.
- `pytest -m no_db` passes with test_frontend_slice15 and test_source_create_sitemap_link_pattern unchanged.
- lint and build pass.

### PR 5 [E]: Sweep

**Files:** §12 items marked 5, across frontend/src, plus tailwind.config.js.

**Done when**
- Every §12 item is either fixed (file:line in the PR description) or struck with a one-line reason.
- The guard runs the landscape state (844×390, phone layout) and passes.
- Manual phone check: rotate the phone, and try Page Zoom at 125%.

---

## 15. Verification recipe (corrects the plan's §13)

**Frontend**
```
cd frontend && npm ci && npm run lint && npm run build
./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
node scripts/iphone-audit/guard.cjs http://127.0.0.1:4173 <scratchpad>/guard-out
kill %1
```
- Look at the PNGs.
- Never run `npx playwright install` in the container: the CDN is blocked; chromium-1194 is preinstalled.

**Backend, locally (C9)**
1. Postgres 16 cluster via `initdb`/`pg_ctl` as the postgres user.
2. `apt-get install -y postgresql-16-pgvector`, or the verified pgvector v0.8.7 source build.
3. `CREATE EXTENSION vector`.
4. Add /etc/hosts entries for example.com/org/net and reddit.com; the SSRF guard resolves DNS (url_safety.py:150).
5. `uv venv --python 3.12` and `uv pip install --no-deps -r backend/requirements-dev.lock`.
6. `PYTHONPATH=$PWD python -m pytest -ra`. Baseline is 623 passed. `-m no_db` needs no Postgres.

**Notes**
- The YouTube tests need no DNS, because `getaddrinfo` is patched.
- CI stays the authority. Use REST for checks (`gh api …/commits/<sha>/check-runs`); `gh pr view` fails with a GraphQL 403.

---

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| History edge cases (rapid taps, external history changes, reload of deep links) | Depth in `history.state`; double-tap guard; post-close URL check; Playwright cases in PR 3 |
| visualViewport jank on older iOS | rAF throttle; fallback to the static top-pinned layout when `visualViewport` is missing |
| Pull to refresh relies on WebKit rubber-band and negative `scrollTop`; Chromium can't test it | Menu → Refresh Now and the 60s poll remain; manual phone check; the hook is a no-op when `scrollTop` never goes negative |
| Removing the 16px override reintroduces focus zoom somewhere | Base `max(1em,16px)` rule; primitives at 17px; guard rule d covers every state, including `opacity-0` selects |
| Every effective PATCH starts an immediate fetch (scheduler.py:2455-2461) | Commit-on-end only; category-only skip in PR 2; headers and URL rebuild on purpose (C1) |
| Polling overwrites optimistic state | §7.5 overlay; Playwright stale-list test |
| Pinned source-text tests | Keep literals in FeedManager.tsx; run `pytest -m no_db` before every push |
| YouTube still blocks the VPS IP even with consent cookies | A plain message that teaches the channel ID (always works, no network); `/user/` feed fallback; optional API key; Test shows the result before Add |
| Smart-punctuation or curly quotes in header values | Normalisation plus a clear caption |
| `inert` support (iOS 15.5+) and portal changes | Feature-detect: if `'inert' in HTMLElement.prototype` is false, fall back to `aria-hidden` plus the focus trap |
| Toast portal ordering | Explicit `z-[60]` |
| Card source label mis-taps near the headline link | The label sits on its own meta line; negative-margin hit area stays inside the card padding; `data-card-interactive` stops swipe and long-press arming |
| Menu replaces the Drawer's right-hand panel (muscle memory) | That was the owner's request; filtering is one tap from a card |
| PR 5 is large | Split by area (cards, column, AI page, lists) if needed; each item is independent |
| A Dependabot-style Playwright bump would need an unavailable Chromium revision | Avoided: not a package.json dependency; CI pins `1.56.1` in the command |

---

## 17. Alternatives considered and rejected

| Alternative | Why rejected |
| --- | --- |
| A second editor sheet over Settings, with the Drawer as the Menu (the draft) | Two presentations, stacked sheets, the same duplication the owner reported |
| A custom div picker instead of a native `<select>` | Loses the iOS wheel, needs its own focus and zoom handling, and global shortcuts would fire while "typing" (App.tsx:1754-1764) |
| Time-debounced autosave (600ms) | Saves half-typed URLs and triggers a fetch per pause |
| Merging different fields into one PATCH | Ambiguous error attribution |
| A long-press action sheet on cards for "Edit feed" | Conflicts with the native link callout; the source-label tap is discoverable and one tap |
| The InnerTube `resolve_url` endpoint for YouTube handles | Unofficial and fragile |
| A service worker for offline use | A background process on the device; out of scope |
| Vitest | Outside the plan's dependency scope; Playwright behaviour checks cover autosave |
| `md` breakpoint by pointer type | iPads with keyboards would flip; width plus height is more predictable |


### Structural fix: shared iOS primitives, one save model, one menu, and an enforced iPhone contract

Key decisions:
- Feed editor is a pushed page inside the single Settings sheet (?view=settings&tab=feeds&page=<id>[/category]), not a second stacked sheet; keeps one visible overlay, one keyboard handler, and Toast moves to its own z-60 layer.
- Top bar keeps search + refresh + exactly one Menu button; gear (App.tsx:2305-2331, data-settings-gear) is deleted; Drawer becomes shell/Menu.tsx whose first row 'Settings' replaces 'All settings…', History quick-row removed, 'Save current view' becomes an inline field (no window.prompt).
- Fastest edit path is Menu → ✎ on the feed's filter row (2 taps to the editor); the draft plan's 'card options chevron' path is dropped because no touch card menu exists (context menu is right-click only, Card.tsx:708-808).
- Settings' 8-pill tab strip and FeedManager's nested tab strip are replaced by an iOS root list + pushed pages; URL contract kept (legacy ?tab= links work) and extended with page=; one lib/route.ts store with history.state depth replaces App.tsx:394-444 and the synthetic popstate, so Done uses history.go(-depth) and never re-opens on Back.
- One save model everywhere: useAutosaveField + per-record serial SaveQueue (module-level, survives unmount); text commits on blur/Enter only (no keystroke debounce because each PATCH triggers an ingest), discrete controls on change; single-key PATCH bodies; same-field coalescing; commit tokens; equality skip guarantees one PATCH per real change.
- Optimistic at the control, authoritative at the list: App updates sources from the PATCH response (preserving net_vote_score) and a localWriteAt guard stops older background polls from overwriting fresh writes; text errors keep the draft with Retry/Undo, discrete errors revert.
- Closing mid-save: Sheet blurs the focused field before closing so pending text commits, in-flight saves finish after unmount, keepalive fetch survives page hide, and post-close failures surface as a z-60 error toast with an 'Open' action; errors never go to App's banner (which sits under the sheet).
- Category picker derives options from sources (never from App's entry-derived categories), normalizes new names (trim, lowercase, reuse existing case-insensitively), and mirrors backend rules (≤40, not saved/for you); backend strips but does not lowercase.
- Headers editor is a key/value row editor with 'Pretend to be a browser' and 'Prefer English' presets, client mirror of the backend denylist/limits/token rule, whole-map commit on row focus-out, null when empty, hidden for built-ins and reddit.
- Backend: only category-only PATCHes skip the scheduler rebuild (name/url/headers are bound into the job's plugin args), builtin flag on SourceOut, category strip, header-name token check, reddit Test import fix, route tests pinning every 400/409/422.
- YouTube fix: offline resolution for every id-bearing shape (channel, feed links, /user, playlist, bare UC id), browser UA + consent cookie page fetch with six ordered markers, optional YOUTUBE_API_KEY via X-Goog-Api-Key header, plain-language blocked/not-found messages with a channel-ID fallback, /auto routes YouTube and Apple Podcasts links, POST name optional with server-derived '<handle>_yt'; tests run fully offline via an httpx MockTransport seam and patched resolve_addresses with SSRF hooks still active.
- Overflow fixed by root cause (shrink policy in Row/meta-line/action-bar, container-query thumbnail, Sheet/List-owned gutters, 17px-designed controls, 11px floor, search kind) rather than per element; guarded by a smoke test whose rules (painted-ancestor spill, label wrap, page width, min text, field font, tap size) avoid the ~25 false positives per state the draft plan's 'beyond parent' rule produces.
- Mobile contract enforced three ways: ESLint core rules (no new deps) banning raw controls/datalist/native dialogs/tiny text/vh/sub-44px/mousedown/fixed outside ui/; a Playwright smoke at 390 and 320 with fresh context per state, fixed clock, production CSP, behavior flows; and a short on-phone checklist for what Chromium cannot emulate. Enforcement scope grows per PR so every PR is green.
- VPS safety: no ports/services/daemons/containers/compose/Dockerfile/nginx/egress/ops changes; playwright is a build-stage devDependency only; one CI step; SSRF guards unchanged and still wired; new /auto paths start no background tasks; a pre-push path-allowlist command stops any out-of-scope file.
- Eight PRs in order: (1) YouTube, (2) feed API contract, (3) guardrails + dashboard text fit, (4) one button + Menu/Settings on Sheet, (5) feed editor with autosave/picker/headers, (6) all Settings pages + no native dialogs + delete the 16px !important rule, (7) dashboard behavior sweep, (8) landscape breakpoint; each branches from main because CI only runs on PRs into main.
- Brief tone persisted per device in localStorage rather than server preferences, to avoid touching backend/app/routes/preferences.py (outside the allowed file list).


# Popping redesign: the structural fix

**Angle.** Complaints 6 and 7 ("you shouldn't have to report iPhone problems one by one", "basic ease-of-use should already be there") come from one cause. Every screen hand-rolls its own rows, inputs, sheets and save buttons. So every screen gets a different subset of the iPhone rules right.

The fix has four parts:

1. A small set of shared primitives (`components/ui/*`) and hooks (`lib/*`) that carry the rules by construction.
2. Moving the top bar, the Menu, every Settings page and the feed editor onto those primitives, so that every form saves the same way.
3. A written mobile contract, enforced three ways:
   - ESLint core rules (no new lint dependencies) that ban the raw patterns;
   - a Playwright smoke test in CI that measures the rendered app at 390 and 320 CSS px;
   - a short on-phone checklist for what Chromium cannot emulate.
4. The two backend fixes (YouTube, the feed PATCH contract), with offline tests.

Everything ships as 8 pull requests (PRs). Each one is shippable and reviewable on its own.

All file:line references are to origin/main 721713e unless stated. Every one was re-checked in this session.

---

## 0. What changes relative to REDESIGN_PLAN.md

**Kept (correct against the code):**
- The YouTube diagnosis: `Popping/0.2` UA at config.py:392, a single `"channelId"` marker at youtube.py:38, and feed links mis-handled.
- The 13 measured overflow defects in section 4.
- Autosave sends one PATCH per committed change, never per keystroke. Every effective PATCH re-adds the job with `stagger=False` (scheduler.py:2462-2469 → :2144).
- A `builtin` flag on SourceOut replaces `KNOWN_BUILT_INS`. The client list has 6 names; the backend registers 7, and `rfd_hot_deals` is missing (rfd.py:177).
- Category strip in the route; reddit Test import fix (sources.py:1008 vs reddit_client.py:677); blank header names rejected.
- `history.back()` on Done.
- `SETTINGS_TABS` exported once.
- The source-text guard tests must change in the editor PR.
- No `window.prompt` / `window.confirm`.
- Remove the dead `onResetLocalState` prop, `data-settings-gear` and the stale comments.

**Corrected:**

1. **No card "options" menu exists.**
   - Plan §5 path 2 says "On any card, open its options (the chevron under the card)". The chevron toggles the summary.
   - The only card menu is right-click (`onContextMenu`, Card.tsx:708-808, bound :879), which never fires on iPhone.
   - Replaced by an edit button on every feed row in the Menu.
2. **The no-rebuild rule as written is unsafe.**
   - Plan §6 says skip the job rebuild when only `category`, `name` or `custom_headers` changed. The job's args bind a plugin built from the row (`args=[plugin]`, scheduler.py:2101-2151).
   - `DynamicRssPlugin` copies `name` at construction (dynamic_rss.py:56) and reads `custom_headers` from the bound row at fetch time (:71). Skipping the rebuild would keep fetching with the old headers and name.
   - Only a **category-only** PATCH may skip the rebuild: ingest reads the category from the fresh DB row (scheduler.py:431).
3. **Columns come from entries, not sources.**
   - Plan §7 says "App builds the dashboard columns from the categories present in `sources`". Columns are actually built from *visible entries* grouped by their source's category (App.tsx:753-764).
   - A category whose feeds have no entries has no column. The picker must derive from `sources`, never from App's `categories`.
4. **The editor should not be a second sheet stacked over Settings** (plan §6: z-50 after Settings).
   - That means two overlays, z-order juggling, Toast re-layering, and two copies of the keyboard handling.
   - The editor becomes a **pushed page inside the one Settings sheet**, the iOS Settings pattern, and keeps a single visible overlay.
5. **Line numbers and names in the plan:**
   - gear is App.tsx:2305-2331, hamburger App.tsx:2333 (not 2272-2301/2306);
   - the reserved set is `_RESERVED_CATEGORY_NAMES` at sources.py:162 (not `_RESERVED_CATEGORIES` near :154);
   - the header denylist is :169-187;
   - the test endpoint honours headers at sources.py:988-995 for rss/podcast/youtube only, not for generic_scrape (:1000-1004).
6. **`openSettings` callers.** No keyboard shortcut or BriefCard pill calls `openSettings`. The only callers are the gear (App.tsx:2307) and the Drawer wiring (App.tsx:2811).
7. **The YouTube section missed three causes of "cannot be added":**
   - **(a) The Auto-add box ignores YouTube.** It is the first box on the Add tab. `POST /api/sources/auto` (sources.py:573-644) never calls the YouTube resolver: it runs generic feed discovery or sitemap scraping on youtube.com.
   - **(b) Every Add failure is invisible on the phone.** Failures go to `onError` → App's red banner (App.tsx:2397-2411), which renders *under* the z-50 Settings sheet. So the owner taps Add and nothing happens.
   - **(c) The form demands an invented slug name** (FeedManager.tsx:1372-1375, 1531-1541).
   - **The existing tests are not offline.** test_youtube.py:115-133 and :164-174 hit youtube.com and pass only because the request fails.
8. **The plan's overflow gate would be permanently red.**
   - Plan §4 says "fails when any element's text or box extends past its parent". On today's build that flags about 25 items per state at 390px. They come from intentional negative-margin hit areas (`-ml-3`, `-mr-2`, `mt-2 -mb-1 flex` in the card action row; measured in shots/390-overflow-scan.json, 81 hits across 11 states).
   - The gate in §8 uses rules that separate real overflow from intentional hit areas, and it is switched on per surface as each surface is fixed.
9. **Allowed-files list.**
   - It omits `frontend/eslint.config.js` and `frontend/tailwind.config.js`, which the lint rules and tokens need. Both are build-time only.
   - `backend/app/routes/preferences.py` is *not* needed: brief tone is persisted per device in localStorage instead.
10. **§13 "no Postgres, pytest only in CI" is outdated.** The local recipe works (623 passed) once pgvector, a cluster and /etc/hosts entries are set up; see §11.
11. **No Menu rows for Refresh or Brief.** Plan §9 adds Menu rows "Refresh now" and "New brief". These duplicate the top-bar refresh icon and the Brief tab, which is exactly the duplication complaint 5 is about. Dropped.

---

## 1. Safety posture (requirement 8)

**What stays the same:**
- No new published ports, services, daemons, containers, cron jobs or background tasks.
- No changes to docker-compose*.yml, any Dockerfile, frontend/nginx.conf.template, egress-proxy/**, ops/**.
- No new runtime dependencies on either side.

**What changes:**
- `playwright@1.56.1` is a frontend **devDependency**. It is used only in the Docker build stage (frontend/Dockerfile:3-14 is multi-stage; the runtime image is nginx with `dist/`), and it has no postinstall step, so no browser download happens.
- Backend tests use `httpx.MockTransport`, which ships with httpx.

**Outbound fetches:**
- The YouTube page lookup keeps `check_url_safe` before the request, `ssrf_event_hook` on every hop, and the final-URL check. The source-text test at test_youtube.py:77-88 stays.
- The optional Google API call goes to `www.googleapis.com` through the same guarded client.
- The API key is sent as the `X-Goog-Api-Key` header, never in the URL, so it cannot leak through httpx's request logging. It is never returned by any endpoint and never stored in the DB.

**Background work:**
- The new `/auto` YouTube and Podcast paths do not start LLM discovery tasks.
- The category-only PATCH rule *removes* an ingest.

**CI change:**
- One added step in `frontend-checks` (build.yml:101-117). It needs no new permissions or secrets and runs only on GitHub runners.

**Files any PR may touch:**
- `frontend/src/**`, `frontend/scripts/**`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/eslint.config.js`, `frontend/tailwind.config.js`
- `backend/app/youtube.py`, `backend/app/config.py`, `backend/app/schemas.py`, `backend/app/scheduler.py`, `backend/app/routes/sources.py`
- `backend/tests/**`
- `README.md`, `.env.example`, `.github/workflows/build.yml` (one step only)

**Pre-push stop check (run in every PR):**
```
git diff --name-only origin/main...HEAD | grep -vE '^(frontend/(src/|scripts/|package(-lock)?\.json$|eslint\.config\.js$|tailwind\.config\.js$)|backend/app/(youtube|config|schemas|scheduler)\.py$|backend/app/routes/sources\.py$|backend/tests/|README\.md$|\.env\.example$|\.github/workflows/build\.yml$)' && echo "STOP: file outside the allowed list"
```

**Before each merge:**
- Run the security-review skill on the diff.
- All four CI checks green: backend tests, frontend lint + build (+ smoke), backend image, frontend image.

**After popping-update on the VPS:**
- `docker compose ps` shows only `127.0.0.1:14789->8080`.
- `ss -ltnp` shows no new listener.
- A feed refreshes.

**Rollback:** set `POPPING_IMAGE_TAG=sha-<prev>` and run `docker compose up -d`.

---

## 2. Architecture

### 2.1 New layout

```
frontend/src/components/ui/        shared primitives (components only; react-refresh rule stays clean)
  Sheet.tsx  List.tsx  TextField.tsx  Select.tsx  Toggle.tsx  Segmented.tsx  ChoiceList.tsx
  KeyValueEditor.tsx  Button.tsx  ConfirmAction.tsx  SaveStatus.tsx  Disclosure.tsx
  InlineMessage.tsx  Slider.tsx  Checkbox.tsx  icons.tsx
frontend/src/components/shell/     AppHeader.tsx  Menu.tsx (replaces Drawer.tsx)  PresetChips.tsx
frontend/src/components/settings/  SettingsRoot.tsx  AiPage.tsx  NotificationsPage.tsx  HistoryPage.tsx
                                   EntryListPage.tsx  ResetPage.tsx
frontend/src/components/feeds/     FeedsPage.tsx  FeedList.tsx  FeedEditor.tsx  CategoryPicker.tsx
                                   HeadersEditor.tsx  AddFeed.tsx  RecommendedFeeds.tsx
frontend/src/lib/                  route.ts  saveQueue.ts (pure)  autosave.ts  apiErrors.ts
                                   categories.ts (pure)  headers.ts (pure)  viewport.ts
frontend/scripts/iphone-audit/     mock-api.cjs  checks.cjs  states.cjs  flows.cjs  smoke.cjs  smoke.sh
                                   (+ existing capture.cjs/run.sh/fixtures.cjs/probe.cjs/analyze.cjs)
frontend/scripts/unit/             saveQueue.test.ts  categories.test.ts  headers.test.ts
```

- `Settings.tsx` stays as the overlay shell, shrinking as pages move out.
- `FeedManager.tsx` (1809 lines) is deleted in PR 5.
- `Drawer.tsx` becomes `shell/Menu.tsx` in PR 4.

### 2.2 Tokens (frontend/tailwind.config.js)

**Font sizes.** Keep `ios-large-title` 34/41, `ios-body` 17/22, `ios-caption` 13/18. Add:
- `ios-title3` 20/25, weight 600, for sheet titles (replaces `text-2xl` at Settings.tsx:219 and Drawer.tsx:322);
- `ios-subhead` 15/20;
- `ios-caption2` 11/13, the floor for any readable text.

**zIndex scale (extend):**

| Token | Value | Used by |
|---|---|---|
| `banner` | 10 | replaces the no-op `z-15`, App.tsx:2401 |
| `header` | 20 | App.tsx:2210 |
| `popover` | 25 | Column popover, Column.tsx:411 |
| `menu-backdrop` | 30 | |
| `menu` | 40 | |
| `sheet` | 50 | |
| `toast` | 60 | so a toast is above any sheet regardless of DOM order (Toast.tsx:117) |

**Animations.** Keep `sheet-up` (tailwind.config.js:97-100, :116): Sheet finally uses it. Fix its comment.

**Screens (PR 8 only).** Override `md` to `{ raw: '(min-width: 768px) and (min-height: 560px), (min-width: 1024px)' }`.
- This stops an iPhone in landscape (812-932 x ~390-430) from getting the desktop grid. App.tsx:2594/2655, FramingWatch.tsx:175.
- iPads and desktops are unchanged.
- The JS media query in BriefCard.tsx:372 switches to `PHONE_QUERY` from lib/viewport.ts.
- The header's `sm:` switches (App.tsx:2231, 2294, 2341) become `md:`.

**Typography rule.** Every input, select and textarea is designed at `text-ios-body` (17px) with a 24px line height and `min-h-[44px]`. The `(pointer: coarse) … 16px !important` override (styles.css:24-26) is deleted in PR 6, once lint proves no raw control remains.

### 2.3 Primitives (each owns one class of iPhone rule)

**`ui/Sheet.tsx`.** Props: `open, onClose, label, presentation: 'sheet' | 'panel-right', width: 'menu' | 'settings', title, back?: {label, onClick}, doneAriaLabel?, children, onClosed?`.

The single implementation of an overlay:
- **Layers:** backdrop `z-menu-backdrop` / `z-sheet`.
- **Presentation `sheet`:** phone bottom sheet pinned by its top edge at `env(safe-area-inset-top)+0.75rem` (PR #11 rule kept, Settings.tsx:198-204). On md+ it is a right-hand 480px panel.
- **Presentation `panel-right`:** 88vw / max 420px on phones, 360px on md. This is the Menu.
- **Safe areas** on all four sides via `pl/pr-[max(1rem,env(safe-area-inset-left|right))]`.
- **Header:** back button on the left if given (44px, `‹ Label`), title `min-w-0 flex-1 truncate text-ios-title3`, and a trailing **Done** button `min-h-[44px] min-w-[44px] px-3`. This fixes the 32px Done at Settings.tsx:215 and Drawer.tsx:318, and moves Done to the iOS trailing edge.
- **Scroll body:** `flex-1 min-h-0 overflow-y-auto overscroll-contain`. Bottom padding is `calc(2rem + env(safe-area-inset-bottom))` when the keyboard is closed and `1rem` when it is open.
- **Keyboard:**
  - With `visualViewport` available, the backdrop's inner box is positioned at `top: vv.offsetTop`, `height: vv.height` (from `useVisualViewport()` in lib/viewport.ts), so the sheet's bottom sits on top of the keyboard and its header never pans away.
  - On `focusin` inside the body, the focused field gets `scrollIntoView({block:'nearest'})` after the next viewport resize.
  - Without `visualViewport`, it falls back to `inset-0`.
- **Esc:** a capture-phase listener with `stopPropagation`, the same contract as Settings.tsx:169-180 and Drawer.tsx:119-130.
- **Focus:** a focus trap; initial focus on Done.
- **Dismiss:**
  - Backdrop tap closes.
  - Swipe-to-dismiss: the bottom sheet drags vertically **on the header/grabber only**, so it cannot fight scrolling. `panel-right` keeps Drawer.tsx:132-193 plus a direction lock (ignore the gesture once |dy| > |dx| within the first 10px).
- **Motion:** `motion-safe:` transitions.
- **Closed state:** `inert` + `aria-hidden` while closing; unmounted after the exit animation (200ms). This fixes the focusable closed Drawer at Drawer.tsx:262-295.
- **Before `onClose`:** the Sheet blurs the focused element, so a text field's blur-commit fires before the close.

**`ui/List.tsx`.** `List` (lifted from the private `GroupedSection`, Drawer.tsx:508-541), `Row` and `FieldRow`.
- `List` props: `label?`, `footnote?`, `action?`; it owns the `mx-4` gutter.
- **`Row`** (from `GroupedRow`, Drawer.tsx:552-602, which is file-private today):
  - Props: `icon?`, `title`, `subtitle?`, `lines?: 1|2`, `value?`, `accessory?: 'chevron'|'check'|ReactNode`, `onClick?`, `as?: 'button'|'label'|'div'`, `tone?`, `status?`, `trailingAction?`.
  - Layout contract: `min-h-[44px]`; title `min-w-0 flex-1`, `truncate` or `line-clamp-2`; value `shrink-0 max-w-[45%] truncate`; accessory and trailing action `shrink-0 whitespace-nowrap`.
- **`FieldRow`**: a stacked layout (label above control) for text inputs at 320px. Props `label, hint?, status?, error?`.
- Because these own gutters and flex behaviour, a page cannot forget `px-4` (defect 1) or `min-w-0` (defects 4, 7, 9).

**`ui/TextField.tsx`.**
- Props: `kind: 'text'|'slug'|'url'|'search'|'secret'|'header-name'|'header-value'|'multiline'`, `value`, `onChange(value: string)`, `onCommit?(value)`, `placeholder`, `disabled`, `readOnly`, `id`, `aria-label`, `autoFocus?`, `maxLength?`.
- `kind` sets the iOS attributes, so they can no longer be forgotten:

| kind | Attributes |
|---|---|
| slug | `autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"` |
| url | `type="url" inputMode="url"`, no capitalisation or correction |
| search | `type="text" inputMode="search" enterKeyHint="search"`, so there is no second native clear button (defect 13) |
| secret | `type="password" autoComplete="off"` |
| header-name | no capitalisation or correction |
| multiline | a `<textarea>` with no commit on Enter |

- Always `w-full min-w-0 min-h-[44px] text-ios-body leading-6`.
- `onCommit` fires on blur and on Enter (Enter also blurs).

**`ui/Select.tsx`.**
- Props: `value, options: {value,label}[], onChange, aria-label, formatUnknown?`.
- A native `<select>` with `appearance-none`, an inline SVG chevron (fixes iOS selects looking like text boxes, Settings.tsx:779), 44px, 17px, `truncate`.
- If the current value is not in the options, it is shown as an extra option, e.g. a 300s refresh shows "Every 5 min". This matters because `REFRESH_PRESETS` (FeedManager.tsx:55-60) lacks 300 while fixtures and real data use it.

**Other primitives:**

| Primitive | Behaviour | Replaces |
|---|---|---|
| `ui/Toggle.tsx` | `role="switch" aria-checked`; 51x31 visual inside a 44px hit area | pause/resume text link (FeedManager.tsx:789-797) |
| `ui/Segmented.tsx` | 44px segments, `whitespace-nowrap` labels | brief tone (Settings.tsx:299-317), History group-by 28px pills (:1218-1244), BriefCard tone picker (BriefCard.tsx:287-325) |
| `ui/ChoiceList.tsx` | a `List` of `Row`s with a check accessory, for closed or long sets | source type radios, category page, provider |
| `ui/KeyValueEditor.tsx` | generic rows `{id,key,value}` with `validateRow`, `presets`, `addLabel`, `onRowsChange`, and `onCommit(rows)` fired on row focus-out (relatedTarget outside the row), remove, and preset add | used by `feeds/HeadersEditor.tsx` |
| `ui/Button.tsx` | `Button` variants `primary\|secondary\|plain\|destructive`, every one ≥44px tall including `plain` text buttons; `IconButton` 44x44 with a required `label` | |
| `ui/ConfirmAction.tsx` | inline two-step destructive action with **no timer**: first tap turns the row into message + [Confirm] [secondary option] [Cancel] | `window.confirm` (Settings.tsx:413) and the 4-second auto-cancel (FeedManager.tsx:379, :433-437) |
| `ui/SaveStatus.tsx` | row-level indicator: a spinner shown only after 300ms of saving, "Saved ✓" for 2s, or a red error line with optional Retry/Undo; feeds one polite `aria-live` region per Sheet | |
| `ui/Disclosure.tsx` | 44px "Advanced" row with a chevron | |
| `ui/InlineMessage.tsx` | tone `info\|success\|warning\|error`; text wraps, never truncates | the status-box recipes at Settings.tsx:333-366 |
| `ui/Slider.tsx` | wraps native range | Column min-score (Column.tsx:434-456) |
| `ui/Checkbox.tsx` | 44px hit area | Menu filter rows |
| `ui/icons.tsx` | chevron right/left/down, check, plus, minus-circle, gear, pencil/info, spinner, close; 24 viewBox, stroke 1.75, `aria-hidden` | the four private chevrons (Drawer.tsx:607, Column.tsx:776, Card.tsx:1598, BriefCard.tsx:795) and text glyphs `›`, `✕` |

### 2.4 Libraries

**`lib/route.ts`.** The single URL store. It replaces App.tsx:394-444 and the synthetic popstate at Settings.tsx:238-246.
```ts
export const SETTINGS_TABS = ['feeds','llm','notifications','history','hidden','starred','voted','reset'] as const
export type SettingsTab = typeof SETTINGS_TABS[number]
export interface Route { view: 'dashboard' | 'settings'; tab: SettingsTab | null; page: string[] }
export function parseRoute(href: string): Route   // allow-list tab; page = searchParams 'page' split on '/', validated per tab
export function useRoute(): Route                 // useSyncExternalStore(subscribe popstate + internal emitter)
export function navigate(to: Route, mode: 'push' | 'replace'): void
export function goBack(fallback: Route): void
export function closeOverlay(): void
```
- **URLs:**
  - `?view=settings` is the Settings root.
  - `?view=settings&tab=feeds` is the Feeds list. Legacy deep links still work.
  - `&page=<id>` is a feed editor; `&page=<id>/category` its category picker.
  - `&page=add` and `&page=add/category` are the Add page and its picker; `&page=recommended` the Recommended page.
  - `tab=voted` keeps its id (label becomes "Downvoted").
- **History depth:** every push writes `history.state = { popping: { depth } }`, with depth = the previous entry's depth + 1 for overlay entries and 0 for the dashboard. replaceState keeps the depth.
- **`goBack(fallback)`** (the in-sheet `‹` button): `history.back()` if `depth >= 2` (the parent page was pushed this session), else `navigate(fallback, 'replace')`.
- **`closeOverlay()`** (Done, Esc, backdrop): `history.go(-depth)` if `depth >= 1`, else `navigate({view:'dashboard'}, 'replace')`.
- **This fixes App.tsx:438-444**, where Done pushed a new entry and the next Back re-opened Settings.
- `history.state` survives reload, so depth stays correct after a refresh while the sheet is open.

**`lib/saveQueue.ts`.** Pure and import-free, so `node --test` can load it.
```ts
export type Enqueued<R> = { superseded: true } | { superseded: false; result: R }
export class SaveQueue {
  enqueue<R>(field: string, run: () => Promise<R>): Promise<Enqueued<R>>
  idle(): Promise<void>
  get busy(): boolean
}
export function saveQueueFor(key: string): SaveQueue   // module-level Map, survives unmount
```
- Tasks run strictly one at a time, in FIFO order.
- A queued but **not started** task for the same field is replaced by the newer one; the superseded promise resolves `{superseded:true}`.
- A rejection affects only that task; the chain continues.

**`lib/autosave.ts`.**
```ts
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export function useAutosaveField<T>(o: {
  queueKey: string; field: string; label: string
  serverValue: T
  save: (v: T) => Promise<T>                  // resolves to the server-accepted value
  normalize?: (v: T) => T; validate?: (v: T) => string | null; equals?: (a: T, b: T) => boolean
  onError?: 'keep-draft' | 'revert'           // text fields keep, discrete controls revert
  onUnmountedError?: (message: string) => void
}): { draft: T; setDraft(v: T): void; commit(v?: T): void; retry(): void; revert(): void
      state: SaveState; error: string | null; showSpinner: boolean; focusProps: { onFocus(): void; onBlur(): void } }
```
The full mechanics are in §4.3.

**`lib/apiErrors.ts`.**
- Moves `parseApiError` (FeedManager.tsx:195-210) and `friendlyTestError` (:163-188) here.
- Adds `errorMessage(err, fallback)`:
  - FastAPI `detail` string, or a 422 list joined with "; ";
  - `TypeError` from fetch → "Couldn't reach Popping. Check your connection and try again.";
  - 5xx → "The server had a problem. Try again.";
  - 401 → "Please sign in again.";
  - never the raw `"<status> <statusText> for <url>"` from api.ts:284.
- Adds `isNetworkError(err)`.
- `friendlyTestError('forbidden')` becomes: "This site blocks automated readers. Turn on Headers › Pretend to be a browser." This replaces the non-existent "Advanced → Custom headers" at FeedManager.tsx:174.

**`lib/categories.ts`.** Pure.
- `RESERVED_CATEGORY_NAMES = ['saved','for you']` (mirrors sources.py:162) and `CATEGORY_MAX = 40` (:152).
- `SEED_CATEGORIES`: the former `CATEGORY_OPTIONS`, FeedManager.tsx:80-105.
- `categoryOptions(sources)`: unique exact strings from `sources.map(s=>s.category)` with feed counts, sorted by `categoryLabel`; then seeds not already in use (compared case-insensitively).
- `normalizeNewCategory(input, existing)`:
  - trim, collapse inner whitespace, lowercase;
  - errors: empty → "Type a name"; over 40 → "Keep it under 40 characters"; reserved → "That name is used by a built-in column";
  - a case-insensitive match with an existing category returns that exact existing string with `reused: true`, so "News" never forks a second "news" column (App groups by exact string, App.tsx:757-762).

**`lib/headers.ts`.** Pure.
- `HEADER_DENYLIST`: cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url (sources.py:169-187).
- `HEADERS_MAX = 20`, `HEADER_VALUE_MAX = 512` (:192-193).
- `TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/`.
- `HEADER_PRESETS`:
  - `{browser: 'User-Agent' = current iOS Safari UA}`;
  - `{english: 'Accept-Language' = 'en-CA,en;q=0.9'}`.
- `validateHeaderRow(row, rows)`:
  - blank name with a value → "Add a header name";
  - non-token name → "Header names can only use letters, numbers and dashes";
  - denied name → "Popping can't send a {Name} header";
  - duplicate (case-insensitive) → "Already added";
  - value over 512 → "Too long (512 characters max)";
  - value with CR/LF or non-printable characters → "Use plain text only";
  - name with an empty value → "Add a value".
- `rowsToMap(rows)`: skips fully blank rows and returns `null` when empty.
- `sameHeaders(a,b)`: order-insensitive comparison.

**`lib/viewport.ts`.**
- `useVisualViewport()` returns `{height, offsetTop, keyboardOpen}`. `keyboardOpen` = innerHeight − vv.height > 120.
- `PHONE_QUERY` and `useIsPhone()` for PR 8.

### 2.5 The mobile contract lives in three places
- **Primitives** make the right thing the default.
- **Lint** bans the raw patterns outside `components/ui/**`.
- **The smoke test** measures the rendered result.

The full checklist is in §7.

---

## 3. Top bar, Menu and Settings overlay (requirement 5)

### 3.1 Top bar (`shell/AppHeader.tsx`, extracted from App.tsx:2210-2366)

**Phone:** the "Popping" title, search, refresh, and Menu (the Hamburger, `aria-label="open menu"`, Hamburger.tsx:11-16). That is exactly **one** menu/settings button.

**The gear button is deleted.** That covers:
- App.tsx:2305-2331, including `data-settings-gear` (:2309, referenced nowhere else);
- its comment (:2298-2303);
- the stale header comment (App.tsx:2).

**Why refresh stays.**
- It is an action, not a menu.
- It was a deliberate fix (App.tsx:2282-2288).
- With the gear gone, the row at 320px is 32 (padding) + about 125 (title) + 3×44 + gaps ≈ 297px, so it fits. Today "Pop…" truncates at rest (defect 8).

**Search open on phones:**
- The title and the refresh icon unmount.
- The search box becomes `flex-1 min-w-0`, replacing the fixed `w-44` at App.tsx:2231.
- The field uses TextField `kind="search"`.
- The clear button is a 44px `IconButton`.
- This fixes defects 2, 8 and 13. Body width at 320 was 336/320 with search open.

**Desktop sub-row** (health, Refresh, Brief, UserBadge; App.tsx:2341-2365): unchanged except that its `sm:` gates become `md:` in PR 8.

### 3.2 Menu (`shell/Menu.tsx` on `Sheet presentation="panel-right"`, replacing Drawer.tsx)

The header reads "Menu" (title) with Done on the trailing edge. Done keeps `aria-label="close menu"` for the audit scripts.

**Section 1, no label:**
- **Settings ›** (gear icon) → `navigate({view:'settings', tab:null, page:[]}, 'push')`; the Menu closes first.
  - This **replaces "All settings…"** (Drawer.tsx:377-390), whose subtitle listed 4 of the 8 tabs.
- **Save this view.** Tapping it expands the row into a `TextField` ("Name this view") with a Save button. Enter saves.
  - It calls the existing `savePreset(name)` (App.tsx:1680-1694), then toasts "Saved view “Morning”" and closes the Menu.
  - This **replaces `window.prompt`** at App.tsx:2826.

**Section "Show only these feeds"** (the filter, replacing "Sources" at Drawer.tsx:411-484). One `Row as="label"` per source:
- a `Checkbox` (44px hit area) wired to the existing `onSourceToggle` (App.tsx:2010-2017, which still closes the Menu on the first selection);
- `SourceIcon` 20;
- title `sourceLabel(name)`;
- subtitle `categoryLabel(category)`, replacing the raw `s.category` at Drawer.tsx:477;
- a trailing `IconButton` (pencil) labelled `edit {label}`, which closes the Menu and runs `navigate({view:'settings', tab:'feeds', page:[String(id)]}, 'push')`.

The section action is "Clear" (44px), shown only while filters are active. The footnote "Tap ✎ to change a feed" is shown on first use only (localStorage flag `popping.v1.menu.editHint`).

**Last row:** **Add a feed ›** → `tab:'feeds', page:['add']`.

**Removed:**
- **"History"** (Drawer.tsx:336-351): it is now under Settings › Reading.
- **"Jump to column"** below md (a verified no-op on the phone; App.tsx:2022-2030 never sets `mobileCol`). It stays on desktop as `hidden md:block`, with the ref fixed to scroll `el.firstElementChild`. The ref is a `display: contents` div at App.tsx:2598; a headless Chromium check showed the scroll only works on the child.
- **The dead `onResetLocalState` prop** (Drawer.tsx:61-66, 89-92; App.tsx:2810).

### 3.3 Settings overlay (`Settings.tsx` on `Sheet presentation="sheet" width="settings"`)

- Still the only settings surface, still z-50 (`z-sheet`), still URL-driven.
- The 8-pill horizontal tab strip (Settings.tsx:228-258) and FeedManager's nested tab strip (FeedManager.tsx:226-237) are both replaced by an **iOS Settings root list with pushed pages**.

**Root page (`settings/SettingsRoot.tsx`):**

| Section | Rows |
|---|---|
| Feeds | Feeds — "14 feeds · 1 needs attention"; Add a feed; Recommended feeds |
| Briefs & AI | AI — "Ollama Cloud · gpt-oss" or "Not set up" |
| Reading | History; Hidden (n); Saved (n); Downvoted (n) |
| Notifications | Notifications — "On" / "Off" |
| This device | Reset this device… |
| Account | "Signed in as {name}" + Sign out button. Only when `user` is set and OIDC is on. Fixes the missing phone sign-out: UserBadge is only in the `hidden sm:flex` row, App.tsx:2364. |

- Every row pushes `?view=settings&tab=<id>[&page=…]`.
- The page header shows `‹ Settings` (via `goBack`), the page title, and Done (via `closeOverlay`).
- The title loses the "Settings → X" form (Settings.tsx:220, defect 9).
- LLM and notification status fetches move into their pages (they ran on every open, Settings.tsx:150-164). The root's AI and Notifications subtitles reuse App's existing health data, or fetch lazily once.

---

## 4. Feed editing (requirements 1-4)

### 4.1 Pages (`feeds/FeedsPage.tsx` routes on `route.page`)

| `page` | Component | Header back target |
|---|---|---|
| `[]` | `FeedList` | ‹ Settings |
| `[id]` | `FeedEditor` | ‹ Feeds |
| `[id,'category']` | `CategoryPicker mode="source"` | ‹ {feed label} |
| `['add']` | `AddFeed` | ‹ Feeds |
| `['add','category']` | `CategoryPicker mode="form"` | ‹ Add a feed |
| `['recommended']` | `RecommendedFeeds` | ‹ Feeds |

- `FeedsPage` owns the Add form's draft state, so it survives the push to `add/category`.
- An unknown or deleted `id` renders `InlineMessage` "This feed no longer exists" with a "Back to feeds" button.

**FeedList:**
- At the top: rows "Add a feed ›" and "Recommended ›".
- Then one `List` per category (label `categoryLabel(cat)`). The server already orders by category, name (sources.py:397).
- Each `Row`:
  - icon `SourceIcon` 20;
  - title `sourceLabel(name)`, 1 line, `truncate`;
  - subtitle (one line, `truncate`): status + "every 1 hour". Status is "Paused", "Stopped after 12 failed fetches" (amber/red `tone`) or "Updated 6m ago".
  - `value` = net vote "+2/−3" (`shrink-0`);
  - chevron.
- Status chips move off the name line. That is defect 7: five `shrink-0` chips at FeedManager.tsx:695-786.
- Tap pushes `[id]`.

### 4.2 FeedEditor rows (top to bottom)

**Status (only when there is a problem).** Shown when `auto_disabled || error_count > 0`:
- an `InlineMessage` (warning/error) with plain text, e.g. "Stopped after 12 failed fetches. Last error: the site said “403 Forbidden”." This shows the text that lived only in `title` tooltips at FeedManager.tsx:723-755.
- If the error looks like a 401/403 and the feed takes headers: a button "Pretend to be a browser". It adds the preset header and commits.
- A "Fetch now" Button (calls `POST /api/ingest/{name}` as at FeedManager.tsx:869, then App `refresh()`).

**Section "Feed":**

| Row | Control | Notes |
|---|---|---|
| Name | `FieldRow` + `TextField kind="slug"` | hint "Shows as “{sourceLabel(draft)}”". Normalize on commit: lowercase, spaces and dashes → `_`, strip other characters. Validate `^[a-z0-9_]{1,120}$`. Built-ins: read-only text, hint "Built-in feeds keep their name". |
| Address | `FieldRow` + `TextField kind="url"` | Validate http(s) via `new URL`. Hint when the draft differs from saved: "Its icon will refresh on the next fetch" (replaces "⚠ favicon resets", FeedManager.tsx:671-679). If the PATCH response URL differs from the draft (YouTube or Apple resolution, sources.py:689-699), show the response and note "Changed to the channel's feed link". Built-ins: read-only. Reddit: hint "Subreddit, like r/python". |
| Category | `Row value={categoryLabel(category)} accessory="chevron"` | Pushes `[id,'category']`. Its `status` slot shows SaveStatus. |
| Check every | `Row` + `Select` | options 15 min / 1 hour / 6 hours / 24 hours, plus the current value if not a preset; commits on change |
| Check for new stories | `Row` + `Toggle` | on = `active`; commits on change; subtitle "Off: paused" |
| Type | read-only `Row` value | "YouTube channel", "Podcast", "Subreddit", "Website (no feed)", "Feed" |

**Section "Advanced"** (`Disclosure`, closed by default, open if headers exist). Hidden for `builtin` and `type === 'reddit'`:
- reddit ignores headers (dynamic_reddit.py:171);
- built-ins ignore headers (static `_DEFAULT_HEADERS`).

Contents:
- **Headers:** `HeadersEditor` (§4.5).
- **For `generic_scrape` only:** "Sitemap address" (`TextField kind="url"`) and "Link pattern" (`TextField kind="slug"`, must start with "/"). `api.updateSource` gains `sitemap_url?: string|null` and `link_pattern?: string|null` (PATCH already accepts both, sources.py:722-748).

**Section actions:**
- **"Test this feed"** (secondary Button):
  - calls `api.testSource({ type, url: addressDraft, custom_headers: rowsToMap(headerRows) })` with **no name**, so it never collides with itself (sources.py:909-926);
  - the result is an `InlineMessage`: "Looks good — 23 stories" or `friendlyTestError`;
  - for generic_scrape it adds "Headers aren't used in this test" (sources.py:1000-1004).
- **"Delete feed"** (`ConfirmAction`, destructive):
  - The confirm row says "Delete {label}? Its stories go too." with [Delete] [Pause instead] [Cancel].
  - Built-ins add "Built-in feeds don't come back on their own."
  - Delete first waits for `saveQueueFor('source:'+id).idle()`, then calls `api.deleteSource` (which now throws `ApiError`), then `onSourceDeleted(id)`, `navigate({tab:'feeds', page:[]}, 'replace')`, and toasts "Deleted {label}".

**Not rendered:** `autoFocus` anywhere in the editor. FeedManager.tsx:583 popped the keyboard on open.

### 4.3 Autosave mechanics (the same model for every Settings control)

**What triggers a commit:**
- **Text fields** (name, address, sitemap, link pattern, model "Other…" name): **blur or Enter only**. There is no keystroke debounce, because every effective PATCH on an active dynamic feed triggers an immediate ingest (scheduler.py:2462-2469).
- **Discrete controls** (Select, Toggle, Segmented, a ChoiceList pick, a header preset, header row remove): commit **on change**.
- **Header rows:** commit on row focus-out, once the row is complete and valid.
- **Backgrounding:** `visibilitychange → hidden` blurs the focused element, so a pending text edit commits before iOS suspends the page.

**`useAutosaveField` state machine:**
1. `setDraft(v)` → `dirty = true`; the state is unchanged.
2. `commit(v = draft)`:
   - `n = normalize(v)`.
   - If `validate(n)` returns a message → `state = 'error'` with that message. **No request.**
   - If `equals(n, lastServer)` or `equals(n, lastSubmitted)` → `state = 'idle'`, `dirty = false`. This makes blur-then-Enter, or a focus/blur with no edit, a no-op: one PATCH per real change.
   - Otherwise: `token++`, `lastSubmitted = n`, `state = 'saving'`, and `saveQueueFor(queueKey).enqueue(field, () => save(n))`.
3. **Success** with the current token → `lastServer = result`. If the field has not been edited since the commit, `draft = result` (shows a resolved URL or normalized name). Then `state = 'saved'`; after 2000ms → `'idle'`.
4. **`{superseded:true}`** → ignored. The newer commit owns the status.
5. **Failure** with the current token → `state = 'error'`, `error = errorMessage(err)`.
   - `keep-draft` (text): the user's text stays; the row shows the error, a **Retry** button (network or 5xx) and an **Undo** button (`revert()` restores `lastServer`).
   - `revert` (discrete): the control snaps back to `lastServer`.
6. **Reseeding from props.** When `serverValue` changes and the field is not focused, not dirty and not saving: `draft = lastServer = serverValue`. Comparison uses `equals`, with `sameHeaders` for header maps. This fixes the re-seed that clobbers edits on every 60s poll (FeedManager.tsx:465-475, deps on the `custom_headers` object reference).
7. `showSpinner` is true only after 300ms in `'saving'`.

**Source save wiring (`FeedEditor`).**
- Each field's `save` is `(v) => api.updateSource(id, { [key]: v }).then(row => { onSourceSaved(row); return pick(row, key) })`. Bodies hold **one key**. Omitted keys are untouched server-side (`is not None` checks plus the `model_fields_set` sentinel, sources.py:674-759).
- `queueKey` is `'source:' + id`.
- `custom_headers` sends the whole map, or `null` when empty (backend: null/{} → NULL, sources.py:354, 755-759).

**Races:**

| Scenario | Outcome |
|---|---|
| Rapid commits on different fields (rename, then pick category, then toggle pause) | Strictly sequential PATCHes. Each response is a full row, applied in order, so the last response holds every earlier write. Bodies are single-key, so a 409 on the name does not block the category write. |
| Rapid commits on the same field (headers edited across three rows) | The in-flight request finishes. Of the queued ones, only the newest runs. Only the newest token sets the status. |
| A background poll lands after a local PATCH but began before it | App guard (§4.7): rows written locally after the poll's start time keep the local version, so the dashboard and editor never flash back to the old value. |
| Two devices editing | Last write wins per field. There is no version column (models.py:40-99). Documented, not solved. |

**Optimistic update.** The control shows the new value immediately (the draft). App's `sources` (the dashboard and the feed list) update from the PATCH response, typically within 100-300ms. So no rollback is ever needed in App state.

**Closing mid-save.**
- Done, Esc, backdrop and swipe all go through Sheet, which first blurs the active element. Pending text commits synchronously into the queue; then the sheet closes immediately.
- The queue lives in a module-level registry, so in-flight and queued PATCHes complete after unmount, and `onSourceSaved` (App-level, stable) still applies the response. A category change therefore still moves the feed's stories to the new column after close.
- A failure after unmount calls `onUnmountedError` → `toast("Couldn't save the category for BBC News: {reason}", {kind:'error', action:{label:'Open', onClick: () => navigate(editor)}})`. Toast is z-60, 6s with an action.
- `api.updateSource` passes `keepalive: true` to `fetch`, so the request survives a page hide (body < 64KB).

**Renames.** `onSourceSaved(row)` compares with the previous name. If it changed, it calls the existing remap (`onSourceRenamed`, App.tsx:1994-2003) **outside** the setState updater, using a `sourcesRef`.

**Errors are never sent to App's banner from inside Settings.** That banner renders under the sheet (App.tsx:2397-2411 vs Settings.tsx:189). The banner keeps only dashboard refresh failures.

**Other Settings pages use the same hook (PR 6):**
- **AI provider** (`Select`): `PUT /api/settings/llm {provider, model_brief:'', model_scoring:''}`. `''` resets the models to the provider's defaults (settings.py:95-104, 158-170), matching today's `changeProvider` (Settings.tsx:625-637).
- **Models** (`Select`, plus a `TextField` behind "Other…"): `{model_brief}` / `{model_scoring}` on change or blur.
- **API keys** (`TextField kind="secret"`): commit on blur when non-empty. After success the input clears and the row shows "Key saved" from `*_api_key_set` (api.ts:209-220). "Remove key" is a `ConfirmAction` sending `''`.
- **The LLM "save" button (Settings.tsx:928-934) and the Edit/Cancel toggle are deleted.**
- **Brief tone** (`Segmented`): persisted per device in localStorage key `popping.v1.brief.tone` (storage.ts, with the comment at :39-41 updated). It was plain `useState` (App.tsx:457) and reset on reload.
- **History group-by:** already autosaves through preferences (preferences.tsx:707-712); it moves to `Segmented`.

### 4.4 Category picker (`feeds/CategoryPicker.tsx`)

**Page sections:**
- **"Your categories":** `ChoiceList` from `categoryOptions(sources)`. Each row shows `categoryLabel(value)` with detail "3 feeds" and a check on the current one.
- **"Suggestions":** seed categories not in use.
- **"New category…" row:** expands in place to a `TextField kind="slug"` with `autoFocus` (inside the tap's own handler, so iOS opens the keyboard), plus an "Add" Button. Enter also adds.
  - Live line: "Shows as “{categoryLabel(normalized)}”".
  - The Add button is disabled with the reason shown when `normalizeNewCategory` fails.
  - On reuse: "Using your existing “News” category".

**Modes:**
- `mode="source"`: a pick commits via the editor's category field. It uses the same `saveQueueFor('source:'+id)` key, so it serializes with the editor's other saves. After 300ms it calls `goBack(editorRoute)`; the editor's Category row then shows Saved ✓.
- On a validation or server error the picker stays open, shows the error under the list, and the check reverts.
- `mode="form"`: a pick writes the Add form draft and goes back. There is no PATCH.

**Columns.** Moving the last feed out of a category makes that column disappear on the next render (columns come from entries, App.tsx:753-764). The phone's remembered tab is index-based (App.tsx:1358-1367). This PR must not shift it, so after a category change App leaves `mobileCol` alone. PR 7 switches the memory to the column name.

### 4.5 Headers without code (`feeds/HeadersEditor.tsx` over `ui/KeyValueEditor`)

**Layout:**
- One sub-card per header, stacked for 320px: "Header name" `TextField kind="header-name"` (placeholder "User-Agent"), then "Value" `TextField kind="header-value"`, then a trailing 44px remove `IconButton` ("Remove header User-Agent").
- Errors appear under the offending row.
- Above the rows: preset chip-Buttons (44px) "Pretend to be a browser" and "Prefer English". Each is disabled when its header is already present.
- One line of help: "Some sites block automated readers. A browser identity usually fixes it."
- Last row: "+ Add header", which adds an empty row and focuses its name field.

**Commit:**
- Fires on row focus-out (relatedTarget outside the row), on remove, and on preset.
- If any row fails `validateHeaderRow`, nothing is sent and the section's SaveStatus reads "Fix the highlighted header".
- Otherwise it sends `rowsToMap(rows)`.
- A removal also toasts "Removed User-Agent" with an **Undo** action that restores and re-commits the previous map.

**Seeding:** rows come from `Object.entries(custom_headers ?? {})` with stable ids, reseeded only by rule 6 in §4.3.

**What it replaces:** the JSON textarea (FeedManager.tsx:630-655), its parser (:481-499) and its error effect (:502-506).

### 4.6 Add a feed (`feeds/AddFeed.tsx`)

**Section "Paste a link":**
- A `TextField kind="url"` labelled "Website, feed, YouTube or podcast link". It also accepts a bare `@handle` or channel ID; the server normalizes them (§5.1).
- A primary **Add** Button calls `api.autoAddSource(url, categoryOrUndefined)`.
- Success:
  - toast "Added {label}" (kind `youtube_channel`: "Added {label} (YouTube)");
  - `onSourceAdded(row)`;
  - `navigate({tab:'feeds', page:[String(row.id)]}, 'replace')` straight into its editor, so the category is one tap away.
- `found:false` → `InlineMessage` "Couldn't find a feed at that link." plus a secondary Button **"Track this page anyway"**. It runs `trackAnyway`, which posts `type:'generic_scrape'` **without a name**; the server derives it (§5.1).
- A 422 (for example a blocked YouTube lookup) → `InlineMessage` (error) with the server's plain message. The field keeps its text.
- This fixes the invisible errors (cause 7b) and the 49px-overflowing Auto-add button (defect 6).

**Section "More options"** (`Disclosure`):
- **Type:** `ChoiceList` with Feed (RSS/Atom), Subreddit, Podcast, YouTube channel, Website (no feed).
- **Link:** `TextField`, labelled per type through a `URL_LABEL` map.
- **Category:** `Row` → `add/category`. The default value "Automatic" sends nothing for the auto path; for manual Add it resolves client-side to podcast → 'podcast', youtube → 'video', else 'news'.
- **Check every:** `Select`.
- **Advanced:**
  - Short name (optional), `TextField kind="slug"`, with hint "Leave blank and we'll name it";
  - Headers (`HeadersEditor` in local mode);
  - for Website: Sitemap address and Link pattern.
- **Buttons:** Test (secondary), which passes `custom_headers`; Add (primary).
- Validation messages show under their fields. Today `nameError`/`urlError` are computed but never rendered, so the buttons go grey with no reason (FeedManager.tsx:1395-1424).
- After success it navigates into the new feed's editor.
- **Category default:** the three add paths now share one rule: type default, else 'news'. Previously they used 'news' (:1309), 'other' (api.ts:409) and 'news' (:1190).

**RecommendedFeeds:**
- `List` rows: `sourceLabel(name)`, `categoryLabel(category)` (raw at FeedManager.tsx:1110-1111 today), the blurb as a 2-line subtitle, and a trailing 44px "Add" Button. `default_headers` still flow through (:1050).
- A "Find more feeds" 44px Button; messages appear in an `InlineMessage`.

### 4.7 App data flow (App.tsx)

**Settings props:**
- **Removed:** `onRefreshSources`, `onError`, `onSourceRenamed`.
- **Added:** `onSourceSaved(row)`, `onSourceAdded(row)`, `onSourceDeleted(id)`, `refreshSources: () => Promise<void>` (the real awaitable `refresh`; today `async () => { void refresh() }` resolves before the data arrives, App.tsx:2838).

**`applySourceUpdate(row)`:**
- `localWriteAt.current.set(row.id, performance.now())`;
- `setSources(prev => prev.map(s => s.id === row.id ? { ...row, net_vote_score: s.net_vote_score } : s))`. The PATCH response always carries `net_vote_score = 0` (sources.py:398-403);
- then a rename remap if the name changed.

**`refresh()` poll guard:**
- Capture `startedAt = performance.now()` before `api.sources()`.
- When it resolves, for every row with `localWriteAt.get(id) > startedAt`, keep the previous local row; then call the existing `reconcileById`.

**Other wiring:**
- `onSourceAdded` appends and sorts by (category, name).
- `onSourceDeleted` removes the source and clears it from `activeSources`.
- **Column.tsx empty states** (Column.tsx:811-868) get an "Open feed settings" button calling a stable `useCallback` `openFeedEditor(id)`. Column's memo comparator ignores callbacks (Column.tsx:881-909), and test_slice21_column_memo requires the `useCallback` handlers and `memo(ColumnInner`. Keep both.

---

## 5. Backend changes

### 5.1 PR 1: YouTube links add reliably (requirement 9)

**Root causes:**
- (a) The page fetch uses `Popping/0.2` (config.py:392, youtube.py:41, 98). From a datacenter IP YouTube may answer with a consent wall (`consent.youtube.com`) or a "confirm you're not a bot" page.
- (b) Only one marker is tried (youtube.py:38). On a handle page the first `"channelId"` can even belong to a featured channel.
- (c) Shapes that already carry the id, or need no lookup at all (feed links, bare `UC…`, `/user/`, playlists), still hit the network or fail.
- (d) `/api/sources/auto` never resolves YouTube (sources.py:573-644).
- (e) Errors are invisible on the phone.
- (f) The Add form needs an invented slug.
- (g) The tests depend on the live network.

**`backend/app/youtube.py`, rewritten with the public API kept:**
```python
_TRANSPORT: httpx.AsyncBaseTransport | None = None      # test seam; None = real network
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
_PAGE_HEADERS = {"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                 "Accept-Language": "en-US,en;q=0.9", "Cookie": "SOCS=CAI; CONSENT=YES+cb"}
@dataclass(frozen=True)
class YouTubeChannel: feed_url: str; channel_id: str | None; title: str | None; handle: str | None
class YouTubeResolutionError(RuntimeError)          # kept (routes catch it)
class YouTubeBlockedError(YouTubeResolutionError)
class YouTubeNotFoundError(YouTubeResolutionError)
def is_youtube_url(url) -> bool                      # unchanged
def normalize_youtube_input(text: str) -> str        # bare UC id -> feed URL; bare @handle -> https://www.youtube.com/@handle; scheme-less youtube host -> https://
def resolve_offline(url: str) -> YouTubeChannel | None
async def resolve_channel(url: str) -> YouTubeChannel
async def resolve_channel_feed_url(url: str) -> str  # kept: non-YouTube passthrough, else (await resolve_channel(url)).feed_url
def youtube_source_slug(ch: YouTubeChannel) -> str   # slug(title or handle) + "_yt" (labels.ts renders "_yt" as " (YouTube)"); fallback "channel_" + id[2:8].lower() + "_yt"
```

**`resolve_offline`** handles, with no network:
- `/channel/UC…` on any youtube host (www, m, music) with any suffix (`/videos`) and `?si=` share params;
- `feeds/videos.xml?channel_id=|user=|playlist_id=`, passed through as the canonical `https://www.youtube.com/feeds/videos.xml?...`;
- `/user/NAME` → `?user=NAME`;
- `/playlist?list=PL…` with no `v=` → `?playlist_id=`;
- a bare `UC` + 22 characters.

**`resolve_channel` order:**
1. Offline.
2. If `settings.youtube_api_key` is set:
   - `GET https://www.googleapis.com/youtube/v3/channels?part=id,snippet&forHandle=@h`, `forUsername=` for `/user`, or `videos?part=snippet&id=` for watch, youtu.be, shorts, live and embed;
   - header `X-Goog-Api-Key`;
   - same guarded client;
   - an empty result or a 403 quota error falls through to step 3.
3. Page fetch:
   - same `check_url_safe` + `event_hooks={"request": [ssrf_event_hook]}` (keep this exact substring for test_youtube.py:83) + final-URL check, plus `transport=_TRANSPORT`, `_PAGE_HEADERS`, `max_redirects=5`;
   - read at most 3MB.
   - **Blocked** (`YouTubeBlockedError`): the final host is `consent.youtube.com`/`consent.google.com`, or status is 429/403, or the body contains `"LOGIN_REQUIRED"`, "confirm you’re not a bot" or "Sign in to confirm".
   - **Markers, first hit wins:**
     - channel-shaped URLs: `<link rel="canonical" href="…/channel/(UC…)">` → `<meta itemprop="identifier" content="(UC…)">` → `"externalId":"(UC…)"` → `og:url …/channel/(UC…)` → `"browseId":"(UC…)"` → `"channelId":"(UC…)"`;
     - video URLs: `<meta itemprop="channelId" content="(UC…)">` → `"externalChannelId":"(UC…)"` → `"channelId":"(UC…)"`.
   - **Title for naming:** `og:title` (HTML-unescaped), or `"ownerChannelName"` for videos.
   - 404, or no marker on a non-blocked page → `YouTubeNotFoundError`.

**Messages (plain words; shown inline on the phone):**
- **Blocked:** "YouTube wouldn't let the server look this channel up. Paste the channel ID instead (it starts with UC — on the channel page choose Share › Copy channel ID). A YouTube API key in the server's .env also fixes this."
- **Not found:** "That YouTube link doesn't lead to a channel. Paste a channel link, an @handle, a video link or a channel ID."
- **Network:** "Couldn't reach YouTube from the server. Try again in a minute."
- The API key never appears in any message.

**`backend/app/config.py`:** add `youtube_api_key: str = ""`, the same pattern as the other keys (config.py:103-119).

**`backend/app/routes/sources.py` and `backend/app/schemas.py`:**
- **POST /api/sources (sources.py:421-538):**
  - If `body.type == "youtube_channel"`, first `body.url = normalize_youtube_input(body.url)`.
  - Resolve through `resolve_channel` when the input is YouTube (422 on error, as today).
  - `SourceCreate.name` becomes `Optional[str] = None`. When absent, the name is derived as `youtube_source_slug(ch)` for YouTube, else `_slugify_hostname(url)`, then made unique via `_free_source_name` (sources.py:541-560).
- **POST /api/sources/auto:**
  - Before feed discovery: if `normalize_youtube_input(url)` is YouTube → `resolve_channel` → create `type="youtube_channel"`, refresh `_YOUTUBE_DEFAULT_REFRESH`, category `body.category or "video"`, return `kind="youtube_channel"`. A resolution error → 422 with the message.
  - An Apple Podcasts link (`resolve_feed_url` changes it) → create `type="podcast"`, category `body.category or "podcast"`, `kind="podcast"`.
  - `SourceAutoRequest.category` becomes `Optional[str] = None`; when omitted: youtube 'video', podcast 'podcast', rss/generic 'news'. All existing tests pass a category (test_feed_autodiscovery.py:311-413).
  - These new paths start **no** discovery task.
- **POST /api/sources/test:** YouTube resolution errors return `error_kind="resolution_failed"` (newly documented on `SourceTestResult`) with the plain message. Apple keeps `invalid_url`.
- **PATCH:** unchanged except that it uses `normalize_youtube_input` when `pre.type == "youtube_channel"`.

**Frontend in PR 1** (small, keeps the slice-15 and sitemap guard literals intact):
- `api.ts`:
  - `autoAddSource(url, category?)` omits category when undefined;
  - `SourceAutoResult.kind` adds `'youtube_channel' | 'podcast'`;
  - the `SourceTestResult.error_kind` union adds `'resolution_failed'`.
- `FeedManager.tsx`:
  - The `submit` catch and the AutoFeedBlock failures write into the existing inline result boxes (`setTestResult({kind:'err', message})`, `autoMessage`) instead of `onError`.
  - The YouTube URL label becomes "YouTube channel link, @handle or channel ID" (the placeholder ternary keeps 'https://example.com' for generic_scrape).
  - The name becomes optional: `validateForm` drops "name is required", the label becomes "Short name (optional)", and `createSource` omits `name` when blank.
  - `friendlyTestError` passes `resolution_failed` through verbatim.

**Tests: `backend/tests/test_youtube.py`**, rewritten; all offline. Saved snippets live in `backend/tests/fixtures/youtube/*.html`.

*Fixtures:*
- An autouse fixture sets `app.youtube._TRANSPORT` to a `MockTransport` whose default handler calls `pytest.fail(f"unexpected network call {request.url}")`.
- `fake_dns` monkeypatches `app.url_safety.resolve_addresses` (url_safety.py:139; called by `check_host_safe` and `ssrf_event_hook` at call time) to map youtube.com, www.youtube.com and www.googleapis.com to `142.250.72.14`.

*Offline parsing:*
- `/channel/` on www, m and music, with `/videos` and `?si=`;
- feed links for channel_id, user and playlist_id;
- `/user/NAME`;
- a playlist URL;
- a bare id, including surrounding spaces;
- a scheme-less youtube.com link;
- a bare `@handle` normalizing to its URL;
- a spoofed host (`youtube.com.evil.example`) rejected;
- non-YouTube input passed through unchanged.

*Markers:*
- one fixture per marker;
- an ordering test: a handle page whose first `"channelId"` is a featured channel but whose canonical link is the real one, so canonical wins;
- a video page through `itemprop channelId`.

*Request shape:* the handler asserts the browser UA, Accept-Language and the consent cookie.

*Blocked and not-found:* a 302 to consent.youtube.com, a bot-check body and a 429 → `YouTubeBlockedError` whose message mentions the channel ID; a 404 → not-found.

*API path:*
- with `settings.youtube_api_key` monkeypatched, a `forHandle` request is sent with the `X-Goog-Api-Key` header, the key is absent from `request.url`, and the page is never fetched;
- an API 403 falls back to the page.

*SSRF still active:* a redirect hop to `http://127.0.0.1/` → `YouTubeResolutionError`, with no handler call for 127.0.0.1. The existing source-text test at :77-88 stays.

*Routes:*
- POST /api/sources with `{type:'youtube_channel', url:'@handle'}` and no name → 200, feed URL stored, name `<handle>_yt`;
- POST /api/sources/test blocked → `ok:false`, `error_kind:'resolution_failed'`;
- POST /api/sources/auto with a YouTube link and no category → a youtube_channel row in 'video', `kind:'youtube_channel'`;
- a second channel with the same title gets a de-duplicated name.

*Replaced:* the network-dependent tests at :115-133 and :164-174.

**`.env.example` and README:**
```
# Optional. Lets Popping look up YouTube channels through Google's API
# instead of reading the channel page (more reliable from a server).
# Free quota is 10,000 lookups a day; adding one channel uses 1.
YOUTUBE_API_KEY=
```
The README gains a YouTube how-to: link shapes accepted, and the channel-ID fallback.

### 5.2 PR 2: the feed API contract the editor relies on

- **`builtin`:**
  - `SourceOut.builtin: bool = False` (schemas.py:12-64), set by a helper `_source_out(row)` in sources.py as `row.name in registered_plugin_names()`, for list, get, create, auto and patch responses;
  - the list still sets `net_vote_score`.
- **Category strip:** `_validate_category` returns the stripped value (sources.py:287-303), and POST (:518), /auto (:617) and PATCH (:779) store that value. No lowercasing: that would change behaviour, since entries.py:366 compares raw strings.
- **Category-only PATCH skips the job rebuild** (scheduler.py:2433-2469):
  - after commit, if `category_changed` and nothing else changed, return before `_add_or_replace_dynamic_job`;
  - every other change rebuilds as today (name, url, headers, sitemap and link pattern are bound into the plugin).
- **Header names** (`_validate_custom_headers`, sources.py:325-334):
  - reject an empty key or one not matching the RFC 7230 token pattern → 422 "header name {k!r} isn't valid";
  - reject case-insensitive duplicates → 422.
- **Test endpoint:**
  - calls `_validate_category` when a category is given; a failure → `ok:false, error_kind:'invalid_category'`;
  - the reddit branch becomes `from app.reddit_client import fetch_subreddit; from app.sources.reddit import normalize_subreddit; items = await fetch_subreddit(normalize_subreddit(url), listing="hot", limit=10)`, with no headers (fixes sources.py:1008);
  - the docstring notes that headers are not used for reddit.
- **Route tests:** new `backend/tests/test_source_patch_contract.py`, via the `app_client` fixture (conftest.py:198):
  - name regex 422;
  - plugin name 400;
  - built-in rename and re-URL 400 for all 7 registry names, including `rfd_hot_deals`;
  - collision 409;
  - category: empty / 41 characters / "For You" → 422; " tech " stored as "tech";
  - headers: Cookie, cookie and X-Forwarded-For → 422; 21 entries, a 513-character value, a CRLF value, a blank key and the key "bad key" → 422;
  - null and {} clear the headers;
  - `builtin` true only for the registry names;
  - the reddit test path with a monkeypatched `fetch_subreddit`;
  - category-only skips the rebuild while a headers change rebuilds: set `scheduler._scheduler` to a fake recording `add_job`, `remove_job` and `get_job`.
- **Frontend in PR 2:**
  - `api.ts`: `Source.builtin: boolean`; the `updateSource` body gains `sitemap_url?: string|null; link_pattern?: string|null`; fix the "send {} to clear" comment (:434-437) to say null; `deleteSource` throws `ApiError` with `detail`;
  - `FeedManager.tsx`: `isBuiltIn(source)` reads `source.builtin`, and `KNOWN_BUILT_INS` (:108-119) is deleted.

---

## 6. Text overflow: root causes, real fixes, guard (requirement 10)

The 13 measured defects (REDESIGN_PLAN.md §4, shots/*-overflow-scan.json) come from six root causes. Each cause is fixed once, in a primitive or a layout rule, not per element.

| Root cause | Defects | Structural fix (and where it lives) | PR |
|---|---|---|---|
| RC1: flex rows with no declared shrink policy (text has no `min-w-0`; fixed items have no `shrink-0 whitespace-nowrap`) | 4 card meta ("12m / ago"), 5 card inline actions wrapping mid-phrase, 7 feed names clipped by chips, 9 Settings title squeezing Done, 10 "My feeds (14)" wrapping in its pill | `Row` / `FieldRow` / `Sheet` header slots encode the policy. Card gets two layout classes in styles.css `@layer components`: `.meta-line > :first-child {min-w-0 truncate}`, other children `shrink-0 whitespace-nowrap`; `.action-bar {flex flex-wrap gap-x-4 gap-y-1}` with children `whitespace-nowrap min-h-[44px]`. Nested pill tabs disappear (pages). | 3 (card), 4 (sheet header), 5 (feed rows) |
| RC2: fixed widths sized for ≥390px (`w-44` search, `w-28` thumbnail, input without `min-w-0`) | 2 search, 3 headline ribbon beside thumbnail, 6 Auto-add button 49px off-screen, 8 "Pop…" title | Header: search `flex-1 min-w-0` with title and refresh unmounted while searching. Card: `container-type: inline-size` on the card body plus `@container` rules in styles.css: ≥380px wide → 96px thumbnail beside the title; 300-379px → 72px square; <300px → thumbnail on its own full-width 16:9 row under the title, so the title always gets at least 60% of the width. TextField is always `w-full min-w-0`. | 3 (header, card), 5 (Add) |
| RC3: gutters owned by each page instead of the container | 1 Feeds tab with no side margin | `Sheet` body and `List` own `px-4` / `mx-4` and the safe-area insets. Pages cannot set their own outer gutter (lint bans `px-0` overrides at page roots by review). | 4 |
| RC4: 13px-designed controls forced to 16px by `!important` | 11 select and textarea clipped on 18px line heights | Every control is designed at 17px with a 24px line height (primitives); the override is deleted once lint bans raw controls everywhere. | 5 (feeds), 6 (rest, deletion) |
| RC5: hard-coded tiny sizes | 12: 9/10px (Card.tsx:1174, FeedManager 598/645/650/1114, App.tsx:2709) | `ios-caption2` (11px) is the floor; lint bans `text-[Npx]` with N < 11; the decorative SourceIcon letter gets `aria-hidden`. | 3 |
| RC6: native search decorations | 13 two clear buttons | TextField `kind="search"` (`type="text" inputMode="search"`). | 3 |

**Also fixed in PR 3:**
- BriefCard's no-wrap header (BriefCard.tsx:562) gets `flex-wrap`, matching :673, with Generate on its own row below md.
- Toast `truncate` (Toast.tsx:122) becomes `line-clamp-3 break-words`.
- Hidden and Saved list titles `truncate` (Settings.tsx:1436) become `line-clamp-2` (done with the PR 6 page migration).

**The guard** is the smoke test in §8:
- page width;
- elements and text spilling outside their painted box;
- short labels that wrap or truncate;
- minimum text size;
- field font size.

It runs at 390x844@3 and 320x568@2 on every state, with fixtures carrying a 60-character feed name, a 120-character URL, a 180-character title and a 90-character unbroken token (fixtures.cjs). The 320 run doubles as the check for Safari Page Zoom: 125% on a 390 phone lays out at 312 CSS px.

---

## 7. The mobile and ease-of-use contract (requirements 6 and 7)

Each item lists the rule, where it is built in, and how it is enforced:
- **L:** an ESLint rule (`frontend/eslint.config.js`, core rules only);
- **S:** a smoke rule (§8);
- **P:** an on-phone check after popping-update (Chromium cannot emulate it).

| # | Rule | Built into | Enforced by | Today's violations fixed in |
|---|---|---|---|---|
| MC1 | Height uses `dvh`/`100%` consistently; no `vh` and no `h-screen` | styles.css `html,body,#root{height:100%}`; remove the inline `minHeight:'100dvh'` (App.tsx:2188), which caused double scroll in Safari tab mode | L (`no-restricted-syntax` on class strings matching `/(^|\s)(min-|max-)?h-(screen\|\[\d+vh\])/`) + S (page-width) + P | PR 3 |
| MC2 | Safe areas on all four sides for every fixed or sticky surface | `Sheet`, `AppHeader`, phone `<main>` and tab strip use `max(1rem, env(safe-area-inset-*))` | L (class strings containing `fixed` or `sticky` are banned outside `components/ui/**` and `components/shell/AppHeader.tsx`; the Card context menu is desktop-only and allowed with a reasoned disable) + P (landscape on the phone) | PR 3-4, 8 |
| MC3 | Text-entry controls are at least 16px (designed at 17px) | `TextField`, `Select`, `KeyValueEditor` | L (raw `<input>`, `<select>`, `<textarea>`, `<datalist>` banned outside `components/ui/**`) + S (R3) | PR 5-6, then the `!important` rule is deleted |
| MC4 | Every tap target is at least 44x44, by padding rather than visual size | `Button`, `IconButton`, `Row`, `Toggle`, `Segmented`, `Checkbox`, Sheet Done/back | L (`min-h-[<44px]` banned on class strings) + S (R8; prose links exempt via `data-tap-exempt`) | sheets PR 4-6; cards, chips and tabs PR 7 (raises card icons from 40px to 44px) |
| MC5 | No native dialogs | `ConfirmAction`, the inline name field | L (`no-restricted-globals` for alert, confirm, prompt; `no-restricted-properties` for window.alert/confirm/prompt) + S (R9 fails on any `dialog` event) | PR 4 (save view), PR 6 (rename preset App.tsx:306, Reset Settings.tsx:413) |
| MC6 | The keyboard never covers the focused field, and sheets never pan away | `Sheet` + `useVisualViewport` | P (focus the last field in the editor and in Add) | PR 4 |
| MC7 | Readable text is at least 11px; captions are 13px | tokens | L (ban `text-[Npx]` with N < 11, and any arbitrary px text size outside `ui/`) + S (R4) | PR 3, 5 |
| MC8 | No horizontal overflow; nothing spills out of its box; short labels never wrap | primitives (RC1-RC3) | S (R2, R5, R6, R7) at 390 and 320 | PR 3-6 per surface |
| MC9 | Truncation never hides needed information: list titles up to 2 lines; errors and toasts up to 3 lines; error details on screen, not in `title` | `Row lines`, `InlineMessage`, Toast | L (`title=` attributes banned in `components/feeds/**`, `components/settings/**`, `components/ui/**`, `components/shell/**`) + review | PR 3, 5-7 |
| MC10 | iOS keyboard hints on every field (no auto-capitalisation on names, URLs or usernames; URL keyboard; enter-key hints) | `TextField kind` | L (via MC3) | PR 1 (Add name and URL), PR 5, PR 6 (LoginPage.tsx:72 username) |
| MC11 | Scrollers contain overscroll; the document never rubber-bands | `Sheet` body; `html,body{overscroll-behavior-y:none}`; `overscroll-contain` on the phone column scroller (App.tsx:2721) and Column list (Column.tsx:489) | L (class strings with `overflow-y-auto` must also contain `overscroll-`) | PR 3-4 |
| MC12 | Hidden panels are inert | `Sheet` (inert, unmount) | S (R5 skips inert subtrees; a dedicated check that no focusable element is reachable while closed) | PR 4 |
| MC13 | Taps register without mouse events | outside-click via `pointerdown` | L (ban `addEventListener('mousedown', …)`) | PR 6 (Column.tsx:244) |
| MC14 | Motion respects reduced motion | `Sheet` `motion-safe:` | review | PR 4 |
| MC15 | A phone in landscape keeps the phone layout | the `md` raw screen + `PHONE_QUERY` | S (state S18 at 844x390 asserts the tab bar is visible) | PR 8 |
| EU1 | A known or closed set is a picker, never free text | `Select`, `ChoiceList`, `CategoryPicker`, AI model `Select` with "Other…" | L (`<datalist>` ban) + review | PR 5-6 |
| EU2 | Settings save themselves; there are no Save buttons in Settings | `useAutosaveField` + `SaveStatus` | S (R12: no visible button named /^save$/i inside the settings dialog) | PR 5-6 |
| EU3 | Errors appear where the action happened, never behind a sheet | `SaveStatus`, `InlineMessage`, toast z-60 | S (R11: induced 422/network errors are visible, checked with `elementFromPoint`) | PR 1, 5-6 |
| EU4 | Destructive actions confirm inline with no timer; bulk actions offer Undo | `ConfirmAction`, action toasts | review + flows | PR 5 (feed delete), PR 6 (Clear all, Hide all downvoted: Undo restores the captured array) |
| EU5 | Plain words, never developer words | copy deck below | review | PR 1, 5-7 |
| EU6 | No information or action exists only in a tooltip, right-click or keyboard shortcut | Column mark-all-read as an explicit control; touch wording in empty states | L (MC9 scopes) + review | PR 6 (empty states Settings.tsx:1526/1598/1683), PR 7 (Column.tsx:314-325) |
| EU7 | Done sits on the trailing edge, at 44px; one consistent sheet header | `Sheet` | S (R8) | PR 4 |
| EU8 | Feedback appears for every action: Saved ✓ per row; info toasts stay for 4s and error toasts for 6s; "refreshed" toasts only on a manual refresh | `SaveStatus`, Toast | review | PR 3 (Toast), PR 7 (App.tsx:1112 poll toasts) |

**Copy deck (EU5), user-visible renames:**

| Today | New |
|---|---|
| "My feeds (N)" / "Recommended" / "Add custom" | pages "Feeds", "Recommended feeds", "Add a feed" |
| "fetch" | "Fetch now" |
| "auto-disabled" | "Stopped after N failed fetches" |
| "Track page (no RSS)" | "Website (no feed)" |
| "Sitemap URL" / "Link pattern" | "Sitemap address" / "Link pattern" under Advanced |
| "Voted" | "Downvoted" (tab id stays `voted`) |
| "Reset" | "Reset this device…" |
| "custom headers (JSON)" | "Headers" |
| "save" | removed |
| "re-enable from Feed Manager" (Column.tsx:836) | "Turn it back on in Settings › Feeds" |
| "the scheduler will fetch the first batch shortly" | "Waiting for the first fetch" |
| "Top (composite score)" / "Min score" | "Best first" / "Only stories scoring above" |
| "(local bypass)" (UserBadge.tsx:37) | removed |
| "◯ with strike" (Settings.tsx:1165) | an eye-off icon |

---

## 8. The guard: smoke test, lint, unit tests

### 8.1 Smoke (`frontend/scripts/iphone-audit/smoke.cjs`, CommonJS)

**Shared modules:**
- `mock-api.cjs` is extracted from capture.cjs:52-166. Its route matcher is anchored on the pathname (`url => /^\/(api|auth|assets)\//.test(url.pathname)`, fixing capture.cjs:53). It returns `builtin`, echoes PATCH bodies merged into the fixture, and supports per-test overrides through `page.route`.
- `checks.cjs`: the in-page rule functions.
- `states.cjs`: the state list.
- `flows.cjs`: the behaviour flows.

**Run conditions:**
- A **fresh browser context per state per device**, with no `setViewportSize`. This avoids the coarse=false artefact seen at 320/09-search after resizes.
- `context.clock.setFixedTime(F.NOW)` so "12m ago" labels are stable.
- Devices: 390x844@3 and 320x568@2, `isMobile`, `hasTouch`, iOS UA, dark mode. In PR 8, also 844x390@3.

**Rules (each finding carries the selector path, text, rect and rule id):**

| Rule | Check |
|---|---|
| R1 coarse | `matchMedia('(pointer: coarse)').matches` must be true, or the state errors (a harness problem, not a pass). |
| R2 page-width | `document.body.scrollWidth` and `#root.scrollWidth` ≤ `innerWidth`. Checking only html would miss the case: `overflow-x: clip` keeps html at 320 while body was 336. |
| R3 field-font | every visible input (not checkbox, radio, range or hidden), select and textarea computes a font size of at least 16px. |
| R4 min-text | every visible text node's parent computes at least 11px, unless inside `[aria-hidden="true"]`. |
| R5 box-spill | For each visible element (skipping `[inert]`/`aria-hidden` subtrees, `position:fixed` roots and descendants of an `overflow-x:auto/scroll` ancestor), find the nearest **painted ancestor**: background alpha > 0, any border width > 0, `overflow-x` not visible, or the sheet panel or body. Flag if the element's rect sticks out horizontally by more than 1px. Negative-margin hit areas inside a card's padding no longer flag, because the card is the painted ancestor. |
| R6 text-cut | A text node's range rect exceeds its parent while the parent clips (`overflow` not visible) **without** `text-overflow: ellipsis` or `-webkit-line-clamp` → "text cut off with no ellipsis". Also flagged: text that spills past its painted ancestor. |
| R7 label-wrap | `button`, `[role=tab]`, `[role=switch]`, `[role=button]`, `time` and `[data-chip]` with text of 28 characters or fewer must render on one line (one distinct rounded `top` among `range.getClientRects()`) and must not be ellipsized. Opt-out is `data-wrap-ok`, which only `ui/` primitives may set. |
| R8 tap-size | Every visible interactive element (`a[href]`, `button`, form controls, `[role=button\|tab\|switch\|checkbox\|link]`) measures at least 43.5x43.5px. For controls inside a `label`, the label is measured. Elements inside `[data-tap-exempt]` (article prose, summaries) are skipped. |
| R9 dialogs | any `page.on('dialog')` event is a finding (the dialog is dismissed). |
| R10 errors | `pageerror`, `console.error` other than the expected /auth/me 404, any UNMOCKED request, and, when `SMOKE_CSP=1`, any "Refused to" message. The CSP mode fulfils HTML documents with nginx's exact policy (nginx.conf.template:29) via `route.fetch` + `route.fulfill`, and runs against preview only. |
| R11 visible-error (flows) | after an induced error, `document.elementFromPoint` at the error element's centre returns the element or a descendant, inside the viewport. |
| R12 no-save (settings states) | no visible button named /^save$/i inside `[role=dialog][aria-label=settings]`. |

**States:**

| State | Content |
|---|---|
| S01 | dashboard |
| S02 | card expanded (summary, related, reddit) |
| S03 | Menu |
| S04 | search open with a query |
| S05 | Settings root |
| S06 | Feeds list |
| S07 | feed editor (60-character name, 120-character URL, two headers, auto-disabled) |
| S08 | category picker with "New category…" open and 45 characters typed |
| S09 | headers with one invalid row |
| S10 | Add a feed with YouTube chosen and a long URL, with the error message visible |
| S11 | Recommended |
| S12 | AI |
| S13 | Notifications |
| S14 | History |
| S15 | Saved list |
| S16 | Reset confirm open |
| S17 | login page (mock `/auth/local/availability` enabled) |
| S18 | landscape dashboard (PR 8) |

**Flows (added in PR 5, `flows.cjs`; each counts requests with `page.on('request')`):**

| Flow | Steps | Expected |
|---|---|---|
| FA | Menu → ✎ BBC → Category → "Tech" | exactly 1 PATCH, body `{"category":"tech"}`; editor row shows "Saved"; URL `?view=settings&tab=feeds&page=1` after back |
| FB | rename to "Bad Name!" then blur | the name normalizes to `bad_name`, 1 PATCH; rename to "" → 0 PATCH and an inline error |
| FC | rename → mocked 409 | error visible (R11); the draft is kept; Undo restores |
| FD | URL change with `route.abort('failed')` | "Couldn't reach Popping…" and Retry are visible; Retry with the route restored → 1 PATCH → Saved |
| FE | "Pretend to be a browser" | 1 PATCH with `custom_headers` containing User-Agent; adding the header "Cookie" → 0 PATCH and an inline error |
| FF | delay the PATCH response 1500ms, pick a category, tap Done | the sheet is closed immediately; after the response, the dashboard column for the new category contains the feed's entry. Failure variant: an error toast with "Open" is visible above everything. |
| FG | Done from a deep-linked editor | URL clean, `history.state.popping.depth` 0. Open → Back → closed. Open → Done → the next Back does not re-open Settings. |
| FH | paste a YouTube link in Add | POST /api/sources/auto (mock kind `youtube_channel`) → editor page for the new id. Mocked 422 → message visible inline. |
| FI | press Enter then blur in the Name field | exactly 1 PATCH |

**Output:** the exit code is non-zero on any enforced finding. `smoke-report.json` and failure screenshots go to `scripts/iphone-audit/out/` (gitignored). Enforcement is configured per state as `enforce: [ruleIds]` in `states.cjs`:

| PR | Rules enforced |
|---|---|
| PR 3 | R1, R3, R4, R9, R10 everywhere; R2, R5, R6, R7 on S01-S04. Everything else report-only. |
| PR 4 | adds R2, R5-R8 on S03, S05 and the sheet chrome of every Settings state |
| PR 5 | adds all rules plus flows on S06-S11 |
| PR 6 | all rules on S12-S17; R12 on every Settings state |
| PR 7 | R8 on S01-S02 |
| PR 8 | S18 |

**Runners:**
- `scripts/iphone-audit/smoke.sh` (local) runs `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &` (the direct binary, so `$!` is the server and `trap kill` works, unlike run.sh:13-15), waits with curl, then runs `node smoke.cjs`.
- run.sh gets the same fix.
- `smoke.cjs` resolves `playwright` locally first, then falls back to `/opt/node-tools/node_modules/playwright` for this container. Run it with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and never run `npx playwright install` in the container.

**CI** (one step added after `npm run build` in `frontend-checks`, build.yml:117):
```yaml
      - name: iPhone smoke test
        run: |
          npx playwright install --with-deps chromium
          ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &
          for i in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:4173/ && break; sleep 0.5; done
          npm run test:unit
          SMOKE_BASE=http://127.0.0.1:4173 SMOKE_CSP=1 npm run smoke
```

**package.json:**
- `"playwright": "1.56.1"` (exact; it matches the container's chromium-1194);
- `"smoke": "node scripts/iphone-audit/smoke.cjs"`;
- `"test:unit": "node --experimental-strip-types --test scripts/unit/saveQueue.test.ts scripts/unit/categories.test.ts scripts/unit/headers.test.ts"`.

### 8.2 Lint (`frontend/eslint.config.js`)

- A `mobileRules` object (core `no-restricted-globals`, `no-restricted-properties`, `no-restricted-syntax`) is applied by a config block with `files: MOBILE_SCOPE`, `ignores: ['src/components/ui/**']`.
- Selectors match `Literal` and `TemplateElement` class strings for MC1, MC2, MC4, MC7 and MC11.
- `JSXOpeningElement[name.name=/^(input|select|textarea|datalist)$/]` covers MC3.
- `CallExpression[callee.property.name='addEventListener'][arguments.0.value='mousedown']` covers MC13.
- `JSXAttribute[name.name='title']` covers MC9 (scoped).
- Every message names the primitive to use instead.
- `MOBILE_SCOPE` grows per PR:

| PR | Scope |
|---|---|
| PR 3 | `src/components/{Card,Toast,BriefCard,shell/**}`, `src/lib/**` |
| PR 4 | + shell and settings shell |
| PR 5 | + `src/components/feeds/**` |
| PR 6 | `src/**` |

- Inline `eslint-disable-next-line <rule> -- <reason>` is allowed only for the desktop-only Card context menu (Card.tsx:1795-1855).
- Lint warnings still do not fail the build; these rules are **errors**.

### 8.3 Unit tests (Node's runner, no new dependencies)

`scripts/unit/*.test.ts` import the pure modules (`../../src/lib/saveQueue.ts`, `categories.ts`, `headers.ts`), which must stay import-free with no enums or parameter properties.

**`saveQueue.test.ts`:**
- serial order;
- same-field coalescing;
- `superseded` results;
- a failure does not stop the chain;
- `idle()`.

**`categories.test.ts`:**
- normalization;
- reserved names;
- the 40-character limit;
- case-insensitive reuse;
- option ordering and counts.

**`headers.test.ts`:**
- every denylist name in every case;
- the token rule;
- duplicates;
- 512 / 20 limits;
- CR/LF;
- `rowsToMap` returns null when empty;
- `sameHeaders` is order-insensitive.

---

## 9. User flows on the iPhone, tap by tap

**Starting point:** the dashboard. The top bar has the title, search (🔍), refresh (↻) and Menu (☰).

1. **Change a feed's category (fast path).**
   - Tap ☰ (1). The Menu slides in from the right.
   - Tap ✎ on "BBC News" (2). The Menu closes, and the Settings sheet slides up already on BBC News (`?view=settings&tab=feeds&page=<id>`).
   - Tap "Category · News ›" (3). The Category page opens.
   - Tap "Tech" (4). A check appears, a PATCH is sent, and after 0.3s the page returns to the editor, where the Category row reads "Tech · Saved ✓".
   - Tap Done (5), or keep editing. BBC stories now sit under Tech.
   - **Total: 4 taps to the change, no typing, no save.** Today it is 4 taps + typing + a 13px "save" link.
2. **Same edit through Settings:**
   - ☰ (1) → Settings (2) → Feeds (3) → BBC News (4) → Category (5) → Tech (6).
   - Back steps: ‹ BBC News → ‹ Feeds → ‹ Settings. Done closes from anywhere.
3. **New category.**
   - On the Category page, tap "New category…" (1). A field opens with the keyboard (no auto-capital).
   - Type "Local news". The live line reads "Shows as “Local News”".
   - Tap Add or Return (2). It saves as "local news", Saved ✓, and returns.
   - "For You" shows "That name is used by a built-in column" with Add disabled.
   - A 41st character shows "Keep it under 40 characters".
   - "news" when "News" exists shows "Using your existing “News” category".
4. **Rename or change the address.**
   - In the editor, tap the Name field (1), type, then tap anywhere else or Return (2). After 300ms a spinner shows, then Saved ✓.
   - Spaces become underscores, and "Shows as …" previews the label.
   - A name already taken shows "Another feed already uses that name." in red under the field; the text stays; Undo restores the old name.
   - **Address:** the URL keyboard appears. Typing a YouTube channel page converts it to the feed link, with a note.
   - For built-ins both fields are read-only, with a one-line note.
5. **Headers (no code).**
   - Editor → Advanced (1) → "Pretend to be a browser" (2). A User-Agent row appears, Saved ✓.
   - **Manual:** "+ Add header" (1), type the name and value, then tap outside the row (2), Saved ✓.
   - **Remove:** ⊖ (1). The header is removed, Saved ✓, and a toast offers "Undo".
   - Typing "Cookie" shows "Popping can't send a Cookie header" and nothing is sent.
6. **Pause.**
   - Editor → the "Check for new stories" switch (1). Saved ✓, and the Feeds list shows "Paused".
   - Total from the dashboard: 3 taps (☰, ✎, switch).
7. **Refresh interval.**
   - Editor → "Check every" (1) → the iOS wheel → "6 hours" → Done on the wheel (2). Saved ✓.
8. **Test.**
   - Editor → "Test this feed" (1). It shows "Looks good — 23 stories", or e.g. "This site blocks automated readers." with a "Pretend to be a browser" button (2), which adds the header and saves.
9. **Delete.**
   - Editor → "Delete feed" (1). The row becomes "Delete BBC News? Its stories go too." with [Delete] [Pause instead] [Cancel], and no timer.
   - Delete (2). The page returns to the Feeds list, with the toast "Deleted BBC News".
10. **Add a YouTube channel.**
    - ☰ (1) → "Add a feed" (2) → tap the link field (3) → paste → Add (4).
    - The server resolves the link. The page becomes the new feed's editor (category Video) with the toast "Added Veritasium (YouTube)".
    - If YouTube blocks the server, the message under the field explains how to copy the channel ID. Paste it and tap Add (2 more taps).
11. **Save this view.**
    - ☰ (1) → "Save this view" (2). A field appears with the keyboard. Type "Morning" and tap Return (3).
    - The toast "Saved view “Morning”" appears, the Menu closes, and the chip appears.
12. **Sign out.** ☰ → Settings → Account → "Sign out" (only with OIDC on).
13. **Closing and Back.**
    - Done, Esc, a backdrop tap or a swipe down on the sheet header all close it, and the URL is clean.
    - Browser or OS Back steps up one page, then closes.
    - After Done, Back never re-opens Settings.

---

## 10. Pull requests (each branches from main after the previous one merges, because CI runs only on PRs into main, build.yml:14-18)

Every PR runs §11 before pushing and passes the §1 path check.

### PR 1: YouTube links add reliably (backend + minimal frontend)

**Files:**
- `backend/app/youtube.py`, `backend/app/config.py`, `backend/app/routes/sources.py` (create/auto/test/patch YouTube paths, optional name), `backend/app/schemas.py` (`SourceCreate.name` Optional, `SourceAutoRequest.category` Optional, docs);
- `backend/tests/test_youtube.py`, `backend/tests/fixtures/youtube/*.html`;
- `.env.example`, `README.md`;
- `frontend/src/api.ts`, `frontend/src/components/FeedManager.tsx` (inline errors, labels, optional name only).

**Acceptance:**
- `pytest backend/tests/test_youtube.py` passes with no DNS and no network (the autouse transport fails on any real call).
- Every offline shape in §5.1 resolves with no handler call.
- The canonical link beats a featured `"channelId"`.
- The blocked → channel-ID message path works, and so does the API-key header path with no key in the URL.
- The loopback redirect is refused.
- slice15 and sitemap guard tests stay green unmodified.
- The Add failure shows inline in the sheet at 390px (screenshot).
- The full backend suite is green in CI.

**On the phone after update:** add a channel by @handle in Settings › Feeds › Add custom. If YouTube refuses, the message says what to paste.

### PR 2: the feed API contract

**Files:** `backend/app/schemas.py`, `backend/app/routes/sources.py`, `backend/app/scheduler.py`, `backend/tests/test_source_patch_contract.py`, `frontend/src/api.ts`, `frontend/src/components/FeedManager.tsx` (builtin flag only).

**Acceptance:**
- GET /api/sources returns `builtin:true` for exactly the 7 registry names.
- " tech " is stored as "tech".
- A category-only PATCH records no `add_job`; a headers PATCH records one.
- Blank or invalid header names → 422.
- Reddit Test returns items through the monkeypatched client.
- Every case in §5.2 is pinned.
- The RFD row shows the built-in badge, with locked name and URL.

### PR 3: guardrails, and text that fits on the dashboard

**Files:**
- `frontend/package.json` + lock (playwright devDependency, scripts);
- `frontend/scripts/iphone-audit/{mock-api,checks,states,smoke}.cjs`, `smoke.sh`, plus `run.sh`, `capture.cjs`, `probe.cjs` selectors, `fixtures.cjs` (`builtin`), `README.md`, `.gitignore`;
- `frontend/scripts/unit/*` (`saveQueue.test.ts` only, plus `src/lib/saveQueue.ts`);
- `.github/workflows/build.yml` (one step), `frontend/eslint.config.js`, `frontend/tailwind.config.js` (fontSize, zIndex);
- `frontend/src/styles.css` (overscroll, `.meta-line`, `.action-bar`, card container queries);
- `frontend/src/components/shell/AppHeader.tsx` (new; extracted, gear still present), `frontend/src/components/ui/{TextField,Button,icons}.tsx`;
- `frontend/src/App.tsx` (header extraction, minHeight removed, banner `z-banner`, safe-area left/right on phone main and tab strip, `overscroll-contain` on the phone scroller);
- `Card.tsx` (meta line, action bar, container-query thumbnail, 11px chip, `data-tap-exempt` on prose), `Toast.tsx` (z-toast, 3 lines, 4s/6s), `BriefCard.tsx` (header wrap), `Column.tsx` (overscroll class only; keep `memo(ColumnInner` and `sourcesByName`).

**Acceptance:**
- `npm run lint` has 0 errors with the new rules in scope.
- The smoke passes with the PR 3 enforcement set at 390 and 320 under the production CSP.
- Deliberately re-adding `w-44` to the search box makes R2/R5 fail locally; reverting passes. Record this in the PR description.
- Body width at 320 with search open is 320 (was 336).
- The headline at 320 is no longer a ribbon: title width ≥ 60% of the card in screenshots.
- CI's new step is green and adds ≤ 3 minutes.

### PR 4: one top-bar button; Menu and Settings on the shared Sheet

**Files:**
- `src/components/ui/{Sheet,List,InlineMessage,Checkbox}.tsx`, `src/lib/{route,viewport}.ts`;
- `src/components/shell/Menu.tsx` (new), `src/components/Drawer.tsx` (deleted);
- `src/components/settings/SettingsRoot.tsx`, `src/components/Settings.tsx` (shell on Sheet with root + page header; existing tab bodies rendered as pages; FeedManager wrapped in `List` gutters);
- `src/App.tsx` (gear removed, `useRoute`, `openSettings`/`closeOverlay`, Menu wiring, Save-this-view inline, `onResetLocalState` removed, desktop jump ref fix);
- `src/components/Hamburger.tsx` (comment only), `src/components/shell/AppHeader.tsx`;
- `tailwind.config.js` (`sheet-up` comment);
- `scripts/iphone-audit` states and selectors (no `open settings`; new `edit {label}`, Settings root rows).

**Acceptance:**
- The phone top bar has exactly title, search, refresh and Menu, and no element `[aria-label="open settings"]`.
- The Menu has Settings, Save this view, the filter rows with ✎, and Add a feed; there is no History, All settings… or Jump to column below md.
- FG passes, including legacy `?view=settings&tab=history`, which opens History with ‹ Settings.
- No `window.prompt` call remains for saving a view.
- Sheet Done/back are ≥ 44px (R8).
- Closed Menu content is not focusable (smoke Tab-order check).
- **On the phone:** focus a field low in the Feeds page; the sheet header stays visible above the keyboard (MC6).

### PR 5: the feed editor that saves itself

**Files:**
- `src/components/feeds/*` (all 7), `src/components/ui/{Select,Toggle,ChoiceList,KeyValueEditor,ConfirmAction,SaveStatus,Disclosure}.tsx`, `src/lib/{autosave,apiErrors,categories,headers}.ts`;
- `src/components/FeedManager.tsx` (deleted), `src/components/Settings.tsx` (feeds tab → `FeedsPage`), `src/components/shell/Menu.tsx` (✎ → editor);
- `src/App.tsx` (`applySourceUpdate`, `onSourceAdded`, `onSourceDeleted`, poll guard, `openFeedEditor`), `src/components/Column.tsx` (empty-state button), `src/api.ts` (`keepalive` on PATCH);
- `scripts/unit/{categories,headers}.test.ts`, `scripts/iphone-audit/{states,flows}.cjs`.
- **Backend guard tests migrated:**
  - `backend/tests/test_frontend_slice15_add_generic_scrape.py` now reads `frontend/src/components/feeds/AddFeed.tsx` and asserts:
    - `type SourceType = 'rss' | 'reddit' | 'podcast' | 'youtube_channel' | 'generic_scrape'`;
    - a `TYPE_OPTIONS` entry `value: 'generic_scrape'` labelled "Website (no feed)";
    - a `URL_TYPES` list containing rss, podcast, youtube_channel and generic_scrape;
    - `URL_LABEL.generic_scrape` mentions "no feed";
    - placeholder `'https://example.com'` for generic_scrape;
    - "Couldn't find a feed" and "Track this page anyway";
    - `const trackAnyway = async () => {` calling `api.createSource` with `type: 'generic_scrape'` and no client-side slug ops (the server names it, PR 1);
    - the api.ts `testSource` union (unchanged).
  - `test_source_create_sitemap_link_pattern.py:199-280` now reads AddFeed.tsx and accepts `onChange={setSitemapUrl}`, keeping `{sourceType === 'generic_scrape' && (`, `sitemap_url: ` and `link_pattern: `.
  - Run `pytest -m no_db` locally before pushing.

**Acceptance:**
- Flows FA-FI pass. In particular, no commit sends more than one PATCH, and Enter followed by blur sends one.
- Every §9 flow 1-10 works in the smoke run against the mock.
- Built-ins show read-only name and address and no Advanced section; reddit shows no Headers.
- Settings shows no "save" button (R12).
- No feed error reaches the App banner: a smoke assertion that `[role=alert]` stays absent during the flows.
- Unit tests pass.
- `rg -n "KNOWN_BUILT_INS|datalist|JSON.parse" src/components/feeds` finds nothing.

### PR 6: every Settings page on the primitives; no native dialogs; the 16px override removed

**Files:**
- `src/components/settings/{AiPage,NotificationsPage,HistoryPage,EntryListPage,ResetPage}.tsx`, `src/components/Settings.tsx` (shell only), `src/components/ui/{Segmented,Slider}.tsx`;
- `src/components/shell/PresetChips.tsx` (extracted from App.tsx:230-370 with inline rename, Yes/No raised to 44px);
- `src/components/LoginPage.tsx` (TextField, username `autoCapitalize="none"`);
- `src/components/Column.tsx` (popover controls → `Select`/`Slider`, outside-tap via `pointerdown`; memo kept);
- `src/lib/storage.ts` (brief tone key), `src/styles.css` (delete the coarse `!important` rule), `eslint.config.js` (`MOBILE_SCOPE = src/**`), smoke states S12-S17.

**Acceptance:**
- `rg -n "window\.(prompt|confirm|alert)|\bprompt\(|\bconfirm\(" frontend/src` finds nothing.
- Lint is clean across `src/**`.
- With the 16px rule deleted, R3 passes on every state (no field under 16px).
- AI provider and model changes save without a button and survive a reload.
- Brief tone survives a reload.
- Clear all / Hide all downvoted show an Undo toast that restores.
- Empty states use touch wording.
- **On the phone:** focus each field type and confirm the page does not zoom.

### PR 7: dashboard behaviour sweep (the remaining checklist items)

**Files:** `App.tsx`, `Card.tsx`, `Column.tsx`, `Toast.tsx`, `UserBadge.tsx`, `lib/preferences.tsx`, `lib/storage.ts`, `api.ts`.

**Changes:**
- **Column header** stops being a mark-read button (Column.tsx:314-325). It gets an explicit 44px "Mark all read" in the ⋯ popover and the header.
- **"+N new" chip** (Column.tsx:341-357) scrolls to the Fresh section and clears the count instead of refreshing.
- **"refreshed" toast** only on a manual refresh (App.tsx:1112).
- **Hide wording:** one string, "Hidden. Undo" (App.tsx:1615 vs 2452).
- **Mobile tab memory by column name**, with a migration from the index key (App.tsx:1358-1367, storage.ts:52).
- **Card swipe** follows the finger 1:1: `transition = animate ? 'transform 180ms ease-out' : 'none'` (Card.tsx:513).
- **Card long-press copy** dropped on touch (Card.tsx:585-593).
- **Thumbnail** becomes an `<a>` (Card.tsx:1690-1760).
- **Card action icons and vote pills raised to 44px.**
- **Readable API errors** everywhere through `errorMessage` (api.ts:284 call sites).
- **Preference write failures** produce one error toast plus a retry (preferences.tsx:527-531).
- **Plain-language labels** (copy deck).
- **Star tooltip** shortcut corrected to (b).

**Acceptance:** R8 is enforced on S01-S02 and passes; each checklist item is listed in the PR description with file:line or struck with a reason; the test_slice21 and slice19 guards stay green.

### PR 8: landscape keeps the phone layout

**Files:** `tailwind.config.js` (screens), `src/lib/viewport.ts`, the `App.tsx`/`AppHeader.tsx` `sm:` → `md:` swaps, `BriefCard.tsx:372` (`PHONE_QUERY`), `FramingWatch.tsx`, smoke state S18.

**Acceptance:**
- At 844x390 the phone tab bar is visible and the desktop grid is hidden.
- At 1024x768 and 1440x900 the desktop layout is unchanged (screenshots).
- **On the phone:** rotate; nothing sits under the notch.

---

## 11. Verification recipe (container, before every push)

```bash
cd /home/user/popping/frontend && npm ci
npm run lint && npm run build                      # 0 errors; tsc strict + vite
npm run test:unit                                  # from PR 3
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash scripts/iphone-audit/smoke.sh   # builds, previews on :4173 --strictPort, runs smoke with SMOKE_CSP=1
# look at scripts/iphone-audit/out/*.png for any failing state; run the full audit when layout changed:
bash scripts/iphone-audit/run.sh; pkill -f 'vite preview' || true; git -C /home/user/popping clean -fdX frontend/scripts/iphone-audit/
```

**Backend (PRs 1-2):** use the local recipe from the verification report.
- Postgres 16 + pgvector via `apt-get install -y postgresql-16-pgvector` or a source build;
- `initdb`/`pg_ctl` as the postgres user;
- `CREATE EXTENSION vector`;
- /etc/hosts entries for example.com/org/net and reddit.com;
- `uv venv --python 3.12` + `uv pip install --no-deps -r backend/requirements-dev.lock`;
- `PYTHONPATH=$PWD python -m pytest -ra`. The baseline is 623 passed.
- The YouTube tests themselves need neither DNS nor network.

**CI:** poll `gh api repos/adamjmachill/popping/commits/<sha>/check-runs` until backend tests, frontend lint + build, backend image and frontend image all succeed (`gh pr view` returns 403).

**On-phone checks after each popping-update** (Chromium cannot emulate these):
- MC2: safe areas in portrait and landscape;
- MC3: no zoom when focusing a field;
- MC6: the keyboard does not cover the field or push the sheet header away;
- MC15: rotation;
- Done and Back behaviour in the home-screen app.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS-only behaviour (visualViewport keyboard, safe areas, focus zoom, standalone history) cannot be proven in Chromium | Feature-detected Sheet with a static fallback; the on-phone checks are listed per PR; the 16px override is removed only after lint bans raw controls and R3 passes everywhere (PR 6). |
| `history.go(-depth)` miscounts after a deep link or reload | Depth lives in `history.state` (survives reload); a missing state → `replaceState` fallback; flow FG covers deep link, Back and Done. |
| Autosave triggers extra ingests or user-visible churn | Text commits on blur/Enter only; equality skips no-ops (FI); same-field coalescing; backend skips the rebuild for category-only changes. Headers and URL still rebuild by design: the plugin binds them. |
| Background poll overwrites a just-saved value | `localWriteAt` guard in `refresh()`; flow FF asserts that the column changes and does not flash back. |
| Error after the editor closed goes unseen | Module-level queue + `onUnmountedError` toast at z-60 with an "Open" action; FF failure variant. |
| Concurrent edits from two devices | Last write wins per field (no version column, models.py:40-99). Accepted for a single-user app; documented. |
| Source-text guard tests break on the FeedManager deletion | Migrated in the same PR (PR 5) with the literal list in §10; `pytest -m no_db` before pushing. Column, App and Card guards (slice19, slice21, slice30) are kept by not renaming the pinned symbols. |
| Smoke test flakiness | A fresh context per state, no viewport resizing, a fixed clock, deterministic fixtures, anchored mocks, R1 precondition, per-state enforcement lists, failure screenshots. |
| Lint regexes on class strings miss computed classes or false-positive | Rules ban patterns, not semantics; the smoke test measures the rendered result as the second layer; disables need a reason and are limited to the desktop context menu. |
| YouTube changes its markup or blocks the server outright | Six markers in priority order; consent cookie and browser UA; optional API path; a clear channel-ID fallback that needs no network. Saved-snippet tests cannot detect upstream drift, so the post-deploy phone check (add by @handle) is listed. |
| A Dependabot bump of playwright breaks local container runs (chromium-1194) | Pinned exactly; smoke.cjs falls back to the container's global 1.56.1; CI downloads the matching browser, so bumps stay green there. Reject bumps until the container image updates. |
| CI time grows | One step, about 1-3 minutes (browser download plus ~40 state runs). |
| Container queries need iOS 16+ | Older Safari falls back to the beside-title layout (today's behaviour). |
| The optional POST `name` and `/auto` category default change the API | Backward compatible: callers that send them behave exactly as before; existing tests always pass a category. |
| Large PRs (PR 5 deletes about 1,800 lines and adds about 1,400) | Split by page files; primitives land in PRs 3-4 with their first consumers; each PR is behaviour-complete and revertable by image tag. |
| Breakpoint change (PR 8) touches layout everywhere | Isolated last PR with desktop screenshots at 1024 and 1440 and a landscape state; revert is one config line. |


## Code reader reports

### frontend/src/components/Settings.tsx — overlay container, tab strip, per-tab controls and save mechanisms, FeedManager embedding

# Settings.tsx map (1694 lines, at origin/main 721713e incl. PR #12)

All paths relative to /home/user/popping. Font sizes: `text-ios-body` = 17px/22px, `text-ios-caption` = 13px/18px, `text-ios-large-title` = 34px (frontend/tailwind.config.js:67-73). On touch screens every `input, textarea, select` is forced to 16px by `@media (pointer: coarse)` (frontend/src/styles.css:24-26, added in PR #11 002ff64).

## 1. Overlay container

- Mount guard: `if (!open) return null` (Settings.tsx:182). App renders `<Settings open={settingsOpen} tab={settingsTab} …>` (App.tsx:2834-2836).
- Open/close is URL-driven: App's `sync()` reads `?view=settings&tab=…` on mount + `popstate` (App.tsx:394-428); `openSettings()` does `pushState` with `view=settings&tab=<t>` (App.tsx:430-437); `closeSettings()` deletes both params with another `pushState` (App.tsx:438-444). Allow-listed tabs: feeds|llm|notifications|history|hidden|starred|voted|reset (App.tsx:409-418).
- Backdrop: `fixed inset-0 z-50 bg-black/70 … animate-fade-in`, `role="dialog" aria-modal="true" aria-label="settings"` (Settings.tsx:185-189). Backdrop tap closes only when `e.target === e.currentTarget` (Settings.tsx:190-194).
- Sheet panel (Settings.tsx:204-205):
  - Mobile: `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-t-ios-lg bg-bg-app shadow-2xl flex flex-col` — pinned by top edge (PR #11 replaced `top-auto h-[92vh]`; diff at commit 002ff64, Settings.tsx hunk @@ -195,10 +195,13). Comment explains iOS vh counted toolbar space (Settings.tsx:198-200).
  - Desktop (`md:` = Tailwind default 768px, so an iPad in either orientation gets this): `md:inset-y-0 md:right-0 md:left-auto md:top-0 md:bottom-auto md:h-full md:w-[480px] md:rounded-none` (Settings.tsx:205).
  - No slide-up animation on the panel itself; only the backdrop fades (Settings.tsx:189). `sheet-up` keyframes exist in tailwind.config.js:97-100,116 but are unused here. Drawer by contrast uses a translate transition (Drawer.tsx:286-294).
- Safe areas: top via the panel's `top-[calc(env(safe-area-inset-top)+0.75rem)]` (Settings.tsx:204); bottom via body `pb-[calc(2rem+env(safe-area-inset-bottom))]` (Settings.tsx:263). The header row itself has no safe-area padding (Settings.tsx:211) — correct because the sheet starts below the inset. `#root { padding-bottom: env(safe-area-inset-bottom) }` (styles.css:20) does not apply inside the fixed overlay.
- Scroll locking: none. No `document.body` style mutation, no `overflow-hidden` on body, no `overscroll-contain` on the scroll body (grep over App.tsx/Settings.tsx/Drawer.tsx/FeedManager.tsx/main.tsx returned only unrelated hits: App.tsx:350 comment, Settings.tsx:292 grid, Drawer.tsx:529-531). Scroll body is `flex-1 min-h-0 overflow-y-auto bg-bg-app` (Settings.tsx:263). On iOS, when a tab's content is shorter than the sheet (Notifications, Reset), a touch-drag inside the sheet scroll-chains to the dashboard beneath.
- Close affordances: (a) Done button, `min-h-[32px] min-w-[32px]`, `text-ios-body`, `aria-label="close settings"` (Settings.tsx:212-218); (b) backdrop tap (190-194); (c) Esc via capture-phase window keydown listener (169-180); (d) browser Back (App.tsx:426 popstate sync). No swipe-to-dismiss: zero `onTouch*` handlers in Settings.tsx (grep empty). No focus management: no `autoFocus`, `focus()`, `tabIndex` (grep empty), unlike Drawer which focuses its Done button (Drawer.tsx:265-276).
- Header: `flex items-center justify-between px-4 pt-3 pb-3 md:pt-5 md:pb-4 border-b border-hairline shrink-0` (Settings.tsx:211). Title `text-2xl` (24px) mobile / `md:text-ios-large-title` (Settings.tsx:219); text is `'Settings'` on feeds tab else `` `Settings → ${label}` `` (Settings.tsx:220).

## 2. Tab strip and SettingsTab union

- `export type SettingsTab = 'feeds'|'llm'|'notifications'|'history'|'hidden'|'starred'|'voted'|'reset'` (Settings.tsx:40-48). `TAB_META` labels/icons: Feeds, AI, Notifications, History, Hidden, Saved, Voted, Reset (Settings.tsx:106-115). The file header comment still says "four tabs" (Settings.tsx:5-13) and App's comment says five (App.tsx:401) — stale.
- Strip: `flex gap-1.5 overflow-x-auto px-4 mt-3 pb-1` `role="tablist"` (Settings.tsx:228). Order hard-coded in the map array (Settings.tsx:229). Eight pills don't fit a phone width; strip scrolls horizontally with no fade/indicator; Reset/Voted are off-screen on open.
- Pill button: `shrink-0 min-h-[36px] flex items-center gap-1.5 rounded-full px-3 text-ios-caption font-medium` (Settings.tsx:248) — 36px tall, 13px label, 16×16 icon (TabIcon, Settings.tsx:433-521). Active = `bg-accent text-white`, inactive = `bg-bg-surface text-label-secondary` (Settings.tsx:249-252).
- Tab switch mechanism: `replaceState` with new `tab` param then `window.dispatchEvent(new Event('popstate'))` so App's `sync` re-reads the URL (Settings.tsx:238-246). Because it is replaceState, tab switches add no history entries; Back from any tab closes the overlay.
- `TabIcon` `default:` case has an empty body and returns undefined (Settings.tsx:519-521).

## 3. Per-tab controls and save mechanism

### Feeds (Settings.tsx:264-273)
- Wrapper `<div className="pt-4">` — no `px-4` (Settings.tsx:265). Every other tab wrapper is `pt-4 px-4` (llm 275, notifications 331, reset 401, EntryIdListContent 1391, History 1127). FeedManager root is `space-y-2` with no horizontal padding (FeedManager.tsx:225); its tablist `flex gap-1` is flush to the screen edge (FeedManager.tsx:226); rows get `px-3` (FeedManager.tsx:574, 686), so the Feeds tab gutter is 0px (tabs) / 12px (rows) vs 16px elsewhere.
- Props passed: `sources`, `onRefresh={onRefreshSources}`, `onError`, `onSourceRenamed` (Settings.tsx:266-271). `onRefreshSources` is App's `async () => { void refresh() }` (App.tsx:2838).
- Inside FeedManager (embedded controls, for completeness):
  - Sub-tabs My feeds / Recommended / Add custom: `TabButton` `flex-1 min-h-[36px] rounded-ios text-ios-body` (FeedManager.tsx:278) — a second tab strip nested under the Settings tab strip.
  - Row disclosure button `w-full min-h-[44px]` (FeedManager.tsx:690); expanded controls: `pause` `min-h-[36px] text-ios-caption` (793); `edit` text link, no min-h, 13px (799-804); interval shown as a text link (833-840) that swaps to a `<select>` `text-ios-caption … px-1 py-0.5` (825-837) whose `onChange` saves immediately via `api.updateSource(id,{refresh_interval_seconds})` (827, 398-408); `fetch` (868-891) and `delete` two-tap (894-926), all 13px text links without min-h.
  - Inline edit form (FeedManager.tsx:568-676): container `px-3 py-2 text-ios-caption` (574). Labels `text-[11px] uppercase` (576, 588, 604, 632). name/url/category `<input>` `px-2 py-1 text-ios-body`, no min-h → ~30px tall (577-583, 589-595, 605-612). **Category** is `<input type="text" list="feed-category-options">` + `<datalist>` from the hard-coded `CATEGORY_OPTIONS` (605-619; list at 80-103) — not derived from the user's existing source categories. **Headers** is a `<textarea rows={3} … text-ios-caption font-mono>` holding a JSON string (635-643), live-validated with `JSON.parse` (477-506), placeholder `'{"User-Agent": "Mozilla/5.0 ..."}'` (641). Hints `text-[10px]` (598, 645, 650). **Save** is a bare lowercase text link `save` `text-ios-caption text-accent`, no min-h (656-663); `cancel` beside it (664-670). `saveEdit` diffs fields and PATCHes via `api.updateSource` (508-566; api.ts:424-434). No autosave, no on-blur save; closing the sheet discards edits.
  - Add custom tab uses a proper `<select id="fm-category">` for category (FeedManager.tsx:1722-1731, `min-h-[36px]`) — inconsistent with the edit form's free-text input.

### AI / LLM (Settings.tsx:274-328, LLMSection 540-947)
- Status card: `rounded-ios bg-bg-surface border border-hairline p-3` (727). Shows backend/model or "Not configured" (731-762). Error state is a tap-to-retry button `flex-1 … px-2 py-1` (731-740).
- "Edit"/"Cancel" toggle: `shrink-0 text-ios-body text-accent active:opacity-60 px-2`, no min-h (~22px tall) (764-768). `openPicker` fetches `api.settings()` then tags (605-618); `Cancel` just hides the form, discarding typed values (767).
- Provider `<select>` `w-full min-h-[36px] rounded-ios bg-bg-elevated border border-hairline px-2 text-label-primary`, no text-size class (inherits 16px; 16px forced on touch) (776-787). `changeProvider` clears both models and refetches tags (625-637).
- Brief model: `<input type="text">` when no tag list (796-802); else `<select>` with `★` recommended prefix (812-826) or free-text `<input>` (804-810) toggled by a 13px text link `type a name instead` / `pick from list`, no min-h (828-834). Scoring model: same `<select>`/`<input>` pair (846-872) with a stale-name fallback `<option>` (862-864) that the brief select lacks.
- API keys: four `<input type="password" autoComplete="off">` `flex-1 min-w-0 min-h-[36px]` (895-904) with a 13px `clear` text link, no min-h (905-914). `clearApiKey` PUTs `{[field]: ''}` **immediately** (696-712); typed keys are only sent on Save (673-682, explanatory copy at 877-881).
- **Save**: full-width `w-full min-h-[44px] rounded-ios bg-accent … text-white`, lowercase label `save`/`saving…`, no text-size class (928-934). `save()` PUTs provider/models/keys then refetches status and collapses the picker (669-694).
- Brief tone: 3-segment control, each `min-h-[44px] text-ios-body font-normal`, `aria-pressed` (299-317). Auto-applies on tap via `onBriefToneChange` (305) → App's `setBriefTone`, which is plain `useState('terse')` (App.tsx:457) — not persisted; resets to Short on reload.
- Generate brief now: `w-full min-h-[44px] rounded-ios bg-accent … text-ios-body font-medium` (319-327), disabled while generating or when `llm.configured === false` (323).

### Notifications (Settings.tsx:330-372)
- Read-only status: red error card with `Retry` link `mt-2 text-ios-caption text-accent`, no min-h (332-350); "checking…" (352); green Configured (353-359); amber Not configured telling the user to edit `.env` and restart (360-366). Footer copy also references `.env` (367-370). No controls; nothing to save.

### History (Settings.tsx:398, HistoryTabContent 954-1210)
- Group-by toggle `Controls`: two pills `flex-1 rounded-full px-3 py-1.5 min-h-[28px] text-ios-caption` (1218-1244). Auto-applies: `setHistoryGroupBy` from `usePreferences()` (978-980) updates state and queues a debounced server PUT (preferences.tsx:707-712, 519-527).
- Paginated fetch `PAGE_SIZE = 50` (1000), IntersectionObserver infinite scroll with sentinel (1065-1092, 1199-1208). Rows are external `<a>` cards `p-2.5` (1159-1181). Error state is plain red text (1091-1095). Loading state plain text (1084-1088).

### Hidden / Saved / Voted (Settings.tsx:374-396; EntryIdListContent 1377-1460; wrappers 1466-1538, 1542-1614, 1627-1694)
- Shared layout: header card with count + bulk action text link `text-ios-body text-accent active:opacity-60 shrink-0`, no min-h (1403-1410); error card (1413-1417); row list `divide-y divide-hairline` (1424-1457) where each row has a truncating `<a>` title (1431-1439) and a per-row action `text-ios-caption text-accent … shrink-0 self-center`, no min-h (1446-1454).
- All actions apply immediately through App callbacks (App.tsx:2848-2886); bulk actions toast (App.tsx:2857, 2863, 2881-2884). No undo.
- Empty-state copy references desktop-only gestures: "Right-click a card … (or press h)" (1526), "(or press b)" (1598), "right-click → Downvote" (1683).
- Three near-identical fetch effects keyed on `ids.join(',')` (1484-1510, 1557-1583, 1642-1668).

### Reset (Settings.tsx:400-422)
- One card; destructive button `mt-3 w-full min-h-[44px] rounded-ios bg-red-500/15 border border-red-500/40 text-red-300`, no text-size class (411-420), gated by native `window.confirm` (413). Immediate on confirm.

## 4. Cross-tab inconsistencies

1. Save model differs per control: explicit `save` (FeedManager edit form 656-663; LLM picker 928-934) vs immediate (interval select FeedManager 827; pause 386-396; API-key clear 696-712; Hidden/Saved/Voted row+bulk actions 1403-1454; Reset 411-420) vs auto-apply session-only (Brief tone 305 → App.tsx:457) vs auto-apply persisted+debounced (History group-by 978-980 → preferences.tsx:707-712).
2. Tap-target heights: 44px (brief tone 306, generate 324, reset 417, LLM save 931, FeedManager row 690) / 36px (tab pills 248, selects+inputs 779-903, FeedManager TabButton 278, pause 793) / 32px (Done 215) / 28px (History pills 1230, 1238) / no min-height at all on text-link actions (LLM Edit 765, type-a-name 831, clear 910, Retry 346, bulk 1406, row action 1450; FeedManager edit 801, save 660, cancel 667, delete 897, fetch 886).
3. Label casing: lowercase `save`/`saving…`/`clear`/`clearing…` (Settings 912, 933; FeedManager 662, 669, 804) vs capitalised `Done`/`Edit`/`Cancel`/`Retry`/`Restore`/`Remove`/`Hide`/`Clear all` (Settings 217, 767, 348, 1524-1529, 1596-1601, 1681-1686).
4. Horizontal gutter: Feeds tab 0/12px (Settings 265; FeedManager 225-226, 574) vs 16px on all other tabs (275, 331, 401, 1127, 1391).
5. Label font sizes: FeedManager `text-[10px]`/`text-[11px]` (576, 588, 598, 604, 632, 645, 650, 712, 784) vs 13px `text-ios-caption` labels in Settings (289, 773, 791, 843, 874).
6. Category control: free-text `<input list>` in the edit form (FeedManager 605-619) vs `<select>` in Add custom (1723-1731); both sourced from the hard-coded `CATEGORY_OPTIONS` (80-103), neither reads the user's live categories (App derives `categories` and passes them only to Drawer, App.tsx:2804).
7. Error surfaces: Notifications inline card (332-350); LLM inline row + inline text (731-740, 918-926); FeedManager → App banner `onError` + toasts (FeedManager 561, 877-883); Hidden/Saved inline card (1413-1417); History plain red text (1091-1095).
8. Headers: edit form exposes raw JSON textarea (FeedManager 635-643); Recommended tab silently applies `default_headers` on Add (1042-1050); Add custom's headers UI starts at FeedManager 1690-1716 (inputs `min-h-[36px]`).
9. Nested tab strips: Settings tab strip (228-258) above FeedManager's own three-tab strip (FeedManager 226-236).

## 5. Top-bar entry points (context for complaint #5)
- Header trailing cluster: search 44×44 (App.tsx:2267-2282), refresh 44×44 mobile-only (2286-2295), **settings gear** 44×44 `aria-label="open settings"` → `openSettings('feeds')` (2305-2331), **Hamburger** 44×44 `aria-label="open menu"` (2333; Hamburger.tsx:11-17).
- Drawer "Quick settings" group contains `History` → `onOpenSettings('history')` (Drawer.tsx:336-350) and `All settings…` → `onOpenSettings()` (Drawer.tsx:377-389). App wires `onOpenSettings={(tab) => openSettings(tab ?? 'feeds')}` (App.tsx:2811). So Settings is reachable from the gear, the Drawer row, and the Drawer History row.


#### Constraints
- Tab identity is URL state: ?view=settings&tab=<SettingsTab> is parsed by an explicit allow-list in App.tsx:394-428 and set via pushState in App.tsx:430-444; any new tab id or rename must be added there, and the Drawer's deep link uses tab ids (Drawer.tsx:345, 384; App.tsx:2811).
- Settings.tsx:238-246 switches tabs by replaceState + a synthetic popstate event that App.tsx:426 listens to; a redesign that drops that event must still re-sync App's settingsTab state.
- Esc handling is a capture-phase window keydown listener (Settings.tsx:169-180) that stops propagation so App's own Esc handler on the search input does not fire while the sheet is open.
- The overlay is z-50 (Settings.tsx:189); Drawer is z-30/z-40 (Drawer.tsx:252, 286), ShortcutsSheet z-40 (ShortcutsSheet.tsx:70), Toast z-50 rendered after Settings in the tree (Toast.tsx:117; App.tsx:2834-2890) — stacking order must be preserved.
- Mobile sheet must stay pinned by its top edge with env(safe-area-inset-top), not a vh height (Settings.tsx:198-204, PR #11 002ff64); bottom padding must keep env(safe-area-inset-bottom) (Settings.tsx:263).
- All inputs/textareas/selects on touch screens are forced to 16px by styles.css:24-26 to stop iOS focus zoom; any new text-sized control classes must not undo that (it is !important, so only non-form elements can be smaller).
- md: (768px) is the desktop breakpoint for the right-hand 480px panel (Settings.tsx:205); iPads get the desktop layout.
- FeedManager's PATCH surface is api.updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? }) (api.ts:424-434); custom_headers is a flat string→string map, null clears (FeedManager.tsx:538-547).
- Renaming a source must bubble oldName/newName through onSourceRenamed so App remaps the active filter chip in the same render (Settings.tsx:84-87, 270; FeedManager.tsx:548-558; App.tsx:2844).
- LLM API-key inputs are write-only: never prefilled, blank = don't touch, '' = clear (Settings.tsx:582-590, 673-682, 696-712; api.ts:222-234).
- Brief tone is plain React state in App (App.tsx:457), not persisted; History group-by is persisted via the PreferencesProvider's debounced PUT (preferences.tsx:707-712, 519-527); the provider wraps App in main.tsx:9-13 so usePreferences() is available anywhere under it.
- Hidden/Saved/Voted ids come from App and row/bulk actions are App callbacks (Settings.tsx:88-104; App.tsx:2848-2886); the tabs only fetch display rows via api.entriesByIds (Settings.tsx:1494, 1567, 1652).
- Backend validation is the source of truth for feed edits; errors flow to App's banner via onError (FeedManager.tsx:22-26, 561) and are formatted by parseApiError (FeedManager.tsx:190-205).

#### Findings
- [high] frontend/src/components/FeedManager.tsx:605: Category in the inline edit form is a free-text <input> backed by a <datalist> of the hard-coded CATEGORY_OPTIONS (lines 80-103), not the user's actual categories; iOS Safari's datalist UI is a weak suggestion bar, so the user has to type and spell the category exactly. The Add-custom tab uses a real <select> for the same field (line 1723). Fix: Replace with a picker built from the live set of categories (App already computes `categories`, App.tsx:2804) plus an explicit 'New category…' affordance; use the same control in Add custom.
- [high] frontend/src/components/FeedManager.tsx:656: The edit form's only commit is a lowercase 13px text link `save` with no min-height (lines 656-663), beside `cancel`; nothing saves on blur or on change, and closing the sheet discards edits. Fix: Autosave each field on blur/change via api.updateSource (the interval select at line 827 already does this), with a saved/error indicator, and drop the save/cancel pair.
- [high] frontend/src/components/FeedManager.tsx:635: Custom headers are edited as a raw JSON string in a 3-row monospace textarea (lines 635-643) with a JSON placeholder and a live `invalid JSON` error (line 497). Fix: Render key/value rows (header name + value, add/remove) and serialise to the flat map the API expects (api.ts:432); offer a one-tap 'Browser User-Agent' preset since that is the only override the code says anyone needs (lines 625-627).
- [high] frontend/src/components/Settings.tsx:265: Feeds tab wrapper is `pt-4` with no horizontal padding while every other tab uses `pt-4 px-4` (lines 275, 331, 401, 1127, 1391); FeedManager's root (FeedManager.tsx:225-226) has no gutter either, so the Feeds sub-tab strip touches the screen edge. Fix: Give the Feeds wrapper `px-4` like the other tabs (or move the gutter into FeedManager's root).
- [medium] frontend/src/components/Settings.tsx:263: No scroll lock or overscroll containment on the sheet's scroll body (and no body overflow lock anywhere); on iOS, touch-scrolling a short tab (Notifications, Reset) scroll-chains to the dashboard beneath the overlay. Fix: Add `overscroll-contain` to the scroll body and lock document scrolling while open (set body overflow hidden / position fixed with scroll restore in the open effect at line 150).
- [medium] frontend/src/components/Settings.tsx:228: Eight labelled pills in a horizontally scrolling strip (line 228-258) don't fit a phone width; later tabs (Voted, Reset) are off-screen with no scroll affordance, and each pill is only 36px tall with 13px text. Fix: Collapse to fewer top-level sections (e.g. Feeds / AI / Your items / More) or render as an iOS grouped list on mobile, with 44px rows.
- [high] frontend/src/components/Settings.tsx:215: Done button is `min-h-[32px] min-w-[32px]` — below the 44px target the rest of the app's icon buttons use (App.tsx:2281, 2294, 2310; Hamburger.tsx:16). Fix: Raise to min-h-[44px] min-w-[44px] (same for Drawer.tsx:318 for consistency).
- [high] frontend/src/components/Settings.tsx:765: LLM 'Edit'/'Cancel' toggle, 'type a name instead' (line 831), per-key 'clear' (line 910), Notifications 'Retry' (line 346), bulk actions (line 1406) and per-row Restore/Remove/Hide (line 1450) are all bare text links with no min-height — 18–22px tap targets. Fix: Wrap each in a `min-h-[44px]` button (keep the text styling) or convert row actions to full-row swipe/menus.
- [medium] frontend/src/components/Settings.tsx:931: LLM picker requires an explicit lowercase `save` button (lines 928-934) while API-key `clear` applies immediately (lines 696-712), Brief tone applies immediately (line 305) and History group-by autosaves (line 978); 'Cancel' (line 767) silently discards typed keys/models. Fix: Either autosave provider/model selects on change (and keys on blur) or keep one consistent explicit-save pattern app-wide; at minimum capitalise and label clearly ('Save') and warn on discard.
- [high] frontend/src/App.tsx:457: Brief tone selected in Settings → AI is plain `useState('terse')` and resets on every reload, though the control looks like a persisted setting. Fix: Store it through PreferencesProvider (preferences.tsx:707-712 pattern) or localStorage.
- [high] frontend/src/components/Settings.tsx:1230: History group-by pills are `min-h-[28px]` with 13px text (lines 1230, 1238) — the smallest controls in the sheet. Fix: Match the 44px segmented control used for Brief tone (lines 299-317).
- [high] frontend/src/components/Settings.tsx:1526: Empty-state copy on Hidden/Saved/Voted tells a phone user to 'Right-click a card' and press keyboard keys h/b (lines 1526, 1598, 1683). Fix: Describe the touch gesture (long-press / swipe) first, with keyboard hints only on md+.
- [medium] frontend/src/components/Settings.tsx:204: Sheet panel has no entry animation (only the backdrop fades, line 189) even though `animate-sheet-up` is defined (tailwind.config.js:97-100,116) and the Drawer slides. Fix: Add `animate-sheet-up md:animate-none` to the panel.
- [high] frontend/src/components/Settings.tsx:2308: Settings is reachable from three places: the header gear (App.tsx:2305-2331), the Drawer 'All settings…' row (Drawer.tsx:377-389) and the Drawer 'History' row (Drawer.tsx:336-350); the header carries both a gear and a hamburger. Fix: Keep one header button (the menu) and make Settings a row inside it, or keep the gear and remove the Drawer's duplicate rows.
- [high] frontend/src/components/FeedManager.tsx:576: Edit-form labels are `text-[11px]` and hints `text-[10px]` (lines 576, 588, 598, 604, 632, 645, 650) — below the 13px caption minimum used elsewhere in Settings. Fix: Use `text-ios-caption` for labels and hints.
- [high] frontend/src/components/Settings.tsx:5: File header says 'The four tabs' (lines 5-13) and App.tsx:401 lists five; there are eight. Fix: Update the comments when the tab set is redesigned.

### frontend/src/components/FeedManager.tsx (feed editor) + its reach from the dashboard (App.tsx header, Drawer.tsx, Settings.tsx) + backend PATCH contract (backend/app/routes/sources.py)

# FeedManager map (origin/main @ 721713e, includes PR #12)

## 0. Files read
- /home/user/popping/frontend/src/components/FeedManager.tsx (1809 lines, all)
- /home/user/popping/frontend/src/components/Settings.tsx:1-330
- /home/user/popping/frontend/src/components/Drawer.tsx:255-400, 500-625
- /home/user/popping/frontend/src/components/Hamburger.tsx (all)
- /home/user/popping/frontend/src/App.tsx:376-452, 723-770, 1070-1110, 1240-1262, 1985-2020, 2205-2420, 2594, 2655-2670, 2795-2860
- /home/user/popping/frontend/src/api.ts:95-175, 262-284, 355-560
- /home/user/popping/frontend/src/lib/labels.ts (all), frontend/src/components/Toast.tsx:1-60
- /home/user/popping/frontend/index.html, frontend/src/styles.css:1-60, frontend/tailwind.config.js (grep), frontend/eslint.config.js, frontend/package.json
- /home/user/popping/backend/app/routes/sources.py:140-193, 280-410, 640-800; backend/app/schemas.py:140-215; backend/app/scheduler.py:2267-2415 (grep); backend/app/sources/__init__.py:60-80; backend/app/sources/rfd.py:177
- /home/user/popping/backend/tests/test_frontend_slice15_add_generic_scrape.py, test_source_create_sitemap_link_pattern.py (frontend-source substring tests)

## 1. Component tree, props, ownership

```
App (App.tsx:378)
 ├─ sources state: App.tsx:381 `const [sources, setSources] = useState<Source[]>([])`
 │    refreshed by refresh(): api.sources() at App.tsx:1079, setSources(reconcileById) at App.tsx:1100
 │    reconcileById keeps old object identity only when deepEqual (App.tsx: function reconcileById)
 │    background polling: window.setInterval(refresh, REFRESH_INTERVAL_MS) App.tsx:1247-1249, paused when hidden 1259-1262
 ├─ Settings (App.tsx:2834-2845) props: open, tab, sources, onRefreshSources={async () => { void refresh() }}, onError={setError}, onClose, onSourceRenamed
 │    └─ FeedManager (Settings.tsx:266-271) props: sources, onRefresh={onRefreshSources}, onError, onSourceRenamed
 └─ Drawer (App.tsx:2800-2811) gets categories (derived from visible entries, App.tsx:753-764), sources, onOpenSettings
```

FeedManager Props (FeedManager.tsx:39-48): `sources: Source[]`, `onRefresh: () => Promise<void>`, `onError: (msg) => void`, `onSourceRenamed?: (old, new) => void`.
- `onRefresh` is App's `refresh()` wrapped so it resolves immediately (`void refresh()`, App.tsx:2838) — i.e. `await onRefresh()` in FeedManager does NOT wait for the new source list.
- `onError` → App's red sticky banner (App.tsx:2397-2411, role="alert").
- `onSourceRenamed` → App.tsx:1994-2003 remaps the active filter chip set.
- Source shape: api.ts:116-151 (`id, name, type, category, url, refresh_interval_seconds, last_fetch_at, last_error, error_count, active, favicon_url, favicon_path, custom_headers: Record<string,string>|null, auto_disabled, net_vote_score`).
- Server list order: `order_by(Source.category, Source.name)` backend/app/routes/sources.py:397.

Top-level FeedManager state (FeedManager.tsx:212-222): `tab` ('mine'|'recommended'|'add', default 'mine' :213), `editingInterval: number|null` (:214), `editingRowId: number|null` (:215), memo `existingNames` (:219-222). Tab strip (:226-237): "My feeds (N)" (:228), "Recommended" (:231), "Add custom" (:234). TabButton min-h-[36px] (:264-287).

Constants: REFRESH_PRESETS 15 min/1 hour/6 hours/24 hours (:55-60); PODCAST_DEFAULT_REFRESH=21600 (:66); YOUTUBE_DEFAULT_REFRESH=21600 (:70); CATEGORY_OPTIONS static 16 strings news,tech,vulns,science,finance,policy,longform,deals,podcast,video,sports,entertainment,gaming,food,music,other (:80-105); KNOWN_BUILT_INS = {bbc_news, hn_top, github_releases, wikipedia_on_this_day, nvd_recent, cisa_kev} (:108-115); isBuiltIn (:117-119).

## 2. (a) My feeds — per-row + inline edit

### MyFeedsTab (FeedManager.tsx:293-344)
- Empty: "no sources yet" (:316).
- Renders `<SourceRow>` per source (:318-343); `onStartEdit` clears interval picker then sets editingRowId (:326-329); `onRenamed` closes edit + bubbles (:333-336).

### SourceRow collapsed/expanded (FeedManager.tsx:346-938)
Local state: `busy` (:373), `confirmingDelete` + CONFIRM_TIMEOUT_MS=4000 auto-cancel (:379-380, effect :433-437), `open` (:384, row expand — local to row, so several rows can be open and `open` persists across edits).
- Row button (min-h-[44px], :688-764): SourceIcon 14px (:699), `sourceLabel(name)` (:710) (strikethrough when paused, italic when stale :701-704), `categoryLabel(category)` 11px chip (:712), "auto-disabled" red (:730) or "paused" amber (:734), "⚠ N" error chip (:753), net vote badge (+N/-N) (:770-779), chevron "›" rotates (:781-786).
- Collapsed caption (:784-786): "updated {timeAgo} · every {refreshLabel}".
- Expanded action row (:788-937), all text-ios-caption (13px) links, wrapping flex: "pause"/"resume" (min-h-[36px], aria-label 'pause source'/'resume source' :789-797, PATCH {active:!active} :386-396), "edit" (no min-h, :798-805, aria `edit ${name}`), "· fetched {timeAgo}" (:822), interval: either `<select aria-label="refresh interval">` options "every 15 min/1 hour/6 hours/24 hours" (:825-838, PATCH {refresh_interval_seconds} on change :398-408, closes picker :402) or button "every {label}" aria 'edit refresh interval' (:840-847) + "cancel" (:849-855); "fetch" (:857-891, POST /api/ingest/{name} :869; toasts "Fetched N from X (M new)" :873-877 or `${name}: ${error}` error :871); "delete" red, ml-auto (:893-901) → "confirm delete" (:903-912, api.deleteSource :418) + "cancel" (:913-921); "built-in" badge (:922-929, title "built-in source — url/name are locked to the plugin. Deleting it is permanent.").
- Delete works for built-ins too (comment :6-10, :414-416).

### Inline edit form (FeedManager.tsx:443-684)
State seeded from props: `editName`, `editUrl`, `editCategory` (:443-445), `editHeaders` = JSON.stringify(custom_headers) or '' (:452-454), `headersError` (:458). Re-seed effect when `isEditing` flips, deps include `source.custom_headers` (object ref) (:465-475).
Fields (all `text-[11px] uppercase` labels; inputs `text-ios-body`):
1. "name" `<input type=text autoFocus spellCheck=false>` disabled when busy || builtIn (:574-585; autoFocus :583).
2. "url" `<input type=url>` disabled when busy || builtIn (:586-601); built-in hint "built-in — url is bound to the plugin" (:597-600).
3. "category" `<input type=text list="feed-category-options">` + `<datalist>` of CATEGORY_OPTIONS (:602-618). Free text; not lowercased/normalized; no list of the user's *existing* categories (CATEGORY_OPTIONS is static).
4. "custom headers (JSON)" `<textarea rows=3 font-mono placeholder='{"User-Agent": "Mozilla/5.0 ..."}'>` hidden for built-ins (:630-655). Live parse IIFE (:481-499): empty → `{ok:true,value:null}`; JSON.parse; must be non-array object with string values else 'must be a flat {"Header": "value"} map' (:493); parse failure → 'invalid JSON' (:497). Error pushed to state via effect with eslint-disable (:502-506). Hint "sent on every fetch; clear to use defaults" (:651).
5. Buttons row (:656-683): "save" text link, `disabled={busy || !parsedHeaders.ok}` (:657-663), "cancel" (:664-670), "⚠ favicon resets" amber when url differs for non-built-in (:671-679).
- No `<form>`; Enter does not submit; nothing auto-saves. Only explicit `saveEdit` (:508-565):
  - change flags via trim compare (:509-517); headers compared via JSON.stringify of parsed value vs source.custom_headers (:515-517).
  - nothing changed → `onCancelEdit()` silently (:518-527).
  - invalid headers → return (:528-533).
  - PATCH body built only with changed keys: `name`, `url`, `category`, `custom_headers` (object or null) (:537-547) → `api.updateSource(id, body)` (:548) → `await onRefresh()` (:552) → if renamed `onRenamed(old,new)` (:555) else `onCancelEdit()` (:558). Error → `onError(parseApiError(err,'failed to save changes'))` (:561-562) (App banner, not toast). No success toast on save.
- parseApiError (:195-210) reads `ApiError.detail` (api.ts:264-284) — 422 arrays joined with "; ", string detail, else message.

Backend PATCH contract (backend/app/routes/sources.py:647-800, schemas.py:146-189):
- name regex + reserved plugin names 400 (:680-688); url resolves Apple Podcasts/YouTube links, type-aware reddit validation (:689-707); category `_validate_category` non-empty, ≤40 chars, not "saved"/"for you" (:287-303, `_RESERVED_CATEGORY_NAMES` :162, `_CATEGORY_MAX` :152); custom_headers only when present in `model_fields_set` (:754-759): dict str→str, ≤20 entries (`_CUSTOM_HEADERS_MAX` :192), value ≤512 (`_HEADER_VALUE_MAX` :193), denylist cookie/authorization/host + extras (:164-187), printable-ASCII check (:340-352), empty dict → NULL (:355); built-in name/url → 400 (:765-771); IntegrityError → 409 "already in use" (:786-795). URL change clears favicon (scheduler.py:2395-2398).
- Plugins honoring custom_headers: dynamic_rss.py:71, podcast.py:43, generic_scrape.py:391/475.

## 3. (b) Add custom tab (FeedManager.tsx:1300-1809)
Preceded by `<AutoFeedBlock>` (:1150-1297): "✨ Auto feed" (:1238), copy "Paste any site's URL — we'll find its RSS feed automatically, or track it via periodic scraping if it doesn't have one." (:1241-1242), `<input type=text placeholder="https://example.com">` Enter submits (:1247-1258), button "Auto-add"/"Looking…" (:1259-1266) → `api.autoAddSource(url)` (:1213; api.ts:409 default category 'other'); toast "Feed added: {name}[ — no native feed found, tracking via periodic scraping instead]" (:1215-1218); failure text "couldn't find a feed (or anything scrapeable) at that URL" (:1223) + "Track this URL anyway"/"Tracking…" (:1283) + "adds a scrape source instead" (:1286) → `trackAnyway` (:1166-1202) slugifies hostname client-side, `api.createSource({type:'generic_scrape', category:'news'})` (:1187-1192), toast "Tracking: {name} — scraping for new articles" (:1193). Empty URL → "paste a URL first" (:1208).

Form (:1527-1806): state name/url (:1307-1308), category default 'news' (:1309), refresh 3600 (:1310), sourceType union 'rss'|'reddit'|'podcast'|'youtube_channel'|'generic_scrape' (:1326-1328), sitemapUrl/linkPattern (:1339-1340), submitting/testing/testResult (:1341-1364), urlError/nameError (:1363-1364).
- "Name" input placeholder "my_blog" (:1531-1539), hint "lowercase letters, digits, underscore" (:1541); validator regex `^[a-z0-9_]{1,120}$` (:1372-1375).
- "Type" radios: "RSS / Atom" (:1569), "Subreddit" (:1583), "Podcast" (:1598; sets refresh 6h + category 'podcast' if still 'news' :1593-1594), "YouTube" (:1613; refresh 6h + category 'video' :1608-1609), "Track page (no RSS)" (:1637; refresh 7200 :1631-1633).
- URL label ternary "Subreddit"/"Podcast RSS URL"/"YouTube channel URL"/"Page URL (no RSS — will be scraped)"/"RSS / Atom URL" (:1646-1654); placeholders (:1660-1670).
- generic_scrape only: "Sitemap URL (optional)" (:1690), "Link pattern (optional)" (:1707).
- "Category" `<select id=fm-category>` over CATEGORY_OPTIONS (:1722-1731) — static list, no "add new", not fed by existing sources. "Refresh" `<select>` "every …" (:1735-1745).
- Re-validate effect on [name,url,sourceType] clears testResult (:1397-1424).
- "Test"/"Testing…" (:1789-1796) → `api.testSource` (:1492-1497); result box `data-test-result` (:1755-1785): "✓ Looks good — N items found" (:1501), "Resolved to the real feed: … — Add will use this URL." (:1770-1771), sample titles; errors via friendlyTestError (:167-193) e.g. forbidden → "This site blocks automated access. Try adding a User-Agent header (Advanced → Custom headers)." (:174) — note there is no "Advanced → Custom headers" in the Add form; headers can only be set after creation via the row editor.
- "Add feed"/"adding…" submit (:1797-1803) → `api.createSource` (:1446-1458) with name/type/category/url/refresh + sitemap/link hints; toast "Feed Added: {name}" (:1462); errors via onError banner (:1430-1433, :1470).
- Recommendation `default_headers` only flow through the Recommended tab's Add (:1050), not this form.

## 4. (c) Recommended / discover (FeedManager.tsx:941-1147)
Recommendation type (:941-962) incl. `type?`, `default_headers?`, `source?` ('editorial'|'llm'). State recs/loading/adding/discovering/discoverMsg (:972-984). `fetchRecs` → `api.feedRecommendations()` filtered by existingNames (:986-1001), fetch on mount (:1004-1006). `findMore` → `api.discoverFeeds()` (:1008-1026) messages "found N new feed(s) in {cat}" / "couldn't find feeds for {cat}: {note}" / "nothing new found for {cat} this time" (:1013-1018). `add(rec)` → `api.createSource({name,type,category,url,refresh 900 reddit/3600, custom_headers: rec.default_headers ?? undefined})` (:1028-1060), optimistic removal (:1055). UI: "🔎 find more feeds"/"looking…" min-h-[28px] (:1067-1079), "loading…" (:1086), empty "you've added all the recommended feeds — try Find more feeds or the Add custom tab" (:1095), rows name + category + "found for you" badge (:1110-1119) + "Add"/"adding…" min-h-[28px] (:1120-1127) + blurb.

## 5. (e) Tap counts today (iPhone, from dashboard)
Entry points to the editor:
- Header gear `aria-label="open settings"` → `openSettings('feeds')` (App.tsx:2305-2307); pushes `?view=settings&tab=feeds` (App.tsx:430-437). Settings sheet renders FeedManager on tab 'feeds' with FeedManager's own default tab 'mine' (Settings.tsx:264-271; FeedManager.tsx:213).
- Hamburger `aria-label="open menu"` (Hamburger.tsx:14, App.tsx:2333) → Drawer "All settings…" row (Drawer.tsx:376-390) and also "History" row (Drawer.tsx:335-348) → same Settings overlay. So Settings is reachable 3 ways from the top bar (gear; menu→All settings…; menu→History).
Top bar buttons on mobile: search (App.tsx:2275-2289), refresh (sm:hidden, :2298-2306), gear (:2305-2328), hamburger (:2333). Desktop sub-row: Refresh/Brief/UserBadge (:2343-2365).

Fastest path (gear) then scroll the list (sorted category,name):
| Goal | Taps (excluding typing/scrolling) | Path |
|---|---|---|
| Edit category | 4 + typing | gear → row (expand, :688) → "edit" (:798) → tap category field (:605) → type → "save" (:657) |
| Edit URL | 4 + typing | gear → row → edit → url field (:589) → type → save (built-ins locked :593) |
| Edit headers | 4 + typing JSON | gear → row → edit → textarea (:635) → type valid JSON → save (non-built-in only :630) |
| Pause/resume | 3 | gear → row → "pause" (:789) |
| Delete | 4 | gear → row → "delete" (:893) → "confirm delete" (:903) within 4 s (:379) |
| Refresh interval | 4 | gear → row → "every X" (:840) → select (:825) → pick |
| Fetch now | 3 | gear → row → "fetch" (:857) |
Via menu add +1 (hamburger → All settings…). Closing: "Done" (Settings.tsx:200-206) or back button.

## 6. Full UI string / control inventory (FeedManager.tsx)
Tabs: "My feeds (N)" :228, "Recommended" :231, "Add custom" :234. My feeds: "no sources yet" :316; row chips "auto-disabled" :730, "paused" :734, "⚠ N" :753, "+N/-N" :773-776, "›" :785; caption "updated … · every …" :785; actions "pause"/"resume" :796, "edit" :804, "· fetched …" :822, select "every 15 min|1 hour|6 hours|24 hours" :833-837, "every X" :845, "cancel" :854, "fetch" :890, "delete" :900, "confirm delete" :911, "cancel" :919, "built-in" :928. Edit form: "name" :576, "url" :588, "built-in — url is bound to the plugin" :599, "category" :604, datalist :614-618, "custom headers (JSON)" :633, placeholder '{"User-Agent": "Mozilla/5.0 ..."}' :641, 'must be a flat {"Header": "value"} map' :493, 'invalid JSON' :497, "sent on every fetch; clear to use defaults" :651, "save" :662, "cancel" :669, "⚠ favicon resets" :676. Errors: 'failed to update source' :393, 'failed to update refresh interval' :405, 'failed to delete source' :423, 'failed to save changes' :562, 'fetch failed' :880. Recommended: "🔎 find more feeds"/"looking…" :1074, discover messages :1013-1018, "loading…" :1086, empty copy :1095, "found for you" :1117, "Add"/"adding…" :1126, 'failed to load recommendations' :997, 'failed to find more feeds' :1022, `failed to add ${name}` :1057. Auto feed: "✨" :1237, "Auto feed" :1238, blurb :1241-1242, placeholder "https://example.com" :1255, "Auto-add"/"Looking…" :1265, "paste a URL first" :1208, "couldn't find a feed (or anything scrapeable) at that URL" :1223, "Track this URL anyway"/"Tracking…" :1283, "adds a scrape source instead" :1286, toasts :1193/:1218, 'failed to add scrape source' :1197, 'auto feed failed' :1227. Add custom: "Name" :1531, placeholder "my_blog" :1537, hint :1541, "Type" :1556, radios :1569/1583/1598/1613/1637, URL labels :1646-1654, placeholders :1660-1670, "Sitemap URL (optional)" :1690, "Link pattern (optional)" :1707, "Category" :1722, "Refresh" :1735, "✓ Looks good — N items found" :1501, "Resolved to the real feed: … — Add will use this URL." :1770-1771, friendlyTestError strings :167-193, "Couldn't test the feed — …" :1518, "Test"/"Testing…" :1795, "Add feed"/"adding…" :1802, toast "Feed Added: {name}" :1462, validator strings :1371-1385, 'name is required' :1399, 'url is required' :1402, 'url is not a valid URL' :1411, 'enter a subreddit like r/python' :1415.

## 7. What must change for the agreed scope
### Editor reachable in fewer steps
- Today the row expand → "edit" → form is 3 distinct states (`open` :384, `editingRowId` :215, `editingInterval` :214). Collapse into one: tapping a row opens a single editor (sheet or expanded panel) that contains category/URL/headers/interval/pause/fetch/delete together. Delete the separate "edit" and "every X" buttons (:798-847).
- Option: a direct "Feeds" entry from the header (replace gear+hamburger with one Menu whose first row is Feeds — Drawer.tsx:335-390 already has GroupedRow/GroupedSection primitives :508-600) and keep `?view=settings&tab=feeds` URL-driven open (App.tsx:393-427) so back closes.
- Optional deeper link: `?view=settings&tab=feeds&source=<id>` to open a row's editor directly (needs new param parse in App.tsx:393-427 and a prop into FeedManager).

### Autosave
- Replace `saveEdit` click (:508-565) with per-field commit: on `blur`/`change` of each field (and select change for category/interval) PATCH only that key (body shape at :537-547 already per-key). Keep built-in locks (:581,:593) and the 400/409/422 handling via parseApiError (:195-210); on error revert the field to `source.*` and show the message inline (today it goes to the App banner behind the sheet, App.tsx:2397).
- Debounce text fields (name/url) ~600 ms or save on blur; show a transient "Saved" state (toast API Toast.tsx:48-53 or inline caption) since there is no success feedback today.
- Remove the "nothing changed → close" branch (:518-527) and "save"/"cancel" links (:656-670).
- Guard the re-seed effect (:465-475): deps include `source.custom_headers` (new object whenever the row re-renders from polling, App.tsx:1247) — an autosaving editor must not re-seed from props while a field is focused/dirty (track `dirty` per field, or seed once per `source.id` open).
- `onRefresh` resolves before data arrives (App.tsx:2838 `void refresh()`), so optimistic local state (use the PATCH response `updated` :548, a full Source) is needed to avoid flicker.

### Category picker with existing categories + "add new"
- Source of truth is `sources.map(s => s.category)` (prop already in FeedManager :212); Drawer's `categories` is entries-derived (App.tsx:753-764) and omits categories with no visible entries, so do not reuse it.
- Replace `<input list>`/`<datalist>` (:605-618) and the Add form `<select>` over CATEGORY_OPTIONS (:1722-1731) with one shared control: `<select>` (native iOS picker) listing `unique(existing ∪ CATEGORY_OPTIONS)` with labels via `categoryLabel` (labels.ts:64-68) and raw value as stored, plus a final option "New category…" that reveals a text input. Normalize: trim, lowercase, ≤40 chars, reject "saved"/"for you" client-side mirroring sources.py:287-303 (grouping is exact-string, App.tsx:753-760, so "News" ≠ "news").
- Note CATEGORY_OPTIONS (:80-105) can stay as the seed list for fresh installs.

### Key/value headers editor
- Replace the JSON textarea (:630-655), the IIFE parser (:481-499), `headersError` effect (:502-506) and the stringify-compare (:515-517) with a `Array<{key,value}>` row list: "Header" / "Value" inputs, "+ Add header" button, per-row remove; preset chip "Browser User-Agent" (the only common case per :167-176 and api.ts:141-143). Serialize to `Record<string,string>` on save; empty list → `null` (backend turns {} into NULL anyway, sources.py:355). Client-side mirror of denylist (sources.py:164-187: cookie, authorization, host + x-forwarded-for etc.), ≤20 rows, ≤512 chars, printable ASCII.
- Also expose headers in the Add form (the forbidden-error copy at :174 references "Advanced → Custom headers", which does not exist there) and pass through `api.testSource({custom_headers})` (api.ts:389-396 already accepts it).

### One button in the top bar
- Remove the gear (App.tsx:2305-2328) OR the hamburger (:2333) and the duplicate "All settings…" (Drawer.tsx:376-390). Simplest consistent with the Drawer's grouped-list style: keep the hamburger as the single Menu and put Feeds/History/Settings rows at the top of the Drawer (GroupedRow :552-600) — or keep one gear that opens Settings whose Feeds tab is default and move the Drawer's filter/jump features into Settings. Either way `openSettings(tab)` (App.tsx:430-437) remains the entry and the `?view=settings` URL contract (App.tsx:393-427) stays.

## 8. iPhone / ease-of-use smells found in this area (for the whole-app check)
- Sub-44px targets: "edit"/"fetch"/"delete"/"every X"/"save"/"cancel" are 13px text links without min-height (:798-805, :857-891, :893-901, :840-847, :657-670); "Add"/"find more feeds" min-h-[28px] (:1072, :1123); TabButton 36px (:272).
- 10–11px text: 11 occurrences of text-[10px]/text-[11px] in FeedManager (labels :576/:588/:604, hints :598/:646/:650, chip :712).
- `autoFocus` on name input (:583) is a no-op for built-ins (disabled :581) and on iOS pops the keyboard inside a sheet as soon as "edit" is tapped.
- datalist is not rendered as suggestions by iOS Safari, so category is effectively a bare text field on the phone (:605-618).
- Delete confirm auto-cancels after 4 s (:379, :433-437) — timing-based affordance.
- KNOWN_BUILT_INS (:108-115) misses `rfd_hot_deals` (registered via backend/app/sources/__init__.py:72-80, name at backend/app/sources/rfd.py:177): its row shows editable name/url and no "built-in" badge; saving a name/url change returns 400 (sources.py:765-771).
- Errors from the editor go to App's banner (App.tsx:2397-2411) which sits under the z-50 Settings sheet (Settings.tsx:184), so a failed save is not visible until the sheet is closed.
- Add form requires a slug name (regex :1372-1375, hint :1541) even though display uses `sourceLabel` (labels.ts:40-61); could auto-derive from URL host as AutoFeedBlock does (:1175-1186).
- `window.confirm` still used in Settings reset (Settings.tsx:413) and `window.prompt` for presets (App.tsx:306, :2826).
- Already fixed by PR #11 and must be preserved: 16px inputs on coarse pointers (styles.css:24-26); Settings sheet pinned to visible top (Settings.tsx:195); no `maximum-scale` in viewport (index.html:5); 100dvh (App.tsx:2188).


#### Constraints
- backend/tests/test_frontend_slice15_add_generic_scrape.py:55 reads FeedManager.tsx and asserts substrings/regexes: useState<'rss' | 'reddit' | 'podcast' | 'youtube_channel' | 'generic_scrape'> (:69-72), radio values rss/reddit/podcast/youtube_channel/generic_scrape (:90-94), label text containing 'no RSS' and 'Track page' around the generic_scrape radio (:127-133), regex sourceType === 'rss'[^}]+sourceType === 'generic_scrape' (:146-150) plus literal 'sourceType === 'podcast'' and 'sourceType === 'youtube_channel'' (:158-159), a useEffect re-validate block (:176-185), URL-label ternary containing 'Page URL' or 'scrape' (:204-205), generic_scrape placeholder exactly 'https://example.com' (:226-228), strings "couldn't find a feed" and 'Track this URL anyway' inside an autoMessage.kind === 'err' conditional (:242-252), handler literally 'const trackAnyway = async () => {' containing new URL(trimmed).hostname / toLowerCase / replace(/^www\./, '') / replace(/[^a-z0-9]+/g, '_') / slice(0, 100) (:289-303), all five type literals present (:316); api.ts testSource body union must stay 'rss' | 'reddit' | 'podcast' | 'youtube_channel' | 'generic_scrape' (:330-345)
- backend/tests/test_source_create_sitemap_link_pattern.py:41 reads FeedManager.tsx and requires literal 'setSitemapUrl', 'setLinkPattern', 'onChange={(e) => setSitemapUrl', 'onChange={(e) => setLinkPattern', "{sourceType === 'generic_scrape' && (", and 'sitemap_url: ' / 'link_pattern: ' in the createSource call (:204-268); api.ts createSource body must keep sitemap_url and link_pattern (:183-190)
- Backend PATCH /api/sources/{id} rejects name/url on registered plugin rows with 400 (backend/app/routes/sources.py:765-771); registered names come from app.sources.list_sources (sources.py:49; backend/app/sources/__init__.py:60-80) and include rfd_hot_deals (backend/app/sources/rfd.py:177) which FeedManager's KNOWN_BUILT_INS omits (frontend/src/components/FeedManager.tsx:108-115)
- Category must be non-empty, <=40 chars, and not 'saved'/'for you' case-insensitively (backend/app/routes/sources.py:287-303, _CATEGORY_MAX :152, _RESERVED_CATEGORY_NAMES :162); App groups entries by exact category string (frontend/src/App.tsx:753-764) so case/whitespace variants create separate columns
- custom_headers PATCH semantics: field omitted = untouched, null = clear, object = replace; only applied when present in model_fields_set (backend/app/routes/sources.py:754-759); validation: JSON object of str->str, <=20 entries (:192), value <=512 chars (:193), printable ASCII/tab only (:340-352), denylist cookie/authorization/host plus _HEADER_DENYLIST_EXTRA (:164-187), empty dict stored as NULL (:355)
- Source name regex ^[a-z0-9_]{1,120}$ (backend/app/schemas.py:150-151; validated at backend/app/routes/sources.py:680) and unique -> 409 on collision (sources.py:786-795); display names derive from the slug via sourceLabel and the raw slug is what the API expects (frontend/src/lib/labels.ts:5-7, 40-61)
- URL changes clear the cached favicon and the next ingest re-downloads (backend/app/scheduler.py:2395-2398; frontend/src/api.ts:420-423)
- App owns the sources list (frontend/src/App.tsx:381) and refreshes it only via refresh() -> api.sources() (App.tsx:1079, 1100); FeedManager's onRefresh is `async () => { void refresh() }` and resolves before new data arrives (App.tsx:2838); background polling re-delivers rows every REFRESH_INTERVAL_MS (App.tsx:1247-1249) with identity preserved only when deepEqual (App.tsx function reconcileById)
- Renames must bubble through onSourceRenamed so App remaps active filter chips (frontend/src/App.tsx:1994-2003; FeedManager.tsx:553-556)
- Settings open/tab state is URL-driven via ?view=settings&tab=<feeds|llm|notifications|history|hidden|starred|voted|reset> (frontend/src/App.tsx:393-427, openSettings :430-437, closeSettings :438-444); the Settings tab strip mutates the URL and dispatches popstate (frontend/src/components/Settings.tsx:218-232); Drawer's History and All settings… rows call onOpenSettings (frontend/src/components/Drawer.tsx:335-348, 376-390)
- iOS fixes from PR #11 must be preserved: 16px font on input/textarea/select under (pointer: coarse) (frontend/src/styles.css:24-26); Settings sheet pinned top-[calc(env(safe-area-inset-top)+0.75rem)] (frontend/src/components/Settings.tsx:195); viewport has viewport-fit=cover and no maximum-scale (frontend/index.html:5); minHeight 100dvh (frontend/src/App.tsx:2188)
- Design tokens: 44px tap targets, hairline borders, text-ios-caption=13px, text-ios-body=17px, accent #0a84ff (frontend/tailwind.config.js:3, 23-36, 66-70); Drawer's GroupedSection/GroupedRow are the existing iOS grouped-list primitives but are module-private to Drawer.tsx (frontend/src/components/Drawer.tsx:508-600)
- Toast API: toast(message, 'info'|'error') or toast(message, {kind, action}); singleton; 1.5s auto-dismiss, 5s with action (frontend/src/components/Toast.tsx:10-16, 48-53); onError goes to App's sticky red banner (frontend/src/App.tsx:2397-2411) which renders beneath the z-50 Settings sheet (Settings.tsx:184)
- Build/lint: `tsc && vite build` (frontend/package.json:9); eslint react-hooks/rules-of-hooks error and exhaustive-deps warn (frontend/eslint.config.js:36-38); React 18.3 no compiler (package.json:14-15)
- Only dynamic_rss, podcast and generic_scrape plugins honor custom_headers (backend/app/sources/dynamic_rss.py:71, backend/app/sources/podcast.py:43, backend/app/sources/generic_scrape.py:391,475); a headers editor should be hidden for built-ins as today (FeedManager.tsx:630)
- Recommendation default_headers only flow via the Recommended tab Add (FeedManager.tsx:1050); the Add custom form has no headers input even though friendlyTestError text references 'Advanced → Custom headers' (FeedManager.tsx:174)

#### Findings
- [high] frontend/src/components/FeedManager.tsx:605: Category in the edit form is a free-text <input> with a <datalist> of a static CATEGORY_OPTIONS list (:80-105); iOS Safari does not render datalist suggestions, so on the phone it is a blank text box with no view of the user's existing categories and no add-new path, and values are not normalized (trim only at :511) while App groups by exact string (App.tsx:753-760). Fix: Replace with a shared CategoryPicker: native <select> listing unique(sources.map(s=>s.category) ∪ CATEGORY_OPTIONS) labelled via categoryLabel, plus a 'New category…' option that reveals a text input; lowercase/trim, cap 40 chars, reject 'saved'/'for you' client-side; reuse it in the Add form (:1722-1731).
- [high] frontend/src/components/FeedManager.tsx:630: Custom headers are entered as raw JSON in a monospace textarea (:635-642) with 'invalid JSON' / 'must be a flat {"Header": "value"} map' errors (:493, :497); backend-shaped input exposed to a non-developer. Fix: Key/value row editor (Header, Value, remove, '+ Add header', preset 'Browser User-Agent') that serializes to Record<string,string> (null when empty) and mirrors the backend denylist/limits (sources.py:164-193, 340-355); drop parsedHeaders IIFE (:481-499) and headersError effect (:502-506).
- [high] frontend/src/components/FeedManager.tsx:508: Nothing autosaves: edits persist only via the 13px 'save' text link (:657-663) with no min-height; no <form>, Enter does nothing; 'nothing changed' silently closes (:518-527); no success feedback; errors go to the App banner hidden under the sheet. Fix: Per-field commit on blur/change with PATCH of only that key (body builder :537-547 already per-key), optimistic update from the PATCH response, inline 'Saved'/error state, revert on failure; remove save/cancel links.
- [medium] frontend/src/components/FeedManager.tsx:465: Re-seed effect depends on source.custom_headers (object reference); when background polling (App.tsx:1247) replaces the row object (e.g. last_fetch_at changed) the effect refires and overwrites in-progress edits for rows that have headers set. Fix: Seed once per editor open keyed on source.id (or compare JSON.stringify(custom_headers)), and never re-seed a field that is focused/dirty — required for autosave.
- [high] frontend/src/components/FeedManager.tsx:798: Editing requires expand row (:688) → 'edit' (:798) → field → 'save'; interval requires 'every X' (:840) → select (:825). Three independent UI states (open :384, editingRowId :215, editingInterval :214) and six 13px text links per row; 'edit', 'fetch', 'delete', 'every X', 'save', 'cancel' have no min-height (sub-44px). Fix: One tap on a row opens a single editor containing category picker, interval select, URL, headers, pause toggle, fetch and delete; use 44px rows (Drawer's GroupedRow pattern, Drawer.tsx:552-600, lifted to a shared module).
- [high] frontend/src/App.tsx:2305: Top bar has a Settings gear (:2305-2328) and a hamburger (:2333); the Drawer repeats Settings via 'All settings…' (Drawer.tsx:376-390) and 'History' (Drawer.tsx:335-348) — three entries to the same overlay. Fix: Keep one menu button; put Feeds / History / Settings rows at the top of the Drawer (or fold the Drawer into Settings) while keeping openSettings(tab) and the ?view=settings URL contract (App.tsx:393-444).
- [high] frontend/src/components/FeedManager.tsx:108: KNOWN_BUILT_INS omits rfd_hot_deals, which is a registered plugin (backend/app/sources/__init__.py:72-80, rfd.py:177); its row shows editable name/url and no 'built-in' badge, and saving name/url returns 400 from sources.py:765-771. Fix: Add 'rfd_hot_deals' to the set, or better derive built-in status from the backend (e.g. expose a `builtin` flag on SourceOut or compare against a /api/sources/plugins list) so the client set cannot drift.
- [medium] frontend/src/components/FeedManager.tsx:583: autoFocus on the name input pops the iOS keyboard the moment 'edit' is tapped and is a no-op for built-ins where the input is disabled (:581). Fix: Drop autoFocus in the redesigned editor; let the user tap the field they want.
- [high] frontend/src/components/FeedManager.tsx:1722: Add form 'Category' <select> is the static CATEGORY_OPTIONS list; a category the user created (e.g. via the edit form) is not offered, and there is no add-new option. Default is 'news' (:1309) while autoAddSource defaults to 'other' (api.ts:409) and trackAnyway hardcodes 'news' (:1190). Fix: Use the shared CategoryPicker fed by existing sources; pick one consistent default for the three add paths.
- [high] frontend/src/components/FeedManager.tsx:174: friendlyTestError for 'forbidden' tells the user to add a User-Agent header under 'Advanced → Custom headers', but the Add form has no headers control; headers can only be set after creation via the row editor. Fix: Add the key/value headers editor (collapsed 'Advanced') to the Add form and pass custom_headers to api.testSource (api.ts:389-396 already accepts it) and api.createSource.
- [high] frontend/src/components/FeedManager.tsx:1072: Recommended tab 'find more feeds' (:1072) and per-row 'Add' (:1123) buttons are min-h-[28px]; TabButton is 36px (:272); labels use text-[10px]/text-[11px] in 11 places (e.g. :576, :588, :604, :598, :646, :650, :712). Fix: Raise interactive controls to min-h-[44px] and captions to text-ios-caption (13px) as part of the whole-app pass.
- [medium] frontend/src/App.tsx:2397: FeedManager's onError writes App's sticky banner (z-15) which sits beneath the z-50 Settings sheet (Settings.tsx:184), so a failed PATCH/add is invisible until the sheet is closed. Fix: Surface editor errors inline next to the field or via toast('…','error') inside the sheet; keep onError for non-overlay cases.
- [medium] frontend/src/App.tsx:2838: onRefreshSources is `async () => { void refresh() }` so FeedManager's `await onRefresh()` (FeedManager.tsx:552) returns before the new source list lands; the editor closes/clears on stale data and relies on polling to catch up. Fix: Pass `refresh` itself (awaitable) or apply the PATCH response (`updated`, FeedManager.tsx:548) to local state optimistically.
- [medium] frontend/src/components/FeedManager.tsx:1372: Add form forces the user to invent a slug name matching ^[a-z0-9_]{1,120}$ (hint 'lowercase letters, digits, underscore' :1541) although display uses sourceLabel; AutoFeedBlock already derives a slug from the hostname (:1175-1186). Fix: Auto-derive the slug from the URL host (editable), or accept a display name and slugify it client-side.
- [low] frontend/src/components/FeedManager.tsx:379: Delete uses a 4-second auto-cancelling two-tap confirm (:379, :433-437); a timing-based affordance that can expire mid-decision. Fix: Use an explicit confirm row/action sheet without a timer in the redesigned editor.

### frontend shell: App.tsx top bar, Drawer/Settings mounting, URL-driven Settings routing, mobile layout

# App.tsx shell map (origin/main @ 721713e, includes PR #12)

Repo: /home/user/popping. File: /home/user/popping/frontend/src/App.tsx (2986 lines).

## 1. Imports and shell state (App.tsx:1-120, 370-460)

- File header comment App.tsx:1-17 says "Top bar has the hamburger (opens Drawer), search input, and refresh" (App.tsx:2) — stale, the gear is not listed. App.tsx:17 "Source filter chips in the header" refers to the chip bar at App.tsx:2369.
- Shell imports: `Drawer` App.tsx:24, `Hamburger` App.tsx:26, `Settings, type SettingsTab` App.tsx:34, `ShortcutsSheet` App.tsx:30, `ToastHost` App.tsx:31, `UserBadge` App.tsx:32, `Wallpaper` App.tsx:33.
- Root mount: /home/user/popping/frontend/src/main.tsx:7-13 wraps `<App />` in `PreferencesProvider` (server-backed prefs, App.tsx:37-58 comment).
- Shell state:
  - `drawerOpen` App.tsx:383 (plain boolean; NOT in history).
  - `settingsOpen` App.tsx:388, `settingsTab` App.tsx:389 (default `'feeds'`).
  - `mobileCol` App.tsx:445 (`useState(loadMobileCol)`); `loadMobileCol` App.tsx:124-134 reads `STORAGE_KEYS.mobileColLast` (/home/user/popping/frontend/src/lib/storage.ts:52), accepts `-1` (Brief tab) and any integer ≥ -1.
  - `refreshing` App.tsx:561; `refresh` callback App.tsx:1057 (fetches entries + sources + for-you).
  - Search: `searchInput`/`searchQuery`/`searchResults`/`searching`/`searchError` App.tsx:655-664; `searchOpen` App.tsx:669; 300 ms debounce App.tsx:1394-1409; `showSearchView = searchQuery.trim().length > 0` App.tsx:2166.
  - `shortcutsOpen` App.tsx:684 (opened by bare `?` key, App.tsx:1775-1783).
  - `oidcDisabled` App.tsx:449, `user` App.tsx:447; login gate App.tsx:2162-2167.

## 2. Settings overlay: how open/close rides on history

### URL contract
`?view=settings` = open; `?view=settings&tab=<feeds|llm|notifications|history|hidden|starred|voted|reset>` picks the tab (App.tsx:385-387 comment; Settings.tsx:15-18). `SettingsTab` union: /home/user/popping/frontend/src/components/Settings.tsx:40-48. The same list is duplicated as an explicit allow-list in App.tsx:409-418 and again as the tab-strip array at Settings.tsx:233.

### Sync effect (App.tsx:394-428)
- `sync()` App.tsx:395-424: parses `window.location.href`; if `view === 'settings'` → `setSettingsOpen(true)` (App.tsx:399) and, if `tab` is in the allow-list, `setSettingsTab(t)` (App.tsx:409-419); otherwise `setSettingsOpen(false)` (App.tsx:422-424).
- Runs once on mount (App.tsx:425) — so a reload/deep-link with `?view=settings&tab=x` opens that tab — and on every `popstate` (App.tsx:426-427).

### openSettings (App.tsx:430-437)
Sets `view=settings` + `tab=<tab>` on a copy of the current URL, `window.history.pushState(null,'',…)` (App.tsx:434), then `setSettingsTab(tab)` + `setSettingsOpen(true)` (App.tsx:435-436). Default tab `'feeds'` (App.tsx:430). Not memoized (plain function recreated every render).

### closeSettings (App.tsx:438-444)
Deletes `view` and `tab`, then **`window.history.pushState`** (App.tsx:442) — a forward push, not `history.back()` — then `setSettingsOpen(false)` (App.tsx:443). Also not memoized.

### Tab switching inside the overlay (Settings.tsx:232-246)
Tab pill `onClick` sets `tab` with `window.history.replaceState` (Settings.tsx:241) and then `window.dispatchEvent(new Event('popstate'))` (Settings.tsx:246) so App's `sync` (App.tsx:426) re-reads the URL. Only one history entry is consumed per Settings session regardless of tab changes. Only two `history` call sites exist outside App.tsx: Settings.tsx:241 and :246 (repo-wide grep).

### Close paths that all go through `onClose` = `closeSettings` (App.tsx:2840)
- Done button Settings.tsx:212-218 (`aria-label="close settings"`, `min-h-[32px]`).
- Backdrop tap Settings.tsx:190-194 (`e.target === e.currentTarget`).
- Escape, capture-phase listener Settings.tsx:169-180 (`stopPropagation` so App's global keydown at App.tsx:1753-1894 does not also fire).
- Browser/OS back: `popstate` → `sync` → `view` missing → `setSettingsOpen(false)` (App.tsx:422-424). This path does NOT call `closeSettings`, so no extra entry is pushed.

### Resulting history stacks
- Open via gear/Drawer then Back: `[base] → [base, ?view=settings] → (back) [base]`; overlay closes, URL clean. Correct.
- Open then Done/Esc/backdrop: `[base, ?view=settings, base']` (App.tsx:434 then :442). From `base'`, pressing Back lands on `?view=settings` and `sync` re-opens Settings (App.tsx:396-399). Two Backs are needed to leave. Deterministic from the code; not a guess.
- Reload while open: `sync` on mount (App.tsx:425) re-opens the same tab.
- The Drawer is not in history at all: `setDrawerOpen(true)` App.tsx:2333, `onClose={() => setDrawerOpen(false)}` App.tsx:2802. Back while the Drawer is open navigates the whole page.

### Overlay layering
- Settings container: `fixed inset-0 z-50` Settings.tsx:189; panel Settings.tsx:203-205: mobile `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-t-ios-lg`, desktop `md:w-[480px] md:h-full md:right-0`. Body scroll area Settings.tsx:263 `flex-1 min-h-0 overflow-y-auto pb-[calc(2rem+env(safe-area-inset-bottom))]`. Tab strip Settings.tsx:225-258 (`min-h-[36px]` pills, Settings.tsx:249). Title Settings.tsx:220-222 (`Settings` or `Settings → <Tab>`). `FeedManager` mounted only on the feeds tab at Settings.tsx:264-271 (`<FeedManager sources onRefresh onError onSourceRenamed>`).
- Drawer backdrop `fixed inset-0 z-30` /home/user/popping/frontend/src/components/Drawer.tsx:252; panel `fixed z-40 … right-0 w-[88vw] max-w-[420px] rounded-l-ios-lg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:w-[360px]` Drawer.tsx:286-294. Slides in from the right (translate-x) Drawer.tsx:291-293 — the comment at Drawer.tsx:257-259 ("bottom sheet, slides up") is stale.
- Header z-20 App.tsx:2210; Column popover z-20/z-30 Column.tsx:407-411; ShortcutsSheet z-30/z-40 ShortcutsSheet.tsx:67-70; Card menus z-40/z-50 Card.tsx:1807,1844; Toast z-50 Toast.tsx:117 (ToastHost mounted last at App.tsx:2895 so it paints over Settings); Wallpaper z -100 styles.css:89.
- Error banner App.tsx:2401 uses `z-15`, which is not in Tailwind 3's default z scale and tailwind.config.js:9-121 adds no `zIndex` → the class emits no CSS.

## 3. What breaks if the gear is removed and Settings is reached only via the menu

Gear button: App.tsx:2305-2331 (`onClick={() => openSettings('feeds')}` App.tsx:2307, `aria-label="open settings"` App.tsx:2308, `data-settings-gear` App.tsx:2309, `w-11 h-11` App.tsx:2310, Feather gear SVG App.tsx:2315-2330, comment App.tsx:2298-2303).

Verified dependencies:
- `data-settings-gear` is referenced nowhere else in `frontend/src` (grep: only App.tsx:2309; the other hit is the untracked build bundle `frontend/dist/static/index-*.js`; `git ls-files frontend/dist` count = 0).
- `aria-label="open settings"` has no consumer; there are no frontend tests at all (`find frontend -name '*.test.*' -o -name '*.spec.*'` → none). CI frontend job is lint + `npm run build` only (/home/user/popping/.github/workflows/build.yml, `frontend-checks` job).
- No keyboard shortcut opens Settings: `openSettings` call sites are App.tsx:430 (def), App.tsx:2307 (gear), App.tsx:2811 (Drawer wiring). ShortcutsSheet.tsx has no settings entry (grep empty). Global keydown App.tsx:1753-1894 handles `/`, `?`, Esc, arrows, Enter only.
- Remaining entry points after removal: Drawer "All settings…" row Drawer.tsx:377-390 (`onOpenSettings?.()` then `onClose()`) → App.tsx:2811 `openSettings(tab ?? 'feeds')`; Drawer "History" row Drawer.tsx:336-351 → `openSettings('history')`; direct URL via `sync` App.tsx:394-428. Both Drawer rows close the Drawer first (Drawer.tsx:346, :385), so no stacked-overlay state arises (and Drawer z-40 < Settings z-50 regardless).
- Nothing inside `Settings` depends on how it was opened; `closeSettings` (App.tsx:2840) and the URL mechanics are unchanged.
- Cost: editing a feed goes from 2 taps (gear → feed row) to 3 (hamburger → "All settings…" → feed row); the only cue that feeds live under "All settings…" is its subtitle "feeds · AI · notifications · reset" Drawer.tsx:388.
- Housekeeping: comment App.tsx:2298-2303 (gear "lives to the LEFT of the hamburger") and App.tsx:2 become wrong; the cluster at App.tsx:2224 shrinks to search + refresh(mobile) + hamburger.
- Focus-trap contract untouched: Drawer initial focus targets `button[aria-label="close menu"]` Drawer.tsx:273-275.

## 4. Top-bar control inventory (DOM order)

Header container App.tsx:2210: `sticky top-0 z-20 pt-[env(safe-area-inset-top)] bg-bg-app/85 supports-[backdrop-filter]:backdrop-blur-xl border-b border-hairline`. Title row App.tsx:2220: `flex items-end justify-between px-4 pt-3 pb-2 sm:pt-4 sm:pb-3`. Control cluster App.tsx:2224: `flex items-center gap-1 sm:gap-2 pb-1`.

| # | Control | File:line | Size | Label | Action |
|---|---|---|---|---|---|
| 0 | Large title "Popping" | App.tsx:2221-2223 | `text-ios-large-title` = 34px/41px bold (tailwind.config.js:66), `truncate` | — | none |
| 1a | Search (collapsed) | App.tsx:2264-2277 | `w-11 h-11` (44px) | `aria-label="open search"` | `setSearchOpen(true)` + rAF focus `#app-search` (App.tsx:2266-2273) |
| 1b | Search (expanded) | App.tsx:2231-2262 | pill `h-11 w-44 sm:w-72` (App.tsx:2231); input `type=search inputMode=search autoFocus` id `app-search` (App.tsx:2233-2237), placeholder "search" (App.tsx:2246) | — | `onBlur` collapses only when empty (App.tsx:2240-2245); clear-X button App.tsx:2250-2261 `aria-label="clear search"`, icon `w-4 h-4`, no explicit hit-area class |
| 2 | Refresh icon | App.tsx:2286-2294 | `sm:hidden w-11 h-11` | `aria-label="refresh"` | `void refresh()`; `disabled={refreshing}`; `animate-spin` while refreshing |
| 3 | Settings gear | App.tsx:2305-2331 | `w-11 h-11`, 22px SVG | `aria-label="open settings"`, `data-settings-gear` | `openSettings('feeds')` |
| 4 | Hamburger | App.tsx:2333 → Hamburger.tsx:11-33 | `w-11 h-11` (Hamburger.tsx:16), 22px SVG | `aria-label="open menu"` (Hamburger.tsx:15) | `setDrawerOpen(true)` |

Sub-row App.tsx:2342 (`hidden sm:flex items-center justify-between px-4 pb-2 -mt-1`, desktop ≥640px only):
- Health caption App.tsx:2343-2347 (`entries · sources · status` or "connecting…").
- Refresh text button App.tsx:2349-2355 `min-h-[32px]`.
- Brief button App.tsx:2356-2363 `min-h-[32px]`, `triggerBriefGenerate(briefTone, setError)`.
- `UserBadge` App.tsx:2364 (sign-out, /home/user/popping/frontend/src/components/UserBadge.tsx:40-45). Not rendered on phones; the Drawer body Drawer.tsx:334-486 has no account/sign-out row.

Below the header (all in the normal flow, not inside `<header>`):
- Active-source chip bar App.tsx:2369-2394, shown when `activeSources.size > 0`: `px-4 py-2 border-b border-hairline bg-bg-surface flex … overflow-x-auto whitespace-nowrap`; per-source chip App.tsx:2380-2387 `rounded-full px-2.5 py-0.5 text-ios-caption` (13/18px + 4px pad ≈ 22px tall) → `toggleSource(src)`; "clear all" App.tsx:2388-2393.
- Error banner App.tsx:2398-2411 (`sticky top-0 z-15`, dismiss ✕ App.tsx:2404-2410).
- Desktop-only `BriefCard` App.tsx:2417-2425 (`hidden md:block`).
- `PresetChips` App.tsx:2427-2433 (component App.tsx:230-270; chip App.tsx:273-370; `py-0.5` pills App.tsx:349,356; "⋯" opens Rename/Update/Delete App.tsx:290-337; Rename uses `window.prompt` App.tsx:306).

Drawer callbacks wired at App.tsx:2800-2833: `onRefreshSources` → `refresh()` (2805), `onSourceToggle={toggleSourceAndMaybeClose}` (2807; closes Drawer on first selection App.tsx:2013-2017), `onClearAllFilters` (2808), `onCategoryJump={jumpToCategory}` (2809), `onResetLocalState` (2810), `onOpenSettings` (2811), `onSavePreset` → `window.prompt` (2812-2832).

Settings props wired at App.tsx:2834-2887: `open/tab` (2835-2836), `sources` (2837), `onRefreshSources` → `refresh()` (2838), `onError={setError}` (2839), `onClose={closeSettings}` (2840), brief tone + trigger (2841-2844), `onSourceRenamed` (2845; remaps active filter chips App.tsx:1988-2000), reset/hidden/starred/downvoted handlers (2846-2886). `ShortcutsSheet` App.tsx:2889-2892; `ToastHost` App.tsx:2895.

## 5. Mobile layout

- Viewport: /home/user/popping/frontend/index.html:5 `width=device-width, initial-scale=1.0, viewport-fit=cover`; standalone metas index.html:15-18 (`apple-mobile-web-app-capable`, status bar `black-translucent`); manifest index.html:19.
- Global CSS: /home/user/popping/frontend/src/styles.css:17 `html, body, #root { height: 100% }`; :20 `#root { padding-bottom: env(safe-area-inset-bottom) }`; :24-26 `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }` (the PR #11 focus-zoom fix; applies to native controls only); :36 `html, body { overflow-x: clip }`; :11-13 `.touch-pan-y-zoom`.
- Root div App.tsx:2188 `style={{ backgroundColor:'#000', minHeight:'100dvh' }}`, App.tsx:2199 `h-full flex flex-col isolate`. Auth splash App.tsx:2115-2160 is `position: fixed; inset: 0` inline.
- Sticky header with safe-area top padding: App.tsx:2210.
- Column switching: desktop grid `hidden md:grid md:grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 p-4 flex-1 overflow-x-clip overflow-y-auto` App.tsx:2587 (column refs attached only here, App.tsx:2598 via `setColumnRef` App.tsx:2092-2095); desktop For You `hidden md:block` App.tsx:2502; mobile `<main className="md:hidden flex-1 min-h-0 flex flex-col p-3">` App.tsx:2655. Breakpoints are Tailwind defaults (tailwind.config.js has no `screens` override): `sm`=640px, `md`=768px. Header sub-row/refresh-icon/search width use `sm` (App.tsx:2342, 2290, 2231) while the body split and Drawer width use `md` (App.tsx:2587, 2655; Drawer.tsx:289).
- Mobile tab bar App.tsx:2667-2718: `role="tablist"`, `shrink-0 flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1`; Brief tab (`mobileCol === -1`) App.tsx:2672-2684; one tab per column App.tsx:2685-2717 with `+N` badge App.tsx:2707-2714; tab pills `px-3 py-1.5 text-ios-caption` (App.tsx:2677, 2703) ≈ 30px tall.
- Mobile scroll body App.tsx:2720 `flex-1 min-h-0 overflow-y-auto`; renders `BriefCard startExpanded` when `mobileCol === -1` (App.tsx:2721-2729) else `<Column name={columns[mobileCol]?.name ?? ''} …>` (App.tsx:2731-2793).
- `mobileCol` clamp + persist effect App.tsx:1358-1367: skips when `columns.length === 0`; clamps to `columns.length - 1`; sole writer of `STORAGE_KEYS.mobileColLast`.
- `jumpToCategory` App.tsx:2022-2030 sets keyboard selection and `scrollIntoView` on the desktop column ref; it never calls `setMobileCol`, and on `<md` the ref target is inside a `hidden` (display:none) grid, so the Drawer's "Jump to column" section (Drawer.tsx:393-409) does nothing on a phone.
- Overlays: no body scroll lock and no `overscroll-behavior` anywhere in `frontend/src` (grep for `overscroll`, `body.style.overflow` → none); Drawer (Drawer.tsx:249-295) and Settings (Settings.tsx:185-205) are fixed layers over a scrollable document.
- Native dialogs used in the shell: `window.prompt` App.tsx:306 and App.tsx:2826; `window.confirm` Settings.tsx:413.

## 6. Tooling/deploy facts relevant to a shell change

- `npm run build` = `node scripts/check-html-comments.mjs` (index.html `/* */` guard, /home/user/popping/frontend/scripts/check-html-comments.mjs:58-73) → `tsc` (strict, /home/user/popping/frontend/tsconfig.json:14) → `vite build` (/home/user/popping/frontend/package.json:7-9).
- ESLint: `react-hooks/exhaustive-deps` is `warn` (/home/user/popping/frontend/eslint.config.js:38); `no-unused-vars` warn with `_` opt-out (eslint.config.js:46). Only `react`/`react-dom` runtime deps (package.json:14-17); no router, no UI kit.
- Images build on push to main (README.md:50); production update is `ops/popping-update.sh` (`git pull`, `docker compose pull`, `up -d`, prune, health wait — /home/user/popping/ops/popping-update.sh:16-24, 28-37). Frontend image runs `npm run build` (/home/user/popping/frontend/Dockerfile:12-14).

#### Constraints
- Settings open/close is URL-driven: `?view=settings&tab=<SettingsTab>` parsed by the popstate-synced effect at frontend/src/App.tsx:394-428; any replacement entry point must still call `openSettings` (App.tsx:430-437) so Back closes the sheet.
- The tab allow-list is duplicated in three places and must stay in sync when tabs are added/removed: App.tsx:409-418, frontend/src/components/Settings.tsx:40-48 (union), Settings.tsx:233 (tab strip array).
- Settings tab pills change the URL with `replaceState` + a synthetic `popstate` (Settings.tsx:241-246); any new in-sheet navigation must use the same pattern or lift a callback, or App's `settingsTab` desyncs.
- Both overlays must keep capture-phase Escape handlers with stopPropagation (Drawer.tsx:119-130, Settings.tsx:169-180) because App's global keydown (App.tsx:1753-1894) only skips when an input/textarea/select is focused (App.tsx:1755-1768).
- Drawer focus trap targets `button[aria-label="close menu"]` as the first focusable (Drawer.tsx:273-275); keep that aria-label if the Drawer header is redesigned.
- 44px tap-target convention for header icon buttons: `w-11 h-11` at App.tsx:2276, 2291, 2310 and Hamburger.tsx:16; sizes come from the `text-ios-*` scale in frontend/tailwind.config.js:63-71.
- Safe-area padding is applied per surface: header `pt-[env(safe-area-inset-top)]` App.tsx:2210; Drawer pt/pb Drawer.tsx:288; Settings sheet top offset Settings.tsx:204 and body bottom padding Settings.tsx:263; `#root` bottom padding styles.css:20. New sheets must replicate this.
- Touch devices force 16px on native `input, textarea, select` (frontend/src/styles.css:24-26); custom (div-based) pickers get no such protection and must not use a focusable text field under 16px.
- `sources` is owned by App and passed to Drawer, Settings and FeedManager (App.tsx:2804, 2837; Settings.tsx:266); any edit must call `onRefresh`/`onRefreshSources` → `refresh()` (App.tsx:2805, 2838) and renames must go through `onSourceRenamed` (App.tsx:1988-2000) to keep filter chips consistent.
- Mobile/desktop body split is at `md` (768px): App.tsx:2587 (`hidden md:grid`) and App.tsx:2655 (`md:hidden`); column refs for `jumpToCategory` only exist on the desktop grid (App.tsx:2598, 2022-2030).
- `mobileCol` is the only mobile column selector; it is clamped and persisted by App.tsx:1358-1367 to `STORAGE_KEYS.mobileColLast` (frontend/src/lib/storage.ts:52) and `-1` means the Brief tab (App.tsx:122-134, 2672-2684).
- No router and no UI library: runtime deps are react/react-dom only (frontend/package.json:14-17); Settings.tsx:20-24 documents the deliberate no-router decision. Dropdowns/pickers must be native `<select>` or hand-built.
- Build gate is `tsc --strict` + vite + the index.html comment checker (frontend/package.json:7-9, tsconfig.json:14, frontend/scripts/check-html-comments.mjs:58-73); ESLint exhaustive-deps is warn-only (frontend/eslint.config.js:38). There are no frontend unit or e2e tests (none found under frontend/ outside node_modules), and CI runs only lint + build (.github/workflows/build.yml `frontend-checks`).
- Overlay z-order: header z-20 (App.tsx:2210) < Drawer z-30/z-40 (Drawer.tsx:252, 286) < Settings z-50 (Settings.tsx:189) = Toast z-50 (Toast.tsx:117, mounted last at App.tsx:2895).
- Drawer rows that open Settings close the Drawer themselves (Drawer.tsx:345-346, 384-385) and App closes the Drawer on the first source-filter selection (App.tsx:2013-2017); a merged menu/settings surface must preserve that single-visible-overlay behaviour.
- Production deploy is image-based: push to main builds images (README.md:50), `ops/popping-update.sh:16-24` pulls and restarts; `frontend/dist` is not tracked (git ls-files count 0).

#### Findings
- [high] frontend/src/App.tsx:442: `closeSettings` pushes a new history entry (pushState) instead of going back, so after Done/Esc/backdrop the stack is [base, ?view=settings, base]; one Back re-opens Settings via the sync effect at App.tsx:396-399. Fix: Track whether Settings was opened by pushState in this session and call `history.back()` in that case (letting popstate→sync close it); fall back to replaceState when the sheet was opened by deep link/reload.
- [high] frontend/src/App.tsx:2305: Three paths to the same Settings overlay: gear (App.tsx:2305-2331), hamburger → Drawer 'All settings…' (Drawer.tsx:377-390), and Drawer 'History' (Drawer.tsx:336-351); the gear and 'All settings…' both land on the feeds tab. Fix: Keep one 44px button; either make the gear the single entry and fold the Drawer's three quick rows + source filter into the Settings sheet, or drop the gear and promote a 'Feeds' row to the top of the Drawer so feed editing stays at 2 taps. Update comments App.tsx:2 and 2298-2303.
- [high] frontend/src/App.tsx:2022: `jumpToCategory` only scrolls desktop column refs (attached at App.tsx:2598 inside the `hidden md:grid` main) and never sets `mobileCol`, so the Drawer's 'Jump to column' section (Drawer.tsx:393-409) does nothing on a phone. Fix: In `jumpToCategory`, also call `setMobileCol(idx)`; or hide the 'Jump to column' section below `md` since the tab bar at App.tsx:2667-2718 already covers it.
- [medium] frontend/src/App.tsx:2342: Header uses the `sm` (640px) breakpoint (sub-row App.tsx:2342, refresh icon `sm:hidden` App.tsx:2290, search width App.tsx:2231) while the body split uses `md` (768px, App.tsx:2587/2655). Between 640-767px the desktop header pairs with the mobile tab body; at ≥768px an iPhone in landscape (852-932 CSS px) gets the desktop multi-column grid. Fix: Pick one breakpoint for the shell (md) and/or gate the desktop grid on a pointer/width combination so phones in landscape keep the single-column tab layout.
- [high] frontend/src/App.tsx:2677: Sub-44px tap targets in the shell: mobile column tabs `py-1.5 text-ios-caption` ≈ 30px (App.tsx:2677, 2703); active-filter chips `py-0.5` ≈ 22px (App.tsx:2383) and 'clear all' text (App.tsx:2388-2393); preset chips `py-0.5` (App.tsx:349, 356); search clear-X has only a 16px icon and no hit-area class (App.tsx:2250-2261); Drawer Done `min-h-[32px]` (Drawer.tsx:318); Settings Done `min-h-[32px]` (Settings.tsx:215); Settings tab pills `min-h-[36px]` (Settings.tsx:249). Fix: Raise interactive rows/pills to `min-h-[44px]` (or add padding/hit-slop) on touch; keep visual size by using transparent padding.
- [medium] frontend/src/App.tsx:2364: `UserBadge` (sign out, UserBadge.tsx:40-45) is only rendered in the `hidden sm:flex` sub-row, and the Drawer has no account row (Drawer.tsx:334-486), so a phone user has no sign-out when OIDC is enabled. Fix: Add an account/sign-out row to the Drawer or Settings sheet (visible on all breakpoints) when `user` is non-null and `oidcDisabled` is false (App.tsx:447-449).
- [medium] frontend/src/App.tsx:2401: Error banner uses `z-15`, which Tailwind 3 does not generate (no `zIndex` extension in tailwind.config.js:9-121), so the `sticky top-0` banner has no z-index and stacks under the z-20 header. Fix: Use `z-10` or `z-[15]`, or render the banner inside the header so it does not need its own stacking.
- [medium] frontend/src/components/Settings.tsx:189: Neither overlay locks document scroll or sets `overscroll-behavior: contain` (no `overscroll`/`body.style.overflow` anywhere in frontend/src); the Settings body (Settings.tsx:263) and Drawer nav (Drawer.tsx:334) are inner scrollers over a scrollable document, so on iOS reaching the end of the sheet chains the scroll to the dashboard behind it. Fix: Add `overscroll-contain` to the inner scrollers and set `document.body.style.overflow='hidden'` (or `position:fixed` body lock) while `open` is true, restoring on close.
- [medium] frontend/src/App.tsx:2826: Shell uses native browser dialogs: `window.prompt` for 'Save current view' (App.tsx:2826) and preset rename (App.tsx:306), `window.confirm` for reset (Settings.tsx:413). These are not styled, not 44px, and look foreign in a home-screen app. Fix: Replace with an inline text field + Save row (same GroupedRow pattern as Drawer.tsx:552-602) or a small bottom sheet; keep the confirm step inline like PresetChip's confirmDelete (App.tsx:279-298).
- [medium] frontend/src/App.tsx:409: The SettingsTab allow-list is hand-duplicated in App.tsx:409-418, Settings.tsx:40-48 and Settings.tsx:233; adding/removing a tab in one place silently breaks deep links or the strip. Fix: Export a single `SETTINGS_TABS` const array from Settings.tsx, derive the union type from it, and use it for both the URL guard and the tab strip.
- [low] frontend/src/App.tsx:430: `openSettings`/`closeSettings` are recreated every render (not memoized), so Settings' Escape listener effect (Settings.tsx:169-180, deps `[open, onClose]`) re-subscribes on every App render while the sheet is open. Fix: Wrap both in `useCallback` with no deps (they only read `window.location`).
- [low] frontend/src/components/Drawer.tsx:257: Stale comments describe the Drawer as a bottom sheet that slides up (Drawer.tsx:257-259) while the implementation is a right-side panel (Drawer.tsx:286-294); App.tsx:2 omits the gear and App.tsx:2298-2303 will be wrong once the gear is removed. Fix: Rewrite the comments when the top bar/Drawer are reworked.

### frontend/src/components/Drawer.tsx (the hamburger "Menu" panel) and its wiring in App.tsx / Hamburger.tsx / Settings.tsx

## 0. Scope and method

Read in full: `frontend/src/components/Drawer.tsx` (625 lines, verified `wc -l`), `frontend/src/components/Hamburger.tsx` (34 lines), `frontend/src/styles.css` (188 lines), `frontend/index.html`, `frontend/tailwind.config.js`, `frontend/eslint.config.js`, `frontend/package.json`. Read by range: `frontend/src/App.tsx` (204-380 presets, 375-470 state/routing, 1140-1160, 1275-1300, 1978-2050, 2080-2096, 2175-2420 header, 2420-2440, 2480-2500, 2594-2600, 2655-2725 mobile pager, 2800-2840 Drawer/Settings JSX), `frontend/src/components/Settings.tsx` (1-60, 106-130, 160-275). One behaviour (scrollIntoView on a `display: contents` wrapper) was verified in headless Chromium via Playwright (script at `/tmp/claude-0/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/scratchpad/contents-scroll.cjs`, result `{"before":0,"afterWrapper":0,"afterChild":1232,"wrapperRects":0}`).

HEAD is `721713e` (PR #12 merged) — `git log --oneline -5`. Drawer.tsx was last touched by `9823be6` (PR #8).

## 1. Component shape and props

- Header comment, `Drawer.tsx:1-28`: describes a right-side panel, three sections (QUICK SETTINGS / JUMP TO COLUMN / SOURCES), and says Feeds/LLM/Notifications/Reset moved to Settings. Line 5 says "near-full height (88vh)" — the actual class is `w-[88vw]` + `h-full` (`Drawer.tsx:287`), so the comment is stale.
- Props type `Drawer.tsx:36-76`:
  | prop | Drawer line | used at | App wiring (`App.tsx`) |
  |---|---|---|---|
  | `open` | 37 | 119-130, 150, 206, 253, 291 | 2801 `drawerOpen` (state at 383) |
  | `onClose` | 38 | 125, 178, 250, 316, 346, 370, 385, 403 | 2802 `setDrawerOpen(false)` |
  | `categories: string[]` | 39 | 393-407 | 2803 ← `categories` memo at 764 (`Array.from(byCategory.keys()).sort()`) |
  | `sources: Source[]` | 46 | 430, 454 | 2804 (App-owned fetch; comment 40-45 says Drawer used to fetch its own) |
  | `onRefreshSources?` | 49 | 431-436 | 2805 `refresh()` |
  | `activeSources: Set<string>` | 51 | 414-419, 455 | 2806 |
  | `onSourceToggle` | 52 | 466 | 2807 `toggleSourceAndMaybeClose` (2010-2017: closes drawer when the filter was empty before the tap) |
  | `onClearAllFilters?` | 56 | 419-421 | 2808 `clearSourceFilters` (2018-2020) |
  | `onCategoryJump?` | 60 | 402 | 2809 `jumpToCategory` (2022-2030) |
  | `onResetLocalState?` | 66 | destructured as `_onResetLocalState` at 92, never used | 2810 `resetLocalState` (1143) — dead prop, comment at 61-66 admits it |
  | `onOpenSettings?(tab?)` | 69 | 345 (`'history'`), 384 (no arg) | 2811 `(tab) => openSettings(tab ?? 'feeds')` |
  | `onSavePreset?` | 75 | 366-376 | 2812-2832 — App does the `window.prompt` (2826), then `savePreset(name)` (2830) + toast (2831) |
- Prop comment at `Drawer.tsx:71-75` says "The Drawer collects the name via a native prompt" — false; the prompt lives in App (`App.tsx:2826`). Drawer's own destructuring comment at 94-99 states it correctly.
- Unused primitives: `GroupedRow`'s `tone` prop (`Drawer.tsx:557, 565-572`) is never passed by any row in the file (rows at 336-351, 367-375, 377-390, 398-406, 432-436).
- `onResetLocalState` is safe to delete: ESLint only warns on unused vars and allows `_` prefix (`eslint.config.js:46`); build is `tsc && vite build` (`package.json:10`).

## 2. Panel geometry

- Backdrop `Drawer.tsx:249-255`: `fixed inset-0 z-30 bg-black/60 md:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm`, `onClick={onClose}`, `aria-hidden`.
- Panel `<aside>` `Drawer.tsx:262-295`: `fixed z-40 bg-bg-app shadow-2xl flex flex-col touch-pan-y-zoom inset-y-0 right-0 top-0 left-auto h-full w-[88vw] max-w-[420px] rounded-l-ios-lg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:w-[360px] md:rounded-none`.
  - Mobile (<md): right-anchored, full-height, 88% of viewport width, capped at 420px, 14px left corners (`rounded-l-ios-lg` → `ios-lg: 14px`, `tailwind.config.js:82`).
  - Desktop (md, 768px+): 360px right sidebar, square corners. Settings' desktop panel is 480px (`Settings.tsx:198`) — the two panels are different widths.
  - Safe areas via padding on the aside (288). The body `<nav>` has plain `pb-8` (334), which sits inside that padding.
- JSX comment `Drawer.tsx:257-261` says "Mobile: bottom sheet, slides up … Desktop (md+): slides in from the left as a 360px sidebar" — stale on both counts (classes at 287-294 are right-anchored translate-x on every breakpoint). The `sheetUp` keyframe / `animate-sheet-up` in `tailwind.config.js:106-109, 122` is described as "used by the Drawer on mobile" but nothing in `src/` uses `animate-sheet-up` (grep `sheet-up` across `App.tsx`, `Settings.tsx`, `Drawer.tsx`, `styles.css` returned nothing).
- Grabber `Drawer.tsx:303-306`: `md:hidden absolute top-3 left-2 h-10 w-1` — absolute positioning ignores the aside's `pt-[env(safe-area-inset-top)]` (288), so on a notched iPhone in home-screen mode (`index.html:5, 15-17` set `viewport-fit=cover` + `black-translucent`) the grabber sits ~12px from the physical top, under the status bar. Comment 296-302 says it is decorative, not interactive.
- Header row `Drawer.tsx:314-325`: Done button (`min-h-[32px] min-w-[32px]`, `pl-10 md:pl-0` to clear the grabber, 318) on the left, `<h2>Menu</h2>` on the right (`text-2xl md:text-ios-large-title`, 322). Same shape as Settings' header (`Settings.tsx:203-221`), whose Done button is also 32px (`Settings.tsx:216`). Both are below the 44px target the file's own comment promises (`Drawer.tsx:23`).
- Body `<nav>` `Drawer.tsx:334`: `flex-1 min-h-0 overflow-y-auto bg-bg-app pb-8`.
- Section primitive `GroupedSection` `Drawer.tsx:508-541`: uppercase caption label + optional `action` on the right (521-526), rounded `bg-bg-surface` card with `mx-4` (531), optional footnote (534-538). Row primitive `GroupedRow` `Drawer.tsx:552-602`: `min-h-[44px]`, renders `<button type="button">` when `onClick` is set (590-599), `<div>` otherwise (601). Chevron inline SVG 607-622.

## 3. Open/close animation and mount behaviour

- The aside is always mounted; open/closed is purely `translate-x-0` vs `translate-x-full` with `transition-transform duration-300 ease-out` (`Drawer.tsx:290-294`). Backdrop fades `transition-opacity duration-200` and gets `pointer-events-none` when closed (252-254).
- No `motion-safe:` / reduced-motion guard on either transition (252, 290). App uses `motion-safe:animate-fade-in` elsewhere (`App.tsx:2382`), and `styles.css:72-77, 185-188` handle reduced motion only for the splash and wallpaper.
- Because the closed aside is not `inert`, not `aria-hidden`, and not `invisible`/`display:none` (nothing of the kind anywhere in 262-295; grep for `inert` across App/Settings/Drawer returned nothing), the Done button (315), the three Quick-settings rows, every category row and every source checkbox stay in the keyboard tab order and in the accessibility tree while the panel is off-screen. Focus trap (205-239) and Esc (119-130) only run when `open`. Contrast: Settings unmounts when closed (`Settings.tsx:181 if (!open) return null`).
- The document never gets a horizontal scrollbar from the off-screen panel because `html, body { overflow-x: clip }` (`styles.css:36`).
- Opening the Drawer is plain React state (`App.tsx:383, 2333`); it does not push a history entry, unlike Settings (`App.tsx:430-444` pushState / 438-444 delete params; URL sync at 393-428). So browser Back / iOS edge-swipe-back does not close the Drawer, while it does close Settings.

## 4. Swipe-to-dismiss

- `Drawer.tsx:148-193`. `SWIPE_DISMISS_PX = 100` (148). Listeners are attached with `addEventListener` on the aside (183-186) so `touchmove` can be `{ passive: false }` (184) and call `preventDefault()` once `dx < -10` (165-169). `touchend` reads `changedTouches[0]` and closes when `dx < -100` (171-179). `touchcancel` disarms (180-182). Rightward drags are intentionally ignored (143-147).
- Arms on any single-finger touch anywhere inside the aside (157-161), including on the source checkbox `<label>` rows (457-479) and the scrollable `<nav>` (334). There is no vertical-intent lock: a mostly vertical scroll that drifts 10px left starts preventDefault-ing. There is no drag-follow (the panel does not move with the finger); the only feedback is the close at release.
- `touch-pan-y-zoom` (`styles.css:11-13`: `touch-action: pan-y pinch-zoom`) is on the aside (286) so vertical panning stays native and pinch-zoom is preserved; the comment at 6-10 names the Drawer and Card as the two swipe surfaces.
- Effect deps `[open, onClose]` (193): `onClose` is an inline arrow in App (`App.tsx:2802`), so the three listeners are torn down and re-added on every App render while open. Harmless but churny.

## 5. Scroll locking

- None. No code toggles `body.style`, `documentElement.style`, `overflow-hidden` on body, or `overscroll-behavior` anywhere (grep over `App.tsx`, `styles.css`, `index.html`, `lib/`, `Settings.tsx`, `Card.tsx`, `ShortcutsSheet.tsx` for `body.style|documentElement.style|overflow-hidden|overscroll` found only unrelated card/grid uses at `Settings.tsx:292`, `Card.tsx:1734`).
- Why it mostly works anyway: the shell is `h-full flex flex-col isolate` (`App.tsx:2199`) with `minHeight: '100dvh'` (`App.tsx:2188`), `html, body, #root { height: 100% }` (`styles.css:17`), and the scrolling happens inside `main ... overflow-y-auto` containers (`App.tsx:2594` desktop, `App.tsx:2721` mobile). The backdrop (249-255) covers those containers, so touches on it do not reach them.
- Gap: the Drawer's `<nav>` (334) has no `overscroll-contain`, so on iOS, reaching the end of the source list and continuing to drag rubber-bands/chains to the document. Settings' body (`Settings.tsx:263`) has the same omission.

## 6. Keyboard, focus, ARIA

- Esc: window capture listener, `stopPropagation` + `preventDefault`, only while open (`Drawer.tsx:119-130`). Settings has the identical pattern (`Settings.tsx:168-179`). App's own Esc handling is limited to the search input (`App.tsx:1762, 1785`).
- Focus trap `Drawer.tsx:203-239`: rAF-deferred initial focus onto `button[aria-label="close menu"]` captured in the ref callback (263-276); Tab/Shift-Tab cycle among `button, [href], input, select, textarea, [tabindex]` (219-221).
- `role="dialog" aria-modal="true" aria-label="menu"` (277-279). Hamburger button `aria-label="open menu"` (`Hamburger.tsx:14`), 44×44 (`Hamburger.tsx:15`).
- No keyboard shortcut opens the Drawer: `setDrawerOpen(true)` only at `App.tsx:2333`; ShortcutsSheet lists only "Esc — close drawer / clear search" (`ShortcutsSheet.tsx:32`).

## 7. QUICK SETTINGS section (`Drawer.tsx:335-391`)

1. **History** row 336-351 → `onOpenSettings?.('history'); onClose()` → `App.tsx:2811` → `openSettings('history')`. Subtitle "read, hidden and saved stories".
2. **Save current view** row 366-376, only rendered when `onSavePreset` is passed (always, per `App.tsx:2812`). Calls `onSavePreset(); onClose()`. The name is collected by `window.prompt` in `App.tsx:2826-2828`; `null` aborts (2829), empty string falls through to "Untitled preset" (`App.tsx:1685`).
3. **All settings…** row 377-390 → `onOpenSettings?.(); onClose()` → `App.tsx:2811` maps `undefined` to `'feeds'`. Subtitle `"feeds · AI · notifications · reset"` (388) lists four tabs; Settings actually has eight (`Settings.tsx:40-48`: feeds, llm, notifications, history, hidden, starred, voted, reset; labels at `Settings.tsx:106-115`).
- This row duplicates the top-bar gear exactly: gear `onClick={() => openSettings('feeds')}` (`App.tsx:2307`) vs Drawer row → `openSettings('feeds')` (via 2811). Both land on the same tab.
- Section-level comment `Drawer.tsx:17` calls this section "link to the full Settings overlay".

## 8. JUMP TO COLUMN section (`Drawer.tsx:393-409`)

- Renders one `GroupedRow` per `categories` entry with `categoryLabel(c)` (400), chevron, `onClick → onCategoryJump?.(c); onClose()` (401-404). Hidden when `categories` is empty (393).
- `categories` = sorted keys of `byCategory` (`App.tsx:764`). The dashboard renders `columns` (`App.tsx:903`), which desktop filters further (`App.tsx:2596` drops 'For You' unless `viewKind === 'multisub'`); `jumpToCategory` searches `columns` by name (`App.tsx:2023`).
- `jumpToCategory` (`App.tsx:2022-2030`): `setSelectedColumnIndex(idx)`, `setSelectedCardId(null)`, then `columnRefs.current.get(category)?.scrollIntoView(...)`.
  - **Mobile: no effect on what is shown.** The mobile pager displays `columns[mobileCol]` (`App.tsx:2733-2792`) and `mobileCol` is only changed by the mobile tab strip (`setMobileCol` at `App.tsx:2677, 2700`). `jumpToCategory` never calls `setMobileCol`. `columnRefs` are registered only inside the desktop grid (`ref={setColumnRef(col.name)}` at `App.tsx:2598`, inside `main className="hidden md:grid …"` at 2594; `setColumnRef` defined 2092-2095 and used nowhere else), so on mobile the ref lookup returns nothing. `selectedColumnIndex` (671) only drives keyboard selection (1802-1897) and `selectedId` highlighting (2606, 2742).
  - **Desktop: the scroll is also a no-op.** The ref element is `<div className="contents">` (`App.tsx:2598`), i.e. `display: contents`, which has no box; `scrollIntoView` on it does nothing. Verified in Chromium: calling it on the wrapper left `scrollTop` at 0 (`getClientRects().length === 0`), calling it on the child scrolled to 1232. Only `setSelectedColumnIndex` survives, which moves the keyboard cursor, not the viewport.
- Mobile already has an explicit, horizontally scrolling column tab strip with new-count badges directly under the header (`App.tsx:2666-2718`, `role="tablist" aria-label="dashboard sections"`), so JUMP TO COLUMN is both broken and redundant on the owner's primary device.

## 9. SOURCES section (`Drawer.tsx:411-484`)

- Label "Sources"; `footnote` = `filtering: <raw names joined>` when any filter is active (413-417); `action` = "Clear" text button calling `onClearAllFilters` (418-428) → `clearSourceFilters` (`App.tsx:2018-2020`).
- Empty states: with `onRefreshSources`, a "No sources loaded / tap to retry" row (431-436); otherwise a static "no sources configured" paragraph (438-440). App always passes the retry callback (`App.tsx:2805`).
- Rows 454-479: `<label>` with `min-h-[44px]`, hairline divider, `bg-bg-elevated` when active; native `<input type="checkbox">` 16px (`h-4 w-4 accent-accent`, 467) with `aria-label="filter by <name>"`; `SourceIcon` 18px (472); `sourceLabel(s.name)` (474); trailing `s.category` raw string in caption (477) — not passed through `categoryLabel`, unlike the JUMP TO COLUMN rows (400). The footnote (415) also uses raw `s.name` while the rows use `sourceLabel`.
- `onSourceToggle` → `toggleSourceAndMaybeClose` (`App.tsx:2010-2017`): closes the drawer on the first selection from an empty filter, stays open on subsequent toggles; comment 443-452 in Drawer documents this.
- Active filters are also shown as a "filtering by:" chip bar under the header with per-chip remove and "clear all" (`App.tsx:2368-2392`), so the Drawer's footnote + Clear duplicate that.
- No search/filter box inside the list; with many sources this is a long single list ordered as `sources` arrives (454, no sort in Drawer).

## 10. Presets and native dialogs

- Drawer's only preset surface is the "Save current view" row (366-376). Preset chips strip (`PresetChips` `App.tsx:210-253`, rendered at 2428-2434 above the grid) handles apply / rename / update / delete.
- Native dialogs across the frontend (`grep -rn "prompt(\|confirm(\|alert("`):
  - `App.tsx:2826` `window.prompt('Name this view …')` — from the Drawer row. Comment 2813-2825 argues a custom modal is "80 lines … not noticeably better".
  - `App.tsx:306` `window.prompt('Rename this view', preset.name)` — chip "Rename".
  - `Settings.tsx:413` `window.confirm('Clear local state? …')` — Reset tab.
  - Delete preset uses an inline Yes/No pill, not `confirm()` (`App.tsx:276-296`).
- Presets persist via the preferences provider (`preferences.tsx:152, 165, 233, 700-701`), cap `MAX_PRESETS = 50` (`preferences.tsx:785`), `savePreset` at `App.tsx:1680-1694`.

## 11. Status chip

- There is no status chip in the Drawer today. The comments "One-shot initial health fetch so the Drawer status chip renders" (`App.tsx:1281`) and "5 min cadence is plenty for the Drawer status chip" (`App.tsx:1290-1291`), plus `App.tsx:65`, are stale. `health` state (382) is rendered only in the desktop sub-row `hidden sm:flex` (`App.tsx:2341-2345`: "N entries · M sources · status"). On phones there is no health/status surface at all.
- README still documents Drawer chips that moved: `README.md:283, 288, 313-317, 327, 330, 339` (LLM chip "change", Notifications chip, "Generate brief now"). Settings' header comment confirms the move (`Settings.tsx:7-13`).

## 12. Top bar inventory (what the Drawer would replace)

Header `App.tsx:2210` (`sticky top-0 z-20 pt-[env(safe-area-inset-top)]`), title row 2220-2335. On a phone (< sm) the trailing cluster is four 44×44 icon buttons: search (`App.tsx:2262-2277` collapsed button), refresh (`sm:hidden`, 2290-2298), gear (2306-2328, `aria-label="open settings"`, `data-settings-gear` at 2309 referenced nowhere else), hamburger (2333, `Hamburger.tsx:11-16`). The health/Refresh/Brief sub-row is `hidden sm:flex` (2341). The gear's own comment (2300-2305) justifies it as "more menu options → main menu" next to the hamburger.

Layering, for any restructure: header z-20 (`App.tsx:2210`), Drawer backdrop z-30 (`Drawer.tsx:252`), Drawer panel z-40 (286), ShortcutsSheet z-40 (`ShortcutsSheet.tsx:70`), Settings z-50 (`Settings.tsx:189`), Toast z-50 (`Toast.tsx:117`). Side note: the error banner uses `z-15` (`App.tsx:2401`), which is not a Tailwind 3 default and `tailwind.config.js` adds no `zIndex`, so that class emits nothing.

## 13. Assessment: Drawer as the single menu

**Does it already have a Settings entry that could become primary?** Yes. "All settings…" (`Drawer.tsx:377-390`) already routes to `openSettings('feeds')` through `onOpenSettings` (`App.tsx:2811`), which is byte-for-byte what the gear does (`App.tsx:2307`). Removing the gear button (2306-2328) loses nothing functionally; the row's chevron + `GroupedRow` button already give it a 44px target. It also has a tab-targeted variant (`onOpenSettings('history')`, 345), so the same mechanism can expose any `SettingsTab` (`Settings.tsx:40-48`) as its own row.

**What the single menu should contain (derived from what exists and what is duplicated):**
- Keep, promoted to first position: Settings (rename from "All settings…"; subtitle 388 must be regenerated from `TAB_META` or dropped). Optionally direct rows for the tabs people actually revisit (Feeds → `'feeds'`, History → `'history'`, Saved → `'starred'`) since `onOpenSettings(tab)` already supports them.
- Keep: SOURCES filter (411-484) — it is the only multi-select source filter on mobile; the header chip bar (`App.tsx:2368-2392`) only removes.
- Keep: Save current view (366-376), but replace the `window.prompt` at `App.tsx:2826` (and `App.tsx:306`) with an in-panel name field.
- Drop or rebuild: JUMP TO COLUMN (393-409) — a verified no-op on mobile (`App.tsx:2022-2030` never sets `mobileCol`) and a no-op scroll on desktop (`display: contents` ref at `App.tsx:2598`); the mobile tab strip (`App.tsx:2666-2718`) already covers the use case. If kept, `jumpToCategory` must call `setMobileCol(idx)` and the desktop ref must point at a boxed element.
- Add (mobile only, currently missing): the health/status line that exists only on desktop (`App.tsx:2341-2345`) — the stale "Drawer status chip" comments (`App.tsx:1281, 1290`) show it used to live here; and Brief, which on mobile is only reachable as the first tab of the pager (`App.tsx:2672-2685`).
- Remove: `onResetLocalState` prop and destructure (`Drawer.tsx:61-66, 89-92`; `App.tsx:2810`).
- Fix while in there: closed-state `inert`/`visibility` (262-295), grabber placement vs safe area (303-306 vs 288), Done target size (318), `overscroll-contain` on nav (334), stale comments (3-5, 257-261, 71-75), `motion-safe:` on 252/290.

**Geometry if it becomes the only panel:** Drawer and Settings use the same header template (`Drawer.tsx:314-325` ≈ `Settings.tsx:203-221`) but different presentations — Drawer is an 88vw right panel on mobile, Settings is a top-pinned full-width sheet (`Settings.tsx:197-198`) at 480px on desktop vs the Drawer's 360px (`Drawer.tsx:289`). Opening Settings from the Drawer currently closes the Drawer first (385-386) so the two never stack; a one-button design either keeps that hand-off or nests Settings inside the Drawer, in which case the URL-driven tab state (`App.tsx:393-444`) and the z-50 ordering (`Settings.tsx:189`) have to be preserved.

#### Constraints
- Stacking order must be kept: header z-20 (frontend/src/App.tsx:2210) < Drawer backdrop z-30 (frontend/src/components/Drawer.tsx:252) < Drawer panel z-40 (Drawer.tsx:286) = ShortcutsSheet z-40 (frontend/src/components/ShortcutsSheet.tsx:70) < Settings z-50 (frontend/src/components/Settings.tsx:189) = Toast z-50 (frontend/src/components/Toast.tsx:117).
- Settings tab identity is URL state: allow-list parse at frontend/src/App.tsx:394-428, pushState open/close at App.tsx:430-444, replaceState + synthetic popstate tab switch at Settings.tsx:238-246; the Drawer deep-links by tab id (Drawer.tsx:345 'history', Drawer.tsx:384 default → App.tsx:2811 maps undefined to 'feeds'). Any new tab or rename must be added to the SettingsTab union (Settings.tsx:40-48), TAB_META (Settings.tsx:106-115) and the App allow-list.
- The Drawer's 'All settings…' row (Drawer.tsx:377-390) and the top-bar gear (App.tsx:2306-2328, onClick at 2307) both call openSettings('feeds'); removing the gear must keep the Drawer row (or an equivalent) as the only entry point, and the hamburger (App.tsx:2333, Hamburger.tsx:11-16) is the only opener of the Drawer (no keyboard shortcut; ShortcutsSheet.tsx:32).
- Any panel with a JS horizontal swipe must keep `touch-pan-y-zoom` (frontend/src/styles.css:11-13, touch-action: pan-y pinch-zoom) so pinch-zoom is not lost; it is applied on the Drawer aside at Drawer.tsx:286 and the swipe listeners need `{ passive: false }` on touchmove (Drawer.tsx:184).
- Safe areas: the Drawer aside pads with env(safe-area-inset-top/bottom) (Drawer.tsx:288); Settings' mobile sheet is pinned by its top edge with env(safe-area-inset-top), never a vh height (Settings.tsx:193-198, PR #11); #root pads bottom (styles.css:20); index.html:5,15-17 run the app under the status bar (viewport-fit=cover, black-translucent).
- On touch screens every input/textarea/select is forced to 16px with !important (styles.css:24-26); any new controls added to the Drawer (preset name field, category picker) must be 16px or larger so focus-zoom does not return.
- Esc handling is a window capture listener with stopPropagation in both Drawer.tsx:119-130 and Settings.tsx:168-179; the Drawer's focus trap (Drawer.tsx:203-239) depends on the Done button carrying aria-label="close menu" (Drawer.tsx:273-275, 317). A restructure must keep an initial-focus target and the trap.
- Source list is App-owned and passed as a prop (Drawer.tsx:40-46, App.tsx:2804); the Drawer must not refetch. `onSourceToggle` is wired to toggleSourceAndMaybeClose (App.tsx:2010-2017), which closes the Drawer on the first selection from an empty filter — a deliberate behaviour to keep or consciously replace.
- Desktop breakpoint is md (768px): Drawer md:w-[360px] (Drawer.tsx:289), Settings md:w-[480px] (Settings.tsx:198); the mobile column pager is md:hidden (App.tsx:2655) and the desktop grid is hidden md:grid (App.tsx:2594). Column refs for jumpToCategory exist only in the desktop grid (App.tsx:2598) and mobile column choice is `mobileCol` (App.tsx:445, 2700).
- Native dialogs to replace, all outside Drawer.tsx: window.prompt at App.tsx:2826 (save view, triggered by the Drawer row at Drawer.tsx:366-376) and App.tsx:306 (rename chip); window.confirm at Settings.tsx:413 (reset).
- Presets persist through the preferences provider (frontend/src/lib/preferences.tsx:152, 233, 700-701) with MAX_PRESETS = 50 (preferences.tsx:785); savePreset (App.tsx:1680-1694) defaults an empty name to 'Untitled preset' (App.tsx:1685).
- Lint/build gates: ESLint warns (not errors) on unused vars and allows a `_` prefix (frontend/eslint.config.js:46); `npm run build` is `tsc && vite build` (frontend/package.json:10) with a prebuild HTML-comment check (package.json:8). Removing onResetLocalState (Drawer.tsx:61-66, 89-92, App.tsx:2810) is lint-safe.
- `html, body { overflow-x: clip }` (styles.css:36) is what keeps the off-screen translate-x-full Drawer (Drawer.tsx:293) from creating horizontal page scroll; do not change it to overflow-x hidden (would create a scroll container) or remove it.

#### Findings
- [high] frontend/src/App.tsx:2022: JUMP TO COLUMN does nothing visible on mobile: jumpToCategory sets selectedColumnIndex and scrolls a columnRefs entry, but the mobile pager shows columns[mobileCol] (App.tsx:2733) and mobileCol is only set by the mobile tab strip (App.tsx:2677, 2700); columnRefs are registered only inside the hidden-on-mobile desktop grid (App.tsx:2594, 2598). The Drawer still renders the section on phones (Drawer.tsx:393-409). Fix: Either remove the JUMP TO COLUMN section (the mobile tab strip at App.tsx:2666-2718 already covers it) or make jumpToCategory also call setMobileCol(idx) and hide the section on md:hidden viewports.
- [high] frontend/src/App.tsx:2598: On desktop the jump scroll is also a no-op: the ref element is <div className="contents"> (display: contents has no box), and scrollIntoView on it does nothing. Verified in headless Chromium: wrapper call left scrollTop at 0 (getClientRects().length === 0); calling it on the child scrolled to 1232. Fix: Attach the ref to a boxed element (e.g. forward a ref into Column's root <section>) or call scrollIntoView on el.firstElementChild.
- [high] frontend/src/components/Drawer.tsx:377: The 'All settings…' row calls onOpenSettings() → openSettings('feeds') (App.tsx:2811), identical to the top-bar gear's onClick (App.tsx:2307). The row's subtitle 'feeds · AI · notifications · reset' (Drawer.tsx:388) lists four tabs while Settings has eight (Settings.tsx:40-48). Fix: Make this row the primary Settings entry (move to first position, rename to 'Settings'), derive or drop the subtitle, and delete the gear button at App.tsx:2306-2328.
- [high] frontend/src/components/Drawer.tsx:262: The aside is always mounted and only translated off-screen when closed (translate-x-full at line 293); it carries no inert, aria-hidden or visibility toggle, so its Done button, rows and source checkboxes remain in the Tab order and the accessibility tree while invisible. Settings instead unmounts when closed (Settings.tsx:181). Fix: Add `inert` + `aria-hidden` when !open (or `invisible` after the transition ends via onTransitionEnd), or unmount like Settings and animate with a keyed presence pattern.
- [high] frontend/src/App.tsx:2826: Preset naming from the Drawer's 'Save current view' row (Drawer.tsx:366-376) uses window.prompt; chip rename uses window.prompt at App.tsx:306. Native prompts break the app's visual language and on iOS home-screen apps render as a system sheet. Fix: Replace with an inline name field inside the Drawer section (16px input per styles.css:24-26) that saves on Enter/blur, and an inline rename state on the chip.
- [high] frontend/src/components/Drawer.tsx:61: onResetLocalState is a dead prop: declared at 61-66, destructured as _onResetLocalState at 89-92, never used, still wired at App.tsx:2810. Fix: Delete the prop from Props, the destructuring, and the App.tsx:2810 line.
- [high] frontend/src/components/Drawer.tsx:3: Header comment says the mobile panel is '88vh' tall; the class is w-[88vw] h-full (line 287). JSX comment at 257-261 says 'Mobile: bottom sheet, slides up … Desktop slides in from the left' but the classes at 287-294 are right-anchored translate-x on every breakpoint. tailwind.config.js:106-109 describes sheetUp as 'used by the Drawer on mobile' but no source file uses animate-sheet-up. Fix: Rewrite the two comments to match the right-anchored panel and remove the unused sheetUp keyframe/animation.
- [high] frontend/src/components/Drawer.tsx:71: Props comment claims 'The Drawer collects the name via a native prompt'; the prompt is actually in App.tsx:2826 and the Drawer only invokes the callback (369). Fix: Correct the comment (or move the name collection into the Drawer as an inline field, which makes the comment true).
- [medium] frontend/src/components/Drawer.tsx:303: The mobile grabber is absolute `top-3 left-2`; absolute positioning ignores the aside's pt-[env(safe-area-inset-top)] (line 288), so in home-screen mode on a notched iPhone (index.html:5, 15-17) it sits ~12px from the physical top, under the status bar. Fix: Use top-[calc(env(safe-area-inset-top)+0.75rem)] or move the grabber inside the padded header row.
- [medium] frontend/src/components/Drawer.tsx:318: The Done button is min-h-[32px] min-w-[32px] (same in Settings.tsx:216) although the file's own comment promises 44px targets (Drawer.tsx:23) and the rows are min-h-[44px] (589). Fix: Raise to min-h-[44px] min-w-[44px] (or h-11) with the text still vertically centred.
- [medium] frontend/src/components/Drawer.tsx:334: No scroll locking anywhere and the scrollable <nav> has no overscroll-contain; on iOS, dragging past the end of the source list rubber-bands/chains into the document. Same omission on Settings' body (Settings.tsx:263). Fix: Add `overscroll-contain` to the nav (and Settings body); body-level locking is unnecessary because the shell is h-full with inner scroll containers (App.tsx:2199, 2594, 2721).
- [medium] frontend/src/App.tsx:1281: Comments at App.tsx:65, 1281 and 1290-1291 say the health fetch feeds a 'Drawer status chip', but the Drawer has no such chip; health renders only in the desktop sub-row (App.tsx:2341-2345, hidden sm:flex), so phones have no status surface. README.md:283, 288, 313-317, 327, 339 still describe Drawer chips that moved to Settings (Settings.tsx:7-13). Fix: If the Drawer becomes the single menu, add a status row (entries · sources · status) to it for mobile and update the comments and README.
- [medium] frontend/src/components/Drawer.tsx:415: The SOURCES footnote joins raw s.name values while the rows show sourceLabel(s.name) (474), and the trailing category caption uses raw s.category (477) while JUMP TO COLUMN uses categoryLabel (400) — the same source/category appears with two spellings in one panel. The footnote + Clear also duplicate the header 'filtering by:' chip bar (App.tsx:2368-2392). Fix: Use sourceLabel/categoryLabel consistently, and drop either the footnote or the header chip bar.
- [low] frontend/src/components/Drawer.tsx:157: The swipe-to-dismiss arms on any single touch inside the aside with no vertical-intent lock: a scroll that drifts 10px left starts preventDefault-ing (165-169) and a 100px leftward release closes (178), including when the gesture started on a checkbox row. There is no drag-follow, so the only feedback is the sudden close. Fix: Add a direction lock (ignore once |dy| > |dx| early in the gesture) and optionally translate the panel with the finger before committing.
- [low] frontend/src/components/Drawer.tsx:290: Open/close transitions (translate 300ms at 290, backdrop opacity 200ms at 252) have no motion-safe:/prefers-reduced-motion guard, unlike App.tsx:2382 and styles.css:72-77, 185-188. Fix: Prefix with motion-safe: (motion-safe:transition-transform motion-safe:duration-300) or add a reduced-motion rule.
- [low] frontend/src/App.tsx:383: The Drawer is plain state with no history entry, while Settings is URL-driven (App.tsx:430-444); browser Back / iOS swipe-back closes Settings but not the Drawer. If the Drawer becomes the only menu this inconsistency becomes more visible. Fix: Either push a `?view=menu` history entry when opening the Drawer (mirroring openSettings) or accept the difference and document it.
- [low] frontend/src/App.tsx:2401: Error banner uses `z-15`, which is not a Tailwind 3 default z-index and tailwind.config.js adds no zIndex extension, so the class emits nothing and the sticky banner has no stacking level relative to the header (z-20) and columns. Fix: Use z-[15] or an existing step (z-10).
- [high] frontend/src/App.tsx:2309: `data-settings-gear` attribute on the gear button is referenced nowhere else in frontend/src (grep), so it is an unused hook that will disappear with the button. Fix: Remove with the gear; nothing depends on it.

### Backend contract for the feed editor: PATCH /api/sources/{id}, category/header/name/url validation, test endpoint, category source-of-truth, plugin use of custom_headers, pinned tests

## 1. Endpoints in backend/app/routes/sources.py (router tags=["sources"], line 54)

| Method/path | Handler | Line | Auth |
|---|---|---|---|
| GET /api/sources | list_sources_endpoint | 393-404 | public |
| GET /api/sources/{id} | get_source_endpoint | 407-415 | public |
| POST /api/sources | create_source_endpoint | 421-538 | `_write_deps` |
| POST /api/sources/auto | source_auto_endpoint | 573-644 | `_write_deps` |
| PATCH /api/sources/{id} | update_source_endpoint | 647-798 | `_write_deps` |
| DELETE /api/sources/{id} | delete_source_endpoint | 801-833 | `_write_deps` |
| POST /api/sources/test | test_source_endpoint → `_test_source_impl` | 1071-1088 → 839-1068 | `_write_deps` |
| GET /api/feed-recommendations | 1094-1111 | public |
| POST /api/feed-recommendations/discover | 1119-1155 | `_write_deps` |

- `_write_deps = [Depends(require_user)] if settings.oidc_enabled else []` (sources.py:62). No rate limiting anywhere (grep of backend/app/main.py for ratelimit/slowapi/limiter: no hits).
- **There is no categories endpoint.** grep of backend/app/routes/ for "categories" → only a docstring in entries.py:300. No Category table in backend/app/models.py (only `Source.category` at models.py:46 and `followed_categories`/`muted_categories` JSON columns on a prefs model at models.py:299-300).

## 2. Schemas (backend/app/schemas.py)

- `SourceOut` (schemas.py:12-64): id, name, type, category, url, refresh_interval_seconds, last_fetch_at, last_error, error_count, active, sitemap_url, link_pattern, favicon_url, favicon_path, `custom_headers: Optional[dict] = None` (:44), `auto_disabled: bool` (:52, read off ORM property models.py:102-121), `net_vote_score: int = 0` (:62, assigned post-validate in sources.py:398-403). `from_attributes=True` (:64). **No field says whether a row is a built-in** — the frontend hardcodes that (FeedManager.tsx:108-119).
- `SourceCreate` (schemas.py:67-114): name, type="rss", category, url, refresh_interval_seconds=3600, sitemap_url=None, link_pattern=None, custom_headers=None.
- `SourceAutoRequest` (schemas.py:117-127): url, category="other". `SourceAutoResult` (:130-143): found, kind, source.
- `SourceUpdate` (schemas.py:146-189): ALL Optional, default None: refresh_interval_seconds, active, category, name, url, sitemap_url, link_pattern, custom_headers. Docstring at :186-189 says `{}` clears custom_headers and None leaves untouched — route layer actually uses `model_fields_set`, see §3.
- `SourceTestRequest` (schemas.py:192-209): name=None, type="rss", **category="news"** (:207), url, custom_headers=None. `SourceTestResult` (:212-257): ok, status_code, item_count, sample_titles, error_kind enum (:229-241), error, resolved_url.
- Pydantic >= 2.7 (backend/pyproject.toml:13) — `model_fields_set` is available.

## 3. PATCH /api/sources/{id} semantics (sources.py:647-798 → scheduler.update_source scheduler.py:2267-2462)

Order of operations:
1. `session.get(Source, id)` → 404 "source not found" before any validation (sources.py:665-667).
2. `name` (if not None): `_validate_name` regex `^[a-z0-9_]{1,120}$` (:111, :212-217) → 422; `body.name in registered_plugin_names()` → 400 "name ... is reserved for a built-in source" (:681-685). Collision with another row → IntegrityError on commit → rollback → 409 "source name ... is already in use" (:786-795; unique constraint models.py:44).
3. `url` (if not None): Apple Podcasts resolution (:690-693) and YouTube resolution (:694-699), each → 422 on resolution error; then if `pre.type == "reddit"` → `_validate_reddit_url` rewrites to canonical `https://www.reddit.com/r/<slug>` (:704-705, :244-272) else `_validate_url` (:707, :220-241: scheme http/https → 422, missing netloc → 422, `check_url_safe` SSRF → 422 "url is not reachable (must be a public host)").
4. `sitemap_url`: sentinel. Default `scheduler._UNSET` (:722); only if `"sitemap_url" in body.model_fields_set` (:723): non-None → `_validate_url`; value passed (None = clear).
5. `link_pattern`: same sentinel (:732-748); must start with "/" and not contain "://" → 422 (:736-745).
6. `refresh_interval_seconds` (if not None): silently clamped to [60, 86400] (:118-119, :275-284, :749-750) — never 422.
7. `category` (if not None): `_validate_category` (:751-752) — see §4. **Passed to scheduler unstripped** (:779 `category=body.category`); stored verbatim at scheduler.py:2376-2377. `null` category = no-op (not a clear; column is NOT NULL, models.py:46).
8. `custom_headers`: default `scheduler._UNSET` (:753). Only if `"custom_headers" in body.model_fields_set` (:754): `null` → None; dict → `_validate_custom_headers` (:755-759), whose `return out or None` (:354) maps `{}` to None. So **omitted = untouched; `null` and `{}` both clear to NULL** (scheduler.py:2400-2403). Sentinel defined scheduler.py:75-81.
9. Built-in lock (:765-771): `pre.name in registered_plugin_names() and (body.name is not None or body.url is not None)` → 400 "built-in source ... cannot be renamed or re-URLed". Built-ins CAN be paused/re-categorized/refresh-changed/header-edited (comment :761-764). Registry (backend/app/sources/__init__.py:72-80): `cisa_kev` (cisa_kev.py:55), `github_releases` (github_releases.py:153), `hn_top` (hn.py:59), `nvd_recent` (nvd.py:74), `rfd_hot_deals` (rfd.py:177), `bbc_news` (rss.py:539), `wikipedia_on_this_day` (wikipedia_on_this_day.py:68). **Frontend `KNOWN_BUILT_INS` (FeedManager.tsx:108-115) omits `rfd_hot_deals`.**
10. `scheduler.update_source(...)` (sources.py:774-785; impl scheduler.py:2267-2462):
   - Early return with no commit if nothing changed (scheduler.py:2325-2364; headers compared by dict equality :2332-2334).
   - Applies fields (:2365-2416); reactivation resets error_count (:2373-2375); URL change nulls favicon columns (:2380-2397) and unlinks file post-commit (:2418-2430).
   - `session.commit()` (:2417). If `_scheduler is None` (tests) return (:2433-2434). Built-in rows: scheduler untouched (:2440-2442). `active is False` → remove job (:2444-2453). **Otherwise, ANY effective change (including category-only or headers-only) re-adds the dynamic job with `stagger=False` (:2455-2461) → `_add_or_replace_dynamic_job` sets `next_run_time = now` (scheduler.py:2101-2156, esp. :2120-2126, :2144) → an immediate ingest fires.**
11. Response: full `SourceOut.model_validate(row)` (sources.py:798). `net_vote_score` is NOT recomputed on PATCH/GET-by-id (only list endpoint sets it, :398-403) — PATCH response carries net_vote_score=0.
12. Not patchable at all: `type`, `source_weight` (models.py:77), `favicon_url/favicon_path` (models.py:82-83), `error_count`, `last_error`, `last_fetch_at` (not in SourceUpdate schemas.py:161-189).
13. No ETag/version/updated_at on Source (models.py:40-99: only `created_at` :96). Concurrent PATCHes are last-write-wins per field; each PATCH is one transaction.

## 4. Category validation `_validate_category` (sources.py:287-303)

- `stripped = value.strip()`; empty → 422 "category cannot be empty" (:288-290).
- `len(stripped) > 40` → 422 "category must be 40 characters or fewer" (`_CATEGORY_MAX = 40` :152; mirrors `String(40)` models.py:46).
- `stripped.lower() in _RESERVED_CATEGORY_NAMES` → 422 "category 'X' is reserved for a built-in column". Exact set: `{"saved", "for you"}` (:162), case-insensitive.
- Called from POST (:469), /auto (:608), PATCH (:752), discover (:1143). Only discover stores the stripped value (:1144); POST (:518), /auto (:617), PATCH (:779) store the raw string including surrounding whitespace.
- No case normalization anywhere: entries filter is `Source.category == category` (backend/app/routes/entries.py:366); App.tsx groups columns by raw string (App.tsx:753-764). "Tech" and "tech" are two different categories/columns.
- Validation on POST happens after name/url validation (sources.py:437-469).

## 5. custom_headers validation `_validate_custom_headers` (sources.py:306-354)

- `None` → None (:312-313).
- not a dict → 422 "custom_headers must be a JSON object" (:314-317) (pydantic already 422s a non-object since the field is `Optional[dict]`).
- `len > 20` → 422 "custom_headers may have at most 20 entries" (`_CUSTOM_HEADERS_MAX = 20` :192).
- Per entry: key or value not `str` → 422 "custom_headers keys and values must be strings" (:325-329).
- `k.lower()` in denylist → 422 "header 'K' cannot be overridden per-source" (:330-334). Denylist = `_HEADER_DENYLIST` `{"cookie", "authorization", "host"}` (:169) ∪ `_HEADER_DENYLIST_EXTRA` `{"x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "x-original-url", "x-rewrite-url"}` (:177-186); union `_HEADER_DENYLIST_ALL` (:187).
- `len(v) > 512` → 422 "header 'K' value exceeds 512 chars" (`_HEADER_VALUE_MAX = 512` :193).
- value matching `[^\t\x20-\x7e]` → 422 "header 'K' value contains disallowed characters (must be printable ASCII or tab)" (:208, :345-352).
- Keys stored verbatim (case preserved) (:353). **No key-format check**: empty string key, spaces, or non-token chars in a key are accepted (:325-334 only check type + denylist). Empty dict → None (:354).
- Same validator used by POST (:489), PATCH (:756), test (:969-973).

## 6. name / url validation

- `_NAME_RE = ^[a-z0-9_]{1,120}$` (sources.py:111), lowercase only; 422 message at :216. Display label derived by `sourceLabel` (frontend/src/lib/labels.ts:43-60: KNOWN_SOURCES map :10-18, `r_` → `r/`, `_yt` → " (YouTube)", TLD suffix). `categoryLabel` (labels.ts:64-68): returns unchanged if it contains a capital, else title-cases with ACRONYMS (:21-25) / MINOR (:28) handling.
- `_validate_url` (sources.py:220-241): urlparse ValueError → 422; scheme ∉ {http, https} → 422; no netloc → 422; `check_url_safe` false → 422 generic message (reason deliberately not echoed :235-240).
- Accepted types on POST: rss, reddit, podcast, youtube_channel, generic_scrape → else 400 (:461-468). Per-type default refresh: reddit 900 (:125), podcast 21600 (:132), youtube 21600 (:137), generic_scrape 7200 (:146), rss 3600 (:486).

## 7. Test endpoint POST /api/sources/test (sources.py:839-1068)

- Never persists; always HTTP 200 with `ok` false + `error_kind` on failure (no 4xx for validation).
- Unsupported type → `unsupported_type` (:867-875). Podcast/YouTube resolution → `resolved_url` populated (:884-892). Name (optional): regex failure reported as `error_kind="invalid_url"` (:899-907); reserved/collision → `name_conflict` (:909-926). URL → `invalid_url` (:931-951), SSRF → `invalid_url` with the raw reason (:957-964, unlike PATCH which hides it).
- **`category` is never validated in the test path** (no `_validate_category` call in :839-1068).
- `custom_headers`: validated with the same validator; a validation failure is reported as `error_kind="unknown"` (:968-980).
- Honors custom_headers: rss/podcast/youtube_channel → `fetch_rss(url, headers=headers)` (:988-995) YES. generic_scrape → `probe_generic_scrape(url)` NO (comment :1000-1004). reddit → `from app.sources.reddit import fetch_subreddit` then `fetch_subreddit(url, headers=headers)` (:1008-1009) — **`backend/app/sources/reddit.py` defines only `normalize_subreddit` (reddit.py:41; its imports at :28-32)**; the real `fetch_subreddit` lives in backend/app/reddit_client.py:677-679 with signature `(subreddit, listing="hot", limit=50)` — no `headers` kwarg. The ImportError is swallowed by `except Exception` (:1046-1057) → `error_kind="unknown"`. Reddit Test is therefore non-functional; nothing pins it (grep: only test_apple_podcasts.py:89-110 touch /api/sources/test, with rss URLs).
- Frontend caller: `api.testSource` (frontend/src/api.ts:389-400), body type includes custom_headers (:394).

## 8. Where the list of existing categories comes from

- Backend: nothing. `GET /api/sources` returns rows `order_by(Source.category, Source.name)` (sources.py:397) — the only server-side source of category names.
- Frontend App.tsx: `categoriesBySourceId` (App.tsx:723-726) → `byCategory` groups visible entries by source category, unknown → 'other' (:753-762) → `categories = Array.from(byCategory.keys()).sort()` (:764). This list contains only categories that currently have at least one visible entry; passed to Drawer (App.tsx:2803; Drawer.tsx:39, 393-400).
- FeedManager.tsx: hardcoded `CATEGORY_OPTIONS` (16 entries, :80-101) feeds the Add-custom `<select id="fm-category">` (:1723-1732) and the edit form's `<input type="text" list="feed-category-options">` + `<datalist>` (:605-618). Add-custom state default `'news'` (:1309); podcast/YouTube radio auto-switch category (:1594, :1609).
- FeedManager already receives `sources: Source[]` (FeedManager.tsx:41, :212; inner Props :303) → a picker can derive `new Set(sources.map(s => s.category))` with no backend change.

## 9. Which plugins actually use custom_headers (backend/app/sources/)

| Plugin | Uses custom_headers | Line |
|---|---|---|
| dynamic_rss.py (type rss) | yes: `fetch_rss(self.url, headers=self._source_row.custom_headers)` | dynamic_rss.py:71 |
| podcast.py | yes, same call | podcast.py:43 |
| youtube.py | yes, same call | youtube.py:42 |
| generic_scrape.py | yes: reads row (:391), passes to `_extract_one(url, custom_headers=...)` (:475) → `fetch_html(url, custom_headers=...)` (:137) → merge in backend/app/article_extract.py:60-62, 98-99 | |
| dynamic_reddit.py | **no**: `reddit_client.fetch_subreddit(sub, listing="hot", limit=50)` (dynamic_reddit.py:171), no headers kwarg exists (reddit_client.py:677-679) | |
| built-ins cisa_kev.py:64, nvd.py:99, hn.py:67, wikipedia_on_this_day.py:79, github_releases.py:56-90, bbc (rss.py `_RssPlugin`) | **no**, static `_DEFAULT_HEADERS` | |
- Merge semantics: `{**_DEFAULT_HEADERS, **(headers or {})}` (rss.py:376); keys sent verbatim.
- Frontend hides the headers textarea only for built-ins (FeedManager.tsx:630) — shows it for reddit rows where it has no effect.

## 10. Current frontend editor contract usage (for reference)

- Row: tap toggles `open` (FeedManager.tsx:684-691, 788); controls include pause/resume → immediate `api.updateSource(id, {active})` (:386-396), `edit` button → `onStartEdit` (:798-805), refresh `<select>` → immediate `api.updateSource(id, {refresh_interval_seconds})` (:398-409, :824-837). So autosave-on-change already exists for `active` and `refresh`.
- Edit form (:567-681): name input (:577-585, disabled for builtIn), url (:589-596), category text input + datalist (:605-618), headers JSON `<textarea>` with live parse (:452-499, :635-643), tiny text `save` button disabled when JSON invalid (:657-663), `cancel` (:664-670). `saveEdit` (:508-565) diffs each field, trims name/url/category (:544-546), sends only changed fields, sends `null` to clear headers (:541-547), calls `onRefresh()` then `onRenamed` (:549-559).
- Errors: `jsonFetch` attaches `detail` to `ApiError` (frontend/src/api.ts:264-287); `parseApiError` renders string or pydantic list detail (FeedManager.tsx:190-210).
- `api.updateSource` body type (api.ts:424-443): refresh_interval_seconds, active, category, name, url, custom_headers — **omits sitemap_url and link_pattern** even though PATCH accepts them. `Source.custom_headers: Record<string,string> | null` (api.ts:135).

## 11. Existing backend tests that pin behaviour

- backend/tests/test_source_patch_unset_regression.py: POST persists sitemap_url/link_pattern/custom_headers (:46-52); PATCH `{category:"tech"}` leaves those three untouched (:55-73); PATCH `{sitemap_url:null}` clears only sitemap_url (:76-92); new sitemap_url applied (:95-105). Fixture `_create_generic_scrape` (:29-43) with `custom_headers: {"X-Test-Header": "1"}`.
- backend/tests/test_reserved_category_names.py: POST 422 for Saved/saved/SAVED/For You/for you/FOR YOU (:19-30); POST accepts "tech" (:33-44); PATCH `{category:"For You"}` → 422 (:47-64).
- backend/tests/test_b1_b8_coverage_gaps.py B4 (:217-320): source-text guards that generic_scrape `_extract_one` has a `custom_headers` kwarg and passes `custom_headers=custom_headers` to fetch_html (:221-248), plugin `fetch` passes `custom_headers=self.custom_headers` (:251-269), `__init__` reads it from the row (:272-283), `article_extract.fetch_html` accepts and merges it (:285-320).
- backend/tests/test_source_create_sitemap_link_pattern.py: SourceCreate fields (:54), add_source signature (:80), row assignment (:100), sitemap_url validated (:132), bad link_pattern rejected (:154), api.createSource body type (:183); **FeedManager.tsx source-text guards**: `setSitemapUrl`/`setLinkPattern` + `onChange={(e) => setSitemapUrl` / `setLinkPattern` (:199-220), literal `{sourceType === 'generic_scrape' && (` (:227-240), `sitemap_url: ` and `link_pattern: ` present (:247-280).
- backend/tests/test_frontend_slice15_add_generic_scrape.py (:68-341): FeedManager/api.ts source-text guards (SourceType union, 5th radio, labels/placeholders, `api.testSource` body type union :325-341).
- backend/tests/test_apple_podcasts.py:89-110: /api/sources/test wiring (resolution error surfaced; ordinary URL unaffected).
- backend/tests/test_feed_autodiscovery.py:299-404: /api/sources/auto (invalid/unsafe URL 422, rss vs generic_scrape creation, not-found, name dedupe).
- backend/tests/test_builtin_source_deletion.py:25, :57; test_source_vote_scores.py:18-80 (net_vote_score on GET /api/sources); test_trigger_now_accepts_dynamic_sources.py:66-255 (ingest endpoint); test_frontend_slice19_empty_column_source_status.py (Column/App source-text guards, :54-171).
- Fixtures: conftest.py:188 `db_session`, :198 `app_client` (httpx ASGITransport, no lifespan → `_scheduler is None`, so update_source returns at scheduler.py:2433-2434 without job rebuild). Source-text guards use `@pytest.mark.no_db` (backend/tests/README.md).
- **Not pinned by any test** (grep hits none): header denylist / 20-entry cap / 512-char cap / CRLF rejection; category empty / >40; name regex 422; built-in rename 400; name collision 409; refresh clamp; test-endpoint custom_headers; reddit test path.

## 12. Backend change needed?

- **Category picker: none required.** Derive options from `sources` (GET /api/sources, sources.py:393-404). Client must mirror: trim (FeedManager already trims :546), non-empty, ≤40, not case-insensitively "saved"/"for you" (sources.py:162). Optional backend nicety: strip before store at sources.py:518/617/779 so a picker's "new category" can't persist leading/trailing spaces; optional lower-casing is a behaviour change (entries.py:366 compares raw).
- **Autosaving editor: none required**, with two operational caveats. (a) Every effective PATCH on an active dynamic row triggers an immediate ingest (scheduler.py:2455-2461, 2144) → debounce / save on blur, not per keystroke; a no-change PATCH is a cheap early return without commit (scheduler.py:2353-2364). (b) `name` per keystroke would 422 (regex, sources.py:111) or 409 (collision, :786-795) → validate client-side and send name/url only on blur/commit. Per-field bodies are safe because omitted fields are no-ops (sentinel for custom_headers/sitemap_url/link_pattern :722-759; `is not None` for the rest :674-752). PATCH returns the full row (:798) so the UI can update local state from the response instead of re-fetching the list (response net_vote_score is 0, :398-403 only on list). No concurrency token exists (models.py:40-99).
- **Key/value headers editor: none required.** Backend already takes `Record<string,string>`; send `null` or `{}` to clear (sources.py:354, :755-759). Client should drop blank-key rows (backend accepts `""` keys, :325-334), mirror the denylist (:169, :177-186), 20-entry cap (:192), 512-char value cap (:193), printable-ASCII rule (:208); 422 `detail` strings are already surfaced by parseApiError (FeedManager.tsx:190-210). Hide the editor for `type === 'reddit'` and built-ins since those plugins ignore it (dynamic_reddit.py:171; §9).
- Optional backend fixes surfaced by this read: reddit test import (sources.py:1008 vs reddit.py:41); `SourceOut` has no `builtin` flag so the frontend hardcodes KNOWN_BUILT_INS and is missing `rfd_hot_deals` (FeedManager.tsx:108-115 vs rfd.py:177) — adding `builtin: bool` to SourceOut (schemas.py:12-64, computed from `registered_plugin_names()` at sources.py:401) would remove the duplication; `api.updateSource` body type lacks sitemap_url/link_pattern (api.ts:426-437).

#### Constraints
- PATCH omitted-vs-null: custom_headers/sitemap_url/link_pattern use body.model_fields_set + scheduler._UNSET; omitted = untouched, null = clear, {} = clear for headers (backend/app/routes/sources.py:722-759, :354; backend/app/scheduler.py:75-81, :2400-2416); pinned by backend/tests/test_source_patch_unset_regression.py:55-105
- Reserved category names {'saved','for you'} rejected case-insensitively with 422 on POST/PATCH/auto/discover (backend/app/routes/sources.py:162, :299-303); pinned by backend/tests/test_reserved_category_names.py:19-64
- Category must be non-empty after strip and <= 40 chars (backend/app/routes/sources.py:152, :287-298; column String(40) backend/app/models.py:46); stored value is NOT stripped or lower-cased on POST/PATCH/auto (sources.py:518, :617, :779) and category matching is case-sensitive (backend/app/routes/entries.py:366; frontend/src/App.tsx:753-764)
- custom_headers: flat str->str map, <= 20 entries, value <= 512 chars, printable ASCII + tab only, keys case-insensitively not in {cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url}; empty dict stored as NULL (backend/app/routes/sources.py:169-193, :208, :306-354)
- Source name must match ^[a-z0-9_]{1,120}$ (backend/app/routes/sources.py:111, :212-217); built-in rows (cisa_kev, github_releases, hn_top, nvd_recent, rfd_hot_deals, bbc_news, wikipedia_on_this_day — backend/app/sources/__init__.py:72-80) reject name/url PATCH with 400 (sources.py:765-771) and names colliding with the registry are 400 (sources.py:681-685); name collision with another row is 409 (sources.py:786-795)
- Every effective PATCH on an active dynamic row re-adds the scheduler job with stagger=False, i.e. an immediate ingest fires (backend/app/scheduler.py:2455-2461, :2101-2156 esp. :2120-2126 and :2144); a no-change PATCH early-returns without commit (scheduler.py:2353-2364)
- refresh_interval_seconds is silently clamped to [60, 86400], never 422 (backend/app/routes/sources.py:118-119, :275-284, :749-750)
- custom_headers is honored only by rss/podcast/youtube_channel (fetch_rss merge) and generic_scrape plugins (backend/app/sources/dynamic_rss.py:71, podcast.py:43, youtube.py:42, generic_scrape.py:391/:475, rss.py:376); reddit (dynamic_reddit.py:171) and all built-ins ignore it; the test endpoint honors it for rss/podcast/youtube only (sources.py:988-1009)
- No categories endpoint and no Category table; the only server-side list is GET /api/sources ordered by category,name (backend/app/routes/sources.py:393-404; backend/app/models.py:40-99)
- Write routes (POST/PATCH/DELETE/test/auto/discover) are gated by _write_deps = require_user when OIDC is on (backend/app/routes/sources.py:62)
- Backend source-text guard tests grep frontend/src/components/FeedManager.tsx and frontend/src/api.ts for literal strings: setSitemapUrl/setLinkPattern/onChange={(e) => setSitemapUrl, '{sourceType === \'generic_scrape\' && (', 'sitemap_url: ', 'link_pattern: ' (backend/tests/test_source_create_sitemap_link_pattern.py:199-280) and the SourceType union / testSource body type union (backend/tests/test_frontend_slice15_add_generic_scrape.py:68-341); a FeedManager rewrite must keep these or update the tests
- PATCH response is the full SourceOut row (backend/app/routes/sources.py:798) but net_vote_score is only populated by the list endpoint (sources.py:398-403); there is no version/ETag field on Source (backend/app/models.py:40-99) so concurrent PATCHes are last-write-wins per field
- app_client test fixture runs without lifespan so _scheduler is None and scheduler.update_source returns before any job rebuild (backend/tests/conftest.py:198-215; backend/app/scheduler.py:2433-2434)

#### Findings
- [high] backend/app/routes/sources.py:1008: Test endpoint imports `fetch_subreddit` from `app.sources.reddit`, but that module only defines `normalize_subreddit` (backend/app/sources/reddit.py:41); the real `fetch_subreddit` is in backend/app/reddit_client.py:677 and takes no `headers` kwarg. The ImportError is swallowed by `except Exception` at :1046-1057, so Test for reddit sources always returns error_kind='unknown'. Fix: Change the reddit branch to `from app.reddit_client import fetch_subreddit` and call `fetch_subreddit(normalize_subreddit(url), listing='hot', limit=50)` (drop the headers kwarg); add a test under backend/tests hitting POST /api/sources/test with type='reddit'.
- [high] backend/app/sources/dynamic_reddit.py:171: Reddit rows store custom_headers (PATCH accepts them) but the live fetch calls `reddit_client.fetch_subreddit(sub, listing='hot', limit=50)` with no headers, so the override is silently ignored; the frontend only hides the headers editor for built-ins (frontend/src/components/FeedManager.tsx:630). Fix: In the new editor, hide or disable the headers section when `source.type === 'reddit'` (and for built-ins), or thread headers through reddit_client.fetch_subreddit.
- [high] backend/app/scheduler.py:2461: Any effective PATCH on an active dynamic row (including a category-only or headers-only change) calls `_add_or_replace_dynamic_job(stagger=False)`, which sets `next_run_time=now` (scheduler.py:2144) and fires an immediate ingest. An autosaving editor that PATCHes per keystroke would trigger a fetch per keystroke. Fix: Frontend: debounce text fields and PATCH on blur/commit (select-style fields like category can PATCH on change). Optional backend: skip the job rebuild when only `category` or `custom_headers` changed and no fetch-affecting field changed.
- [high] backend/app/routes/sources.py:779: `_validate_category` checks the stripped value (:288-303) but POST (:518), /auto (:617) and PATCH (:779) persist `body.category` unstripped; only discover strips (:1144). A category picker that lets the user type a new name could persist ' tech ' as a distinct column (case-sensitive compare at backend/app/routes/entries.py:366, App.tsx:753-764). Fix: Strip (and decide on a case policy) once in the route before passing to scheduler.add_source/update_source, or have `_validate_category` return the normalized string and use it; frontend already trims (FeedManager.tsx:546).
- [high] frontend/src/components/FeedManager.tsx:108: `KNOWN_BUILT_INS` lists 6 names but the backend registry has 7 (`rfd_hot_deals`, backend/app/sources/rfd.py:177; registry backend/app/sources/__init__.py:72-80). The editor would allow a rename/re-URL of rfd_hot_deals that the backend rejects with 400 (sources.py:765-771). SourceOut has no built-in flag (backend/app/schemas.py:12-64). Fix: Add `builtin: bool` to SourceOut computed from `registered_plugin_names()` in list/get/patch responses, and have the frontend read `source.builtin` instead of a hardcoded set; or at minimum add 'rfd_hot_deals' to KNOWN_BUILT_INS.
- [medium] backend/app/routes/sources.py:325: `_validate_custom_headers` only checks key type and denylist; an empty-string key or a key with spaces is accepted and stored, then sent to httpx at fetch time (rss.py:376/393). Fix: Frontend key/value editor must drop rows with blank keys before sending; optionally reject keys not matching an RFC 7230 token regex server-side.
- [medium] backend/app/routes/sources.py:839: `_test_source_impl` never calls `_validate_category` (SourceTestRequest.category defaults to 'news', backend/app/schemas.py:207), so a Test can pass with a category that Add will then reject with 422. Fix: Call `_validate_category(body.category)` in the test impl and map failures to an error_kind (e.g. 'invalid_category'), or drop the field from SourceTestRequest since it is unused by the fetch.
- [high] frontend/src/api.ts:426: `api.updateSource` body type omits `sitemap_url` and `link_pattern` although PATCH accepts both with explicit-null clear semantics (sources.py:722-748); the current edit form cannot edit them. Fix: Add `sitemap_url?: string | null` and `link_pattern?: string | null` to the updateSource body type if the new editor exposes them for generic_scrape rows.
- [high] backend/tests/test_source_create_sitemap_link_pattern.py:199: Three tests here (:199-280) and backend/tests/test_frontend_slice15_add_generic_scrape.py (:68-341) are regex guards over FeedManager.tsx/api.ts source text (literal `{sourceType === 'generic_scrape' && (`, `onChange={(e) => setSitemapUrl`, etc.). A FeedManager rewrite will fail them unless the strings survive or the tests are updated. Fix: When rewriting FeedManager, either keep the literal patterns or update/migrate these guard tests in the same PR.
- [high] backend/app/routes/sources.py:306: No backend test covers the header denylist, 20-entry cap, 512-char cap, CRLF/printable-ASCII rule, category empty/>40, name-regex 422, built-in rename 400, collision 409, or refresh clamp (grep of backend/tests for the 422 messages returns nothing). Fix: Add route-level tests via `app_client` (backend/tests/conftest.py:198) alongside the editor redesign so the contract the new UI relies on is pinned.

### Frontend iPhone-class defect audit (complaint 6): viewport/keyboard, safe areas, native dialogs, tap targets, hover-only info, overflow/scroll chaining, inputs, truncation, swipe/touch-action, PWA/standalone, orientation

# iPhone-class defect audit — frontend @ origin/main (0c7af06, includes PR #12)

Repo: /home/user/popping. Files read: frontend/index.html, frontend/src/styles.css, frontend/tailwind.config.js, frontend/public/manifest.webmanifest, frontend/src/main.tsx, frontend/vite.config.ts, frontend/src/App.tsx, every file in frontend/src/components/, frontend/src/api.ts (safeExternalUrl), git show 9823be6 (PR #8) and 002ff64 (PR #11). Tailwind 3.4 / React 18.3 / Vite 5 (frontend/package.json).

## 0. Layout facts the rest depends on

- Shell is a non-scrolling flex column: `html, body, #root { height: 100% }` (frontend/src/styles.css:17), root div `h-full flex flex-col isolate` with inline `minHeight: '100dvh'` (frontend/src/App.tsx:2188, 2200). Header is `sticky top-0 z-20` (App.tsx:2210) but on phones the document never scrolls; the phone column is an inner scroller `flex-1 min-h-0 overflow-y-auto` (App.tsx:2721) inside `<main className="md:hidden …">` (App.tsx:2655). Desktop grid is `hidden md:grid` (App.tsx:2594).
- Breakpoints are Tailwind defaults (no `screens` in frontend/tailwind.config.js:9-121): sm=640, md=768. `md:` is the phone/desktop switch.
- Only two overlay containers use `fixed`: Drawer backdrop/aside (frontend/src/components/Drawer.tsx:252, 286), Settings backdrop (Settings.tsx:189) with an `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)]` sheet (Settings.tsx:204), ShortcutsSheet (ShortcutsSheet.tsx:70), Toast (Toast.tsx:256), Card context-menu DOM nodes (Card.tsx:1829, 1844), the React splash (App.tsx:2117), and the wallpaper (styles.css:87).
- Swipe surfaces use `.touch-pan-y-zoom { touch-action: pan-y pinch-zoom }` (styles.css:11-13) on the card article (Card.tsx:890) and the Drawer aside (Drawer.tsx:286).

## 1. Already handled well (do not redo)

| What | Where |
|---|---|
| `viewport-fit=cover`, `width=device-width, initial-scale=1`, no `maximum-scale` (zoom stays enabled) | frontend/index.html:5 |
| Home-screen app meta + manifest + icons (PR #8) | index.html:15-21, frontend/public/manifest.webmanifest:1-15 |
| `black-translucent` status bar + header `pt-[env(safe-area-inset-top)]` + `theme-color #000` | index.html:17, 7; App.tsx:2210 |
| Bottom safe area on page, Settings body, Toast; top+bottom on Drawer; top on Settings sheet | styles.css:20; Settings.tsx:263; Toast.tsx:256; Drawer.tsx:288; Settings.tsx:204 |
| Focus-zoom fix: `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }` (PR #11). Verified no inline `font-size` on any form control (only App.tsx:2148 on a `<p>`), no `contenteditable` anywhere. | styles.css:24-26 |
| Settings sheet no longer uses vh (pinned by top edge, PR #11); Shortcuts uses `max-h-[80dvh]`; root uses `100dvh` | Settings.tsx:204; ShortcutsSheet.tsx:79; App.tsx:2188 |
| Horizontal page pan killed at the root: `html, body { overflow-x: clip }` + `overflow-wrap: break-word`; column scroller and desktop main are `overflow-x-clip`; search list too | styles.css:36, 39; Column.tsx:489; App.tsx:2594; SearchResults.tsx:78 |
| Swipe handlers: direction lock + dead zone, non-passive native `touchmove` with `preventDefault` only once dragging, `touch-action: pan-y pinch-zoom` on the surface, interactive children opt out via `stopPropagation` / `data-card-interactive` | Card.tsx:287-290, 554-656, 1244, 570 |
| Pre-React black splash and inline black backgrounds (no white flash) | index.html:46-86; App.tsx:2117-2125 |
| 44×44 nav-bar icon buttons (search, refresh, gear, hamburger) | App.tsx:2290, 2301, 2311; Hamburger.tsx:16 |
| Card action icons 40px (PR #8), vote pills `h-10` | Card.tsx:1254, 1281, 1324, 1368, 1396, 1431 |
| Summary chevron hover-reveal has a touch fallback `[@media(hover:none)]:opacity-100` | Card.tsx:1328 |
| Tap highlight suppressed by Tailwind preflight (`-webkit-tap-highlight-color: transparent`) and `active:` states on most buttons | frontend/node_modules/tailwindcss/src/css/preflight.css:39 |
| 350ms click delay: removed by `width=device-width`; double-tap zoom disabled on cards by `pan-y pinch-zoom` | index.html:5; styles.css:12 |
| Inline two-tap confirm already used instead of `window.confirm` for feed delete and preset delete | FeedManager.tsx:378-386 (comment), 903-919; App.tsx:282-299 |
| Auth probe failure path still renders the app (no infinite splash offline); visibility-aware polling resumes on app switch | App.tsx:1211-1224, 1268 |
| `prefers-reduced-motion` respected for splash and wallpaper | styles.css:72-77, 185-189 |
| Dark `color-scheme` so native selects/pickers/alerts render dark | index.html:6, 48; styles.css:21 |
| External links use `target=_blank` + `rel=noopener noreferrer` / `window.open(..., 'noopener,noreferrer')`; in an iOS home-screen app these open in the in-app browser overlay rather than leaving the app | Card.tsx:908, 981, 994, 1055, 1062, 1151, 1159, 1707; Settings.tsx:1158, 1434 |

## 2. Findings (grouped; each with what the user sees, fix, confidence)

### A. Keyboard vs. fixed overlays

A1. **Settings sheet does not react to the iOS keyboard.** Settings.tsx:189 (`fixed inset-0`), :204 (sheet `bottom-0` on the layout viewport), :263 (body scroller `pb-[calc(2rem+env(safe-area-inset-bottom))]`). iOS does not shrink the layout viewport for the keyboard; it pans the *visual* viewport. User sees: tap the category/name/URL field in Feeds → the sheet's "Done" header slides off the top; the lower ~40% of the scroller (the tiny `save` link FeedManager.tsx:658-663, the Test/Add buttons FeedManager.tsx:1788-1805) is under the keyboard and cannot be scrolled to until the keyboard is dismissed; after dismissal the sheet can stay offset until the next scroll. Fix: in Settings, subscribe to `window.visualViewport` `resize`/`scroll`, set the sheet's `height` (or `bottom`) from `visualViewport.height + visualViewport.offsetTop`, and/or add a `--keyboard-inset` padding-bottom to the body scroller; on `focusin` call `scrollIntoView({ block: 'center' })` on the field. Same mechanism covers every form inside Settings (FeedManager edit form, AddCustomTab, LLM section). Confidence: medium-high.

A2. **Root height chain mixes `100%` and `100dvh`.** styles.css:17 (`height: 100%` on html/body/#root) + App.tsx:2188 (`minHeight: '100dvh'`). In Safari tab mode (not home-screen) the ICB is the small viewport, so once the toolbar collapses `100dvh` > `100%` and the document overflows by the toolbar height → a "double scroll" (page nudges, then the inner column scrolls). No effect in standalone. Fix: drop the `minHeight: '100dvh'` (the 100% chain already equals the visible height) or make the whole chain `100dvh`. Confidence: medium.

### B. Safe areas (landscape / sides)

B1. Header pads top only; `px-4` on the title row (App.tsx:2210, 2220). In landscape with `viewport-fit=cover` the left/right insets are ~59px on notched phones: the large title or the hamburger sits under the notch/corner. Fix: `pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]` on the header, the phone `<main p-3>` (App.tsx:2655) and the tab strip (App.tsx:2672). Confidence: medium (landscape only; see F1 for why landscape currently flips layouts).
B2. Drawer is right-anchored with only top/bottom insets (Drawer.tsx:286-288); Settings sheet `inset-x-0` (Settings.tsx:204). Add `pr-[env(safe-area-inset-right)]` / `px` insets. Confidence: medium-low.
B3. Card context menu clamps to `window.innerWidth/innerHeight` ignoring insets (Card.tsx:1832-1835) — desktop-only in practice (`contextmenu` never fires on iPhone), ignore.

### C. Native prompt()/confirm() in a standalone app

C1. `window.prompt` for "Rename this view" (App.tsx:306) and "Name this view" from the Drawer's Save-current-view row (App.tsx:2826-2832, wired at Drawer.tsx:366-376). `window.confirm` for Clear local state (Settings.tsx:413). User sees: a system alert titled with the server hostname, light-styled, breaking the black UI; `prompt()` in iOS home-screen apps has a history of not presenting/returning reliably. The repo already documents why it moved away from `window.confirm` (FeedManager.tsx:378-386) and has inline confirm patterns (App.tsx:282-299). Fix: inline text field in the Drawer row / chip, inline two-tap confirm on Reset. Confidence: high that these are native dialogs; medium on iOS breakage severity.

### D. Tap targets under 44px (iOS HIG) — user sees mis-taps / taps that do nothing

- App.tsx:2246-2258 search clear ✕: 16px icon, no padding. Fix `w-11 h-11 -mr-2`.
- App.tsx:2403-2413 error banner ✕: bare glyph.
- App.tsx:2380-2393 source-filter chips `py-0.5` (~26px) and `clear all` text link.
- App.tsx:282-299, 304-346, 355-374 PresetChip: Yes/No, Rename/Update/Delete/✕, chip and ⋯ all `py-0.5 text-ios-caption` (~26px).
- Drawer.tsx:318 Done `min-h-[32px]`; Settings.tsx:215 Done `min-h-[32px]`; ShortcutsSheet.tsx:93 close 32px; Drawer.tsx:420-426 "Clear" text only.
- Column.tsx:393 prefs ⋯ `w-8 h-8` (32px); Column.tsx:349 "+N new" chip `py-0.5`; Column.tsx:693 section header `min-h-[28px]`.
- FeedManager.tsx row controls when a row is open: edit (:801-807), interval `<select>` `py-0.5` (:825-831), interval button (:837-845), cancel (:849-856), fetch (:869-891), delete (:893-901), confirm delete (:903-912), cancel (:913-920) — all text-only `text-ios-caption` (~18px tall) in a `gap-y-1` wrap row; only pause has `min-h-[36px]` (:793). Edit-form save/cancel (:658-671) — this is complaint 3's "tiny save link".
- FeedManager.tsx:1072 "find more feeds" and :1123 "Add" `min-h-[28px]`; :1280 "Track this URL anyway" 32px.
- Settings.tsx:349-359 Retry text; :763-768 LLM Edit/Cancel `px-2` no height; :828-834 "type a name instead"; :904-913 API-key "clear"; :1230, 1238 History group pills `min-h-[28px]`; :1403-1410 bulk "Restore all"/"Clear all" text; :1447-1454 per-row Restore/Unsave text (`self-center`, ~18px tall).
- BriefCard.tsx:312 tone pills `min-h-[28px]`.
- Card.tsx inline text actions "Discussed on Reddit" (:976-1004), "Summarize comments" (:1007-1019), "Listen" (:1041-1072), "Summarize episode" (:1078-1090), "Related coverage" (:1121-1135): `inline-flex text-ios-caption` ~18px tall, 6px apart.
- Card action icons are 40px (Card.tsx:1324, 1368, 1396, 1431) and vote pills `h-10` (1254, 1281) — PR #8 chose 40; acceptable, 44 is the HIG number.
Fix pattern: a shared `min-h-[44px] min-w-[44px]` (or `py-2.5 px-3`) utility for text actions; negative margins where the row must stay compact. Confidence: high (sizes are read directly from classes).

### E. Hover-only / tooltip-only information with no touch equivalent

E1. **Column header is a silent "mark all read" trap.** Column.tsx:319-325: the whole header row is `role=button` with `onClick={onHeaderClick}` → `onMarkRead` (Column.tsx:276-280); the only explanation is `title="tap to mark this column read"` (Column.tsx:324), invisible on iPhone. User sees: tapping the category name/count (e.g. to scroll to top) dims every card. Fix: on touch, make mark-all-read an explicit labelled control (text button or an item in the ⋯ popover) and make the header static. Confidence: high.
E2. **Feed failure reasons exist only in `title` tooltips.** FeedManager.tsx:723-733 (auto-disabled reason), :740-754 (`⚠ N` with `last_error`), :705-713 (stale explanation), :843-848 (last fetch local time). User sees "⚠ 144" and can never read why. Fix: render `last_error` as a caption line under the row (and in the editor). Confidence: high.
E3. Other tooltip-only hints: FeedManager.tsx:677-683 (`⚠ favicon resets`), :922-929 (built-in), :1282 (track anyway), :1604-1606 / :1688-1690 / :1705-1707 (scrape field help); App.tsx:356, 367 (preset chip hints); BriefCard.tsx:306 (`title={t.hint}`). Fix: inline helper text or drop. Confidence: high.
E4. Hidden/Saved empty-state copy tells iPhone users to "Right-click a card … (or press h/b)" (Settings.tsx:1526, 1598). Fix: touch wording ("tap the eye / star on a card"). Confidence: high.
E5. `onContextMenu` card menu (Card.tsx:708-806, 879) and preset chip right-click (App.tsx:357) never fire on iPhone — equivalents exist (buttons, ⋯), so informational only.

### F. Orientation / breakpoints

F1. **Rotating a modern iPhone switches to the desktop layout.** Phone/desktop is gated on `md:` = 768px (App.tsx:2594 `hidden md:grid`, :2655 `md:hidden`, :2420 `hidden md:block` BriefCard, :2493 For You row, FramingWatch.tsx:175). iPhone 12–16 landscape widths are 812–932 CSS px ≥ 768, so the user gets the multi-column grid (min 280px columns), inline Brief, For You row and Framing Watch stacked above columns in a ~390px-tall viewport; the tab UI and Brief tab disappear; `sm:` (640) also shows the desktop sub-row (App.tsx:2336-2362) and hides the mobile refresh icon (:2300). Fix: define the phone layout by a hook/media query that also considers height or pointer (e.g. custom screen `md: { raw: '(min-width: 768px) and (min-height: 560px)' }` in tailwind.config.js, or `(pointer: coarse) and (max-height: 500px)` → phone), and keep B1 insets. Note the manifest has no `orientation` key (manifest.webmanifest:1-15) and iOS ignores it anyway. Confidence: medium-high (CSS arithmetic; UX severity judged, not measured).

### G. Scroll chaining / body lock

G1. No `overscroll-behavior` anywhere (grep across src: none). Scrollers: Drawer nav (Drawer.tsx:334), Settings body (Settings.tsx:263), Shortcuts card (ShortcutsSheet.tsx:79), phone column (App.tsx:2721), Column list (Column.tsx:489). User sees: reaching the end of the Settings list rubber-bands the whole shell behind the dim backdrop; a fast flick in the Drawer bounces the dashboard. Fix: `overscroll-y-contain` on every scroller; `html, body { overscroll-behavior-y: none }` in styles.css base. Confidence: medium-high.
G2. Horizontal strips (App.tsx:2369 filter chips, :2672 tab strip, :230 preset strip, Settings.tsx:244 tab strip) have no visual cue that they scroll (iOS hides scrollbars). Fix: right-edge fade mask or snap. Confidence: medium (UX, not a bug).
G3. `z-15` on the error banner (App.tsx:2401) is not a generated class (no `zIndex` in tailwind.config.js) → no z-index. Harmless on phones (shell doesn't scroll); use `z-10`. Confidence: high.

### H. Inputs and the iOS keyboard

H1. **Auto-capitalisation breaks lowercase-only fields.** iOS capitalises the first letter of `type="text"` inputs by default. LoginPage.tsx:72-78 username (no `autoCapitalize="none"`) → "Adam" → sign-in fails; FeedManager.tsx:1532-1538 feed name (rule "lowercase letters, digits, underscore" at :1540); :1655-1661 subreddit when `type='text'`; edit-form name/category :577-583, :605-611 (capitalised "News" ≠ stored "news" — worsens complaint 2); AutoFeed URL box is `type="text"` (:1245-1257) → capitalised/auto-corrected URL and no URL keyboard. Fix: `autoCapitalize="none" autoCorrect="off" spellCheck={false}` on all of these; `type="url"`/`inputMode="url"` on URL boxes; `enterKeyHint` where Enter submits (:1249). Confidence: high.
H2. **Native `<select>`s look like text boxes.** iOS draws no chevron; with the custom box classes (Settings.tsx:779, 812, 855; Column.tsx:423, 471; FeedManager.tsx:825-831, 1727, 1740) the picker is indistinguishable from an input (complaint 7). Fix: one `select` style with `appearance-none` + inline-SVG chevron background + `pr-8`. Confidence: medium.
H3. **Category `datalist` is invisible on iPhone.** FeedManager.tsx:605-616 uses `list="feed-category-options"`; iOS surfaces datalist only as QuickType suggestions, which the owner reads as "no list" (complaint 2, owner-confirmed). Fix: reuse the `<select>` from AddCustomTab (:1723-1733) sourced from existing categories + an "Add new…" row. Confidence: high.
H4. `type="search"` (App.tsx:2235) renders iOS's own cancel (x) inside the field next to the custom ClearIcon (:2246-2258); Tailwind preflight sets `-webkit-appearance: textfield` but does not hide `::-webkit-search-cancel-button` (preflight.css:245-256). Fix: `[&::-webkit-search-cancel-button]:appearance-none`. Confidence: medium.
H5. Programmatic focus: `autoFocus` (App.tsx:2237; FeedManager.tsx:583) runs inside React 18's synchronous discrete-event commit so the keyboard opens; the `requestAnimationFrame(() => focus())` fallback (App.tsx:2270-2273) is outside the gesture and is a no-op on iOS. Harmless. Confidence: medium.
H6. Focus-zoom rule uses `pointer: coarse` (styles.css:24); an iPad with a trackpad/keyboard may report a fine pointer and fall back to <16px fields. Use `any-pointer: coarse` or apply 16px unconditionally. Confidence: low-medium.

### I. Truncation that hides needed information on 390px

I1. Toast message `truncate` (Toast.tsx:261) inside `max-w-[min(90vw,420px)]` (:259): error toasts (`${source.name}: ${r.error}` FeedManager.tsx:872) and "Saved for later — see the Saved column." are cut to one line. Fix: `line-clamp-2 break-words`. Confidence: high.
I2. Hidden/Saved rows title `truncate` (Settings.tsx:1436) — can't tell which article; History uses `line-clamp-2` (:1168). Confidence: high.
I3. Feed row name `truncate` beside four `shrink-0` chips (FeedManager.tsx:695-770) → on 390px with "auto-disabled ⚠ 144 −3" the name collapses to a few letters. Fix: second line for status chips. Confidence: medium-high.
I4. LLM backend/model names `truncate` (Settings.tsx:748-752); long `<option>` labels with `recommended_note` (:822-826) on the iOS picker wheel. Low.

### J. Tiny text (HIG floor 11pt)

9px: Card.tsx:1174 (tone chip), SourceIcon.tsx:68 (decorative, fine). 10px: FeedManager.tsx:598 (built-in note), :645 (the headers-JSON **error** message), :650, :1114 (chip); App.tsx:2709 (badge). 11px: FeedManager.tsx:576, 588, 604, 632 (field labels), :712 (category), :784 (freshness line), :1111; Card.tsx:1171. Fix: `text-ios-caption` (13px) for anything the user must read; keep 10px only for decorative badges. Confidence: high.

### K. Swipe / touch-action / gesture conflicts

K1. **Card swipe lags the finger.** `applySwipeVisual(dx, false)` sets `el.style.transition = ''` (Card.tsx:513) which lets the class `transition-[transform,box-shadow,border-color,opacity,filter] duration-200` (Card.tsx:892) apply during the drag → every `touchmove` retargets a 200ms transition; the comment at :506-510 promises 1:1 tracking. Fix: `el.style.transition = animate ? 'transform 180ms ease-out' : 'none'`. Confidence: high.
K2. **Long-press copy fights iOS's own long-press.** Title is a real `<a>` (Card.tsx:906-916); the article arms a 500ms copy timer on any non-interactive touch (:267, :585-593); no `-webkit-touch-callout: none` or `select-none` on the article (grep: none). User sees: holding the headline shows iOS's link preview sheet while a "link copied" toast fires underneath; holding body text starts the selection magnifier. Fix: drop the long-press copy on touch (the native link callout already offers Copy/Share), or add `[-webkit-touch-callout:none] select-none` to the article. Confidence: medium-high.
K3. Column prefs popover closes on document `mousedown` (Column.tsx:237-246). iOS only synthesises mouse events for taps on "clickable" elements, so a tap on empty column space does not close it. Fix: listen to `pointerdown`/`touchstart` as well. Confidence: medium.
K4. **Drawer "Jump to column" is dead on iPhone.** `jumpToCategory` (App.tsx:2022-2030) scrolls `columnRefs`, attached only in the desktop `hidden md:grid` main (App.tsx:2598); the phone view uses `mobileCol` (App.tsx:2699) which it never sets. User sees: tap a category in the menu → menu closes, nothing happens. Fix: `setMobileCol(idx)` when the phone layout is active, or hide the section on phones. Confidence: high.
K5. touch-action is correctly scoped; no horizontal scroller contains a card, so no conflict between the swipe lock and the tab/chip strips (App.tsx:2672, :2369). Verified, nothing to do.

### L. PWA / standalone specifics

L1. OIDC login is a top-level navigation out of scope (`<a href={api.loginUrl(returnTo)}>` LoginPage.tsx:52-57). From the home-screen app this opens in the in-app browser whose cookies are not shared with the standalone WebView, so the callback may not establish the session (classic iOS PWA OIDC pitfall). Only matters if OIDC is used from the home screen; local login is unaffected. Confidence: medium.
L2. Settings open/close both `pushState` (App.tsx:433-444): in Safari tab mode each open+close adds two history entries; standalone has no back control so harmless. Use `history.back()` on Done when the previous entry was the dashboard. Confidence: high (behaviour), low (impact).
L3. Thumbnail is a `div role=button` calling `window.open` (Card.tsx:1690-1760) — no native long-press "Open/Share" callout a real `<a>` gives. Low.
L4. No service worker/offline (vite.config.ts:49-76 has no PWA plugin); launching offline shows the dashboard with the last poll failing — acceptable; informational.

### M. Duplicated chrome (complaint 5, data only)

Gear (App.tsx:2305-2330) + Hamburger (App.tsx:2333, Hamburger.tsx:11-34) + Drawer "All settings…" row (Drawer.tsx:377-390). Drawer also carries History (:336-351) and Save current view (:366-376), both of which also live in Settings tabs / the preset strip.

## 3. Priorities for the plan

1. K1, K4, E1, H1, I1 — cheap, high-confidence, user-visible today.
2. A1 (keyboard-aware Settings sheet), G1 (overscroll), D (44px pass), H2/H3 (select chevron + category select) — these also carry complaints 2, 3, 7.
3. F1 (landscape breakpoint) + B1/B2 (side insets) together.
4. C1 (remove native dialogs), E2–E4, J (text sizes), I2–I3, H4, K2, K3.
5. L1/L2/A2 as follow-ups.

#### Constraints
- Keep `viewport-fit=cover` and no `maximum-scale` in the viewport meta (frontend/index.html:5); the header/Drawer/Settings/Toast/#root safe-area padding depends on it (App.tsx:2210, Drawer.tsx:288, Settings.tsx:204, Toast.tsx:256, styles.css:20).
- Keep the 16px coarse-pointer rule for input/textarea/select (frontend/src/styles.css:24-26); any new control must be a real input/textarea/select or carry its own >=16px font-size or iOS will zoom on focus.
- The phone shell is a non-scrolling 100% height flex column with an inner `overflow-y-auto` scroller (styles.css:17; App.tsx:2200, 2655, 2721); new phone surfaces must live inside that scroller or be their own scroller — the document must not become the scroller or card swipes will pan the page (styles.css:28-36).
- `.touch-pan-y-zoom` (styles.css:11-13) must stay on the card article (Card.tsx:890) and Drawer aside (Drawer.tsx:286); any ancestor of cards must not be a horizontal scroll container (comment Card.tsx:880-889; Column.tsx:489 `overflow-x-clip`).
- Card interactive children must keep `data-card-interactive` and/or `onTouchStart={e => e.stopPropagation()}` (Card.tsx:570, 1244) so taps on them never arm the swipe/long-press paths.
- Settings is URL-driven (`?view=settings&tab=…`): App.tsx:390-444 and the tab strip's `replaceState` + synthetic `popstate` (Settings.tsx:233-243); a new editor route/sheet must go through `openSettings`/`closeSettings` or extend the tab allow-list (App.tsx:415-426).
- Phone/desktop split is Tailwind `md:` (768px) in App.tsx:2420, 2493, 2594, 2655 and FramingWatch.tsx:175; changing the breakpoint must change all of them together (tailwind.config.js has no `screens` override, lines 9-121).
- Toast is a singleton imperative API `toast(message, kind | {kind, action})` (Toast.tsx:187-207, 256-281) used from Card/FeedManager/App; keep the signature.
- Inline two-tap confirm is the established destructive-action pattern (FeedManager.tsx:378-386, 903-919; App.tsx:282-299); do not reintroduce window.confirm.
- Category values are free strings on the backend (`category: editCategory.trim()` FeedManager.tsx:548; CATEGORY_OPTIONS list at FeedManager.tsx:80); `categoryLabel()` from lib/labels.ts is the display mapping (Column.tsx:333, FeedManager.tsx:712) — a picker must still allow a brand-new category string.
- custom_headers PATCH contract is `Record<string,string> | null` (FeedManager.tsx:537-549); a key/value header editor must serialise to that and send `null` to clear.
- Tailwind z-order ladder: header z-20 (App.tsx:2210), Column popover z-20 (Column.tsx:411), Drawer z-30/z-40 (Drawer.tsx:252, 286), ShortcutsSheet z-40 (ShortcutsSheet.tsx:70), Settings z-50 (Settings.tsx:189), Toast z-50 (Toast.tsx:256), context menu z-40/z-50 (Card.tsx:1829, 1844); only z-0/10/20/30/40/50 exist (`z-15` at App.tsx:2401 is a no-op).
- Pre-React splash lives inside #root and is replaced on mount (index.html:89-98); keep the inline black backgrounds (index.html:47, App.tsx:2117-2125, 2188) when restyling the shell.
- Card keyboard shortcuts target buttons via `data-mark-read`, `data-star`, `data-eye`, `data-new-chip`, `data-column-action`, `data-section-header` (Card.tsx:1360, 1388, 1420; Column.tsx:343, 385, 690); keep these attributes if buttons are restyled.

#### Findings
- [high] frontend/src/components/Card.tsx:513: applySwipeVisual sets `el.style.transition = ''` during the drag, so the class `transition-[transform,...] duration-200` (line 892) applies on every touchmove and the card trails the finger by a 200ms eased transition instead of tracking 1:1. Fix: Use `el.style.transition = animate ? 'transform 180ms ease-out' : 'none'` so the drag is untransitioned and only the release snap animates.
- [high] frontend/src/App.tsx:2022: Drawer 'Jump to column' calls jumpToCategory, which scrolls columnRefs that are only attached inside the desktop `hidden md:grid` main (line 2598); the phone view keys off `mobileCol` (line 2699) which is never set, so on an iPhone the menu item closes the Drawer and does nothing. Fix: In jumpToCategory, when the phone layout is active (matchMedia('(max-width: 767px)') or a shared isPhone hook) call setMobileCol(idx) and scroll the inner column scroller to top; otherwise hide the section on phones.
- [high] frontend/src/components/Column.tsx:319: The whole column header row is role=button and any tap fires onMarkRead (lines 276-280); the only hint is `title="tap to mark this column read"` (line 324), invisible on touch, so tapping the category name or count on an iPhone silently marks every card read. Fix: Make the header static on touch and expose mark-all-read as an explicit labelled control (text button in the header or an item in the ⋯ popover).
- [medium] frontend/src/components/Settings.tsx:204: Settings sheet is anchored to the layout viewport (`fixed inset-0` backdrop line 189, sheet `bottom-0`) with no visualViewport handling; iOS does not shrink the layout viewport for the keyboard, so focusing a Feeds field pans the Done header off-screen and leaves the bottom of the scroller (the save link FeedManager.tsx:658, Test/Add FeedManager.tsx:1788-1805) unreachable until the keyboard is dismissed. Fix: Subscribe to window.visualViewport resize/scroll in Settings; set the sheet height/bottom from visualViewport.height + offsetTop (or add a --keyboard-inset to the body scroller's padding-bottom) and scrollIntoView({block:'center'}) the focused field on focusin.
- [high] frontend/src/components/LoginPage.tsx:72: Username input is type=text without autoCapitalize/autoCorrect; iOS capitalises the first letter so 'adam' is typed as 'Adam' and local sign-in fails. Fix: Add autoCapitalize="none" autoCorrect="off" spellCheck={false} (and enterKeyHint="go").
- [high] frontend/src/components/FeedManager.tsx:1532: Feed name input (rule 'lowercase letters, digits, underscore' at line 1540), subreddit input (line 1655, type=text), AutoFeed URL input (line 1245, type=text) and the edit-form name/category inputs (lines 577, 605) have no autoCapitalize/autoCorrect; iOS capitalises and autocorrects them, producing invalid names, 'News' vs 'news' category mismatches and mangled URLs with no URL keyboard. Fix: Add autoCapitalize="none" autoCorrect="off" spellCheck={false} to all of them; use type="url"/inputMode="url" for the AutoFeed box; add enterKeyHint where Enter submits (line 1249).
- [high] frontend/src/components/FeedManager.tsx:605: Category editor is a text input backed by a <datalist>; iOS shows datalist entries only as QuickType-bar hints, so on the owner's iPhone it reads as a blank text box with no list (complaint 2, owner-confirmed). Fix: Replace with a <select> built from the existing categories (CATEGORY_OPTIONS line 80 plus categories present in `sources`) with an 'Add new…' option that reveals a text field; reuse the select from AddCustomTab (lines 1723-1733).
- [high] frontend/src/components/FeedManager.tsx:740: A feed's last_error is only exposed in `title` tooltips (lines 723-733 auto-disabled, 740-754 the ⚠ N chip, 705-713 stale, 843-848 last fetch time); on an iPhone the user sees '⚠ 144' and can never read why the feed is failing. Fix: Render last_error as a caption line under the row when it is open (and inside the editor), and show the stale/last-fetch text inline; drop the tooltips.
- [high] frontend/src/components/FeedManager.tsx:801: Row controls edit/interval/cancel/fetch/delete/confirm (lines 801-920) and the edit-form save/cancel (lines 658-671) are text-only `text-ios-caption` buttons ~18px tall in a gap-y-1 wrap row; only pause has min-h-[36px] (line 793). Well under the 44px HIG target → mis-taps (and complaint 3's 'tiny save link'). Fix: Give every action min-h-[44px] (py-2.5 px-3, negative margins if needed) or convert the open-row controls to 44px grouped rows; make Save a full-width primary button or remove it via autosave.
- [medium] frontend/src/App.tsx:2594: Phone/desktop switch is `md:` (768px). iPhone 12–16 landscape widths are 812–932 CSS px, so rotating the phone swaps in the desktop multi-column grid, inline Brief (line 2420), For You row (2493) and Framing Watch (FramingWatch.tsx:175) in a ~390px-tall viewport, and `sm:` (640) shows the desktop sub-row (2336-2362) while hiding the mobile refresh icon (2300). Fix: Gate the phone layout on a media query that also considers height/pointer (e.g. custom `md: { raw: '(min-width: 768px) and (min-height: 560px)' }` in tailwind.config.js, or a shared isPhone hook using `(pointer: coarse) and (max-height: 500px)`), applied to every md:/sm: layout switch listed.
- [medium] frontend/src/components/Drawer.tsx:334: No overscroll-behavior anywhere (Drawer nav here, Settings body Settings.tsx:263, Shortcuts card ShortcutsSheet.tsx:79, phone column App.tsx:2721, Column list Column.tsx:489): reaching the end of a sheet's list rubber-bands the whole shell behind the backdrop. Fix: Add `overscroll-y-contain` to each scroller and `html, body { overscroll-behavior-y: none }` in styles.css @layer base.
- [high] frontend/src/App.tsx:2826: window.prompt is used for naming a saved view (here) and renaming it (line 306); window.confirm for Clear local state (Settings.tsx:413). In the home-screen app these are system alerts titled with the hostname, un-themed, and prompt() is unreliable in iOS standalone WebViews; the repo already dropped window.confirm elsewhere for this reason (FeedManager.tsx:378-386). Fix: Inline name field in the Drawer row and the preset chip's action row; inline two-tap confirm for Reset (pattern at App.tsx:282-299 / FeedManager.tsx:903-919).
- [high] frontend/src/components/Toast.tsx:261: Toast message is `truncate` inside max-w-[min(90vw,420px)] (line 259); error toasts such as `${source.name}: ${r.error}` (FeedManager.tsx:872) and 'Saved for later — see the Saved column.' are cut to one line on a 390px phone, hiding the message. Fix: Replace truncate with `line-clamp-2 break-words` (or line-clamp-3 for kind==='error').
- [medium] frontend/src/components/Settings.tsx:779: Native <select>s (here, 812, 855; Column.tsx:423, 471; FeedManager.tsx:825, 1727, 1740) render on iOS with no chevron; with the custom bg/border box they look identical to text inputs, so the user cannot tell they are dropdowns (complaint 7). Fix: One shared select style: appearance-none + inline SVG chevron via background-image + pr-8, min-h-[44px].
- [medium] frontend/src/components/Card.tsx:585: Long-press on a card arms a 500ms copy-URL timer (LONG_PRESS_MS line 267) while the title is a real <a> (906-916) and the article has no -webkit-touch-callout:none / select-none; on iPhone a held headline shows iOS's link-preview sheet while a 'link copied' toast fires underneath, and holding body text starts the selection magnifier. Fix: Drop the long-press copy on touch (the native link callout already offers Copy/Share) or add `[-webkit-touch-callout:none] select-none` to the article and gate the timer on hover-capable devices.
- [medium] frontend/src/App.tsx:2210: Header pads only the top safe-area inset; title row uses px-4 (line 2220), the phone <main> uses p-3 (2655) and the Drawer is right-anchored with top/bottom insets only (Drawer.tsx:286-288). In landscape with viewport-fit=cover the notch/corner insets (~59px) overlap the title, hamburger and Drawer content. Fix: Use pl-[max(1rem,env(safe-area-inset-left))] / pr-[max(1rem,env(safe-area-inset-right))] on the header, phone main, tab strip, Drawer and Settings sheet.
- [medium] frontend/src/components/Column.tsx:237: Column prefs popover closes on document `mousedown`; iOS only synthesises mouse events for taps on clickable elements, so a tap on empty column space does not dismiss it (and there is no Esc on a phone). Fix: Also listen for pointerdown/touchstart on document, or render a transparent backdrop while open.
- [high] frontend/src/App.tsx:282: PresetChip buttons (Yes/No 282-299, Rename/Update/Delete/✕ 304-346, chip and ⋯ 355-374), filter chips and 'clear all' (2380-2393), search clear ✕ (2246-2258), error dismiss ✕ (2403-2413) are 16–26px tall tap targets. Fix: min-h-[44px]/min-w-[44px] (w-11 h-11 for the ✕ icons with negative margins) across these controls.
- [high] frontend/src/components/Settings.tsx:1447: Per-row Restore/Unsave (1447-1454), bulk Restore all/Clear all (1403-1410), Retry (349-359), LLM Edit/Cancel (763-768), 'type a name instead' (828-834), API-key clear (904-913), History pills min-h-[28px] (1230, 1238), Done min-h-[32px] (215) are all under 44px; Drawer Done (Drawer.tsx:318) and Shortcuts close (ShortcutsSheet.tsx:93) likewise. Fix: Apply the shared 44px action style; Done buttons w-auto min-h-[44px] px-3.
- [high] frontend/src/components/Card.tsx:976: Inline text actions 'Discussed on Reddit' (976-1004), 'Summarize comments' (1007-1019), 'Listen' (1041-1072), 'Summarize episode' (1078-1090), 'Related coverage' (1121-1135) are inline-flex text-ios-caption rows ~18px tall, 6px apart. Fix: Give them min-h-[44px] -my-3 (or pill buttons with py-2.5) so adjacent actions are not mis-tapped.
- [high] frontend/src/components/FeedManager.tsx:645: Text at 10px (645 headers-JSON error message, 598, 650, 1114; App.tsx:2709) and 11px (576, 588, 604, 632 field labels, 712 category, 784 freshness line, 1111; Card.tsx:1171) and 9px (Card.tsx:1174) is below the iOS 11pt floor; the headers error is the only explanation of why Save is disabled. Fix: Raise anything the user must read to text-ios-caption (13px); keep 10px only for decorative badges.
- [high] frontend/src/components/Settings.tsx:1526: Hidden and Saved empty-state copy instructs 'Right-click a card … (or press h/b)' (1526, 1598) — desktop-only instructions shown on the phone where neither right-click nor keys exist. Fix: Touch wording: 'Tap the eye / star on a card, or swipe it left'.
- [high] frontend/src/components/Settings.tsx:1436: Hidden/Saved list titles are single-line `truncate`, so on a phone the user cannot tell which article a row is; History already uses line-clamp-2 (line 1168). Fix: Use line-clamp-2 on the title.
- [medium] frontend/src/components/FeedManager.tsx:697: Feed row name is `truncate` beside four shrink-0 chips (category 712, auto-disabled/paused 723-735, ⚠ N 740-754, net vote 760-770); on 390px a failing feed's name collapses to a few characters. Fix: Move status chips to a second caption line under the name; keep only the chevron on the title line.
- [medium] frontend/src/App.tsx:2235: Header search is type="search"; iOS renders its own cancel (x) inside the field next to the custom ClearIcon (2246-2258); Tailwind preflight sets -webkit-appearance:textfield but does not hide ::-webkit-search-cancel-button (preflight.css:245-256). Fix: Add `[&::-webkit-search-cancel-button]:appearance-none` to the input (or use type=text with inputMode=search).
- [medium] frontend/src/App.tsx:2188: Root div has inline minHeight:'100dvh' while html/body/#root are height:100% (styles.css:17); in Safari tab mode the ICB is the small viewport, so when the toolbar collapses the root overflows by the toolbar height and the page gets a second scroll range on top of the inner column scroller. No effect in the home-screen app. Fix: Remove minHeight:'100dvh' (the 100% chain already matches the visible height) or move the whole chain to 100dvh.
- [high] frontend/src/App.tsx:2401: `z-15` is not a generated Tailwind class (no zIndex extension in tailwind.config.js), so the sticky error banner has no z-index; on phones the shell does not scroll so sticky is moot anyway. Fix: Use z-10.
- [low] frontend/src/components/LoginPage.tsx:52: OIDC sign-in is a top-level navigation out of the PWA scope; from the home-screen app iOS opens it in the in-app browser whose cookies are not shared with the standalone WebView, so the callback may not establish the session (known iOS PWA OIDC pitfall). Local login is unaffected. Fix: If OIDC is used from the home screen, document it or move the IdP round-trip to a popup-less same-window flow with a cookie set by the backend on the callback; otherwise leave as is.
- [medium] frontend/src/components/Card.tsx:1690: Thumbnail is a div role=button that calls window.open; unlike the title <a> it has no native long-press Open/Share callout on iOS. Fix: Render the thumbnail wrapper as an <a href target=_blank rel=noopener noreferrer> with the same click recording.
- [high] frontend/src/App.tsx:433: openSettings and closeSettings both pushState, so in Safari tab mode each open+close adds two history entries; harmless in standalone (no back control). Fix: On Done, history.back() when the previous entry is the dashboard (track via history.state), else pushState.
- [low] frontend/src/styles.css:24: Focus-zoom guard is scoped to `pointer: coarse`; an iPad with a trackpad/keyboard can report a fine primary pointer and fall back to <16px fields. Fix: Use `@media (any-pointer: coarse)` or apply font-size:16px to form controls unconditionally.

### Frontend ease-of-use audit beyond the feed editor (complaint 7): pickers vs free text, autosave vs save links, destructive actions and confirmations, touch-invisible affordances, developer-facing labels, button/placement consistency, tap depth, empty/loading/error states. Read at origin/main 0c7af06 (includes PR #12).

# Ease-of-use audit — whole frontend (origin/main 0c7af06)

Files read in full: frontend/src/App.tsx (2986 lines), components/{BriefCard,Card,Column,Drawer,FeedManager,FramingWatch,Hamburger,LoginPage,SearchResults,Settings,ShortcutsSheet,Skeleton,SourceIcon,Toast,UserBadge,Wallpaper}.tsx, lib/{labels,storage,interactions}.ts, lib/preferences.tsx (sync section 475-635), api.ts (jsonFetch 273-285, deleteSource 446-452), styles.css, index.html, tailwind.config.js, backend/app/routes/sources.py 283-306 + 745-760, REDESIGN_PLAN.md.

## A. Tap depth from the dashboard (iPhone, <768px layout)

| Task | Taps | Path (file:line) | Notes |
| --- | --- | --- | --- |
| Edit a feed | 4 + typing | gear App.tsx:2304-2330 → Feeds tab default Settings.tsx:264-272 / FeedManager.tsx:213 → tap row FeedManager.tsx:686-690 → "edit" :798-805 → "save" :657-663 | "save" is a 13px text link (`text-ios-caption`, :660); labels 11px (:576,:588,:604,:633) |
| Pause a feed | 3 | gear → row → "pause" FeedManager.tsx:790-797 | Saves immediately (:386-396); 13px text link |
| Change a feed's category | 5 + typing | gear → row → edit → category input FeedManager.tsx:605-613 → save | `<datalist>` :614-618 is not rendered as a picker on iOS Safari (only as keyboard QuickType suggestions); input autocapitalizes (see F3) |
| Change the LLM model | 6 | gear → "AI" tab Settings.tsx:229-258 → "Edit" :763-768 → Provider `<select>` :776-787 → Brief model :793-826 → "save" :928-934 | Free-text model name for Anthropic/OpenAI/Groq (:796-802); "Scoring model" :843-881 |
| Generate a brief | 2 | "Brief" tab App.tsx:2673-2688 → "Generate" BriefCard.tsx:583-590 | Alternative 3: gear → AI → "Generate brief now" Settings.tsx:319-327 |
| Mark a column read | 1 (hidden) | tap column header Column.tsx:314-321 | Only cue is `title="tap to mark this column read"` :320 (desktop hover only). No visible button anywhere on mobile |
| Filter by one source | 2 | hamburger App.tsx:2333 → checkbox Drawer.tsx:457-479 | |
| Add a feed by URL | 4 + typing | gear → "Add custom" FeedManager.tsx:233-235 → Auto feed input :1245-1258 → "Auto-add" :1259-1266 | |
| Sign out | unreachable on phone | UserBadge only inside `hidden sm:flex` row App.tsx:2341-2363 | |

## B. Findings ranked by how often a normal user hits them

Full list with fixes and confidence is in `findings`. Summary of the top tier:

1. **A toast every minute.** `refresh()` (App.tsx:1057) ends with `toast(... 'refreshed')` at App.tsx:1112; the same `refresh` is what the 60 s poll calls (App.tsx:1245-1249) and the visibility handler. Every poll pops a 1.5 s toast (Toast.tsx:93) at the bottom of the phone.
2. **Feed-manager errors are shown behind the Settings sheet.** FeedManager reports every failure via `onError` (FeedManager.tsx:392, 405, 422, 561, 881, 995, 1022, 1057, 1198, 1228, 1430, 1473) → Settings passes it straight through (Settings.tsx:269, 398) → App `setError` (App.tsx:2839) → red banner rendered in the page flow at App.tsx:2396-2410. The Settings overlay is `fixed inset-0 z-50` (Settings.tsx:189) and the mobile sheet covers the page from `top + 0.75rem` (Settings.tsx:204-205). On the phone the banner is invisible until Settings closes; form validation messages ("name is required", FeedManager.tsx:1371-1374 → :1430) go the same way. Toast renders after Settings (App.tsx:2894, Toast.tsx:117 z-50) so toasts do show.
3. **Typing a category on the phone creates a duplicate column.** Category is a bare `type="text"` input (FeedManager.tsx:605-613) with no `autoCapitalize="none"` (no component in the tree sets `autoCapitalize`/`autoCorrect`; the only `inputMode` is the search box App.tsx:2236). iOS capitalizes the first letter of plain text inputs; the backend validator keeps case (sources.py:287-302, only `.lower()` for the reserved-name check) and columns are keyed by raw category (App.tsx:757-767); `categoryLabel` title-cases for display (labels.ts:64-68), so "news" and "News" become two columns both labelled "News".
4. **Column header tap = mark everything read, with no visible control.** Column.tsx:314-321 makes the whole header a `role="button"` whose only label is a desktop tooltip (:320). The "+N new" chip (Column.tsx:341-357) looks like a counter but its click is `onRefresh()` (:350) → `refresh` → "refreshed" toast; the count does not change because `lastViewed` is untouched. Mobile tab badges (App.tsx:2690-2710) are cleared only by this hidden header tap.
5. **Drawer "Jump to column" does nothing on the phone.** `jumpToCategory` (App.tsx:2022-2031) sets `selectedColumnIndex` and calls `scrollIntoView` on a ref that only the desktop grid registers (App.tsx:2594-2600, inside `hidden md:grid`); it never calls `setMobileCol`. Drawer.tsx:393-409 shows the rows on every viewport and closes the drawer, so the tap closes the menu and nothing else.
6. **"Hide" toast says the entry moved to History; it actually vanishes.** `toggleHideEntry` toasts "Entry moved to history." (App.tsx:1615) but hidden ids are filtered out of every column by `visibleEntries` (App.tsx:748-751, `hiddenSet` :742) and reachable only in Settings → Hidden (Settings.tsx:374-380).
7. **Raw HTTP errors in user-facing surfaces.** `ApiError` message is `${status} ${statusText} for ${url}` (api.ts:284; deleteSource api.ts:451). Rendered verbatim: refresh banner + toast App.tsx:1114-1115; search SearchResults.tsx:81; login LoginPage.tsx:105; notifications Settings.tsx:336; LLM status/tags/save Settings.tsx:923, 926; history Settings.tsx:1099; hidden/saved/voted lists Settings.tsx:1416; brief failures (backend `status.error` passed through App.tsx triggerBriefGenerate → BriefCard.tsx:594, 785); column empty state shows `source.last_error` snippet Column.tsx:844-849; ingest toast FeedManager.tsx:871.
8. **Native browser dialogs.** `window.prompt` for preset rename (App.tsx:306) and "Save current view" (App.tsx:2826, Drawer.tsx:366-376); `window.confirm` for Clear local state (Settings.tsx:411-420). In a home-screen (standalone) web app these render as Safari system alerts, off-style, and `prompt` has a history of not displaying in standalone mode.
9. **Bulk destructive actions with no confirm and no Undo.** Saved → "Clear all" (Settings.tsx:1403-1411 → App.tsx:2860-2864: `setStarredEntries([])`, plain toast); Voted → "Hide all downvoted" (App.tsx:2876-2887); Hidden → "Restore all" (benign). Feed delete has inline two-tap confirm (FeedManager.tsx:894-921) but no Undo and the backend deletion is permanent (FeedManager.tsx:5-10).
10. **Add custom feed asks the user to invent a slug.** Name field placeholder `my_blog`, help "lowercase letters, digits, underscore" (FeedManager.tsx:1531-1542); validator regex `^[a-z0-9_]{1,120}$` (:1372-1374). `nameError`/`urlError` are computed (:1399-1424) and only used to disable Test/Add (:1792, :1799); they are never rendered, so the buttons are greyed out with no reason shown (the comment at :1395-1398 says inline, no JSX does it).
11. **History tab prints "◯ with strike" as text.** Settings.tsx:1165 renders the literal string `'◯ with strike'` as the row icon for hidden items; the empty-state copy repeats it (:1110).
12. **Desktop-only instructions on the phone.** Hidden tab hint "Right-click a card → Hide this entry (or press h)" (Settings.tsx:1526), Saved "Right-click a card → Save for later (or press b)" (:1598), Voted "right-click → Downvote" (:1683). The context menu exists only on `onContextMenu` (Card.tsx:708-808, bound :879); long-press on touch copies the URL instead (Card.tsx:585-593).
13. **Brief tab first-run header likely clips the Generate button.** No-brief expanded header is `flex items-center gap-3` with no wrap (BriefCard.tsx:562) holding a 44 px chevron (:566), the TonePicker with three 17 px `shrink-0` pills (:297-324, :578-582) and a `shrink-0` Generate button (:583-590); the with-brief header uses `flex-wrap` (:673). `html, body { overflow-x: clip }` (styles.css:36) hides the overflow. Estimated fixed width ≈ 400 px vs 375/390 px phones. Medium confidence (font metrics not measured).
14. **AI settings are developer-shaped.** "set provider in env or pick one below" (Settings.tsx:759), provider option "Default" meaning the .env value (:781), free-text model names with placeholder "empty = this provider's default" (:796-802, :847-853), "Scoring model" (:843), "type a name instead" (:833), lowercase full-width "save" (:928-934), explicit save with no autosave. Brief tone is in-memory only (App.tsx:457), resets on reload. Notifications tab: "set APPRISE_URL or PUSHOVER_* in .env, then restart the backend" (:361-366), "Set the URL in .env on the host" (:368-371).
15. **Missing iOS keyboard hints on URL/name fields.** Auto-feed URL is `type="text"` (FeedManager.tsx:1245-1258) → sentence-case autocapitalize + autocorrect while pasting/typing a URL; subreddit field `type="text"` (:1655-1672); add-custom name (:1532-1539) and edit name (:577-585) require lowercase but autocapitalize; login username (LoginPage.tsx:72-78). Only the URL inputs with `type="url"` (:589-596, :1657, :1692-1699) are exempt.

## C. Free-text inputs where a picker fits

| Location | Current | Better |
| --- | --- | --- |
| FeedManager.tsx:605-618 edit category | text + datalist | select/segmented from existing categories + "New…" |
| FeedManager.tsx:635-643 custom headers | JSON textarea, `font-mono`, parse errors "invalid JSON" / "must be a flat {"Header": "value"} map" (:493, :497) | key/value rows; preset "Pretend to be a browser" (User-Agent) since that is the only real use (:626-628) |
| FeedManager.tsx:1532-1542 add-custom name | slug text | derive from feed title/host (AutoFeedBlock already does: :1179-1186); show display name |
| Settings.tsx:796-802, 847-853 model names | free text | `<select>` of known models per provider; free text only behind "Other…" |
| Column.tsx:434-456 "Min score" | 0-100 range slider over an internal score | remove or relabel ("Only top stories" toggle) |
| App.tsx:306, 2826 preset names | `window.prompt` | inline text field in the chip strip / sheet |

## D. Explicit save where autosave is expected

- FeedManager.tsx:657-669 edit form "save"/"cancel" 13 px links; contrasted with the refresh-interval `<select>` right next to it that saves on change (:824-837) and the pause link that saves on tap (:386-396).
- Settings.tsx:928-934 LLM "save"; API keys text at :886-890 explains that typed keys are lost unless save is tapped but clear is immediate (:696-714).
- Brief tone (Settings.tsx:292-317, BriefCard.tsx:287-324) is never persisted (App.tsx:457).

## E. Actions invisible on touch

- Mark column read: Column.tsx:314-321 (tooltip only).
- Context menu (Mark read / Hide / Save / vote / Copy link / Open): Card.tsx:708-808, right-click only. Long-press is "copy link" (Card.tsx:585-593) with no visible hint; `title` tooltips carry the shortcut hints (Card.tsx:1326, 1364, 1392, 1427).
- Error details on feed rows live in `title` attributes only: "auto-disabled after N consecutive failures — last: …" (FeedManager.tsx:724-728), "⚠ N" (:744-755), net vote score (:765-775), stale explanation (:704-708), "built-in" explanation (:923-930), "⚠ favicon resets" (:671-678).
- Keyboard shortcuts sheet is `?` only (App.tsx ~1783 onward; ShortcutsSheet.tsx) — fine, desktop.
- Preset chip options need the "⋯" button (App.tsx:339-347) — present, OK.

## F. Developer-facing / stale labels (user-visible text)

- "Top (composite score)" Column.tsx:425; "Min score" :432.
- "re-enable from Feed Manager" Column.tsx:836 (no screen is called Feed Manager; it is Settings → Feeds, Settings.tsx:107).
- "the scheduler will fetch the first batch shortly" Column.tsx:824, App.tsx:2495.
- "built-in — url is bound to the plugin" FeedManager.tsx:599; "built-in source — url/name are locked to the plugin" :926; "fetch" as a button label :890; "auto-disabled" :730.
- "Add this URL as a generic_scrape source…" FeedManager.tsx:1281; "Sitemap URL" / "Link pattern" with `page_links` / `<a href>` tooltips :1688, :1705; type label "Track page (no RSS)" :1637; "no native feed found, tracking via periodic scraping instead" :1216.
- Recommended list shows raw slugs and raw categories (FeedManager.tsx:1110-1111) while My feeds uses `sourceLabel`/`categoryLabel` (:710, :712); Drawer source rows show raw `s.category` (Drawer.tsx:477).
- Settings tab labelled "Voted" lists only downvotes (Settings.tsx:113, 1627-1634); "Reset" as a top-level tab (:114); title "Settings → X" (:220).
- "(local bypass)" UserBadge.tsx:37; health line "N entries · N sources · ok" App.tsx:2344 (desktop).
- Card star tooltip "save for later (s)" (Card.tsx:1392) but the shortcut is `b` (App.tsx keyboard handler; ShortcutsSheet.tsx lists `s` as summary).

## G. Button styling and placement inconsistencies

- Save buttons: lowercase 13 px link (FeedManager.tsx:657-663) vs lowercase full-width blue (Settings.tsx:928-934) vs "Add feed" sentence case (FeedManager.tsx:1797-1803) vs "Auto-add" (:1259-1266).
- Tap targets under 44 px: FeedManager row links "edit"/"fetch"/"delete" have no min-height (:798-805, :865-891, :894-901; only "pause" has `min-h-[36px]` :793); Recommended "Add" `min-h-[28px]` (:1120-1127); "🔎 find more feeds" `min-h-[28px]` (:1069-1075); History group toggles `min-h-[28px]` (Settings.tsx:1227-1243); list row actions "Restore"/"Remove"/"Hide" 13 px no min-height (Settings.tsx:1448-1454); Settings/Drawer "Done" `min-h-[32px]` (Settings.tsx:215, Drawer.tsx:318); LLM "Edit"/"Cancel" no min-height (Settings.tsx:763-768); API-key "clear" (:906-914).
- "Done" sits on the left with the title on the right (Settings.tsx:211-222, Drawer.tsx:314-325); iOS puts Done on the trailing edge.
- Delete confirmation styles: inline "confirm delete / cancel" (FeedManager.tsx:903-921), inline "Delete? Yes/No" pill (App.tsx:244-262), native confirm (Settings.tsx:413), none (Settings.tsx:1403-1411).
- Two different hide semantics: eye button/swipe-left = hide + mark read (App.tsx:1594-1640), context-menu `onHide` = hide only (App.tsx:2452, 2558, 2612, 2749), with different toasts ("Entry moved to history." vs "Entry hidden.").

## H. Empty, loading, and error states

- First load: SkeletonGrid (App.tsx:2487-2491); empty: text at App.tsx:2494-2496.
- Column empty: Column.tsx:811-868 (context-aware; includes raw `last_error` :847).
- Search: "searching…" / "N for "q"" / "failed" (SearchResults.tsx:55-59, 81-85).
- Settings lists: "Loading…" (Settings.tsx:1419-1423), error (:1414-1418), empty hints (:1526, :1598, :1683 — desktop wording).
- History: "loading history…" (:1089-1095), error (:1096-1102), empty (:1103-1118).
- Recommended: "loading…" (FeedManager.tsx:1082-1089), empty (:1090-1099).
- LLM: "checking…" (Settings.tsx:741-745), "Couldn't check / tap to retry" (:731-740), "loading models…" (:919-921).
- Brief: "No brief generated yet" (BriefCard.tsx:532-534, 574-576); generating shows only "…" on the button (:546, :589, :654, :726).
- Preference sync failures are silent except in dev (preferences.tsx:527-531, 622-627); a lost mark-read/star is never reported.
- Toast: single slot, 1.5 s without action, 5 s with (Toast.tsx:93); messages truncate to one line (:120).

## I. iPhone-specific items found while reading (beyond complaint 6's known fixes)

- Mobile tab order shifts when the Saved column appears/disappears (App.tsx:835-845) while the persisted tab index is positional (App.tsx:1358-1366, storage.ts:52): starring the first item moves every tab right by one and the restored index lands on a different column.
- Search field expands to `w-44` (176 px) beside three 44 px buttons (App.tsx:2231, 2291-2333); the 34 px title truncates (:2222).
- Settings tab strip has 8 scrolling pills (Settings.tsx:228-259).
- `type="range"` slider inside the column popover (Column.tsx:434-456) is fiddly at phone size.
- Sign-out unreachable on phone (App.tsx:2341-2363).

## J. Things that are already right (do not regress)

- Refresh interval is a `<select>` that saves on change (FeedManager.tsx:824-837); category on Add custom is a `<select>` (:1723-1732); source type is radios (:1554-1639).
- Per-card actions have Undo toasts (App.tsx:1540-1562, 1594-1640, 1923-1975); column mark-read has Undo (:1954-1971).
- Delete source has inline two-tap confirm with auto-cancel (FeedManager.tsx:379-437).
- Card action buttons are always visible on touch (Card.tsx:1328 `[@media(hover:none)]:opacity-100`), 40 px targets (:1327, :1365, :1393, :1428), vote pills 40 px (:1260, :1287).
- Settings is URL state so the back button closes it (App.tsx:395-444).
- 16 px inputs on coarse pointers (styles.css:24-26), safe-area padding (index.html:5, styles.css:20, App.tsx:2217, Settings.tsx:204-205, 263, Drawer.tsx:288, Toast.tsx:117).

#### Constraints
- Settings tab identity is URL state: allow-list parse in frontend/src/App.tsx:395-428, pushState open/close in App.tsx:430-444, tab switch via replaceState + synthetic popstate in frontend/src/components/Settings.tsx:236-247; Drawer deep-links by tab id at frontend/src/components/Drawer.tsx:345 and :384. Any new/renamed tab must change all of these.
- Stacking order: Settings overlay z-50 (frontend/src/components/Settings.tsx:189); Drawer backdrop z-30 / panel z-40 (frontend/src/components/Drawer.tsx:252, 286); ShortcutsSheet z-40 (frontend/src/components/ShortcutsSheet.tsx:70); card context menu backdrop z-40 / menu z-50 (frontend/src/components/Card.tsx:1807, 1844); ToastHost z-50 rendered last in the tree (frontend/src/App.tsx:2894, frontend/src/components/Toast.tsx:117). Only toasts are visible above Settings; the App error banner (App.tsx:2396-2410) is not.
- Toast is a singleton with fixed timing: 1.5 s without an action, 5 s with (frontend/src/components/Toast.tsx:93); a new toast replaces the current one (Toast.tsx:48-52). Every Undo in the app depends on the action-toast form (App.tsx:1540-1562, 1594-1640, 1954-1971).
- Card and Column are memo-wrapped with custom comparators that ignore callback props: frontend/src/components/Card.tsx:1460-1475 and frontend/src/components/Column.tsx:881-909. Any new per-card or per-column data prop must be added to the comparator or the UI will not update.
- Any new interactive child inside a Card must carry data-card-interactive so swipe/long-press ignore it (frontend/src/components/Card.tsx:570-571, 607, 580-583); horizontal touch inside cards is owned by the non-passive touchmove swipe handler (Card.tsx:602-656) and touch-action pan-y pinch-zoom (frontend/src/styles.css:11-13).
- Any new control inside the BriefCard header must carry data-brief-action or the header click toggles collapse (frontend/src/components/BriefCard.tsx:434-440).
- Any new control inside the Column header must be inside popoverRef/prefsButtonRef or stopPropagation, otherwise its click marks the column read (frontend/src/components/Column.tsx:275-300, 314-321).
- Global single-key shortcuts (/ ? r m s b h, arrows, Enter) fire unless document.activeElement is an input, textarea, select or contentEditable (frontend/src/App.tsx:1754-1764). A custom picker built from divs/buttons that takes typing must blur-guard or these fire while 'typing'.
- Column names 'Saved' and 'For You' are reserved meta-columns on the client (frontend/src/App.tsx:835-845) and the backend rejects reserved category names (backend/app/routes/sources.py:287-302, _RESERVED_CATEGORY_NAMES). Category is case-sensitive and max 40 chars on the backend (sources.py:287-297); categories are keyed raw on the client (App.tsx:757-767) and title-cased only for display (frontend/src/lib/labels.ts:64-68).
- Source names are slugs used as identifiers: the active-source filter is a Set of names (frontend/src/App.tsx:1975-1987 toggleSource) remapped on rename via onSourceRenamed (App.tsx:1994-2004, FeedManager.tsx:549-556); sourceLabel/categoryLabel are display-only (frontend/src/lib/labels.ts:3-7). Add-custom lowercases and validates ^[a-z0-9_]{1,120}$ (FeedManager.tsx:1369-1374, 1435).
- Preference writes are optimistic, debounced 250 ms, fire-and-forget, failures silent outside dev (frontend/src/lib/preferences.tsx:506-535, 622-627); pagehide flush uses keepalive PUT (preferences.tsx:537-560).
- Mobile column position is a positional index persisted to localStorage (frontend/src/App.tsx:1358-1366, frontend/src/lib/storage.ts:52) and -1 means the Brief tab (App.tsx:2673-2688).
- FeedManager PATCH surface: api.updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? }) (frontend/src/api.ts:424-444); custom_headers is a flat string→string map, null clears (FeedManager.tsx:537-547); url/name are locked for KNOWN_BUILT_INS (FeedManager.tsx:108-119, 581, 593).
- All API errors throw ApiError with message `${status} ${statusText} for ${url}` and optional detail (frontend/src/api.ts:264-285); FeedManager.parseApiError (FeedManager.tsx:190-210) is the only place that unwraps FastAPI detail. deleteSource throws a plain Error (api.ts:446-452).
- FeedManager/HistoryTab errors flow through the onError prop to App.setError (Settings.tsx:269, 398; App.tsx:2839); there is no local error surface inside Settings for them.
- Hidden entries are removed from every column via visibleEntries (frontend/src/App.tsx:742-751) and visible only in Settings → Hidden (Settings.tsx:374-380); the eye button/swipe-left also marks read (App.tsx:1594-1640).
- On touch screens every input/textarea/select is forced to 16px !important (frontend/src/styles.css:24-26); html/body overflow-x: clip hides any horizontal overflow (styles.css:36). Mobile Settings sheet is pinned by its top edge with env(safe-area-inset-top), not a vh height (Settings.tsx:204-205).
- Desktop breakpoint is md (768 px): desktop grid App.tsx:2594, mobile main App.tsx:2655; sm (640 px) gates the header sub-row (App.tsx:2341) and BriefCard default collapse (BriefCard.tsx:372, 385).

#### Findings
- [high] frontend/src/App.tsx:1112: refresh() toasts 'refreshed' / 'N new since last refresh' on every run; the 60-second poll (App.tsx:1245-1249) and the visibilitychange handler call the same function, so a 1.5 s toast appears at the bottom of the phone every minute the app is open. Fix: Add a `{ manual }` argument (or a separate refreshManual wrapper) and only toast when the user tapped Refresh (App.tsx:2291-2299, 2351-2355), the column chip (Column.tsx:350) or pressed r; leave the poll silent.
- [high] frontend/src/App.tsx:2839: Every FeedManager error (save/delete/pause/add/validation; FeedManager.tsx:392, 405, 422, 561, 881, 1057, 1430, 1473) is passed via onError to App.setError and rendered as the in-flow banner at App.tsx:2396-2410, which the Settings overlay (fixed inset-0 z-50, Settings.tsx:189; mobile sheet from top+0.75rem, :204-205) covers. On the phone the user taps save, nothing visibly happens, and the error is only seen after closing Settings. Fix: Route Settings/FeedManager errors to toast(msg, 'error') (ToastHost renders above Settings, App.tsx:2894) or an inline error row under the form; keep the App banner for dashboard refresh failures only.
- [high] frontend/src/components/FeedManager.tsx:605: Edit-form category is a plain type="text" input with no autoCapitalize="none"; iOS capitalizes the first letter, the backend keeps case (backend/app/routes/sources.py:287-302), columns are keyed by raw category (App.tsx:757-767) and categoryLabel title-cases for display (labels.ts:64-68) — so 'news' typed on the phone becomes 'News', a second column with the same visible label. The <datalist> at :614-618 is not shown as a dropdown on iOS Safari. Fix: Replace with a <select> of existing categories (derived from sources) plus a 'New category…' option; normalize to lowercase/trim on save (client in saveEdit :546, backend in _validate_category); add autoCapitalize="none" to any text fallback.
- [high] frontend/src/components/Column.tsx:314: The whole column header is a role="button" that marks every entry read; the only label is title="tap to mark this column read" (:320), invisible on touch. On the phone the header sits directly under the tab strip and is tapped accidentally; there is no visible 'Mark all read' control anywhere on mobile. Fix: Add an explicit 'Mark all read' button (44 px) in the column header or the column ⋯ popover and stop the header itself from being the action.
- [high] frontend/src/components/Column.tsx:341: The '+N new' chip is a button whose click calls onRefresh() (:350) → full refresh → 'refreshed' toast; the count never changes (lastViewed untouched) so tapping a badge that says '3 new' appears to do nothing. Mobile tab badges (App.tsx:2690-2710) share the same count and are only cleared by the hidden header tap. Fix: Make the chip non-interactive or make it scroll to the Fresh section / clear the count; put refresh behind the refresh icon only.
- [high] frontend/src/App.tsx:2022: jumpToCategory only sets selectedColumnIndex and scrollIntoView on refs registered by the desktop grid (App.tsx:2594-2600, inside hidden md:grid); it never calls setMobileCol. The Drawer renders 'Jump to column' rows on every viewport (Drawer.tsx:393-409) and closes the drawer, so on the phone the row does nothing visible. Fix: In jumpToCategory also call setMobileCol(idx) (index into the same `columns` array the mobile tab bar uses), or hide the section below md.
- [high] frontend/src/App.tsx:1615: Eye button / swipe-left toast says 'Entry moved to history.' but hidden ids are filtered out of every column by visibleEntries (App.tsx:748-751); the entry disappears from the dashboard and is only listed in Settings → Hidden. The context-menu path toasts 'Entry hidden.' (App.tsx:2452, 2558, 2612, 2749) for a near-identical result. Fix: Use one wording ('Hidden — Undo') for both paths; if History placement is intended, stop filtering hidden ids out of the history slice.
- [high] frontend/src/api.ts:284: ApiError message is '<status> <statusText> for <url>' (e.g. '500 Internal Server Error for /api/entries?perCategoryLimit=100') and is rendered verbatim in: dashboard banner+toast App.tsx:1114-1115, search SearchResults.tsx:81, login LoginPage.tsx:105, notifications Settings.tsx:336, LLM Settings.tsx:923/926, history Settings.tsx:1099, lists Settings.tsx:1416, brief BriefCard.tsx:594/785, column empty state Column.tsx:844-849, ingest toast FeedManager.tsx:871. Fix: Give ApiError a `userMessage` derived from status (401 'Please sign in again', 404 'Not found', 5xx 'The server had a problem — try again', network 'Can't reach the server') and render that; keep the raw string in console.warn.
- [medium] frontend/src/App.tsx:2826: 'Save current view' uses window.prompt for the name (also preset rename at App.tsx:306, and Clear local state uses window.confirm at Settings.tsx:413). In the home-screen standalone app these are Safari system dialogs that look foreign and have had reliability problems in standalone mode. Fix: Replace with an inline name field in the chip strip / a small sheet, and an inline two-step confirm like FeedManager's delete (FeedManager.tsx:903-921).
- [high] frontend/src/components/Settings.tsx:1403: Bulk list actions fire immediately with no confirm and no Undo: Saved 'Clear all' (→ App.tsx:2860-2864 setStarredEntries([]), plain toast), Voted 'Hide all downvoted' (App.tsx:2876-2887), Hidden 'Restore all' (App.tsx:2854-2858). Fix: Use the action-toast Undo pattern (capture the previous array, toast with action restoring it) and/or an inline confirm for 'Clear all'.
- [high] frontend/src/components/FeedManager.tsx:1531: Add custom requires the user to invent a slug: placeholder 'my_blog', help 'lowercase letters, digits, underscore', regex ^[a-z0-9_]{1,120}$ (:1372-1374). The name input has no autoCapitalize="none" so iOS capitalizes it. nameError/urlError (:1399-1424) only disable Test/Add (:1792, :1799) and are never rendered, so the buttons are greyed out with no visible reason. Fix: Derive the slug from the feed title/hostname like AutoFeedBlock (:1179-1186) and show a 'Display name' field instead; render nameError/urlError under their fields; add autoCapitalize="none" autoCorrect="off".
- [high] frontend/src/components/FeedManager.tsx:790: Expanded feed-row actions are 13 px text links ('pause', 'edit', 'fetch', 'delete'); only 'pause' has min-h-[36px] (:793), 'edit' (:798-805), 'fetch' (:865-891) and 'delete' (:894-901) have no minimum height. 'fetch' is a developer label. Error/stale/built-in explanations are title tooltips only (:704-708, :724-728, :747-751, :770, :926). Fix: Render the row actions as 44 px buttons or an iOS-style action sheet; label 'fetch' as 'Refresh now'; show last_error inline as a caption instead of a tooltip.
- [high] frontend/src/components/Settings.tsx:1165: History rows for hidden items render the literal string '◯ with strike' as the icon ('◯ with strike'); the empty-state copy at :1110 repeats it. Fix: Use an inline EyeIcon-off SVG (as in TabIcon 'eye-off' :479-487) or a single glyph.
- [high] frontend/src/components/Settings.tsx:1526: Empty-state hints tell a phone user to right-click or press keys: Hidden 'Right-click a card → Hide this entry (or press h)', Saved :1598 'Right-click a card → Save for later (or press b)', Voted :1683 'right-click → Downvote'. The context menu is onContextMenu only (Card.tsx:879); long-press on touch copies the URL (Card.tsx:585-593). Fix: Reword to the visible buttons ('Tap the eye on a card', 'Tap the star', 'Tap ▼ under a card'); add desktop hints only under a (hover:hover) media check or drop them.
- [medium] frontend/src/components/BriefCard.tsx:562: The expanded no-brief header is `flex items-center gap-3` without wrap, holding a 44 px chevron (:566), a shrink-0 three-pill TonePicker at 17 px (:297-324, :578-582) and a shrink-0 'Generate' button (:583-590) inside px-4 — roughly 400 px of fixed width on a 375/390 px phone; the with-brief header uses flex-wrap (:673). overflow-x: clip (styles.css:36) hides the overflow, so the Generate button can be cut off on the Brief tab the first time the user opens it (startExpanded, App.tsx:2729). Fix: Add flex-wrap (match :673) and move Generate onto its own full-width row on mobile; verify with a 375 px screenshot.
- [high] frontend/src/components/Settings.tsx:757: AI tab is developer-shaped: 'set provider in env or pick one below' (:759), provider option 'Default' = .env (:781), free-text model names with placeholder 'empty = this provider's default' (:796-802, :847-853), 'Scoring model' (:843), 'type a name instead' (:833), lowercase 'save' with no autosave (:928-934); API-key copy explains keys are lost unless save is tapped (:886-890). Brief tone is useState only (App.tsx:457) and resets on reload. Fix: Per-provider model <select> with a curated list and an 'Other…' escape; rename 'Scoring model' to 'Ranking model (advanced)' or hide behind Advanced; save on change for selects; persist briefTone in preferences.
- [high] frontend/src/components/FeedManager.tsx:1245: Auto-feed URL input is type="text" with no inputMode="url", autoCapitalize="none" or autoCorrect="off" — iOS autocapitalizes and autocorrects while typing a URL; same for the subreddit field (:1655-1672), edit name (:577-585), add name (:1532-1539), login username (LoginPage.tsx:72-78). The only inputMode in the app is the search box (App.tsx:2236). Fix: Add inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} to URL/name/subreddit fields; autoComplete="username" fields get autoCapitalize="none".
- [medium] frontend/src/components/Settings.tsx:361: Notifications tab tells the user to 'set APPRISE_URL or PUSHOVER_* in .env, then restart the backend' (:364) and 'Set the URL in .env on the host' (:368-371); 'Configured: backend · scheme' (:354-359) shows internal names. Fix: Show 'Push notifications: on/off' with a one-line 'Ask whoever runs the server to connect Pushover' and hide env details behind an Advanced disclosure.
- [medium] frontend/src/components/Column.tsx:425: Column ⋯ popover exposes internals: sort option 'Top (composite score)' (:425), 'Min score: N' range slider 0-100 (:432-456), 'Hide if older than' (:460). Fix: Labels 'Best first / Newest / Oldest'; replace the score slider with a 'Only top stories' switch or remove it; keep the age select.
- [high] frontend/src/components/Column.tsx:836: Empty-state copy references screens and systems that do not exist for the user: 're-enable from Feed Manager' (:836; the screen is Settings → Feeds), 'the scheduler will fetch the first batch shortly' (:824, also App.tsx:2495), raw last_error snippet (:844-849). Fix: 'Paused after N failed fetches — resume it in Settings → Feeds'; 'Waiting for the first fetch'; summarize last_error into a plain reason with the raw text behind a tap.
- [high] frontend/src/components/FeedManager.tsx:1110: Recommended list shows raw slugs and raw categories (r.name, r.category) while My feeds uses sourceLabel/categoryLabel (:710, :712); Drawer source rows show raw s.category (Drawer.tsx:477). The same feed reads 'cbc_top_stories' in one list and 'CBC Top Stories' in another. Fix: Apply sourceLabel()/categoryLabel() in RecommendedTab and Drawer.
- [medium] frontend/src/components/Settings.tsx:229: Settings has eight scrolling tabs (Feeds, AI, Notifications, History, Hidden, Saved, Voted, Reset; TAB_META :106-115). 'Voted' lists only downvotes (:1627-1634); 'Reset' is a destructive action presented as a tab; the title reads 'Settings → X' (:220). Fix: Group into Feeds / AI / Lists (History, Hidden, Saved, Downvoted) / Advanced (Notifications, Reset); rename Voted to Downvoted; drop the arrow in the title.
- [medium] frontend/src/components/FeedManager.tsx:1281: Track-page flow exposes implementation terms: button tooltip 'Add this URL as a generic_scrape source…' (:1281), 'Sitemap URL' / 'Link pattern' fields with tooltips mentioning page_links and <a href> (:1685-1717), type label 'Track page (no RSS)' (:1637), toast '— no native feed found, tracking via periodic scraping instead' (:1216). Fix: Label the type 'Website (no feed)'; hide Sitemap/Link pattern under 'Advanced'; toast 'Added — we'll check this site for new articles'.
- [medium] frontend/src/components/FeedManager.tsx:411: Deleting a feed is permanent (backend records the deletion so plugins do not recreate it, :5-10) and has no Undo; the inline confirm auto-cancels after 4 s (:379, :433-437), which a slow phone user can miss. Fix: Keep the two-step confirm but lengthen/remove the auto-cancel, and offer 'Pause' as the primary option with 'Delete' secondary; or implement soft-delete + Undo toast.
- [high] frontend/src/App.tsx:2341: Health status, text Refresh/Brief buttons and the UserBadge sign-out are in a `hidden sm:flex` row; on the phone there is no way to sign out (UserBadge only at :2363). Fix: Add a 'Sign out' row to the Drawer or Settings when `user` is set.
- [high] frontend/src/App.tsx:835: The 'Saved' column is inserted at index 0 only when something is starred (:835-840) and 'For You' only when non-empty (:841); the mobile tab position is a persisted positional index (:1358-1366, storage.ts:52), so starring the first item shifts every tab and the restored tab points at a different column after reload. Fix: Persist the column name instead of the index, or keep Saved/For You slots stable (render an empty Saved tab).
- [medium] frontend/src/components/Toast.tsx:93: Toasts without an action dismiss after 1.5 s and the message is truncated to one line (:120); on a phone the confirmation is often gone before the eye reaches the bottom of the screen. Fix: 3-4 s for info toasts; allow two lines.
- [medium] frontend/src/components/Card.tsx:585: Long-press on a card silently copies the URL (:585-593) and suppresses the following tap (:685-690); there is no hint and it collides with the iOS native long-press on the headline link. Right-click context menu actions (:708-808) have no touch equivalent except the visible buttons. Fix: Either show a bottom action sheet on long-press (Mark read / Save / Hide / Copy link / Open) or drop the hidden copy gesture.
- [medium] frontend/src/components/Settings.tsx:212: 'Done' is on the leading edge with the title on the trailing edge (Settings.tsx:211-222, Drawer.tsx:314-325) and is 32 px tall (Settings.tsx:215, Drawer.tsx:318); iOS sheets put Done on the right at 44 px. Fix: Title left, Done right, min-h-[44px].
- [high] frontend/src/components/FeedManager.tsx:1069: Sub-44 px targets in the feeds screens: '🔎 find more feeds' min-h-[28px] (:1069-1075), Recommended 'Add' min-h-[28px] (:1120-1127), tab buttons min-h-[36px] (:278), LLM 'Edit' no min-height (Settings.tsx:763-768), History group toggles min-h-[28px] (Settings.tsx:1227-1243), list row actions 13 px no min-height (Settings.tsx:1448-1454), API-key 'clear' (Settings.tsx:906-914). Fix: min-h-[44px] on every tappable control; keep 36 px only for segmented controls with generous padding.
- [high] frontend/src/components/Card.tsx:1392: Star button tooltip says 'save for later (s)' but the keyboard shortcut is b (App.tsx keyboard handler; ShortcutsSheet lists s as 'toggle inline summary'); the summary chevron title also says (s) (:1326). Desktop only. Fix: Change to '(b)'.
- [medium] frontend/src/components/Card.tsx:910: The headline link has aria-label="open in new tab", which replaces the headline text for screen readers on every card. Fix: Remove the aria-label (keep title) or use aria-describedby for the new-tab note.
- [medium] frontend/src/lib/preferences.tsx:527: Preference PUT/DELETE failures are swallowed except console.warn in dev (:527-531, :622-627); a lost mark-read/star/hide is never surfaced and the optimistic state silently diverges from the server until the next reload. Fix: On repeated failure show one error toast ('Couldn't save your changes — retrying') and retry the batch with backoff.
- [high] frontend/src/components/UserBadge.tsx:37: Shows '(local bypass)' next to the name; health line shows raw '· ok' status (App.tsx:2344). Desktop only. Fix: Drop the bypass suffix; map health.status to 'All good' / 'Problem'.
- [medium] frontend/src/App.tsx:2355: Desktop header button labelled 'Brief' generates a new brief (title 'Generate today's brief now'); it reads as 'show the brief'. Fix: Label 'New brief' or move generation into the BriefCard only.

### Reusable frontend building blocks (toast, sheets, autosave/debounce, prefs storage, icons, Tailwind tokens, grouped rows, selects/toggles) for the feed-editor / category-picker / headers-editor / top-bar redesign

# Reusable building blocks catalogue — Popping frontend (origin/main @ 0c7af06, includes PR #12)

All paths relative to `/home/user/popping`. Line numbers are from `cat -n` on the files as read.

## 1. Toast API — `frontend/src/components/Toast.tsx`

| Item | Value | Ref |
| --- | --- | --- |
| Call signatures | `toast(message, kind)` and `toast(message, { kind?, action? })` | Toast.tsx:48-53, normalised :58-66 |
| Kinds | `'info' \| 'error'` only | Toast.tsx:27 |
| Action | `{ label: string; onClick: () => void }`; renders right-aligned accent button, `min-h-[44px]` | Toast.tsx:20-23, :123-139 |
| Durations | 1.5 s without action, 5 s with action; timer resets on each new toast | Toast.tsx:89-96 |
| Singleton | new toast replaces current (`setCurrent(e)`), no stack, no dedup | Toast.tsx:13-16, :74-76 |
| Transport | module-level `Set<Listener>`; imperative, no React tree needed | Toast.tsx:33, :67 |
| Placement | `fixed inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 pointer-events-none` wrapper, `pointer-events-auto` inner | Toast.tsx:117-120 |
| Styles | error: `bg-red-500/15 border-red-500/40 text-red-100`; info: `bg-bg-elevated/95 border-hairline text-label-primary`; both `rounded-ios border px-4 py-2 text-ios-body shadow-glow-md max-w-[min(90vw,420px)]` | Toast.tsx:103-106, :120 |
| Message is single-line | `<span className="flex-1 min-w-0 truncate">` | Toast.tsx:122 |
| Host mount | `<ToastHost />` is the LAST child of App root, after `<Settings>` (both z-50 → DOM order puts toast above Settings) | App.tsx:2894 vs :2834 |
| Call sites | 36 outside Toast.tsx; established copy: `'Marked as read'`/`'Marked as unread'` + Undo action, `'Entry hidden.'` + action, `` `Renamed to “${trimmed}”.` ``, `'link copied'`, `(msg, 'error')` | grep summary (App.tsx, Card.tsx, FeedManager.tsx, Settings.tsx) |

Missing for the redesign: no `'success'` kind; no persistent/"saving…" state; no multi-line/long-message mode (parseApiError 422 strings get clipped by `truncate`); no programmatic dismiss/update of a shown toast.

## 2. Sheet / modal / overlay implementations

### 2a. Settings overlay — `frontend/src/components/Settings.tsx` (z-50)
- Root: `role="dialog" aria-modal fixed inset-0 z-50 bg-black/70 supports-[backdrop-filter]:backdrop-blur-sm animate-fade-in`; backdrop tap closes when `e.target === e.currentTarget` — Settings.tsx:185-195.
- Panel: mobile `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-t-ios-lg bg-bg-app shadow-2xl flex flex-col` (pinned by top edge, not vh — comment :197-200); desktop `md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-full md:w-[480px] md:rounded-none` — :204-205.
- Header: Done button left (`min-h-[32px] min-w-[32px] text-accent`), title right (`text-2xl md:text-ios-large-title font-bold`), `border-b border-hairline shrink-0` — :211-222.
- Tab strip: `flex gap-1.5 overflow-x-auto px-4 mt-3 pb-1` role=tablist; pills `shrink-0 min-h-[36px] rounded-full px-3 text-ios-caption font-medium`, active `bg-accent text-white`, inactive `bg-bg-surface text-label-secondary active:bg-bg-elevated` — :228-259.
- Body scroller: `flex-1 min-h-0 overflow-y-auto bg-bg-app pb-[calc(2rem+env(safe-area-inset-bottom))]` — :263.
- Esc closes via capture-phase keydown — :169-180.
- Tab switch = `replaceState` + synthetic `popstate` — :236-247.
- `if (!open) return null` — :182 (no exit animation; all child state resets; LLM/notification status refetched every open — :150-164).
- No focus trap, no swipe-to-dismiss, no slide-up animation (uses fade only).

### 2b. Drawer — `frontend/src/components/Drawer.tsx` (backdrop z-30, panel z-40)
- Backdrop stays mounted, toggles opacity: `fixed inset-0 z-30 bg-black/60 md:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm transition-opacity duration-200` + `opacity-0 pointer-events-none` when closed — :249-255.
- Panel slides from RIGHT on all breakpoints: `fixed z-40 bg-bg-app shadow-2xl flex flex-col touch-pan-y-zoom inset-y-0 right-0 h-full w-[88vw] max-w-[420px] rounded-l-ios-lg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:w-[360px] md:rounded-none transition-transform duration-300 ease-out` + `translate-x-0 / translate-x-full` — :286-294 (header comment :3-9 describes it; the "bottom sheet" comment at :257-261 is stale).
- Swipe-left dismiss: native non-passive `touchmove` listeners, `preventDefault` after 10 px, close past 100 px — :132-193.
- Focus trap (Tab cycling) + initial focus on `button[aria-label="close menu"]` via `querySelector` — :195-239, :263-276.
- Esc capture close — :119-130.
- Grabber `md:hidden absolute top-3 left-2 h-10 w-1 rounded-full bg-label-tertiary` — :303-306.
- Body `nav flex-1 min-h-0 overflow-y-auto bg-bg-app pb-8` — :334.

### 2c. ShortcutsSheet — `frontend/src/components/ShortcutsSheet.tsx` (z-40 centred modal)
- Backdrop `fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4` with onClick close — :66-73.
- Card `w-full max-w-md max-h-[80dvh] overflow-y-auto bg-bg-elevated rounded-ios-lg p-4 space-y-4` role=dialog aria-modal, stopPropagation — :74-84.
- Header with text `✕` 32 px button — :85-97. `KeyCap` kbd pill — :134-140. Esc capture — :50-61.

### 2d. Column prefs popover — `frontend/src/components/Column.tsx` (z-20)
- `absolute right-0 top-full mt-2 z-20 min-w-[240px] rounded-ios-lg bg-bg-elevated shadow-2xl p-3 text-ios-body space-y-3` — :411 (comment :409-410: "the only place we still render a popover-shaped surface"). Esc close :255-256; click-containment guard :275-280, :292-300.

### 2e. Card context menu — `frontend/src/components/Card.tsx` (imperative DOM)
- `showContextMenu(x, y, actions)` builds `div#card-context-menu` with `document.createElement`, menu `fixed z-50 … rounded-ios bg-bg-elevated border border-hairline shadow-xl`, backdrop `fixed inset-0 z-40` — :1795-1855. Not React; not reusable for a sheet.

### 2f. Unused sheet animation token
- `sheetUp` keyframe + `'sheet-up': 'sheetUp 320ms cubic-bezier(0.32, 0.72, 0, 1)'` defined in `frontend/tailwind.config.js:97-100, :116`; zero uses in `src` (verified by grep). Ready for a real bottom sheet.

### Z-order map (hard constraint)
header `sticky z-20` App.tsx:2210 → Column popover z-20 Column.tsx:411 → Drawer backdrop z-30 / panel z-40 Drawer.tsx:252,:286 → ShortcutsSheet z-40 :70 → Card menu backdrop z-40 / menu z-50 Card.tsx:1844,:1807 → Settings z-50 Settings.tsx:189 → Toast z-50 (DOM-after Settings) Toast.tsx:117 / App.tsx:2894.

## 3. Debounce / optimistic-update / "saving…" patterns

| Pattern | Where | Behaviour |
| --- | --- | --- |
| Preferences provider | `frontend/src/lib/preferences.tsx:503-534` | Optimistic `setState`, then `pendingRef: Map<key, value>` + ONE 250 ms trailing timer for all keys (`scheduleSync` :517-534). PUT is fire-and-forget; failure only `console.warn` in DEV (:527-531). **No revert on failure** (contradicts header comment :28-30 "A failed write reverts"). `pagehide`/`beforeunload` flush with `fetch keepalive` (:539-571). `clearLastViewed` uses DELETE immediately (:610-629). |
| Column prefs = existing "save on change" form | Column.tsx:418-477 → App.tsx:2642 `onPrefsChange={(next) => setPrefsFor(col.name, next)}` → App.tsx:2033 `setColumnPrefs` | Native select/range change writes immediately through the provider. No status indicator. |
| Search debounce | App.tsx:1390-1409 | 300 ms `setTimeout` into `searchQuery`; `searching` flag set synchronously (:1403). |
| Source-filter refresh debounce | App.tsx:1331-1346 | 250 ms, skips first run via ref. |
| Interactions queue | `frontend/src/lib/interactions.ts:65-100, :157-173` | rIC (timeout 1000) / 250 ms fallback, `MAX_QUEUE` 50, `sendBeacon` on pagehide :109-140, view dedup Set :55, :160-163. |
| Explicit save button with label swap | Settings.tsx:561 `saving`, :669-694 `save()`, :928-934 `{saving ? 'saving…' : 'save'}`; `clearApiKey` immediate with `'clearing…'` :696-714, :912 | Button-label-only feedback. |
| Busy dim | FeedManager.tsx:370 `busy`, row `opacity-60` :574, :685 | Whole row dims during any PATCH. |
| Immediate PATCH on select change | FeedManager.tsx:398-409 `setInterval`, select onChange :825-837; `toggleActive` :386-396 | Precedent for per-control autosave; each one awaits `onRefresh()` (full dashboard refetch, App.tsx:2838 → `refresh()`). |
| Diff-only PATCH on explicit save | FeedManager.tsx:508-565 `saveEdit` (nameChanged/urlChanged/categoryChanged/headersChanged → body) | Only changed fields are sent; name change bubbles `onRenamed` (:552-556). |
| Two-tap delete confirm, 4 s auto-cancel | FeedManager.tsx:371-380, :433-437, :893-922 | Inline, no native confirm. |
| Live validation effect | FeedManager.tsx:1399-1424 (name/url errors, clears stale test result) | Inline error strings `'name is required'`, `'url is not a valid URL'`. |

No shared `useDebounce`, `useAutosave`, `useAsyncStatus`, or revert-on-error helper exists anywhere in `frontend/src`.

## 4. localStorage namespacing and persistence

- `frontend/src/lib/storage.ts:43-56`: `NAMESPACE='popping'`, `SCHEMA='v1'`, keys `popping.v1.mobileCol.last` (:52) and `popping.v1.brief.collapsed` (:55); booleans stored as `'0'`/`'1'` (:53-54). `safeGetItem/safeSetItem/safeRemoveItem` try/catch wrappers :58-85. Rule at :39-41: localStorage is for per-device screen position only; "new server-backed keys should NOT be added here".
- Server-backed prefs: `PREFERENCE_KEYS` :157-167 with per-column keys shaped `read_entries:<columnId>` (:50-56). Adding a key touches: `PreferencesState` :136-154, `PREFERENCE_KEYS` :157-167, `DEFAULT_STATE` :173-183, a setter :578-714, context value + memo deps :716-747, `applyRowToState` allow-list :813-866, `mergeStateFromServer` :874-907. One-shot seed flag `popping.v1.preferences.seeded` :217; legacy keys :226-235.
- `usePreferences()` throws outside provider :757-765; provider mounted in `frontend/src/main.tsx:9`.

## 5. Icon components and sizes

All icons are file-private inline SVGs (no shared module) except `SourceIcon` and `Hamburger`:

| Icon | File:line | viewBox / stroke | Sizes used |
| --- | --- | --- | --- |
| `SourceIcon` (export) favicon + djb2 colour-letter fallback; `stableHue` export | SourceIcon.tsx:44, :52 | px box via `size` prop | 14 (FeedManager:695), 16 (FramingWatch:99, default), 18 (Drawer:472); comment says 20 also used |
| `Hamburger` (export) 44×44 round button, 22 px svg | Hamburger.tsx:11-33 | 22 vb, stroke 1.75 | — |
| `SearchIcon`, `ClearIcon`, `RefreshIcon` | App.tsx:2903, :2924, :2948 | 24 vb, stroke 1.75 | w-5 h-5 (top bar), w-4 h-4 (inside search pill) |
| gear (inline, Feather "settings") | App.tsx:2315-2328 | 24 vb, stroke 1.6, 22 px | 44×44 button :2310 |
| `CheckIcon` (filled variant), `EyeIcon` (closed variant), `StarIcon` (filled), `ChevronDownIcon`, `ArrowUpIcon`/`ArrowDownIcon` (filled, stroke 2.5) | Card.tsx:1486, :1523, :1577, :1598, :1627, :1651 | 24 vb, stroke 2 | w-4 h-4, w-5 h-5 (swipe reveal) |
| `MoreIcon` (3 dots fill), `ChevronIcon` (rotates 90°) | Column.tsx:755, :776 | 24 vb, stroke 1.75 | w-4 h-4 |
| `ChevronIcon` | BriefCard.tsx:795 | — | w-4/w-3 |
| `ChevronRight` | Drawer.tsx:607-621 | 24 vb, stroke 1.75 | w-4 h-4 (:584) |
| `TabIcon` switch: feeds/llm/bell/reset/history/eye-off/star/arrow-down | Settings.tsx:433-509 | 20 vb, 16 px, stroke 1.5 | 16 |

Text glyphs still used as icons: `✕` ShortcutsSheet.tsx:95, App.tsx:2409; `›` FeedManager.tsx:780; `✓ ✗ ⚠ ▲ ▼ 🔎 ✨` FeedManager.tsx:1074, :1237, :1765, :753; Settings.tsx:1165.
Four separate chevrons exist (Drawer, Column, Card, BriefCard). No plus, trash, pencil, check-circle, or spinner icon exists.

## 6. Tailwind design tokens — `frontend/tailwind.config.js`

- Colours :11-53: `bg-app #000`, `bg-surface #0a0a0a`, `bg-elevated #1c1c1e`, `bg-grouped` (alias, 0 uses), `accent #0a84ff`, `accent-soft rgba(10,132,255,.15)` (8 uses), `hairline rgba(255,255,255,.08)`, `label-primary #fff`, `label-secondary rgba(235,235,245,.6)`, `label-tertiary rgba(235,235,245,.45)`, `score-hot/warm/cool/cold`.
- Font sizes :63-71: `ios-large-title` 34/41 700, `ios-body` 17/22, `ios-caption` 13/18. No 15/16 px token; hand-rolled `text-[11px]` (FeedManager.tsx:576, :588, :604, :632, :712, :784; FramingWatch.tsx:106), `text-[10px]` (FeedManager.tsx:598, :645, :650, :1114; App.tsx:2709; FramingWatch.tsx:81), `text-[9px]` (SourceIcon.tsx:68; FramingWatch.tsx:111).
- Radii :72-78: `rounded-ios` 10 px (rows/inputs/buttons), `rounded-ios-lg` 14 px (cards/sheets).
- Shadows :79-86: `glow-sm` (1 use), `glow-md` (2), `glow-accent` (0).
- Animations :110-120: `fade-in` 180 ms (4 uses), `sheet-up` 320 ms (0 uses), `shimmer` 1.6 s (2).
- Font stack :58-61 (`-apple-system … system-ui`) vs `styles.css:27` body stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto`) — two different stacks; body uses the CSS one.
- Global iOS rules `frontend/src/styles.css`: `#root padding-bottom: env(safe-area-inset-bottom)` :20; `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }` :24-26; `html,body { overflow-x: clip }` :36; `overflow-wrap: break-word` :39; `.touch-pan-y-zoom { touch-action: pan-y pinch-zoom }` :11-13 (used by Card.tsx:890, Drawer.tsx:286).
- Viewport: `index.html:5` `width=device-width, initial-scale=1.0, viewport-fit=cover`; no `interactive-widget`; no `visualViewport` listener anywhere (grep 0). App root `minHeight: '100dvh'` App.tsx:2188.
- Breakpoints: `sm` 640 (BriefCard.tsx:372 `matchMedia('(max-width: 639px)')`), `md` 768 = desktop side panels (Drawer.tsx:289, Settings.tsx:205).

### Recurring class recipes (copy these, don't reinvent)
- Primary button: `w-full min-h-[44px] rounded-ios bg-accent active:opacity-80 disabled:opacity-40 text-white text-ios-body font-medium` — Settings.tsx:324, :931; LoginPage.tsx:54; FeedManager.tsx:1800.
- Outline/secondary: `flex-1 min-h-[44px] rounded-ios border border-accent text-accent active:opacity-60 disabled:opacity-40` — FeedManager.tsx:1793.
- Destructive: `min-h-[44px] rounded-ios bg-red-500/15 border border-red-500/40 text-red-300 active:opacity-60` — Settings.tsx:417.
- 44 px text input: `w-full min-h-[44px] rounded-ios bg-bg-elevated border border-hairline px-3 text-ios-body text-label-primary placeholder:text-label-tertiary focus:outline-none focus:border-accent` — LoginPage.tsx:77, :89.
- 36 px input/select: `w-full min-h-[36px] rounded-ios bg-bg-elevated border border-hairline px-2 text-label-primary` — Settings.tsx:779, :801, :815, :852, :858, :903; FeedManager.tsx:1538, :1671, :1727, :1740; Column.tsx:423, :471 (`bg-bg-surface` variant).
- Field label: `block text-ios-caption uppercase tracking-wide text-label-tertiary mb-1` — Settings.tsx:773; FeedManager.tsx:1531; LoginPage.tsx:69.
- Section header: `text-ios-caption uppercase tracking-wide text-label-tertiary` — Drawer.tsx:522; ShortcutsSheet.tsx:112; SearchResults.tsx:67; FramingWatch.tsx:66.
- Status boxes: ok `rounded-ios bg-emerald-500/10 border border-emerald-500/30` + `text-emerald-300` Settings.tsx:354-359; warn `bg-amber-500/10 border-amber-500/30 text-amber-300` :361-366; error `bg-red-500/15 border border-red-500/40 text-red-200` :333-350, LoginPage.tsx:104, FeedManager.tsx:1761.
- Chip: `inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-ios-caption text-accent` — BriefCard.tsx:637, :692; App.tsx:2382.
- Round icon button (top bar): `w-11 h-11 flex items-center justify-center rounded-full text-label-primary active:bg-bg-elevated` — App.tsx:2277, :2294, :2310; Hamburger.tsx:16.
- Card/panel: `rounded-ios bg-bg-surface border border-hairline p-3` — Settings.tsx:402, :729, :1107, :1391; list `divide-y divide-hairline` :1425.

## 7. Grouped-list row pattern — `frontend/src/components/Drawer.tsx`

- `GroupedSection({ label, footnote?, action?, children })` :508-541: label row `flex items-end justify-between px-4 mb-2`, card `mx-4 rounded-ios bg-bg-surface overflow-hidden`, footnote `px-4 mt-2 text-ios-caption text-label-secondary`, `mt-6 first:mt-2`.
- `GroupedRow({ title, subtitle?, onClick?, showChevron?, tone? })` :552-602: base `flex items-center gap-3 px-4 min-h-[44px] border-b border-hairline last:border-b-0`; `<button … w-full text-left active:bg-bg-elevated>` when onClick else `<div>`; tone → emerald/amber/red text :565-572; subtitle `text-ios-caption text-label-secondary truncate` :578.
- Checkbox row variant: `<label class="flex items-center gap-3 px-4 min-h-[44px] cursor-pointer transition border-b border-hairline last:border-b-0">` + native `checkbox h-4 w-4 accent-accent` + SourceIcon 18 + name + category caption — :457-479.
- **Both primitives are NOT exported** (only `Drawer` at :79 is; see export list). No trailing-value / trailing-switch slot; no `as="label"` form-row variant.
- FeedManager's `SourceRow` does NOT use this pattern: `px-3 py-0.5 text-ios-caption border-b border-hairline`, 44 px disclosure button :686-690, actions revealed below as caption-size text links `flex flex-wrap items-center gap-x-4 gap-y-1` :789-931.

## 8. Select / dropdown / segmented / toggle inventory

- Native `<select>` ×8: Settings.tsx:776 (provider), :812 (brief model, with "type a name instead" toggle :828-834), :855 (scoring model); FeedManager.tsx:825 (refresh interval, saves on change), :1723 (category, 16 hard-coded `CATEGORY_OPTIONS` :80-101), :1736 (refresh); Column.tsx:418 (sort), :462 (max age). All share the 36 px recipe; no custom chevron; no wrapper component.
- `<datalist id="feed-category-options">` on the edit-form category text input — FeedManager.tsx:605-618 (`list=` :611). This is the "blank text box" in the owner's complaint; iOS Safari does not surface datalist suggestions.
- Segmented controls (3 hand-rolled, none shared): Settings brief tone `grid grid-cols-3 gap-0 rounded-ios overflow-hidden border border-hairline` + `min-h-[44px]` buttons, `aria-pressed` — Settings.tsx:292-317; BriefCard `TonePicker` role=group, `min-h-[28px] rounded-ios px-3`, `aria-pressed` — BriefCard.tsx:287-325; Settings History `Controls` two `rounded-full … min-h-[28px]` pills — Settings.tsx:1218-1245.
- Tabs: FeedManager `TabButton` role=tab `flex-1 min-h-[36px] rounded-ios` — :264-287; Settings tab strip :228-259; App mobile column tablist `rounded-full px-3 py-1.5 text-ios-caption` :2668-2719.
- Radios: native `type="radio" className="accent-accent"` fieldset for source type — FeedManager.tsx:1554-1639.
- Checkbox: native, Drawer.tsx:463-469. Range: native `accent-accent`, Column.tsx:434-456.
- Toggle/switch component: **none**. Pause/resume is a caption text link — FeedManager.tsx:790-797.
- Native browser dialogs still in use: `window.prompt` App.tsx:2826; `window.confirm` Settings.tsx:413.
- `aria-pressed` buttons on cards (vote/star/hide/check) — Card.tsx:1258, :1285, :1363, :1391, :1426.

## 9. API layer — `frontend/src/api.ts` and error helpers

- `jsonFetch<T>`: `credentials: 'include'`, non-2xx → `throw new ApiError(\`${status} ${statusText} for ${url}\`, detail)` where `detail` is the parsed FastAPI body `.detail` — api.ts:264-287.
- `deleteSource` uses raw `fetch` and throws a plain `Error` with no `detail` — api.ts:446-452.
- `parseApiError(err, fallback)` is in **FeedManager.tsx:190-210** (not api.ts): 422 list → `msg` joined by `'; '`; string detail; `message`; fallback. `friendlyTestError(kind, raw)` FeedManager.tsx:163-188 maps `error_kind` (`not_found|forbidden|timeout|parse_error|name_conflict|invalid_url|unsupported_type|network_error|unknown`, api.ts:158-168).
- `Source` shape api.ts:117-147 (`category: string` :121, `custom_headers: Record<string,string> | null` :135, `auto_disabled` :141, `net_vote_score` :146).
- `updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? })` PATCH — api.ts:424-443. `createSource` :362-381; `testSource` accepts `custom_headers` :389-400; `autoAddSource(url, category='other')` :409-417; `sources()` :356.
- Error channel from the editor: FeedManager `onError` → Settings `onError` → App `setError` (App.tsx:2839) → sticky banner `role="alert" … sticky top-0 z-15 px-4 py-2 bg-red-500/15` (App.tsx:2397-2412). `z-15` generates no CSS rule (verified against `frontend/dist/static/index-Ctm9RX9z.css`); the banner is in page flow and is covered by the fixed `z-50` Settings overlay (Settings.tsx:189), so on a phone (full-width sheet, Settings.tsx:204) editor errors are not visible while the sheet is open.

## 10. Backend constraints the editor must mirror — `backend/app/routes/sources.py`, `backend/app/models.py`

- Category: `String(40)` models.py:46; `_CATEGORY_MAX = 40` sources.py:152; `_RESERVED_CATEGORY_NAMES = {"saved", "for you"}` :162 (case-insensitive, :299); `_validate_category` trims, rejects empty, >40, reserved — :287-303; applied on POST :469, :608 and PATCH :751-752. No categories endpoint (grep of `backend/app/routes/*.py`); `GET /api/sources` is ordered by `category, name` :397.
- Custom headers: `_CUSTOM_HEADERS_MAX = 20`, `_HEADER_VALUE_MAX = 512` :192-193; denylist `cookie, authorization, host` :169 + `x-forwarded-for/host/proto, x-real-ip, x-original-url, x-rewrite-url` :177-187, matched on `k.lower()` :330; keys/values must be strings :325-329; values printable ASCII + tab only (CRLF rejected) :340-352; empty map → `None` :354; PATCH omits vs explicit null distinction via `model_fields_set` :754-759.
- Built-ins (`registered_plugin_names()`) → 400 on name/url PATCH :765-771 (frontend mirror `KNOWN_BUILT_INS` FeedManager.tsx:108-115); name collision → 409 :786-795; name regex `^[a-z0-9_]{1,120}$` (schemas.py:75; FeedManager.tsx:1372).

## 11. Top bar inventory — `frontend/src/App.tsx`
- Title row :2220-2335: `h1 text-ios-large-title`; search 44×44 / expanded pill `h-11 w-44 sm:w-72` :2230-2281; refresh `sm:hidden` 44×44 :2289-2297; gear 44×44 `data-settings-gear` → `openSettings('feeds')` :2305-2329; `<Hamburger onClick={() => setDrawerOpen(true)} />` :2333.
- Sub-row `hidden sm:flex`: health caption, Refresh, Brief, `<UserBadge>` :2341-2365.
- Drawer rows that duplicate Settings entry: "History" → `onOpenSettings('history')` Drawer.tsx:336-351; "All settings…" → `onOpenSettings()` :377-390; "Save current view" :366-376.
- Settings URL state: allow-list sync on `popstate` :394-428; `openSettings` pushState :430-437; `closeSettings` :438-444; Settings tab buttons replaceState + synthetic popstate Settings.tsx:236-247.
- `categories` for the Drawer/tabs are derived from visible ENTRIES grouped by `categoriesBySourceId` (App.tsx:753-764), not from `sources` — a source with no entries (or all hidden) has no category in that list.

## 12. Build / verification guards
- CI frontend job: `npm ci`, `npm run lint`, `npm run build` (tsc + vite) — `.github/workflows/build.yml:114-117`. No frontend test runner (`frontend/package.json:6-12`).
- ESLint: `react-hooks/rules-of-hooks` error, `exhaustive-deps` warn, `react-refresh/only-export-components` warn with `allowConstantExport` — `frontend/eslint.config.js:36-46`. `tsconfig.json:14` strict.
- `prebuild` runs `scripts/check-html-comments.mjs` (index.html only) — package.json:7; script :1-23.

## 13. What is missing, and where new shared primitives should live

Proposed directory: `frontend/src/components/ui/` (new; keeps `react-refresh/only-export-components` clean by exporting components/constants only) and `frontend/src/lib/` for hooks/helpers.

| Need | Exists today? | Proposal |
| --- | --- | --- |
| Bottom sheet (mobile) / right panel (desktop) with slide-up, safe-area, scroll body, Done header, Esc, backdrop tap, focus trap, vertical swipe-dismiss | Pieces split across Settings.tsx:184-263 (layout), Drawer.tsx:119-239 (Esc/swipe/focus trap), tailwind `sheet-up` :116 (unused) | `ui/Sheet.tsx` — compose those; mount feed editor INSIDE the Settings panel (same z-50 layer) or give nested sheets `z-[60]` and move `ToastHost` to `z-[70]` (Toast.tsx:117) |
| GroupedSection / GroupedRow with trailing slot (value text, switch, chevron) and label-row form variant | Private in Drawer.tsx:508-602 | `ui/GroupedList.tsx` — lift + export; Drawer imports it |
| Switch/toggle (active/paused) | None (text link FeedManager.tsx:790-797) | `ui/Switch.tsx` — `role="switch" aria-checked`, 44 px row height, `bg-accent` on |
| Picker (category, refresh interval, source type) | 8 native selects sharing one class string; iOS-unfriendly datalist FeedManager.tsx:611-618 | `ui/Picker.tsx` — styled native `<select>` wrapper (chevron, ≥16 px text) for simple lists, plus a sheet-based list picker (reuse GroupedRow + CheckIcon) for category with an "Add new category…" row that validates against sources.py:287-303 rules client-side |
| Field (label + control + helper/error) at ≥16 px so styles.css:24-26 can be deleted | Two ad-hoc recipes (44 px LoginPage.tsx:77; 36 px Settings/FeedManager) | `ui/Field.tsx` / `ui/TextInput.tsx` — `min-h-[44px] text-[17px]` (ios-body) |
| Autosave hook with status | None; closest is preferences.tsx:503-534 (key→PUT, no status, no revert) and FeedManager.tsx:398-409 (await PATCH + full refresh) | `lib/useAutosave.ts` — per-field debounce (≈600 ms text / 0 ms discrete controls), diff-only PATCH via `api.updateSource`, status `idle\|saving\|saved\|error`, keep last-known-good for revert, flush on blur/pagehide; update `sources` state from the PATCH response instead of calling `onRefresh()` per save |
| Save status indicator ("Saving…", "Saved", "Couldn't save · Retry") | None (button label Settings.tsx:933; opacity dim FeedManager.tsx:574) | `ui/SaveStatus.tsx` — `aria-live="polite"` caption in the sheet header/footer |
| Key/value headers editor | JSON textarea FeedManager.tsx:635-654 + parse validator :481-506 | `ui/KeyValueEditor.tsx` — rows (key input, value input, remove), "Add header", presets (browser User-Agent, Accept-Language); client checks mirroring sources.py:169-193, :340-352; emits `Record<string,string>` or `null` when empty |
| Shared error helpers | Private in FeedManager.tsx:163-210 | `lib/apiErrors.ts` — move `parseApiError` + `friendlyTestError`; make `api.deleteSource` throw `ApiError` with detail (api.ts:446-452) |
| In-sheet error surfacing | App banner hidden under Settings on phone (App.tsx:2397-2412 vs Settings.tsx:189) | Route editor errors to `toast(msg, 'error')` (Toast.tsx:48) or an inline status box recipe (Settings.tsx:333) inside the sheet; add a multi-line/longer-duration error option to Toast |
| Icon set (chevron, plus, trash, pencil, check-circle, spinner) | Four private chevrons; no plus/trash/pencil | `ui/icons.tsx` — 24 vb, stroke 1.75, `aria-hidden`; migrate text glyphs (`✕`, `›`) |
| Category option source | Hard-coded `CATEGORY_OPTIONS` FeedManager.tsx:80-101; `categories` from entries App.tsx:753-764 | `lib/categories.ts` — `Array.from(new Set(sources.map(s => s.category)))` ∪ defaults, lowercase-dedupe, exclude `saved`/`for you`, display via `categoryLabel` (labels.ts:64-68); no backend change needed |
| 15 px/16 px type token | Only 13/17/34 (tailwind.config.js:63-71) | add `'ios-subhead': ['15px', { lineHeight: '20px' }]` and use it in place of `text-[11px]/[10px]` in rows |

#### Constraints
- Settings overlay identity is URL state: open/close via pushState in App.tsx:430-444; tab allow-list sync on popstate App.tsx:394-428; Settings tab buttons use replaceState + synthetic popstate Settings.tsx:236-247; Drawer deep-links by tab id Drawer.tsx:345 and :384. Any new tab/route must be added in both App.tsx:409-418 and Settings.tsx:229.
- Z-order to preserve: header sticky z-20 App.tsx:2210; Column popover z-20 Column.tsx:411; Drawer backdrop z-30 / panel z-40 Drawer.tsx:252,:286; ShortcutsSheet z-40 ShortcutsSheet.tsx:70; Card context menu z-40/z-50 Card.tsx:1844,:1807; Settings z-50 Settings.tsx:189; Toast z-50 Toast.tsx:117 rendered after Settings (App.tsx:2834 vs :2894) so DOM order keeps it on top. A nested sheet above z-50 must also raise ToastHost.
- Mobile Settings sheet is pinned by its top edge with env(safe-area-inset-top) (Settings.tsx:204), never a vh height; body keeps pb-[calc(2rem+env(safe-area-inset-bottom))] (Settings.tsx:263); app root uses minHeight 100dvh (App.tsx:2188); #root has padding-bottom safe-area (styles.css:20).
- styles.css:24-26 forces input/textarea/select to 16px !important under (pointer: coarse); new controls must be >=16px by design (ios-body is 17px, tailwind.config.js:68) so that override can be removed without re-introducing iOS focus zoom.
- PATCH surface is api.updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? }) api.ts:424-443; custom_headers is a flat string->string map; omit = untouched, null or {} = clear (backend sources.py:754-759, :354).
- custom_headers limits enforced server-side (422): max 20 entries, value <=512 chars (sources.py:192-193); denied keys case-insensitively: cookie, authorization, host, x-forwarded-for, x-forwarded-host, x-forwarded-proto, x-real-ip, x-original-url, x-rewrite-url (sources.py:169-187, :330); values must be printable ASCII or tab, no CRLF (sources.py:340-352).
- Category rules: non-empty after trim, <=40 chars (models.py:46 String(40); sources.py:152, :287-297), not 'saved' or 'for you' case-insensitive (sources.py:162, :299-303). Categories are also dashboard column keys (App.tsx:753-764), and 'Saved'/'For You' columns are reserved names.
- Built-in sources (FeedManager.tsx KNOWN_BUILT_INS :108-115; backend registered_plugin_names sources.py:765-771) reject name/url PATCH with 400 but may be paused, recategorized, re-intervaled and deleted; the edit form must lock name/url for them (FeedManager.tsx:581, :593).
- Source name regex ^[a-z0-9_]{1,120}$ (FeedManager.tsx:1372; schemas.py:75); rename collision returns 409 (sources.py:786-795); a successful rename must bubble onSourceRenamed(old, new) so App remaps the active filter chip (FeedManager.tsx:44-48, :552-556; Settings.tsx:74-77; App.tsx:2845).
- Every FeedManager mutation today awaits onRefresh() = App.refresh() (FeedManager.tsx:390, :402, :420, :551, :879; Settings.tsx:268; App.tsx:2838), a full dashboard refetch; a per-keystroke autosave must update the sources list from the PATCH response instead of triggering that refresh on every write.
- Toast is a single slot: a new toast replaces the current one (Toast.tsx:13-16, :74-76); kinds are 'info' | 'error' only (Toast.tsx:27); durations 1.5s / 5s with action (Toast.tsx:93); message is single-line truncate (Toast.tsx:122).
- Settings overlay returns null when closed (Settings.tsx:182): child state (FeedManager tab, edit state) resets and LLM/notification status refetches on every open (Settings.tsx:150-164). An editor must not rely on state surviving a close.
- Drawer initial-focus target is found by selector button[aria-label="close menu"] (Drawer.tsx:273-275); changing that aria-label breaks focus management. Drawer owns a horizontal swipe-left dismiss (Drawer.tsx:132-193) and Cards own horizontal swipes (Card.tsx:890 touch-pan-y-zoom, :596-620); a bottom sheet must use vertical-only drag.
- Editor errors flow FeedManager.onError -> Settings.onError -> App.setError (App.tsx:2839) -> in-flow sticky banner (App.tsx:2397-2412, whose z-15 class emits no CSS); the fixed z-50 Settings overlay (Settings.tsx:189) covers it on phones, so a redesign must surface errors inside the sheet or via toast.
- localStorage may hold only per-device screen-position keys under popping.v1.* (storage.ts:39-56); anything that must sync goes through the preferences provider and requires edits at preferences.tsx:136-154, :157-167, :173-183, :578-714, :716-747, :813-866, :874-907.
- Preferences provider writes are optimistic, debounced 250ms per batch, fire-and-forget with no revert on failure (preferences.tsx:503-534, :523-532) despite the header comment at :28-30; a new autosave hook must implement its own revert/retry.
- Breakpoints: sm = 640px (BriefCard.tsx:372 matchMedia 639px), md = 768px switches Drawer/Settings to desktop side panels (Drawer.tsx:289, Settings.tsx:205); iPad-width gets the 480px panel.
- CI gate is npm run lint (eslint.config.js: rules-of-hooks error, exhaustive-deps warn, react-refresh/only-export-components warn :36-46) + tsc strict (tsconfig.json:14) + vite build (.github/workflows/build.yml:114-117); there is no frontend test runner (frontend/package.json:6-12). New ui/ primitive files should export only components or constants.
- REDESIGN_PLAN.md:44 limits PR file surface to frontend/src, backend/app/youtube.py, backend/app/routes/sources.py, backend/tests, README, .env.example; a categories list must therefore be derived client-side from GET /api/sources (api.ts:356; Source.category api.ts:121) rather than via a new route file.
- Tailwind sheet-up animation (tailwind.config.js:97-100, :116) exists but is unused in src; two font stacks exist (tailwind.config.js:58-61 vs styles.css:27) and body text uses the styles.css one.

#### Findings
- [high] frontend/src/components/FeedManager.tsx:611: Category field in the inline edit form is a free-text <input> with list="feed-category-options" <datalist> (lines 605-618); iOS Safari does not render datalist suggestions, so on the phone it is a blank text box with no list of existing categories and no add-new affordance (owner complaint #2). Fix: Replace with a Picker (styled select or sheet list) fed from the set of categories in `sources` plus defaults, with an 'Add new category…' row that validates length<=40 and reserved names client-side.
- [high] frontend/src/components/FeedManager.tsx:582: Inline edit inputs (name :582, url :594, category :610) have no min-height — `px-2 py-1 text-ios-body` yields ~30px tall controls, under the 44px tap-target rule used elsewhere (LoginPage.tsx:77 uses min-h-[44px]). Fix: Use a shared Field/TextInput primitive with min-h-[44px] and 17px text.
- [high] frontend/src/components/FeedManager.tsx:657: Save and cancel are caption-size text links (`text-ios-caption text-accent`, lines 657-670) with no min-height at the bottom of the form — the 'tiny save link that's easy to miss' (owner complaint #3). Save is also gated on `parsedHeaders.ok` only, silently no-ops on an unchanged form (:518-528). Fix: Remove explicit save; autosave per field via a useAutosave hook with a visible SaveStatus indicator; keep a 44px Done button in the sheet header.
- [high] frontend/src/components/FeedManager.tsx:635: Custom headers are edited as a raw JSON textarea (`font-mono text-ios-caption`, placeholder '{"User-Agent": ...}', lines 630-654) with a client-side JSON.parse validator (:481-506) — backend work exposed in the UI (owner complaint #4). Fix: Key/value row editor emitting Record<string,string> | null, with presets for User-Agent and Accept-Language and client mirrors of the backend denylist/limits (sources.py:169-193, :340-352).
- [high] frontend/src/App.tsx:2305: Three entry points to Settings: gear button (App.tsx:2305-2329), hamburger → Drawer (App.tsx:2333) whose Quick settings section has 'All settings…' (Drawer.tsx:377-390) and 'History' (Drawer.tsx:336-351) rows that both open the same Settings overlay (owner complaint #5). Fix: Keep one 44×44 button; fold Drawer's filter/jump sections into Settings tabs or make the single button open a merged sheet; update Drawer deep-links and App URL allow-list together.
- [high] frontend/src/App.tsx:2401: Errors raised inside Settings/FeedManager go to App.setError (App.tsx:2839) and render as an in-flow sticky banner at App.tsx:2397-2412; the class `z-15` emits no CSS (verified in dist CSS) and the banner is covered by the fixed z-50 Settings overlay (Settings.tsx:189, mobile panel :204), so editor errors are invisible on a phone while the sheet is open. Fix: Surface editor errors inside the sheet (inline status box recipe at Settings.tsx:333) or via toast(msg, 'error'); drop the z-15 class.
- [high] frontend/src/components/Drawer.tsx:508: GroupedSection (:508-541) and GroupedRow (:552-602) — the app's only iOS grouped-list primitives with the 44px row recipe — are file-private; FeedManager rows (:685-782) and Settings cards (:402, :1391) reimplement different row styles. Fix: Move both to frontend/src/components/ui/GroupedList.tsx, export them, add a trailing slot and a label-row variant, and use them for the feed list and editor rows.
- [high] frontend/src/components/FeedManager.tsx:190: parseApiError (:190-210) and friendlyTestError (:163-188) are private to FeedManager.tsx although Settings.tsx and App.tsx also present API errors (Settings.tsx:156, :595; App.tsx:1114 use raw `(e as Error).message`); api.deleteSource (api.ts:446-452) throws a plain Error so its 4xx detail can never be parsed. Fix: Move both helpers to frontend/src/lib/apiErrors.ts; make deleteSource throw ApiError with detail.
- [high] frontend/src/lib/preferences.tsx:28: Header comment says 'A failed write reverts' (:28-30) but scheduleSync (:517-534) fires PUTs fire-and-forget and only console.warns in DEV on failure (:527-531); there is no revert, status, or retry — so the provider cannot be reused as-is for a feed-editor autosave that must report 'Couldn't save'. Fix: Build lib/useAutosave.ts with explicit status and last-known-good revert; fix the stale comment.
- [high] frontend/src/App.tsx:764: `categories` is derived from visible entries grouped by source category (App.tsx:753-764), not from `sources`; a category picker fed from it would omit any category whose sources have no entries yet or whose entries are all hidden, and FeedManager separately hard-codes 16 CATEGORY_OPTIONS (FeedManager.tsx:80-101). Fix: Add lib/categories.ts deriving options from sources.map(s => s.category) ∪ defaults, deduped case-insensitively and excluding reserved names.
- [high] frontend/tailwind.config.js:116: `sheet-up` animation (keyframes :97-100, animation :116) is defined but has zero uses in src; Settings uses animate-fade-in only (Settings.tsx:189) and Drawer uses transition-transform (:290-294), so no bottom-sheet slide-up exists today. Fix: Use animate-sheet-up in the new ui/Sheet.tsx mobile presentation.
- [medium] frontend/src/components/FeedManager.tsx:576: Hand-rolled sub-caption text sizes below iOS readable minimum in the feed list/editor: text-[11px] at :576, :588, :604, :632, :712, :784; text-[10px] at :598, :645, :650, :1114 (also App.tsx:2709, FramingWatch.tsx:81, :106, :111, SourceIcon.tsx:68). No Tailwind token exists between ios-caption 13px and ios-body 17px (tailwind.config.js:63-71). Fix: Add an `ios-subhead` 15px token and replace the arbitrary sizes during the ease-of-use sweep.
- [medium] frontend/src/components/Settings.tsx:779: All eight native <select> elements (Settings.tsx:776, :812, :855; FeedManager.tsx:825, :1723, :1736; Column.tsx:418, :462) share a 36px recipe with no explicit font size, relying on the global `font-size: 16px !important` in styles.css:24-26 to avoid focus zoom; the interval select at FeedManager.tsx:829 has no min-height at all. Fix: Wrap in ui/Picker.tsx with min-h-[44px] and text-ios-body so the global !important rule can be removed.
- [medium] frontend/src/App.tsx:2826: Native window.prompt (App.tsx:2826, preset name) and window.confirm (Settings.tsx:413, reset) are still used inside a home-screen PWA; both are jarring on iOS and inconsistent with the inline two-tap confirm already built in FeedManager.tsx:371-380. Fix: Replace with an in-sheet text field / inline confirm during the ease-of-use sweep.
- [medium] frontend/src/components/Toast.tsx:122: Toast message is `truncate` single-line; parseApiError output for 422s (joined field messages) and backend header-validation details (e.g. "header 'Cookie' cannot be overridden per-source") will be clipped on a 390px phone. Fix: Allow 2-line wrap (line-clamp-2) for kind 'error' or route long errors to an inline status box in the sheet.
- [medium] frontend/src/components/Settings.tsx:182: Settings returns null when closed, so there is no exit animation and all child state resets each open; LLM/notification status is refetched on every open (:150-164). A feed editor sheet nested here loses in-progress edits if the overlay is dismissed via back button mid-save. Fix: Flush pending autosave writes on close/pagehide (pattern at preferences.tsx:539-571) and keep the overlay mounted with opacity/transform for exit animation.
- [low] frontend/src/components/Drawer.tsx:257: Comment block claims the Drawer is a bottom sheet on mobile ('slides up to fill the viewport') but the classes at :286-294 slide it in from the right on every breakpoint (header comment :3-9 is the accurate one). Fix: Fix the stale comment when the Drawer is touched by the top-bar change.
- [low] frontend/src/styles.css:27: Body font stack (ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto) differs from tailwind.config.js:58-61 fontFamily.sans (-apple-system first); elements using Tailwind `font-sans` would render a different stack. Fix: Align styles.css body font-family with the Tailwind sans stack.

### Prior work (PRs #7, #8, #10, #11, #12), unfinished markers, dead code and recorded UI rationale in frontend/src, plus the backend PATCH constraints that bound the feed editor

# Reader report: what is already done, what the code says is unfinished, and the recorded design rationale

Repo: /home/user/popping. origin/main = 721713e (PR #12). HEAD is branch `claude/redesign-plan` at 6957bc5, five commits on top of 721713e that touch only `REDESIGN_PLAN.md` and `frontend/scripts/iphone-audit/*` (git log --stat -12: 6957bc5, 0fd364b, 4cb9b74, 0c7af06, e310107). No frontend/src or backend/app file differs from origin/main.

## 1. Already done on main (do not redo)

### PR #7 — 97194c2 "UI polish: readable names, no placeholder art, calmer cards"
- `frontend/src/lib/labels.ts` (new, 68 lines): `sourceLabel()` / `categoryLabel()` — display-only; API still uses raw names. Used in App.tsx mobile tab strip (App.tsx:2703 in that diff, `categoryLabel(c.name)`), Drawer.tsx:399 (`categoryLabel(c)`) and Drawer.tsx:473 (`sourceLabel(s.name)`), FeedManager.tsx:711 (`sourceLabel`) and :712 (`categoryLabel`).
- Not converted: Drawer source-row category chip still raw `{s.category}` (Drawer.tsx:477); Recommended tab category still raw `{r.category}` (FeedManager.tsx:1111).
- Settings tab strip became a horizontally scrolling row of labelled pills (Settings.tsx:223-256); commit body says eight icon-only cells did not fit a phone.
- Card: no letter tile for photo-less cards, score badge removed, action-row divider/vote chrome removed (Card.tsx diff, 112 lines changed).

### PR #8 — 9823be6 "Mobile: home-screen app, safe areas, bigger tap targets, plainer wording"
- `frontend/index.html:5` viewport `viewport-fit=cover`; `:14-20` apple-mobile-web-app-capable, black-translucent status bar, manifest, apple-touch-icon. `frontend/public/manifest.webmanifest` (display standalone, icons 192/512/svg).
- Safe areas: header `pt-[env(safe-area-inset-top)]` App.tsx:2210; Drawer panel `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]` Drawer.tsx:288; Settings body `pb-[calc(2rem+env(safe-area-inset-bottom))]` Settings.tsx:263; `#root { padding-bottom: env(safe-area-inset-bottom) }` styles.css:19.
- Card action icons: 40px tap areas (`w-10 h-10`, e.g. Card.tsx:1365-1366).
- Gear icon replaced the circle-with-rays glyph (App.tsx:2312-2314 comment, SVG 2315-2328).
- FeedManager row became tap-to-reveal: `open` state FeedManager.tsx:381-384; row is a `<button … min-h-[44px] aria-expanded>` 684-690; chevron 773-778; collapsed caption "updated … · every …" 780-784; controls only when open 785-930. Commit body: "Each row showed six links (pause, edit, fetched, interval, fetch, delete)."
- Wording: Settings TAB_META `llm: 'AI'` Settings.tsx:108; "Default" option labels Settings.tsx:778/814/857 (diff); Drawer subtitles Drawer.tsx:349 ("read, hidden and saved stories"), :373 ("keep this layout to come back to"), :388 ("feeds · AI · notifications · reset"); Brief tone labels Short/Story/Alerts Settings.tsx:295-297.
- BriefCard `startExpanded` on the mobile Brief tab (App.tsx:2729 in diff).

### PR #10 — aa31a81 (backend only): generic_scrape Add/Test preview capped at 45s, parallel page fetches (backend/app/sources/generic_scrape.py, test_generic_scrape_probe_budget.py). No frontend change.

### PR #11 — 002ff64 "iOS: stop focus zoom on text fields, fit Settings sheet to the visible screen"
- styles.css:20-24: `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important; } }` with comment "iOS Safari zooms the page in when a text field under 16px gets focus, and doesn't zoom back out."
- Settings.tsx:197-205: mobile sheet pinned by top edge `top-[calc(env(safe-area-inset-top)+0.75rem)]` instead of `h-[92vh]`; comment 198-200 records why (iOS vh counts space behind the toolbar).
- ShortcutsSheet.tsx:79: `max-h-[80dvh]` (was 80vh).
- Commit body names exactly two symptoms: focus zoom, and the 92vh sheet running off the top. Nothing else from the owner's item 6 (screens not fitting generally, overflow) was addressed; the plan's section 4 measured 13 remaining overflow defects.

### PR #12 — 721713e "Cards: tap the check (or swipe right) again to mark unread"
- App.tsx:1535-1560 `toggleEntryRead` (reads `readEntriesRef`, clears id from every column's read-set, Undo toasts). Wired at App.tsx:2449, 2555, 2609, 2746 (diff hunks).
- Card.tsx:534-543 `commitMarkRead` records view/dwell only when `unread`; swipe label `{unread ? 'Read' : 'Unread'}` Card.tsx:855; check button aria-label/title toggle Card.tsx:1360-1363.
- Commit body: "Toggling a read card records no engagement."

## 2. Marker grep over frontend/src

- `TODO|FIXME|XXX|HACK`: zero matches (grep exit 1).
- `"kept in the signature"`: zero literal matches; the near-match is Drawer.tsx:64-65 "kept in the signature so legacy callers don't fail to compile".
- `"no longer used"`: Drawer.tsx:63 and :89 (both the `onResetLocalState` prop — see §3).
- `"not yet"`: App.tsx:781 only ("Entries downvoted but not yet hidden" — the Voted tab backlog; a data comment, not an unfinished marker).
- `"legacy"`:
  - Drawer.tsx:65 (dead prop kept for "legacy callers").
  - Toast.tsx:39-43: `toast(message, kind)` is the "legacy" signature; still used (FeedManager.tsx:904, 907; App.tsx:2831). Not dead.
  - Card.tsx:745-752: context-menu falls back to "legacy onHide path" when `onHideToggle` is not wired — "for any external consumers". Not dead inside this repo but a second code path.
  - FeedManager.tsx:1440: comment about legacy `Source.sitemap_url` column semantics (backend data).
  - lib/preferences.tsx:226-339: `LEGACY_STORAGE_KEYS` one-time localStorage → server-preferences migration (intentional, keep).
  - api.ts:23: old.reddit.com described as "Reddit's legacy desktop site" (backend fetch rationale).
- `"future"` (UI-relevant ones):
  - Card.tsx:61-66 and App.tsx:1562-1565: hidden set is "reversible only by clearing the hidden set (a future 'show hidden' affordance in Settings)" — stale: the Hidden tab with per-row Restore exists (Settings.tsx:374-380, props `onRestoreHidden`/`onRestoreAllHidden` Settings.tsx:84-88).
  - api.ts:818-826: `deletePreference` "Not currently called by the frontend; included for completeness (e.g. a future 'reset all preferences' button)" — dead API client method.
  - FeedManager.tsx:1748-1757: `data-test-result` attribute is "the hook a future test could use … not load-bearing".
  - Card.tsx:1452-1459, Column.tsx:155-167: memo comparators ignore callback identity; "If a future caller starts passing callbacks that close over mutable refs, lift this to a stable ref" — a constraint on how new callbacks (autosave handlers etc.) may be passed to Column/Card.
  - Column.tsx:262-275: header click guard because "any future control added to the popover has to remember to opt out" — the whole column header is a mark-all-read button.
  - lib/preferences.tsx:771-776 caps; :473 and :810 unknown-key forward-compat; interactions.ts:180-182 dedup note; App.tsx:186, 1147, 1382, 1722; BriefCard.tsx:182, 260, 336, 351, 780 (parser/SSR notes) — none affect the agreed scope.
- `"later"`: all hits are "Save for later" UI strings, "try again later" error strings, or timing comments (Card.tsx:69, 759-763, 1028, 1100, 1141, 1390-1392; Settings.tsx:1598; Column.tsx:108, 621; App.tsx:1636, 1834, 1852, 2198, 2468, 2489, 2574, 2628, 2765; Toast.tsx:130; Skeleton.tsx:3; api.ts:490, 553; storage.ts:35; preferences.tsx:11, 454, 504). No deferred-work marker.
- `"no longer"` (stale-comment hits): Card.tsx:34 (letter tile no longer drawn — correct), Drawer.tsx:25-28 (settings moved out — correct), Column.tsx:306, styles.css:53, App.tsx:511/521, preferences.tsx:221, BriefCard.tsx:776.
- `"unused|dead|deprecated|obsolete|vestig|leftover|stub"`: Drawer.tsx:359-361 comment that `savePreset` "callback in App was dead code before this row was added" (now live via the Save current view row 362-379); Card.tsx:17/276/614 "dead zone" is the swipe gesture threshold; api.ts:138, 407 unrelated.

## 3. Dead props, callbacks, attributes and config

1. `Drawer` prop `onResetLocalState` — declared Drawer.tsx:61-66 ("No longer used by the Drawer itself (the action moved to Settings) but kept in the signature so legacy callers don't fail to compile"), destructured to `_onResetLocalState` Drawer.tsx:89-92, still passed by App.tsx:2810. The only live reset path is Settings (prop Settings.tsx:78-80, call Settings.tsx:414, wired App.tsx:2846).
2. `data-settings-gear` attribute on the gear button App.tsx:2309 — no other occurrence in frontend/ or backend/ (grep). Dead.
3. Tailwind `sheetUp` keyframe tailwind.config.js:94-100 and `'sheet-up'` animation :115-116, commented "used by the Drawer on mobile. Slides up from the bottom edge". No `animate-sheet-up` / `sheet-up` usage in frontend/src (grep). The Drawer actually uses `transition-transform` + `translate-x-full` (Drawer.tsx:290-294). Dead config.
4. `api.deletePreference` api.ts:818-826 — never called.
5. `KNOWN_BUILT_INS` FeedManager.tsx:108-115 hardcodes 6 names; backend registers 7 plugin classes: cisa_kev (backend/app/sources/cisa_kev.py:55), github_releases (github_releases.py:153), hn_top (hn.py:59), nvd_recent (nvd.py:74), rfd_hot_deals (rfd.py:177), bbc_news (rss.py:539), wikipedia_on_this_day (wikipedia_on_this_day.py:68). `rfd_hot_deals` is missing, so its row shows no "built-in" badge and its name/url are editable client-side although the backend rejects that with 400 (routes/sources.py:762-770). `Source` (api.ts:117-147) has `type: string` (:120) but no `builtin` flag; `SourceOut` (schemas.py:12-…) has none either.
6. Settings tab allow-list duplicated three times: App.tsx:409-418, Settings.tsx:40-48 (type), Settings.tsx:229 (array). A tab rename/regroup must change all three.
7. Stale comments that describe a UI that no longer exists (misleading to anyone editing): Drawer.tsx:257-261 ("Mobile: bottom sheet, slides up to fill the viewport … Desktop (md+): slides in from the left as a 360px sidebar") vs actual right-anchored translate-x panel Drawer.tsx:286-294; Drawer.tsx:4-5 says "88vh" but the class is `h-full` (:287); Drawer.tsx:210 "slide-up animation"; Settings.tsx:3 "slides up from the bottom on mobile" and :5 "The four tabs" (there are eight, Settings.tsx:40-48, 106-115); Settings.tsx:16 and App.tsx:386, 401 list a tab union missing history/starred/voted; App.tsx:2299-2302 gear comment "tabs for feeds / LLM / notifications / reset"; FeedManager.tsx:1 "Phase 5 FeedManager — Drawer section" (it lives in Settings since the Drawer slim-down).

## 4. Recorded UI rationale the redesign would reverse or must consciously override

### Top bar (owner item 5)
- App.tsx:2211-2219: hamburger on the trailing edge "matches iOS where leading space is reserved for the title and the trailing chrome owns the actions"; on mobile "the trailing controls are stripped (the icons only would crowd the small viewport)".
- App.tsx:2299-2304: "Settings gear. … Lives to the LEFT of the hamburger so the hamburger keeps its right-edge position; the two together read as 'more menu options → main menu.'" Button App.tsx:2305-2329, `onClick={() => openSettings('feeds')}` :2307, `aria-label="open settings"` :2308.
- App.tsx:2282-2288: standalone refresh icon is mobile-only (`sm:hidden`, :2294) "so mobile users can manually force a refresh without having to open the Drawer (the only Refresh path on mobile before this fix — one extra tap the user shouldn't have to make)".
- App.tsx:2336-2340: desktop sub-row (health, Refresh, Brief, UserBadge; `hidden sm:flex` :2341) "Hidden on mobile because the actions duplicate what the Drawer already offers — opening the Drawer takes one tap." Note: UserBadge sign-out is only in this sub-row (App.tsx:2362).
- Hamburger.tsx:5-10: 44x44 target, SF Symbols weight; `aria-label="open menu"` :15. Drawer.tsx:272-275 focus trap looks up `button[aria-label="close menu"]`; Drawer.tsx:3-9: panel is right-anchored "so tapping the hamburger makes the panel grow from beneath the tap target — no eye-jump".
- Drawer.tsx:25-28 and :102-104: "Feeds / LLM / Notifications / Reset are no longer in the Drawer — they moved to the Settings overlay … The Drawer stays slim so it's a quick filter panel, not a settings pile. Tap 'All settings…' to open the full Settings." The "All settings…" row is Drawer.tsx:380-389 (title :387, subtitle :388), History deep-link row :336-352 (`onOpenSettings('history')` :345), Save current view :362-379, Jump to column :391-407, Sources filter :409+.
- Settings.tsx:1-13: every settings tab is annotated "moved from Drawer". Settings.tsx:20-25: "Why a separate overlay (not a route + nested layout): … adding a router just for this would balloon the bundle. The URL param trick gives us 'back closes the overlay' for free."
- Settings.tsx:206-209 and Drawer.tsx:306-312: Done on the LEFT, title on the RIGHT "(matches the Drawer's right-anchored panel)"; Done is `min-h-[32px] min-w-[32px]` (Settings.tsx:215, Drawer.tsx:319).
- Settings.tsx:223-227: pill tab strip because "Eight icon-only cells didn't fit a phone with their labels, and icons alone left the reader guessing."
- Settings.tsx:200-203: desktop panel is 480px "because the LLM tab needs room for the provider/model pickers and the Feeds tab's add-custom form has a wide textarea."
- Settings tab switching: Settings.tsx:236-246 writes `replaceState` then `window.dispatchEvent(new Event('popstate'))` ("The custom event is simpler and keeps the API minimal"); App.tsx:394-428 parses `?view=settings&tab=`; `openSettings` pushState App.tsx:430-437; `closeSettings` pushState (not back) App.tsx:438-444.

### Feed editor (owner items 1, 3)
- FeedManager.tsx:1-32 header: three tabs My feeds / Recommended / Add custom; :21-23 "Errors flow up to App's red banner via onError so the visual treatment matches refresh failures — single, consistent error surface across the dashboard" (the banner App.tsx:2399+ sits under the z-50 Settings sheet, Settings.tsx:189).
- Entry path today: gear (App.tsx:2307) → Feeds tab → tap row (FeedManager.tsx:684-690) → "edit" link (:795-802) → inline form (:567-677) → "save" link (:657-663, `text-ios-caption` text button) / "cancel" (:664-670). `saveEdit` FeedManager.tsx:508-565: diff-only PATCH body (:538-547), no-op closes the form (:518-526), rename bubbles `onRenamed` (:555-560) so App remaps filter chips (Props comment :43-47).
- Only one row may edit at a time and interval-edit is mutually exclusive with metadata-edit: `editingInterval`/`editingRowId` lifted to FeedManager.tsx:214-215, rationale :306-310, wiring :324-337. Refresh interval is NOT in the edit form; it is a separate inline `<select>` on the open row (FeedManager.tsx:824-847, cancel :848-856) — `REFRESH_PRESETS` :57-62 with rationale :53-56 "Keeps the UI to a single choice rather than a freeform input — typos would silently break scheduling otherwise."
- Edit form fields FeedManager.tsx:568-572: "The fields mirror what's editable via PATCH (name + url + category). url is locked for built-ins because the backend rejects it with a 400 anyway" (name/url disabled when `builtIn` :579, :591; hint :596-598). URL-change warning "⚠ favicon resets" :671-675.
- Input sizing in the form: `px-2 py-1 text-ios-body` inputs (:581, :593, :609); 11px uppercase labels (:575, :588, :604, :632); 10px helper/error text (:597, :645, :650).

### Category (owner item 2)
- `CATEGORY_OPTIONS` FeedManager.tsx:80-100 is a static list (16 values) with rationale :74-79: "Free-form text is also accepted in the backend (the column is just a 40-char string), but a dropdown is friendlier than asking the user to type 'tech' vs 'news' — and it matches existing column groupings"; ordering rationale :91-94 (work set first, leisure after).
- Edit form uses `<input type="text" list="feed-category-options">` + `<datalist>` of the static list (FeedManager.tsx:605-618); the Add form uses a plain `<select>` of the same static list (:1721-1732). Neither is fed from the user's actual `sources[].category` (available: `sources` prop FeedManager.tsx:41, Settings.tsx:57-59; `categories` computed in App and passed to Drawer App.tsx:2803).
- Backend: `_validate_category` routes/sources.py:287-304 (non-empty, `<= _CATEGORY_MAX` = 40 per models.py:46, reserved names `{"saved","for you"}` :162 case-insensitive). The route validates the stripped value but passes `body.category` unstripped to `scheduler.update_source` (:779), which stores it verbatim (scheduler.py:2376-2377). Category is matched to columns by exact string (Drawer/App use raw names; labels.ts only affects display).

### Custom headers (owner item 4)
- FeedManager.tsx:446-451: JSON textarea kept "as a string rather than a parsed object because the user expects to see exactly what they typed, and showing parsed keys back to them in a different order would feel broken." Live JSON parse :477-498; error state :499-506; Save disabled when invalid :659.
- FeedManager.tsx:620-629: hidden for built-ins; "`User-Agent` is the only override anyone realistically needs (CBC blocks our default UA), but the textarea lets power users add e.g. `Accept-Language` for region-gated feeds." Textarea :635-643 (`rows={3} font-mono text-ios-caption`, placeholder `{"User-Agent": "Mozilla/5.0 ..."}`), helper "sent on every fetch; clear to use defaults" :649-653.
- FeedManager.tsx:171: the 403 error hint says "Try adding a User-Agent header (Advanced → Custom headers)" — no such "Advanced" section exists; the field is labelled "custom headers (JSON)" (:633).
- api.ts:424-440: `custom_headers?: Record<string,string> | null`; comment :434-437 says send `{}` to clear, but the backend normalizes both `{}` and `null` to NULL (routes/sources.py:306-311; scheduler.py:2400-2403).
- Backend validation routes/sources.py:306-345+: must be an object; max entries `_CUSTOM_HEADERS_MAX`; keys and values strings; denylist (case-insensitive) cookie/authorization/host :169 plus x-forwarded-*/x-real-ip/x-original-url/x-rewrite-url :177-187; value length `_HEADER_VALUE_MAX`; CRLF/control-char rejection. Blank keys are not rejected (no check between :326-329).
- Headers are stored-but-ignored for generic_scrape (route comment routes/sources.py:706-712) and for reddit rows (plan working note citing dynamic_reddit.py:171).

### Autosave implications (owner item 3) — backend behaviour on PATCH
- `scheduler.update_source` (scheduler.py:2267): early-return when nothing changed (guard ~2353-2365, "All eight fields participate"); otherwise commit, then for any non-built-in row that is active it calls `_add_or_replace_dynamic_job(_scheduler, row, stagger=False)` (scheduler.py:2462-2469, comment "a user re-enabling or editing a source expects the next ingest to run right away"). `_add_or_replace_dynamic_job` (:2101) passes `next_run_time=first_run` (:2144) = now when `stagger=False`. So a category-only or headers-only PATCH on an active custom feed triggers an immediate fetch. Built-in rows skip the job logic (:2447-2449); `active=False` removes the job (:2451-2460).
- Route guards: name validated and must not collide with a plugin name (:674-684); URL re-resolved through Apple Podcasts and YouTube resolvers and type-aware validation (:685-704); built-in rename/re-URL → 400 (:762-770); IntegrityError → 409 (:786-795).

### Other recorded choices in scope of the sweep
- `window.prompt` for naming a view App.tsx:2812-2829 ("A custom modal would be 80 lines of code and not noticeably better UX") and renaming App.tsx:306; `window.confirm` for reset Settings.tsx:413.
- Add-custom Name field expects a slug (`placeholder="my_blog"` FeedManager.tsx:1537, hint "lowercase letters, digits, underscore" :1541); subtype radios instead of a dropdown "a dropdown would work but adds a click and hides the most common choice (RSS)" :1543-1553.
- Search input `type="search" inputMode="search"` App.tsx:2235-2236 (native clear button plus the app's own :2250-2262).
- Column header is itself the mark-all-read button with a stopPropagation guard (Column.tsx:262-275).
- Toast legacy signature kept (Toast.tsx:38-43).

## 5. Tests that pin frontend source text (a rewrite must update them in the same PR)
- backend/tests/test_frontend_slice15_add_generic_scrape.py: reads FeedManager.tsx (:55-59); asserts `"sourceType === 'podcast'"` and `"sourceType === 'youtube_channel'"` (:158-159), `"couldn't find a feed"` and `"Track this URL anyway"` (:242-245), every sourceType literal (:316), and reads api.ts (:333).
- backend/tests/test_source_create_sitemap_link_pattern.py: reads api.ts and FeedManager.tsx (:40-45); asserts `setSitemapUrl`, `setLinkPattern`, `onChange={(e) => setSitemapUrl`, `onChange={(e) => setLinkPattern`, `{sourceType === 'generic_scrape' && (` (:204-235).
- backend/tests/test_frontend_slice19_empty_column_source_status.py: reads Column.tsx and App.tsx (:36-45); asserts `sourcesByName` (:61, :111-116), `"no entries in this column yet"`, `last_error`, `error_count`, `last_fetch_at` (:84-90), and at least two `<Column` call sites in App.tsx (:139).
- backend/tests/test_source_vote_scores.py:3 mentions FeedManager only in a docstring.

## 6. Verification facts
- REDESIGN_PLAN.md §13 (branch claude/redesign-plan): `npm run lint` (0 errors, 6 warnings), `npx tsc --noEmit`, `npm run build` pass; Playwright + Chromium available; no Docker/Postgres so backend pytest only in CI; youtube.com blocked by the proxy. Audit scripts at frontend/scripts/iphone-audit/ (run.sh, capture.cjs, probe.cjs, analyze.cjs, fixtures.cjs).
- `animate-fade-in` is used in 4 places in frontend/src; `sheet-up` in none.

#### Constraints
- Settings tab identity is URL state: App.tsx:394-428 parses ?view=settings&tab= with an explicit allow-list (App.tsx:409-418); openSettings pushState App.tsx:430-437; Settings.tsx:236-246 switches tabs via replaceState + synthetic popstate; the tab union is duplicated at Settings.tsx:40-48 and Settings.tsx:229 — any new/renamed tab must change all three places; Drawer deep-links by tab id at Drawer.tsx:345 and :384.
- Stacking order to keep: header z-20 (App.tsx:2210) < Drawer backdrop z-30 (Drawer.tsx:252) < Drawer panel z-40 (Drawer.tsx:286) < Settings z-50 (Settings.tsx:189); Toast is rendered after Settings (App.tsx ~2834+).
- Drawer focus trap finds its first focusable via button[aria-label="close menu"] (Drawer.tsx:272-275); Hamburger uses aria-label="open menu" (Hamburger.tsx:15) — renaming either label must update both.
- Mobile Settings sheet must stay pinned by its top edge with env(safe-area-inset-top), never a vh height (Settings.tsx:197-204, PR #11), and keep env(safe-area-inset-bottom) at the bottom (Settings.tsx:263).
- On touch screens every input/textarea/select is forced to 16px !important (styles.css:22-24); new controls must be designed at >=16px so that rule can be removed without reintroducing focus zoom.
- PATCH surface is api.updateSource(id, { refresh_interval_seconds?, active?, category?, name?, url?, custom_headers? }) (api.ts:424-440); custom_headers is a flat string->string map; null and {} both clear it (routes/sources.py:306-311).
- Any effective PATCH on an active non-built-in feed rebuilds its scheduler job with next_run_time=now (scheduler.py:2462-2469 -> _add_or_replace_dynamic_job scheduler.py:2101, :2144), including category-only or headers-only changes; autosave must send one PATCH per committed change (blur/picker change), never per keystroke, or add a backend skip for category/headers-only changes.
- Backend category rules: non-empty, <=40 chars (models.py:46, routes/sources.py:287-304), reserved names 'saved' and 'for you' case-insensitive (routes/sources.py:162); the route persists body.category unstripped (routes/sources.py:779) — strip once in the route or client.
- Custom header rules: object only, max entries _CUSTOM_HEADERS_MAX, string keys/values, denylist cookie/authorization/host and x-forwarded-*/x-real-ip/x-original-url/x-rewrite-url (routes/sources.py:169-187, :326-331), value length _HEADER_VALUE_MAX, no CRLF/control chars; blank keys are not rejected server-side (routes/sources.py:326-329) so a key/value editor must drop blank rows.
- Built-in (plugin) rows cannot be renamed or re-URLed (routes/sources.py:762-770 -> 400) but can be paused/re-categorized; the backend registers 7 plugin names (cisa_kev.py:55, github_releases.py:153, hn.py:59, nvd.py:74, rfd.py:177, rss.py:539, wikipedia_on_this_day.py:68) while FeedManager.tsx:108-115 hardcodes 6 (rfd_hot_deals missing); api.ts Source (117-147) has type but no builtin flag.
- Renaming a feed must keep bubbling oldName->newName so App remaps active filter chips in the same render (FeedManager.tsx:43-47, :555-560; Settings.tsx:74-77 onSourceRenamed; App.tsx:2845).
- Column.tsx:155-167 and Card.tsx:1452-1459 memo comparators ignore callback identity; new callbacks passed into Column/Card must depend only on data props or stable refs (App.tsx:1535-1560 reads readEntriesRef for this reason).
- Backend wire tests grep frontend source for literal strings and will fail CI if a rewrite removes them: test_frontend_slice15_add_generic_scrape.py:55-59,158-159,242-245,316,333; test_source_create_sitemap_link_pattern.py:40-45,204-235; test_frontend_slice19_empty_column_source_status.py:36-45,61,84-90,111-139.
- Desktop/phone breakpoint is md (768px) for the Settings panel (Settings.tsx:204-205, 480px wide) and the Drawer (Drawer.tsx:289, 360px); the header sub-row and the standalone mobile refresh icon switch at sm (App.tsx:2294, :2341).
- Security scope from REDESIGN_PLAN.md §2: PRs may touch frontend/src, backend/app/youtube.py, backend/app/routes/sources.py, backend/tests, README, .env.example only; not docker-compose.yml, nginx.conf.template, .github, egress-proxy or ops.

#### Findings
- [high] frontend/src/components/Drawer.tsx:66: Prop onResetLocalState is dead: comment at 61-65 says it is 'No longer used by the Drawer itself … kept in the signature so legacy callers don't fail to compile'; destructured to _onResetLocalState at 92; the only caller is App.tsx:2810. Fix: Remove the prop from Drawer Props and destructuring and drop the App.tsx:2810 wiring in the top-bar PR; Settings keeps its own onResetLocalState (Settings.tsx:78-80, :414).
- [high] frontend/src/App.tsx:2309: data-settings-gear attribute has no other reference anywhere in frontend/ or backend/ (grep), so it is dead markup. Fix: Delete the attribute when the gear button is removed or merged into the single top-bar button.
- [high] frontend/tailwind.config.js:94: sheetUp keyframe (94-100) and 'sheet-up' animation (115-116) are commented as 'used by the Drawer on mobile' but no animate-sheet-up/sheet-up class exists in frontend/src; the Drawer uses translate-x transitions (Drawer.tsx:290-294). Fix: Remove the keyframe and animation entry, or use it deliberately if the redesign introduces a bottom sheet.
- [high] frontend/src/components/FeedManager.tsx:108: KNOWN_BUILT_INS hardcodes 6 plugin names; the backend registers 7 (rfd_hot_deals at backend/app/sources/rfd.py:177 is missing), so the RFD row gets no built-in badge and editable name/url fields that the backend rejects with 400 (routes/sources.py:762-770). Fix: Add a builtin boolean to SourceOut (backend/app/schemas.py:12) computed from registered_plugin_names(), expose it on api.ts Source (117-147), and delete the client-side set.
- [high] frontend/src/components/FeedManager.tsx:605: Category in the edit form is a free-text input with a datalist of the static CATEGORY_OPTIONS (80-100); the Add form uses a select of the same static list (1721-1732). Neither lists the categories the user actually has (sources[].category is available via the sources prop at FeedManager.tsx:41). Fix: Build the picker options from the distinct categories in sources (plus an 'Add new category…' entry), falling back to CATEGORY_OPTIONS for an empty install; reject the reserved names 'saved'/'for you' client-side (routes/sources.py:162).
- [high] frontend/src/components/FeedManager.tsx:635: Custom headers are edited as a raw JSON string in a 3-row monospace textarea (635-643) with JSON parse errors shown to the user (644-648); rationale at 446-451 and 620-629 is about preserving typed text order and letting power users add Accept-Language. Fix: Replace with a key/value row editor (header name select/combobox with User-Agent and Accept-Language presets, value field, add/remove row), serialize to the flat map api.ts:438 expects, drop blank rows before PATCH, and hide for built-in, reddit and generic_scrape rows (routes/sources.py:706-712).
- [high] frontend/src/components/FeedManager.tsx:657: The edit form commits only through a 'save' text link (657-663, text-ios-caption, no min-height) next to 'cancel' (664-670); nothing autosaves. Rows also require tap-to-open (684-690) then an 'edit' link (795-802) before the form appears. Fix: Save each field on blur/change via api.updateSource with a diff-only body (keep the pattern at 538-547), one PATCH per committed change because the backend reschedules an immediate fetch on every effective PATCH (scheduler.py:2462-2469); drop the save/cancel links and the edit link.
- [high] frontend/src/components/FeedManager.tsx:171: The 403 error hint tells the user to open 'Advanced → Custom headers', a section that does not exist; the field is labelled 'custom headers (JSON)' at 633. Fix: Point the hint at whatever the new header editor is called, or offer a one-tap 'Use a browser User-Agent' fix from the error.
- [high] frontend/src/App.tsx:2299: Comment 2299-2304 records the rationale for the gear: 'Lives to the LEFT of the hamburger so the hamburger keeps its right-edge position; the two together read as more menu options → main menu'. The Drawer then also offers 'All settings…' (Drawer.tsx:380-389) and a History deep link (336-352), which is the duplication the owner reported. Fix: Merge into one top-bar button; if the Drawer survives as the single menu, remove the gear and keep Drawer.tsx:380-389 as the Settings entry; if Settings becomes the single destination, fold the Drawer's Sources filter and Save view rows into it and update the stale comments (Drawer.tsx:3-9, 25-28, 257-261; Settings.tsx:1-13; App.tsx:2211-2219, 2336-2340).
- [medium] frontend/src/App.tsx:2282: Comments 2282-2288 (mobile-only refresh icon exists 'without having to open the Drawer') and 2336-2340 (desktop sub-row hidden on mobile 'because the actions duplicate what the Drawer already offers') tie the number of top-bar buttons to the Drawer's existence; sign-out (UserBadge App.tsx:2362) exists only in the desktop sub-row. Fix: When collapsing to one button, decide explicitly where Refresh, Brief and Sign out live on the phone (pull-to-refresh or inside the single menu) and update these comments.
- [high] frontend/src/components/Drawer.tsx:257: Comment 257-261 describes a bottom sheet that slides up on mobile and a left sidebar on desktop; the actual panel is right-anchored with translate-x (286-294). Header comment at 4-5 says 88vh but the class is h-full (287); 210 mentions a 'slide-up animation'. Fix: Rewrite or delete these comments in whichever PR touches the Drawer so the next editor is not misled.
- [high] frontend/src/components/Settings.tsx:3: Header comment says the sheet 'slides up from the bottom' (3) and lists 'The four tabs' (5-13); there are eight tabs (40-48, 106-115) and the sheet is top-edge pinned (197-204). App.tsx:386 and :401 also list a stale tab union. Fix: Export one SETTINGS_TABS array with labels and use it in App.tsx:409-418, Settings.tsx:40-48 and :229; fix the comments.
- [high] frontend/src/components/Card.tsx:66: Comment (61-66) and App.tsx:1562-1565 say hidden entries are reversible only by 'a future show hidden affordance in Settings', but the Hidden tab with Restore exists (Settings.tsx:374-380, props 84-88). Fix: Update both comments to name the Hidden tab.
- [medium] frontend/src/api.ts:818: deletePreference is documented as 'Not currently called by the frontend; included for completeness (e.g. a future reset all preferences button)'. Fix: Leave as-is unless the Reset tab is reworked to clear server preferences; then wire it or delete it.
- [medium] frontend/src/api.ts:434: Comment says send {} to clear custom_headers; the FeedManager sends null (FeedManager.tsx:482, :547) and the backend maps both {} and null to NULL (routes/sources.py:306-311). Fix: Standardize on null in the new editor and correct the api.ts comment.
- [high] backend/app/scheduler.py:2462: Any effective change to an active dynamic row, including category-only or headers-only, re-adds the job with stagger=False so next_run_time is now (2101, 2144); an autosaving editor that PATCHes on each change would trigger a fetch per change. Fix: Either PATCH only on commit (blur/picker change) or add a backend condition that skips _add_or_replace_dynamic_job when only category changed (headers do affect the fetch, so a rebuild there is defensible).
- [high] backend/app/routes/sources.py:779: _validate_category checks value.strip() (287-304) but the route passes body.category unstripped to scheduler.update_source, which stores it verbatim (scheduler.py:2376-2377); a trailing space creates a new column that labels.ts cannot distinguish. Fix: Strip once in the route (and in the POST paths at 518/617 per the plan's note) before persisting.
- [high] backend/tests/test_frontend_slice15_add_generic_scrape.py:158: Backend wire tests grep FeedManager.tsx, api.ts, Column.tsx and App.tsx for literal source strings (this file 158-159, 242-245, 316, 333; test_source_create_sitemap_link_pattern.py:204-235; test_frontend_slice19_empty_column_source_status.py:61, 84-90, 111-139); a FeedManager rewrite that renames state setters or strings turns CI red. Fix: Update or replace these tests in the same PR as the editor rewrite; prefer testing the API contract over source text.

### Verification recipe for UI and backend changes inside the Claude Code cloud container (frontend lint/typecheck/build, iPhone screenshots against a mocked API, backend pytest, CI gates, PR conventions)

## Scope and state of the checkout
- Branch `claude/redesign-plan` = origin/main 721713e (PR #12) + plan commits. The only code difference from main is the new `frontend/scripts/iphone-audit/*` (run.sh, capture.cjs, fixtures.cjs, probe.cjs, analyze.cjs, README.md, .gitignore) and REDESIGN_PLAN.md (`git diff --stat origin/main..HEAD`).
- I ran every command below in this container. Afterwards the working tree is clean (`git status`). I cleaned up the audit outputs with `git clean -fdX frontend/scripts/iphone-audit/` and stopped every vite process I started. A Postgres server started earlier in this session (data dir `/var/lib/postgresql/popping-test`) is still running. I left it running.

## 1. Frontend commands (the same as CI's `frontend-checks` job)
- Scripts: `dev` = `vite --host 0.0.0.0` (frontend/package.json:7), `prebuild` = `node scripts/check-html-comments.mjs` (package.json:8), `build` = `tsc && vite build` (package.json:9), `lint` = `eslint .` (package.json:10), `preview` = `vite preview --host 0.0.0.0` (package.json:11). `"type": "module"` (package.json:5).
- No test script and no test dependency: devDependencies are package.json:17-32 (eslint, typescript, vite, tailwind, and so on). There are no Playwright, Vitest, Jest or testing-library packages, and no `*.test.*` files under frontend/src.
- Typecheck: `tsc` uses `noEmit: true` (tsconfig.json:12), `strict` (tsconfig.json:14) and `include: ["src"]` (tsconfig.json:19). Files under `frontend/scripts` are **not** typechecked. `npx tsc --noEmit` repeats what `npm run build` already does.
- Lint: flat config with `ignores: ['dist']` (eslint.config.js:24). Rules apply only to `**/*.{ts,tsx}` (eslint.config.js:27) with browser globals (eslint.config.js:30). `exhaustive-deps`, `only-export-components` and `no-unused-vars` are warnings (eslint.config.js:38, 39, 46). `.cjs` scripts are linted with no rules.
  - Baseline measured now: **0 errors, 6 warnings** (App.tsx:1979, Column.tsx:17, SourceIcon.tsx:44, Toast.tsx:48, preferences.tsx:157 and 757).
  - Warnings never fail, because there is no `--max-warnings` (package.json:10).
- Prebuild guard: fails the build on a `/* */` outside `<style>` in index.html (scripts/check-html-comments.mjs:30, 81).
- Timings measured here: `npm ci` 220 packages in 3 s; lint 4.5 s; tsc 4.2 s; build 6.6 s (vite 5.4.21; output dist/static/*, because `assetsDir: 'static'` at vite.config.ts:62).
- CI runs exactly `npm ci`, `npm run lint` and `npm run build` on Node "22" (.github/workflows/build.yml:109-117). The Docker image also runs `npm ci` and `npm run build` on node:22.20-alpine (frontend/Dockerfile:3, 10, 14).

## 2. What the backend "frontend" tests are
- backend/tests/README.md:10-25 describes them as Python regex checks on TS/TSX source text, marked `@pytest.mark.no_db`. They are not browser tests. The real frontend check is the TS build in CI (README.md:17-22). If Vitest or Jest is ever added, they should move there (README.md:24-25).
- test_frontend_slice15_add_generic_scrape.py reads `frontend/src/components/FeedManager.tsx` (line 55) and `frontend/src/api.ts` (line 333). It asserts literal source patterns:
  - the `useState<'rss'|'reddit'|'podcast'|'youtube_channel'|'generic_scrape'>` union (68-78)
  - `<input type="radio" name="fm-type" value="generic_scrape"` inside a `<label>` containing "no RSS" and "Track page" (87-135)
  - a `useEffect(() => {...}, [name, url, sourceType])` with `new URL(trimmedUrl)` (169-188)
  - `htmlFor="fm-url"` label ternary (197-208); placeholder `'https://example.com'` (212-230)
  - "couldn't find a feed" / "Track this URL anyway" (240-255)
  - `const trackAnyway = async () => {...}` calling `api.createSource` with `type: 'generic_scrape'` and the slug ops (264-305)
  - the `testSource` body type union in api.ts (325-341)
- test_frontend_slice19_empty_column_source_status.py reads Column.tsx and App.tsx (lines 36-37). It asserts:
  - a `sourcesByName?: Map<` prop (54-66)
  - "no entries in this column yet", last_error, error_count and last_fetch_at (74-90)
  - at least 2 `<Column` call sites in App.tsx passing `sourcesByName=` (127-145)
  - `.slice(0, N)` truncation (152-163)
- Other source-text guards that also pin files the redesign touches:
  - test_slice21_column_memo.py (Column.tsx/App.tsx, lines 39-40: `export const Column = memo(ColumnInner`, `useCallback(` handlers)
  - test_slice30_safe_external_url.py (api.ts/Card.tsx, lines 36-37)
  - test_source_create_sitemap_link_pattern.py (FeedManager.tsx at line 41: `setSitemapUrl`, `setLinkPattern`, `{sourceType === 'generic_scrape' && (`, `sitemap_url: ` and `link_pattern: ` at 199-275)
- All 73 tests in these 5 files pass now (0.17 s).

## 3. Playwright in this container (verified)
- Node v22.22.0 and npm 10.9.4 at /opt/node22/bin.
- `/opt/node22/bin/playwright` links to /opt/node-tools/node_modules/.bin/playwright, Version 1.56.1. Its browsers.json needs chromium revision 1194, which is installed at /opt/pw-browsers/chromium-1194 together with chromium_headless_shell-1194.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is already in the environment.
- `NODE_PATH=/usr/local/lib/node_modules_global` makes `require('playwright')` resolve to /opt/node-tools/node_modules/playwright/index.js from any directory, and `require('playwright/test')` works too.
- **ESM `import('playwright')` fails with ERR_MODULE_NOT_FOUND**, because ESM ignores NODE_PATH. Scripts must therefore be `.cjs` (frontend/scripts/iphone-audit/README.md:24) unless Playwright becomes a local devDependency.
- No WebKit or Firefox is installed. The browser download hosts (cdn.playwright.dev, playwright.download.prss.microsoft.com, playwright.azureedge.net) fail the proxy tunnel, so `npx playwright install` cannot work. registry.npmjs.org is reachable (`npm view @playwright/test@1.56.1` and `vitest` both work).
- The `playwright` npm package has no install/postinstall script, so `npm ci` with it as a devDependency downloads no browsers.
- The Playwright CLI `screenshot` command has `--device`, `--browser` and `--color-scheme`, but no request routing. It cannot mock `/api`, so use a Node script that calls `context.route`.

## 4. Mocking the API so screenshots need no backend (verified)
- In both dev and preview, Vite proxies `/api`, `/assets` and `/auth` to `VITE_BACKEND_URL || http://localhost:8000` (vite.config.ts:8, 21, 28, 35, 68, 74). Production nginx proxies the same three prefixes (nginx.conf.template:11).
- `context.route` answers these requests inside the browser, so Vite never sees them and no backend is needed.
- frontend/scripts/iphone-audit/capture.cjs exports `mockApi`, `scanDom`, `IOS_UA`, `DEVICES` and `BASE` (capture.cjs:560). `main()` is guarded by `require.main` (capture.cjs:562), so other scripts can reuse the mock.
  - The mock covers every path literal in api.ts. `/auth/me` returns 404, which api.ts:762-767 treats as "OIDC not enabled" (App.tsx:1213 probe). This produces one expected console error, "Failed to load resource: 404".
  - `/api/sources/:id` echoes the PATCH body merged into the fixture (capture.cjs:91-96). Unmocked paths are logged as `!! UNMOCKED` and return 404 (capture.cjs:163-164).
- A new, minimal script reusing that mock against the **vite dev server** (no build) took 11 s for 2 screenshots at 390x844@3x. It reported `pointer:coarse` true, body scrollWidth 390/390, 0 fields under 16 px and 0 page errors.
  - Dev mode is fine for screenshots. It is not fine for the CSP check (see section 6).
- The full audit `bash frontend/scripts/iphone-audit/run.sh` worked: 3 min 50 s, 44 PNGs plus `<w>-overflow-scan.json`, summary.json, analysis.txt and probe-output.json.
  - It rebuilds first (run.sh:12) and serves dist with `npx vite preview --port 4173` (run.sh:13).
  - Defects found in it:
    - It always exits 0. capture.cjs only exits non-zero on an exception (capture.cjs:562-567), so it is an audit, not a gate.
    - **It leaks the preview server.** `PREVIEW_PID=$!` (run.sh:14) is the `npx` wrapper, so the `trap kill` (run.sh:15) leaves `node .../vite preview --port 4173` orphaned with PPID 1. I observed this as PID 9739 and killed it. Because there is no `--strictPort`, the next run's preview silently moves to another port while capture.cjs keeps hitting 4173 (capture.cjs:23).
    - At 320, state 09-search reports `pointerCoarse=false`, and it did so in two separate full runs. A fresh 320 context with search open reports coarse=true, so the false reading is an artifact of the long capture session. The capture session calls `setViewportSize` for its "tall" variants (capture.cjs:428, 431).
  - Body scrollWidth 336 at 320 with search open is a real defect, reproduced in a fresh context. It is REDESIGN_PLAN.md item 2 (line 98).
- Every interaction selector in capture.cjs and probe.cjs is tied to today's UI. They will break when the top bar and the feed editor change:
  - capture.cjs:478 `open menu` (Hamburger.tsx:15)
  - capture.cjs:486 `open settings` (App.tsx:2308)
  - capture.cjs:487 dialog `settings` (Settings.tsx:188)
  - capture.cjs:488 `feed manager tabs` (FeedManager.tsx:226)
  - capture.cjs:494 `button[aria-expanded]` rows
  - capture.cjs:497 `edit refresh interval` (FeedManager.tsx:843)
  - capture.cjs:504 `edit ${name}` (FeedManager.tsx:802)
  - capture.cjs:505 `textarea` (FeedManager.tsx:635, the JSON headers box)
  - capture.cjs:511 `#fm-name`; capture.cjs:539 `close settings` (Settings.tsx:214); capture.cjs:541 `open search` (App.tsx:2276)
  - probe.cjs:27 and 37 `header > div.flex`
- The route regex `/\/(api|auth|assets)\//` (capture.cjs:53) is unanchored, so in dev it would also catch any future `/src/assets/...` or `/.../api/...` module URL. frontend/src has no such directory today.

## 5. Unit-test options
- Vitest needs vitest, jsdom/happy-dom and @testing-library/react. REDESIGN_PLAN.md:44 allows only "Playwright as a dev dependency only", so Vitest is out of scope without the owner's approval.
- A zero-dependency alternative works here: Node 22.22 runs `node --test` on `.ts` files with no flags (type stripping), and a trial test passed. CI's Node "22" (build.yml:111) is a current 22.x.
- Limits of that alternative:
  - The module under test must not import siblings without the `.ts` extension, because the app uses bundler resolution (tsconfig.json:8).
  - The test file should live outside `src`. tsc includes only src (tsconfig.json:19) and there is no @types/node (node_modules/@types has no `node`), so a `node:test` import inside src would fail `tsc`.
- Behaviour such as autosave (one PATCH per commit), a 422 response or a network failure is better tested in Playwright with the mocked API:
  - count `request` events with `method()==='PATCH'`
  - `page.route('**/api/sources/3', r => r.fulfill({status:422, contentType:'application/json', body: JSON.stringify({detail:'...'})}))`; page routes take precedence over context routes
  - `route.abort('failed')`
- api.ts turns non-2xx responses into `ApiError(message, body.detail)` (api.ts:273-285). updateSource is the PATCH at api.ts:439-443.

## 6. Production CSP check (verified)
- nginx sends a strict CSP (nginx.conf.template:29). vite preview sends none, so a CSP regression would ship unseen.
- Fulfilling HTML documents with that header via `route.fetch()` + `route.fulfill({response, headers:{...,'content-security-policy': CSP}})` against **preview**: cards render, and the only console error is the expected /auth/me 404.
- Against **dev** it fails ("Refused to execute inline script", "@vitejs/plugin-react can't detect preamble"). Run the CSP check against preview only.

## 7. Backend pytest in this container: it can run (corrects REDESIGN_PLAN.md:309 and :323)
- conftest imports `pytest_asyncio`, `sqlalchemy` and `app.db` at import time (backend/tests/conftest.py:54-60). Even no_db tests therefore need the app's dependencies. The bare uv-tool pytest fails with `ModuleNotFoundError: pytest_asyncio`.
- DB tests need Postgres with pgvector. Defaults are popping_test@localhost:5432 (conftest.py:30-34); `EMBEDDING_ENABLED=false` (conftest.py:43). The schema comes from `Base.metadata.create_all` (conftest.py:98-99). no_db is skipped by marker (conftest.py:66, 89-97, 147-149; pyproject.toml markers 106-109).
- Container facts:
  - Postgres 16 server binaries are installed (/usr/lib/postgresql/16/bin/initdb, pg_ctl, postgres). The default cluster 16/main is down.
  - pgvector is NOT preinstalled. The vector.so/vector.control present now (05:08:45) came from an earlier source build in this session. `apt-get install -s postgresql-16-pgvector` resolves to 0.6.0-1, which is enough: the app uses only `Vector(384)` columns (backend/app/models.py:146, 293, 472) and no hnsw/ivfflat/halfvec.
  - The Docker client exists but there is no daemon (no /var/run/docker.sock).
  - System python is 3.13.16. uv fetched CPython 3.12.13 this session.
  - download.pytorch.org returns 403 through the proxy. The lockfile excludes torch (requirements-dev.lock:289-309), and embeddings import sentence_transformers lazily (app/embeddings.py:104), so `uv pip install --no-deps -r requirements-dev.lock` is enough.
  - **No DNS**: resolv.conf points at 8.8.8.8, which is unreachable, and `python.org` does not resolve. app/url_safety.py:150 calls `socket.getaddrinfo`, so tests that POST example.com or reddit URLs fail unless /etc/hosts maps those names.
- Results:
  - With /etc/hosts patched: Python 3.12 venv full suite **623 passed in 24.7 s**; `-m no_db` 352 passed and 271 deselected in 4.4 s.
  - The 13 tests that failed earlier with the original hosts file now pass on Python 3.13 too (67/67 across their 6 files), so the hosts entries were the fix, not the Python version.
  - Without Postgres, DB tests error with `ConnectionRefusedError ('127.0.0.1', 5432)`.
- CI is still the authority: Python 3.12, `pgvector/pgvector:pg16` service, CPU torch, then `pytest -ra` (build.yml:29-99), about 1 m 50 s.

## 8. CI and merge gates
- Workflow `build` runs on push to main and on PRs **targeting main** only (build.yml:14-18), with cancel-in-progress (build.yml:24-26).
- Check runs per PR, verified on PR #11 and #12 head SHAs:
  - `backend tests` (build.yml:29-99)
  - `frontend lint + build` (build.yml:101-117), 18-29 s
  - `backend image` (needs backend-tests, build.yml:119-125)
  - `frontend image` (needs backend-tests and frontend-checks, build.yml:169-174)
  - All four were success on #11 (head 44bdca4) and #12 (head 1bce893).
- main is **not protected**: `gh api repos/adamjmachill/popping/branches/main` returns protected:false with no required checks, and the rules endpoint returns `[]`. "CI must pass before merging" is a convention (dependabot.yml:1), not enforced.
- `gh pr view` fails because GraphQL returns 403. Use REST:
  - `gh api repos/adamjmachill/popping/pulls/N`
  - `gh api repos/adamjmachill/popping/commits/<sha>/check-runs`

## 9. How past PRs described verification
- **#8 (body, "## Checks")**: "`npm run lint` (same 6 pre-existing warnings, 0 errors), `tsc --noEmit` and `npm run build` pass; `dist/` contains the manifest and icons…". It opens with "checked in an iPhone 15–sized Chromium against a mocked API." Footer: "🤖 Generated with [Claude Code]…" plus the session URL.
- **#11**: "Checked with `npm run lint` and `npm run build`, plus an iPhone 15-sized Playwright screenshot of Settings."
- **#12**: "Checked with tsc, lint and build, plus an iPhone-sized Playwright run: ✓ → "Marked as read", ✓ again → "Marked as unread", and the aria-label flips back."
- There is no PR template in .github; it contains only dependabot.yml and workflows/build.yml. Commits are squash-merged with the PR title plus "(#N)".

## 10. Copy-paste recipe
```bash
# ---- 0. once per fresh container ----
cd /home/user/popping/frontend && npm ci            # ~3 s; never run `npx playwright install` (CDN blocked)
node -e "require.resolve('playwright')"             # must print /opt/node-tools/node_modules/playwright/index.js
echo $PLAYWRIGHT_BROWSERS_PATH                      # /opt/pw-browsers (chromium-1194 = playwright 1.56.x)

# ---- 1. static gates (what CI runs) ----
cd /home/user/popping/frontend
npm run lint     # must stay 0 errors; baseline 6 warnings, do not add new ones
npm run build    # check-html-comments + tsc + vite build

# ---- 2. fast iPhone screenshots against vite dev (no build) ----
F=/home/user/popping/frontend; OUT=<scratchpad>/shots; mkdir -p $OUT
$F/node_modules/.bin/vite $F --config $F/vite.config.ts --host 127.0.0.1 --port 5173 --strictPort > $OUT/vite.log 2>&1 &
VPID=$!; until curl -sf -o /dev/null http://127.0.0.1:5173/; do sleep 0.5; done
node <scratchpad>/shot.cjs http://127.0.0.1:5173 $OUT; echo exit=$?
kill $VPID     # direct vite binary, so $! is the server itself (no orphan)

# ---- 3. built app + production CSP (preview only) ----
cd $F && npm run build
$F/node_modules/.bin/vite preview $F --config $F/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort > $OUT/preview.log 2>&1 &
PPID_=$!; until curl -sf -o /dev/null http://127.0.0.1:4173/; do sleep 0.5; done
node <scratchpad>/shot.cjs http://127.0.0.1:4173 $OUT   # + CSP route variant, see section 6
kill $PPID_

# ---- 4. full overflow audit (informational, 4 min) ----
bash /home/user/popping/frontend/scripts/iphone-audit/run.sh
pkill -f 'vite preview --port 4173' || true         # run.sh leaks its preview server
# read summary.json / analysis.txt, LOOK at the PNGs, then:
git -C /home/user/popping clean -fdX frontend/scripts/iphone-audit/

# ---- 5. backend pytest locally (optional; CI is authoritative) ----
S=<scratchpad>/pg; mkdir -p $S
apt-get install -y postgresql-16-pgvector  # untested alt; verified path: apt-get install -y postgresql-server-dev-16 && git clone --depth 1 --branch v0.8.7 https://github.com/pgvector/pgvector.git $S/pgvector && make -C $S/pgvector -j4 && make -C $S/pgvector install
PGDATA=/var/lib/postgresql/popping-test
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D $PGDATA --auth=trust -U postgres
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l $PGDATA/server.log -o "-p 5432 -k /tmp" -w start
psql -h localhost -U postgres -c "CREATE USER popping_test WITH PASSWORD 'popping_test' SUPERUSER;" -c "CREATE DATABASE popping_test OWNER popping_test;"
psql -h localhost -U popping_test -d popping_test -c 'CREATE EXTENSION IF NOT EXISTS vector'
grep -q 'example.com' /etc/hosts || cat >> /etc/hosts <<'EOF'
93.184.215.14 example.com www.example.com
93.184.215.14 example.org www.example.org
93.184.215.14 example.net
151.101.1.140 reddit.com www.reddit.com old.reddit.com oauth.reddit.com
EOF
uv venv --python 3.12 $S/venv && VIRTUAL_ENV=$S/venv uv pip install --no-deps -r /home/user/popping/backend/requirements-dev.lock
cd /home/user/popping/backend
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=$PWD $S/venv/bin/python -m pytest -m no_db -q -p no:cacheprovider   # guards only, no Postgres needed
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=$PWD $S/venv/bin/python -m pytest -ra -q -p no:cacheprovider        # 623 passed baseline

# ---- 6. after push: draft PR to main, then poll CI ----
gh api repos/adamjmachill/popping/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[]|"\(.name) \(.status) \(.conclusion)"'
# all four must be success: backend tests, frontend lint + build, backend image, frontend image
```
`shot.cjs` was tested in this container (exit 0, 11 s):
```js
'use strict'
const path = require('path')
const { chromium } = require('playwright')
const { mockApi, IOS_UA } = require('/home/user/popping/frontend/scripts/iphone-audit/capture.cjs')
const BASE = process.argv[2] || 'http://127.0.0.1:5173', OUT = process.argv[3] || __dirname
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA, colorScheme: 'dark' })
  await mockApi(ctx)
  const page = await ctx.newPage(); const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.locator('main.md\\:hidden article[data-card-id]').first().waitFor()
  await page.screenshot({ path: path.join(OUT, '390-dashboard.png') })
  await page.locator('button[aria-label="open settings"]').click()   // update selector after the top-bar change
  await page.waitForSelector('[role="dialog"][aria-label="settings"]'); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '390-settings.png') })
  const m = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, bodyW: document.body.scrollWidth, innerW: innerWidth,
    smallFields: [...document.querySelectorAll('input,textarea,select')].filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).length }))
  console.log(JSON.stringify({ m, errors })); await browser.close()
  process.exit(errors.length || !m.coarse || m.smallFields || m.bodyW > m.innerW ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
```
- Check `document.body.scrollWidth` and `#root`, not only `html`. `html, body { overflow-x: clip }` (frontend/src/styles.css:35) keeps html.scrollWidth at the viewport width while body overflows (320/search: html 320, body 336).
- The 16 px rule only applies under `(pointer: coarse)` (styles.css:23-25). Every state must assert coarse=true, or the field check is meaningless.
- Things Chromium emulation cannot show: Safari focus-zoom, iOS vh/dvh toolbar behaviour, and real `env(safe-area-inset-*)` (always 0 here). These still need the on-phone checks listed at REDESIGN_PLAN.md:325.

## 11. Adding Playwright to CI (proposal; not run on GitHub)
- Put `"playwright": "1.56.1"` (exact) in frontend devDependencies. That keeps `require('playwright')` working from the `.cjs` scripts both locally (it matches chromium-1194) and in CI.
- Add one step to `frontend-checks` after `npm run build` (build.yml:117), within plan limit REDESIGN_PLAN.md:44:
  - `npx playwright install --with-deps chromium`
  - start `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &`
  - curl-wait
  - `node scripts/iphone-audit/<smoke>.cjs`, which must exit non-zero on findings
- Dependabot opens weekly grouped npm minor/patch PRs (dependabot.yml:12-18). It will bump playwright, and a bumped version needs a Chromium revision this container cannot download. Either reject that bump or locally run `npm i --no-save playwright@1.56.1`. dependabot.yml is outside the plan's allowed files, so an ignore rule needs approval.

#### Constraints
- Plan allows only these files to change: frontend/src, frontend/scripts, frontend/package.json plus lockfile (Playwright as a dev dependency only), named backend files, backend/tests, README.md, .env.example, and one added step in the frontend CI job; no Dockerfile, nginx or compose changes (REDESIGN_PLAN.md:44)
- CI runs only for PRs whose base is main; stacked PRs get no checks (.github/workflows/build.yml:17-18)
- Four check runs must be green: 'backend tests' (build.yml:29-99), 'frontend lint + build' (build.yml:101-117), 'backend image' (build.yml:119-125), 'frontend image' (build.yml:169-174). main has no branch protection (gh api branches/main: protected:false), so 'green before merge' is a convention (.github/dependabot.yml:1)
- Frontend gate = npm ci, npm run lint, npm run build on Node 22 (build.yml:109-117); build = prebuild check-html-comments + tsc + vite build (frontend/package.json:8-9)
- Lint warnings never fail the build (frontend/package.json:10 has no --max-warnings); baseline is 0 errors and 6 warnings
- tsc typechecks only src (frontend/tsconfig.json:19); scripts/*.cjs are not typechecked, and ESLint applies its rules only to ts/tsx (frontend/eslint.config.js:27)
- Audit and smoke scripts must stay CommonJS, because global playwright resolves only via require/NODE_PATH and ESM import fails (frontend/scripts/iphone-audit/README.md:24)
- Never run `npx playwright install` in the container: the browser CDNs are blocked; use the preinstalled chromium-1194 with PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (frontend/scripts/iphone-audit/run.sh:9)
- Any Playwright devDependency must be pinned to exactly 1.56.1 to match /opt/pw-browsers/chromium-1194; dependabot bumps npm minor/patch weekly (.github/dependabot.yml:12-18)
- Vite proxies /api, /assets and /auth to localhost:8000 in dev and preview (frontend/vite.config.ts:8,21,28,35,68,74); mocks must answer all three prefixes in-browser
- Built JS/CSS lives under /static/, not /assets/ (frontend/vite.config.ts:62); /assets/ is the backend favicon/thumbnail route the mock must serve (capture.cjs:61-70)
- Production CSP is self-only (frontend/nginx.conf.template:29); the new UI may load no external fonts, scripts or styles, and the CSP can be emulated only against vite preview, not dev
- Backend source-text guards pin FeedManager.tsx literals: generic_scrape union, radio, label, useEffect deps, fm-url label, trackAnyway (backend/tests/test_frontend_slice15_add_generic_scrape.py:55-341); also sitemap/link_pattern inputs (backend/tests/test_source_create_sitemap_link_pattern.py:199-275). Moving code out of FeedManager.tsx requires updating these tests in the same PR
- Column.tsx/App.tsx guards: sourcesByName prop and call sites (backend/tests/test_frontend_slice19_empty_column_source_status.py:54-163); memo(ColumnInner) and useCallback handlers (backend/tests/test_slice21_column_memo.py:49-216)
- Card.tsx/api.ts guards: safeExternalUrl wrapping (backend/tests/test_slice30_safe_external_url.py:46-232)
- Backend conftest needs the full app dependency set even for no_db tests (backend/tests/conftest.py:54-60); DB tests need Postgres with pgvector at popping_test@localhost:5432 (conftest.py:30-34)
- The container has no DNS; the SSRF guard resolves hosts (backend/app/url_safety.py:150), so local backend tests need /etc/hosts entries for example.com/org/net and reddit.com
- torch cannot be installed here (download.pytorch.org returns 403); install the lock with --no-deps (backend/requirements-dev.lock:289-309 excludes torch), and tests stay torch-free because EMBEDDING_ENABLED=false (backend/tests/conftest.py:43)
- The 16px no-zoom rule exists only under (pointer: coarse) (frontend/src/styles.css:23-25); emulation must use isMobile+hasTouch, and every state must assert that coarse is true
- html/body use overflow-x: clip (frontend/src/styles.css:35), so overflow checks must read body/#root scrollWidth, not only documentElement
- App renders both the hidden desktop grid and the mobile main; scope card locators to main.md\:hidden (frontend/scripts/iphone-audit/capture.cjs:452-458)

#### Findings
- [high] REDESIGN_PLAN.md:309: The plan says 'No Docker, no Postgres, so backend pytest runs only in CI' and 'Python 3.13' (also line 323). Postgres 16 server binaries are installed, pgvector installs via apt or a source build, and uv provides Python 3.12. The full backend suite passed here (623 passed in 24.7 s) once pgvector, a cluster and /etc/hosts entries were set up. Fix: Replace section 13's backend line with the local pytest recipe (initdb/pg_ctl as the postgres user, CREATE EXTENSION vector, /etc/hosts entries, `uv venv --python 3.12` + `uv pip install --no-deps -r requirements-dev.lock`, `PYTHONPATH=$PWD python -m pytest -ra`). Keep CI as the authority.
- [high] frontend/scripts/iphone-audit/run.sh:13: `npx vite preview ... &` makes PREVIEW_PID the npx wrapper, so `trap 'kill $PREVIEW_PID'` (line 15) leaves the real vite preview orphaned (observed PID 9739, PPID 1, still holding 4173 after run.sh exited). With no --strictPort, the next run's preview silently binds another port while capture.cjs and probe.cjs keep hitting 127.0.0.1:4173 (capture.cjs:23), possibly a stale server. Fix: Use `./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &` (the direct binary, so $! is the server) and keep the trap. Until fixed, run `pkill -f 'vite preview --port 4173'` after run.sh.
- [high] frontend/scripts/iphone-audit/capture.cjs:562: capture.cjs (and therefore run.sh) exits 0 whatever it flags; it exits 1 only on an exception. It cannot serve as the CI gate the plan describes (REDESIGN_PLAN.md:115, 296). This run flagged 25 'visible-overflow' items per state at 390 and still exited 0. Fix: Add a smoke mode that sets process.exitCode=1 on: body or #root scrollWidth > innerWidth; any visible input/select/textarea computed font-size < 16; pointer:coarse false; page errors other than the expected /auth/me 404; any UNMOCKED request. Run it in CI after npm run build.
- [high] frontend/scripts/iphone-audit/capture.cjs:486: Every interaction step in capture.cjs is tied to today's UI: 'open menu' (478), 'open settings' (486), dialog 'settings' (487), 'feed manager tabs' (488), expandable rows (494), 'edit refresh interval' (497), `edit ${name}` (504), the headers textarea (505), #fm-name (511). probe.cjs:27 and 37 also query `header > div.flex`. The one-button top bar and the new feed editor remove or rename these, so the audit will time out after the redesign. Fix: Update capture.cjs and probe.cjs selectors in the same PR that changes the header and editor. Prefer stable aria-labels or data-testid on the new top-bar button and editor sheet, and add states for the editor sheet, category picker, and headers rows.
- [medium] frontend/scripts/iphone-audit/capture.cjs:428: The 'tall' screenshot variant resizes the viewport mid-session (lines 428, 431). In two full runs, state 320/09-search reported pointer:coarse=false although a fresh 320 context in the same state reports true. A coarse-dependent check (the 16px field rule in styles.css:23-25) is therefore unreliable late in a long capture session. Fix: In the gating smoke, take only fullPage screenshots (no setViewportSize), or open a fresh context per state, and assert matchMedia('(pointer: coarse)').matches === true before every scan.
- [medium] frontend/scripts/iphone-audit/capture.cjs:53: The mock route regex `/\/(api|auth|assets)\//` is matched against the full URL, unanchored. Against vite dev it would also intercept any future module URL containing '/assets/' or '/api/' (for example /src/assets/x.svg) and return fake SVG or JSON, breaking module loading. frontend/src has no such path today. Fix: Anchor on the pathname: `context.route((url) => /^\/(api|auth|assets)\//.test(url.pathname), handler)`.
- [high] frontend/nginx.conf.template:29: Production serves a strict self-only CSP, but vite preview and dev send no CSP, so a regression (inline script, external font or style) would pass every local check and CI. Verified: injecting this CSP via route.fetch/route.fulfill works against vite preview (cards render, only the expected /auth/me 404). Against dev it breaks because of plugin-react's inline preamble. Fix: In the preview-based smoke, add a context.route for HTML documents that fulfills with the nginx CSP header, and fail on any 'Refused to' console error. Do not apply it to the dev server.
- [high] frontend/src/App.tsx:2276: Confirmed in a fresh 320x568@2x context: with search open, document.body.scrollWidth is 336 (16px past the screen). html.scrollWidth stays 320 because html/body use overflow-x: clip (styles.css:35), so a documentElement-only check misses it. This matches REDESIGN_PLAN.md item 2 (line 98). Fix: Fix per plan item 2 (search box flex-1 min-w-0, hide the title and refresh while searching below sm). Make the smoke check body/#root scrollWidth, not only documentElement.
- [high] frontend/package.json:17: No test runner or Playwright dependency; the frontend is verified only by lint, tsc and build. Global Playwright 1.56.1 resolves only through require/NODE_PATH (ESM import fails with ERR_MODULE_NOT_FOUND). CI runners have neither a global playwright nor a browser, so a CI smoke step needs a local dependency. Fix: Add `"playwright": "1.56.1"` (exact pin; the package has no install script, so npm ci downloads no browsers). Add one frontend-checks step after `npm run build`: `npx playwright install --with-deps chromium`, start `./node_modules/.bin/vite preview --strictPort`, curl-wait, `node scripts/iphone-audit/<smoke>.cjs`. Do not add Vitest; it is outside REDESIGN_PLAN.md:44.
- [medium] .github/dependabot.yml:12: Weekly grouped npm minor/patch updates would bump a Playwright devDependency past 1.56.x. The newer version needs a Chromium revision this container cannot download (Playwright CDNs blocked), which breaks local screenshot runs. Fix: Reject Playwright bumps, or locally run `npm i --no-save playwright@1.56.1` before screenshots. An `ignore` entry needs the owner's approval because dependabot.yml is outside the plan's allowed files.
- [high] .github/workflows/build.yml:17: pull_request triggers only for base main, and main has no branch protection (protected:false, no required checks, rules endpoint returns []). A stacked PR (for example D based on C's branch) gets no CI, and nothing technically blocks merging red. Fix: Branch every PR from main, as the plan already says. Before merging, poll `gh api repos/adamjmachill/popping/commits/<sha>/check-runs` until all four (backend tests, frontend lint + build, backend image, frontend image) are success; `gh pr view` is blocked (GraphQL 403).
- [high] backend/tests/test_frontend_slice15_add_generic_scrape.py:55: Source-text guards read FeedManager.tsx and api.ts and assert literal JSX and handler text (radio markup, label text, a useEffect with deps [name, url, sourceType], trackAnyway body, URL label and placeholder ternaries). test_source_create_sitemap_link_pattern.py:199-275 does the same for setSitemapUrl/setLinkPattern. The editor redesign will break them. Fix: In the editor PR, update these tests to point at the new files and current literals, or replace them with Playwright behaviour checks (allowed by backend/tests/README.md:24-25 in spirit). Run `pytest -m no_db` locally (352 tests, 4 s) before pushing.
- [high] backend/app/url_safety.py:150: The SSRF guard calls socket.getaddrinfo, and the container cannot resolve external names (resolv.conf 8.8.8.8 unreachable). Without /etc/hosts entries for example.com/org/net and reddit.com, 13 backend tests fail locally (they pass in CI). This was confirmed by re-running those 6 test files on Python 3.13 with hosts patched: 67/67 passed. Fix: Add the hosts entries in the local recipe (any public IP works; the tests use httpx MockTransport). Do not change application code for this.
- [medium] frontend/src/styles.css:23: The 16px no-zoom rule exists only as a (pointer: coarse) `!important` override, and plan item 11 proposes deleting it. After deletion, nothing but the smoke test would catch a sub-16px field. Fix: The smoke must check the computed font-size of every visible input/select/textarea is at least 16 at 390 and 320 in every state, including the new editor sheet, category picker and header rows.
