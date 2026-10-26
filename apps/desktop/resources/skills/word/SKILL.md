---
name: word
description: Make or edit a Word document (.docx) that looks professional and opens in Word without warnings. Use for reports, proposals, letters, notes, minutes, outlines and any other document a business user asked for.
---

# Word documents

Business users expect a Word file they can open, edit and send. Make one with the `officecli` command, never by writing the file's XML yourself, and never deliver a `.txt` or `.md` file in its place.

`officecli help docx <element>` lists every property of an element. Look there instead of guessing a name.

## A new document

1. Plan the structure first: a title, a short opening that says what the document is for, then sections with headings. A reader should get the point from the headings alone.
2. Create the file and write the content as Markdown in one step. Headings become Word's real heading styles, lists become Word lists and tables get a header row that repeats on every page:

   ```bash
   officecli create "Proposta Alpi Logistica.docx"
   officecli add "Proposta Alpi Logistica.docx" /body --type markdown --prop markdown="$(cat <<'MD'
   # Proposta per Alpi Logistica

   Questa proposta descrive come ridurre i tempi delle offerte.

   ## Obiettivi

   - Offerte standard pronte in meno di quattro ore
   - Nessun cambio ai gestionali in uso

   ## Tempi e costi

   | Fase | Durata | Prezzo |
   |---|---|---|
   | Analisi | 1 settimana | € 2.400 |
   MD
   )"
   ```

   Use the quoted heredoc as shown (`<<'MD'`), so apostrophes and symbols in the text need no escaping.
3. Set the author, which Tost Work gives you in its instructions, and a title:

   ```bash
   officecli set "Proposta Alpi Logistica.docx" / --prop author="Giulia Rossi" --prop lastModifiedBy="Giulia Rossi" --prop title="Proposta per Alpi Logistica"
   ```

4. Adjust what Markdown can't express with `set` on the element, for example `--prop align=center`, `--prop pageBreakBefore=true` on a heading that should start a page, or `--prop bold=true` on a run.

## Editing a document that already exists

The user's own documents carry their formatting, styles and layout. Keep all of it.

- Ask with `request_approval` before changing a file that was there before the task. Tost Work keeps a copy.
- Replace text in place, which keeps the formatting of the words around it:

  ```bash
  officecli set "Contratto.docx" / --find "Alberto Richene" --replace "Alberto Lichene"
  ```

- Add a paragraph after a given one with `add` and the paragraph's path. Find paths with `officecli view <file> outline` or `officecli get <file> /body`.
- Never rebuild a user's document from scratch to change part of it.

## Writing style

- Write in the user's language, with its typography: Italian uses « » or " " and the euro sign before the amount (€ 2.400).
- Use headings for structure, not bold paragraphs. Use a table when items share the same attributes.
- Keep paragraphs short. A business reader skims.
- Don't put Markdown symbols in the final text: no `**`, `#` or backticks left over.

## Before you finish

1. `officecli validate <file>` must say there are no errors. Fix any it reports.
2. `officecli view <file> outline` shows the headings: check that the structure reads well.
3. `officecli view <file> text` lets you reread the words once for mistakes.
4. `officecli view <file> issues` lists formatting problems. Ignore "missing first-line indent": that's a convention for other languages.

## Things to avoid

- Don't turn on `updateFields`, and don't add fields that point to other files: Word would greet the user with a warning.
- Don't run `officecli refresh` on a document with page-number fields.
- Don't leave the file open in a background process: every command saves and closes it.
