# Popping: make it quick and obvious (deep-dive plan)

## Context

Your verdict after PR1–PR10 and PR #25: "It's come a long ways… but it's still crap using it."
The complaints:

1. Hunting through things, multi-tapping; nothing is quick.
2. You can't put categories in the order you want.
3. You don't understand how to modify or save views.
4. Nothing is intuitive to a new user.
5. Upvote / downvote / star / read / fresh-vs-not are confusing.
6. Most tabs show 100+ items after you add a feed, with no idea why.
7. After adding a feed there's no sign it's actually pulling. Finding out means filtering,
   refreshing, and flipping settings like the browser option.
8. Adding a website sometimes pulls random pages that aren't articles.

Goal: every common task takes one or two taps, and every state explains itself. A newly added
feed visibly proves it works, or says why it doesn't and what fixes it.

**Product principle (your note):** Popping is how you quit Reddit.
- Your own sources, in a UI that feels like Reddit.
- A real end: once you've seen what's new, the app says so and there is nothing more to scroll.
- Familiar social-media conventions instead of explanations. No tutorials, tip cards or help text
  where the convention is obvious.
- Anything that makes the app worse is left out (listed under "Dropped").

How this plan was made (read-only):
- 9 investigators found 94 problems, and a critic verified the root causes.
- An architect wrote PR-by-PR specs.
- A skeptic checked every claim against the code and found 1 blocker and about 25 major issues.
- The architect fixed them.
- I spot-checked the main root causes in the code myself.

The full spec is the appendix at the end.

Constraints you set:
- Safe and secure.
- No new ports, containers, daemons, processes, service workers or web workers.
- Don't touch Docker/compose, nginx, package.json/lock, config.py, main.py or url_safety.py.
- Migrations are additive and nullable, with exactly one new head.
- Real fixes, not duct tape.
- Document as you go.
- Don't shrink the plan to save tokens.

## Root causes (all checked in the code)

- **Nothing is quick:**
  - Opening a story never marks it read: `onActivate` is never passed (Column.tsx:732). So each
    story costs 3 taps.
  - Sort does nothing: App.tsx re-sorts every section newest-first.
  - The phone remembers its tab by position, so tabs jump when Saved or For You appear.
  - A hidden header tap marks a whole tab read.
  - Every card renders at once.
  - Settings has 8 tabs.
  - Adding a feed takes about 11 taps and files it under "Other".
- **Category order:**
  - Tabs are always alphabetical (App.tsx:885-904).
  - No preference stores an order (preferences.py allowlist).
- **Views:**
  - Saved views are invisible until one exists and show no active state.
  - Applying one rewrites your normal column settings.
  - Updating one is hidden behind ⋯.
  - Reset deletes saved views and saved stories on every device.
- **Card actions:**
  - Six unlabelled icons that mean three things.
  - Unstarring still records a +4 bookmark.
  - Reading time is sent in milliseconds but scored as seconds.
  - Settings > History is always empty.
  - Four "new" signals, built from two rules.
- **100+ items:**
  - Each tab is that category's all-time top 100, with no time limit, and paused feeds are
    included (entries.py:397-422).
  - A new feed's first fetch imports its whole back catalogue (scheduler.py `_ingest`; no cap).
  - "Fresh" only means "not ticked".
  - Read marks are capped at 200, so old stories come back as unread.
  - Wikipedia On This Day posts up to 25 historical items a day as "0m ago" in News.
- **Feed health:**
  - A zero-item fetch counts as success (scheduler.py:491-492).
  - Fetchers swallow errors, and a 403 on a website shows as "no list".
  - Check now is a 3-second toast.
  - **Refresh never checks feeds**; it only re-reads the database.
  - Browser identity is manual.
  - Subreddit Test always fails (sources.py:1131 imports a function that doesn't exist).
  - Queued runs can be silently skipped: APScheduler's misfire grace period defaults to 1 s.
- **Websites pull junk:**
  - Auto-add makes a scraper if the sitemap lists any URL.
  - Any page with a title and some text counts as an article.
  - Undated pages are kept and sort to the top.
  - A section URL silently falls back to the whole site.

## Decisions (my defaults, revised for your note; approving this plan approves them)

D1. **Cards look like Reddit posts:**
   - Feed icon, feed name and time, then the title, thumbnail and Summary arrow.
   - Action bar: ▲ ▼ (orange/blue when active, tap again to undo), Save (bookmark), Share, ⋯.
   - ⋯ holds Hide, Hide stories from <feed>, Edit feed, Copy link and Open in browser.
   - Swipe left = Hide.
   - No ✓ button, no 👁, no labels.

D2. **What the buttons do:**
   - Votes do what they do on Reddit: the card stays, and your taste is recorded.
   - Hide removes the story.
   - The "tuning…" toasts go.
   - Unsaving no longer counts as a save.

D3. **Seen = used up.**
   - A story counts as read once you open it or scroll past it (on screen about a second, then
     gone off the top).
   - It stays where it is until you leave the tab or pull to refresh.
   - The ranking's "viewed" signal is recorded at that moment instead of whenever a card is
     drawn.

D4. **A real end:**
   - Each tab shows unseen stories first, then "You're all caught up", then seen stories folded
     under "Earlier (N)".
   - The number on a tab is how many you haven't seen.
   - "Mark all as read" lives in the tab's ⋯.
   - "+N new" and the hidden header tap go.

D5. **Each tab shows what arrived in the last 2 days.** You can change that per tab: 1 day / 2 days /
   7 days / All.
   - No "Show older" row; the end is the end.
   - Saved always lists every save.

D6. **A new feed** brings its newest 10 stories plus the last 2 days, never its whole back catalogue.
   This also holds when a feed first works days after you added it.

D7. **Tab order:**
   - ↑/↓ and Show switches, opened from an "Edit" pill at the end of the tab strip, the Menu, or a
     tab's ⋯.
   - Brief first; Saved and For You always there unless hidden.
   - A new device opens on For You.

D8. **Saved views become your own tabs** (a name plus feeds).
   - A "From: A, B, C · Edit" line shows what's in one.
   - Edits save immediately.
   - Old views convert automatically; the old data is kept for rollback.
   - The chip rows and the Menu feed checklist go.

D9. **"Hide stories from <feed>"** mutes a feed without deleting it. Paused feeds leave the tabs.

D10. **Pull down to refresh** on the phone; the Refresh button stays on desktop.
   - Refresh asks the server to check this tab's feeds now (10-minute cooldown per feed).
   - It shows "Checking 6 feeds…", then "3 new".
   - The phone header loses its Refresh button.

D11. **Feed health:**
   - One migration (0031) with three nullable columns.
   - Every feed gets a short status pill, and each problem gets one fix button (for example
     "Read as Safari", with Undo).
   - My feeds gets search, a "Needs attention" group and category headings.
   - Check now shows its result in place.

D12. **Website feeds only pull articles:**
   - URL and page scoring; news sitemaps first.
   - Stories already stored are skipped.
   - At most 2 undated pages per check; undated stories sort last.

D13. **One Add field with a real preview** (the stories it will pull, plus one count line).
   - The tab defaults to the one you're on.
   - Duplicates are refused.
   - The first check's result is shown.
   - A blocked site is retried as Safari, with Undo.
   - "Find its feed" for web pages that have one.

D14. **Menu becomes tasks:** Add feed · Feeds (N need attention) · Saved · Edit tabs · Activity ·
   Settings.
   - Settings goes from 8 tabs to 4: Feeds / AI & Brief / Activity / General.
   - Old links still work.

D15. **No tutorials.**
   - Kept: functional states only — "Add your first feed" when you have none, "Brief needs an AI
     provider · Set up", and short errors with their fix.
   - One vocabulary everywhere: stories, feeds, tabs, Saved.

D16. **Speed:**
   - Cards load in batches as you scroll, and loading stops at "You're all caught up".
   - Reads, saves and hides sync between devices. This lands before seen-on-scroll, which writes
     often.
   - Undo toasts of the same kind combine.

D17. **Wikipedia On This Day:** 5 selected items a day in its own tab.

D18. **A feed that gets blocked later** gets a one-tap "Read as Safari" fix. The automatic Safari
   retry runs only in preview and add.

D19. **Deferred** (each needs your yes later):
   - category rename/merge;
   - per-feed volume cap;
   - deleting old stories;
   - JSON Feed;
   - Framing Watch on the phone;
   - drag-to-reorder;
   - automatic Safari fallback on scheduled checks;
   - Undo also removing the ranking signal.

**Dropped from the first draft because they'd make it worse:**
- the tip card and "How Popping works" sheet;
- the ✓ Read button and 👁;
- "Not interested" as a separate idea (▼ and Hide already mean that on Reddit);
- the "Show older" row and the 3-older-stories-per-feed floor (they defeat the end);
- explanatory copy;
- the vocabulary guard test.


## The PRs (provisional split; the revised spec finalises it)

| PR | What you'll notice on the phone | Migration |
|---|---|---|
| PR0 | #25 merged (feed names). It's your other session's PR; I don't touch or merge it | 0030 |
| PR1 | Opening marks read; your tab stays put; Sort works; Mark all read in ⋯; Earlier folded; Reset keeps saves; Brief says it needs AI; History works; subreddit Test works; vote/save signal fixes | no |
| PR2 | Devices stay in sync; pull to refresh checks the tab's feeds; fewer toasts | no |
| PR3 | Seen = used up: scroll past it and it's done; "You're all caught up"; tab number = unseen; batch loading | no |
| PR4 | Tabs hold the last 2 days; new feeds bring 10 stories, not a backlog; Saved lists every save; On This Day tamed | no |
| PR5 | Reddit-style cards: ▲ ▼ Save Share ⋯; Hide; hide a feed's stories | no |
| PR6 | Your tab order and hidden tabs | no |
| PR7 | Saved views become your own tabs | no |
| PR8 | Every feed shows whether it's pulling, with one-tap fixes | 0031 |
| PR9 | Website feeds pull articles only | no |
| PR10 | One Add field with a real preview and a confirmed first check | no |
| PR11 | Menu of tasks; Settings in 4 tabs; same words everywhere | no |

## How I'll work

- **Step 1: document first.**
  - Commit this plan as `docs/UX_OVERHAUL_PLAN.md` on branch `claude/ux-overhaul-plan` and open it
    as a draft PR.
  - Scan the text for personal details first (names, emails, hosts, IPs) and leave them out.
  - When the re-verified spec for your new direction arrives, replace the appendix and update the
    PR.
- **Before PR1:** check that #25 is merged. If it's still open, I branch from its head and rebase
  once it merges. I never push to #25 or merge it.
- **Each PR:**
  - Branch from up-to-date main, and stack the next PR while CI runs.
  - Implement the spec.
  - Run tsc, lint and build; unit tests; backend pytest (local Postgres);
    `smoke.cjs --csp --strict`; and every flow. Mutation-test each new flow.
  - Run a security review.
  - Open a draft PR, get the 4 CI checks green, then squash-merge under your standing OK.
  - Send you 390px screenshots plus 3 lines on what to check on the phone after
    `popping-update`.
  - Merging never deploys anything: you release by running `popping-update`.
- **Documentation:** `docs/UX_OVERHAUL_PLAN.md` gets working notes in every PR, so any session can
  resume. `ARCHITECTURE.md` and the iphone-audit README are updated as things change.
- **Migrations:** only 0031: three nullable columns, a metadata-only change. Rollback steps are
  written down.
- **What I can't do from the cloud:**
  - Run EXPLAIN on the server. I'll test the window query on a production-sized synthetic table
    locally, and give you a read-only command to run if you want.
  - Know the junk websites. Send the URLs whenever; the fixtures cover common CMS layouts until
    then.
- **Stop rule:** if a step would need a forbidden file, a non-additive migration, or a change to a
  decision above, I stop that PR, note why in the doc, and continue with independent PRs.

## Verification (end to end)

- **Every PR:** CI's four checks (backend tests, frontend lint + build with strict smoke, both
  images), plus the local runs above.
- **New flows** assert the target tap counts and the new behaviour:
  - open marks read; scroll-past marks seen; caught-up marker; pull to refresh checks feeds;
  - tab badge counts unseen;
  - Reddit-style card actions; hide feed;
  - tab reorder ≤3 taps; custom tab create ≤6 taps;
  - Needs attention; Read as Safari;
  - add preview ≤5 taps; Menu rows reach their target in 2 taps.
- **New pytest:** ingest rules and backfill cap; entries window (both query paths); preference
  deltas; check-now queue and misfire grace; migration 0031 single head; source health;
  article_detect fixtures; preview; duplicate 409.
- **After the final PR:** a full strict smoke at 390, 320 and 312 wide, every flow, and a
  screenshot set.

---

# Appendix: implementation spec, first verified draft

> **Read this first.** This spec was verified against the code *before* your note about Reddit and
> the real end. Where it conflicts with decisions D1–D19 above, **the decisions win**:
> - Reddit-style ▲ ▼ Save Share ⋯ instead of Save / Read / Not interested.
> - Seen-on-scroll and "You're all caught up" instead of a Read button.
> - No tip card, help sheet, "Show older" row or per-feed floor.
> - Pull to refresh.
>
> A re-verified revision is in progress and will replace this appendix. Line anchors are against
> main a79c6ee plus PR #25.

**Base:** `main` at a79c6ee with PR #25 (`origin/claude/feed-display-names`, 355c596) merged.

**Line numbers:** for every file #25 changes, line numbers come from #25's version. Read those with `git show origin/claude/feed-display-names:<path>`. The files are:
- `App.tsx`, `Card.tsx`, `BriefCard.tsx`, `FeedManager.tsx`, `FeedEditor.tsx`
- `api.ts`, `labels.ts`, `feedRules.ts`, `sourceSaves.ts`, `flows.cjs`
- `routes/sources.py`, `models.py`, `schemas.py`

All other files use `main` line numbers; #25 does not touch them.

## Summary

| PR | What you'll notice on the phone | Size | Migration | Depends on |
|---|---|---|---|---|
| PR0 | Feeds keep the name you type (#25) | M | yes (0030) | none |
| PR1 | Opening a story marks it read. Your tab stays put. Sort works. "Mark all read" button. Read (N) folded. Reset keeps your saves. Brief says when it needs AI | M | no | PR0 |
| PR2 | One unread number per tab. Refresh checks the tab's feeds now. Stars and reads sync between devices. Fewer toasts. Long tabs open fast | M | no | PR1 |
| PR3 | Tabs show the last 2 days. A new feed brings 10 stories, not its backlog. "On this day" gets its own small tab. Saved shows every save | L | no | PR2 |
| PR4 | Card face: ☆ Save, ✓ Read, ⋯. Not interested; Hide stories from \<feed\>. First-run tip and "How Popping works" | M | no | PR1, PR2 |
| PR5 | Your tab order and hidden tabs ("Edit" pill). Saved and For You always present | M | no | PR1, PR2, PR3 |
| PR6 | Saved views become your own tabs, with their feeds listed under the header | L | no | PR3, PR4, PR5 |
| PR7 | Every feed shows whether it is pulling, and each problem has a one-tap fix | L | yes (0031) | PR0, PR2, PR3, PR5, PR6 |
| PR8 | Website feeds pull articles, not About, tag or shop pages | L | no | PR7 |
| PR9 | One add field with a real preview. The first check's result is shown | L | no | PR5, PR7, PR8 |
| PR10 | A menu of tasks. Settings in 4 tabs. The same words everywhere | M | no | PR4, PR6, PR7, PR9 |
| PR11 | Deferred items, each needing a fresh owner yes (D17) | varies | maybe | as needed |

**Ordering changes from the critique, and why:**
1. D10 (Refresh queues feeds) moves to PR2. It needs no migration.
2. "Brief needs an AI provider" and the Reset data-loss fix move to PR1. Both are small and fix real harm.
3. The tip and "How Popping works" go in PR4, next to the card change they explain.
4. PR5 depends on PR3: Saved can only be "always present" once it loads every save by id.
5. The automatic browser identity runs in preview and add only (PR9), so 0031 has no `fetch_mode` column (owner call O1).
6. Custom tabs use a new `custom_tabs` key. The critique's `pr_order` kept them in `filter_presets`; this deviation is owner call O3.
7. The `per_source_cap` in PR3 is the critique's "fixed per-source cap, no UI".
8. Column keys start in PR1, for tab selection only. Preference suffixes move to keys in PR6.
9. Check now uses the scheduled job through `modify_job`.
10. PR7 also depends on PR6, because FeedStatus appears in the tab sheet. `api.source(id)` lands in PR7.
11. The Wikipedia On This Day fix goes in PR3. The error-to-action table and PATCH `type` go in PR7. "Find its feed" goes in PR9.

**Owner calls (this spec uses the defaults):**
- **O1, feeds that later become blocked.**
  - Default: a one-tap "Read as Safari" with Undo on the Needs-attention row (PR7, no migration).
  - Alternative: an automatic fallback on scheduled fetches. That adds `fetch_mode` to 0031 and moves the adaptive fetch into PR7.
- **O2, Wikipedia On This Day.**
  - Default: 5 "selected" items a day, in its own tab (PR3).
  - Alternative: keep it in News, at 5 a day.
- **O3, custom tabs.** Default: a new `custom_tabs` key, leaving `filter_presets` untouched so a rollback keeps the old views.

## Target tap counts

| Task | Today | After (PR) |
|---|---|---|
| Read a story so it counts as read | 2 (open, ✓) | 1 (open) (PR1) |
| Clear a tab | 1 unlabelled header tap | 1 labelled "Mark all read" (PR1) |
| Not interested | 1 (👁 or ▼; they differ) | 1 swipe, or 2 (⋯ → Not interested) (PR4) |
| More like this | 1 (▲) | 2 (⋯ → More like this) (PR4) |
| Hide every story from one feed | not possible | 2 (⋯ → Hide stories from X) (PR4) |
| Move a tab one place earlier | not possible | 3 (Edit, ↑, Done) (PR5) |
| Hide a tab | not possible | 3 (Edit, switch, Done) (PR5) |
| Make a tab of 3 feeds | 7 + typing + scrolling | 6 + typing (Edit, New tab, 3 ticks, Done) (PR6) |
| Add a feed to a custom tab | 5 | 3 (Edit on the "From" line, tick, Done) (PR6) |
| See which feeds a custom tab holds | not shown | 0 ("From: A, B, C" line) (PR6) |
| Check a tab's feeds now | not possible | 1 (Refresh) (PR2) |
| Is a feed pulling? | ~5 + a filter | 2 (≡, Settings: a pill on every row) (PR7) |
| Fix a feed a site now blocks | ~6 (≡, Settings, row, Advanced, browser identity, Check now) | 3 (≡, Settings, Read as Safari) (PR7) |
| Point a web-page feed at its real feed | not possible (delete and re-add) | 3 (≡, Settings, Find its feed) (PR9) |
| Find one feed | scroll an unsorted list | 3 (≡, Settings, type) (PR7) |
| Add a feed and know it pulls | 6, plus ~4 to verify | 5 (≡, Add feed, paste, Preview, Add); result shown (PR9) |
| Show a tab's older stories | 3 (24 h at most) | 1 ("Show older") (PR3) |
| Restore a hidden story | 4 | 1 (Undo) or 3 (≡, Activity, Restore) (PR10) |
| Learn the card actions | not possible | 0 (tip) or 2 (≡, How Popping works) (PR4) |

**Rules for every PR:**
- **Frozen infrastructure.** No new ports, containers, daemons, workers or service workers. Never edit Docker/compose, nginx, `package.json`/lockfile, `config.py`, `main.py` or `url_safety.py`.
- **New routes** go on existing routers:
  - Sources routes use `dependencies=_write_deps`.
  - Preferences routes follow that router's `current_user` + `resolve_user_id` pattern.
  - OIDC gating is applied per router (`main.py:290-304`), so `test_oidc_route_gating.py` covers new routes.
- **Tunables:**
  - Read them with `runtime_settings.get_many([...])`, once per call site. Parse to int and clamp, copying `brief._resolve_window_hours` (`brief.py:321-339`).
  - Keys that are not in `_SETTINGS_FIELDS` fall through to the default, so `config.py` is never touched.
  - A missing key is not cached, so each call costs one query (`runtime_settings.py:214-241`).
  - A changed row takes up to 1 h to apply (cache TTL 3600 s, `:52`) unless it is written through `runtime_settings.set`. Document this in `ARCHITECTURE.md`.
- **Pure libraries** in `frontend/src/lib/*.ts` stay import-free, so `node --experimental-strip-types --test` can load them.
- **Flows:**
  - `flows.cjs` gets `tap(page, locator)` and `taps(page, max, id)`.
  - Any flow that taps a headline stubs `window.open`.
  - Flows that use Share stub `navigator.share`.
  - Each PR names the existing flows and smoke states it rewrites, so CI (`.github/workflows/build.yml`) is green at every PR.
- **Smoke:**
  - New sheets join `C12_ROOTS` (`smoke.cjs:68`).
  - Rows added to a column (tip, Show more, Show older, From) are never `<section>`: the `dashboard` state asserts one `main section` (`smoke.cjs:153`).
- **Sheets:**
  - `role="dialog"`, `aria-modal`, and the focus trap and inert pattern from `Drawer.tsx:122-242`.
  - Bottom `env(safe-area-inset-bottom)` padding and 44px rows.
  - Inputs are 17px `type="text"` with an `inputMode` (C15). URL fields add `autoCapitalize="none" autoCorrect="off"`.
- **Documentation:** each PR updates a root `UX_OVERHAUL.md` (changes, decisions, tap counts). It also updates `ARCHITECTURE.md` for new process-local state, and `frontend/scripts/iphone-audit/README.md` for new flows and states.
- **Screenshots:** `node scripts/iphone-audit/smoke.cjs <base> --out <dir> --only <state>`. After each deploy, the owner checks on the iPhone home-screen app.

---

## PR0: Merge #25 (display names, migration 0030)

**What you'll notice:** feeds show the name you typed.

**Changes:** merge #25 as it is. Later PRs build on:
- `labels.ts` `sourceLabel` / `rememberDisplayNames`, and `useSourceLabels.ts`
- `feedRules.ts` `uniqueSlug` / `cleanDisplayName`
- `sourceSaves.ts` `Field 'display_name'`
- the FeedEditor Name field
- flow `flow-fl-rename-keeps-filter-and-view`

**Migration:** `0030_source_display_name.py` (down_revision 0029). It adds a nullable column, so Postgres changes metadata only.

**Verification:** `alembic heads` shows exactly `0030`; CI is green.

**Risk:** low. Rollback is `alembic downgrade 0029`; the names people typed are lost.

---

## PR1: Reading, sorting and tabs behave

**What you'll notice:**
- Tapping a headline marks the story read; the card stays where it was, dimmed.
- Starring never moves you to another tab, and a new phone opens on For You.
- Newest | Best really reorders the tab.
- A visible "Mark all read" button; read stories fold into "Read (N)".
- Reset keeps saved stories, hidden stories and saved views.
- Brief says "needs an AI provider" when none is set up.

**Complaints:** "multi tapping", "upvote, downvote, star, read … all confusing", "Nothing is quick".

### Changes

**`lib/columns.ts` (new):**
- Keys `meta:brief`, `meta:saved`, `meta:foryou`, `meta:search`, `meta:filter` (removed in PR6) and `cat:<name>`, plus `colKey` / `parseColKey`.
- `resolveTab(tabs: {key, count}[], wanted, lastIndex) → {index, key}`:
  - If the wanted key exists, use it.
  - If it is missing, show the neighbour at `lastIndex` but keep the stored key, so the tab returns when its column does.
  - If nothing is stored, pick the first tab that is not Brief and not empty, preferring For You. A fresh device then never lands on an empty Saved tab or on Brief. smoke.cjs waits for a phone card in every state (`:75`, `:87`).

**`lib/sorting.ts` (new):**
- `entryTime = published_at ?? fetched_at`.
- `byNewest`: dated before undated, then by id.
- `byBest`: `composite_score` descending, then `byNewest`.
- `normalizeSort`: `top`, `oldest` and unknown values become `newest`.

**`storage.ts`:** add `mobileTab`. The old `mobileColLast` is read once to migrate, then removed.

**`App.tsx`:**
- Columns gain a `key` (977-992, 1028-1042).
- Replace `mobileCol` (557), `loadMobileCol` (147-157), `followTabRef` (561, 1547-1550, 2231-2234), `mobileColRef` and the clamp effect (1533-1564) with `mobileTab`.
  - It is written only by `selectTab(key)` (a `useCallback`) and by `jumpToCategory`.
  - Nothing resolves while `prefs.loading`.
  - A stored index migrates to `columns[i].key`; −1 becomes `meta:brief`.
- Tapping the active tab scrolls it to the top. The phone column becomes `<Column key={tabKey}>` (3088).
- `markReadOnOpen(col, id)` calls `markEntryRead` and adds the id to `stickyRead`. Single ✓ and swipe-right add to it too.
  - `stickyRead` clears on tab change and on manual refresh.
  - On desktop it also clears when the app returns after 5 minutes or more hidden.
- `toggleEntryRead` drops its Undo toast.
- `sectionsByColumn` (1162-1201) becomes a stable partition: unread or sticky goes to `new`. Delete `fresh.sort` / `past.sort`.
- The `columns` memo (1049-1078) sorts once with `normalizeSort`. For You defaults to `best`. **Saved is never sorted**, so its save order holds in PR3. The age filter uses `entryTime`; `minScore` is ignored.
- History sections default to collapsed (2434-2449).
- Wire `onOpenEntry` into the phone Column, the desktop grid, the desktop For You cards and `<SearchResults>`.
- Keyboard `b` records `bookmark` only when it stars.
- **`resetLocalState` (1328, keys 1357-1359):**
  - Stop deleting `starred_entries`, `hidden_entries` and `filter_presets`.
  - Delete only `read_entries`, `last_viewed`, `column_prefs` and `column_sections` rows, plus `history_group_by`.
  - Update the copy at `Settings.tsx:489-498`.

**`preferences.tsx`:**
- `ColumnPrefsValue.sort` (97) gains `'best'`.
- Pending writes also flush with keepalive on `visibilitychange: hidden` (today only `pagehide` / `beforeunload`, 555-586). In the home-screen app, opening a story usually fires only `visibilitychange`.

**`Column.tsx`:**
- The header (316) stays a `<header>`, but `role`, `tabIndex`, the handlers (279-303) and `title` go.
- A 44px "Mark all read" button (`aria-label="mark all read in <label>"`) sits before ⋯ and is repeated as the first popover row.
- Sort becomes a Newest | Best segmented control; the Minimum score slider goes.
- "Fresh" becomes "Unread" and "History" becomes "Read (N)".
- `ColumnSection` gets `onOpenEntry` and `stickyRead`.

**`Card.tsx`:**
- Thumbnail is its own component (1738): pass `onActivate` in as a prop.
- `commitMarkRead` sends dwell in seconds (cap 300).
- ☆ (~1430) and the menu's Save (~784) record `bookmark` only when the story was not starred.

**`BriefCard.tsx`:** calls `api.llmStatus()` once. When no provider is set up:
- Every Generate button (540, 588, ~649) and the header Brief button (`App.tsx` 2690) become a 44px "Brief needs an AI provider · Set up", which calls `onOpenSettings('llm')`.
- `Settings.tsx:411` already disables its button; it gains the same hint line.

**`smoke.cjs`:** the App header gets `data-app-header`. The `dashboard` check (145-149) reads `header[data-app-header] button`, because a Column title row is also a `<header>`.

### Backend
- **`interactions.py:272-273`:** delete `type_list.append("dwell")`, which empties History today.
  - With no `types`, the default excludes both `dwell` and `view`, so the on-mount `view` events (`Card.tsx` 499-506) do not flood History.
  - An explicit `types` value is honoured.
- **`sources.py:1152-1154`:** the Reddit Test branch uses `reddit_client.fetch_subreddit(…, limit=25)`.
  - Reddit disabled → `unsupported_type`; throttled → `network_error`; empty listing → `not_found`.

### Tests
- **Unit:**
  - `sorting.test.ts`.
  - `columns.test.ts`: neighbour fallback, index migration, and a fresh device skipping empty Saved and Brief and preferring For You.
- **pytest:**
  - `test_interactions_history_types.py` (db): with no types, click, bookmark and never rows come back, with no view or dwell; `types=view` returns views.
  - `test_source_test_reddit.py` (no_db).
  - slice21: add `stickyRead` to the comparator props.
  - slice19: keep the literal "no entries in this column yet".
- **Flows** (stub `window.open`):
  - `flow-open-marks-read`.
  - `flow-tab-stays-on-star`: uses **News**, because the fixtures have no tech tab.
  - `flow-sort-best`.
  - `flow-mark-all-read-button`.
  - `flow-brief-needs-ai`: every Generate button.
  - `flow-reset-keeps-saves`: no DELETE of starred, hidden or presets.
  - `flow-visibility-flush`: mark read, fire hidden, and a keepalive PUT goes out within the 250 ms debounce.
  - FM stays green.
- **Smoke:** `column-popover`, `brief-needs-ai`, and the 320px header (C11, C14).

### Risks and rollback
- Dwell sent in seconds shifts For You slightly; this is the unit fix the critique sanctioned.
- An old bundle reads `best` as oldest-first (`App.tsx` 1058-1064) until the PWA reloads.
- Revert is safe; the old build opens tab 0.

---

## PR2: One number per tab; Refresh checks feeds; devices stay in sync

**What you'll notice:**
- Each tab shows its unread count (99+); "+N new" is gone.
- Refresh says "Checking 6 feeds in News", then "News: 3 new stories".
- Stars and reads made on the laptop appear on the phone.
- A 100-story tab opens with 30 cards and a "Show 70 more" row.
- Two quick hides give one "2 hidden · Undo".

**Complaints:** "the fresh vs not … confusing", "try to refresh … to see if it … pulls", "Nothing is quick".

### Changes

**`App.tsx`:**
- Delete:
  - `newCountByColumn` (1108-1125)
  - `seenEntryIdsRef` / `hiddenAtRef` (828-830, 1260, 1445, 1678-1681, 2163-2166, deps at 2187)
  - `HIDDEN_RESET_MS` (78)
  - `MAX_SEEN_ENTRY_IDS` / `capSetFIFO` (187-210)
  - the seen-set block (1244-1260)
- **Stop writing `lastViewed`.** Its only reader was the chip. Existing rows stay, and Reset still deletes them; documented.
- **Badge** (3044-3064): the unread count, shown as `99+` above 99, with `aria-label="<tab>, N unread"`. Saved has no badge. Column `newCount` becomes `unreadCount`.
- `manualRefresh` snapshots ids before refreshing. The `'refreshed'`, `'Entry unhidden.'` and `'Column restored.'` toasts are removed.
- **`checkTabNow()` (D10):**
  - Takes the active feeds of the current `cat:` tab (and `view:` tabs from PR6), stalest first, at most 20, and calls `api.checkNow(ids)`.
  - Toast: "Checking N feeds in \<tab\>. New stories appear here within a minute."
  - A silent `refresh()` at +25 s and +70 s (timers cleared on tab change), then "\<tab\>: N new stories" or "nothing new".
  - Meta tabs queue nothing and explain why.
  - On desktop, Refresh and `r` queue the 20 stalest feeds across the visible columns.
- Empty-state copy (2836).
- `refresh()` and the visibility handler call `prefs.resync()`.

**`Column.tsx`:**
- Delete the chip (343-370) and `onRefresh`.
- Header text: "N unread", or "All caught up · Show N read".
- `ColumnSection` renders 30 cards, then a 44px `[data-show-more]` row (+30 per tap). Keyboard ↑/↓ past the last rendered card expands the list first.

**Delta sync (replaces read-merge-write):**
- **Backend `PATCH /api/preferences/{key}`**:
  - Allowed only for set keys (`starred_entries`, `hidden_entries`, `read_entries:*`, `voted_entries`; `muted_sources` joins in PR4). Any other key returns 400.
  - Body: `{add?: int[], remove?: int[]}`, or `{set?: {id: 1 | -1 | null}}` for votes.
  - One transaction: `INSERT … ON CONFLICT DO NOTHING`, `SELECT … FOR UPDATE`, apply, trim the oldest down to the cap (200 / 1000 / 1000 / 2000, pinned against `preferences.tsx:792-797`), write, return the value.
- **`lib/prefSync.ts` (pure):** `isSetKey`, `foldDelta`, `applyIdDelta`, `applyVoteDelta`, and `mergeIncoming(prev, server, pending)`. `mergeIncoming` reuses the previous reference for every key that is structurally unchanged, so a resync does not re-render every Column (`_columnPropsEqual`, `Column.tsx:890-915`).
- **`preferences.tsx`:**
  - Setters record a delta. The flush sends PATCH for set keys and PUT for the rest, and the returned value is adopted through `mergeIncoming`.
  - The hidden and `pagehide` flushes send the same PATCH with keepalive.
  - `resync()` GETs `/api/preferences` on resume and on each poll, one request at a time.
- Old clients keep using PUT.

**`api.ts`:** `patchPreference`, `checkNow(ids, force?)`.

**`Toast.tsx`:**
- `group` / `count` options; events in the same group merge, and Undo replays the stored callbacks in reverse (at most 20).
- The ▲ and ▼ thank-you toasts go (`Card.tsx` 797, 808, 1294, 1321).
- Hides use group `hide`.

### Backend
- **`scheduler.queue_check(ids, force=False)`:**
  - Job id is `ingest:<name>` or `_dynamic_job_id`.
  - Calls `modify_job(next_run_time=now + i*3 s)` for at most 20 feeds.
  - Cooldown: `refresh.cooldown_seconds` (default 600; `force` uses 60), kept in `_last_queued` and listed in `ARCHITECTURE.md`.
  - Inactive feeds and feeds with no job are reported as `paused`.
- **`misfire_grace_time=120` on ingest jobs** (1800-1810, 2127-2150). APScheduler 3.11.3 defaults to 1 s, and trafilatura blocks the loop (`generic_scrape.py:136-141`). A queued run that wakes more than 1 s late was silently skipped, and so were some regular polls.
- **`POST /api/sources/check-now`** (`_write_deps`): `{source_ids: 1..50, force}` → `{queued, cooling_down, paused, queued_ids}`.

### Tests
- **Unit:** `prefSync.test.ts` covers two devices, reference identity for unchanged keys, caps and votes.
- **pytest:**
  - `test_check_now_queue.py`.
  - `test_ingest_misfire_grace.py`: checks the job attribute, and runs a started `AsyncIOScheduler` whose loop is blocked 2 s; the job must still run.
  - `test_preferences_delta.py` (db): two concurrent PATCHes both land; the cap holds; non-set keys return 400; an anonymous user works.
  - slice21: replace `newCount` with `unreadCount`.
- **Flows:**
  - `flow-badge-unread`, `flow-refresh-checks-tab`, `flow-prefs-resync`, `flow-toast-merge`, `flow-show-more`.
  - FN: retarget the regex at `:818` to the new Refresh toasts.
  - `capture.cjs`: mock check-now and the preference PATCH.
- **Smoke:** `dashboard` with a long tab and `show-more`.

**Risks:** revert is safe; both endpoints are additive.

---

## PR3: Smaller tabs (time window, first-fetch cap, On This Day)

**What you'll notice:**
- News shows the last 2 days, so its badge is about 20.
- A new podcast adds its newest 10 episodes, even if it first works days after you added it.
- Slow feeds still show their latest 3 stories, under "Older".
- "Show older stories" at the end of each tab.
- Saved holds every save; paused feeds leave the tabs.
- On This Day posts 5 items a day in its own tab.

**Complaints:** "Most tabs have over a hundred things when I add a feed and I have no idea why".

### Backend

**`app/ingest_rules.py` (new, pure):** `select_items_for_ingest(items, *, first_fetch, baseline_at, now, keep_first=10, backfill_h=48, max_age_d=30, per_poll=50) → (kept, counts)`.
- First fetch: the newest 10 (undated stories after dated ones) plus everything from the last 2 days.
- Later polls: drop items dated before `baseline_at − 2 d` or before `now − 30 d`.
- Every poll: at most 50, newest first.

**Tunables** (read with `get_many`): `ingest.first_fetch_keep`, `ingest.backfill_hours`, `ingest.max_age_days`, `ingest.max_per_poll`.

**`scheduler._ingest`:**
- Call the rule after the normalize loop (405-411) and before the known-URL query (412-420), so skipped items cost no embedding.
- `summary["skipped"]` and `IngestResult.skipped: int = 0`.
- **When a fetch succeeds while `last_fetch_at` is still NULL, set `created_at = now`.** The watermark then starts at the first success, so a feed that was blocked for days does not flood the tab once it works.

**`update_source`, `if url_changed:` (2380):** set `last_fetch_at = None`. The next success resets `created_at`. Document `created_at` in `models.py` as "first successful read of this address"; nothing else reads it.

**`GET /api/entries`:**
- New parameters: `max_age_hours` (1..8760), `per_source_floor` (0..10), `per_source_cap` (1..200), `active_only`.
- Floor and cap require `max_age_hours` (422 otherwise). `active_only` works on its own.
- With a window set, an inner select bounded by `fetched_at ≥ now − 90 d` computes `src_rn` per source and keeps:
  `((fetched_at ≥ cutoff AND (published_at IS NULL OR published_at ≥ cutoff)) OR src_rn ≤ floor) AND src_rn ≤ cap`
- **The window, `active_only` and the hidden exclusion go inside the `ranked` subquery** on the per-category path, because entries.py 407-417 builds a fresh `select` that drops earlier `.where`s. On the flat path they go on `stmt`.
- Requests without `q` always exclude the caller's `hidden_entries`. Old clients already filter hidden stories themselves, so all they see is the per-category slots refilling.

**`GET /api/foryou`:** the same opt-in window, plus the hidden exclusion.

**`brief.py` 386 and 451:** add a guard on `published_at`.

**Wikipedia On This Day (O2):**
- Keep only `selected` items, at most 5 a day; category `on_this_day`.
- `_upsert_source` returns existing rows unchanged (`scheduler.py:110-135`). So `start_scheduler` moves the existing row once, only if it is still in `news`, behind the app_settings marker `builtin_category_moved:wikipedia_on_this_day`.

**VPS:** run `EXPLAIN (ANALYZE, BUFFERS)` of both window paths, read-only, before merging; the target is under 150 ms.

### Frontend
- **`lib/window.ts`:** `WINDOW_DEFAULT = '2d'`, `effectiveWindow`, `inWindow`. Legacy `maxAgeHours` maps to `'1d'`.
- **`ColumnPrefs.window`** (and `ColumnPrefsValue`). "Show stories from" replaces "Hide if older than".
- **`refresh()`:** `entries({perCategoryLimit: 100, maxAgeHours: 48, perSourceFloor: 3, perSourceCap: 25, activeOnly: true})` and `forYou({limit: 50, maxAgeHours: 48})`.
- Tabs set wider than 2 days fetch their own rows into `extraByTab`; only the visible tab refetches.
- **"Show older stories"** (44px) steps that tab to 7 days, then All.
- **Badge:** counts only unread stories that are `inWindow(entryTime)`. The floor's older stories render after an "Older" divider and are not counted; they are never filtered out on the client.
- **Saved** loads missing ids with `api.entriesByIds` (`api.ts` 549), newest save first. This replaces `visibleStarred` (946-962) and must ship in the same PR as the window.
- **Undo of a hide** re-inserts the cached Entry, because the server now excludes hidden ids.
- **Card** shows "On this day" instead of a time for `HISTORICAL_SOURCES`, pinned against `brief._HISTORICAL_SOURCE_SLUGS`.

### Tests
- **pytest:**
  - `test_ingest_rules.py`.
  - `test_ingest_backfill_cap.py`.
  - `test_first_success_resets_baseline.py`: fails for 3 days, then the first success adds 10 plus the last 2 days, and nothing older follows.
  - `test_source_url_change_resets_first_fetch.py`.
  - `test_entries_window.py`: both paths; floor; cap; 422; `active_only`; hidden; no parameters.
  - `test_foryou_window.py`.
  - `test_brief_published_guard.py`.
  - `test_wikipedia_selected.py`.
  - `test_builtin_category_move.py`: moves once, only from `news`.
- **Rewrite** `test_ingest_skips_known_urls.py`. Its fixed `_NOW = 2026-10-01` falls behind the watermark, so use relative dates and assert `skipped`.
- `test_entries_per_category.py` must stay green.
- **Unit:** `window.test.ts`.
- **Fixtures:** stories 3 and 10 days old, and a paused feed.
- **Flows:** `flow-window-default`, `flow-show-older`, `flow-saved-by-id`, `flow-paused-hidden`, `flow-badge-in-window`.
- **Smoke:** `show-older` at 390 and 320.

**Risks:**
- Stories older than 90 days drop out of the floor.
- HN is capped at 25 per tab.
- The backend parameters do nothing without the new frontend, so reverting the frontend alone is safe.

---

## PR4: Card face, "Not interested" and hiding a feed

**What you'll notice:**
- Cards show ☆ Save, ✓ Read and ⋯, plus the summary chevron where there is one.
- ⋯ opens a sheet: Not interested, More like this, Hide stories from \<feed\>, Edit feed, Copy link, Share, Open in browser.
- Swipe left means Not interested.
- A one-time tip, and Menu → "How Popping works".

**Complaints:** "upvote, downvote, star, read … I hardly know what to do", "Nothing is intuitive to a new user".

### Changes

**`ActionSheet.tsx` (new):** `openActionSheet({title, actions})` plus `<ActionSheetHost/>`.
- 44px rows, `role="dialog"`, `aria-label="story actions"`.
- The focus trap and inert pattern from `Drawer.tsx`; closes on an outside tap and on Esc.

**`Card.tsx`:**
- Remove ▲ / ▼ (1279-1335) and 👁 (1448-1474).
- Add ⋯ (`aria-label="more actions"`, `data-card-more`, `data-card-interactive`).
- Footer: [⌄] … [☆ Save] [✓ Read] [⋯], with labels shown at a container width of 340px or more.
- `buildActions()` replaces the inline list (724-824); desktop right-click shows the same list.
- **"Open in browser"** keeps `window.open(safeExternalUrl(…))`. Update `test_slice30_safe_external_url.py:150-152` to the new label, and keep Thumbnail's `const open = () => {` literal (`:183-188`).
- **Share and Copy link** call `navigator.share` / `clipboard` synchronously inside the tap handler, because iOS requires a user gesture. Share appears only when `navigator.share` exists.
- More like this toggles the vote (`voteInteractionEvents`, 254).
- **Swipe left** calls `onNotInterested`.
  - Delete `commitHideToggle`'s `never` (558-564).
  - Update the touchmove effect's deps and the reveal label.
  - Without the handler, swipe-left is clamped dead (655).
- New callback props `onNotInterested` and `onMuteSource`.

**`App.tsx`:**
- `notInterested(col, id)` records `never` once (D2), then calls `hideEntry` and `markEntryRead`. Toast group `hide`.
- Keyboard `h` calls it.
- `muteSource(id)` updates `muted_sources`; `visibleEntries` / `visibleForYou` (886, 911) drop muted feeds.
- **Wire both callbacks** into the phone and desktop Columns, the desktop For You row and `SearchResults`.

**`preferences.tsx`:** `muted_sources` (`number[]`, cap 500), with validation, `setMutedSources`, and a set key for the PR2 delta.

**`routes/preferences.py`:** allowlist `muted_sources` (107-127, 131-150) and add it to the PATCH set keys with cap 500.

**`FeedManager.tsx` `SourceRow` (258):** a "Hidden from tabs" tag.

**`FeedEditor.tsx`:** a "Show stories in tabs" switch next to Pause (540-566). It writes the preference, not the source row.

**`Settings.tsx`:** the Hidden tab becomes "Not interested" (116).

**`TipCard.tsx`:**
- A `<div>`, not a `<section>`, above the first card, shown once per device (`STORAGE_KEYS.tipDismissed`).
- Text: "Tap a headline to read it. ☆ keeps it in Saved. ⋯ has Not interested and more. Swipe right = read, left = not interested."

**`ShortcutsSheet.tsx` becomes "How Popping works":**
- Touch section first: the card actions, swipes, the badge and Refresh.
- Keyboard table on md and up, with `b` and `h` added.
- It is already `role="dialog" aria-modal` (82-84); add a focus trap and safe-area padding.
- New first-group Menu row (`Drawer.tsx:327`).

**`smoke.cjs`:** add the action sheet and the help sheet to `C12_ROOTS`.

### Tests
- **pytest:**
  - `test_preferences_anonymous.py` round-trips `muted_sources`, including PATCH.
  - slice30 regex updated.
- **Flows:**
  - `flow-card-sheet`: stubs `navigator.share`; 7 rows of at least 44px.
  - `flow-not-interested`: 2 taps; one `never`.
  - `flow-swipe-left-once`: no `thumb_down`.
  - `flow-swipe-left-search`.
  - `flow-mute-source`.
  - `flow-tip-once`.
  - `flow-help-sheet`.
- **Smoke:**
  - The `card-summary` selector stays as it is.
  - New states `card-action-sheet` (390 / 320), `tip-card` and `help-sheet`; C7, C11 and C12 apply.

**Risks:**
- The per-feed vote badge now counts only More like this.
- Revert is safe; the new preference key is simply ignored.

---

## PR5: Tab order and hiding

**What you'll notice:**
- An "Edit" pill at the end of the strip opens ↑/↓ and Show switches; changes apply at once.
- Brief stays first; Saved and For You are always present; new categories go at the end.
- Desktop follows the same order.
- Every tab has ⋯.
- An empty tab says why.

**Complaints:** "can't organize categories in the order I want", "hunting through shit".

### Changes

**`lib/categories.ts`:**
- `orderColumns(available, layout) → {shown, hidden}`: listed keys first, in their order. Unlisted keys follow in the default order (Saved, For You, categories A→Z), minus hidden ones.
- `moveKey`, `normalizeLayout`.

**`preferences.tsx`:** `category_layout` `{v: 1, order, hidden}` with validation and `setCategoryLayout`. One PUT per change; last write wins.

**`routes/preferences.py`:** allowlist the key.

**`App.tsx`:**
- Categories come from active sources together with entry categories (891, 904-910); a category with only paused feeds gets no tab (D9).
- `allSubsColumns` always includes `meta:saved` and `meta:foryou`, with empty hints, and then applies `orderColumns`.
- The tab chosen on a fresh device still comes from `resolveTab` (PR1), so putting Saved first never opens an empty Saved tab.
- The desktop grid (~2936-2998) and the Jump list use the same order.
- **Edit pill:**
  - 44px, **outside** `role="tablist"` (3012-3017).
  - Pinned at the trailing edge, outside the scroller, so it is never off-screen.
- When a tab is selected programmatically (star, jump, new tab), it scrolls into view.

**`Column.tsx`:**
- ⋯ shows on **every** tab (today it is hidden for For You, `:385`). For You's popover has Sort (Best by default), "Show stories from" and the tab actions.
- Tab actions: Move earlier, Move later, Hide this tab, Edit tabs….
- **`EmptyColumnMessage` (820-877)** gains `columnFeeds: Source[]`: "Waiting for first check", "N feeds failing · Open" or "Nothing in the last 2 days · Show older". Keep `sourcesByName` and the slice19 literal.
- `columnFeeds` is memoized per column and added to `_columnPropsEqual`; slice21 gets the new prop.

**`TabsEditor.tsx` (new):**
- Built on `GroupedSection` / `GroupedRow`, moved from `Drawer.tsx:520-618` to `components/Grouped.tsx`.
- ↑ / ↓ buttons (44px, disabled at the ends) and a Show switch; Brief is pinned.
- Done closes it; there is no Save.
- `role="dialog"`, a focus trap, safe-area padding, and an entry in `C12_ROOTS`.
- Opened from the pill, from a Menu row "Edit tabs", and from column ⋯.

**`feeds/CategoryPicker.tsx`:** "Your categories" in tab order.

**`ShortcutsSheet.tsx`:** a paragraph on editing tabs.

### Tests
- **Unit:** `categories.test.ts` (new key at the end, hidden, move, empty layout keeps today's order).
- **pytest:** allowlist test; slice21 `columnFeeds`.
- **Flows:**
  - `flow-tabs-reorder`: at most 3 taps; one PUT; desktop order checked at 1280px.
  - `flow-tab-hide`.
  - `flow-new-category-at-end`.
  - `flow-saved-always`.
  - `flow-fresh-device-opens-foryou`.
  - `flow-foryou-menu`.
  - FM stays green.
- **Smoke:**
  - `tabs-editor` at 390 and 320.
  - `dashboard`: the pill is visible at 312px (C11), and the `data-app-header` scoping holds.

**Risks:** nothing changes until the owner edits the order. Revert drops the order; the key is ignored.

---

## PR6: Saved views become custom tabs

**What you'll notice:**
- Your views are tabs. Under each one's header: "From: BBC News, The Verge, +3 · Edit".
- Ticking a feed saves at once.
- The chip rows above the tabs are gone.

**Complaints:** "I don't understand how to modify or save views", "multi tapping".

### Changes

**Data (O3):**
- New global key `custom_tabs` with value `{v: 1, tabs: [{id, name, sources: number[]}]}` (cap 50).
- **One-time conversion:** when `custom_tabs` is absent and `filter_presets` is not empty, map `activeSources` names to ids through `sourcesByName` and drop `columnPrefs` (D8).
  - Ids come from `preset.id`, so two devices converting give the same ids.
  - `filter_presets` stays untouched, so a rollback keeps the old views.
- Allowlist `custom_tabs`.
- This departs from the critique's `pr_order`, which kept tabs inside `filter_presets`. Owner to confirm.

**Column keys (D8):**
- Preference suffixes become keys: `column_prefs:cat:<name>`, `view:<id>`, `meta:*`.
- Reads use `columnPrefs[key] ?? columnPrefs[legacyName]`; writes go to the key only.

**`App.tsx`:**
- Custom tabs join `allSubsColumns` as `view:<id>`, ordered by `category_layout`.
- **Fetching:** a shown tab (selected on the phone, visible on desktop) fetches `entries({source: names, limit: 200, maxAgeHours, perSourceFloor: 3, activeOnly: true})`, and refetches on each poll while visible.
- **Badges for tabs not selected** come from the dashboard data, filtered by `source_id`, so they need no extra fetch.
- An explicit tab ignores `muted_sources`; the tab sheet marks muted feeds.
- `checkTabNow` queues the feeds of a `view:` tab.

**`Column.tsx`:** for `view:` tabs, a 44px `<div>` line "From: … · Edit" opens TabSheet. Seeing the feeds takes 0 taps; editing takes 1.

**`TabSheet.tsx` (new):**
- A 17px name field.
- A search field (`type="text" inputMode="search"`).
- A feed checklist grouped by category in tab order, labelled with `sourceLabel`, with a FeedStatus slot filled in PR7.
- Each change is a debounced PUT.
- Delete uses an inline confirm.
- Dialog, focus trap, safe area, and an entry in `C12_ROOTS`.

**Removed:**
- `PresetChips` (233-460, 2768-2774).
- `activeSources`, `viewKind`, `multisub*` (571, 967-1044) and **the `activeSources` refetch effect**.
- The filter chip row (2702-2735).
- The handlers at 1860-1930, 2189 and 2362-2369.
- `onSourceRenamed` (2200) and its `onRenamed` store hook.
- Drawer "Save current view" (340-383) and "Sources" (404-495).

**Reset:** PR1 already keeps saves. The new keys (`custom_tabs`, `category_layout`, `muted_sources`) are never in its delete list; a test checks this.

### Tests
- **Unit:** `customTabs.test.ts` (conversion, unknown names dropped, idempotent, same ids from the same presets) and `columns.test.ts` (legacy fallback).
- **pytest:**
  - slice21 `HANDLERS`: remove `toggleSource`, `toggleSourceAndMaybeClose`, `clearSourceFilters` and `onSourceRenamed`; add `selectTab`. Do **not** add `setCustomTabs`: it comes from `usePreferences`, so it never matches `const … = useCallback(`.
  - Keep the `sectionsCollapsedCache[columnName]` literal.
  - slice19 unchanged.
- **Flows:**
  - **FT, FA and FA2** (`flows.cjs` 357-462) and `capture.cjs:534` clicked the Menu's `edit <feed>` buttons. They now open the editor through Menu → Settings → the row, or `?source=`.
  - FL becomes `flow-fl-rename-in-custom-tab`.
  - FPR becomes `flow-custom-tab-create` (at most 6 taps).
  - `flow-custom-tab-from-line`: the line is visible; Edit is 1 tap; adding a feed is 3 taps.
  - `flow-preset-convert`: one PUT.
  - `flow-reset-keeps-data`.
  - FU moves to desktop width.
- **Smoke:** remove the preset-strip expectations; add `tab-sheet` and `custom-tab`.

**Risks:** this removes UI the owner used. The old views survive in `filter_presets`, and reverting brings the chips back.

---

## PR7: Feed health you can see (migration 0031)

**What you'll notice:**
- Every feed row has a pill: Checking, OK · 12 this week, Quiet · nothing in 7 days, Found nothing, All already in Popping, Blocked, Failing, Stopped, Paused, Reddit off.
- Each problem shows one fix button.
- My feeds has search, "Needs attention" at the top, category headings in tab order, and a "Built in" heading with 24 h counts.
- Check now and Refresh show their results in place.

**Complaints:** "it didn't tell me if it is actually pulling", "I have to filter just for that", "change the settings, like browser".

### Migration

`0031_source_health.py`:
- `down_revision = "0030"`.
- Adds `last_attempt_at` (timestamptz), `last_item_count` (int) and `last_new_count` (int), all nullable with no default. The `models.py` fields are Optional.
- No `fetch_mode` (O1).

### Backend

**`_ingest` writes:**
- Success: `last_attempt_at`, `last_item_count` (normalized count before the cap) and `last_new_count`.
- Failure: `last_attempt_at`.
- Paused: `summary['status'] = 'paused'`, using a new `IngestResult.status: Optional[str]`. PR3's `skipped` is an int, so `IngestResult(**summary)` (`routes/ingest.py:54-55`) would return 500.

**Blocked websites are reported as blocked:**
- `fetch_html_checked` in `article_extract.py` raises `HTTPStatusError` on any status of 400 or more. `fetch_html` keeps returning None for its other callers.
- It is used for robots, sitemap and listing fetches. Headers are threaded through `discover_sitemap_urls` (199), `_crawl_sitemaps` (363), `_section_candidates` (103) and `_discover_page_links` (332).
- `discover_feed_url` (79) gains `headers=None`.

**Zero yield is no longer silent:**
- A website feed with no candidates raises `NoArticleListError` → `[no list]`.
- `fetch_rss` raises `NotAFeedError` → `[not a feed]` when there are zero entries **and** the Content-Type contains `text/html` or the body starts with `<html` / `<!doctype html`. `_looks_like_feed` accepts any `text/*`, so it cannot decide this. Keep the single `ET.fromstring` (slice23).
- A valid feed with 0 items stays a success.

**Reddit off:**
- `_ingest` checks `reddit_client.is_disabled()` before fetching a Reddit feed and records `last_attempt_at` and `[reddit off]`.
- The plugin is unchanged, so `test_dynamic_reddit_warned_disabled_cap.py` still passes.

**`error_count` (which drives `auto_disabled`, `models.py:103`):** `[reddit off]`, and `[no list]` within 24 h of `created_at`, never increment it, never back off and never auto-disable. Every other error kind behaves as today.

**`SourceOut`** gains Optional fields: `last_attempt_at`, `last_item_count`, `last_new_count`, `stories_24h`, `stories_7d`, `newest_story_at` and `has_stories`.
- One `GROUP BY` over the last 7 days with `FILTER`.
- `has_stories` is an `EXISTS` on the indexed `source_id`.
- Run `EXPLAIN` on `/sources` as well.

**PATCH `type`:**
- Allowed only for dynamic feeds, and only between rss, podcast and generic_scrape (`SourceUpdate` has no `type` field today).
- It rebuilds the job (`scheduler.py:2453-2477`) and nulls `last_fetch_at` (D6).

**`trigger_now`** reuses the job's plugin.

### Frontend
- **`api.source(id)`** (new).
- **`feedHealth()`** returns `checking | ok | quiet | empty | nothing_new | blocked | failing | stopped | paused | reddit_off | never`. `needsAttention()` is true for the problem states.
- **`apiErrors.ts` `ERROR_ACTIONS`** maps each kind to one sentence and one action. FeedStatus, FeedEditor's Last problem box and `EmptyColumnMessage` all use it:

  | Kind | Action |
  |---|---|
  | not_found | Edit address |
  | network / timeout / upstream | Check now, with "next try at …" |
  | blocked | Read as Safari (O1): PATCH the User-Agent from `headers.ts`, with Undo |
  | stopped / paused | Resume |
  | no_list | Pick a section |
  | empty | Check now |
  | nothing_new | Delete |
  | not_a_feed | Edit address (Find its feed in PR9) |

- **`FeedStatus`** appears in `SourceRow`, TabSheet, `EmptyColumnMessage` and the Menu subtitle.
- **`MyFeedsTab`** (210-252) gains:
  - a sticky 17px search field
  - Needs attention, then categories via `orderColumns`, then "Built in" (`isBuiltIn`)
  - the frozen-order logic (222-235) is kept
- **`applyServerSource`** (`App.tsx` 2237) keeps the new count fields from the previous row, the same way it keeps `net_vote_score`, so the pill does not flicker after an autosave.
- **Check now:** `api.checkNow([id], true)`, then poll `api.source(id)` every 5 s for up to 90 s, then show an inline line and 3 titles.
- **`checkTabNow`:** polls `api.sources()` every 5 s for up to 90 s, then shows "Checked 6 feeds · 3 new · 1 problem".

### Tests
- **pytest:**
  - `test_migration_0031_source_health.py`: single head; every column nullable with no default.
  - `test_source_health_fields.py`: counts; Reddit off leaves `error_count` unchanged; the 24 h exemption; a loopback 403 website shows `[blocked]`.
  - `test_rss_not_a_feed.py`.
  - `test_sources_story_counts.py`.
  - `test_source_patch_type.py`.
  - `test_ingest_paused_status.py`.
  - Extend `test_scheduler_backoff.py` and `test_trigger_now_accepts_dynamic_sources.py`.
- **Rewrite** `test_plugin_no_page_links_when_link_pattern_none` (`:90-103`) to expect `NoArticleListError`. `probe` catches the error and still returns `[]` (`test_generic_scrape.py:58-63`).
- **Unit:** `feedHealth.test.ts`, `apiErrors.test.ts`.
- **Flows:**
  - `flow-feeds-needs-attention`.
  - `flow-feed-search`.
  - `flow-check-now-inline`.
  - `flow-refresh-results`.
  - `flow-read-as-safari`: 3 taps, a PATCH, and Undo.
  - `flow-pill-stable-after-edit`.
- **Smoke:** `settings-feeds`.

**Rollback:** revert the app first, then `alembic downgrade 0030`.

---

## PR8: Website feeds pull only articles

**What you'll notice:** a pasted site pulls this week's posts, not About, Contact, tag, author or shop pages. Undated stories sort last and say "date unknown".

**Complaints:** "it pulls random not articles from the site".

### Backend

**Dependencies:** only packages already installed: `courlan` 1.4.0, `lxml` 6.1.3, `tld` and `trafilatura` 2.3.1 (`requirements.lock:47, 109, 219, 230`).

**`app/article_detect.py` (new, pure):**
- `url_ok(url, site)`: `courlan.check_url(strict=True)` plus a list of non-article segments (about, contact, privacy, terms, tag(s), category, author, page/N, search, login, account, cart, shop, subscribe, careers, jobs, faq). A single-segment page at the root passes only when it looks like a slug or carries a date.
- `classify_sitemap(url)`: prefer news, post, article and blog sitemaps; skip category, tag, taxonomies, author, user, page, product, attachment, image and video ones.
- `score_page(data, requested, final, hint) → (score, reasons)`, accepted at a score of 2 or more:
  - +3 for an `og:type` or JSON-LD article kind; +1 for a date; +1 for 600+ characters.
  - −3 for a website, collection or about kind; −2 under 300 characters; −3 when the title equals the site name or "404"; −3 for a redirect to another path; −2 for a canonical URL elsewhere; −1 for no date.
- `listing_links(html, page_url)` with `lxml.html`:
  - honours `<base>`; `urljoin` against the page; `courlan.normalize_url`
  - same site by `is_external`
  - drops nav, header, footer and aside
  - anchor text of at least 15 characters or 3 words
  - the largest group of 3 or more links sharing an ancestor signature and URL template
  - reads `<time datetime>`

**`feed_autodiscovery.py`:**
- `_parse_sitemap_entries` (284-307) returns `(url, date, title)`, including `news:publication_date` and `news:title`.
- `_crawl_sitemaps` puts preferred sitemaps first and skips the skip-list. Headers are already threaded from PR7.

**`generic_scrape.py`:**
- **One `plan_candidates(url, sitemap_url, link_pattern, headers) → Plan`**, used by both `fetch` and `probe`. `probe` keeps returning `[]` on `NoArticleListError`.
- A non-root URL is read page-first; a root URL is sitemap-first.
- `link_pattern` filters every candidate.
- Remove the silent whole-sitemap fallback in `_section_candidates` (103-112).
- Before extraction, one `SELECT Entry.url IN (…)` skips stored stories.
- At most 2 undated pages per poll.
- `_extract_one` uses `score_page`. `fetch_html` gains `return_final_url` (`article_extract.py:60`).
- **`_extract_links_from_html` stays as a thin wrapper over `listing_links`,** so the six `test_extract_links_*` tests keep passing.

**`ARCHITECTURE.md`:** `_extracted_urls` is now only a cache.

### Frontend
`Card.tsx` shows "date unknown" when `published_at` is null. Sorting is already handled by PR1.

### Tests
- **`test_article_detect.py`** (no_db), with fixtures in `backend/tests/fixtures/scrape/`:
  - WordPress and Yoast sitemap indexes, a Shopify sitemap and a Google News sitemap
  - a listing page with nav and pagination
  - an about page with `og:type=website`
  - a redirect to the home page, and a soft 404
- The owner supplies the URLs of the sites that pulled junk; their HTML is saved offline as fixtures.
- **Rewrite:**
  - `test_plugin_sitemap_wins_over_page_links`: a non-root URL is page-first.
  - `test_generic_scrape_sitemap_url.py:249-270`.
  - `test_sitemap_newest_first.py`: news and post sitemaps first. `test_fetch_falls_back_to_whole_sitemap_when_section_empty` (100-109) now asserts there is **no** fallback.
- **New:** `test_generic_scrape_skips_stored.py` (db).

### Verification and risks
- From the VPS, probe each junk site read-only (`docker compose exec backend python -c …`) and compare with the old picks. Screenshot a former junk site's tab.
- Some website feeds pull fewer stories or show `[no list]` in Needs attention.
- Revert is safe; no data changes.

---

## PR9: One add flow with a preview

**What you'll notice:**
- ≡ → Add feed gives one field. Preview shows the stories Popping will pull: "10 added · 3 show in News now, 7 under Show older; 87 older skipped."
- The category defaults to your current tab, and the name is prefilled.
- After Add: "Checking…", then "✓ 10 stories in News" with 3 titles.
- A blocked site shows "Reading as Safari · Undo".
- A web-page feed gets "Find its feed".

**Complaints:** "Feeds are added and then I have to click edit … didn't tell me if it is actually pulling", "change the settings, like browser".

### Backend (`routes/sources.py`)

**`BROWSER_HEADERS`** goes in `backend/app/sources/rss.py`:
- The same Safari User-Agent as `headers.ts BROWSER_USER_AGENT`, plus `Accept-Language`.
- Pinned against `headers.ts` in `test_frontend_feed_editor_rules.py`.
- The backend has no `BROWSER_HEADERS` today, only `youtube._BROWSER_UA`.

**`POST /api/sources/preview`** (`_write_deps`):
- Request `{url, type?, custom_headers?, sitemap_url?, link_pattern?}`.
- `asyncio.Semaphore(2)`, a 120 s TTL cache (at most 32 entries), an overall 60 s `wait_for`, and `to_thread` for parsing. Document the semaphore and cache in `ARCHITECTURE.md`.
- **SSRF-guarded fetchers only:** `fetch_html` / `fetch_html_checked`, the rss fetch, and `discover_feed_url(headers=)`.
- Pipeline:
  1. YouTube and Apple resolution
  2. Reddit
  3. Fetch as a feed. On 401/403 or a challenge page, retry once with `BROWSER_HEADERS`, only if the caller sent no User-Agent. Website mode retries the same way through `fetch_html_checked`.
  4. `discover_feed_url`
  5. `plan_candidates`, then up to 8 extractions
- Response fields:
  - `ok`, `kind`, `url`, `headers_used`, `mode`, `feed_title`
  - `items[{title, url, published_at, accepted, reason}]`
  - `total_count`, `will_add_count`, `in_window_count`, `older_skipped_count`, from `select_items_for_ingest(first_fetch=True)` and the 48 h window
  - `already_stored_count`, `duplicate_of`, `error_kind`, `error`
- **`/sources/test` keeps `_test_source_impl` (974) unchanged,** so the error kinds that tests pin stay the same.

**Duplicates:**
- Only `POST /sources` (501) returns 409 "You already follow this feed as \<label\>." It matches `Source.url ==` the final URL, for every type.
- `/auto` (671) keeps returning 200 `{found: true, source: <existing>}` for every type. Old clients rely on that for "Already added" (`FeedManager.tsx` 630-634), and `test_auto_adds_a_youtube_channel_once` expects it.

The Cookie / Authorization / Host denylist (180) still applies.

### Frontend

**`feeds/AddFeed.tsx`** replaces `AutoFeedBlock` (552-747) and `AddCustomTab` (757-1329):
- One 17px field (`inputMode="url" autoCapitalize="none" autoCorrect="off"`) and a Preview button.
- **`FeedPreview` card:**
  - a strategy line, 5 titles with dates, and the counts
  - the name from `cleanDisplayName`
  - `CategoryPicker`, defaulting to the current `cat:` tab. From a meta tab it defaults to the last category used for Add, otherwise the first category in tab order.
  - Add
- An "Options" disclosure: type, sitemap, link pattern, headers.
- Browser mode shows a note with Undo, which PATCHes `custom_headers: null`.
- The draft lives in a module store, so closing Settings keeps it.
- **After Add:** poll `api.source(id)` every 5 s for up to 120 s, then show 3 titles and "Open \<category\> tab".

**`openSettings(tab, opts?: {sourceId?, sub?, category?})`** replaces `(tab, sourceId?)` (App 525); update every call site. `Settings` and `FeedManager` gain an `initialSubTab` prop.

**"Find its feed"** (the `not_a_feed` action) previews the URL, then PATCHes `{type, url}` (PR7).

**`apiErrors.ts`:** `ALREADY_FOLLOW_RE` matches "channel" or "feed".

**Menu:** an "Add feed" row.

**`api.ts`:** `previewSource`.

### Tests
- **pytest:**
  - `test_sources_preview.py`: a loopback 403 for the default User-Agent, in both feed and website mode; semaphore; cache; 60 s budget; counts; the SSRF guard on private IPs.
  - `test_source_duplicate_409.py`: POST returns 409; `/auto` returns 200 with the existing feed.
  - `test_source_editor_contract.py::test_name_collision_is_409` gets two distinct URLs.
  - Rewrite `test_frontend_slice15_add_generic_scrape.py` and `test_source_create_sitemap_link_pattern.py` to pin `AddFeed.tsx`.
  - The `BROWSER_HEADERS` pin.
- **Flows:**
  - Rewrite FJ, FJ2, FP, FQ, FR, FS and **FG2** (866-886) for the new form.
  - `flow-add-preview`: at most 5 taps.
  - `flow-add-browser-fallback`.
  - `flow-add-duplicate`.
  - `flow-find-its-feed`.
  - `flow-add-from-meta-tab`.
- **Smoke:** remove the `settings-add-*` states (200-270); add `add-empty`, `add-preview` (390 / 320), `add-result` and `add-error`. `capture.cjs` mocks the preview.

**Risks:**
- A website preview can take up to 60 s; the semaphore bounds the load.
- Revert restores the old forms; both endpoints are additive.

---

## PR10: Menu of tasks, 4 Settings tabs, one vocabulary

**What you'll notice:**
- Menu: Add feed; Feeds (2 need attention); Saved; Edit tabs; Activity; Settings; How Popping works.
- Settings: Feeds / AI & Brief / Activity / General.
- The same words everywhere.

**Complaints:** "This app is clunky", "Nothing is intuitive to a new user".

### Changes

**`Drawer.tsx`** (327-495) becomes task rows built from `Grouped.tsx`:
- Saved selects `meta:saved`.
- Activity opens Settings → Activity.
- Jump to column appears on md and up only.

**`lib/settingsTabs.ts` (already exists; keep `isSettingsTab`):**
- `SETTINGS_TABS = ['feeds', 'llm', 'activity', 'general']`.
- `normalizeSettingsTab(t) → {tab, sub}` maps the old ids:
  - `notifications`, `reset` → `general`
  - `history` → `activity/read`
  - `hidden`, `voted` → `activity/not-interested`
  - `starred` → closes Settings and selects Saved
- App's `?tab=` sync uses it.

**`Settings.tsx`:**
- AI & Brief: the LLM section plus a schedule line.
- Activity: a segmented control, "Opened and saved" (`HistoryTabContent` 1118) / "Not interested" (Hidden and Downvoted merged through `EntryIdListContent` 1539).
- General: Notifications status (415-456) and Reset.
- Settings → Saved is deleted.

**Vocabulary sweep:** story, feed, tab, Saved, Unread / Read.
- `Column.tsx:833` becomes "no stories in this tab yet", and `test_frontend_slice19_empty_column_source_status.py:84` is updated in the same commit. The pin changes; the word is not allowlisted.

**No step changes the shared `sources` table** (D15).

### Tests
- **pytest:** `test_frontend_vocabulary.py` (no_db) scans JSX text, `toast(…)`, `aria-label` and `title` strings for `entries?`, `preset`, `Fresh`, `History` and user-facing `source`, with an explicit allowlist for code identifiers.
- **Unit:** `settingsTabs.test.ts`.
- **Flows:**
  - Update FG, FT, FU and `flow-menu-closed-inert`.
  - `flow-menu-rows`: each row reaches its target in 2 taps.
  - `flow-settings-old-ids`.
  - `flow-restore-hidden`: 3 taps.
- **Smoke:**
  - Remove `settingsState('notifications' | 'history' | 'hidden' | 'starred' | 'voted' | 'reset')` (365-371). `starred` now closes Settings, so its wait would fail.
  - Add `menu` and one state per new Settings tab, plus `settings-old-id-hidden`.

**Risks:** a broad copy change; the old URLs are mapped. Revert is safe.

---

## PR11: Deferred (needs a fresh owner yes, D17)

Each item ships as its own PR only after the owner says yes:
- **Ranking retune:** views count only after 1 s on screen (IntersectionObserver, no worker); `DELETE /api/interactions/latest` so Undo also removes the ranking signal.
- Category rename/merge endpoint.
- Per-feed volume cap UI (its own nullable migration).
- Retention/pruning: off by default, dry run first. `interactions.entry_id` is ON DELETE CASCADE.
- JSON Feed and guessed feed paths.
- Framing Watch on the phone.
- Drag-to-reorder.
- **O1's automatic fallback on scheduled fetches, if approved after PR7 ships.** It then needs its own additive migration for `fetch_mode`.

---

## Review notes

Corrections I rejected or changed:
- **#19, PR2 part:**
  - Not a merged-value PUT. I used a server-side delta `PATCH /api/preferences/{key}` instead.
  - A merged PUT sent from a suspended page can still erase another device's change made since the last resync.
  - The PATCH is one keepalive-safe request, and it also removes the extra GET per flush.
- **#6, Reddit tests:** Reddit-off is detected in `_ingest` before the fetch, not by raising in the plugin. `test_dynamic_reddit_warned_disabled_cap.py` therefore stays unchanged. The other named scrape tests are rewritten or kept, as listed in PR7 and PR8.
- **#28, ShortcutsSheet:** its card is already `role="dialog" aria-modal="true"` (ShortcutsSheet.tsx:82-84); only the backdrop is `role="presentation"`. The missing focus trap is real, and PR4 adds it.
- **#31, "Quiet":** I kept the 7-day window and changed the copy ("Quiet · nothing in 7 days"). With only single-column indexes on `entries`, an unwindowed per-source max can scan the `fetched_at` index for dead feeds. "All already in Popping" uses a cheap `EXISTS` on the indexed `source_id`.
- **#12, cap and `active_only` without a window:** `per_source_floor` and `per_source_cap` now require `max_age_hours` (422 otherwise). An unbounded per-source `row_number` would scan the whole table. `active_only` works on its own.

### Critical Files for Implementation
- /home/user/popping/frontend/src/App.tsx (PR #25 version)
- /home/user/popping/frontend/src/lib/preferences.tsx
- /home/user/popping/backend/app/scheduler.py
- /home/user/popping/backend/app/routes/entries.py
- /home/user/popping/backend/app/routes/sources.py
- /home/user/popping/frontend/scripts/iphone-audit/smoke.cjs
