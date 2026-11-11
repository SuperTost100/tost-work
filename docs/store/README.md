# Microsoft Store submission

Everything needed to send Tost Work's first Microsoft Store submission from Partner Center, to a private audience of testers. It follows Tost's decisions in [#148](https://github.com/SuperTost100/tost-work/issues/148): Store only, an individual account, identity `Tost.TostWork`, a private audience first and a public listing from 0.1.0-alpha.

## Use the files in this order

1. [policy-check.md](policy-check.md): what Microsoft will check, against the app as it is, with the four points that could fail certification first.
2. [The decisions below](#decisions-for-tost), which only Tost can make.
3. [submission.md](submission.md): the Partner Center steps, one action each, from the group of testers to Submit and what follows.
4. [listing.en.md](listing.en.md) and [listing.it.md](listing.it.md): the Store listing texts, with Microsoft's limit for each field.
5. [screenshots/](screenshots/): six screenshots per language, 1440 × 900, in `en/` and `it/`.
6. [certification-notes.md](certification-notes.md): the notes for Microsoft's reviewers and the reasons for the two restricted capabilities, ready to paste.

The build to submit is 0.0.35-dev, Store version `1.0.35.0`. Its package link goes in the table at the top of [submission.md](submission.md#the-build-to-submit).

## Decisions for Tost

Each has my recommendation. The first one blocks the submission.

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | **Test access for the reviewers.** Policy 10.3.1 asks for working credentials, and the app runs no task without an account or a key. | An OpenAI API key made only for the review, in its own OpenAI project with a low monthly budget, revoked once the app passes. Type it straight into Partner Center, never into the repository. The notes also explain the sample mode, which needs no key. A ChatGPT or Claude account can't be shared under OpenAI's and Anthropic's terms. |
| 2 | **Support contact.** | `tommaso.barbera@tost.one`, which the privacy notice and the terms already give. The other option is the GitHub issues page, which is public and needs an account. |
| 3 | **Privacy policy URL.** | `https://github.com/SuperTost100/tost-work/blob/main/legal/privacy.en.md`, or a page on tost.one if you prefer a URL of your own. |
| 4 | **Price.** | Free, as the terms say. |
| 5 | **Markets.** | All markets for the private audience, since only the testers can get it. Before the public release, leave out the countries where neither OpenAI nor Anthropic offers its service. |
| 6 | **Age rating answers that aren't obvious**: questions on content an AI could produce, and on unrestricted internet access. | Yes to the generative AI question, No to unrestricted internet. The table is in [submission.md](submission.md#5-age-ratings). |
| 7 | **Additional license terms.** | The URL of the terms of use (`legal/terms.en.md`, and `terms.it.md` for the Italian listing). Empty means only Microsoft's standard terms apply. |
| 8 | **"Developed by"** on the listing. | `Tommaso Barbera`, the name in About and in the legal texts. It can stay empty: the listing shows the publisher name "Tost" anyway. |
| 9 | **When the testers get it.** | Hold the release and press Publish now yourself after certification passes. |
| 10 | **Two small app changes that lower the risk**, both found in [policy-check.md](policy-check.md). | Make both in the next build, not in 0.0.35-dev: say in the Install row that the download comes from OpenAI or Anthropic with their installer (policies 10.2.2 to 10.2.4), and say in setup's Connect an AI step what a task sends and link the privacy notice (policy 10.5.2). |

## What wasn't verified

- Microsoft doesn't publish the IARC questionnaire, so the age rating answers follow how the questions usually read; check the wording on screen.
- Microsoft's pages give no length limit for the certification notes, so there's a short version in case Partner Center refuses the long one.
- Whether Microsoft approves `unvirtualizedResources` for an app like this one: only the review will tell. Issue #148 says Claude Desktop ships in the Store with it, which I couldn't confirm on a Microsoft page.
- The Windows App Certification Kit hasn't been run on the package.

## About the screenshots

They come from the built app running on Linux with its sample data, the scripted engine the app uses for testing, driven by a throwaway script in the same way as [the screen map's capture](../../apps/desktop/scripts/screen-map/README.md). The window has no Windows title bar, and the folder paths read `/home/giulia/Documents/...`. The sample engine's texts were adapted in a scratch copy of the build, so each set reads in one language: English file names and table headings for the English set, and the steps, the question and the check list translated for the Italian one. The app's own code wasn't changed. The names are the invented ones the repo already uses (Giulia, Studio Bianchi, Alpi Logistica, Ferrari & Figli, Agriturismo La Collina).
