---
name: email
description: Draft an email the user will send from their own mail app. Use for replies, requests, reminders, follow-ups, cover notes for a file, and any message to a client, a colleague or an office.
---

# Emails

People read email on a phone between two other things. Write the draft in your message, ready to copy into the user's mail app. Tost Work doesn't send email, and a Word file only gets in the way, so make one only when the user asks for it.

## The draft

1. Put the subject first, on a line of its own: "Oggetto: …" in Italian, "Subject: …" in English. Say what the email is about and what's needed: "Fattura 112: pagamento scaduto il 15 ottobre".
2. Then the email itself, from the greeting to the signature. Nothing before the subject and nothing inside the email that isn't meant for the reader.
3. Say the point in the first two lines: why you're writing and what you need from them, with a date when there is one.
4. Keep it short: one idea per paragraph, about 150 words unless there's more to cover.
5. Sign with the user's name from their profile. Add a role, a phone number or an address only when the profile or the request gives them.

## The register

The register follows who receives the email, not how you talk to the user.

- A client, a supplier or a public office: formal. In Italian use "Lei", "Gentile signor Ferraris" and "Cordiali saluti".
- A colleague or someone the user already writes to informally: "Ciao Marco" and "tu".
- A reply to an email the user pasted: the same language and register as that email.

## What you don't know

- Never leave placeholders such as [data] or [telefono]. Ask with `ask_user` for what only the user knows, such as a new deadline, or write the email so it doesn't need it.
- When the email goes with a file from the task, name the file in the text and tell the user, after the draft, to attach it.

## Before you finish

- Write plain text: no bold, headings or Markdown symbols inside the email, because it gets pasted into a mail app.
- After the draft, at most one short line: what to check before sending, such as a date you picked, or the file to attach.
- Offer the draft in a Word file only if the user's request suggests they need one.
