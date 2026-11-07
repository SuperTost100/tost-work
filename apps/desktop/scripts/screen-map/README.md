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
   node scripts/screen-map/figma-script.mjs /tmp/screens light 0.0.28-dev > /tmp/screens/light.js
   ```

3. An agent with the Figma MCP runs that code with `use_figma`. It empties the page and returns the new frame ids in
   capture order. Then it calls `upload_assets` with those ids and posts each PNG from `/tmp/screens/<theme>/`, in
   `manifest.json` order, to the matching upload URL.

Run it on Linux. The capture's data and home folder are throwaway, so your own skills in `Documents/Tost Work/Skills`
never reach the screenshots; on macOS the Documents folder doesn't follow the home folder. The capture runs on the fake
engine, in Italian. A screen it can't reach is skipped with a `SKIP`
line, and the rest still come out.
