import { Icon } from "@/lib/Icon";
import { greetingKey } from "@/lib/i18n";
import { useT } from "@/lib/useT";

export function Home({
  userName,
  brief,
  onBriefChange,
  now = new Date(),
}: {
  userName: string;
  brief: string;
  onBriefChange: (text: string) => void;
  now?: Date;
}) {
  const t = useT();
  return (
    <div className="main">
      <div className="top" />
      <div className="scroll" style={{ position: "relative" }}>
        <div className="col home-col">
          <div className="hello">
            <h1>
              {t(greetingKey(now.getHours()), { name: userName })}
              <br />
              <span>{t("home.firstTask")}</span>
            </h1>
          </div>
          <div className="composer">
            <textarea
              aria-label={t("composer.placeholder")}
              placeholder={t("composer.placeholder")}
              value={brief}
              onChange={(e) => onBriefChange(e.target.value)}
            />
            <div className="in">
              <button type="button" className="iconbtn" title={t("composer.attach")} aria-label={t("composer.attach")}>
                <Icon name="add" />
              </button>
              <span className="grow" />
              <button
                type="button"
                className="send"
                title={t("composer.start")}
                aria-label={t("composer.start")}
                disabled={!brief.trim()}
              >
                <Icon name="arrow-up" />
              </button>
            </div>
          </div>
          <div className="under">
            <span className="pick">
              <b>{t("composer.noProject")}</b>
              <Icon name="down" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
