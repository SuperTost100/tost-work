# UX mockup feedback

Tost's verdicts on each mockup round, and what the next round changed because of them. The mockups themselves start at [`index.html`](index.html).

## Round 1, 2026-10-25

| Screen | A · Desk | B · Document | C · Board |
| --- | --- | --- | --- |
| Work home | Liked: simple, likely works | Confusing, not clear what to do | No: a board as home is out of scope |
| Running task | Good, close to ChatGPT's work mode | Neat, like Notion; worth mixing into A | Unclear; you need to focus on a task, especially a finished one |
| Quick edit | Best: it's a chat, which is what quick edit should be | Good, but the diff belongs in a secondary view | Too detached, everything floats in a popup |
| Projects | Simple, maybe good | Too compact to see at a glance | Look good |
| One project | Gives everything at a glance, but a bit technical | Feels like Notion and doesn't help the work | Nothing separate |
| Skills | Easy to see and act on, very good | Editor liked, but takes too much space; SKILL.md as a button was right | Similar to A; mix with B |
| Jobs | Something feels wrong | Bad, hard to read at a glance | Best of the three, still not great |
| Board | Preferred | Not liked | Rows per project are on the right track, but too much of a grid |

The sidebar in A wasn't loved, and none of the directions had good jobs.

## What round 2 changed

- A is the base: work home, quick edit chat, projects grid and skills list.
- The running task keeps A's layout and adds B's live preview of the result. The plan shrinks to a one-line progress strip.
- Finished tasks open on the result, with "Ask for changes", "Save as skill" and "Mark reviewed".
- A Focus button hides the navigation to read a task full width.
- Quick edit stays a chat, and B's track changes are a second tab next to the files.
- One project leads with a composer and the results by file, with the technical details lower down.
- Skills use B's document editor inside A's list, and SKILL.md is a button.
- Navigation has three variants: a lighter sidebar, an icon rail and a top bar.
- Jobs have three variants: a week view with a sentence editor, cards with a four-step builder, and an agenda.
- The board shows columns, with a "By project" view whose quiet projects fold into one line.

## Round 2, 2026-10-25

| Area | Verdict |
| --- | --- |
| Navigation | Sidebar and icon rail together, as one sidebar you collapse. No top bar. |
| Focus button | Not needed, because collapsing the sidebar does the same. |
| Work home | Clean, simple, understood at a glance. |
| Running task | Good, but a Conversation tab on the right plus a box at the bottom is confusing. |
| Done task | The box disappears and there's no way to chat. The review shows the document without saying what to look for. |
| Save as skill | Unclear what gets saved. It should run a skill that turns the task into a skill, in a branch of the task. |
| Quick edit | Good. The changes panel needs per-change accept and reject, like Grammarly, and "Undo one" was unclear. |
| Projects | Fine. Colours and icons belong to the UI round. |
| One project | Easy, close to Claude projects. Unclear whether skills are bound to the project. |
| Skills | The editor is liked, but it used only half the width. |
| Jobs | Cards and builder are the best setup, and the agenda is the best overview. Combine them. Jobs belong to Intermediate and up. |
| Board | Still not liked. Look at Paperclip and Jira. |

## What round 3 changed

- One sidebar with a collapse button that turns it into the icon rail. The top bar and Focus are gone.
- Two places for the chat, switched from the dashed bar: above the only input box, or in a Chat tab with its own box and a badge for questions. Done tasks keep the same box.
- Done tasks open on "Check it against your brief": what you asked with a tick each, what it decided on its own with a Change button, and what's worth checking yourself.
- "Make a skill from this task" opens a draft written by a built-in Skill maker in a copy of the task. It highlights the lines that came from your corrections and points to a similar skill you already have.
- Quick edit lists one card per change with Accept, Reject and alternatives, then saves a copy with the accepted ones.
- The one-project screen says skills are available everywhere unless you turn them off, and a project can add its own. This is open question 1.
- The skill editor uses the full width, with "Try it", availability and versions in a side column.
- Jobs show the cards and the agenda side by side, and the builder opens in place of the agenda.
- The board is a list grouped by Needs you, Running, To do and Done, with quick filters, a Display menu, a side panel for details and a Columns option. It follows Linear and Paperclip.
