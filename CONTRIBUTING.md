# Contributing to Tost Work

Bug reports, ideas and pull requests are welcome. Tost Work is made by Tommaso Barbera, and most of its code is written with AI coding agents, so a clear issue is as useful as a patch.

## Issues first

- **Bugs:** open a [bug report](https://github.com/SuperTost100/tost-work/issues/new?template=bug.yml). In the app, Impostazioni > Informazioni > Invia un feedback opens one with the version and system already filled in.
- **Ideas:** open a [feature request](https://github.com/SuperTost100/tost-work/issues/new?template=feature.yml).
- **Bigger changes:** open an issue before writing code, so we agree on what to build before you spend time on it.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Your contribution's licence

Tost Work is released under the [MIT licence](LICENSE). By opening a pull request you agree that your contribution is released under the same licence. There's no CLA to sign and no sign-off line to add.

## Run it locally

You need Node 24 (see `.nvmrc`) and pnpm, in the version pinned by `packageManager` in `package.json`.

```bash
pnpm install
```

```bash
pnpm dev
```

The app runs tasks through the official Codex CLI and Claude Code. Setup offers to install them, and you sign in to your own ChatGPT or Claude account inside the app.

Before you push, run the same checks as CI:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Pull requests

- Keep one change per pull request, and say what it changes, why, and how you tested it.
- For a change you can see, add screenshots in light and dark mode.
- Every string in the interface exists in Italian and English, in `apps/desktop/src/shared/i18n.ts`. Both should read as a native speaker would write them.
- CI and an automatic CodeRabbit review run on every pull request. Pull requests are squash-merged once both pass.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
