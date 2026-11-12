# Notes for certification

The texts for the **Submission options** page in Partner Center, ready to paste. The first block goes in **Notes for certification**, the next two in **Restricted capabilities**, one per capability. Before pasting, replace the test access placeholder and the date, and check the version.

Microsoft's pages give no length limit for the notes field. If Partner Center refuses the long text, paste [the short version](#short-version) instead.

> [!CAUTION]
> Never commit a real key, password or account to this file or anywhere else in the repository. Type the test access straight into Partner Center.

## Notes for certification

```text
Notes written on [FILL IN: date, e.g. 2026-11-12]. Package version 1.0.35.0, which is Tost Work 0.0.35-dev, a test build for a private group of testers.

WHAT THE APP IS
Tost Work is a free, open-source desktop app (MIT licence, github.com/SuperTost100/tost-work) for doing everyday office work with AI on the user's own files. The user picks a project folder and writes a request; the AI makes or changes Word, Excel, PowerPoint and PDF files in that folder, asks when it needs a decision, and shows every file it changed.

Tost Work has no server and no account of its own. The AI work is done by two programs made by others, OpenAI's Codex CLI and Anthropic's Claude Code, running on the user's PC and signed in to the user's own ChatGPT or Claude subscription, or using the user's own OpenAI or Anthropic API key. Without one of these the app opens but can't run a task. The Store description says this in its first lines (policy 10.2.4).

HOW TO TEST IT
1. Install and open Tost Work.
2. Setup: type any name, a few words about your work, and pick a language. Pick any level (Intermediate shows every section).
3. Connect an AI: choose "API key from your course" and paste the key below. ChatGPT is the better choice for testing on Windows, because Codex runs in a sandbox there.
4. Codex isn't installed yet, so the row shows "Install Codex" and says Tost Work downloads it from OpenAI with OpenAI's own installer. Press it. This runs that installer (see below). It takes a minute or two and needs an internet connection.
5. Prepare the project folder: create a folder, for example Documents\Test, and put one file in it that a task will have to replace: a text file called Agenda.txt with a line or two of text, made in Notepad. Choose that folder as the project. Skip the notification question or answer it either way.
6. On Home, type a request such as: "Write a one-page Word document that explains how to prepare a team meeting." Press Enter.
7. The task shows its steps while it works. If the AI asks a question, pick an answer. When it finishes, the side panel lists the files it made, with a preview and a check of the result against the request.
8. Start a new task (not a follow-up on the first one) in the same project: "In Agenda.txt, change the first line to Team meeting, Tuesday." Agenda.txt was in the folder before the task, so before the AI replaces it the app shows the card "The task wants to replace Agenda.txt". Press "Allow overwrite". When the task ends, Agenda.txt is listed with "Earlier version" and a "Restore" button, which puts the old text back. If the AI changes the file with a command the app can't read, there may be no card, and the file is then listed as changed, either with an earlier version to restore or marked "No earlier version".
9. Under the task's side panel, "Report this result" shows the report card (described below). Please don't send a report: it reaches OpenAI.

TEST ACCESS
[FILL IN: the test access. For example: "OpenAI API key, valid until <date>, with a spending limit: <key>". Never put a real key in the repository.]

Without a key, the app can also be tried in its sample mode, which replays scripted tasks with sample files and sends nothing anywhere. Steps 3, 4 and 8 above need a key, so in sample mode follow this instead:
1. Quit Tost Work if it is running. The app opens one copy at a time: a second start only brings the first window forward, and the sample mode is ignored. The first copy may still be running in the notification area after its window is closed. Right-click the Tost Work icon there (it may be under the "^" arrow at the right of the taskbar) and choose "Quit Tost Work". If you can't find the icon, end Tost Work in Task Manager.
2. Open a Command Prompt and run
  set TOST_WORK_ENGINE=fake
  tost-work.exe
3. Complete setup as above, pressing "Skip for now" at the Connect an AI step. Before the last step, make a folder and put in it any file named Proposta.docx. Choose that folder at the last step.
4. Type any request. Every task replays the same sample run, whatever you write: it asks a question and saves two files, Proposta.docx and prezzi.xlsx. Because Proposta.docx is already in the folder, the app shows the card "The task wants to replace Proposta.docx". Press "Allow overwrite" and answer the question. When the task ends, Proposta.docx is listed with "Earlier version" and a "Restore" button. A follow-up in sample mode shows no card, so use a new task each time.
Our CI runs the installed package this way on every build.

LIVE GENERATIVE AI (policy 11.16)
The answers and files a task produces are generated live by ChatGPT or Claude on the user's own account. The Store listing says so in its description, and "This product incorporates generative AI features" is ticked. OpenAI's and Anthropic's own safety systems apply to every request, as they do in their own apps.

REPORTING AI CONTENT
Every task has "Report this result" under its side panel. The user picks what's wrong (offensive, dangerous or illegal, sexual or violent, other) and can add a note. The report goes to the maker of the model, who can act on it:
- a ChatGPT task sends it to OpenAI through Codex's own feedback channel, the same one as Codex's /feedback command;
- a Claude task opens an email to Anthropic's channel for harmful output (usersafety@anthropic.com), already written;
- a task on an API key opens the maker's report form or email.
The task's conversation is attached only if the user ticks the box. Tost Work's developer hosts no content and has no access to the model, so the report goes where the model can be corrected. Users can also write to the developer through Settings > Report a problem, or at the email address in the privacy notice.

INSTALLING CODEX AND CLAUDE CODE
Nothing is installed until the user presses "Install Codex" or "Install Claude Code" in setup or Settings. The button runs the maker's official one-line installer in PowerShell, exactly as the maker documents it:
- Codex: irm https://chatgpt.com/codex/install.ps1 | iex
- Claude Code: irm https://claude.ai/install.ps1 | iex
Both install for the current user only, without admin rights, and check the download's SHA-256. The app passes -ExecutionPolicy Bypass to that one PowerShell process so the documented command can run. It changes no execution policy on the PC. On Windows, the Claude button first shows a card explaining that Claude Code has no sandbox on Windows yet.

SAFETY OF THE AI'S WORK
The AI works in the project folder the user chose. What keeps its commands there depends on the AI:
- ChatGPT (Codex): its commands run in Codex's own sandbox, which lets them write only inside the task's folder and temporary folders. Every step Codex takes first passes a check by the app, and a step that fails the check doesn't run.
- Claude (Claude Code): it asks the app before it writes or deletes a file. On macOS and Linux its commands run in Claude Code's sandbox. On Windows Claude Code has no sandbox yet, so its commands are not confined to the folder: they could read or write elsewhere on the PC. Its file tools stay in the task's folder. The app says all this before the user connects Claude and before the first Claude task.
Before a change to a file that was already in the folder, the app shows a card and keeps the earlier version, which "Restore" puts back. This covers the AI's file tools and the commands the app can read. A command or script that works out its file names as it runs, or that changes files from inside a program, can change a file without a card. When the task ends, the app compares the folder with how it was at the start and lists such a file as changed: with its earlier version when the app had kept a copy before the command, and otherwise marked "No earlier version". It can't compare when the task was stopped or the folder holds too many files. A file it had kept a copy of is then still listed with that earlier version, and any other isn't listed. The comparison covers the task's folder only, so on Windows, where Claude's commands can reach other folders, a file changed outside it isn't listed. Commands that delete files are refused, and a deletion goes through the app's own tool: the user is asked, and the file goes to the Recycle Bin. A script that deletes in a way the app can't read isn't caught.

STARTUP TASK
The package declares a startup task that is off by default. It is turned on only by the "Open Tost Work when you log in" switch in setup or Settings, so scheduled jobs run on time, and it opens the app in the notification area.

PRIVACY
The app has no telemetry. A task sends the user's request and the files it reads to OpenAI or Anthropic through the user's own account. The privacy notice is linked in the listing, in Settings > About, and under the Connect an AI step of setup and at the top of Settings > AI accounts, where the same sentence says what a task sends.
```

## Restricted capabilities

Partner Center asks for one reason per restricted capability it finds in the package. The package declares two.

### runFullTrust

```text
Tost Work is an Electron desktop app (a Win32 app) packaged as MSIX. It runs as a full-trust process, as every packaged Win32 app does, and it starts other Win32 programs the user installed: OpenAI's Codex CLI and Anthropic's Claude Code, which do the AI work, PowerShell to run their official installers, and OfficeCLI, bundled in the package, which reads and writes Word, Excel and PowerPoint files. The package also carries a small helper that turns its startup task on and off through Windows' StartupTask API when the user flips "Open Tost Work when you log in".
```

### unvirtualizedResources

```text
Tost Work runs two programs that are not part of its package: OpenAI's Codex CLI and Anthropic's Claude Code. They read their sign-in, settings and the app's instructions from Tost Work's data folder, %APPDATA%\Tost Work, which the app writes. With AppData virtualized, the app's writes go to a private copy these programs can't see, and no task can run. The user also runs the same CLIs from a terminal, so their install must be where the CLI's own installer put it.

On Windows 11 the manifest lists only what must stay visible:
- %APPDATA%\Tost Work, the app's data folder, read by Codex and Claude Code;
- %LOCALAPPDATA%\Programs\OpenAI, where OpenAI's Codex installer puts Codex;
- HKEY_CURRENT_USER\Environment, where the Codex and Claude Code installers add themselves to the user's PATH.
Windows 10 ignores that list, so the manifest also sets FileSystemWriteVirtualization and RegistryWriteVirtualization to disabled for Windows 10.

The data folder stays after an uninstall. The privacy notice tells users which folder to delete and to sign out first, and the Store description says the same.
```

## Short version

For use only if Partner Center refuses the long notes. It shortens the safety details and leaves out the startup task.

```text
Notes written on [FILL IN: date]. Package 1.0.35.0 = Tost Work 0.0.35-dev, a test build for a private group of testers.

Tost Work is a free, open-source app (github.com/SuperTost100/tost-work) that runs OpenAI's Codex CLI or Anthropic's Claude Code on the user's PC to make and change office files in a folder the user picks. It needs the user's own ChatGPT or Claude account, or an API key.

To test: complete setup, choose "API key from your course", paste the key below, press "Install Codex" (runs OpenAI's official installer, irm https://chatgpt.com/codex/install.ps1 | iex), pick an empty folder, then ask "Write a one-page Word document about preparing a team meeting".

TEST ACCESS: [FILL IN]

Sample mode without a key: quit Tost Work first, including its icon in the notification area, because a second start only brings the first window forward. Then in a Command Prompt run "set TOST_WORK_ENGINE=fake" then "tost-work.exe", press "Skip for now" at the Connect an AI step, and choose a folder that already holds a file named Proposta.docx: the first task asks before replacing it.

AI content (11.16): answers are generated live by ChatGPT or Claude. "Report this result" under each task sends a report to the model's maker (OpenAI through Codex's feedback channel, Anthropic by email), who can correct the model; users reach the developer through Settings > Report a problem.

Nothing is installed until the user presses Install. The AI works in the chosen folder: ChatGPT's commands are confined to it, Claude's are not on Windows (the app says so before Claude is connected). Replacing or deleting a file asks first and keeps a copy for the file tools and the commands the app can read, but a script that works out its file names can change a file without a card. When the task ends, the app compares the task's folder and lists such a file as changed, unless the task was stopped or the folder is too large to compare. Files outside that folder aren't compared.
```
