# Tost Work design spec, draft

This is the visual system shown in [UI round 3](ui-3/index.html). It follows T3 Code: near-monochrome, one accent that marks where you can act, borders instead of shadows, and the same heights on every panel. Personality is kept to three small details. Status: draft until Tost approves round 3.

## Principles

- **One colour means one thing.** Teal is "you can act here" and "the app is working". Everything else is grey, except state colours.
- **Content is the loudest thing on screen.** The user's document is the only card-like object on a task screen, and its text is slightly larger than the UI around it.
- **One grid.** A 48px header, 32px controls and 40px board rows, repeated on every panel so the eye learns them once.
- **Chrome fades.** Actions show on hover. Glass and shadows appear only on things that float: menus, dialogs, toasts.

## Colour

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | `#F6F6F7` | `#141416` |
| Sidebar | `#F1F1F3` | `#111113` |
| Surface | `#FFFFFF` | `#1C1C1F` |
| Raised (floating only) | `#FFFFFF` | `#232327` |
| Border | `#E4E4E7` | `rgba(255,255,255,.08)` |
| Hairline | `rgba(0,0,0,.06)` | `rgba(255,255,255,.05)` |
| Text 1, 2, 3 | `#18181B`, `#52525B`, `#71717A` | `#ECECEE`, `#A1A1AA`, `#84848D` |
| Accent | `#0F766E` | `#3FB8AB` |
| Accent soft | `#E6F4F2` | `#15302D` |
| Needs you | `#B45309` | `#EDA850` |
| Done | `#3B8C5A` | `#5FB47E` |
| Error | `#B42318` | `#F0716A` |

Running uses the accent. A status is a 6px dot plus a grey label, never a filled pill.

## Type

- Figtree, bundled, with `system-ui` as the fallback. One family and no serif.
- Page title 20px/600, letter-spacing -0.01em.
- Section label 13px/600 in text 2, sentence case.
- Body 14px/400, line height 1.45. Text inside the document preview is 15px.
- Meta 12px in text 3. Buttons and chips 13px/500.

## Shape and layout

- Radii: chips 6px, controls 8px, cards and panels 10px, menus and dialogs 12px.
- Borders, not shadows. The only shadow is on floating layers: `0 8px 24px rgba(0,0,0,.12)`.
- Controls 32px, or 28px when compact. Sidebar rows 32px, board rows 40px.
- Sidebar 240px, header 48px, side peek 360px, task column 736px wide.
- Icons: Phosphor regular, 16px, in text 2.

## The three details

1. **Teal as the one live colour (medium).** It appears on the main button, Send, the focus ring, running dots, the step bar and "Writing now".
2. **The document preview as paper (quiet).** It's the only card on the task screen, with a 1px border, a 10px radius and 15px text.
3. **The attention rule (medium, only when it fires).** A 3px amber left rule on a 7% amber tint, used by question cards and "Needs you" rows.

## Banned

- Serif type and display fonts.
- Glass except on menus, dialogs and toasts.
- Gradient buttons, photo backgrounds and tinted canvases (sage, cream, paper).
- The page as a floating card.
- Dashed borders, caps labels, and shadows on nav items.
- Filled status pills.
- More than one solid accent button in a view.
