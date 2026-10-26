---
name: pdf
description: Make a PDF that the user can send or print. Use when the user asks for a PDF, a final copy, something to send that shouldn't be edited, or a printable version of a Word, Excel or PowerPoint file.
---

# PDF files

A PDF is a final copy: people send it, print it and don't edit it. Tost Work makes PDFs from Word, Excel and PowerPoint files with its `make_pdf` tool, so you never need to write PDF code.

## Making a PDF

1. Make the content as the right Office file first, following the Word, Excel or PowerPoint guide: a document as `.docx`, a table as `.xlsx`, slides as `.pptx`.
2. Check that file as its guide says, because the PDF shows exactly what's in it.
3. Call `make_pdf` with the file's full path. Tost Work saves the PDF next to it, with the same name, and tells you its path. If a PDF with that name exists, the new one gets a number instead of replacing it.
4. Tell the user where the PDF is. Leave the Office file there too: it's the copy they can still change.

For a PDF of a file the user gave you, call `make_pdf` on that file directly.

## Things to know

- Word pages keep their size, slides become one page each, and a workbook prints across A4 pages.
- Fonts that come with Office, such as Calibri and Cambria, are replaced by fonts with the same letter widths, so lines break where Word breaks them.
- Don't make a PDF unless the user asked for one: an editable Office file is the default.
