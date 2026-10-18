# iPhone overflow audit

Renders the built app in Chromium with iPhone emulation (390x844 at 3x and
320x568 at 2x, touch on) against a fully mocked API, screenshots eleven
states, and scans every element for text or boxes that extend past their
container. This is the audit behind section 4 of REDESIGN_PLAN.md and the
seed of the CI smoke test the sweep PR adds.

Run:

    bash frontend/scripts/iphone-audit/run.sh

Needs Node 22, a built frontend (the script builds it), and the `playwright`
package resolvable with `require()` plus a Chromium it can launch. In the
Claude Code cloud container that is `/opt/node-tools/node_modules/playwright`
with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; elsewhere add
`playwright` as a devDependency and run `npx playwright install chromium`.

Outputs land next to the scripts: `<width>-<nn>-<state>.png` screenshots,
`<width>-overflow-scan.json` (flagged elements per state with computed
styles and rects), `summary.json`, `analysis.txt`, `probe-output.json`.
Keep the PNGs out of git.

`capture.cjs` must stay CommonJS, and card locators are scoped to
`main.md\:hidden` because App renders the hidden desktop grid too.
