import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

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
export function CopyButton({ text, html }: { text: () => string; html?: () => string }) {
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
  return (
    <div className="msg-tools">
      <button
        type="button"
        className="iconbtn"
        title={label}
        aria-label={label}
        onClick={() => copy().catch(() => setState("failed"))}
      >
        <Icon name={state === "copied" ? "check" : state === "failed" ? "alert" : "copy-2"} />
      </button>
    </div>
  );
}

/** An agent's message, with its paragraphs, lists and bold. */
export function AgentMessage({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => messageHtml(text), [text]);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return (
    <div className="msg">
      <div className="agent" ref={ref} />
      <CopyButton text={() => messagePlain(html)} html={() => html} />
    </div>
  );
}

/** Characters added per frame: a few, more when far behind, so an answer that came all at once still types quickly. */
const typingStep = (behind: number) => Math.min(24, Math.max(2, Math.ceil(behind / 20)));

/**
 * An answer appearing as it's written, at an even pace whether the words come one at a time or a paragraph at once.
 * It starts at `from` characters: the part already shown while it was still coming in.
 */
export function TypedMessage({
  text,
  from = 0,
  onShown,
}: {
  text: string;
  from?: number;
  /** Called with how much shows after each step, to follow it down the page. */
  onShown?: (shown: number) => void;
}) {
  const still = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const [shown, setShown] = useState(() => Math.min(from, text.length));
  const end = still ? text.length : shown;
  useEffect(() => {
    if (still || shown >= text.length) return;
    const frame = requestAnimationFrame(() => setShown((n) => Math.min(text.length, n + typingStep(text.length - n))));
    return () => cancelAnimationFrame(frame);
  }, [still, shown, text.length]);
  useEffect(() => onShown?.(end), [end, onShown]);
  // Whole words only, so none shows half typed.
  const cut = end >= text.length ? end : text.slice(0, end).search(/\S*$/);
  return <AgentMessage text={text.slice(0, cut)} />;
}
