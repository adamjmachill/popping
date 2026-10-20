# UX overhaul progress

Status of every unit in `docs/UX_OVERHAUL_PLAN.md`. Each unit PR updates this file. Device checks live in `docs/DEVICE_CHECKS.md`.

| Unit | Track | Status | PR |
|---|---|---|---|
| H0 Plan revision, README fix, Device checks list | docs | merged | #26 |
| H1 Test harness groundwork and local loop | F | merged | #29 |
| PR1r Build stamp and reload on a new build | F | merged | #32 |
| PR1a Scheduler defaults, extraction off the loop, Reddit Test, History | B | merged | #27 |
| PR1b Tab keys, resolveTab, tap-to-top, phone scroller | F | merged | #36 |
| PR1c Newest / Best, Reset scope, bookmark on save, Brief AI row | F | in review | #38 |
| PR2a Preference PATCH routes | B | merged | #28 |
| PR2b prefSync client and sync rules | F | not started | |
| PR2c Refuse whole-list PUTs of set keys | B (floating) | waits for both devices on the PR2b build | |
| PR3a Desktop single scroller and batching | F | not started | |
| PR3b Read model | F | not started | |
| PR3c Seen on scroll | F | not started | |
| Gate 1 | owner | | |
| PR4a Ingest rules, brief guard, On this day | B | merged | #30 |
| PR4b Window parameters and by-ids projection | B | merged | #31 |
| PR4c Saved by id | F | not started | |
| PR4d Window UI | F | not started | |
| PR5a Reddit card, action sheet, Hide hold | F | not started | |
| PR5b Muted feeds | F | not started | |
| PR6a queue_check and the check-now route | B | merged | #33 |
| PR6b Pull to refresh and checkTabNow | F | not started | |
| PR6c Slim phone header and the first-feed row | F | not started | |
| Gate 2 | owner | | |
| PR7a Tab order and hiding | F | not started | |
| PR7b Tab ⋯ sheet and empty states | F | not started | |
| PR8a Custom tabs | F | not started | |
| PR8b Remove chips, presets and the old Sources UI | F | not started | |
| PR9a Migration 0031 and feed health backend | B | merged | #35 |
| PR9b Feed health UI | F | not started | |
| PR10a article_detect library | B | merged | #34 |
| PR10b Website crawl wiring and errors | B | in review | #39 |
| PR11a Preview endpoint, browser headers, PATCH type | B | not started | |
| PR11b Add flow and 409 | F | not started | |
| PR11c Find its feed | F | not started | |
| PR12a Menu of tasks and 4 Settings tabs | F | not started | |
| PR12b Copy sweep | F | not started | |

Work in progress is pushed to `claude/ux-<unit>` branches as it goes.

## Owner decisions after the plan (2026-10-20)

- Claude merges PR9a and PR10b once CI is green and the unit's review step has passed; the owner no longer holds those merges. PR10b's read-only probe of the live website feeds moves to `docs/DEVICE_CHECKS.md`, to run after deploying.
- The device gates don't hold frontend merges. Their checks stay in `docs/DEVICE_CHECKS.md` for the owner to run after deploying, and any `fail:` becomes a fix unit.
- PR2c still merges only after both devices run the PR2b build (`popping-update`, then relaunch each device), because merging it earlier makes old app copies fail to save.
