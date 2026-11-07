import { Dialog } from "@base-ui/react/dialog";
import signature from "@/assets/signature.svg?url";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { useT } from "@/lib/useT";
import type { Stage } from "../../../shared/model";

type Welcomed = Exclude<Stage, "stable">;

/** The stamp: the stage and its version, "ALPHA · 0.1" for 0.1.0-alpha, "DEV · 0.0.28" for a dev build. */
export const stampOf = (stage: Welcomed, version: string) =>
  `${stage} · ${version.replace(/-.*$/, "").replace(/\.0$/, "")}`;

/**
 * The card that greets someone on Home the first time they open a pre-release stage: what to expect, how to report a
 * problem, and Tost's signature. Closing it, either way, marks the stage as welcomed.
 */
export function WelcomeCard({
  stage,
  open,
  onClose,
  onReport,
}: {
  stage: Welcomed;
  open: boolean;
  onClose: () => void;
  onReport: () => void;
}) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg welcome">
          <div className="welcome-art" aria-hidden="true">
            <span className="welcome-logo">
              <Logo size={22} />
              Tost Work
            </span>
            <span className="welcome-sheet back">
              <i className="welcome-line head" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
            </span>
            <span className="welcome-sheet">
              <i className="welcome-line head" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
              <i className="welcome-line" />
            </span>
            <span className="welcome-stamp">{stampOf(stage, __APP_VERSION__)}</span>
          </div>
          <div className="welcome-text">
            <Dialog.Title className="welcome-title">
              {t(`welcome.title.${stage}`)}
              <span className="welcome-thanks">{t("welcome.thanks")}</span>
            </Dialog.Title>
            <Dialog.Description render={<div />} className="welcome-body">
              <p className="welcome-p">{t("welcome.building")}</p>
              <p className="welcome-p">{t("welcome.report")}</p>
            </Dialog.Description>
            <i className="welcome-sign" role="img" aria-label="Tost" style={{ maskImage: `url(${signature})` }} />
            <div className="welcome-acts">
              <button type="button" className="btn quiet" onClick={onReport}>
                <Icon name="bug" />
                {t("report.title")}
              </button>
              <button type="button" className="btn dark" onClick={onClose}>
                {t("welcome.start")}
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
