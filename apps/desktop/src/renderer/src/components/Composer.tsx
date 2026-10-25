import type { ReactNode } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

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
