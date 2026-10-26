import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

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

/** An agent's message, with its paragraphs, lists and bold. */
export function AgentMessage({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => messageHtml(text), [text]);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div className="agent" ref={ref} />;
}
