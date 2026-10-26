---
name: excel
description: Make or edit an Excel workbook (.xlsx) with working formulas, readable formatting and no errors. Use for budgets, price lists, quotes, schedules, trackers and any table of numbers a business user asked for.
---

# Excel workbooks

A workbook is something the user will keep working in, so totals must be formulas and the layout must be clear. Make it with the `officecli` command, never by writing XML yourself.

`officecli help xlsx <element>` lists every property of an element, for example `officecli help xlsx cell` or `officecli help xlsx column`.

## A new workbook

1. Decide the sheets and, for each one, the columns. One table per sheet, starting at A1, with one header row.
2. Create the file and fill it. `batch` writes many cells in one save:

   ```bash
   officecli create "Preventivo.xlsx"
   echo '[
     {"command":"set","path":"/Sheet1/A1","props":{"value":"Fase","bold":"true"}},
     {"command":"set","path":"/Sheet1/B1","props":{"value":"Giorni","bold":"true"}},
     {"command":"set","path":"/Sheet1/C1","props":{"value":"Tariffa","bold":"true"}},
     {"command":"set","path":"/Sheet1/D1","props":{"value":"Totale","bold":"true"}},
     {"command":"set","path":"/Sheet1/A2","props":{"value":"Analisi"}},
     {"command":"set","path":"/Sheet1/B2","props":{"value":"4"}},
     {"command":"set","path":"/Sheet1/C2","props":{"value":"600"}},
     {"command":"set","path":"/Sheet1/D2","props":{"formula":"B2*C2"}}
   ]' | officecli batch "Preventivo.xlsx" --json
   ```

3. Name the sheets after what they hold: `officecli set "Preventivo.xlsx" /Sheet1 --prop name=Preventivo`.
4. Freeze the header row so it stays visible: `--prop freeze=A2` on the sheet.
5. Format numbers, for example `--prop numFmt='#,##0.00'` on a range of amounts, or a euro format for prices.
6. Set the author and a title on `/`, as in Word: `--prop author="…" --prop title="…"`.

## Rules for numbers

- Every total, subtotal, percentage or derived value is a formula (`SUM`, `B2*C2`), never a number you computed yourself. The user will change inputs and expect the totals to follow.
- Put each assumption, such as a daily rate or a VAT percentage, in its own labelled cell, and point the formulas at it instead of repeating the number.
- Keep units in the header ("Prezzo (€)"), not in the cells, so cells stay numbers.

## Editing a workbook that already exists

- Ask with `request_approval` before changing a file that was there before the task.
- Change only the cells the user asked about. Keep their formatting, formulas and other sheets.
- Read before writing: `officecli get <file> /Sheet1/A1:F20` shows values and formulas.

## Before you finish

1. `officecli validate <file>` must say there are no errors.
2. Read the formulas' results back with `get` and check them against the numbers you expect. No cell may show `#REF!`, `#DIV/0!`, `#NAME?` or `#VALUE!`.

Don't run `officecli view <file> issues` on a workbook: it can hang on a formula that refers to itself.
