import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { versionLabel } from "@/lib/changelog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { bugReportUrl, OS_NAME } from "../../../shared/feedback";

/**
 * Report a problem: what GitHub's bug form will already know, a warning that the report is public, and the logs to
 * export for a problem in a task. "Open GitHub" is a link, so the main process opens it in the browser.
 */
export function ReportDialog({
  api,
  open,
  onOpenChange,
}: {
  api: TostWorkApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const url = bugReportUrl({ version: __APP_VERSION__, build: __APP_BUILD__, platform: api.platform });
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg report">
          <div className="report-head">
            <Dialog.Title className="dlg-title">{t("report.title")}</Dialog.Title>
            <Dialog.Close className="iconbtn" aria-label={t("dialog.close")}>
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="report-p">{t("report.lead")}</Dialog.Description>
          <dl className="report-facts">
            <dt>{t("report.version")}</dt>
            <dd>
              {versionLabel(__APP_VERSION__)} · build {__APP_BUILD__}
            </dd>
            <dt>{t("report.system")}</dt>
            <dd>{OS_NAME[api.platform]}</dd>
          </dl>
          <p className="report-p">{t("report.public")}</p>
          <div className="report-logs">
            <p className="report-logs-text">
              <b className="report-logs-title">{t("report.logsTitle")}</b>
              {t("report.logs")}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                api.debug.exportLogs().catch((err: unknown) => setError(errorText(err)));
              }}
            >
              <Icon name="download-2" />
              {t("settings.exportLogs")}
            </button>
          </div>
          {error && <p className="fld-error">{error}</p>}
          <div className="report-acts">
            <Dialog.Close className="btn">{t("dialog.cancel")}</Dialog.Close>
            <a className="btn dark" href={url} target="_blank" rel="noreferrer" onClick={() => onOpenChange(false)}>
              <Icon name="github" />
              {t("report.open")}
              <Icon name="external-link" />
            </a>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
