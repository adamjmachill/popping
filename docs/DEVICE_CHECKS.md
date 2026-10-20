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
   - Frontend-only rollback: `cd /opt/popping && POPPING_IMAGE_TAG=sha-<last good> docker compose up -d frontend`. After that, no `popping-update` until the revert is merged and green.

**Last good:** not recorded yet (the first passed check sets it).

## Pending

- [ ] #27 · Open Menu → Settings → History. Pass: recent hides and saves are listed.
- [ ] #27 · Add a Reddit feed (r/python) and tap Test. Pass: it shows a post count and titles, not an error.
- [ ] #30 · Add a feed with a long back catalogue (a podcast or a blog with 50+ posts) and wait for its first check. Pass: its tab gains at most 10 stories plus any from the last 2 days.
- [ ] #30 · A day or more after the deploy, open the On This Day tab. Pass: the stories that arrived in the last 24 hours number at most 10 (at most 5 per UTC day, which turns at 5 pm Pacific), and none of them are in For You. Stories fetched before the deploy don't count.
- [ ] #30 · The day after adding that feed, open Brief. Pass: no highlight is one of the new feed's older stories.

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

_Nothing yet._
