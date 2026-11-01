import type { ReactNode } from "react";
import { Icon } from "@/lib/Icon";
import { withShortcut } from "@/lib/shortcut";
import { useT } from "@/lib/useT";
import { BRIEF_MAX } from "../../../shared/model";

/** Files attached to a brief, kept by whoever owns the brief so they survive a trip to another section. */
export interface Attachments {
  files: string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
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
  const canSend = !disabled && !tooLong && value.trim().length > 0;
  return (
    <div className={className ? `composer ${className}` : "composer"}>
      {children}
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        style={minHeight ? { minHeight } : undefined}
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
