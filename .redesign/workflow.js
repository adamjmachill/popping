export const meta = {
  name: 'popping-ux-deep-dive',
  description: 'Map the Popping frontend/backend, design the feed-editor and top-bar redesign three ways, judge, synthesize a plan, and adversarially verify it against the code',
  phases: [
    { title: 'Understand', detail: 'parallel readers over feed editor, settings, app shell, drawer, backend API, iOS audit, ease-of-use audit, UI primitives, tooling, history' },
    { title: 'Design', detail: 'three independent designs from different angles' },
    { title: 'Judge', detail: 'three judges score the designs' },
    { title: 'Synthesize', detail: 'one unified implementation plan' },
    { title: 'Verify', detail: 'nine adversarial checks of the plan against the code, plus a completeness critic' },
  ],
}

const REPO = '/home/user/popping'

const COMPLAINTS = `The app is "Popping": a personal news dashboard (Vite + React 18 + Tailwind + TypeScript frontend in frontend/, FastAPI backend in backend/), used mainly on an iPhone as a home-screen web app (Apollo-for-iOS visual language: true black, hairlines, 44px tap targets). The owner (a non-developer) gave this feedback and wants it fixed in one go:

Editing a feed takes too many steps
1. You have to go into Settings and tap a feed just to edit it.
2. Category is a blank text box. There's no list of the categories you already have and no simple way to add a new one, so you have to type it and remember the exact spelling.
3. Nothing saves on its own. You have to remember a tiny "save" link at the bottom that's easy to miss.
4. Custom headers have to be typed as JSON code. That's back-end work showing up in the app.

The top bar has too many buttons
5. There's a Settings button, a Menu button, and another Settings option inside the Menu. It's duplicated and wastes space.

General
6. You shouldn't have to report common iPhone problems one by one, like screens not fitting or the page zooming in when you tap a text box. The app should come without those problems.
7. You shouldn't have to spell out basic ease-of-use either. Things like dropdowns, autosave and obvious buttons should already be there.

Agreed scope: a simpler feed editor that saves on its own, a category picker, header settings without code, one button in the top bar, plus a check of the whole app for similar iPhone and ease-of-use problems.`

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    report: { type: 'string', description: 'Detailed markdown report with file:line references for every claim' },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Hard constraints a redesign must respect, each with file:line' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
          suggested_fix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['file', 'line', 'issue', 'suggested_fix', 'confidence'],
      },
    },
  },
  required: ['area', 'report', 'constraints', 'findings'],
}

const readerCommon = `You are reading the repository at ${REPO} (checked out at origin/main, which includes PR #12 "mark as unread"). Read actual files with cat/sed/grep; never guess. Every claim in your report must carry a file:line reference. Return raw data only (no human-facing prose, no questions). Context for why we are reading:\n\n${COMPLAINTS}\n\n`

const READERS = [
  { area: 'feed-editor', prompt: readerCommon + `Task: fully map frontend/src/components/FeedManager.tsx (1809 lines; read all of it in chunks). Cover: (a) the per-feed row and its inline edit form (state, which fields are editable, how category is entered incl. the datalist, how custom headers are entered as JSON and validated, how save is triggered and what PATCH body is built, how "nothing changed" is handled, errors/toasts, built-in vs custom source locks, pause/delete/test actions); (b) the Add custom form (fields, category default and picker, URL probe/test flow, default_headers from recommendations); (c) the Discover/recommendations flow; (d) all props FeedManager receives and who owns the source list; (e) how many taps it takes today from the dashboard to edit a feed's category, URL, headers, pause, delete. List every UI string and control. Identify what would have to change for: an editor reachable in fewer steps, autosave, a category picker fed by existing categories with an "add new" path, and a key/value headers editor.` },
  { area: 'settings-overlay', prompt: readerCommon + `Task: fully map frontend/src/components/Settings.tsx (1694 lines; read all of it in chunks). Cover: the overlay container (positioning, sizing on mobile, the PR #11 "fit to visible screen" change, scroll locking, safe areas, close affordances), the tab strip and SettingsTab union, how each tab's controls work and how each saves (explicit save button vs auto-apply vs on-blur), the LLM tab's model picker, notifications, hidden/starred, reset, and how FeedManager is embedded. For every form control note: control type, label, save mechanism, mobile tap target size, font size. Note anything inconsistent between tabs (e.g. one tab autosaves and another needs a button).` },
  { area: 'app-shell', prompt: readerCommon + `Task: map frontend/src/App.tsx (2996 lines) for the shell, not the feed logic. Read lines 1-120, 370-460 (settings/drawer state + URL-driven settings routing with pushState/popstate), 1950-2000, 2150-2350 (the top bar: every button, its order, size, label, and what it opens; the chip bar; search; refresh), and 2800-2996 (Drawer and Settings mounting and all callbacks). Explain exactly how the Settings overlay is opened/closed via history so the back button works, and what breaks if the gear button is removed and Settings is reached only via the menu. Document the mobile layout (column switching, mobileCol, sticky header with safe-area padding). List every top-bar control with file:line.` },
  { area: 'drawer', prompt: readerCommon + `Task: fully map frontend/src/components/Drawer.tsx (625 lines). Cover: panel geometry on mobile and desktop, open/close animation, swipe-to-dismiss, scroll locking, the QUICK SETTINGS section (the "All settings…" row that duplicates the top-bar gear), JUMP TO COLUMN, SOURCES filter, presets (note any native prompt()/confirm() usage), status chip, and every callback prop. Assess: if the Drawer became the single menu (one top-bar button), what should it contain, and does it already have a Settings entry that could become primary?` },
  { area: 'backend-sources-api', prompt: readerCommon + `Task: map the backend contract the feed editor talks to. Read backend/app/routes/sources.py fully, backend/app/schemas.py (SourceOut, SourceCreate, SourceUpdate, SourceAuto, test-source schemas), the Source model in backend/app/models.py, and the sources-related functions in frontend/src/api.ts plus frontend/src/lib/labels.ts (categoryLabel/sourceLabel). Document: PATCH /api/sources/{id} semantics (model_fields_set, null vs omitted for custom_headers, which fields are patchable, built-in locks), category validation (empty, max length, reserved names list with the exact names), custom_headers validation (forbidden header names, max entries, type checks), name/url validation, the test endpoint and whether it honors custom_headers, where the list of existing categories comes from (is there a categories endpoint, or does the frontend derive it from sources?), and which source plugins actually use custom_headers (grep backend/app/sources/). Also list the existing backend tests that cover PATCH/category/headers (backend/tests/test_source_patch_unset_regression.py, test_reserved_category_names.py, others) so a redesign knows what behavior is pinned. Note whether any backend change is needed for: a category picker, an autosaving editor (rapid successive PATCHes), a key/value headers editor.` },
  { area: 'ios-mobile-audit', prompt: readerCommon + `Task: audit the whole frontend for iPhone-class defects the owner should never have to report (complaint 6). Read frontend/index.html, frontend/src/styles.css, frontend/tailwind.config.js, frontend/public/manifest.webmanifest, and grep/read every component in frontend/src/components plus App.tsx for: 100vh vs 100dvh/svh in fixed overlays; fixed/sticky elements that ignore env(safe-area-inset-*) (top, bottom, left/right in landscape); overlays that sit under the iOS keyboard or do not scroll when the keyboard is up; inputs/selects/textareas that can still trigger focus zoom (inline font sizes, select elements, contenteditable) despite the pointer:coarse 16px rule in styles.css; tap targets under 44px (icon buttons, links styled as tiny text, chips); hover-only affordances with no touch equivalent; horizontal overflow sources; body scroll-lock / scroll chaining behind open sheets; native prompt()/confirm()/alert() dialogs (bad in standalone PWA); links that would leave the standalone PWA; double-tap-to-zoom delays; text truncation that hides needed info on narrow widths; touch-action conflicts with the Card swipe handlers; status-bar overlap with black-translucent; orientation issues. For each finding give file:line, what a user would see on an iPhone, the fix, and confidence. Also list the things already handled well so the plan does not redo them (PRs #8 and #11 did some of this; read git log -p --stat for commits 9823be6 and 002ff64 to see what they changed).` },
  { area: 'ease-of-use-audit', prompt: readerCommon + `Task: audit the whole frontend for basic ease-of-use gaps (complaint 7), beyond the feed editor. Read every component in frontend/src/components and App.tsx with this lens: free-text inputs where a picker/dropdown/segmented control fits; explicit save buttons or tiny "save" links where autosave or save-on-blur is expected; destructive actions without confirmation or undo, or confirmations that are native confirm() dialogs; actions hidden behind long-press, hover, keyboard shortcuts, or context menus with no visible button on touch; unclear or developer-facing labels (JSON, regex, IDs, "PATCH", header names, etc.); inconsistent button styling or placement between screens; nested navigation depth to common tasks (count taps from the dashboard to: edit a feed, pause a feed, change a feed's category, change the LLM model, generate a brief, mark a column read); empty states and loading states; error messages that expose internals. For each finding give file:line, the user-visible problem, a concrete simple fix, and confidence. Rank by how often a normal user would hit it.` },
  { area: 'ui-primitives', prompt: readerCommon + `Task: catalogue the reusable building blocks a redesign should reuse rather than reinvent. Read frontend/src/components/Toast.tsx, ShortcutsSheet.tsx, Skeleton.tsx, SourceIcon.tsx, UserBadge.tsx, LoginPage.tsx, SearchResults.tsx, and skim Card.tsx, Column.tsx, BriefCard.tsx, plus frontend/src/lib/preferences.tsx, storage.ts, interactions.ts, and api.ts (the fetch wrapper, error parsing, parseApiError). Document: the toast API (kinds, actions, durations), any bottom-sheet/modal/sheet implementations and their mobile behavior, any existing debounce/optimistic-update/"saving…" patterns, how localStorage prefs are namespaced and persisted, existing icon components and sizes, Tailwind design tokens in use (colors, radii, text sizes, 44px rows) and the grouped-list row pattern, and any existing select/dropdown/segmented-control/toggle components. Call out what is missing that a feed editor sheet, category picker, headers key/value editor, and autosave status indicator would need, and propose where new shared primitives should live.` },
  { area: 'tooling-verification', prompt: readerCommon + `Task: define how a future implementation session can verify UI changes inside this cloud container (Node 22, npm, Playwright CLI at /opt/node22/bin/playwright, Chromium at /opt/pw-browsers, no Docker, probably no Postgres). Read frontend/package.json, frontend/eslint.config.js, frontend/tsconfig.json, frontend/vite.config.ts, frontend/scripts/check-html-comments.mjs, frontend/nginx.conf.template, frontend/Dockerfile, .github/workflows/build.yml, backend/tests/README.md, backend/tests/test_frontend_slice15_add_generic_scrape.py and test_frontend_slice19_empty_column_source_status.py (what do "frontend" backend tests check?), backend/pyproject.toml. Determine: exact lint/typecheck/build commands; whether the frontend has any unit/e2e tests (likely none) and whether adding Playwright or Vitest is reasonable; how to run vite dev/preview with the API mocked via Playwright page.route so iPhone-viewport screenshots (e.g. 390x844, deviceScaleFactor 3, isMobile, hasTouch) can be taken without a backend; whether backend pytest can run here (needs Postgres? check conftest.py) and if not, how backend changes get validated (CI on the PR). Also check how the repo's PR descriptions describe verification (git log for #8, #11, #12) and what CI jobs must pass before merge. Produce a concrete, copy-pasteable verification recipe.` },
  { area: 'history-and-todos', prompt: readerCommon + `Task: establish what has already been done so the plan does not redo it, and what the code itself says is unfinished. Run git log --stat -12 and read the commit messages/bodies in full for #7, #8, #11, #12 (git show --stat and the message). Grep frontend/src for TODO, FIXME, XXX, HACK, "future", "later", "not yet", "legacy", "no longer used", "kept in the signature" and summarize each with file:line. Note dead props/callbacks (e.g. Drawer onResetLocalState) and comments that describe UI decisions the redesign would reverse (e.g. why the gear is in the top bar, why Settings moved out of the Drawer). Summarize the design rationale already recorded in comments so the new plan can respect or consciously override it.` },
]

phase('Understand')
log('Understand: ' + READERS.length + ' readers')
const reports = (await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: 'read:' + r.area, phase: 'Understand', schema: REPORT_SCHEMA })
))).filter(Boolean)
log('Understand done: ' + reports.length + '/' + READERS.length + ' reports')
if (reports.length < READERS.length) log('DROPPED readers: ' + READERS.filter(r => !reports.some(x => x.area === r.area)).map(r => r.area).join(', '))

const ctx = reports.map(r => '## REPORT: ' + r.area + '\n\n' + r.report + '\n\n### Constraints\n' + r.constraints.map(c => '- ' + c).join('\n') + '\n\n### Findings\n' + r.findings.map(f => '- ' + f.file + ':' + f.line + ' [' + f.confidence + '] ' + f.issue + ' -> ' + f.suggested_fix).join('\n')).join('\n\n---\n\n')

const ADDENDUM = `ADDITIONAL OWNER REQUIREMENTS (added after the first seven complaints; equal priority):
8. Safety. Nothing may expose the VPS: no new published ports, services, daemons, background processes, cron jobs or containers, and no changes to docker-compose.yml, Dockerfiles, nginx.conf.template, egress-proxy or ops. Outbound fetches keep the SSRF guards in backend/app/url_safety.py. The owner's words: "make sure it's safe and secure. I don't want to fuck up my VPS. I don't want to expose myself to the internet or daemons or anything like that."
9. YouTube links cannot be added (Settings > Feeds > Add custom > YouTube). Relevant code: backend/app/youtube.py, the create and test paths in backend/app/routes/sources.py, backend/app/config.py (user_agent), backend/tests/test_youtube.py, and the Add form in frontend/src/components/FeedManager.tsx (about lines 1300 to 1700). youtube.com is blocked from this container.
10. Text overflow. The owner's words: "all the text is wonky and doesn't scale right and extends past rows and outside boxes. It shouldn't be this hard. I don't want duct tape fixes. I'd rather invest in real fixes." A measured iPhone overflow audit (13 defects with file:line and root causes) is section 4 of /home/user/popping/REDESIGN_PLAN.md. Its screenshots and per-element scans are in /tmp/claude-0/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/scratchpad/shots/ (390-*.png, 320-*.png, 390-overflow-scan.json, 320-overflow-scan.json); view the PNGs with the Read tool. The capture scripts are in /home/user/popping/frontend/scripts/iphone-audit/.

CURRENT DRAFT PLAN: /home/user/popping/REDESIGN_PLAN.md (branch claude/redesign-plan, checked out) was written from these same code reports without a design panel or verification. Read it in full. Improve on it: keep what is right, correct what is wrong against the code, fill what is missing. Do not ignore it and do not merely restate it. Never modify files under /home/user/popping; scratch work goes in /tmp/claude-0/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/scratchpad/.`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    design: { type: 'string', description: 'Full markdown design: user flows, components, state, API usage, step-by-step implementation with files, tradeoffs, risks' },
    key_decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'design', 'key_decisions'],
}

const designCommon = `You are designing a change to the repository at ${REPO}. You may read code to confirm details, but the reports below already map it; cite file:line from them or from your own reading. Return raw data only.\n\n${COMPLAINTS}\n\nThe design must address all ten requirements (the seven complaints plus the ADDENDUM below: the VPS safety posture, a real YouTube fix with offline tests, and root-cause overflow fixes plus a guard that stops overflow coming back). For the first seven: a feed editor reachable in fewer steps, autosave (no save button), a category picker fed by the categories the user already has plus an easy "new category" path, a headers editor with no JSON, exactly one button in the top bar for menu/settings, and a concrete checklist of the iPhone and ease-of-use fixes from the audit reports. Respect the recorded constraints (URL/history-driven Settings state, built-in source locks, reserved category names, custom_headers validation, single-process backend, existing design tokens). Specify: every user flow tap by tap on iPhone; each new or changed component with its file; state and autosave mechanics (debounce, on-blur, optimistic update, error rollback, "saved" feedback, race handling across rapid PATCHes, what happens on close mid-save); what happens to the gear button, the Drawer's "All settings…" row, and the Settings overlay; an ordered implementation sequence in PR-sized steps with files per step; acceptance criteria per step; and risks. Be concrete enough that another engineer could implement it without asking questions.\n\n${ADDENDUM}\n\n=== CODE REPORTS ===\n\n${ctx}`

const ANGLES = [
  { key: 'minimal-diff', brief: 'Angle: MINIMAL CHANGE. Reach every goal with the smallest diff to the existing FeedManager/Settings/App/Drawer, reusing existing components, strings and patterns. Prefer modifying in place over new files. Keep the Settings overlay as the home of the editor if that is the least risky path. Optimize for low regression risk and a short review.' },
  { key: 'ios-native-ux', brief: 'Angle: BEST iOS EXPERIENCE. Start from the ideal flow a native iOS app (Apollo, Reeder, Mail) would offer: tap a feed anywhere -> a bottom sheet editor; grouped-list rows; a category picker that looks like an iOS picker with a "New category…" row; headers as key/value rows with a presets list (User-Agent etc.); autosave with subtle "Saved" feedback; one top-bar menu button. Then map each element to concrete code. Optimize for how it feels in the hand, within the existing design tokens.' },
  { key: 'architecture', brief: 'Angle: STRUCTURAL FIX. Solve complaints 6 and 7 at the root so they cannot recur: extract shared form primitives (Sheet, Row, Select/Picker, Toggle, KeyValueEditor, a useAutosave hook with status), move all Settings tabs and the feed editor onto them so every form saves the same way, shrink the top bar to one menu, and establish a mobile checklist (dvh, safe areas, 16px inputs, 44px targets, no native dialogs) enforced by lint rules or a Playwright smoke test. Optimize for consistency and maintainability, but keep the sequence shippable in reviewable PRs.' },
]

phase('Design')
const designs = (await parallel(ANGLES.map(a => () =>
  agent(a.brief + '\n\n' + designCommon, { label: 'design:' + a.key, phase: 'Design', schema: DESIGN_SCHEMA })
))).filter(Boolean)
log('Design done: ' + designs.length + '/3')

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          design: { type: 'string' },
          complaints_coverage: { type: 'integer' },
          codebase_fit: { type: 'integer' },
          regression_risk_inverse: { type: 'integer' },
          effort_proportionality: { type: 'integer' },
          ios_feel: { type: 'integer' },
          total: { type: 'integer' },
          notes: { type: 'string' },
        },
        required: ['design', 'complaints_coverage', 'codebase_fit', 'regression_risk_inverse', 'effort_proportionality', 'ios_feel', 'total', 'notes'],
      },
    },
    winner: { type: 'string' },
    graft_from_others: { type: 'array', items: { type: 'string' }, description: 'Specific ideas from the non-winning designs worth merging into the winner' },
    shared_blind_spots: { type: 'array', items: { type: 'string' }, description: 'Things all three designs missed or got wrong against the code' },
  },
  required: ['scores', 'winner', 'graft_from_others', 'shared_blind_spots'],
}

const designsText = designs.map(d => '## DESIGN: ' + d.name + '\n\nKey decisions:\n' + d.key_decisions.map(k => '- ' + k).join('\n') + '\n\n' + d.design).join('\n\n=====\n\n')

const JUDGE_LENSES = [
  { key: 'owner', brief: 'Judge as the app OWNER, a non-developer using it on an iPhone: does each design make editing a feed obviously easy, with no save button, no typing categories, no JSON, one menu button, and does it stop the class of iPhone problems from recurring?' },
  { key: 'maintainer', brief: 'Judge as the MAINTAINER who will review and live with the code: does each design fit the existing architecture and constraints (history-driven Settings state, PATCH semantics, built-in locks, reserved categories, design tokens), avoid regressions, and stay reviewable in PR-sized steps?' },
  { key: 'skeptic', brief: 'Judge as a SKEPTICAL ENGINEER trying to break each design: autosave races, partial saves, validation errors mid-typing (e.g. a category that becomes reserved or empty while autosaving), closing the sheet mid-request, offline, back-button behavior, duplicated state between Drawer/Settings/App, and anything that contradicts the code reports. Confirm by reading code where needed.' },
]

phase('Judge')
const judges = (await parallel(JUDGE_LENSES.map(j => () =>
  agent(j.brief + `\n\nScore each design 1-10 on: complaints_coverage, codebase_fit, regression_risk_inverse (10 = lowest risk), effort_proportionality, ios_feel; total = sum. Name a winner, list specific ideas to graft from the others, and list blind spots shared by all designs. Count the ADDENDUM requirements in complaints_coverage. Return raw data only. Repository: ${REPO}.\n\n${COMPLAINTS}\n\n${ADDENDUM}\n\n=== DESIGNS ===\n\n${designsText}\n\n=== CODE REPORTS ===\n\n${ctx}`, { label: 'judge:' + j.key, phase: 'Judge', schema: JUDGE_SCHEMA })
))).filter(Boolean)
log('Judge done: ' + judges.length + '/3')

const judgesText = judges.map((j, i) => '## JUDGE ' + (i + 1) + ' (' + JUDGE_LENSES[i].key + ')\n\nWinner: ' + j.winner + '\n\nScores:\n' + j.scores.map(s => '- ' + s.design + ': total ' + s.total + ' (coverage ' + s.complaints_coverage + ', fit ' + s.codebase_fit + ', low-risk ' + s.regression_risk_inverse + ', effort ' + s.effort_proportionality + ', ios ' + s.ios_feel + ') — ' + s.notes).join('\n') + '\n\nGraft:\n' + j.graft_from_others.map(g => '- ' + g).join('\n') + '\n\nShared blind spots:\n' + j.shared_blind_spots.map(b => '- ' + b).join('\n')).join('\n\n')

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'The complete unified plan in markdown, self-contained for a fresh engineer' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          change: { type: 'string' },
          acceptance: { type: 'string' },
          verification: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'files', 'change', 'acceptance', 'verification', 'depends_on'],
      },
    },
    audit_checklist: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['iphone', 'ease-of-use'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
          fix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['area', 'file', 'line', 'issue', 'fix', 'confidence'],
      },
    },
    open_decisions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan', 'steps', 'audit_checklist', 'open_decisions', 'risks'],
}

phase('Synthesize')
const synth = await agent(`You are producing the single implementation plan for the repository at ${REPO}. Three designs were produced from different angles and judged by three judges; the code reports map the codebase. Build on the winning design, graft the judged-best ideas from the others, fix the shared blind spots, and resolve conflicts by reading the code. The plan must be self-contained: a fresh engineer with only this plan and the repo must be able to implement it without asking questions. Your plan replaces sections 2 to 14 of REDESIGN_PLAN.md and must keep its numbering: 2 Safety and security, 3 YouTube, 4 Text overflow, 5 What you will see on the phone, 6 Feed editor, 7 Category picker, 8 Headers, 9 Top bar, 10 iPhone checklist, 11 Ease-of-use checklist, 12 Build order, 13 How to verify, 14 How to start the session. Write the plan markdown with exactly those ## headings. Include: goals mapped to the ten requirements; the safety section (files allowed, checks before merge and after popping-update, rollback); the YouTube fix with every link shape, the error wording, and offline tests; the overflow root-cause fixes, the move of every form control to 16px by design so the !important rule in styles.css can be deleted, and the CI guard; the target user flows tap by tap on iPhone; the component and state design (names, files, props, the autosave mechanics in detail: trigger, debounce, in-flight coalescing, rollback on 4xx with the backend's error text, "Saved" feedback, behavior on close mid-save, validation that must happen client-side before PATCH and what the backend rejects); the category picker (source of categories, labels via categoryLabel, reserved names, "new category" flow, what happens to a column when the last feed leaves a category); the headers editor (key/value rows, forbidden headers, presets such as User-Agent, how empty rows map to null vs {}); the top bar (what the one button is, what the menu contains, where Settings lives, how history/back-button behavior is preserved, what is deleted); an ordered sequence of PR-sized steps with files, exact acceptance criteria and the verification commands for each; the iPhone + ease-of-use audit checklist with file:line and fixes, merged from the audit reports and de-duplicated, with false positives removed after checking the code; backend changes if any, with tests to add; the verification recipe (lint, tsc, build, Playwright iPhone screenshots with mocked API, CI); explicit non-goals; open decisions only where two readings would lead to materially different work; and risks. Keep comments and strings in the app's plain, non-technical voice. Return raw data only.\n\n${COMPLAINTS}\n\n${ADDENDUM}\n\n=== JUDGES ===\n\n${judgesText}\n\n=== DESIGNS ===\n\n${designsText}\n\n=== CODE REPORTS ===\n\n${ctx}`, { label: 'synthesize', phase: 'Synthesize', schema: PLAN_SCHEMA, effort: 'high' })
if (!synth) throw new Error('synthesis failed')
log('Synthesize done: ' + synth.steps.length + ' steps, ' + synth.audit_checklist.length + ' audit items')

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'refuted', 'needs_change'] },
          evidence: { type: 'string', description: 'file:line and what the code actually does' },
          correction: { type: 'string' },
        },
        required: ['claim', 'status', 'evidence', 'correction'],
      },
    },
    additions: { type: 'array', items: { type: 'string' }, description: 'Constraints, steps or checklist items the plan is missing, each with file:line' },
  },
  required: ['lens', 'verdicts', 'additions'],
}

const planText = synth.plan + '\n\n## STEPS (structured)\n' + synth.steps.map(s => '- ' + s.id + ' ' + s.title + ' | files: ' + s.files.join(', ') + ' | depends: ' + s.depends_on.join(', ') + '\n  change: ' + s.change + '\n  acceptance: ' + s.acceptance + '\n  verification: ' + s.verification).join('\n') + '\n\n## AUDIT CHECKLIST (structured)\n' + synth.audit_checklist.map(a => '- [' + a.area + '][' + a.confidence + '] ' + a.file + ':' + a.line + ' — ' + a.issue + ' -> ' + a.fix).join('\n') + '\n\n## OPEN DECISIONS\n' + synth.open_decisions.map(o => '- ' + o).join('\n') + '\n\n## RISKS\n' + synth.risks.map(r => '- ' + r).join('\n')

const VERIFY_LENSES = [
  { key: 'autosave-correctness', brief: 'Lens: the feed editor and autosave. Try to break the plan: trace the PATCH flow from the planned component through frontend/src/api.ts to backend/app/routes/sources.py. Check every claim about state, debounce, coalescing, rollback, 422 handling, built-in locks, close-mid-save, and the source list refresh after save. Confirm the planned files and functions exist or can exist as described.' },
  { key: 'category-picker', brief: 'Lens: the category picker. Verify against backend/app/routes/sources.py (_validate_category, reserved names, length), frontend/src/lib/labels.ts, how App.tsx derives columns from categories, and what happens to columns/localStorage column prefs when a category gains or loses its last feed. Check the "new category" flow and that typing a reserved or over-long name is handled before PATCH.' },
  { key: 'headers-editor', brief: 'Lens: the headers editor. Verify against _validate_custom_headers in backend/app/routes/sources.py, the PATCH null-vs-omitted semantics (model_fields_set), SourceOut.custom_headers, which plugins honor custom headers, and the Add form / recommendations default_headers path. Check the planned key/value mapping, forbidden header handling, presets, and the test-fetch path.' },
  { key: 'top-bar-and-history', brief: 'Lens: the top bar and navigation. Verify against frontend/src/App.tsx lines 370-460 and 2150-2350 and 2800-2996 and frontend/src/components/Drawer.tsx: removing the gear, making the one menu button the entry to Settings, the Drawer "All settings…" row, pushState/popstate behavior, back-button closing, the chip bar and search/refresh placement, and keyboard shortcuts that open Settings. Check that nothing else in the app calls openSettings in a way the plan breaks.' },
  { key: 'iphone-checklist', brief: 'Lens: the iPhone checklist, including the 13 overflow defects in section 4 of REDESIGN_PLAN.md (view the screenshots in the shots folder named in the ADDENDUM and confirm each fix removes the cause rather than hiding the symptom). For every iphone checklist item, open the file at the line and confirm the defect is real on iOS Safari / standalone PWA, the fix is right, and it is not already handled (read frontend/src/styles.css, index.html, and PRs #8/#11 via git show). Refute false positives. Add real defects the checklist missed.' },
  { key: 'ease-of-use-checklist', brief: 'Lens: the ease-of-use checklist. For every ease-of-use item, open the file at the line and confirm the problem is real for a normal user, the fix is proportionate, and it does not conflict with the feed-editor plan. Refute false positives, flag fixes that would widen the scope beyond the agreed work, and add real gaps the checklist missed.' },
  { key: 'youtube', brief: 'Lens: the YouTube fix. Verify against backend/app/youtube.py, the create and test paths in backend/app/routes/sources.py (about 440 to 460 and 875 to 895), backend/app/config.py user_agent, backend/tests/test_youtube.py, and the Add form in frontend/src/components/FeedManager.tsx. youtube.com is blocked from this container, so verify by reading code and by throwaway offline checks in the scratchpad (never in the repo). Run every shape through the planned resolver: /channel/UC..., @handle, /c/NAME, /user/NAME, watch?v=, youtu.be, /shorts/, /live/, feeds/videos.xml?channel_id=, a bare UC id, m.youtube.com, music.youtube.com, with and without trailing paths and query strings. Check the claims about consent cookies, page markers, the feeds ?user= parameter (flag it if uncertain), and the optional API key (read server-side only, never logged or returned to the browser). Confirm SSRF guards still run on every fetch. Also hunt for any OTHER reason a YouTube add fails today: frontend validation, the type radio, the URL input type, the category default "video" being valid or reserved, the name slug rule, the refresh default, the test endpoint path, and how errors reach the user inside the Settings sheet.' },
  { key: 'vps-security', brief: 'Lens: safety of the owner\'s VPS. Check that no step adds a published port, service, daemon, cron job or container, or changes docker-compose.yml, Dockerfiles, nginx.conf.template, egress-proxy or ops; that the CI change adds no permissions or secrets and cannot publish images from a PR; that new outbound requests (YouTube page fetch, optional YouTube Data API) go through httpx with the SSRF event hook and honour HTTP_PROXY for the optional egress guard; that an API key is read server-side only and never logged or sent to the browser; that every new UI piece works under the Content-Security-Policy in frontend/nginx.conf.template (no inline scripts, no external fonts, images or styles, no eval); that the headers editor cannot send forbidden headers, blank names or CRLF; and that the post-deploy checks and rollback in section 2 of REDESIGN_PLAN.md are correct commands for this Docker Compose setup. Read the actual files.' },
  { key: 'verification-recipe', brief: 'Lens: the verification recipe and sequencing. Check every command in the plan actually works in this container (frontend/node_modules may be installed; try npm run lint and npx tsc --noEmit in /home/user/popping/frontend if node_modules exists, and a Playwright headless launch with executablePath under /opt/pw-browsers if feasible). Check the step order and dependencies are consistent, each step is PR-sized, acceptance criteria are testable, and CI (.github/workflows/build.yml) will exercise the changes. Correct any command that fails.' },
]

phase('Verify')
const verifications = (await parallel(VERIFY_LENSES.map(v => () =>
  agent(v.brief + `\n\nYou are an adversarial verifier for an implementation plan against the repository at ${REPO}. Default to skepticism: read the real code before confirming anything. Report each claim you checked with status confirmed / refuted / needs_change, evidence with file:line, and the correction. Then list additions the plan is missing. Return raw data only.\n\n${COMPLAINTS}\n\n${ADDENDUM}\n\n=== PLAN ===\n\n${planText}`, { label: 'verify:' + v.key, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' })
))).filter(Boolean)
log('Verify done: ' + verifications.length + '/' + VERIFY_LENSES.length)

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    missing: { type: 'array', items: { type: 'string' } },
    over_scoped: { type: 'array', items: { type: 'string' } },
    complaint_coverage: { type: 'array', items: { type: 'object', properties: { complaint: { type: 'integer' }, covered_by: { type: 'string' }, gap: { type: 'string' } }, required: ['complaint', 'covered_by', 'gap'] } },
  },
  required: ['missing', 'over_scoped', 'complaint_coverage'],
}

const critic = await agent(`Completeness critic for an implementation plan against the repository at ${REPO}. For each of the ten requirements (seven complaints plus the ADDENDUM), name which plan steps cover it and any remaining gap. List what is missing from the plan (a flow, a state, a file that must change, a test, a migration, a string, a mobile case) and what is over-scoped relative to the agreed work. Read code to confirm. Return raw data only.\n\n${COMPLAINTS}\n\n${ADDENDUM}\n\n=== PLAN ===\n\n${planText}\n\n=== VERIFIER FINDINGS ===\n\n${verifications.map(v => '## ' + v.lens + '\n' + v.verdicts.map(x => '- [' + x.status + '] ' + x.claim + ' — ' + x.evidence + (x.correction ? ' => ' + x.correction : '')).join('\n') + '\nAdditions:\n' + v.additions.map(a => '- ' + a).join('\n')).join('\n\n')}`, { label: 'critic', phase: 'Verify', schema: CRITIC_SCHEMA, effort: 'high' })

return { reports, designs, judges, synth, verifications, critic }