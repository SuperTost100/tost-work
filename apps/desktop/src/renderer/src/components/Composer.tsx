import { type ClipboardEvent, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { withShortcut } from "@/lib/shortcut";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { ATTACH_MAX, BRIEF_MAX } from "../../../shared/model";

/** Files attached to a brief, kept by whoever owns the brief so they survive a trip to another section. */
export interface Attachments {
  files: string[];
  onAdd: () => void;
  /** Files dragged onto the window or pasted into the box. */
  onDropped: (files: File[]) => void;
  onRemove: (path: string) => void;
}

/** The attachments of a box whose files live in `set`: picked, dropped or pasted, each once, up to the most a message takes. */
export const attachments = (
  api: TostWorkApi,
  files: string[],
  set: (update: (prev: string[]) => string[]) => void,
  onError: (err: unknown) => void,
): Attachments => {
  const add = (more: string[]) => set((prev) => [...new Set([...prev, ...more])].slice(0, ATTACH_MAX));
  return {
    files,
    onAdd: () => void api.files.pick().then(add).catch(onError),
    onDropped: (dropped) => void api.files.take(dropped).then(add).catch(onError),
    onRemove: (path) => set((prev) => prev.filter((p) => p !== path)),
  };
};

/**
 * The boxes that take files, newest last. A file dropped anywhere else on the window goes to the newest, the one the
 * user is looking at.
 */
const takers: { current: (files: File[]) => void }[] = [];
const carriesFiles = (e: { dataTransfer: DataTransfer | null }) => e.dataTransfer?.types.includes("Files") ?? false;

/**
 * Lets files dropped anywhere on the window reach the newest box that takes them. Without it Chromium would open the
 * file in the window, in place of the app. Call once, at start.
 */
export function acceptDroppedFiles(doc: Document): void {
  doc.addEventListener("dragover", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = takers.length ? "copy" : "none";
  });
  doc.addEventListener("drop", (e) => {
    // A page that takes files itself, such as Skills, has handled them already.
    if (!carriesFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) takers.at(-1)?.current(files);
  });
  // ⌘V with no text field focused attaches what was copied, as pasting into the box does.
  doc.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    const target = e.target as HTMLElement | null;
    const typing = target?.closest("input, textarea, select, [contenteditable]");
    if (e.defaultPrevented || typing || !files.length) return;
    e.preventDefault();
    takers.at(-1)?.current(files);
  });
}

/** The quiet box from the mockups: text, attach, send. Settings go underneath, never inside. */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  sendLabel,
  disabled = false,
  minHeight,
  children,
  className,
  attach,
  onSaveLater,
  laterLabel,
  laterDisabled = false,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  minHeight?: number;
  /** Shown above the text field, for example the answer choices of a question. */
  children?: ReactNode;
  className?: string;
  /** Without it the attach button stays off. */
  attach?: Attachments;
  /** Saves the brief as a task to start later, next to Send. Without it there's no such button. */
  onSaveLater?: () => void;
  /** What that button says, for example Save changes on a task saved for later. */
  laterLabel?: string;
  /** Turns that button off by itself, for example while there's nothing new to save. */
  laterDisabled?: boolean;
}) {
  const t = useT();
  const tooLong = value.length > BRIEF_MAX;
  // Files alone can be sent, as in a chat app.
  const canSend = !disabled && !tooLong && (value.trim().length > 0 || (attach?.files.length ?? 0) > 0);
  const take = useRef<(files: File[]) => void>(() => {});
  take.current = (files) => {
    if (!disabled) attach?.onDropped(files);
  };
  const takes = Boolean(attach);
  useEffect(() => {
    if (!takes) return;
    const taker = { current: (files: File[]) => take.current(files) };
    takers.push(taker);
    return () => {
      takers.splice(takers.indexOf(taker), 1);
    };
  }, [takes]);
  const [over, setOver] = useState(false);
  const drop = takes
    ? {
        onDragOver: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = disabled ? "none" : "copy";
          setOver(!disabled);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take.current([...e.dataTransfer.files]);
        },
      }
    : {};
  // A file copied in the Finder, or a screenshot copied to the clipboard, pastes as an attachment. Text pastes as text.
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!takes || !files.length) return;
    e.preventDefault();
    take.current(files);
  };
  const classes = ["composer", className, over && "dropping"].filter(Boolean).join(" ");
  return (
    <div className={classes} {...drop}>
      {children}
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        style={minHeight ? { minHeight } : undefined}
        onPaste={onPaste}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter starts a new line, as in chat apps.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
      />
      <div className="in">
        <button
          type="button"
          className="iconbtn"
          title={t("composer.attach")}
          aria-label={t("composer.attach")}
          disabled={disabled || !attach}
          onClick={attach?.onAdd}
        >
          <Icon name="add" />
        </button>
        <span className="atts">
          {attach?.files.map((path) => {
            const name = path.split(/[\\/]/).pop() ?? path;
            return (
              <span className="attached" key={path} title={path}>
                <Icon name="file" />
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  className="x"
                  aria-label={t("composer.remove", { name })}
                  onClick={() => attach.onRemove(path)}
                >
                  <Icon name="close" />
                </button>
              </span>
            );
          })}
        </span>
        {onSaveLater && (
          <button type="button" className="tbtn later" disabled={!canSend || laterDisabled} onClick={onSaveLater}>
            {laterLabel ?? t("composer.later")}
          </button>
        )}
        <button
          type="button"
          className="send"
          title={withShortcut(sendLabel, "Enter")}
          aria-label={sendLabel}
          disabled={!canSend}
          onClick={onSubmit}
        >
          <Icon name="arrow-up" />
        </button>
      </div>
      {tooLong && (
        <p className="toolong" role="alert">
          {t("composer.tooLong", { max: BRIEF_MAX.toLocaleString() })}
        </p>
      )}
    </div>
  );
}
