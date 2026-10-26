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
5. Internet for tasks ([#44](https://github.com/SuperTost100/tost-work/issues/44)): web search first, without asking before each site. A browser comes next, and computer use later at the Expert level.
6. The Skills section.
7. Jobs, with the app staying in the menu bar.
8. The board.
9. The PowerPoint preview, then the Linux and Windows builds.
10. The working animation ([#46](https://github.com/SuperTost100/tost-work/issues/46)), folder snapshots ([#31](https://github.com/SuperTost100/tost-work/issues/31)) and the cleanup of old copies ([#32](https://github.com/SuperTost100/tost-work/issues/32)).

## What works in 0.1.0

- **Work home:** the composer, needs-you notices, recent tasks and the first-day version with starter tasks.
- **Tasks:** brief, plan, live preview of the document, questions with answer choices, and a review against the brief at the end.
- **Projects:** a folder with instructions, skills, jobs and a default model.
- **Skills:**
  - Skills are standard `SKILL.md` folders. They work in every project, and a project can turn some off or add its own.
  - New skills can be written by hand, made with AI, made from a finished task, or imported.
- **Quick edit:** one file without a project. It works in a temporary folder made for it. The results stay there until the user saves them, and saving asks for a folder every time.
- **Jobs:** cards with a four-step builder, grouped by next run.
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

The app stays in the menu bar (Mac) or tray (Windows, Linux) when the window is closed, so jobs run while the computer is on. A job missed while the computer was off runs when it wakes up.

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
