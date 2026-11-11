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
5. Pick a project folder: create an empty folder, for example Documents\Test, and choose it. Skip the notification question or answer it either way.
6. On Home, type a request such as: "Write a one-page Word document that explains how to prepare a team meeting." Press Enter.
7. The task shows its steps while it works. If the AI asks a question, pick an answer. When it finishes, the side panel lists the files it made, with a preview and a check of the result against the request.
8. Ask the same task: "Change the title of the document." The app asks before the AI replaces the existing file, and keeps a copy that "Restore" puts back.
9. Under the task's side panel, "Report this result" shows the report card (described below). Please don't send a report: it reaches OpenAI.

TEST ACCESS
[FILL IN: the test access. For example: "OpenAI API key, valid until <date>, with a spending limit: <key>". Never put a real key in the repository.]

Without a key, the app can also be tried in its sample mode, which replays scripted tasks with sample files and sends nothing anywhere: open a Command Prompt, run
  set TOST_WORK_ENGINE=fake
  tost-work.exe
then complete setup as above, pressing "Skip for now" at the Connect an AI step, and choose a project folder at the last step. Every task then replays a sample run, with a question and a request to replace a file. Our CI runs the installed package this way on every build.

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
The AI works only in the project folder the user chose. Before it replaces or deletes a file, the app asks and keeps a copy the user can restore, and deleted files go to the Recycle Bin. Codex runs in its own sandbox. Claude Code has none on Windows, which the app explains before it is connected and before the first Claude task. Its file tools stay in the task's folder and delete commands are refused.

STARTUP TASK
The package declares a startup task that is off by default. It is turned on only by the "Open Tost Work when you log in" switch in setup or Settings, so scheduled jobs run on time, and it opens the app in the notification area.

PRIVACY
The app has no telemetry. A task sends the user's request and the files it reads to OpenAI or Anthropic through the user's own account. The privacy notice is linked in the listing, in Settings > About and in setup's Connect an AI step, which also says what a task sends.
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

For use only if Partner Center refuses the long notes. It leaves out the safety details and the startup task.

```text
Notes written on [FILL IN: date]. Package 1.0.35.0 = Tost Work 0.0.35-dev, a test build for a private group of testers.

Tost Work is a free, open-source app (github.com/SuperTost100/tost-work) that runs OpenAI's Codex CLI or Anthropic's Claude Code on the user's PC to make and change office files in a folder the user picks. It needs the user's own ChatGPT or Claude account, or an API key.

To test: complete setup, choose "API key from your course", paste the key below, press "Install Codex" (runs OpenAI's official installer, irm https://chatgpt.com/codex/install.ps1 | iex), pick an empty folder, then ask "Write a one-page Word document about preparing a team meeting".

TEST ACCESS: [FILL IN]

Sample mode without a key: in a Command Prompt run "set TOST_WORK_ENGINE=fake" then "tost-work.exe", and press "Skip for now" at the Connect an AI step.

AI content (11.16): answers are generated live by ChatGPT or Claude. "Report this result" under each task sends a report to the model's maker (OpenAI through Codex's feedback channel, Anthropic by email), who can correct the model; users reach the developer through Settings > Report a problem.

Nothing is installed until the user presses Install. The AI works only in the chosen folder, and replacing or deleting a file asks first and keeps a copy.
```
