import { useLayoutEffect, useRef, useState } from "react";

/**
 * The longest start of `text` that fits in `width` with a "…" after it, cut back to the last letter so the "…" never
 * follows a space. `measure` gives a string's width; the whole text comes back when it fits.
 */
export function clip(text: string, width: number, measure: (s: string) => number): string {
  if (measure(text) <= width) return text;
  // Where a cut may fall: between whole characters as the reader sees them, so an emoji or an accent stays whole.
  const ends = [
    0,
    ...Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (g) => g.index + g.segment.length,
    ),
  ];
  const cut = (i: number) => `${text.slice(0, ends[i]).trimEnd()}…`;
  let fits = 0;
  let over = ends.length - 1;
  while (over - fits > 1) {
    const mid = (fits + over) >> 1;
    if (measure(cut(mid)) <= width) fits = mid;
    else over = mid;
  }
  return cut(fits);
}

let canvas: HTMLCanvasElement | null = null;

/**
 * A title cut to the width of its box with "…" right after its last letter: the browser's own cut can leave a space
 * before it. Screen readers get the whole title. Give it a class with `.truncate`, which still clips while it measures,
 * and a width that doesn't follow its text (a block, or a flex item that grows), or each cut would make the next one.
 */
export function Clipped({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measureAgain = () => {
      // Not laid out, or no way to measure, as in tests: the whole text, which the CSS clips.
      if (el.clientWidth === 0) return setShown(text);
      canvas ??= document.createElement("canvas");
      const pen = canvas.getContext("2d");
      if (!pen) return setShown(text);
      pen.font = getComputedStyle(el).font;
      // A pixel spare, for the rounding between the canvas and the page.
      setShown(clip(text, el.clientWidth - 1, (s) => pen.measureText(s).width));
    };
    measureAgain();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measureAgain);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);
  if (shown === text)
    return (
      <span ref={ref} className={className}>
        {text}
      </span>
    );
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
