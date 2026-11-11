# Submit Tost Work in Partner Center

The steps to send the first Store submission of Tost Work, for a private audience, from the name already reserved in Partner Center. Each step is one action. The texts to paste are in [listing.en.md](listing.en.md), [listing.it.md](listing.it.md) and [certification-notes.md](certification-notes.md), and the images are in [screenshots/](screenshots/). A choice marked **Tost to confirm** is my recommendation for a decision that's yours.

> [!IMPORTANT]
> Read the first four points of [policy-check.md](policy-check.md) before you press Submit. They're the reasons this submission could fail, and two of them need text from you (test access) or a decision.

## The build to submit

Fill these in once 0.0.35-dev exists:

| What | Value |
| --- | --- |
| Tost Work version | `0.0.35-dev` |
| Store version in the package | `1.0.35.0` (from `node apps/desktop/scripts/store-version.mjs 0.0.35-dev`, which prints `1.0.35`, and the Store adds the last `.0`) |
| Package file | **[FILL IN: link to the `.appx` from the Package workflow's "Microsoft Store package" job, in the artifact named `tost-work-store-0.0.35-dev-<commit>`]** |

The package is the unsigned `.appx` the CI job uploads, not the test-signed copy it installs. Microsoft signs it: "Your MSIX and AppX packages don't have to be signed with a certificate rooted in a trusted certificate authority when submitting to the Microsoft Store" ([package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)).

## Before you start

1. Download the `.appx` from the link above and unzip the artifact, so you have the `.appx` file itself.
2. Collect the email address of the Microsoft account of each tester, yours included. The private audience is a list of Microsoft accounts, and a tester must be signed in to the Store with that account to see the app ([visibility options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options#private-audience)).
3. Decide what test access to give the reviewers, and have it ready to paste: see [the decisions](README.md#decisions-for-tost).

## 1. Make the group of testers

Microsoft calls this a known user group ([customer groups](https://learn.microsoft.com/en-us/windows/apps/publish/create-customer-groups#known-user-groups)).

1. Sign in to [Partner Center](https://partner.microsoft.com/dashboard).
2. In the left menu, open **Engage** and select **Customer groups**.
3. Under **My customer groups**, select **Create new group**.
4. In **Group name**, type `Tost Work testers`. A group's name can't be changed later.
5. Leave **Known user group** selected.
6. Enter the testers' Microsoft account emails, separated by commas or one per line.
7. Select **Save**.

You can add or remove people at any time without a new submission, and a change takes up to 30 minutes to apply.

## 2. Start the submission

1. Go to **Apps and games** and open **Tost Work**.
2. On the app's overview page, under **Product release**, select **Start submission**. Partner Center creates a draft with every section to fill in ([create an app submission](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission)).

The sections can be done in any order. The steps below follow the order on the overview page.

## 3. Pricing and availability

Source: [set pricing and availability](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/price-and-availability) and [visibility options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options).

1. Open **Pricing and availability**.
2. Under **Markets**, leave **All possible markets**. **Tost to confirm:** with a private audience only your testers can get the app, so the markets matter only at the public release. Before then, it's worth leaving out the countries where neither OpenAI nor Anthropic offers its service, since the app does nothing there.
3. Under **Visibility** > **Audience**, select **Private audience**.
4. Select the group `Tost Work testers`.
5. Leave **Make this product public on** unticked. You'll make it public with a new submission at 0.1.0-alpha.
6. Under **Discoverability**, leave **Make this product available and discoverable in the Store**. With a private audience it applies only to the people in the group.
7. Copy the private link that Partner Center shows for the private audience and keep it for the testers. It's also on the **App identity** page, under "URL if your app is only visible to certain people (requires authentication)".
8. Under **Pricing** > **Base price**, select **Free**.
9. Leave **Free trial** on **No free trial** and leave **Sale pricing** empty.
10. Leave **Organizational licensing** as it is.
11. Select **Save draft**.

> [!WARNING]
> Never send a submission with **Public audience** before 0.1.0-alpha. Microsoft: "If you submit a product with this option set to **Public audience**, you can't choose **Private audience** in a later submission."

What the testers need to know: they open the private link while signed in to the Microsoft Store with the account you listed, on Windows 10 version 1607 or later. Reviews they write are visible to you only and never published, even after the app goes public. Microsoft suggests a feedback channel other than Feedback Hub, where everyone can read; the app's own Settings > Report a problem works.

## 4. Properties

Source: [app properties](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/enter-app-properties), [categories](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/categories-and-subcategories), [support info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info) and [product declarations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/product-declarations).

1. Open **Properties**.
2. Set **Category** to **Productivity**. It has no subcategory.
3. Set **Secondary category** to **Business**, with no subcategory. This one is optional.
4. Under **Privacy policy**, answer **Yes** to whether the product accesses, collects or transmits personal information: a task sends the user's files and requests to OpenAI or Anthropic. Policy 10.5.1 also says Win32 apps "must always have privacy policies".
5. In **Privacy policy URL**, paste `https://github.com/SuperTost100/tost-work/blob/main/legal/privacy.en.md`. The Store uses one URL for every market, and the notice says at its top that it exists in Italian and English, with the Italian prevailing. **Tost to confirm**, or use a page on tost.one if you'd rather have one there.
6. In **Website**, paste `https://github.com/SuperTost100/tost-work`. Microsoft says this must be "a page on your own website, not your app's web listing in the Store".
7. In **Support contact info**, enter `tommaso.barbera@tost.one`, the address the privacy notice and the terms already give. **Tost to confirm.** The other option is the issues page, `https://github.com/SuperTost100/tost-work/issues`, which needs a GitHub account and is public.
8. Leave the phone number and address empty. Microsoft says they're optional for individual developers.
9. Skip **Game settings** and **Display mode**: they don't apply.
10. Under **Product declarations**, tick **This product incorporates generative AI features**. Policy 11.16 asks for it, and Microsoft says it's "required if your app generates new content dynamically using AI models, whether the models are [...] Provided by third‑party AI platforms".
11. Leave **This product allows users to make purchases, but does not use the Microsoft Store commerce system** unticked. Nothing is sold in the app, and people pay OpenAI or Anthropic directly.
12. Leave **This product has been tested to meet accessibility guidelines** unticked. Microsoft asks for testing with Narrator, high contrast and similar tools first, and that hasn't been done.
13. Leave **Customers can install this product to alternate drives or removable storage** ticked.
14. Leave **Windows can include this product's data in automatic backups to OneDrive** ticked.
15. Leave **System requirements** empty. The package already limits the app to 64-bit Windows 10 version 2004 and later.
16. Select **Save draft**.

## 5. Age ratings

The questionnaire comes from the International Age Rating Coalition (IARC). Microsoft says to answer it accurately and that "These ratings are about the suitability of the content in the app, rather than the age of the target audience for your app" ([age ratings](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/age-ratings)). Microsoft doesn't publish the questions, so the wording below comes from how IARC's questionnaire usually reads on other stores and may differ from what you see. Each question has an info icon; read it when an answer isn't obvious.

1. Open **Age ratings**.
2. When asked for an existing IARC rating ID, say you don't have one.
3. For the category, choose the one for utility, productivity, communication or other apps. Not "Game", and not social networking.
4. Answer the questions with the recommendations in the table.
5. Select **Save and generate**.
6. Check the ratings Partner Center shows. If a market refuses the app because of its rating, the message names it, and IARC's certificate email has the appeal link.

| Topic | Recommended answer | Why |
| --- | --- | --- |
| Violence, fear, sexual content, nudity, crude humour, bad language, drugs, alcohol, tobacco, gambling, discrimination | No | The app ships none. It shows the user's own files and the AI's answers to the user's requests. **Tost to confirm** if a question asks about content an AI could produce: then the honest answer is the one in the generative AI row. |
| Users interact or exchange content with other users (chat, voice, sharing) | No | A task is between the user and the AI. Nothing goes to other users. |
| Shares the user's location with other users | No | The app doesn't read the location. |
| Digital purchases, in-app purchases, loot boxes | No | Nothing is sold in the app. |
| Unrestricted internet access, or the app is a web browser or search engine | No | The app has no browser. **Tost to confirm:** the AI can search the web for a task and quote what it finds, but the user never browses. |
| Generative AI, or content generated in response to user input | Yes | The answers and files come from ChatGPT or Claude while the task runs. |
| Lets users share personal information with third parties | Yes, if asked | A task sends the user's files to OpenAI or Anthropic. Answer Yes only if the question covers sending data to a service, not sharing with other users. |

## 6. Packages

Source: [upload app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages).

1. Open **Packages**.
2. Drag the `.appx` file into the upload area.
3. Wait for the package to show **Validated**. If Partner Center shows an error, remove the package and look the message up in [Resolve submission errors](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/resolve-submission-errors).
4. Check the table under **Device family availability**: the package targets `Windows.Desktop`, so only **Windows 10/11 Desktop** is ticked, and the others can't be ticked.
5. Select **Save draft**.

The section may say **Incomplete** even when the package is **Validated**, until every required field is set.

After the upload, the overview page lists the package's languages, English (United States) and Italian (Italy). Keep both.

## 7. Store listings

Source: [Store listing info](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info), [additional information](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-additional-information) and [screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images).

Do these steps once for **English (United States)** with [listing.en.md](listing.en.md) and the images in `screenshots/en/`, then once for **Italian (Italy)** with [listing.it.md](listing.it.md) and `screenshots/it/`.

1. On the overview page, select the language.
2. Check that **Product name** is **Tost Work**.
3. Paste **Description**.
4. Leave **What's new in this version** empty. Microsoft: "If this is the first time you're submitting your app, leave this field blank." The listing files have a text ready for the next update.
5. Paste each **Product feature**, one per field.
6. Under **Screenshots** > **Desktop**, upload the six PNG files in their numbered order.
7. Paste the caption of each screenshot.
8. Under **Store logos**, upload nothing for now. The Store then uses the icon in the package. Microsoft "strongly recommends" a 300 × 300 **1:1 App tile icon**, which can be made from `apps/desktop/build/icon.png` for the public listing.
9. Skip **Trailers** and the **16:9 Super hero art**. Both are optional.
10. Under **Supplemental fields**, paste the **Short description**.
11. Paste the seven **Keywords**, one per field.
12. Paste **Copyright and trademark info**.
13. In **Additional license terms**, paste the terms URL from the listing file. **Tost to confirm:** leaving it empty means the Store's Standard Application License Terms apply alone.
14. In **Developed by**, paste the text from the listing file. **Tost to confirm.**
15. Select **Save**.

The screenshots were taken on Linux with the app's sample data (the scripted engine it uses for testing), so the window has no Windows title bar, and the file paths in them read `/home/giulia/Documents/...`. Each one is 1440 × 900 pixels, above the Store's minimum of 1366 × 768.

## 8. Submission options

Source: [submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options).

1. Open **Submission options**.
2. Under **Publishing hold options**, select **Don't publish this submission until I select Publish now**, so the testers get it when you decide. The default, publish as soon as it passes, works too.
3. In **Notes for certification**, paste the text from [certification-notes.md](certification-notes.md#notes-for-certification), with the test access filled in.
4. Under **Restricted capabilities**, paste the reason for each capability from [certification-notes.md](certification-notes.md#restricted-capabilities). Partner Center lists the capabilities it found in the package: `runFullTrust` and `unvirtualizedResources`.
5. Leave **Submission notification audience** as it is, so the emails come to you.
6. Select **Save**.

## 9. Submit

1. Go back to the app's overview page and check that every section says **Complete**.
2. Select **Submit for certification**.

## What happens after Submit

Source: [the app certification process](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process) and [Get your app certified](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-your-app-certified).

1. **Preprocessing.** The package is queued, and Partner Center shows any error it finds.
2. **Certification.** Microsoft runs a malware scan, the technical tests of the Windows App Certification Kit, and a content review by a person, who reads the notes. Microsoft says the whole step "can take up to three business days", and that the restricted capability review "may add some additional time".
3. **The report.** You get a certification report by email and in Partner Center. A failure names the test or the policy. You fix it and send a new submission. For questions, answer the report email or write to `reportapp@microsoft.com` with the app's ID.
4. **Release.** With the hold from step 8, the submission waits until you select **Publish now** on its status page. Once publishing starts, it can't be cancelled.
5. **Publishing.** Microsoft signs the package with its own certificate. The status changes to **In the Store**, and the listing appears "within 15 minutes" on average, to the people in the group only.
6. **IARC email.** IARC sends a rating certificate once the app is published.

Updates for the testers are new submissions with a higher package version, through the same group. Moving to a public audience at 0.1.0-alpha is a new submission with **Public audience**, which "may go through an additional certification process".
