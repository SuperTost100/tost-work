# What Microsoft will check

This is the Microsoft Store Policies read against Tost Work as it is on `main` at `9da6f22` (0.0.34-dev, with 0.0.35-dev on its way). Four points can fail certification: the `unvirtualizedResources` capability, where reports of AI results go, the installs of Codex and Claude Code, and test access for the reviewers. They come first, and each has the fallback to use if Microsoft says no.

The policies read are **version 7.20, published 2026-09-15, in force since 2026-10-22** ([Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)). The Partner Center pages were read on 2026-11-11 at learn.microsoft.com and in their source repository, [MicrosoftDocs/windows-dev-docs](https://github.com/MicrosoftDocs/windows-dev-docs), last updated 2026-10-14. Policy quotes below are exact.

| Verdict | Meaning |
| --- | --- |
| Met | The app does what the policy asks. |
| At risk | It depends on the reviewer's reading, or on text the submission still has to give. |
| Not met | Certification fails unless something changes or is added to the submission. |

## Likely to fail, most serious first

### 1. Unvirtualized AppData (`unvirtualizedResources`, policy 10.6)

**At risk, the most serious point.**

- **What Microsoft says.** Policy 10.6: "The capabilities you declare must legitimately relate to the functions of your product." The capability page describes `unvirtualizedResources` like this: "This capability is designed for certain types of desktop PC games that are published by Microsoft and our partners. It's also needed for apps packaged with external location [...]. It is not intended to be used for other scenarios, because it could compromise the system's ability to uninstall cleanly." ([App capability declarations](https://learn.microsoft.com/en-us/windows/uwp/packaging/app-capability-declarations#restricted-capabilities)). Restricted capabilities need a written reason in the submission, and "If we don't approve your use of the capability, your submission will fail certification" ([Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#restricted-capabilities)).
- **What the app does.** `apps/desktop/build/appx-manifest.xml` turns off write virtualization for all of AppData and HKCU (`desktop6:FileSystemWriteVirtualization` and `RegistryWriteVirtualization` set to `disabled`), which Windows 10 reads, and lists two folders and one key for Windows 11, which reads the narrower list instead ([Flexible virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)): `%APPDATA%\Tost Work`, `%LOCALAPPDATA%\Programs\OpenAI` and `HKCU\Environment`. The reason is real. Codex and Claude Code run as programs outside the package and read their sign-in and settings from the app's data folder, which the app writes. Without the exclusion, the app's writes land in a private copy the CLIs can't see.
- **Why it's at risk.** Microsoft's own page says the capability isn't meant for apps like this one, and the folders stay behind after an uninstall (policy 10.2.7, point 7 below). Issue #148 says Claude Desktop ships in the Store this way, which I couldn't confirm that from a Microsoft page.
- **What the submission gives.** The reason, in [certification-notes.md](certification-notes.md#restricted-capabilities): which folders, why other programs need them, and that the Windows 11 list is narrow.
- **If Microsoft refuses it.** Virtualization covers only AppData ("Apart from AppData, the app can write to any location where the user has write access", [Flexible virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)). Moving the folders the CLIs share out of AppData, for example to `%USERPROFILE%\.tost-work`, would remove the need for the capability. That's an app change, with a data move for anyone who already installed it.

### 2. Reports of AI results go to OpenAI and Anthropic, not to Tost (policy 11.16)

**At risk.**

- **What Microsoft says.** Policy 11.16 asks apps with live generative AI to "Provide a means for users to report inappropriate content to the developer. You must take appropriate actions based on those reported concerns."
- **What the app does.** "Report this result" sits under every task's side panel (`apps/desktop/src/main/reportResult.ts`). A ChatGPT task sends the report to OpenAI through Codex's own feedback channel. A Claude task opens an email to Anthropic, already written. A task on a course key opens the maker's form or email. Nothing reaches Tost, by his decision of 2026-11-09 (#148): "If certification objects, a copy gets added then."
- **Why it's at risk.** The policy says "to the developer", and Tost Work's developer is Tost. The reasoning for the current design is sound (the maker can act on the model, Tost can't), and the notes explain it, but a reviewer who reads the policy word for word can fail it.
- **What the submission gives.** The explanation in the notes: Tost Work has no server and no content of its own, every answer comes from the user's own OpenAI or Anthropic account, and the report goes to the party that can correct the model. Users can also reach the developer through Settings > Report a problem (a GitHub issue) and the email address in the privacy notice.
- **If Microsoft refuses it.** Add a copy of each report to Tost, as he planned: the card could also open an email to the support address, or send the report to both.

### 3. The app downloads and runs the Codex and Claude Code installers (policies 10.1.5, 10.2.2, 10.2.3, 10.2.4)

**At risk.**

- **What Microsoft says.**
  - 10.2.2: "Your product should not, for example, download a remote script and subsequently execute that script in a manner that is not consistent with the described functionality."
  - 10.2.3: "your product must not offer to install secondary software that is not developed by you and does not enhance the functionality of your product."
  - 10.2.4: "Your product may depend on non-integrated software (such as another product, module, or service) to deliver its primary functionality if you disclose the dependency at the beginning of the description in metadata."
  - 10.1.5 allows, "with user consent", acquiring other products published by you through the Store, and "Add-ons or extensions [...] that enhance the functionality of the product".
- **What the app does.** On Windows, the "Install Codex" and "Install Claude Code" buttons run the vendors' own one-line installers through PowerShell: `irm https://chatgpt.com/codex/install.ps1 | iex` and `irm https://claude.ai/install.ps1 | iex`, with `-ExecutionPolicy Bypass` (`apps/desktop/src/shared/install.ts`, `apps/desktop/src/main/installer.ts`). Nothing installs until the user presses the button, and on Windows the Claude button first shows the card that says Claude isn't confined to the task's folder (`apps/desktop/src/renderer/src/components/AccountRow.tsx`). The row's text is "Codex isn't installed yet. Tost Work installs it for you."
- **Why it's at risk.** This is the exact pattern 10.2.2 names: a remote script, downloaded and run. The defence is that it's the described function and the dependency is disclosed. 10.2.4 fits best: the CLIs are how the app works, and the listing names them in its first lines. Two weaker spots:
  - The button's row doesn't say that the download comes from OpenAI or Anthropic, so the in-app consent is thin. A line such as "Tost Work downloads it from OpenAI with OpenAI's own installer" would close that. It's an app copy change and wasn't made here.
  - `-ExecutionPolicy Bypass` could read as turning off a platform safety feature (10.2: "You will not disable any platform safety or comfort features"). Microsoft's PowerShell page says "The execution policy isn't a security boundary, it's defense in depth", and the Process scope "affects only the current PowerShell session" ([about_Execution_Policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)). The notes say that the switch applies to that one PowerShell process.
- **What the submission gives.** The dependency at the start of both descriptions ([listing.en.md](listing.en.md), [listing.it.md](listing.it.md)) and a paragraph in the notes on what is installed, from where, and when.

### 4. The reviewers need test access (policy 10.3.1)

**Not met until the notes carry test access.**

- **What Microsoft says.** 10.3.1: "If your product requires login credentials, provide us with a working demo account using the **Notes for certification** field." The submission page adds: "If we can't fully test your submission, it may fail certification" ([Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#notes-for-certification)).
- **What the app does.** A task needs a ChatGPT or Claude sign-in, or an OpenAI or Anthropic API key. Without one, setup can finish but no task runs. There's also a sample mode: the package runs the scripted fake engine when `TOST_WORK_ENGINE=fake` is set and the app is started from a command line with its `tost-work.exe` alias (`apps/desktop/src/main/index.ts`). CI's Store job runs the installed package that way on every build (`.github/workflows/package.yml`, "Open the app in its package and run a task").
- **What the submission gives.** The steps for both in [certification-notes.md](certification-notes.md), with a marked placeholder for the key. Sharing a ChatGPT or Claude account with reviewers would break OpenAI's and Anthropic's terms, which the app's own terms repeat (`legal/terms.en.md`, article 3), so a key is the realistic option. Which key to give is Tost's decision: see [the decisions](README.md#decisions-for-tost).

## The rest, in policy order

### 5. Live generative AI disclosed (policy 11.16)

**Met once the submission follows these files.** 11.16 also asks apps to "Disclose the use of live generative AI in the metadata" and "Note the use of live generative AI in Partner Center during the submission process". The second paragraph of each description does the first, and the Properties step ticks "This product incorporates generative AI features", which Microsoft says "is required if your app generates new content dynamically using AI models, whether the models are [...] Provided by third-party AI platforms" ([Product declarations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/product-declarations)). The third point of 11.16, AI content that "complies with all applicable Store Policies", depends on OpenAI's and Anthropic's own safety systems, which apply to every request the user's account makes, and the notes say so.

### 6. Security of an app whose AI runs commands (policy 10.2)

**At risk, depending on the reviewer.** 10.2 says: "Your product must not jeopardize or compromise user security, or the security or functionality of the device". The Store policies have no rule written for AI agents, so this is the general rule. What the app does:

- Codex runs in its own sandbox, limited to the task's folder, with a hook that asks before a file is replaced or deleted (`apps/desktop/src/main/codexHook.ts`, `apps/desktop/src/main/engine/codexGate.ts`).
- Claude Code has no sandbox on Windows. The app says so before the user connects Claude and before the first Claude task (`apps/desktop/src/renderer/src/components/Unconfined.tsx`), keeps Claude's file tools to the task's folder, refuses delete commands and keeps a copy before a known command replaces a file.
- Replaced files keep a copy that can be restored, and deleted files go to the Recycle Bin (`apps/desktop/src/main/guard.ts`).

The notes describe these limits and suggest testing with ChatGPT, where the sandbox applies.

### 7. Clean uninstall (policy 10.2.7)

**At risk.** 10.2.7: "Your product must clearly communicate and enable a user's ability to cleanly uninstall and remove your product from their device." Because of point 1, uninstalling leaves `%APPDATA%\Tost Work`, Codex or Claude Code, and the PATH entries their installers added. The privacy notice (`legal/privacy.en.md`, section 2) says which folder to delete, and the description's "Uninstalling" paragraph says the same in the listing.

### 8. Personal information and consent (policies 10.5.1, 10.5.2)

- **10.5.1, privacy policy: met.** Win32 apps "must always have privacy policies". `legal/privacy.en.md` lists what is kept, what goes to OpenAI and Anthropic, the user's controls and a contact. Its public URL goes in Properties. In Partner Center the answer to "does your product access, collect or transmit personal information" has to be **Yes**, because a task sends the user's files to OpenAI or Anthropic.
- **10.5.2, opt-in consent: at risk, low.** It asks for "opt-in consent" before personal information is sent to a third party, after describing "how the information will be accessed, used or shared", and a way to withdraw it. The user's own sign-in to OpenAI or Anthropic is the consent and signing out withdraws it, but setup's "Connect an AI" step doesn't say what a task sends or link the privacy notice, which is only under Settings > About. One sentence and a link in that step would make this solid. It's an app change and wasn't made here.

### 9. Startup task and Windows settings (policy 10.2.8)

**Met.** 10.2.8 asks for "supported methods" and "user consent to change any user's Windows settings". The package's startup task is declared in the manifest with `Enabled="false"` and turned on only by the "Open Tost Work when you log in" switch in setup or Settings, which is off by default (`openAtLogin: false` in `apps/desktop/src/shared/model.ts`), through Windows' StartupTask API (`apps/desktop/src/main/startupTask.ts`, `apps/desktop/build/startup-task/StartupTask.cs`). The PATH changes come from the Codex and Claude Code installers, after the user pressed Install.

### 10. Accurate listing, name and keywords (policies 10.1, 10.1.1, 10.1.3, 11.2)

**Met if the listing files are used as written.**

- 10.1.3 says keywords must "Not use other product titles unless those products are also published by you", so the keywords leave out ChatGPT, Claude, Codex and OpenAI.
- 10.1.1 says the product name "must not contain marketing or descriptive text", and "Tost Work" doesn't.
- The descriptions name ChatGPT, Claude, OpenAI and Anthropic only to say what the app needs, and the copyright line says the app isn't affiliated with them (11.2).
- 10.1.1 also asks the metadata to state "any important limitations": the need for an account or key, and Windows 10 version 2004 or later on 64-bit Intel or AMD, are in the description.

### 11. A test build in front of reviewers (policies 10.1.2, 10.1.4)

**At risk, low.** Microsoft's certification FAQ advises: "Ensure your app is complete and free of placeholders or broken features", and the notes page says "Apps that appear to be incomplete may fail certification" ([Get your app certified](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-your-app-certified), [Submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#notes-for-certification)). A `-dev` build opens with a card that says "This is a test build" and that "something may not work". Every section works in 0.0.34-dev: I found no "later version" screen reachable from the sidebar. The notes say the build is for a private group of testers.

### 12. Age rating and content (policies 11.1, 11.11)

**Met if the questionnaire is answered as [submission.md](submission.md#5-age-ratings) suggests.** 11.11.3 asks apps whose content "might be appropriate for a higher age rating than its assigned rating" to let users opt in "by signing in with a pre-existing account". Tost Work's AI content only exists after the user signs in with their own OpenAI or Anthropic account, or enters their key. 11.1 limits the metadata (listing texts and screenshots) to PEGI 12 or lower, which they are.

### 13. Localization (policy 10.7)

**Met.** The package declares `it-IT` and `en-US` (`apps/desktop/electron-builder.yml`), the app is complete in both, and there's a listing for each language.

### 14. Account type (policy 10.14)

**Met, as Tost decided.** 10.14: "Company accounts must be used for organizations, businesses, and any person acting in relation to their trade or profession." Tost chose an individual account on 2026-11-09 (#148). The app is free, has no business behind it and the publisher name "Tost" doesn't read as a company.

### 15. Usability and devices (policies 10.4.1, 10.4.2)

**Met as far as CI shows.** The package targets `Windows.Desktop` from 10.0.19041.0 (Windows 10 version 2004), x64 only, so the Store offers it only to PCs that can run it. CI installs the package on `windows-latest`, opens it and runs a task on the fake engine. Running Microsoft's [Windows App Certification Kit](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit) on the package before submitting would catch technical failures early. It hasn't been run.

### Not applicable

- 10.2.1 (browsers), 10.2.5 and 10.13 (games), 10.2.6 (cryptocurrency) and 10.2.9 (installers submitted as a link): not this app.
- 10.8 (financial transactions) and 10.10 (ads): the app sells nothing and shows no ads. People pay OpenAI or Anthropic directly, outside the app.
- 10.9 (notifications): the policy covers notifications sent through Windows Push Notification Service. Tost Work's notifications are local, follow Windows' notification settings and can be turned off in Settings.
- 11.12 (user-generated content): nothing a user writes is shown to other users.
