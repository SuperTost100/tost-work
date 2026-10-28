# Tost Work V1 scope

What 0.0.1 and 0.1.0 contain, agreed with Tost on 2026-10-25. The screens are in the [full mockup](../mockups/app/index.html) and the look is in the [design spec](../mockups/design-spec.md). The stack is decided separately, after this scope.

## Versions

| Version | Who uses it | What it is |
| --- | --- | --- |
| 0.0.1 | Tost | The smallest version that does real work: setup with ChatGPT sign-in, projects, one task from brief to done (live preview and questions included) and quick edit. Every other section is a placeholder. |
| 0.0.x | Tost, then friends in a private alpha | Skills, jobs, the board, Claude and API keys arrive one release at a time. |
| 0.1.0 (V1) | Course participants | Everything below works. Only integrations and the Advanced sections are placeholders. |
| 0.2.0 (V2) | Everyone | Everything works, with Advanced unlocked at the Expert level. |
| 0.3.0 (V3) | Everyone | Advanced is finished. |

The public beta starts at 0.1.0, when this repository goes public after Tost has seen a preview, and a real release comes only after the beta. There's no deadline for any version, 0.1.0 included, because no course is waiting on it.

## Order of work

Agreed with Tost on 2026-10-26, after 0.0.3:

1. The Settings screen: level and sections, AI accounts, language, text size and theme.
2. Claude and an API key, so a trainer can hand out the key for the day.
3. Installing Codex and Claude Code with one button ([#16](https://github.com/SuperTost100/tost-work/issues/16)).
4. The menu bar and keyboard shortcuts ([#45](https://github.com/SuperTost100/tost-work/issues/45)).
5. Internet for tasks ([#44](https://github.com/SuperTost100/tost-work/issues/44)): web search, without asking before each site. Done in 0.0.4.
6. The Skills section.
7. Jobs, with the app staying in the menu bar.
8. The board.
9. The PowerPoint preview, then the Linux and Windows builds.
10. The working animation ([#46](https://github.com/SuperTost100/tost-work/issues/46)), folder snapshots ([#31](https://github.com/SuperTost100/tost-work/issues/31)) and the cleanup of old copies ([#32](https://github.com/SuperTost100/tost-work/issues/32)).
11. The general instructions every task starts with (the AGENTS.md / CLAUDE.md for tasks) and the default skills. Tost writes part of them himself, so they're the last step before 0.1.0.

Changed on 2026-10-27, after testing 0.0.4:

- Research stays on each AI's own web search, which is cheaper and faster than a browser it looks at. A browser built into Tost Work, for everything else, isn't needed for 0.1.0 or 0.2.0. When it comes, it shows live in the task's side panel and has its own profile, and forms, sign-ins and anything that sends or buys ask first. Computer use comes after it, at the Expert level.
- Agents ask their questions in rounds of up to 16, with as many rounds as they need.

Changed on 2026-10-27, after testing 0.0.5:

- Tasks see only what Tost Work gives them: its own instructions, the user's skills in Tost Work and the built-in guides. Codex and Claude Code run with their own settings folders in the app's data, so the user's own instructions, skills, plugins and MCP servers stay out, and the user signs in once more inside Tost Work.
- Skills in 0.1.0: written by hand, imported from a folder or a `.zip`, copied from a built-in guide, with versions and Restore, and the skills each task followed.
- Skills in 0.2.0: switching skills on or off per project, with project-only skills; making one with AI; trying a draft on a file.
- Skills in 0.3.0: making one from a finished task.

Changed on 2026-10-28, after testing 0.0.6:

- A request to think something through or take stock gets its answer in the chat, with an offer to put it in a file. Files come straight away only when the user asks for one.
- A skill's steps are edited formatted, like in Word, and saved as Markdown.
- Restore makes the old version current again instead of adding a new one.
- Jobs:
  - Setup asks whether to open Tost Work at login, and Settings has a switch for it.
  - A run missed while the computer was off happens once when it's back, unless the job says to wait for the next time.
  - A run whose previous one still needs the user, or is still working, is skipped, and the job says why.
  - A run may change the files it made itself, but asks before changing a file from an earlier run, so each run saves its files with the date in the name.
  - Tost Work stays in the menu bar (the notification area on Windows and Linux) while a job is on, with a switch in Settings; otherwise closing the window quits as before.
- Notifications, for tasks and jobs alike, while Tost Work isn't in front: "needs you", "failed" and "finished" each have none, quiet or normal in Settings. Setup asks one question for all of them.

Changed on 2026-10-28, after testing 0.0.7:

- The menu-bar icon (the tray on Windows and Linux) is there whenever Tost Work runs, job or not. Closing the window leaves the app running there unless that's turned off in Settings. This replaces "while a job is on" above.
- A click on the icon opens a panel: what needs the user, what's working, the next job runs, New task, and Open, Settings and Quit. A right-click keeps the short menu. Linux trays don't report clicks, so Linux has the menu only.
- Opening at login shows only the icon by default; Settings can make it open the window too.
- An answer that stays in the chat skips the check against the brief, and the agent's words appear as it writes them.
- Projects get a menu: rename, edit instructions, show the folder, remove from Tost Work (its folder and files stay).
- A job's files go in the project folder, or in a folder of the project the user picks.

## From 0.2.0

- AI renames tasks from their brief, so a task from a long paste gets a short title.
- The Skills parts above.

## After 0.2.0

- The browser and computer use, above.
- From 0.3.0: compacting a long task's context automatically, so it can run past the model's context window.

## What works in 0.1.0

- **Work home:** the composer, needs-you notices, recent tasks and the first-day version with starter tasks.
- **Tasks:** brief, plan, live preview of the document, questions with answer choices, and a review against the brief at the end.
- **Projects:** a folder with instructions, skills, jobs and a default model.
- **Skills:**
  - Skills are standard `SKILL.md` folders in `Documents/Tost Work/Skills`, and they work in every project.
  - New skills are written by hand, imported, or copied from a built-in guide (Word, Excel, PowerPoint, PDF), which stay read-only.
  - Each save keeps a version, with an optional note, that Restore can put back.
  - A task lists the skills it followed, and each skill says how many tasks used it.
- **Quick edit:** one file without a project. It works in a temporary folder made for it. The results stay there until the user saves them, and saving asks for a folder every time.
- **Jobs:** cards with a four-step builder, grouped by next run. Each run is a task of its own. Tost Work keeps its icon in the menu bar whenever it runs, and closing the window leaves it there unless that's turned off in Settings.
- **Notifications:** for work that needs the user, failed or finished, each set to none, quiet or normal.
- **Board:** a list grouped by status, with columns as an option.
- **Settings:** the four levels, a switch for each section, AI accounts, language, text size and theme.
- **First-run setup and About.**

Integrations and the Advanced sections (agents working together, code tab) show as placeholders that say which version they arrive in.

## AI accounts

- Beginner and Intermediate see three ways to connect: a ChatGPT subscription through Codex, a Claude subscription through Claude Code, and an API key, which covers the course key for the day.
- Expert also sees every other provider cli-funnel supports: Cursor Agent, Antigravity, Gemini and Anthropic API keys, Ollama and any OpenAI-compatible server.
- Setup installs Codex and Claude Code with one button, so nobody needs a terminal. The install step goes into cli-funnel, so other apps can use it too.

## Platforms

| Version | Platforms |
| --- | --- |
| 0.0.1 | Mac, unsigned for now |
| 0.0.x | Mac and Linux |
| 0.1.0 | Mac, Linux and Windows |

The app keeps its icon in the menu bar (Mac) or tray (Windows, Linux) whenever it runs, and stays there when the window is closed, so jobs run while the computer is on; a switch in Settings turns staying off. A job missed while the computer was off runs once when it wakes up, unless the job says to wait for the next time.

## What agents may do

Below the Expert level these rules are fixed. Expert can loosen them through cli-funnel's access levels.

1. Agents work only inside the project folder, or inside the temporary folder of a quick edit.
2. Overwriting a file asks first, through a "Needs you" card.
3. Deleting files asks first in the same way, listing the files. Approved deletions go to the system Trash, never straight to erasure.
4. Editing an original always keeps a copy that can be restored.

Each rule is written in the agent's instructions and also enforced through the agent's permission settings, because text alone doesn't stop an agent.

## What agents are told

Every session starts with an instruction block from Tost Work. It says:

- that the agent runs in Tost Work for a non-technical user;
- the project folder and the project's instructions;
- the user's language;
- the user's skills, and the built-in guides for Word, Excel, PowerPoint and PDF;
- the rules above;
- the Tost Work tools it can use.

Tost Work gives agents its own tools through a small local MCP server: ask the user a question with answer choices, request approval to overwrite or delete, report the files made, and write the end-of-task review. The way T3 Code passes instructions and its MCP server to Codex and Claude is the model to follow. The ideas are reused, but not its code.

## File previews

| Type | Library |
| --- | --- |
| Word | `docx-preview` (Apache 2.0) |
| Excel | SheetJS CE 0.20 or later, taken from cdn.sheetjs.com because the npm copy has two known security holes |
| PDF | `pdf.js` (Apache 2.0) |
| Markdown, text, CSV, images | built-in rendering |
| PowerPoint | to be chosen by test, see below |

For PowerPoint, `@silurus/ooxml` (MIT) and `@aiden0z/pptx-renderer` (Apache 2.0) get tested on about 15 decks the agents actually produce, and the better one is adopted and finished. If neither is good enough, PowerPoint shows the file name and an Open button until a later version. LibreOffice is used only when it's already installed.

## Privacy and data

- Everything stays on the computer: no Tost Work account and no telemetry in the alpha.
- Keys and sign-ins are kept in the system keychain.
- Optional crash reports may come later, opt-in only.

## Languages

The interface ships in Italian and English. Setup takes the language from the system, and it can be changed in Settings.

## Releases

Alpha builds are GitHub pre-releases on this private repository, downloaded by hand. The app starts updating itself at 0.1.0, when the repository goes public, because an app can't fetch updates from a private repository without carrying a GitHub token inside it.
