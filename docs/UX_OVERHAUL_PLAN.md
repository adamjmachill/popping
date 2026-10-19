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


## The PRs (from the re-verified spec in the appendix)

| PR | What you'll notice on the phone | Migration |
|---|---|---|
| PR1 | Saving never jumps tabs; a new phone opens on For You; Newest / Best works; tap the current tab to scroll to the top; Reset keeps saves; Brief says when it needs AI | no |
| PR2 | Saves, hides and reads made on one device never undo another's | no |
| PR3 | Open or scroll past a story and it's used up; each tab ends in "You're all caught up", then "Earlier (N)"; badges count new stories; long tabs load as you scroll | no |
| PR4 | Tabs show the last 2 days; a new feed adds 10 stories, not its backlog; On this day gets its own tab; Saved shows every save; paused feeds leave the tabs | no |
| PR5 | Cards look like Reddit posts: ▲ ▼ Save Share ⋯; swipe left hides; hide every story from one feed | no |
| PR6 | Pull down to refresh: "Checking 6 feeds…", then "3 new"; a slimmer header | no |
| PR7 | Your tab order and hidden tabs; Saved and For You always there; every tab's ⋯ is one sheet | no |
| PR8 | Saved views become your own tabs, with their feeds listed under the header | no |
| PR9 | Every feed shows whether it's pulling, and each problem has one fix | 0031 |
| PR10 | Website feeds pull articles, not About, tag or shop pages | no |
| PR11 | One Add field with a real preview, and the first check's result | no |
| PR12 | A Menu of tasks and Settings in 4 tabs | no |
| PR13 | Deferred items, each needing a fresh yes (D19) | maybe |

**Calls the spec makes (each can be vetoed):**
- **C1:** After 10+ minutes away, tabs re-sort (new stories first) and scroll to the top. Under
  10 minutes nothing moves, so you return to the same spot after reading an article.
- **C2:** On desktop a story is used up only when opened or via Mark all, because several columns
  scroll at once there.
- **C3:** Tapping the current tab while already at the top refreshes it, like Reddit's Home tab.
- **C4:** The tab's ⋯ has a Refresh row, so there's a non-gesture way to refresh (VoiceOver,
  Switch Control).
- **C5:** Settings → Downvoted and "Hide all downvoted" are removed, since ▼ no longer means hide.
- **C6:** On desktop, `a` / `z` upvote and downvote (the Reddit Enhancement Suite keys).
- **C7:** The built-in feeds stay. Until you add a feed of your own, For You starts with an
  "Add your first feed" row.
- **C8:** Under a caught-up tab's marker, one row opens the next tab that has new stories
  ("News · 12"). When every tab is at 0 the row is absent, so the end of the last tab is the end
  of the app.

## How I'll work

- **Step 1: document first.**
  - Commit this plan as `docs/UX_OVERHAUL_PLAN.md` on branch `claude/ux-overhaul-plan` and open it
    as a draft PR.
  - Scan the text for personal details first (names, emails, hosts, IPs) and leave them out.
  - Done: the appendix is revised to D1–D19 and re-verified against main 4be8766.
- **Before PR1:** #25 is merged, so main 4be8766 is the base.
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

# Appendix: implementation spec (re-verified, Reddit-replacement revision)

> Written for D1–D19 and re-checked against main 4be8766 (which includes #25) by an architect, an
> adversarial reviewer and a final revision pass. The decisions above still win if anything here
> conflicts with them.

**Base:** `origin/main` 4be8766, which includes #25 (display names, migration 0030). Its `frontend/` and `backend/` trees are byte-identical to #25's branch (355c596). All line numbers below are `main` line numbers, and every anchor was re-checked against 4be8766.

**Product principle:** Popping replaces Reddit. You bring your own sources, the UI works like Reddit, and there is a real end. The spec uses familiar conventions instead of explanations. When you have seen everything new, the app tells you so and there is nothing more to scroll.

## Summary

| PR | What you'll notice on the phone | Size | Migration | Depends on |
|---|---|---|---|---|
| PR0 | Feeds keep the name you type (#25, merged) | M | 0030 (merged) | none |
| PR1 | Saving never moves you to another tab. A new phone opens on For You. Newest / Best works. Tapping the current tab scrolls to the top. Reset keeps saves. Brief says when it needs AI | M | no | PR0 |
| PR2 | Saves, hides and reads made on one device never undo another's | M | no | PR1 |
| PR3 | Opening a story or scrolling past it uses it up. Each tab shows new stories, then "You're all caught up", then "Earlier (N)". Badges count new stories. Long tabs load as you scroll | L | no | PR1, PR2 |
| PR4 | Tabs show the last 2 days. A new feed adds 10 stories, not its backlog. On this day gets its own tab. Saved shows every save. Paused feeds leave the tabs | L | no | PR2, PR3 |
| PR5 | Cards look like Reddit posts: feed, time, title, then ▲ ▼ Save Share ⋯. Swipe left hides. You can hide every story from one feed | M | no | PR2, PR3 |
| PR6 | Pull down to refresh: "Checking 6 feeds…", then "3 new" at the top. A slimmer header | M | no | PR1, PR3 |
| PR7 | Your tab order and hidden tabs. Saved and For You are always there. Every tab's ⋯ is one sheet | M | no | PR1, PR3, PR4, PR5, PR6 |
| PR8 | Saved views become your own tabs, with their feeds listed under the header | L | no | PR4, PR5, PR6, PR7 |
| PR9 | Every feed shows whether it is pulling, and each problem has one fix | L | 0031 | PR0, PR4, PR6, PR7, PR8 |
| PR10 | Website feeds pull articles, not About, tag or shop pages | L | no | PR9 |
| PR11 | One add field with a real preview, and the first check's result | L | no | PR7, PR9, PR10 |
| PR12 | A Menu of tasks and Settings in 4 tabs | M | no | PR5, PR8, PR9, PR11 |
| PR13 | Deferred items, each needing a fresh yes (D19) | varies | maybe | as needed |

**Order changes from the previous spec, and why:**
1. **Delta sync ships alone, before seen-on-scroll (PR2).** While you scroll, seen marks arrive about once a second. Today's whole-list PUTs, and App's whole-list setters built from refs mirrored in effects, would drop them or undo them.
2. **The read model is one PR (PR3).** Seen-on-scroll, open-marks-seen, the marker, Earlier, badges and auto-append all share one partition. ✓, swipe-right, `m`, the context-menu "Mark as read", the header tap and the chip all go in the same PR, so there is never a second way to mark something read.
3. **The window (PR4) follows PR3,** so badges and Earlier count inside the window from the start.
4. **The card (PR5) follows PR3.** By then ✓ is gone, so PR5 is only the Reddit layout, Hide, mute, Share and toast merging.
5. **Pull-to-refresh pairs with Check now (PR6),** because it needs PR3's snapshot reset.
6. **PR7 turns the tab ⋯ into a bottom sheet.** It matches the card's ⋯ (PR5) and sits within thumb reach.

**Calls this spec makes (the owner can veto each):**
- **C1, returning to the app.** After 10 minutes or more away, each tab re-sorts (new stories first) and scrolls to the top. Time away is measured with `Date.now`, because timers stop while iOS suspends the page. Under 10 minutes nothing moves, so you can read an article and come back to the same place.
- **C2, desktop is open-only.** On desktop a story is used up when you open it or use Mark all. Several columns scroll together there, so scrolling past one doesn't mean you read it.
- **C3, tab tap refreshes.** Tapping the current tab while already at the top refreshes it, as Reddit's Home tab does.
- **C4, a Refresh row in the tab ⋯.** It is the path for VoiceOver and Switch Control once the phone header loses Refresh.
- **C5, the Downvoted list is removed.** Settings → Downvoted and "Hide all downvoted" go, because ▼ no longer means hide.
- **C6, desktop vote keys.** Desktop gets `a` / `z` for ▲ / ▼ (the Reddit Enhancement Suite keys).
- **C7, built-in feeds.** The built-ins (BBC News, HN, NVD, CISA KEV, GitHub releases, RFD, On this day) stay in the tabs. Until you add a feed of your own, For You starts with a 44px "Add your first feed" row. The alternative is for a new install to start with the built-ins in `muted_sources`.
- **C8, the next tab.** Under a caught-up tab's marker, one 44px row names the next tab that has new stories ("News · 12") and opens it. When every tab is at 0 the row is absent, so the end of the last tab is the end of the app.

## Target tap counts

| Task | Today | After (PR) |
|---|---|---|
| Use up a story | 2 (open, ✓) | 1 (open) or 0 (scroll past) (PR3) |
| Know you've seen everything new | not possible | 0: "You're all caught up" (PR3) |
| Go to the next tab with new stories | scroll the tab strip, check badges | 1 (C8) (PR3) |
| Clear a tab | 1 unlabelled header tap | 0 (scroll to the end) or 2 (⋯, Mark all as read) (PR3) |
| Upvote / downvote | 1 | 1 (PR5) |
| Hide a story | 1 (eye button; ▼ does something else) | 1 swipe, or 2 (⋯, Hide) (PR5) |
| Save | 1 | 1 (PR5) |
| Share a story | 3+ (system long-press menu) | 1 (Share) (PR5) |
| Hide every story from one feed | not possible | 2 (⋯, Hide stories from X) (PR5) |
| Check a tab's feeds now | not possible | 1 pull (PR6) |
| See a tab's older stories | 3 (24 h at most) | 3 (⋯, 7 days, close) (PR4) |
| Move a tab one place earlier | not possible | 3 (Edit, ↑, Done) (PR7) |
| Hide a tab | not possible | 3 (Edit, switch, Done) (PR7) |
| Make a tab of 3 feeds | 7 + typing + scrolling | 6 + typing (PR8) |
| Add a feed to a custom tab | 5 | 3 (Edit on the "From" line, tick, Done) (PR8) |
| See which feeds a custom tab holds | not shown | 0 (PR8) |
| Is a feed pulling? | ~5 + a filter | 2 (≡, Settings: a pill on every row) (PR9) |
| Fix a feed a site now blocks | ~6 | 3 (≡, Settings, Read as Safari) (PR9) |
| Find one feed | scroll an unsorted list | 3 (≡, Settings, type) (PR9) |
| Point a web-page feed at its real feed | delete and re-add | 3 (PR11) |
| Add a feed and know it pulls | 6, plus ~4 to verify | 5, with the result shown (PR11) |
| Restore a hidden story | 4 | 1 (Undo) or 3 (≡, Activity, Restore) (PR12) |

## Rules for every PR

**Frozen infrastructure**
- No new ports, containers, daemons, background processes, workers or service workers. Never edit Docker/compose, nginx, `package.json`/lockfile, `config.py`, `main.py` or `url_safety.py`.
- IntersectionObserver and touch listeners run on the main thread, with no library.

**Routes and tunables**
- New routes go on existing routers. Sources routes use `_write_deps`. Preferences routes use `current_user` + `resolve_user_id`.
- OIDC gating is per router (`main.py:290-304`).
- Tunables are read with `runtime_settings.get_many`, then parsed and clamped as in `brief._resolve_window_hours` (`brief.py:321-339`). A missing key falls through to the default and is not cached (`runtime_settings.py:214-241`). A changed row can take up to 1 h to apply (`:52`).

**Libraries**
- Pure libraries in `frontend/src/lib/*.ts` stay import-free for `node --experimental-strip-types --test` (build.yml:127). The new ones are `sorting`, `columns`, `prefSync`, `seen`, `feedOrder`, `pull` and `window`. Two existing ones are extended: `categories` and `settingsTabs`.
- Unit tests live in `frontend/scripts/unit/`.
- React glue lives in `lib/use*.ts`.

**Timers, not clocks**
- Smoke freezes `Date.now` with `context.clock.setFixedTime` but keeps timers running (`smoke.cjs:934`). Dwell and pull timing therefore use `setTimeout` and event deltas. The one exception is C1's time away, which is tested with `page.clock.setFixedTime(F.NOW + 11 min)` while the page is hidden.

**Flows**
- PR1 adds `tap(page, locator)` and `taps(page, max, id)` to `flows.cjs`. Neither exists today.
- Stub `window.open`, `navigator.share` and the clipboard.
- Gestures use CDP `Input.dispatchTouchEvent` on Chromium. They return early when `page.context().browser().browserType().name() !== 'chromium'`, because the WebKit run is report-only (`build.yml:146-148`).
- Desktop flows use `widths: [1280]` and `wait: 'main.grid article[data-card-id]'`. Without that, `runState` waits for a phone card inside the hidden `main.md:hidden` (`smoke.cjs:87, 987`). PR3 adds `1280: {width: 1280, height: 800, deviceScaleFactor: 1}` to `WIDTHS`, but not to `DEFAULT_WIDTHS`.
- Each PR names the flows and states it rewrites.

**Smoke**
- New sheets join `C12_ROOTS` (`smoke.cjs:68`).
- Rows added inside a Column are never `<section>`, because `dashboard` asserts exactly one `main section` (`smoke.cjs:153`).
- Nothing keeps `[role="status"]` mounted while idle. Smoke waits up to 8 s for none before every state (`smoke.cjs:990`), and C7 measures buttons inside it (`:667`).
- From PR2, `capture.cjs` keeps an in-memory preference store. Today's mock echoes `body.value` for every method (`capture.cjs:182-186`), so a PATCH would get `null` back.

**Sheets**
- `role="dialog"`, `aria-modal`, and the focus trap and inert pattern from `Drawer.tsx:122-242`.
- Safe-area bottom padding and 44px rows.
- Inputs are 17px `type="text"` with an `inputMode`. URL fields also get `autoCapitalize="none" autoCorrect="off"`.

**Copy**
- Use stories, feeds, tabs and Saved.
- No sentence that explains a convention.
- An error is one short sentence and one fix.

**Docs and screenshots**
- Update `UX_OVERHAUL.md`, `ARCHITECTURE.md` (new process-local state) and `scripts/iphone-audit/README.md` (new flows and states).
- Take screenshots with `smoke.cjs --only <state>`. The owner checks the iPhone home-screen app after each deploy.

---

## PR0: Merge #25 (merged)

**Already on `main`:**
- `labels.ts` `sourceLabel` / `rememberDisplayNames`, and `useSourceLabels.ts`.
- `feedRules.ts` `uniqueSlug` / `cleanDisplayName`.
- The FeedEditor Name field.
- The flow `flow-fl-rename-keeps-filter-and-view`.
- Migration `0030_source_display_name.py`.

**Rollback:** `alembic downgrade 0029`. The names people typed are lost.

---

## PR1: Tabs and sorting behave

**What you'll notice:**
- Saving never moves you to another tab, and a new phone opens on For You.
- Newest | Best really reorders a tab.
- Tapping the current tab scrolls it to the top.
- Reset keeps saved and hidden stories and saved views.
- Brief shows "Brief needs an AI provider · Set up" when no provider is set.

**Complaints:** "multi tapping", "Nothing is quick".

### Changes

**`lib/columns.ts` (new):**
- Keys: `meta:brief`, `meta:saved`, `meta:foryou`, `meta:search`, `meta:filter` (removed in PR8) and `cat:<name>`, plus `colKey` / `parseColKey`.
- `resolveTab(tabs, wanted, lastIndex)`:
  - If the wanted key exists, use it.
  - If it is missing, show the neighbour at `lastIndex` but keep the stored key.
  - If nothing is stored, pick the first tab that is not Brief and not empty, preferring For You.

**`lib/sorting.ts` (new):**
- `entryTime = published_at ?? fetched_at`.
- `byNewest`: dated before undated, then by id.
- `byBest`: `composite_score` descending, then `byNewest`.
- `normalizeSort`: `top`, `oldest` and unknown values become `newest`. Today `top` has no visible effect, because both sections re-sort newest-first (App.tsx:1196-1197).

**`storage.ts`:** add `mobileTab`. `mobileColLast` is read once, to migrate.

**`App.tsx`:**
- Columns gain `key` (977-992, 1028-1042).
- `mobileTab` replaces `mobileCol` (557), `loadMobileCol` (147-157), `followTabRef` (561, 1546-1552, 2233-2235) and the clamp effect (1553-1564).
  - Only `selectTab(key)` (a `useCallback`) and `jumpToCategory` write it.
  - Nothing resolves until `prefs.loading` is false **and** the first refresh has produced columns (`columns.length > 0`). Otherwise a stored index would migrate against an empty list and overwrite the saved tab.
  - A stored index migrates to `columns[i].key`, and −1 becomes `meta:brief`.
- The phone Column becomes `<Column key={tabKey} scrollerRef={phoneScrollerRef}>` (3088).
  - Pass a ref object, not an arrow. slice19's `<Column\b[^>]*>` regex (`test_frontend_slice19_empty_column_source_status.py:136`) stops at the first `>`, so an arrow before `sourcesByName=` fails it.
  - Column marks its list (Column.tsx:493) `data-scroller`. That list is the phone's real scroller. The App wrapper at 3077 only scrolls the Brief tab, because the Column `<section>` is `h-full`.
  - Tapping the active tab scrolls the list to the top (instantly under reduced motion).
- The `columns` memo (1049-1073) sorts once with `normalizeSort`.
  - For You defaults to Best. Saved is never sorted.
  - `minScore` is ignored. The age filter is unchanged until PR4.
- In `sectionsByColumn` (1162-1201), delete `fresh.sort` / `past.sort` (1196-1197).
- Keyboard `b` (2040-2067) records `bookmark` only when it saves.
- **`resetLocalState` (1328-1393, keys 1356-1361):**
  - Stop deleting `starred_entries`, `hidden_entries` and `filter_presets`.
  - Delete the `read_entries`, `last_viewed`, `column_prefs` and `column_sections` rows, plus `history_group_by`.
  - Update the copy at `Settings.tsx:486-498`.
- The App `<header>` (2568) gets `data-app-header`.

**`preferences.tsx`:** `ColumnPrefsValue.sort` (97) gains `'best'`.

**`Column.tsx`:**
- Sort becomes a 44px Newest | Best segmented control.
- The Minimum score slider (434-461) goes.

**`Card.tsx`:** ☆ (1416-1439) and the menu's Save (778-788) record `bookmark` only when the story was not already saved.

**`BriefCard.tsx`:**
- Gains an `onOpenSettings` prop (Props 19-40, signature 327), wired at both sites (App.tsx:2759, 3079).
- Calls `api.llmStatus()` once.
- With no provider, all four generate buttons (537, 587, 649, 725) and the header Brief button (App.tsx:2690-2697) become a 44px "Brief needs an AI provider · Set up" that calls `onOpenSettings('llm')`.
- `Settings.tsx:405-412` already sits on the AI tab and disables itself, so it is unchanged.

### Backend
- **`interactions.py:272-273`:** delete `type_list.append("dwell")`, which empties History today. With no `types`, the default excludes `dwell` and `view`. PR3 makes views frequent.
- **`sources.py:1152-1154`:** the Reddit Test uses `reddit_client.fetch_subreddit(…, limit=25)`.
  - Reddit disabled → `unsupported_type`.
  - Throttled → `network_error`.
  - Empty listing → `not_found`.

### Tests
- **Unit:** `sorting.test.ts` and `columns.test.ts`. The columns test covers the neighbour fallback, index migration, no migration before the first refresh, and a fresh device skipping an empty Saved and Brief.
- **pytest:** `test_interactions_history_types.py` (db) and `test_source_test_reddit.py` (no_db). slice19 keeps its literal and its `<Column` regex.
- **Flows:**
  - Stub `window.open` in all of them.
  - `flow-tab-stays-on-star` (News, because the fixtures have no tech tab).
  - `flow-sort-best`, `flow-tap-tab-scrolls-top`, `flow-brief-needs-ai` (all four buttons and the header Brief), and `flow-reset-keeps-saves` (no DELETE of starred, hidden or presets).
  - FM stays green.
- **Smoke:**
  - `dashboard` reads `header[data-app-header] button` (smoke.cjs:145-149). Today the check passes only because For You hides its ⋯ (Column.tsx:385), and PR3 shows that ⋯.
  - `column-popover`, plus a new `brief-needs-ai` state.

### Risks and rollback
- An old bundle reads `best` as oldest-first until the PWA reloads.
- Revert is safe. The old build opens tab 0.

---

## PR2: Preferences sync by change, not by overwrite

**What you'll notice:**
- Something saved on the laptop shows as saved on the phone within a minute.
- Two devices never undo each other's reads, saves or hides.
- Leaving the app right after acting loses nothing.

**Why first:** PR3 writes a seen mark about once a second. Today each write PUTs the whole list (`preferences.tsx:524-550`). App builds those lists from refs that are mirrored in effects (App.tsx:765-781), so two calls in one tick pass stale lists. A second device, or a suspended page, overwrites the result.

### Backend (routes/preferences.py)

**`PATCH /api/preferences/{key}`:**
- **Allowed keys:** set keys only: `starred_entries`, `hidden_entries`, `read_entries:*` and `voted_entries`. `muted_sources` joins in PR5. Other keys return 400.
- **Body:** `{add?: int[], remove?: int[]}`, or `{set?: {"<id>": "up" | "down" | null}}` for votes.
- **One transaction:**
  1. `INSERT … ON CONFLICT DO NOTHING`
  2. `SELECT … FOR UPDATE`
  3. apply the change
  4. trim the oldest down to the cap
  5. write `value` with `updated_at = func.now()`
  6. return `UserPreferenceOut`
- **Caps:** `read_entries:*` 1000, hidden 1000, starred 1000, voted 2000. They are pinned against `preferences.tsx`: `MAX_READ_PER_KEY` is new, and `MAX_HIDDEN`, `MAX_STARRED` and `MAX_VOTED` are at 792-797. The server trim is a backstop, because clients prune first (PR3).

**`GET /api/preferences?since=<iso>`** (additive, 155) returns only rows with `updated_at > since`. Without `since` it returns every row, as today.

### Frontend

**`lib/prefSync.ts` (pure):**
- `isSetKey`, `diffIds`, `foldDelta`, `applyIdDelta` and `applyVoteDelta`.
- `mergeIncoming(prev, server, pending)` reuses references for unchanged keys, so a resync doesn't re-render every Column (`Column.tsx:890-915`).
- `pruneIds(ids, keep, cap)` drops ids absent from `keep` first, then the oldest.

**`preferences.tsx`:**
- **New calls:** `addIds(key, ids)`, `removeIds(key, ids)` and `setVotes({[id]: 'up' | 'down' | null})`. Each uses a functional `setState` and queues its delta directly, so two calls in one tick both land.
- **The whole-list setters for set keys go.** These handlers move to the new calls: `hideEntry`, `restoreHiddenEntry`, `toggleHideEntry`, `toggleStarEntry`, `markEntryRead`, `unmarkEntryRead`, `markColumnRead`, `setEntryVote`, `onHideAllDownvoted`, and every Undo.
- **Caps leave App:** the App-side slices go (App.tsx:185, 1728, 1769, 1809, 1847, 2161, 3238), and so does `setReadEntries`'s 200 slice (598-602).
- **Flush:** set keys go out as PATCH in a 1 s batch, and other keys as PUT in a 250 ms batch. Today `scheduleSync` (542-550) is a single fixed batch, not a debounce. Responses are adopted through `mergeIncoming`.
- **Leaving:** `visibilitychange: hidden` joins `pagehide` / `beforeunload` (555-586) and sends the same requests with `keepalive`. In the home-screen app, opening a story fires only `visibilitychange`.
- **`resync()`:**
  - Each visible poll sends `GET ?since=` with the newest `updated_at` held. Resume sends a full GET, which is also how deletions arrive. Only one runs at a time.
  - Queued deltas and in-flight ones (sent but not yet acknowledged) are re-applied on top.
  - A GET sent before a key's latest PATCH was acknowledged is ignored for that key. This uses request sequence numbers, not clocks, and mirrors `sourceChangesRef` for feeds (App.tsx:1263-1276).
- Old bundles keep using PUT, which is still accepted.

**`api.ts`:** add `patchPreference`, and `preferences(since?)`.

**`App.tsx`:** `refresh()` and the visibility handler call `prefs.resync()`.

**`capture.cjs`:** a preference store that handles GET (with `since`), PUT, PATCH (applying deltas) and DELETE.

### Tests
- **Unit:** `prefSync.test.ts` covers:
  - two adds in one tick
  - add then remove
  - two devices
  - an in-flight delta surviving a stale GET
  - reference identity
  - caps, votes and prune order
- **pytest:** `test_preferences_delta.py` (db) covers:
  - two concurrent PATCHes both landing
  - the cap holding
  - non-set keys returning 400
  - anonymous users
  - suffixed `read_entries` keys
  - `since`
- **Flows:**
  - `flow-prefs-resync`: a GET answered with the old set while a PATCH is in flight leaves the story hidden.
  - `flow-visibility-flush`: a save, then hidden, then a keepalive PATCH within the 1 s batch.
  - FL's `filter_presets` PUT (`flows.cjs:742`) stays a PUT.

### Risks
- A cached old bundle can still overwrite with a PUT until it reloads.
- Revert is safe, because the route and parameter are additive.

---

## PR3: Seen means used up; a real end

**What you'll notice:**
- Opening a story or scrolling past it on the phone uses it up. Nothing moves or dims while you read.
- Each tab shows new stories, then "You're all caught up", then "Earlier (N)" folded. A row under the marker opens the next tab that has new stories (C8).
- Badges count new stories (99+). The "+N new" chip and ✓ are gone.
- Long tabs load 30 at a time as you scroll.
- ⋯ → Mark all as read.
- On desktop the page scrolls as one, and opening a story uses it up (C2).

**Complaints:** "the fresh vs not … confusing", "upvote, downvote, star, read … all confusing", "multi tapping".

### Read model
- **Seen** is the union of all `read_entries:*` rows (`globalReadIds`, App.tsx:1085-1091).
- **Where marks go:** each mark is stored under the story's category (`read_entries:<category>`), wherever it happened. Old per-column rows still count.
- **Writes:** `markSeen(ids)` collects ids for about 300 ms, then makes one `addIds` call per key. That is one render per batch, not one per card. A key over 1000 is pruned with `pruneIds`, which keeps every fetched id (entries, For You, Saved and wider-tab rows).
- **Events:**
  - Scroll-seen records `view` (`recordBatched`) at that moment.
  - Delete the on-mount view (Card.tsx:499-506) and `mountTime` (387-390).
  - Opening records `click`, as today.
  - No `dwell` is sent.

### Snapshot: `lib/feedOrder.ts` (pure)
`partitionTab({entries, seen, sort, snapshot, hold}) → {unseen, earlier, snapshot}`:
- **New snapshot:** unseen holds what isn't seen, in the tab's sort. Earlier holds what is seen, in the same sort.
- **Ids in the snapshot keep their group and place,** even once they are seen.
- **New arrivals** append to the end of unseen. They are held back while the marker is above the viewport, because Safari has no scroll anchoring.
- **A story that a poll drops** stays, drawn from the cached Entry, until the next snapshot.
- **Leave at once:** hidden stories, muted feeds (PR5) and deleted feeds.
- **Unchanged ids return the previous arrays.**
- **Resets:** switching tabs (both tabs), Refresh / `r`, Mark all as read, a Sort or window change on that tab, a feed edit on a custom tab (PR8), and returning after 10 min or more hidden (C1, which also scrolls to the top). Polls never reset it.

### Seen tracking (phone only)
**`lib/seen.ts` (pure, timers injected):**
- **Qualifying:** a card qualifies after it has been at least half visible for 1 s straight (`intersectionRect.height ≥ 0.5 × min(card, root)`), so tall cards count.
- **Seen:** a qualified card is seen when it leaves through the top (`!isIntersecting && boundingClientRect.bottom ≤ rootBounds.top`).
  - The exit counts only when `target.isConnected`, `boundingClientRect.height > 0` and `rootBounds.height > 0`. A detached or `display:none` target reports all-zero rects, which would otherwise pass.
  - Leaving through the bottom does not count.
- **End rule:** once the marker has been half visible for 1 s, every qualified card on screen is seen. So is any card that qualifies while the marker stays visible.
- **Pauses:** a dwell timer that fires while `document.hidden` is true, or while an `[aria-modal="true"]` sheet is open, restarts instead of qualifying the card.

**`lib/useSeenObserver.ts`:**
- **Runs only while `!isDesktop`.** The phone `<main>` stays mounted, hidden by CSS, at md and up (App.tsx:3000). Turning a large iPhone to landscape would otherwise zero every rect.
- **One IntersectionObserver per root,** with thresholds 0, 0.1 … 1. The root is the Column list (`data-scroller`).
- **Root changes:** the observer disconnects and clears its timers.
- **Registration:** Column registers unseen cards from `setCardRef` (226-232), so Card's memo is untouched. Early registrations are queued.

**Open only (no scroll tracking):** Saved, Brief, search results, and all of desktop (C2).

**Opening:** these call `onOpenEntry`:
- the headline (Card.tsx:931-938)
- the Thumbnail (1738-1757, now given `onActivate`)
- the Reddit-thread link (1019-1034)
- Listen (1094-1103)

### Column.tsx
- **Header:** the label, ⋯, and "N new" on md+. Delete `role`, `tabIndex`, the handlers and `title` (279-325), the chip (338-371) and "X of Y" (372-377).
- **List:**
  - The first 30 unseen cards, then a `[data-more]` sentinel that adds 30 more. The sentinel is observed with the scroller as root and a 600px bottom `rootMargin`, because a margin on the viewport root doesn't reach past the list's clipped edge.
  - Once all unseen cards have rendered, a `[data-caught-up]` row follows.
    - It shows ✓ "You're all caught up" only when the tab's unseen count is 0. A card flung past never qualifies, so it can still be unseen.
    - C8's next-tab row comes next, then a folded 44px `button[data-earlier][aria-expanded]` "Earlier (N)".
    - None of these rows carry `role="status"`.
  - Earlier renders dimmed cards, 30 at a time.
  - Saved has no marker. An empty tab keeps `EmptyColumnMessage`.
- **Keyboard:**
  - The render limit includes `selectedId`'s position at render time.
  - ↑/↓ walks unseen, then Earlier, opening it when reached.
  - The card exists before App scrolls to it (2118-2122).
- **⋯:** now shows on For You too (385). Its first row is "Mark all as read" (44px, disabled at 0).

### Card.tsx
- Remove:
  - ✓ (1381-1411)
  - swipe-right (reveal 864-873, `commitMarkRead` 546-555, clamp 654)
  - the unread ring (838-842)
  - the context-menu "Mark as read" (727-735)
  - the `onMarkRead` prop
- `unread` becomes `dimmed`.

### App.tsx
- **Delete:**
  - `newCountByColumn` (1108-1125) and `unreadIdsByColumn` (1137-1147)
  - `seenEntryIdsRef` / `hiddenAtRef` and their uses (828-830, 1244-1260, 1445, 1678-1682, 2163-2167)
  - `HIDDEN_RESET_MS` (78) and `MAX_SEEN_ENTRY_IDS` / `capSetFIFO` (187-203)
  - `toggleEntryRead` (1737-1757), the `m` key (2022-2032), and the `onMarkRead` wiring for search results (2790) and the desktop For You row (2896)
  - `lastViewed` writes (2144). Reset still deletes old rows.
  - section collapse (2411-2449)
- **Badge** (3062-3070): the unseen count, `99+`, `aria-label="<tab>, N new"`. None on Saved or Brief.
- **`markColumnRead`** (2131-2187) becomes Mark all. It resets the snapshot and shows "Marked N as read · Undo".
- **Manual Refresh toast:** "N new" or "Nothing new", worked out from the ids held before the request (replaces 1284-1287).
- **Desktop scroller:**
  - Wrap BriefCard, the For You row, FramingWatch and the grid (2757-2990) in one `flex-1 min-h-0 overflow-y-auto` div marked `data-scroller`. The grid drops its own `flex-1 overflow-y-auto` (2937).
  - Today the grid is a flex-1 scroll container whose automatic minimum height is 0. A For You row taller than the window squeezes the grid down to its 32px padding, and the document scrolls instead (2558, 2848).
- **ShortcutsSheet:** drop the `m` row.

### Tests
- **Unit:**
  - `seen.test.ts`: zero rects, a detached target, a hidden page, an open sheet, a root change, and the end rule.
  - `feedOrder.test.ts`: sort and window resets.
- **pytest `test_slice21_column_memo.py`:**
  - Props drop `newCount`, `totalCount` and `sectionsCollapsed`, and add `unseenCount`.
  - HANDLERS drop `setColumnSection` and `sectionsCollapsedFor`.
  - Delete `test_sections_collapsed_uses_memo_cache`.
- **Flows:**
  - `flow-scroll-marks-seen`: 1.2 s pauses. The PATCH adds exactly the ids that left the top, the badge drops, and the card order is unchanged. A 300 ms fling marks nothing.
  - `flow-open-marks-seen`.
  - `flow-caught-up` (a 3-story tab):
    - A flung card keeps the ✓ text away.
    - Once all 3 are seen, the marker shows on return, and Earlier (3) is first and folded.
  - `flow-next-tab` (C8).
  - `flow-mark-all-read`.
  - `flow-auto-append`: a route returns 70 stories, and the list grows to 30, then 60, then 70 plus the marker.
  - `flow-view-on-seen` and `flow-new-arrival-appends`.
  - `flow-return-after-10-min` (C1).
  - `flow-landscape-no-marks`: the viewport crosses 768px and no PATCH is sent.
  - `flow-desktop-layout` (1280): with 25 For You cards the grid is taller than 300px. Mark all works.
  - `flow-sort-best` stays green, because Sort resets the snapshot.
  - FN's regex (818) becomes `/^(\d+ new|Nothing new)$/`. FM stays green.
- **Smoke:** `caught-up` and `earlier-open` (390/320).

### Risks
- How seen-on-scroll feels needs the owner's hand on the device (`SEEN_DWELL_MS`).
- Revert restores ✓, and the marks stay valid.

---

## PR4: Smaller tabs (window, first-fetch cap, On this day)

**What you'll notice:**
- A tab shows stories that arrived in the last 2 days. ⋯ → Show stories from offers 1 day, 2 days, 7 days or All.
- A new feed adds its newest 10 stories once, even if it first works days after you added it.
- On this day has its own tab, with 5 stories a day.
- Saved holds every save. Paused feeds leave the tabs.

**Complaints:** "Most tabs have over a hundred things when I add a feed and I have no idea why".

### Backend

**`app/ingest_rules.py` (new, pure):** `select_items_for_ingest(items, *, first_fetch, baseline_at, now, keep_first=10, backfill_h=48, max_age_d=30, per_poll=50) → (kept, counts)`.
- First fetch: the newest 10 (undated after dated), plus the last 2 days.
- Later polls drop items dated before `baseline_at − 2 d` or before `now − 30 d`.
- Every poll keeps at most 50, newest first.
- Tunables: `ingest.first_fetch_keep`, `ingest.backfill_hours`, `ingest.max_age_days`, `ingest.max_per_poll`.

**`scheduler._ingest`:**
- The rule runs after the normalize loop (403-407) and before the known-URL query (411-416).
- Counts go to `summary["skipped"]`. Add `IngestResult.skipped: int = 0`.
- A success while `last_fetch_at` is NULL sets `created_at = now`, so a feed that was blocked for days doesn't flood the tab.
- In `update_source`, under `if url_changed:` (2380), set `last_fetch_at = None`.

**`GET /api/entries`:**
- `max_age_hours` (1..8760) filters `fetched_at ≥ now − h`, using slice25's index.
- `per_source_cap` (1..200) needs `max_age_hours`, or the request gets 422.
  - It is a `row_number()` per source ordered by `fetched_at desc`.
  - It is computed and filtered in an inner subquery before the per-category `row_number`, so a category still gets its full 100.
- With `max_age_hours`, the per-category `row_number` orders by `fetched_at desc` instead of `composite_score` (entries.py:404-409), so a new low-score story isn't cut.
- `active_only`.
- **Placement:** on the per-category path these go inside `ranked` (412-416), because 418 builds a fresh `select` that drops earlier `.where`s. On the flat path they go on `stmt`.
- Without `q`, the caller's `hidden_entries` are excluded.

**Other backend:**
- `GET /api/foryou` gets the same window and hidden-story exclusion.
- `brief.py:386` and `:451` add `published_at IS NULL OR published_at ≥ since`, so a new feed's backfill doesn't reach today's brief.
- **On this day (D17):**
  - `selected` items only, at most 5 a day, in category `on_this_day`.
  - `_upsert_source` returns existing rows unchanged (`scheduler.py:110-135`). So `start_scheduler` moves the existing row once, only if it is still in `news`, behind `builtin_category_moved:wikipedia_on_this_day`.
- **VPS:** run a read-only `EXPLAIN (ANALYZE, BUFFERS)` on both paths. The target is under 150 ms.

### Frontend
- **`lib/window.ts`:** `'1d' | '2d' | '7d' | 'all'`, default `'2d'`, plus `inWindow(fetched_at)`. A legacy `maxAgeHours` maps to `'1d'`.
- **`ColumnPrefs.window`:** the ⋯ row "Show stories from" (a 4-way segmented control) replaces "Hide if older than" (Column.tsx:462-482).
- **`refresh()`** (1222-1231) calls `entries({perCategoryLimit: 100, maxAgeHours: 48, perSourceCap: 25, activeOnly: true})` and `forYou({limit: 50, maxAgeHours: 48})`.
- **The desktop For You row** shows its top 6. Its stories also appear in their category columns.
- **Wider tabs** fetch their own rows into `extraByTab`. Only the visible tab refetches.
- **Counts:** the badge, unseen and Earlier all count within the tab's effective window. Wider tabs that aren't selected count from the 2-day data.
- **Saved:**
  - Uses `api.entriesByIds` (api.ts:549; 200 per call, chunked), and only for ids not already held. Newest save first.
  - It replaces `visibleStarred` (946-958) in the same PR.
- **Undo of a hide** re-inserts the cached Entry.
- **Labels:**
  - `categoryLabel('on_this_day')` gives "On This Day" (labels.ts:97-101). Add an override so it reads "On this day".
  - On cards, `HISTORICAL_SOURCES` show "On this day" in place of a time. This is pinned against `brief._HISTORICAL_SOURCE_SLUGS` (brief.py:91).
- **`capture.cjs`:** `/api/entries` honours `max_age_hours` and `active_only`.

### Tests
- **pytest (new):**
  - `test_ingest_rules.py`, `test_ingest_backfill_cap.py`
  - `test_first_success_resets_baseline.py`, `test_source_url_change_resets_first_fetch.py`
  - `test_entries_window.py`: both paths, the cap, the 422, a low-score new story kept, `active_only`, hidden stories, and no parameters
  - `test_foryou_window.py`, `test_brief_published_guard.py`
  - `test_wikipedia_selected.py`, `test_builtin_category_move.py`
- **pytest (rewrite):**
  - `test_ingest_skips_known_urls.py`: its fixed `_NOW` falls behind the watermark, so use relative dates and assert `skipped`.
  - `test_entries_per_category.py` stays green, because it passes no window.
- **Unit:** `window.test.ts`.
- **Fixtures:** stories that arrived 3 and 10 days ago, and a paused feed.
- **Flows:** `flow-window-default`, `flow-tab-window-7d` (resets the snapshot), `flow-saved-by-id`, `flow-paused-hidden`, `flow-badge-in-window`.
- **Smoke:** `column-popover` shows the window control at 390/320.

### Risks
- A story that arrived more than 2 days ago and was never seen drops out of the default view. That is by design, because it is the end.
- 25 per feed per tab trims a very busy feed.
- The backend parameters do nothing without the new frontend.

---

## PR5: The card is a Reddit post

**What you'll notice:**
- The card shows the feed icon, feed name and time on top, then the title and thumbnail.
- One bar: ▲ ▼ (orange / blue when on; tap again to undo), Save (a bookmark, filled when saved), Share, the summary chevron, and ⋯.
- ⋯ offers Hide, Hide stories from \<feed\>, Edit feed, Copy link and Open in browser.
- Swipe left hides, with Undo. Two quick hides show "2 hidden · Undo".

**Complaints:** "upvote, downvote, star, read … I hardly know what to do", "Nothing is intuitive to a new user".

### Changes

**`ActionSheet.tsx` (new):** `openActionSheet({title, actions})` + `<ActionSheetHost/>`.
- A bottom sheet with 44px rows and `role="dialog" aria-modal aria-label="story actions"`.
- It uses Drawer's focus trap and inert pattern, closes on an outside tap or Esc, and has safe-area padding.

**The `Card.tsx` header line** (at least 44px tall) moves above the title row (924):
- `SourceIcon` (16px, from the existing `sourceFaviconPath` prop), the feed button (984-997, still labelled `edit feed <name>`), "·", and the time as "5h" (`timeAgo` 216-226 drops "ago").
- `timeAgo(null)` already returns `''`. Hide the "·" with it.

**The action bar** (replaces 1277-1477): ▲, ▼, Save and Share, then, pushed right with `ml-auto`, the chevron (1354-1375) and ⋯ (`more actions`, `data-card-more`).
- Each button is 44×44 with no gaps, keeping today's −12px / −8px bleed.
- The bar is 264px, which fits from a 310px viewport. C7 checks it at 312.

**Votes:**
- `aria-pressed`, with `text-orange-500` / `text-indigo-400` when on.
- `voteInteractionEvents` (254) is unchanged.
- The vote toasts (797, 808, 1293-1295, 1320-1322) go.

**Save:** a bookmark icon labelled "save" / "unsave". It records `bookmark` only when saving.

**Share:**
- `navigator.share({title, url: entry.url})` is called synchronously in the tap handler, because iOS needs the user gesture.
  - Only an http(s) `entry.url` is shared.
  - `safeExternalUrl` is not used here, because it would turn Reddit links into old.reddit.com (api.ts:46-62).
- `share` is recorded when the promise resolves. An AbortError records nothing.
- Without `navigator.share`, Share falls back to `copyUrl` (1807), which shows "Link copied".

**Other Card changes:**
- `buildActions()` feeds both ⋯ and right-click (724-824).
- Swipe left calls `onHide`. Swipe right is clamped dead (654). The touchmove deps become `[onHide]`.
- Remove the eye button (1448-1474) and the `hidden` and `onHideToggle` props. Update `_cardPropsEqual` (1501-1514).

**`App.tsx`:**
- `hideStory(id)` records `never` once, then calls `hideEntry`, with toast group `hide`. `h` calls it.
- Delete `toggleHideEntry` (1791-1831) and `unmarkEntryRead`.
- `muteSource(id)` changes `muted_sources` through `addIds` / `removeIds`.
  - `visibleEntries` / `visibleForYou` (886-889, 911-914) drop muted feeds.
  - The toast reads "\<Feed\> hidden · Undo".
- The save toasts go (2056-2067, 2803-2818, 2909-2924, 2966-2981, 3116-3131).
- `a` / `z` vote on the selected card (C6).
- Wire `onHide` and `onMute` into both Columns, the desktop For You row and `SearchResults`.

**`Toast.tsx`:** adds `group` / `count`. Events in the same group merge into one toast. Its Undo replays the stored callbacks in reverse (at most 20) through `removeIds`, so every restore lands.

**Preferences:**
- `muted_sources` (`number[]`, cap 500), with validation and a setter in `preferences.tsx`.
- An allowlist entry (`routes/preferences.py:107-127`), and `muted_sources` becomes a PATCH set key.

**Feed screens:**
- `FeedManager` `SourceRow` (258) shows a "Hidden from tabs" tag.
- `FeedEditor` gets a "Show stories in tabs" switch beside Pause (540-566) that writes the preference.

**`ShortcutsSheet.tsx`:** rows for `b`, `h`, `a` and `z`.

### Tests
- **pytest:**
  - `test_slice30_safe_external_url.py:150-152` expects "Open in browser". Thumbnail's `const open = () => {` stays.
  - `test_preferences_anonymous.py` round-trips `muted_sources`, including PATCH.
  - `test_slice21_column_memo.py` drops `hiddenSet`.
- **Flows:**
  - `flow-card-votes`: on, off, no toast, and the card stays.
  - `flow-card-save`: one `bookmark`; unsave records none.
  - `flow-card-share`: a stubbed share with `entry.url`, then the clipboard fallback.
  - `flow-card-sheet`: 5 rows of at least 44px, the focus trap, and Esc.
  - `flow-hide-undo`: one `never`; two hides merge and a single Undo restores both.
  - `flow-swipe-left-hide` and `flow-swipe-right-dead` (CDP).
  - `flow-mute-source`.
  - FV (845-865): the feed button sits above the headline and must not reach the headline's top edge.
- **Smoke:**
  - `card-action-sheet` (390/320, `C12_ROOTS`).
  - `dashboard` at 312 runs C7 on the bar.
  - The `card-summary` selector is unchanged.

### Risks
- Hide no longer marks a story read. Hidden stories leave every tab anyway.
- Revert is safe, because old builds ignore `muted_sources`.

---

## PR6: Pull to refresh checks the tab's feeds

**What you'll notice:**
- Pull down at the top of a tab to see a spinner, then "Checking 6 feeds…", then "3 new" or "Nothing new". New stories arrive at the top.
- The phone header is one slim row: title, search, Menu. On the phone, the tab's own header row scrolls away with the stories.
- Tapping the current tab at the top does the same as a pull (C3), and so does ⋯ → Refresh (C4).
- On desktop, Refresh and `r` check the visible columns.

**Complaints:** "try to refresh … to see if it … pulls".

### Gesture: `lib/pull.ts` (pure) and `lib/usePullToRefresh.ts`
**Scope:** only the phone Column's scroller. The Brief tab has none, and the tab strip and header sit outside it.

**`touchstart` (passive):** track one finger only when:
- `scrollTop === 0` exactly (never below 0, which would freeze a bounce mid-animation),
- the touch is not inside `[data-hscroll]`, and
- no text selection exists.

**`touchmove` (non-passive, like Card.tsx:618-666):**
- An upward move ends tracking, and native scrolling takes over.
- A move with `cancelable === false` also ends tracking, because native scrolling already owns the touch.
- No `preventDefault` is called until `dy ≥ 3` and `dy > |dx|`. Cancelling a first sample of +1 or 2px of jitter can stop iOS from scrolling for the whole touch.
- From then on, downward moves call `preventDefault`. That stops iOS's top bounce for this gesture only. The bottom bounce and all other scrolling stay native, and `overscroll-contain` (Column.tsx:493) is unchanged.
- The lock decision happens once the move passes 12px:
  - It is a pull when `dy > 0` and the card would not lock horizontal, that is `!(|dx| > |dy| × 1.3)`.
  - Otherwise the gesture belongs to Card's swipe.
  - So every diagonal drag is handled by one of the two.
- `SWIPE_DEAD_ZONE_PX` and `SWIPE_DIRECTION_RATIO` move from Card.tsx (290-291) to `pull.ts`, and Card imports them, so the two locks can't drift apart.
- A finger held still for 400 ms or more (long-press or link preview) ends tracking.

**Motion:**
- The content doesn't move before the lock.
- After the lock, the offset is `min(96, dy × 0.5)`, and the pull arms at 64px. The content wrapper and spinner move with `transform`.
- Releasing while armed refreshes. Otherwise, and on `touchcancel`, the content snaps back.
- Under reduced motion the spinner doesn't rotate and the snap is instant.

### `checkTabNow()` (App.tsx)
1. `refresh()` re-reads the dashboard and resets the tab's snapshot.
2. It picks feeds, stalest first and at most 20, and calls `api.checkNow(ids)`:
   - a category tab: its active feeds
   - For You: the 20 stalest active feeds
   - Saved: nothing
3. The status row shows "Checking 6 feeds…".
   - It is a `div[data-refresh-status]` at the top of the list, mounted with `role="status"` only while it shows text.
   - Silent refreshes run at +25 s and +70 s. Their timers clear on a tab change.
   - Then it shows "3 new" (ids new to this tab) or "Nothing new" for 3 s, and unmounts.
   - If nothing was queued, the result shows after the re-read.
4. **New stories from a check run:** if the list is still at the top with no touch since the pull, the snapshot is rebuilt so they come first. Otherwise they join the end of unseen like any other arrival (PR3).

**Desktop:** Refresh (2683-2689) and `r` (2092-2098) queue the 20 stalest feeds across the visible columns. The status uses the sub-row's text slot (2677-2681).

**Phone header:**
- Delete the Refresh button (2655-2665).
- On phones the title drops from the 34px large title to 17px semibold, in one 44px row.
- On the phone, Column renders its header (label and ⋯) as the first row of the list, so it scrolls away like Reddit's sort bar. Together these give back about 64px of a 568px screen.

**Empty states:**
- The first load with no columns shows "No stories yet." (2835-2837).
- While the user has no feed of their own (`isBuiltIn`, feedRules.ts:44), For You starts with a 44px "Add your first feed" row (C7) that opens `openSettings('feeds')`. PR11 retargets it.

### Backend
- **`scheduler.queue_check(ids, force=False)`:**
  - Calls `modify_job(next_run_time=now + i×3 s)` on `ingest:<name>` / `_dynamic_job_id`, for at most 20 feeds.
  - The cooldown is `refresh.cooldown_seconds` (default 600; `force` uses 60). It is kept in `_last_queued` and documented in `ARCHITECTURE.md`.
  - Inactive feeds, and feeds with no job, are reported as `paused`.
- **`misfire_grace_time=120` on ingest jobs** (1800-1810, 2127-2150). APScheduler's default is 1 s, and trafilatura blocks the loop, so late runs were being skipped.
- **`POST /api/sources/check-now`** (`_write_deps`): `{source_ids: 1..50, force}` → `{queued, cooling_down, paused, queued_ids, queued_at}`. `queued_at` is the server's clock, which PR9 compares against.

### Tests
- **pytest:**
  - `test_check_now_queue.py`.
  - `test_ingest_misfire_grace.py`: checks the attribute, then starts a scheduler whose loop is blocked for 2 s; the job must still run.
- **Flows** (CDP, returning early on WebKit):
  - `flow-pull-refresh`: a 180px pull, then one POST with News's feed ids, the GET, and the status texts. A story arriving at +25 s is first in the list. Uses `page.clock.install` and `runFor`.
  - `flow-pull-short`: an 80px pull does nothing.
  - `flow-pull-scrolled`: with `scrollTop > 0`, the list scrolls and nothing is posted.
  - `flow-pull-jitter`: a first move of +2px followed by an upward drag scrolls the list. Nothing is prevented and nothing is posted.
  - `flow-pull-vs-swipe`: a horizontal drag hides the card, with no POST.
  - `flow-pull-reduced-motion`, `flow-tab-tap-refresh`, `flow-first-feed-row` (C7), `flow-refresh-desktop` (`widths: [1280]`).
  - FN rejects the status texts after a quiet poll.
  - `capture.cjs` mocks check-now.
- **Smoke:**
  - The `dashboard` header becomes `['open search', 'open menu']`, and C16 still checks the title.
  - New states: `refresh-status` and `first-feed-row`.

### Risks
- The non-passive listener makes iOS wait for JavaScript on every move. It returns at once unless it is tracking, and cards already do the same.
- CDP touch in Chromium tests the logic, not how it feels on iOS: Chromium has no rubber-band, and the WebKit run is report-only. The PR body carries an on-device checklist:
  - a pull at the top
  - a shaky upward scroll starting from the top
  - a diagonal drag
  - a long-press on a link
  - a pull on a short tab
- Revert restores the header button and the large title.

---

## PR7: Tab order, hiding, and one ⋯ sheet per tab

**What you'll notice:**
- An "Edit" pill opens ↑/↓ arrows and Show switches. Changes apply at once.
- Brief stays first, Saved and For You are always present, new categories go at the end, and desktop follows the same order.
- Every tab's ⋯ opens one sheet: Mark all as read, Refresh, Sort, Show stories from, Edit tabs.
- An empty tab says why, with one fix.

**Complaints:** "can't organize categories in the order I want", "hunting through shit".

### Changes
- **`lib/categories.ts` (extend):** add `orderColumns(available, layout) → {shown, hidden}`, `moveKey` and `normalizeLayout` beside the existing exports.
- **`category_layout`** `{v: 1, order, hidden}` in `preferences.tsx` (one PUT per change), plus its allowlist entry.
- **`App.tsx`:**
  - Categories come from active sources together with entries (891-910).
  - `allSubsColumns` always includes `meta:saved` and `meta:foryou`, then applies `orderColumns`. The tab a fresh device opens still comes from `resolveTab`.
  - The desktop grid and the Jump list use the same order.
  - The 44px Edit pill sits outside `role="tablist"` (3013-3018), pinned at the trailing edge.
  - A tab selected by code scrolls into view.
  - Delete the `columns.length === 0` branch (2824-2837) except the first-load skeleton, because columns are never empty now.
- **The tab ⋯ becomes a bottom sheet** (`ActionSheet` with control rows, `aria-label="tab actions"`). The popover (Column.tsx:405-484) and its pointerdown/Esc effects (239-260) go.
- **`EmptyColumnMessage`** (820-877) gains `columnFeeds` (memoized and added to the comparator). Its messages:
  - "Waiting for first check"
  - "2 feeds failing · Open"
  - "Nothing in 2 days · Show 7 days"
  - "No stories yet" for meta tabs
- **`TabsEditor.tsx` (new):**
  - Built on `GroupedSection` / `GroupedRow`, which move from `Drawer.tsx:520-618` to `components/Grouped.tsx`.
  - ↑/↓ (44px, disabled at the ends), a Show switch, Brief pinned first, and Done.
  - A dialog with a focus trap, in `C12_ROOTS`.
  - Opened from the pill, Menu "Edit tabs" and the tab sheet.
- **`CategoryPicker`** lists categories in tab order.

### Tests
- **Unit:** extend `categories.test.ts`.
- **pytest:**
  - The allowlist.
  - **Rewrite `test_frontend_slice19_empty_column_source_status.py`.** Its six tests pin Column.tsx and App.tsx details:
    - `sourcesByName` with `.get(` (:99-118)
    - `last_error`, `error_count` and `last_fetch_at` (:74-91)
    - a `.slice(0, N)` (:152-163)
    - `auto_disabled` (:171-186)
    - `sourcesByName=` on every `<Column` (:127-144)
    - the literal at `:84`
  - The rewrite pins `columnFeeds` and the three new messages instead.
  - `test_slice21_column_memo.py` adds `columnFeeds`, and drops `sourcesByName` if Column no longer takes it.
- **Flows:**
  - `flow-tabs-reorder`: at most 3 taps and one PUT; the desktop order is checked with `widths: [1280]`.
  - `flow-tab-hide`, `flow-new-category-at-end`, `flow-saved-always`, `flow-fresh-device-opens-foryou`.
  - `flow-tab-sheet`: an outside tap closes it, and tapping ⋯ again closes it.
  - FM stays green.
- **Smoke:** `column-popover` becomes `tab-sheet` (390/320). Add `tabs-editor` (390/320). The pill is visible at 312.

### Risks
- Nothing changes until the owner edits the order.
- Revert drops the order, and the key is then ignored.

---

## PR8: Saved views become custom tabs

**What you'll notice:**
- Your views are tabs. Each has "From: BBC News, The Verge, +3 · Edit" under its header.
- Ticking a feed saves at once.
- The chip rows above the tabs are gone.

### Changes
**Data (D8):**
- `custom_tabs` `{v: 1, tabs: [{id, name, sources: number[]}]}` (cap 50).
- **One-time conversion** from a non-empty `filter_presets`. Names map to ids through `sourcesByName`, and `columnPrefs` are dropped. Ids come from `preset.id`.
- `filter_presets` is left untouched, for rollback. Allowlist the new key.

**Keys:**
- `column_prefs` suffixes become column keys. Reads use `columnPrefs[key] ?? columnPrefs[legacyName]`.
- `read_entries` suffixes are unchanged, because reads are a union (PR3).

**`App.tsx`:**
- Custom tabs join as `view:<id>`, in `category_layout` order.
- A shown tab fetches `entries({source: names, limit: 200, maxAgeHours, perSourceCap: 25, activeOnly: true})` and refetches on each visible poll.
- Badges for tabs that aren't selected come from the dashboard data, filtered by `source_id`.
- A custom tab ignores `muted_sources`, and TabSheet marks muted feeds.
- Editing a tab's feeds resets its snapshot (PR3).
- Pull / Refresh queues the tab's feeds.
- Seen tracking, the marker and Earlier apply unchanged.

**`Column.tsx`:** a 44px `<div>` reading "From: … · Edit" opens TabSheet. On the phone it scrolls with the list.

**`TabSheet.tsx` (new):**
- A 17px name field and a search field.
- A checklist grouped in tab order, labelled with `sourceLabel`, with a FeedStatus slot that PR9 fills.
- Debounced PUTs, an inline delete confirm, and a dialog in `C12_ROOTS`.

**Removed:**
- `PresetChips` (227-460, 2769-2775)
- `activeSources`, `viewKind` and the multisub columns (571, 967-1044), plus the `activeSources` refetch effect (1520-1531)
- the filter chip row (2703-2734)
- the handlers at 1860-1931, 2189-2219 and 2362-2369
- Drawer "Save current view" (340-383) and "Sources" (404-495)

**Reset** never deletes `custom_tabs`, `category_layout` or `muted_sources`.

### Tests
- **Unit:** `customTabs.test.ts`, and `columns.test.ts` (the legacy fallback).
- **pytest `test_slice21_column_memo.py`:** HANDLERS drop `toggleSource`, `toggleSourceAndMaybeClose`, `clearSourceFilters` and `onSourceRenamed`, and add `selectTab`.
- **Flows:**
  - FT, FA and FA2 (357-462) and `capture.cjs:534` open the editor through Settings or `?source=`.
  - FL becomes `flow-fl-rename-in-custom-tab`. FPR becomes `flow-custom-tab-create` (at most 6 taps).
  - New: `flow-custom-tab-from-line`, `flow-preset-convert`, `flow-reset-keeps-data`.
  - FU moves to `widths: [1280]`.
- **Smoke:** remove the preset-strip expectations. Add `tab-sheet-custom` and `custom-tab`.

### Risks
- This removes UI the owner used. The old views survive in `filter_presets`, and a revert brings the chips back.

---

## PR9: Feed health you can see (migration 0031)

**What you'll notice:**
- Every feed row has a pill: Checking, 12 this week, Quiet, Blocked, Failing, Stopped, Paused, Reddit off, or Not checked yet.
- Each problem shows one fix.
- Feeds has search, then "Needs attention" first, then categories in tab order, then "Built in".
- After a pull, the status row reads "3 new · 1 failing", and "1 failing" opens Needs attention.

**Complaints:** "it didn't tell me if it is actually pulling", "change the settings, like browser".

### Migration
`0031_source_health.py` (`down_revision = "0030"`) adds `last_attempt_at` (timestamptz), `last_item_count` (int) and `last_new_count` (int).
- All three are nullable with no default, and the `models.py` fields are Optional.
- There is no `fetch_mode` (D18).

### Backend
**`_ingest` writes:**
- On success, all three fields. `last_item_count` is counted before the cap.
- On failure, `last_attempt_at`.
- When paused, `summary["status"] = "paused"`. Add `IngestResult.status: Optional[str]`. `IngestResult` (schemas.py:497-502) ignores unknown keys, so without the field, `IngestResult(**summary)` (`routes/ingest.py:54-55`) would silently drop it.

**Blocked sites:**
- `fetch_html_checked` (article_extract.py) raises on status ≥ 400 for robots, sitemap and listing fetches.
- Headers are threaded through `discover_sitemap_urls` (199), `_crawl_sitemaps` (363), `_section_candidates` (103) and `_discover_page_links` (332).
- `discover_feed_url` (79) gains `headers=None`.

**Zero yield is reported:**
- A website with no candidates raises `NoArticleListError` → `[no list]`.
- `fetch_rss` raises `NotAFeedError` when there are zero entries and the response is HTML. Keep the single `ET.fromstring`.
- A valid empty feed is still a success.

**Reddit off:** `_ingest` checks `reddit_client.is_disabled()` before fetching. `[reddit off]`, and `[no list]` within 24 h of `created_at`, never touch `error_count` (models.py:103).

**`SourceOut`** gains `last_attempt_at`, the two counts, `stories_24h`, `stories_7d`, `newest_story_at` and `has_stories`.
- The story counts come from one `GROUP BY` over 7 days with `FILTER`.
- `has_stories` is an `EXISTS` on `source_id`.
- Run `EXPLAIN` on `/sources`.

**Other endpoints:**
- PATCH `type` (dynamic feeds only; rss, podcast or generic_scrape) rebuilds the job (`scheduler.py:2453-2477`) and nulls `last_fetch_at`.
- `trigger_now` reuses the job's plugin.

### Frontend
- **`api.source(id)`.**
- **`feedHealth()` / `needsAttention()`:**
  - Quiet means the feed works but brought nothing new in 7 days, whatever the cause.
  - Needs attention lists Blocked, Failing and Stopped feeds, plus Quiet feeds that have never brought a story.
- **`apiErrors.ts` `ERROR_ACTIONS`** gives one sentence and one action per kind:

  | Kind | Action |
  |---|---|
  | not_found | Edit address |
  | network / timeout / upstream | Check now |
  | blocked | Read as Safari, with Undo |
  | stopped / paused | Resume |
  | no_list | Pick a section |
  | quiet | Check now |
  | not_a_feed | Edit address (Find its feed in PR11) |

- **`FeedStatus`** appears in `SourceRow`, TabSheet, `EmptyColumnMessage` and the Menu subtitle.
- **`MyFeedsTab`** (210-252) gains a sticky 17px search and grouped headings, and keeps the frozen order (222-235).
- **`applyServerSource`** (App.tsx:2231-2238) keeps the count fields, so pills don't flicker after a save.
- **Check now:** `checkNow([id], true)`, then poll `api.source(id)` every 5 s for up to 90 s, then show an inline line with 3 titles.
- **`checkTabNow`** finishes early once every queued feed's `last_attempt_at` is at or after the server's `queued_at` (PR6), not the phone's clock.

### Tests
- **pytest (new):**
  - `test_migration_0031_source_health.py`
  - `test_source_health_fields.py`
  - `test_rss_not_a_feed.py`
  - `test_sources_story_counts.py`
  - `test_source_patch_type.py`
  - `test_ingest_paused_status.py`
- **pytest (extend or rewrite):**
  - Extend `test_scheduler_backoff.py` and `test_trigger_now_accepts_dynamic_sources.py`.
  - Rewrite `test_plugin_no_page_links_when_link_pattern_none` (`:90-103`). `probe` still returns `[]` (`test_generic_scrape.py:58-63`).
- **Unit:** `feedHealth.test.ts`, `apiErrors.test.ts`.
- **Flows:** `flow-feeds-needs-attention`, `flow-feed-search`, `flow-check-now-inline`, `flow-pull-results`, `flow-read-as-safari` (3 taps and Undo), `flow-pill-stable-after-edit`.
- **Smoke:** `settings-feeds`.

### Rollback
Revert the app, then run `alembic downgrade 0030`.

---

## PR10: Website feeds pull only articles

**What you'll notice:** a pasted site pulls its posts, not its About, Contact, tag, author or shop pages.

**Complaints:** "it pulls random not articles from the site".

### Backend
It uses only installed packages: `courlan`, `lxml`, `tld` and `trafilatura` (`requirements.lock:47, 109, 219, 230`).

**`app/article_detect.py` (new, pure):**
- `url_ok(url, site)`: `courlan.check_url(strict=True)`, plus a list of path segments that aren't articles.
- `classify_sitemap(url)`: prefer news, post, article and blog sitemaps, and skip taxonomy, author, product and media ones.
- `score_page(...) → (score, reasons)`. A page is accepted at a score of 2 or more.
  - Plus: +3 for an `og:type` or JSON-LD article, +1 for a date, +1 for 600+ characters.
  - Minus: −3 for website/about kinds, −2 under 300 characters, −3 for a title equal to the site name or "404", −3 for a redirect to another path, −2 for a foreign canonical, −1 for no date.
- `listing_links(html, page_url)`:
  - honours `<base>`
  - keeps same-site links only
  - drops nav, header, footer and aside
  - takes the largest repeating group of 3 or more
  - reads `<time datetime>`

**`feed_autodiscovery.py`:**
- `_parse_sitemap_entries` (284) returns `(url, date, title)`.
- `_crawl_sitemaps` (363) orders and skips sitemaps by class.

**`generic_scrape.py`:**
- One `plan_candidates(url, sitemap_url, link_pattern, headers) → Plan` serves both `fetch` and `probe`.
- A non-root URL is read page-first. A root URL is read sitemap-first.
- `link_pattern` filters every candidate.
- Remove the silent whole-sitemap fallback in `_section_candidates` (103-112).
- Skip stored URLs before extraction.
- At most 2 undated pages per poll.
- `_extract_one` (123) uses `score_page`. `fetch_html` gains `return_final_url` (article_extract.py:60).
- `_extract_links_from_html` (268) wraps `listing_links`, so the `test_extract_links_*` tests still pass.

### Frontend
None. PR5 already shows no time for undated stories.

### Tests
- **`test_article_detect.py`** uses fixtures in `backend/tests/fixtures/scrape/`:
  - WordPress, Yoast, Shopify and News sitemaps
  - a listing page and an about page
  - a home-page redirect and a soft 404
  - the owner's junk sites, saved offline
- **Rewrite:**
  - `test_plugin_sitemap_wins_over_page_links`.
  - `test_generic_scrape_sitemap_url.py:249-270`.
  - `test_sitemap_newest_first.py` (`:100-109` now asserts there is no fallback).
- **New:** `test_generic_scrape_skips_stored.py`.

### Risks
- Probe the junk sites read-only from the VPS before merging.
- Some feeds will pull fewer stories or show `[no list]`.
- Revert is safe.

---

## PR11: One add flow with a preview

**What you'll notice:**
- ≡ → Add feed gives one field. The preview lists the stories, with one line such as "10 stories · 87 older skipped".
- The name is prefilled, and the category defaults to the current tab.
- After Add you see "Checking…", then "10 stories in News" with 3 titles and "Open News".
- A blocked site shows "Reading as Safari · Undo". A web-page feed gets "Find its feed".

### Backend (`routes/sources.py`)
**`BROWSER_HEADERS`** in `sources/rss.py`: the Safari User-Agent from `headers.ts`, plus `Accept-Language`. It is pinned in `test_frontend_feed_editor_rules.py`.

**`POST /api/sources/preview`** (`_write_deps`):
- Limits: `asyncio.Semaphore(2)`, a 120 s cache of at most 32 entries, a 60 s `wait_for`, and `to_thread` for parsing. Document the semaphore and cache in `ARCHITECTURE.md`.
- It uses SSRF-guarded fetchers only.
- **Pipeline:**
  1. YouTube and Apple resolution.
  2. Reddit.
  3. Fetch as a feed. On 401/403 or a challenge page, retry once with `BROWSER_HEADERS`, but only if the caller sent no User-Agent.
  4. `discover_feed_url`.
  5. `plan_candidates`, then up to 8 extractions.
- **Response:**
  - `ok`, `kind`, `url`, `headers_used`, `mode`, `feed_title`
  - `items[{title, url, published_at, accepted, reason}]`
  - `total_count`, `will_add_count`, `older_skipped_count` (from `select_items_for_ingest(first_fetch=True)`)
  - `already_stored_count`, `duplicate_of`, `error_kind`, `error`
- `/sources/test` keeps `_test_source_impl` (974) unchanged.

**Duplicates:**
- Only `POST /sources` (501) returns 409, "You already follow this feed as \<label\>."
- `/auto` (671) keeps returning 200 with the existing feed.
- The header denylist (180) still applies.

### Frontend
**`feeds/AddFeed.tsx`** replaces `AutoFeedBlock` (FeedManager.tsx:552-747) and `AddCustomTab` (757-1329):
- One 17px URL field and a Preview button.
- `FeedPreview`: up to 5 titles with dates, one count line, the name, `CategoryPicker`, and Add.
- An Options disclosure: type, sitemap, link pattern and headers.
- The draft is kept in a module store.
- After Add, it polls `api.source(id)` every 5 s for up to 120 s.

**Elsewhere:**
- `openSettings(tab, opts?: {sourceId?, sub?, category?})` replaces `(tab, sourceId?)` (App.tsx:526), and every call site is updated.
- "Find its feed" previews the URL, then PATCHes `{type, url}`.
- `ALREADY_FOLLOW_RE` matches "channel" or "feed".
- Add `api.previewSource`.
- PR6's "Add your first feed" row now opens Add.

### Tests
- **pytest:**
  - `test_sources_preview.py`: a loopback 403 in both modes, the semaphore, the cache, the time budget, the counts, and the SSRF guard.
  - `test_source_duplicate_409.py`.
  - `test_source_editor_contract.py::test_name_collision_is_409` gets two URLs.
  - Rewrite `test_frontend_slice15_add_generic_scrape.py` and `test_source_create_sitemap_link_pattern.py`.
  - The `BROWSER_HEADERS` pin.
- **Flows:**
  - Rewrite FJ, FJ2, FP, FQ, FR, FS and FG2 (866-886).
  - New: `flow-add-preview` (at most 5 taps), `flow-add-browser-fallback`, `flow-add-duplicate`, `flow-find-its-feed`, `flow-add-from-meta-tab`.
- **Smoke:**
  - Remove `settings-add-*` (smoke.cjs:200-270).
  - Add `add-empty`, `add-preview` (390/320), `add-result` and `add-error`.
  - `capture.cjs` mocks the preview.

### Risks
- A website preview can take up to 60 s. The semaphore bounds the load.
- Revert restores the old forms.

---

## PR12: Menu of tasks, 4 Settings tabs

**What you'll notice:**
- The Menu lists Add feed, Feeds (2 need attention), Saved, Edit tabs, Activity and Settings.
- Settings has 4 tabs: Feeds / AI & Brief / Activity / General.

**Complaints:** "This app is clunky".

### Changes
**`Drawer.tsx`** (327-495) becomes task rows built from `Grouped.tsx`:
- Saved selects `meta:saved`.
- Jump to column shows only on md and up.

**`lib/settingsTabs.ts` (extend):**
- `SETTINGS_TABS` shrinks from 8 ids to 4: `['feeds', 'llm', 'activity', 'general']`.
- `isSettingsTab` (used at App.tsx:507) reads the new list.
- `normalizeSettingsTab` maps the old ids:
  - `notifications` and `reset` → general
  - `history` and `voted` → activity/history (C5)
  - `hidden` → activity/hidden
  - `starred` → closes Settings and selects Saved
- The `?tab=` sync (App.tsx:499-519) uses it.

**`Settings.tsx`:**
- AI & Brief: the LLM section plus a schedule line.
- Activity: a History | Hidden segmented control (`HistoryTabContent` 1118, `EntryIdListContent` 1539).
- General: Notifications and Reset.
- Delete Settings → Saved and Downvoted, and App's `onHideAllDownvoted` (3231-3250).

**Copy:** a hand sweep to stories, feeds and tabs, including the desktop health line (2679) and the For You row count (2855). There is no guard test.

**Shared table:** no step changes the shared `sources` table.

### Tests
- **Unit:** extend the settings-tabs coverage in a new `settingsTabs.test.ts`.
- **Flows:**
  - Update FG, FT, FU and `flow-menu-closed-inert`.
  - New: `flow-menu-rows` (2 taps each), `flow-settings-old-ids`, `flow-restore-hidden` (3 taps).
- **Smoke:**
  - Remove `settingsState('notifications' | 'history' | 'hidden' | 'starred' | 'voted' | 'reset')` (366-372).
  - Add `menu`, one state per new tab, and `settings-old-id-hidden`.

### Risks
- The copy change is broad. Old URLs are mapped.
- Revert is safe.

---

## PR13: Deferred (each needs a fresh owner yes, D19)

- Category rename/merge.
- A per-feed volume cap UI (with its own nullable migration).
- Retention/pruning: off by default, dry run first. `interactions.entry_id` is ON DELETE CASCADE.
- JSON Feed and guessed feed paths.
- Framing Watch on the phone.
- Drag-to-reorder.
- Automatic Safari fallback on scheduled fetches (needs `fetch_mode` in its own migration).
- Undo removing the ranking signal (`DELETE /api/interactions/latest`).

---

## Dropped and why

**First-run help and explanations**
1. **The tip card** goes. Social-media conventions (the headline opens, ▲▼, bookmark, swipe, ⋯) need no tutorial (D15).
2. **"How Popping works" and its Menu row** go, for the same reason. The desktop `?` sheet stays and only gains keys. It does not get a focus trap or a touch section.
3. **Meta-tab "nothing to queue" explanations** go. Pulling Saved simply re-reads.

**Old reading-model controls**
4. **"Show older stories" and the "Older" divider** go. A row past the end would undo the end. ⋯ → Show stories from does the same job in 3 taps (D5).
5. **`per_source_floor` (client and backend)** is never built.
   - The window counts arrival time, so a slow feed's new story shows when it arrives. Health pills and the add result prove a feed works.
   - Dropping it also removes a 90-day per-source `row_number` and its 422 rules.
   - `per_source_cap` stays, so one busy feed can't fill a tab.
6. **✓ Read, swipe-right, `m`, the context-menu "Mark as read", and the "Marked as read/unread" toasts** go. Opening a story or scrolling past it uses it up (D3).
7. **The eye button, "Not interested", "More like this" and the two-signal swipe** go. ▲/▼ and Hide cover them, with Reddit's meanings (D1, D2).
8. **Header-tap mark-read, the "+N new" chip, the seen-set reset and `last_viewed` writes** go (D4).
9. **The "Unread" / "Read (N)" labels and persisted section collapse** go. Earlier folds again on every snapshot, so the end stays the end. `column_sections` rows are left for Reset to clear.
10. **The "Show 30 more" button** goes, because batches append automatically (D16).
11. **The unread accent ring** goes. The marker separates new from seen.

**Toasts**
12. **Chatty toasts go:** vote thank-yous, save/unsave, "refreshed", "Entry unhidden." and "Column restored.". The filled icon or the status row is the feedback, and Undo toasts remain.

**Signals and controls**
13. **`dwell` events** go.
    - They came only from ✓ and swipe-right, and time on screen while scrolling measures scroll speed, not reading.
    - The ranker's dwell weight goes idle, and `config.py` is untouched.
    - The old dwell-unit fix is moot.
14. **The phone header's Refresh button and 34px large title** go. Pull replaces Refresh (D10), and C4 keeps a path that isn't a gesture. The slimmer title gives the space back to stories.
15. **The add flow's strategy line, "N show now / M under Show older", and `in_window_count`** go. The preview is titles plus one count line (D13).
16. **Settings → Downvoted and "Hide all downvoted"** go (C5). Votes now mean Reddit votes, and they show in Activity → History.
17. **"Date unknown"** goes. Undated stories show no time.
18. **Move earlier, Move later and Hide this tab in the tab sheet** go. Edit tabs does each in 3 taps, and fewer rows keep the sheet scannable.
19. **Separate "Found nothing" and "Nothing new" pills, and Delete as a quiet feed's fix,** go. Quiet covers all three states, Check now is the one safe fix, and Delete stays in the editor.
20. **Desktop scroll tracking** goes (C2). Desktop columns scroll together, so scrolling past one doesn't mean you read it.

**Tests**
21. **`test_frontend_vocabulary.py`** is not nearly free (it needs JSX scanning plus an allowlist). Copy is fixed by hand in the PRs that touch it.

## Review notes

**Facts re-checked against main:**
1. **Anchors:** every anchor was re-checked on 4be8766. #25's `frontend/` and `backend/` trees match its branch exactly. `brief.py:386/451` are the `fetched_at >= since` filters.
2. **Phone scroller:** it is the list at `Column.tsx:493`, which has no `data-scroller` today. PR1 adds it. The `App.tsx:3077` wrapper only scrolls Brief.
3. **Stale lists:** App mirrors `readEntries`, `hiddenEntries` and `starredEntries` into refs inside effects (App.tsx:765-781). `setReadEntries` replaces the whole list (preferences.tsx:592-606). So two calls in one tick lose an id, and a diff would PATCH a removal. PR2's `addIds` / `removeIds` fix this.
4. **Desktop layout:** the grid `<main>` (2937) is a flex-1 scroll container inside an `h-full flex flex-col` root (2558). Its siblings (BriefCard, the For You row, FramingWatch) can't shrink, so a tall For You row collapses the grid. PR3's single scroller fixes it.
5. **Phone `<main>`:** it is CSS-hidden at md and up but stays mounted (3000), while the desktop grid is gated by `isDesktop` (2936). The seen observer is gated the same way.
6. **Frozen clock:** smoke calls `context.clock.setFixedTime(F.NOW)` (`smoke.cjs:934`), and timers keep running.
7. **Status wait:** `smoke.cjs:990` waits up to 8 s for no `[role="status"]` before every state.
8. **Preference mock:** `capture.cjs:182-186` echoes `body.value` for every method.
9. **slice19:** six tests pin the empty state and the `<Column` call sites. The `<Column\b[^>]*>` regex (:136) stops at the first `>`.
10. **Widths:** `WIDTHS` has only 390, 320 and 312 (`smoke.cjs:27-33`), and flows default to `[390]` (`flows.cjs:89-95`).
11. **Built-ins:** every plugin gets a job (`scheduler.py:1799-1810`) and a row (110-135), so on a real install `columns.length === 0` (2824) never happens.
12. **Brief:** BriefCard has no `onOpenSettings` prop and has four generate buttons. `Settings.tsx:405-412` sits on the AI tab.
13. **`IngestResult`** (schemas.py:497-502) ignores unknown keys. It does not return a 500.
14. **Existing libraries:** `lib/categories.ts` and `lib/settingsTabs.ts` exist (8 ids). Unit tests live in `frontend/scripts/unit/`. `flows.cjs` has no `tap` / `taps`. Card's constants are `SWIPE_DEAD_ZONE_PX` / `SWIPE_DIRECTION_RATIO`. `flows.cjs:742` is FL's PUT.
15. **Entries ranking:** the per-category `row_number` orders by `composite_score` (entries.py:404-409). `categoryLabel('on_this_day')` gives "On This Day".
16. **Tap targets:** 6 × 44 = 264px fits from a 310px viewport, which is 266px of bar at 312.
17. **View signal:** the deep-dive asked for the on-mount `view` change to ship separately, with owner sign-off. D3 is the sign-off, and PR3 is the separate PR.

**Corrections not taken as written:**
- **#4 ("3 new" as a button that scrolls up):** not taken. The status row only shows at the top, where the automatic rebuild already applies. Arrivals that land after you've scrolled away follow PR3's rule.
- **#5 (either a single scroller or open-only on desktop):** both are taken. The single scroller fixes a layout bug that exists regardless, and open-only avoids marking columns you weren't reading.
- **#6 (iOS pull gesture):** taken, plus one rule: a move with `cancelable === false` ends the pull, because iOS has already given the touch to native scrolling.
- **#11 ("Add your first feed" in `EmptyColumnMessage` for For You):** moved to a row at the top of For You (C7). Built-in stories mean For You is never empty, so an empty state would never show.
- **#13, second option (qualify a card on about 600 ms of total visibility):** not taken. It needs a clock across observer callbacks, and a card flung past in under a second wasn't read. The ✓-text rule alone fixes the false end.
- **#27 (`?since=` on resync):** taken, with one change: a full GET still runs on resume, because a `since` query can't report deleted rows.

**Design choices to watch after deploy:**
- **`SEEN_DWELL_MS = 1000`** is one constant. Tune it after the owner tries it.
- **Read marks** go under the story's category key. Reads are a union, so PR8 doesn't migrate `read_entries` suffixes, and pruning stays per category.
- **C7 and C8** are the newest calls. Each is a single row and easy to remove.

### Critical Files for Implementation
- /home/user/popping/frontend/src/lib/preferences.tsx
- /home/user/popping/frontend/src/App.tsx
- /home/user/popping/frontend/src/components/Column.tsx
- /home/user/popping/frontend/src/components/Card.tsx
- /home/user/popping/frontend/scripts/iphone-audit/smoke.cjs (with flows.cjs and capture.cjs)
