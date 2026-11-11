# Store listing: English (United States)

The texts for the **English (United States)** Store listing in Partner Center. Each field is in its own block, ready to paste, with Microsoft's limit next to it ([Store listing info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info), [additional information](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information), [screenshots](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)). All fields are plain text.

The description starts with the two things the policies want first: the programs the app depends on (policy 10.2.4) and the live generative AI (policy 11.16). The keywords leave out other products' names, which policy 10.1.3 forbids.

## Product name

Comes from the package and the reserved name: **Tost Work**.

## Short description

Limit 1,000 characters, and Microsoft advises under 270, because some views show only those. This one is 193.

```text
A desktop app for doing everyday work with AI on your own files. Pick a project folder and say what you need: the AI does it there, asks when it isn't sure, and shows you every file it changed.
```

## Description

Limit 10,000 characters. This one is about 4,200.

```text
Tost Work needs a ChatGPT or Claude subscription, or an OpenAI or Anthropic API key. It does the work through OpenAI's Codex CLI or Anthropic's Claude Code, which run on your PC. If they aren't installed, Tost Work offers to install them with OpenAI's and Anthropic's own installers when you connect your account.

Tost Work uses live generative AI. The answers and files a task produces are written by ChatGPT or Claude while the task runs, and they can contain mistakes, so check them before you use them. If a result is offensive or harmful, "Report this result" under the task sends a report to OpenAI or Anthropic.

ChatGPT and Claude can already do real work on documents, spreadsheets and presentations, but their work modes change often and expect you to think like a programmer. Tost Work puts that work in a plain desktop app: every task happens inside a project folder, the result is a Word, Excel or PowerPoint file you can open, and nothing is overwritten or deleted without asking.

WORK IN A PROJECT
A project is a folder you already use, such as client proposals. Write what you need and attach files. The AI makes and changes files in that folder only, and it also reads your attachments, your skills and the built-in guides to do the work. It saves Word, Excel, PowerPoint and PDF files where they fit, and answers in the chat when you asked a question.

ANSWER ITS QUESTIONS
When the AI needs a decision, it asks up to 16 questions at once, each with ready answers and room for your own, and keeps going when you reply.

CHECK WHAT CHANGED
Every task ends with the files it made or changed, a preview of each one, and a check against what you asked. A replaced file keeps its previous version, which you can restore with one click. Deleted files go to the Recycle Bin.

EDIT ONE FILE QUICKLY
Drop a file and say what to change. The work happens in a temporary folder, and you choose where to save the result.

TEACH IT YOUR WAY OF WORKING
Skills are written instructions the AI follows, such as how your company writes quotes. Write them in a formatted editor, import them from a folder or a .zip file, or start from the built-in guides for Word, Excel, PowerPoint, PDF and email. Each skill keeps its versions.

SCHEDULE WORK
Jobs run a request on a schedule, such as a weekly summary of new files. Tost Work stays in the notification area so they run on time, and a run missed while the PC was off happens once when it's back.

SEE EVERYTHING ON ONE BOARD
The Board lists every task: what needs you, what's working, what's saved for later and what's done.

CHOOSE HOW MUCH TO SEE
Setup asks how you use AI today, from Beginner to Expert, and shows the sections that fit. Every section can be turned on or off in Settings. Each task says which model it uses, and you can pick Fast, Balanced or Thorough, or a specific model.

YOUR DATA
Tost Work has no account, no server of its own and no telemetry. Your projects, tasks and settings stay on your PC, and API keys are encrypted with Windows' secure storage. Running a task sends your request, your attachments and the files the AI reads to OpenAI or Anthropic, under their privacy policies and your account's settings. Tasks count against your plan or your key. Tost Work itself is free and open source (MIT licence).

BEFORE YOU START
- Windows 10 version 2004 or later, or Windows 11, on a 64-bit Intel or AMD PC.
- An internet connection while a task runs.
- On Windows, Claude Code doesn't yet keep its commands inside the task's folder. Tost Work explains this before you connect Claude. ChatGPT stays inside the folder.

UNINSTALLING
Uninstalling Tost Work leaves its data folder, %APPDATA%\Tost Work, and Codex or Claude Code if it installed them. To remove everything, sign out in Settings first, uninstall the app, then delete that folder and uninstall Codex or Claude Code as OpenAI or Anthropic describe.

Tost Work is in Italian and English, with light and dark themes. It's still in testing, so some things may change from one version to the next.

Tost Work isn't made or endorsed by OpenAI or Anthropic. ChatGPT, Codex, Claude and Claude Code are trademarks of their owners.
```

## What's new in this version

Limit 1,500 characters. **Leave it empty for the first submission**: Microsoft says "If this is the first time you're submitting your app, leave this field blank." Use this text, updated, from the second submission on.

```text
The first version in the Microsoft Store, for a small group of testers. Tost Work is still in testing: please report what doesn't work from Settings > Report a problem.
```

## Product features

Up to 20, at most 200 characters each. Partner Center adds the bullets.

```text
Work in a project folder: the AI makes and changes files there only
Word, Excel, PowerPoint and PDF files you can open
Questions with ready answers when the AI needs a decision
A preview of every file a task made or changed
A check of each result against what you asked
Asks before replacing or deleting a file, and keeps the earlier version
Quick edit: drop one file and say what to change
Skills: your own instructions, plus built-in guides for Office files and email
Scheduled jobs, such as a weekly summary
A board with every task and what needs you
Uses your ChatGPT or Claude subscription, or an OpenAI or Anthropic API key
Report an AI result to OpenAI or Anthropic from the task
Italian and English, light and dark themes
No account and no telemetry
```

## Screenshots

Upload under **Desktop**, in this order, from `screenshots/en/`. Each is 1440 × 900 PNG (minimum 1366 × 768, at most 10, captions up to 200 characters). They were taken on Linux with the app's sample data, so the window has no Windows title bar.

| File | Caption |
| --- | --- |
| `01-home.png` | Home: write what you need, pick the project, and see what's waiting for you. |
| `02-task-working.png` | A task at work: its steps, and what the AI is reading and writing. |
| `03-task-question.png` | When the AI needs a decision, it asks with ready answers. |
| `04-task-done.png` | A finished task: its files, a preview, and a check against what you asked. |
| `05-replace-file.png` | Before a file is replaced, Tost Work asks and keeps a copy. |
| `06-skills.png` | Skills: your own instructions, next to the built-in guides. |

## Keywords

Up to 7 keywords, at most 40 characters each and 21 words in all. These are 7 keywords and 9 words.

```text
AI assistant
documents
spreadsheets
presentations
office work
proposals
reports
```

They leave out Word, Excel and PowerPoint as well as ChatGPT and Claude: policy 10.1.3 forbids "other product titles unless those products are also published by you".

## Copyright and trademark info

Limit 200 characters. This one is 146.

```text
© 2026 Tommaso Barbera. Not affiliated with OpenAI or Anthropic. ChatGPT, Codex, Claude and Claude Code are trademarks of their respective owners.
```

## Additional license terms

Up to 10,000 characters, or a single URL, which the Store shows as a link. Empty means the Store's Standard Application License Terms apply alone. **Tost to confirm.**

```text
https://github.com/SuperTost100/tost-work/blob/main/legal/terms.en.md
```

## Developed by

Limit 255 characters. It's optional, and the listing shows the publisher name, "Tost", in any case. **Tost to confirm.**

```text
Tommaso Barbera
```
