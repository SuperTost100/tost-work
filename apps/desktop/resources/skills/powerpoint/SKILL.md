---
name: powerpoint
description: Make or edit a PowerPoint presentation (.pptx) with clear slides that open in PowerPoint without a repair prompt. Use for decks, pitches, course slides, meeting presentations and any slides a business user asked for.
---

# PowerPoint presentations

A deck is read from across a room or skimmed in a meeting. Make it with the `officecli` command, never by writing XML yourself.

`officecli help pptx <element>` lists every property of an element, for example `officecli help pptx slide` or `officecli help pptx shape`.

## A new presentation

1. Plan the story first: one idea per slide, and slide titles that state the point ("I tempi scendono da due giorni a quattro ore"), not just a topic ("Tempi").
2. Create the file, then add the slides one by one:

   ```bash
   officecli create "Corso AI.pptx"
   officecli add "Corso AI.pptx" / --type slide --prop layout="Title Slide" --prop title="Corso AI per Città Studi"
   officecli add "Corso AI.pptx" / --type slide --prop layout="Title and Content" --prop title="Tre incontri da tre ore" --prop text="$(printf 'Modelli e strumenti\nLavorare sui propri file\nLa prima skill')"
   ```

3. Use only these layout names: `Title Slide`, `Title and Content`, `Two Content`, `Title Only`, `Blank`. Any other name fails and can leave a broken slide behind, so run `validate` after a failed `add` and remove what it left.
4. Set the author and a title on `/`: `--prop author="…" --prop title="…"`.

## Writing slides

- At most six bullets per slide and about ten words per bullet. Move detail to the speaker notes or a document.
- Every slide has a title. Keep the same layout for slides of the same kind.
- Numbers go in a table or a chart, not in a paragraph.
- Write in the user's language, with its typography.

## Editing a presentation that already exists

- Ask with `request_approval` before changing a file that was there before the task. A file this task made needs no approval: change it directly.
- Keep the user's theme, layouts and slide order unless they asked to change them. Replace text in place with `set … --find … --replace …`.
- Don't duplicate or clone slides that contain charts, groups or video: the current OfficeCLI can produce a file PowerPoint wants to repair. Build a new slide instead.

## Before you finish

1. `officecli validate <file>` must say there are no errors.
2. `officecli view <file> outline` lists the slides with their titles: check that they tell the story in order.
3. `officecli view <file> text` lets you reread every slide for mistakes and text that is too long.
