import type { ReactNode } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

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
}) {
  const t = useT();
  const canSend = !disabled && value.trim().length > 0;
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
          disabled
        >
          <Icon name="add" />
        </button>
        <span className="grow" />
        <button
          type="button"
          className="send"
          title={sendLabel}
          aria-label={sendLabel}
          disabled={!canSend}
          onClick={onSubmit}
        >
          <Icon name="arrow-up" />
        </button>
      </div>
    </div>
  );
}
