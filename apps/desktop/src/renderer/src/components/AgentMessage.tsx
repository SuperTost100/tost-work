import DOMPurify from "dompurify";
import { marked } from "marked";
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import { sentText } from "../../../shared/jobText";

/** Simple Markdown to safe HTML: line breaks are kept, and links stay as their text, since a click would open them inside the app. */
export function messageHtml(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  // Only text formatting, and no attributes: nothing in a message can load a resource or style itself.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "hr",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [],
  });
}

/**
 * A message as plain text, for pastes that take no formatting: paragraphs apart, list items on their own lines, and
 * no Markdown marks.
 */
export function messagePlain(html: string): string {
  const box = document.createElement("div");
  box.innerHTML = html;
  for (const br of Array.from(box.querySelectorAll("br"))) br.replaceWith("\n");
  return blocksOf(box, "").join("\n\n");
}

/** Elements that start a block of their own; everything else is text within a line. */
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "PRE", "UL", "OL", "TABLE", "HR", "LI"]);

/** The blocks inside `parent` as plain text. Lists nested at `indent` get it in front of each item. */
function blocksOf(parent: Node, indent: string): string[] {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim()) out.push(line.trim());
    line = "";
  };
  for (const node of Array.from(parent.childNodes)) {
    if (!(node instanceof Element)) {
      line += node.textContent ?? "";
      continue;
    }
    if (!BLOCK_TAGS.has(node.tagName)) {
      line += node.textContent ?? "";
      continue;
    }
    flush();
    if (node.tagName === "UL" || node.tagName === "OL") out.push(listOf(node, indent));
    // Code keeps its own spacing, indentation included.
    else if (node.tagName === "PRE") out.push((node.textContent ?? "").replace(/\n$/, ""));
    else if (node.tagName === "TABLE")
      out.push(
        Array.from(node.querySelectorAll("tr"))
          .map((tr) =>
            Array.from(tr.children)
              .map((cell) => cell.textContent?.trim() ?? "")
              .join("\t"),
          )
          .join("\n"),
      );
    else if (node.tagName !== "HR") out.push(...blocksOf(node, indent));
  }
  flush();
  return out;
}

/** A list, an item per line: "1." or "-" in front, and items of a list inside an item indented under it. */
function listOf(list: Element, indent: string): string {
  const items = Array.from(list.children).filter((li) => li.tagName === "LI");
  const inner = `${indent}   `;
  return items
    .map((li, i) => {
      const [first = "", ...rest] = blocksOf(li, inner);
      const mark = list.tagName === "OL" ? `${i + 1}.` : "-";
      // A nested list comes back already indented; a second paragraph in the item gets the item's indent.
      return [`${indent}${mark} ${first}`, ...rest.map((b) => (b.startsWith(inner) ? b : `${inner}${b}`))].join("\n");
    })
    .join("\n");
}

/** How long the copy button shows its tick, or that the copy failed. */
const COPIED_FOR = 1500;

/**
 * Copies a message. With `html` the copy keeps its formatting where it's pasted, such as bold and lists in Word, and
 * plain text goes along for places that take only text.
 */
export function CopyButton({
  text,
  html,
  at,
  label: named,
}: {
  text: () => string;
  html?: () => string;
  at?: string;
  /** Draws a button with this name instead of the icon alone, such as "Copy the email's text". */
  label?: string;
}) {
  const t = useT();
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  useEffect(() => {
    if (state === "ready") return;
    const timer = setTimeout(() => setState("ready"), COPIED_FOR);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    const plain = text();
    const rich = html?.();
    if (rich && typeof ClipboardItem !== "undefined") {
      const blob = (body: string, type: string) => new Blob([body], { type });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": blob(plain, "text/plain"), "text/html": blob(rich, "text/html") }),
      ]);
    } else await navigator.clipboard.writeText(plain);
    setState("copied");
  };
  const label = t(state === "copied" ? "message.copied" : state === "failed" ? "message.copyFailed" : "message.copy");
  const icon = <Icon name={state === "copied" ? "check" : state === "failed" ? "alert" : "copy-2"} />;
  if (named)
    return (
      <>
        <button type="button" className="btn" onClick={() => copy().catch(() => setState("failed"))}>
          {icon}
          {state === "ready" ? named : label}
        </button>
        {/* The button's own words change too, but only a status gets read out when it happens. */}
        <span className="sr" role="status">
          {state === "ready" ? "" : label}
        </span>
      </>
    );
  return (
    <div className="msg-tools">
      <button
        type="button"
        className="iconbtn"
        title={label}
        aria-label={label}
        onClick={() => copy().catch(() => setState("failed"))}
      >
        {icon}
      </button>
      {at && <SentAt at={at} />}
    </div>
  );
}

/** The day as the clock reads it, ticking over at midnight for every message on screen with one timer. */
const today = (() => {
  const day = () => new Date().toDateString();
  let current = day();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const next = new Date();
    next.setHours(24, 0, 1, 0);
    timer = setTimeout(() => {
      current = day();
      for (const l of listeners) l();
      arm();
    }, next.getTime() - Date.now());
  };
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      // The first message on screen starts the timer, from today as it is now: the day may have changed while none
      // was showing.
      if (listeners.size === 1) {
        current = day();
        arm();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clearTimeout(timer);
      };
    },
  };
})();

/** When a message was sent, beside its copy button: "14:32", or with the day once it's from another one. */
export function SentAt({ at }: { at: string }) {
  const lang = useContext(LanguageContext);
  // Read so the label moves on at midnight: today's "14:32" becomes "ieri 14:32" in a task left open overnight.
  useSyncExternalStore(today.subscribe, today.get);
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  return (
    <time className="sent" dateTime={at} title={when.toLocaleString(lang)}>
      {sentText(lang, when, new Date())}
    </time>
  );
}

/** An agent's message, with its paragraphs, lists and bold. */
export function AgentMessage({ text, at }: { text: string; at?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => messageHtml(text), [text]);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return (
    <div className="msg">
      <div className="agent" ref={ref} />
      <CopyButton text={() => messagePlain(html)} html={() => html} at={at} />
    </div>
  );
}

/**
 * Characters shown per second: about the pace the AIs write at, a little faster when far behind, so an answer that
 * came all at once types like one being written. By the clock, not per frame, since a Mac's screen may draw 120.
 */
export const typingRate = (behind: number) => Math.min(300, Math.max(120, behind / 3));

/**
 * An answer appearing as it's written, at an even pace whether the words come one at a time or a paragraph at once.
 * It starts at `from` characters: the part already shown while it was still coming in.
 */
export function TypedMessage({
  text,
  from = 0,
  onShown,
  at,
}: {
  text: string;
  /** When it was sent, once it's a message of its own and not an answer still coming in. */
  at?: string;
  from?: number;
  /** Called with how much shows after each step, to follow it down the page. */
  onShown?: (shown: number) => void;
}) {
  const still = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const [shown, setShown] = useState(() => Math.min(from, text.length));
  const end = still ? text.length : shown;
  // Read by the running loop, so words arriving don't restart it and lose its clock.
  const latest = useRef({ shown, length: text.length });
  latest.current = { shown, length: text.length };
  const done = shown >= text.length;
  useEffect(() => {
    if (still || done) return;
    let frame = 0;
    let last: number | null = null;
    // The fraction of a character a short frame leaves over, carried to the next.
    let carry = 0;
    const step = (now: number) => {
      const { shown: at, length } = latest.current;
      if (at >= length) return;
      // A long pause, such as a hidden window, doesn't pour out the backlog at once.
      const seconds = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      const due = carry + seconds * typingRate(length - at);
      const whole = Math.floor(due);
      carry = due - whole;
      if (whole > 0) {
        latest.current = { shown: Math.min(length, at + whole), length };
        setShown(latest.current.shown);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [still, done]);
  useEffect(() => onShown?.(end), [end, onShown]);
  // Whole words only, so none shows half typed.
  const cut = end >= text.length ? end : text.slice(0, end).search(/\S*$/);
  return <AgentMessage text={text.slice(0, cut)} at={at} />;
}
