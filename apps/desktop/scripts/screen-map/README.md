# Screen map

Every screen of the app, in light and dark, laid out as a flow in Figma, so they can be reviewed side by side before a
release. The map lives in the Figma file [Tost Work · screen map](https://www.figma.com/design/rnN1akJ2TXyLGtL2Lv0JcA)
(team "BI visible"), one page per theme and one section per flow.

## Refresh it

1. Build the app and capture both themes. On Linux without a display, put `xvfb-run -a` before `node`.

   ```sh
   cd apps/desktop
   pnpm build
   node scripts/screen-map/capture.mjs /tmp/screens light
   node scripts/screen-map/capture.mjs /tmp/screens dark
   ```

2. Print the layout code for each page:

   ```sh
   node scripts/screen-map/figma-script.mjs /tmp/screens light 0.0.31-dev > /tmp/screens/light.js
   ```

3. An agent with the Figma MCP runs that code with `use_figma`. It empties the page and returns the new frame ids in
   capture order. Then it calls `upload_assets` with those ids and posts each PNG from `/tmp/screens/<theme>/`, in
   `manifest.json` order, to the matching upload URL.

Run it on Linux. The capture's data and home folder are throwaway, so your own skills in `Documents/Tost Work/Skills`
never reach the screenshots; on macOS the Documents folder doesn't follow the home folder. The capture runs on the fake
engine, in Italian. A screen it can't reach is skipped with a `SKIP`
line, and the rest still come out.

## States that need a platform or a failure

The capture runs on Linux with the fake engine, so some states can't happen by themselves. It makes them without
changing the app, and the map marks them in the section's note and the frame names:

- **Windows only** (section "Windows only"): Claude's note in setup and in Settings, and the card that says Claude isn't
  limited to the task's folder, before connecting, before an Anthropic course key is saved and before a first Claude
  task. `window.tostWork` is read-only from the page, so the capture registers a small preload on the session that sets
  `claudeUnconfined` before the app's own preload exposes its API. The window itself is the capture's platform. Cancel
  closes each card, so nothing is installed, saved or started.
- **An install under way** (section "Installing an AI"): the same preload makes the AI's status "not installed" and its
  install never finish, so nothing is installed.
- **Linux sandbox notice** (section "Linux sandbox notice"): the app starts on a PATH that holds only `node`, `true`,
  `claude` and `codex`, so the real check in the main process finds no bubblewrap and no socat. The capture then links
  `bwrap` and `socat` in, one at a time, and presses Check again.
- **Tasks that can't start** (section "Tasks that can't start"): the fake engine runs none of the checks that stop a
  real task. The capture saves each failed task into its throwaway database, with the app's own Italian sentence read
  from `src/shared/i18n.ts`: a project folder with a `.mcp.json`, ChatGPT's step check failing because Codex isn't
  installed, and a Claude task stopped on a missing socat. The window then shows them as it does for a real failure.

The frames for a state the platform doesn't have are named for it (`windows-…`, `linux-…`), and the page title says which
platform the rest were captured on. The Linux sandbox frames read this computer's PATH and `/etc/os-release`, so capture
on a Linux computer that has `bwrap`, `socat`, `node`, `claude` and `codex` on its PATH.
