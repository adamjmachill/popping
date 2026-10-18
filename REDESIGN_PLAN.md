# Popping redesign plan

Status: in progress. Written 2026-10-18 by a Claude Code session on top of main after PR #12 (mark as unread).
This file is the working record. Sections marked **pending** fill in as the deep dive finishes.

Scope agreed with the owner:

1. A feed editor you reach in fewer steps, that saves on its own (no save link).
2. A category picker fed by the categories you already have, with an easy way to add a new one.
3. Header settings without JSON.
4. One button in the top bar (no gear plus menu plus settings-inside-menu).
5. A sweep of the whole app for iPhone problems (screens not fitting, focus zoom, overflow) and basic ease-of-use gaps (dropdowns, autosave, obvious buttons).
6. YouTube links that will not add.
7. Text that overflows rows and boxes on the phone.
8. Nothing that touches VPS exposure: no new ports, services or daemons.

Also published as a Claude doc: https://claude.ai/artifact/6EWfrW14on6HFUc4ibmk1R

---

## 1. Model and effort

Run it in one Claude Code session on **Claude Fable 5.1 at xhigh effort**, with the message in section 14 pasted in first.

| Setting | Pick | Why |
| --- | --- | --- |
| Model | Claude Fable 5.1 | The three files that change most are large and tangled (App.tsx about 3,000 lines, FeedManager.tsx 1,800, Settings.tsx 1,700). Autosave and the back button have subtle failure modes. You will not be reviewing the code, so the model has to catch its own mistakes. |
| Effort | xhigh | The design is settled here, so the job is careful execution and self-checking. xhigh is the Claude Code default for coding and the level where long tasks benefit. max spends more on reasoning without a better result, because lint, type checks, the build and iPhone screenshots do the verifying. |
| Budget option | Claude Opus 5.5 at xhigh | Fine for the two sweep PRs, which are mechanical once the checklist exists. Keep Fable 5.1 for the editor, picker, headers and top bar. |
| Ultracode | On, for review passes only | This environment runs two agents at a time (4 CPUs), so a workflow is slow for building but fine for an adversarial review before each push. |

## 2. Safety and security

Nothing in this plan opens a port, adds a service, or changes how the VPS is reached. The code is written in a Claude Code cloud container and lands as pull requests on GitHub; the VPS changes only when you run popping-update, which pulls the new images and restarts the same containers.

| What | Today | After this plan |
| --- | --- | --- |
| Published ports | Only the frontend, bound to 127.0.0.1:14789 (docker-compose.yml) | Unchanged |
| Backend and Postgres | No published ports; reachable only inside the Docker network | Unchanged |
| Internet exposure | None unless you set POPPING_FRONTEND_HOST=0.0.0.0 or enable the Cloudflare tunnel yourself | Unchanged |
| Background processes | The same three containers (postgres, backend, frontend), plus cloudflared or guard-proxy only if you enabled those profiles | Unchanged |
| Outbound requests | RSS, article, podcast, YouTube and LLM fetches, all through the SSRF guard in backend/app/url_safety.py and the optional egress proxy | Same paths. The YouTube fix changes how one existing lookup is made; the optional API key adds one call to googleapis.com |
| Browser security headers | nginx sets a strict Content-Security-Policy (self only) | Unchanged; the new UI loads no fonts, scripts or styles from outside |
| Files the PRs may touch | | frontend/src, backend/app/youtube.py, backend/app/routes/sources.py, backend/tests, README, .env.example. Not docker-compose.yml, nginx.conf.template, .github, egress-proxy or ops |

Checks before each merge:

- The PR diff touches only the files listed above. Any change outside them is a stop.
- Run the security-review skill on the diff and read its findings before merging.
- CI (backend tests, frontend lint and build, both image builds) is green.

Checks after popping-update on the VPS:

- `docker compose ps` lists only `127.0.0.1:14789->8080` under ports.
- `ss -ltnp` shows no listener that was not there before.
- The app loads and a feed still refreshes.

Rollback if anything looks wrong: set `POPPING_IMAGE_TAG=sha-<previous commit>` in .env and run `docker compose up -d`. The README documents this.

Not changed by this plan: the app has no login unless OIDC or local auth is enabled in .env. Keep the 127.0.0.1 binding and Cloudflare Access in front, as now.

## 3. YouTube links that will not add

Adding a YouTube channel works by turning the link into the channel's RSS feed, which needs the channel's internal id (UC plus 22 characters). Only a link that already contains `/channel/UC...` skips the network. Every other shape (an @handle, a /c/ name, a video link, a youtu.be link) makes the server fetch the YouTube page and search it for one exact marker, `"channelId":"UC..."` (backend/app/youtube.py lines 38 to 40 and 107 to 113).

That fails on a server for two reasons, and the code handles neither:

- The fetch identifies itself as `Popping/0.2`, not a browser (backend/app/config.py line 392). YouTube answers requests from datacenter addresses without browser cookies with a consent page or a "confirm you're not a bot" page. Neither carries the marker, so the result is "couldn't find a channel on this YouTube page", or an HTTP error wrapped as "couldn't resolve the YouTube link".
- Pasting the channel's real RSS link (`youtube.com/feeds/videos.xml?channel_id=UC...`) also fails: it does not match the /channel/ pattern, so the server fetches the feed XML and looks for a JSON marker that XML never has.

Not reproduced live: this environment's proxy blocks youtube.com, and the CI tests are deliberately written to pass with no network. The fix is built so every shape either needs no network at all or degrades to a clear next step.

The fix, in backend/app/youtube.py:

1. Resolve with no network for every shape that already carries the id: `/channel/UC...`, `feeds/videos.xml?channel_id=UC...`, a bare `UC...` id pasted on its own (the YouTube app's About > Share > Copy channel ID gives exactly that), and `/user/NAME` (YouTube's feed accepts `?user=NAME` directly).
2. For @handle, /c/NAME, watch?v= and youtu.be links, fetch the page the way a browser would: a browser User-Agent, `Accept-Language: en`, and the consent cookies (`SOCS=CAI; CONSENT=YES+`) that skip the consent wall. Same SSRF guard and redirect checks as now.
3. Look for every marker YouTube uses, not one: the canonical link tag to `/channel/UC...`, `"externalId"`, `"channelId"`, `"browseId"`, and the og:url meta. First hit wins.
4. Optional `YOUTUBE_API_KEY` in .env. When set, resolve through the YouTube Data API (`channels?forHandle=`, `channels?forUsername=`, `videos?id=`) with no page scraping; one quota unit per lookup against a free daily allowance of 10,000. Documented in .env.example as optional.
5. When nothing works, the error says what to do: "YouTube blocked the lookup from the server. In the YouTube app open the channel, tap About, then Share, then Copy channel ID, and paste that here."

In the Add form (frontend/src/components/FeedManager.tsx lines 1600 to 1670): label the field "YouTube channel link, video link, or channel ID", keep the Test button, and show the resolved feed link it already returns.

Tests to add in backend/tests/test_youtube.py: saved HTML snippets for each marker, a consent-page response that resolves through the API path when a key is set and fails with the new message when not, the bare id, the feed link, and the /user/ shape. All without network, like the existing tests.

After the next popping-update, try adding one channel by @handle on the phone. If it still fails, the message now names the reason, and pasting the channel id works regardless.

## 4. Text that overflows rows and boxes

**pending**: an agent is rendering the built app at 390x844 and 320x568 with touch emulation and measuring every element that overflows its box. Prime suspect: PR #11 added `input, textarea, select { font-size: 16px !important }` under `(pointer: coarse)` in frontend/src/styles.css (line 24). That stops focus zoom but forces 16px text into fields and rows that were sized for 13px, which matches "extends past rows and outside boxes". The real fix is to size every form control at 16px or more by design (iOS body text is 17px) and lay out rows for that size, then delete the `!important` override. Results and the exact defect list go here.

## 5. What you will see on the phone

**pending**: filled from the design synthesis.

## 6. Feed editor that saves on its own

**pending**.

## 7. Category picker

**pending**.

## 8. Headers without code

**pending**.

## 9. One button in the top bar

**pending**.

## 10. iPhone sweep checklist

**pending**.

## 11. Ease-of-use sweep checklist

**pending**.

## 12. Build order (PR-sized steps)

**pending**.

## 13. How to verify

Facts established so far in this environment:

- `cd frontend && npm ci` works. `npm run lint` passes (0 errors, 6 warnings). `npx tsc --noEmit` passes. `npm run build` passes.
- Node 22, npm 10, Python 3.13, Playwright CLI at /opt/node22/bin/playwright, Chromium under /opt/pw-browsers. No Docker, no Postgres, so backend pytest runs only in CI.
- Outbound to youtube.com is blocked by the environment's proxy.
- The workflow tool runs at most two agents at a time here.

**pending**: the full recipe including iPhone screenshots with a mocked API.

## 14. How to start the session

**pending**: the message to paste into Claude Code.

---

## Working notes (chronological)

- PR #12 (mark as unread) merged at 04:22 UTC; main is 721713e.
- Deep-dive workflow launched: 10 code readers, 3 designs (minimal change, iOS-native UX, structural), 3 judges, 1 synthesis, 7 adversarial verifiers, 1 completeness critic.
- Read directly: App.tsx settings routing (lines 380 to 445: `?view=settings&tab=` drives the overlay via pushState/popstate), top bar (gear at 2272 to 2301, hamburger at 2306), FeedManager inline edit form (436 to 700: text category with a datalist, JSON textarea for headers, tiny "save" link), Drawer "All settings..." row (384 to 387), native `window.prompt` for presets (App.tsx 306 and 2826) and `window.confirm` for reset (Settings.tsx 413).
- Deployment surface read: docker-compose.yml, nginx.conf.template, egress-proxy, ops/popping-update.sh. See section 2.
