# Redesign deep dive: raw results

Generated from the deep-dive workflow journal. Raw agent output, not edited. REDESIGN_PLAN.md is the curated plan; this file is the evidence behind it and survives if the session ends.

Progress: 10 code readers, 0 designs, 0 judges, synthesis not yet, 0 verifiers, critic not yet.

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
