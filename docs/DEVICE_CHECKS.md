# Device checks

This file is the running list of on-device checks for the UX overhaul (`docs/UX_OVERHAUL_PLAN.md`, D21). It is the only reply channel, and every session reads it first. Issues are turned off on this repo, so the list lives here.

## How a check works

1. Each unit's PR adds its lines under **Pending**. Run a check only after the main-branch build for that merge commit is green.
2. Step 0, every time:
   - Run `popping-update`.
   - Paste the revision check under the line:
     `cd /opt/popping && for s in backend frontend; do printf '%s ' $s; docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' $(docker compose images -q $s); done`
   - Force-quit the home-screen app, reopen it, and reload any desktop tab. A resumed page keeps the old bundle.
   - Once PR1r is in, confirm Settings shows the expected build.
3. Reply by editing this file on GitHub: tick a line when it passes, or write `fail: <what you saw>` under it. Telling a session in chat works too; the session records it here.
4. Gates never pass on their own. Write `pass`, `fail: <line>` or `waive` under the gate. While a gate is open, frontend units don't merge; the backend track continues.
5. Rollback:
   - Never edit files in `/opt/popping`.
   - Never pin a tag in `.env`.
   - Frontend-only rollback: `cd /opt/popping && POPPING_IMAGE_TAG=sha-<last good> docker compose up -d --no-deps frontend`. `--no-deps` keeps the backend on its current image: without it, compose recreates the backend on the old tag too, and from PR9a on a backend image older than PR9a can't start against the database (Rollback in `docs/ux-notes/PR9a.md`). After that, no `popping-update` until the revert is merged and green.

**Last good:** `sha-619000f` (2026-10-21: backend and frontend on 619000f, the #38 merge; checks below passed).

## Pending

- [ ] #27 · Open Menu → Settings → History. Pass: recent hides and saves are listed.
- [ ] #27 · Add a Reddit feed (r/python) and tap Test. Pass: it shows a post count and titles, not an error.
- [ ] #30 · Add a feed with a long back catalogue (a podcast or a blog with 50+ posts) and wait for its first check. Pass: its tab gains at most 10 stories plus any from the last 2 days.
- [ ] #30 · A day or more after the deploy, open the On This Day tab. Pass: the stories that arrived in the last 24 hours number at most 10 (at most 5 per UTC day, which turns at 5 pm Pacific), and none of them are in For You. Stories fetched before the deploy don't count.
- [ ] #30 · The day after adding that feed, open Brief. Pass: no highlight is one of the new feed's older stories.
- [ ] #31 · Pause a feed that has a story in For You, then force-quit and reopen the app and open For You. Pass: none of that feed's stories are in For You (resume the feed afterwards).
- [ ] #32 · After the next frontend deploy, leave the home-screen app in the background for 10 minutes or more without force-quitting it, then come back to it. Pass: it reloads by itself once, and Settings → Reset shows the new build; a desktop tab that was hidden as long shows "New version · Reload" instead.
- [ ] #35 · An hour after deploying, run `cd /opt/popping && docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT name, last_attempt_at, last_item_count, last_new_count, left(last_error, 30) AS error FROM sources ORDER BY last_attempt_at DESC NULLS LAST LIMIT 15"'`. Pass: the feeds checked since the deploy show a `last_attempt_at` after it, and the ones without an error show both counts.
- [ ] #36 · Open Saved and remove its only story. Pass: the phone moves to the tab next to it; saving a story from there brings Saved back without moving the phone.
- [ ] #36 · On a tab other than For You, force-quit the home-screen app and reopen it. Pass: it opens on the same tab.
- [ ] #38 · Open For You's ⋯. Pass: Best is chosen; tapping Newest puts the most recent stories first, and Best puts back the order it had.
- [ ] #38 · With a saved view chip showing, set News to Best and tap the chip. Pass: News stays on Best.
- [ ] #38 · Only if no AI provider is set up: open the Brief tab. Pass: it shows "Brief needs an AI provider · Set up" on one line; Set up opens Settings › AI. (With a provider set up: Generate or Regenerate shows as before.)
- [ ] #39 · Baseline, the one check that runs **before** Step 0's `popping-update` (it has to read the old build): with #35 already deployed (the query reads its columns), run `cd /opt/popping && DEPLOYED=$(docker inspect -f '{{.Created}}' $(docker compose ps -q backend)) && docker compose exec -e DEPLOYED="$DEPLOYED" postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT s.name, s.active, s.last_attempt_at, s.last_item_count AS listed, s.last_new_count AS new, left(s.last_error, 40) AS error, count(e.id) FILTER (WHERE e.fetched_at >= '\''$DEPLOYED'\''::timestamptz) AS since_deploy, count(e.id) FILTER (WHERE e.fetched_at >= now() - make_interval(hours => 24)) AS stories_24h, count(e.id) AS stories_7d FROM sources s LEFT JOIN entries e ON e.source_id = s.id AND e.fetched_at >= now() - make_interval(days => 7) WHERE s.type = '\''generic_scrape'\'' GROUP BY s.id ORDER BY s.name"'` and keep the output. Pass: it prints a row per website feed (`since_deploy` counts from the previous deploy here and doesn't matter).
- [ ] #39 · 3 hours after deploying this PR (a website feed is checked every 2 hours by default), run the baseline's command again. Pass: every website feed has a `last_attempt_at` after the deploy, and each one with no error in the baseline still shows none (its `listed` count can be lower than before, because About, tag and shop pages no longer count); write `fail: <feed name>` for one that now shows `[no list]`, `[blocked]` or `[not found]`.
- [ ] #39 · A day or more after deploying this PR, and before deploying anything else, run the baseline's command once more: `since_deploy` counts only the stories each feed brought since the backend was deployed. Pass: each website feed with stories in the baseline's `stories_7d` has a `since_deploy` above 0, unless its site published nothing since the deploy; write `fail: <feed name>` for one whose `since_deploy` is 0 while its site kept publishing. `listed` is no signal on its own: a check with nothing new lists 0 too.
- [ ] #39 · A day after deploying, open the tab of a website feed that used to pull pages that aren't articles. Pass: the stories that arrived since the deploy are its articles, with no About, Contact, tag, author or shop pages.
- [ ] #40 · After deploying, force-quit and reopen the home-screen app, reload the desktop tab, and open Menu → Settings → Reset on each. Pass: both show the same "Build …" line, with this deploy's time. PR2c merges only after this line is ticked.
- [ ] #40 · With Popping open on the phone, save a story on the laptop, then wait a minute. Pass: the story shows as saved on the phone without a reload.
- [ ] #40 · Hide a story on the phone and, within a few seconds, save a different story on the laptop; then force-quit and reopen the phone app and reload the laptop. Pass: on both, the hidden story stays hidden and the saved one stays saved.
- [ ] #40 · Save a story on the phone and switch to another app straight away; force-quit Popping from the app switcher and reopen it. Pass: the story is still in Saved, on the laptop too.
- [ ] #40 · In the Settings app, turn on airplane mode. Come back to Popping and save a story, then switch to the Settings app, turn airplane mode off, wait for Wi-Fi to reconnect, and switch back to Popping. Pass: after a reload of the laptop tab, or its next poll (up to a minute), the story shows as saved.

## Gate 1: seen on scroll (PR3b and PR3c, deployed together)

Opens when PR3c merges.

- [ ] Open the top story of a badged tab and come back. Pass: the badge drops by 1 and the list hasn't moved.
- [ ] Scroll slowly past 5 cards. Pass: they count as seen.
- [ ] Fling past 20. Pass: those stay unseen, and the end row offers "N not seen · Mark as read".
- [ ] Dwell feel. Too eager → `SEEN_DWELL_MS` 1500, right → 1000, too slow → 700. This is a retune, not a stop.
- [ ] Rotate to landscape and back, then scroll. Pass: marks still happen.

## Gate 2: pull to refresh (PR6b and PR6c, deployed together; also PR5a's swipe and sheet)

Opens when PR6c merges.

- [ ] Pull at the top. Pass: the spinner follows your finger, and a release past the threshold shows "Checking N feeds…" and then a result. A short pull springs back with no check.
- [ ] Shaky upward scroll from the top. Pass: normal scrolling, no spinner.
- [ ] Diagonal drag. Pass: a pull or a card swipe, never both, never a stuck list.
- [ ] Long-press a link. Pass: the iOS preview, no spinner.
- [ ] Short tab. Pass: same as a pull at the top.
- [ ] Ten slow pulls in a row. Pass: all arm.
- [ ] Pass: no doubled movement.
- [ ] Small downward wobble, then scroll up. Pass: normal scrolling.
- [ ] VoiceOver. Pass: it reads "Checking…" and the result.
- [ ] Swipe a card left. Pass: it hides, and Undo brings it back.
- [ ] Open a card's ⋯. Pass: the sheet rises from the bottom, every row is in reach, and a tap outside closes it.

## Checked

- 2026-10-21, build 619000f (backend and frontend; revision check OK):
  - [x] (phone only) #32 · After the first deploy with PR1r, force-quit and reopen the home-screen app, reload the desktop tab, and open Menu → Settings → Reset on each. Pass: both show the same "Build <8 characters> · <day> <month>, <time>" line, with the time the image was built.
  - [x] #35 · After `popping-update` (read the PR's rollback note first), run `cd /opt/popping && docker compose exec backend alembic current`. Pass: it prints `0031 (head)`.
  - [x] #35 · Force-quit and reopen the app, then open Menu → Settings → Feeds. Pass: stories load and every feed is listed as before.
  - [x] #36 · On the phone, open the News tab and save a story from it. Pass: a Saved tab appears and the phone stays on News.
  - [x] #36 · Scroll down a tab, then tap that tab's name again. Pass: the list goes back to the top and the tab doesn't change.
  - [x] #38 · On the phone, open the News tab, tap its ⋯ and tap Best. Pass: the list reorders with the highest-ranked stories first, and after a force-quit and reopen News is still on Best.
  - [x] #38 · Save a story, then open Menu → Settings → Reset, tap Reset reading state, then Reset. Pass: after the reload the story is still in Saved, hidden stories stay hidden and the saved view chips are still there.
  - #32 build line: checked on the phone only. It shows "Build 7ebe281e · 19 Oct, 23:05" (the bundle id and its build time). The desktop half was not checked; the owner has no desktop available to test on.
