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

**Last good:** `sha-e1f0390` (2026-10-21: the #43 merge; the phone checks below passed. The #39 feed probe on this build is still open).

## Pending

- [ ] #27 · Open Menu → Settings → History. Pass: recent hides and saves are listed.
- [ ] #27 · Add a Reddit feed (r/python) and tap Test. Pass: it shows a post count and titles, not an error.
- [ ] #30 · Add a feed with a long back catalogue (a podcast or a blog with 50+ posts) and wait for its first check. Pass: its tab gains at most 10 stories plus any from the last 2 days.
- [ ] #30 · A day or more after the deploy, open the On This Day tab. Pass: the stories that arrived in the last 24 hours number at most 10 (at most 5 per UTC day, which turns at 5 pm Pacific), and none of them are in For You. Stories fetched before the deploy don't count.
- [ ] #30 · The day after adding that feed, open Brief. Pass: no highlight is one of the new feed's older stories.
- [ ] #31 · Pause a feed that has a story in For You, then force-quit and reopen the app and open For You. Pass: none of that feed's stories are in For You (resume the feed afterwards).
- [ ] #32 · After the next frontend deploy, leave the home-screen app in the background for 10 minutes or more without force-quitting it, then come back to it. Pass: it reloads by itself once, and Settings → Reset shows the new build; a desktop tab that was hidden as long shows "New version · Reload" instead.
- [ ] #35 · An hour after deploying, run `cd /opt/popping && docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT name, last_attempt_at, last_item_count, last_new_count, left(last_error, 30) AS error FROM sources ORDER BY last_attempt_at DESC NULLS LAST LIMIT 15"'`. Pass: the feeds checked since the deploy show a `last_attempt_at` after it, and the ones without an error show both counts.
- [ ] #37 · After the deploy, on the phone save a story, hide one and upvote one, then reload the desktop tab. Pass: the desktop shows all three, and neither device shows "Couldn't save".
- [ ] #37 · If any device or tab still runs a build from before PR2b, save a story there. Pass: it shows "Couldn't save…", and after a reload of that device your saves from the phone are all still there and saving works.
- [ ] #38 · Open For You's ⋯. Pass: Best is chosen; tapping Newest puts the most recent stories first, and Best puts back the order it had.
- [ ] #38 · With a saved view chip showing, set News to Best and tap the chip. Pass: News stays on Best.
- [ ] #38 · Only if no AI provider is set up: open the Brief tab. Pass: it shows "Brief needs an AI provider · Set up" on one line; Set up opens Settings › AI. (With a provider set up: Generate or Regenerate shows as before.)
- [ ] #39 · Baseline, the one check that runs **before** Step 0's `popping-update` (it has to read the old build): with #35 already deployed (the query reads its columns), run `cd /opt/popping && DEPLOYED=$(docker inspect -f '{{.Created}}' $(docker compose ps -q backend)) && docker compose exec -e DEPLOYED="$DEPLOYED" postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT s.name, s.active, s.last_attempt_at, s.last_item_count AS listed, s.last_new_count AS new, left(s.last_error, 40) AS error, count(e.id) FILTER (WHERE e.fetched_at >= '\''$DEPLOYED'\''::timestamptz) AS since_deploy, count(e.id) FILTER (WHERE e.fetched_at >= now() - make_interval(hours => 24)) AS stories_24h, count(e.id) AS stories_7d FROM sources s LEFT JOIN entries e ON e.source_id = s.id AND e.fetched_at >= now() - make_interval(days => 7) WHERE s.type = '\''generic_scrape'\'' GROUP BY s.id ORDER BY s.name"'` and keep the output. Pass: it prints a row per website feed (`since_deploy` counts from the previous deploy here and doesn't matter).
- [ ] #39 · 3 hours after deploying this PR (a website feed is checked every 2 hours by default), run the baseline's command again. Pass: every website feed has a `last_attempt_at` after the deploy, and each one with no error in the baseline still shows none (its `listed` count can be lower than before, because About, tag and shop pages no longer count); write `fail: <feed name>` for one that now shows `[no list]`, `[blocked]` or `[not found]`.
- [ ] #39 · A day or more after deploying this PR, and before deploying anything else, run the baseline's command once more: `since_deploy` counts only the stories each feed brought since the backend was deployed. Pass: each website feed with stories in the baseline's `stories_7d` has a `since_deploy` above 0, unless its site published nothing since the deploy; write `fail: <feed name>` for one whose `since_deploy` is 0 while its site kept publishing. `listed` is no signal on its own: a check with nothing new lists 0 too.
- [ ] #39 · A day after deploying, open the tab of a website feed that used to pull pages that aren't articles. Pass: the stories that arrived since the deploy are its articles, with no About, Contact, tag, author or shop pages.
- [ ] #40 · With Popping open on the phone, save a story on the laptop, then wait a minute. Pass: the story shows as saved on the phone without a reload.
- [ ] #40 · Hide a story on the phone and, within a few seconds, save a different story on the laptop; then force-quit and reopen the phone app and reload the laptop. Pass: on both, the hidden story stays hidden and the saved one stays saved.
- [ ] #42 · After moving any tab, give a feed a new category (Menu → Settings → Feeds, open the feed, New category). Pass: the new category's tab is last in the strip, and the feed's category list follows the tab order.
- [ ] #42 · With VoiceOver on, open Edit and tap ↑ on a tab. Pass: VoiceOver reads the tab's name and new place, such as "News, 5 of 9", and focus stays on that ↑.
- [ ] #42 · Turn on Airplane Mode, force-quit the home-screen app and open it again. Pass: the red error line shows, and no tab offers "Add your first feed".
- [ ] #43 · (If you have a desktop) On the laptop, make the browser window shorter than the For You row, then scroll down with the trackpad or mouse wheel. Pass: everything under the header (Brief, For You and the columns) scrolls as one page, the header stays at the top, and the columns under For You show their stories at full height, not as a thin strip.
- [ ] #43 · (If you have a desktop) On the laptop, scroll down past the 30th story of a column with more than 30. Pass: the next stories appear as you near the end of the column.
- [ ] #43 · With rotation unlocked, open the home-screen app with the phone held sideways, on a tab with more than 30 stories, then turn it upright. Pass: scrolling the tab to its end loads more stories, and tapping the tab again takes the list back to its top.
- [ ] #45 · After the first deploy with PR3b and PR3c, force-quit and reopen the home-screen app and open a tab. Pass: the stories above "N not seen · Mark as read" all arrived in the last 2 days, and the older ones sit folded under "Earlier (N)" at the end of the tab.
- [ ] #45 · On the phone, note a tab's badge, open the top story of that tab, then come back to Popping. Pass: the badge is one lower, the story is still where it was (not faded), and the list hasn't moved.
- [ ] #45 · Scroll a tab to its end. Pass: the last story is followed by "N not seen · Mark as read"; tapping it shows "You're all caught up" with the stories folded under "Earlier (N)" and a "Marked N as read" toast whose Undo brings them back above the line.
- [ ] #45 · On a tab that says "You're all caught up", tap the row under it that names another tab (such as "News · 12"). Pass: that tab opens; a tab hidden in Edit tabs is never named, and with every tab read the row is gone.
- [ ] #45 · Tap a tab's ⋯, then Mark all as read. Pass: the tab shows "You're all caught up", its badge goes, and the same ⋯ row is greyed out until new stories arrive.
- [ ] #45 · Scroll down a tab, switch to another app for 10 minutes or more (not straight after opening a story), then come back. Pass: the tab is back at its top, and the stories you had opened are under "Earlier (N)".
- [ ] #45 · On a busy tab, open "Earlier (N)" and scroll far down it, switch to another app for 10 minutes or more, come back, open the top story, then scroll down to the "N not seen · Mark as read" row. Pass: its number matches the tab's badge, and the row stays still when you reach it.
- [ ] #45 · Open a story, read it in Safari for 10 minutes or more, then come back to Popping. Pass: the list is where you left it, with that story still in place.
- [ ] #45 · On the phone, note the badges of For You and of a category tab, then open a story of that category from For You and come back. Pass: both badges are one lower (a story opened anywhere counts as seen everywhere).
- [ ] #45 · (If you have a desktop) On the laptop, open a story from the For You row at the top, then look at its category's column. Pass: the column's "N new" is one lower and the column didn't move.
- [ ] #45 · On a tab that says "You're all caught up", open "Earlier (N)", scroll down until that line is off the top of the screen, and stay there while new stories come in (a busy tab, a few minutes). Pass: the story you are reading never jumps; back at the top, the new stories are above the line.
- [ ] #45 · With VoiceOver on, go to the end of a tab and double-tap "N not seen · Mark as read". Pass: VoiceOver lands on "You're all caught up" in its place, not at the top of the page, and can reach the toast's Undo.
- [ ] #45 · (If you have a desktop) On the laptop, scroll down to the end of a short column that sits next to a much longer one, press Tab until its "N not seen · Mark as read" is focused, then press Enter. Pass: the page scrolls up to that column's "You're all caught up", which shows the focus ring, and the next Tab goes on from there without a jump.
- [ ] #45 · (If you have a desktop) In Chrome or Edge on the laptop, scroll down to the end of a short column that sits next to a much longer one and click its "N not seen · Mark as read" with the mouse (or trackpad). Pass: the page stays where it is, and the longer column next to it is still at the story you were looking at.
- [ ] #46 · On the phone, open a tab with only 2 or 3 new stories (all on screen with the "N not seen · Mark as read" row under them) and wait 2 seconds. Pass: the row turns into "You're all caught up" and the tab's badge goes, with nothing moving.
- [ ] #46 · On a tab with a badge, read the top story's card for a couple of seconds, scroll it off the top, and switch to another app straight away; force-quit Popping from the app switcher and reopen it. Pass: that tab's badge is one lower than before you scrolled.
- [ ] #46 · Tap a tab with a badge and straight away (within a second) open the Menu; leave it open for a few seconds, close it, and flick the top story off the screen at once. Pass: the badge doesn't drop (a story behind the Menu wasn't being read).
- [ ] #46 · Scroll slowly through Saved, and through a search's results. Pass: no tab's badge changes; only opening a story from there counts it as seen.
- [ ] #46 · (If you have a desktop) On the laptop, scroll slowly down a column past several stories. Pass: its "N new" doesn't change; on the desktop only opening a story counts it as seen.
- [ ] #46 · On the phone, read a few screens down a tab with a badge, then, with a story on screen, tap Refresh at the top. Pass: the tab goes back to its top with that story first (after any new ones), the badge counts it as not seen yet, and the stories you scrolled past are under "Earlier".
- [ ] #<pr> · Open Menu → Settings → Saved and note the stories it lists, then close Settings and open the Saved tab. Pass: the tab lists the same stories, each with its picture where it has one, including ones older than anything in the other tabs.
- [ ] #<pr> · Save one story, then another, then open Saved. Pass: the second one is at the top, the first right under it.
- [ ] #<pr> · In Saved, tap the bookmark on a story to remove it, then force-quit and reopen the app. Pass: it is gone from Saved and stays gone.
- [ ] #<pr> · On For You, hide a story and tap Undo on the toast, then open that story's category tab. Pass: the story is back in For You and in its tab.
- [ ] #<pr> · (If you have a desktop) On the laptop, search for an older story the phone's tabs don't show and save it, then wait a minute with Popping open on the phone. Pass: it shows at the top of Saved on the phone, with its picture.

## Gate 1: seen on scroll (PR3b and PR3c, deployed together)

Opens when PR3c merges. Every line is on the phone (the home-screen app).

- [ ] Open the top story of a badged tab and come back. Pass: the badge drops by 1 and the list hasn't moved.
- [ ] Scroll slowly down a badged tab past 5 stories, about a second on each, then look at the badge. Pass: it is 5 lower (they count as seen), and scrolling back up shows those 5 still in their places.
- [ ] On a tab with 30 or more new stories, fling past 20 in one go. Pass: those stay unseen (the badge drops only by the few you had on screen before the fling), and at the end the row offers "N not seen · Mark as read", not "You're all caught up".
- [ ] Dwell feel: read a tab at your normal pace for a minute. Too eager (stories you only glanced at count as seen) → `SEEN_DWELL_MS` 1500, right → 1000, too slow (stories you read don't count) → 700. This is a retune, not a stop.
- [ ] With rotation unlocked, turn the phone sideways and back upright, then scroll slowly past 2 stories. Pass: the badge drops by 2 (marks still happen).

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

- 2026-10-21, build e1f0390 (the phone shows "Build b6bd7e7f · 20 Oct, 21:09"):
  - [x] #36 · On a tab other than For You, force-quit the home-screen app and reopen it. Pass: it opens on the same tab.
  - [x] (phone only) #40 · After deploying, force-quit and reopen the home-screen app, reload the desktop tab, and open Menu → Settings → Reset on each. Pass: both show the same "Build …" line, with this deploy's time. PR2c merges only after this line is ticked.
  - [x] (phone only) #40 · Save a story on the phone and switch to another app straight away; force-quit Popping from the app switcher and reopen it. Pass: the story is still in Saved, on the laptop too.
  - [x] (phone only) #40 · In the Settings app, turn on airplane mode. Come back to Popping and save a story, then switch to the Settings app, turn airplane mode off, wait for Wi-Fi to reconnect, and switch back to Popping. Pass: after a reload of the laptop tab, or its next poll (up to a minute), the story shows as saved.
  - [x] (phone only) #42 · On the phone, tap Edit at the end of the tab strip, tap ↑ on News, then Done. Pass: News moves one place left in the strip; after a force-quit and reopen, and on the laptop after a reload, the strip and the desktop columns keep the new order.
  - [x] #42 · Tap Edit, then Move to top on the last tab, then Done. Pass: that tab is now right after Brief.
  - [x] (phone only) #42 · Tap Edit, turn off Show for one category, then Done. Pass: its tab is gone from the strip, from Menu → Jump to column and from the laptop's columns, and its stories still show in For You; turning Show back on puts the tab back where it was.
  - [x] #42 · Open Saved and remove its only story. Pass: Saved stays in the strip and says "No stories yet", and the phone stays on it. This replaces #36's line about Saved moving the phone.
  - [x] #43 · On the phone, open a tab with more than 30 stories and scroll steadily to its end. Pass: more stories appear before you reach the bottom, with no tap and no visible jump, and the list ends with the tab's last story.
  - #40 build line: checked on the phone only. The owner uses Popping only as the home-screen app (no desktop or browser tab), so this is the build line PR2c waits on.
  - (phone only): the laptop halves of these lines were not checked.
  - Replaced, not run: #36 · Open Saved and remove its only story. Pass: the phone moves to the tab next to it; saving a story from there brings Saved back without moving the phone. (#42's Saved line above replaces it.)
  - Not yet run: #32's auto-reload line (leave the app in the background 10 minutes or more after a deploy).
- 2026-10-21, build 619000f (backend and frontend; revision check OK):
  - [x] (phone only) #32 · After the first deploy with PR1r, force-quit and reopen the home-screen app, reload the desktop tab, and open Menu → Settings → Reset on each. Pass: both show the same "Build <8 characters> · <day> <month>, <time>" line, with the time the image was built.
  - [x] #35 · After `popping-update` (read the PR's rollback note first), run `cd /opt/popping && docker compose exec backend alembic current`. Pass: it prints `0031 (head)`.
  - [x] #35 · Force-quit and reopen the app, then open Menu → Settings → Feeds. Pass: stories load and every feed is listed as before.
  - [x] #36 · On the phone, open the News tab and save a story from it. Pass: a Saved tab appears and the phone stays on News.
  - [x] #36 · Scroll down a tab, then tap that tab's name again. Pass: the list goes back to the top and the tab doesn't change.
  - [x] #38 · On the phone, open the News tab, tap its ⋯ and tap Best. Pass: the list reorders with the highest-ranked stories first, and after a force-quit and reopen News is still on Best.
  - [x] #38 · Save a story, then open Menu → Settings → Reset, tap Reset reading state, then Reset. Pass: after the reload the story is still in Saved, hidden stories stay hidden and the saved view chips are still there.
  - #32 build line: checked on the phone only. It shows "Build 7ebe281e · 19 Oct, 23:05" (the bundle id and its build time). The desktop half was not checked; the owner has no desktop available to test on.
