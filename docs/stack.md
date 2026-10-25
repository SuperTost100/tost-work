# Tost Work stack

Decided with Tost on 2026-10-25, after the [V1 scope](v1-scope.md). Tost Work is built fresh on Tost's own cli-funnel, and T3 Code is used as a source of ideas, not of code.

## Decisions

| Area | Choice | Why |
| --- | --- | --- |
| Base | A new app on [cli-funnel](https://github.com/SuperTost100/cli-funnel), Tost's library | It already covers sign-in, updates, resume and stop, approvals, instructions for each provider, access levels and Windows process handling. Forking T3 Code would bring about 1.6 million lines built for coding (threads, git, worktrees) that change upstream every day. |
| Desktop shell | Electron | cli-funnel is a Node library and Electron runs Node directly. Mac, Windows and Linux builds, updates and the tray are well-trodden. Tauri would need a separate Node process. |
| Interface | React with TypeScript | The mockup's `app.css` becomes the design tokens. There is no component kit, only Base UI's unstyled primitives for menus, dialogs and selects. |
| Skills storage | Standard `SKILL.md` folders in `Documents/Tost Work/Skills` | Participants can see, back up and copy their skills to Claude or Codex, which is what the course teaches. |
| API keys | The same agents (Codex, Claude Code) run with the key | One engine path for everyone, with the same tools and file rules. The course key must be an OpenAI or Anthropic key. |
| Agent tools | Tost Work's own HTTP MCP server | Questions with answer choices, approvals to overwrite or delete, files made and the review work the same on every provider. |

## What T3 Code teaches

T3 Code (MIT) is the model for how the app talks to agents. Its ideas are reused but its code isn't, because its code depends on its own framework (Effect-TS).

- **Instructions:** Codex gets them as `additionalContext`, split under about 4,000 bytes because Codex truncates longer entries. Claude gets them as `systemPrompt` with the `claude_code` preset plus an `append`.
- **Agent tools:** the app serves one HTTP MCP server and attaches it to each session with a per-session bearer token. The token's scope carries which task the session belongs to, so no environment variables are needed.
- **Enforcement:** the rules go into the instruction text and are also enforced through the agent's permission settings, because text alone doesn't stop an agent.
- **Questions and approvals:** each request waits on a pending promise until the user answers in the interface.

## Engine work

### In cli-funnel

These are Tost's to build, as cli-funnel releases that Tost Work then depends on:

- [#126](https://github.com/SuperTost100/cli-funnel/issues/126) attach an app's HTTP MCP server below `full`, on Claude and Codex;
- [#127](https://github.com/SuperTost100/cli-funnel/issues/127) normalised plan events;
- [#128](https://github.com/SuperTost100/cli-funnel/issues/128) normalised file-change events with path and kind;
- [#129](https://github.com/SuperTost100/cli-funnel/issues/129) approval decisions with a message and updated input;
- [#130](https://github.com/SuperTost100/cli-funnel/issues/130) Codex and Claude Code with an API key;
- [#131](https://github.com/SuperTost100/cli-funnel/issues/131) CI on macOS and Windows;
- [#132](https://github.com/SuperTost100/cli-funnel/issues/132) native agent questions, lower priority.

### In Tost Work

- [#16](https://github.com/SuperTost100/tost-work/issues/16) installing Codex and Claude Code from first-run setup, built by another agent.
- The MCP server with the Tost Work tools.
- The instruction block for each session.

cli-funnel 0.5.1 already has Claude's permission rules and extra folders, an MCP config at `full`, tool calling for the API providers, and persistent sessions.
