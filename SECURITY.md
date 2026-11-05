# Security policy

Report security problems privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Please don't open a public issue for them.

## Supported versions

Tost Work is in alpha. Only the latest release gets fixes, so check that the problem still happens there.

## What to report

Tost Work runs AI agents on your computer, with access to the project folders you give it. These count as security problems:

- an agent reading, changing or deleting files outside the folder it was given;
- a task overwriting or deleting a file without asking first;
- an API key or sign-in token leaving the app's encrypted storage, or showing up in logs or exported files;
- a web page, file or agent reply that makes Tost Work run commands or open links on its own;
- anything that lets another program on the computer act through Tost Work.

Problems in the Codex CLI or Claude Code themselves go to OpenAI and Anthropic.

## What happens next

Tost Work is maintained by one person, so a reply can take a few days. Once the problem is confirmed, the fix ships in the next release, and the advisory credits you unless you'd rather it didn't.
