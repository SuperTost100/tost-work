# Tost Work design spec, draft

This is the visual system shown in [UI round 4](ui-4/index.html). It's calm like the Claude desktop app, and it carries tost.one's identity: paper, ink and taupe, Schibsted Grotesk, the T logo, and the small mono status tags from the site. Status: draft until Tost approves round 4.

## Principles

- **Few boxes.** Lists are plain rows divided by hairlines, as in Claude and Craft. Boxes are reserved for the composer, the document preview and notices.
- **Real things instead of decoration.** Files show as page thumbnails. The home image is a real document waiting for review, drawn as the tilted card from tost.one.
- **The composer stays clean.** It holds only the text, attach, dictate and send. The project and model sit under it as plain text.
- **State is written, not signalled.** There are no pulsing dots or coloured rules. A status is a short mono tag, and the tag turns ink-black when the user has to act.

## Colour

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | `#FAF8F4` | `#22201D` |
| Sidebar | `#F3F0EA` | `#1B1917` |
| Panel (notices, bubbles, tags) | `#EFEBE3` | `#2C2925` |
| Paper (composer, pages) | `#FFFFFF` | `#2A2723` |
| Line, hairline | `#E6E1D8`, `#EEEAE3` | `#36322D`, `#2F2B27` |
| Ink, text 2, text 3 | `#1B1712`, `#57504A`, `#807769` | `#EEEAE3`, `#B7AFA4`, `#8E8679` |
| Taupe | `#9C8B73` | `#B9A88F` |
| Needs you (text only) | `#9A5B0B` | `#E3A452` |

The primary button is ink: dark on light, paper on dark. There is no accent colour.

## Type

- Schibsted Grotesk for everything, as on tost.one.
- Page titles 26 to 30px at weight 700 to 800, letter-spacing -0.025em.
- Body 14 to 15px. Meta 12.5 to 13px in text 3.
- IBM Plex Mono 500 at 11px only for status tags, also as on tost.one.

## Shape

- Radii: tags 4px, buttons and rows 8px, composer and cards 14 to 16px.
- Borders and hairlines first. A soft shadow appears only under real paper: the composer, page previews and the home card.
- The sidebar is 248px and holds the traffic lights, the logo and wordmark, search, navigation, recent tasks and the user.
- The content column is 720px wide.
- Icons: Phosphor regular at 17px, in text 2.

## Banned

- Coloured left rules and pulsing live dots.
- Icons inside rounded-square tiles.
- Settings pickers inside the composer bar.
- Status dots on every row.
- Captions where the UI narrates itself.
- More than one dark button in a group.
- An ink button on a destructive action.
