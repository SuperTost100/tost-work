# Privacy notice

Last updated: 5 November 2026

## 1. Introduction

This notice describes how the Tost Work desktop application (the "App"), published by Tommaso Barbera, a private individual (the "Author"), handles the data of its users (each a "User"). The App collects no data about the User: it has no accounts, no usage statistics and no telemetry, and the Author operates no server that receives the User's data. This notice is drawn up in Italian and in English. In case of any discrepancy, the Italian version prevails.

## 2. Data kept on the User's computer

The App keeps the following information in its data folder:

- settings, projects, tasks with their history, and scheduled jobs;
- what the User writes in the "About you" section;
- copies of the files a task changed, which allow the original to be restored;
- only while the "Show technical details and debug" option is on, the App's log and a detailed log of each task, which contains the text of the User's files and requests;
- the User's API key, encrypted with the operating system's secure storage. If the system offers no such storage, the key is kept only until the App is closed.

The skills the User creates are kept in `Documents/Tost Work/Skills`, and project files remain in the folders where the User keeps them.

The data folder is `~/Library/Application Support/Tost Work` on macOS, `%APPDATA%\Tost Work` on Windows and `~/.config/Tost Work` on Linux (`$XDG_CONFIG_HOME/Tost Work` if that variable is set). Deleting the App, this folder and `Documents/Tost Work` removes all the data the App stored. If the App is set to open at login, the User is advised to turn that option off in Settings first, so that the system no longer tries to start it.

## 3. Data sent to OpenAI and Anthropic

Tasks are carried out by Codex CLI, made by OpenAI, or by Claude Code, made by Anthropic, signed in to the User's account. While a task runs, these programs send OpenAI or Anthropic:

- the User's request, the User's answers to the artificial intelligence's questions and any attached files;
- the files the artificial intelligence reads in the project folder;
- what the User wrote in the "About you" section, which accompanies every task;
- the web searches made by the artificial intelligence.

Codex CLI and Claude Code keep the User's sign-in on the User's computer, in the App's data folder. They may also send OpenAI and Anthropic data about their own use, as they do outside the App.

OpenAI and Anthropic process this data under their own privacy policies and the settings of the User's account, including whether conversations may be used to train their models:

- [OpenAI privacy policy](https://openai.com/policies/privacy-policy/)
- [Anthropic privacy policy](https://www.anthropic.com/legal/privacy)

To access, export or delete the data they hold, or to change training settings, the User may contact OpenAI or Anthropic through their account.

## 4. Data the User shares

- **Feedback:** the "Send feedback" function opens a new issue on GitHub in the browser, with the App's version, the operating system and the language already filled in. The User decides what to add before posting it. Issues on GitHub are public and subject to GitHub's privacy policy.
- **Exported logs:** the "Export logs" function creates a zip archive on the User's computer with the App's logs and a summary of the settings, with keys masked and without the User's name or accounts. If debug was on, the logs contain the text of the User's files and requests. The archive reaches others only if the User sends it.
- **Email:** if the User writes to the Author, the address and message are used solely to reply and are deleted once no longer needed.

## 5. Controller and the User's rights

The Author receives no personal data from the App, and the data kept on the User's computer remains solely at the User's disposal. OpenAI and Anthropic are responsible for the data sent to them, under their respective policies. For emails sent to the Author, the controller is Tommaso Barbera, whom the User may ask for access to or deletion of their data at the address in section 7. The User also has the right to lodge a complaint with the data protection authority of their country, which in Italy is the Garante per la protezione dei dati personali.

## 6. Changes to this notice

The Author may change this notice with a new version of the App. The updated version is distributed with the App and states its date at the top.

## 7. Contact

Tommaso Barbera, tommaso.barbera@tost.one
