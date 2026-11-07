import credits from "virtual:credits";
import { Fragment, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { CHANGELOG, shownEntries, versionLabel } from "@/lib/changelog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { type LegalDoc, legalHtml } from "@/lib/legal";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { BUNDLED_ASSETS, type Credit } from "../../../shared/credits";
import { feedbackUrl, REPO_URL, SITE_URL } from "../../../shared/feedback";

export type AboutPage = "home" | "news" | "credits" | LegalDoc;

const PAGE_TITLES = {
  news: "news.title",
  credits: "credits.title",
  terms: "legal.terms",
  privacy: "legal.privacy",
} as const;

/** A link out of the app: the main process opens it in the user's browser, and only if it is https. */
function ExternalLink({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  const t = useT();
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <Icon name={icon} />
      <span className="grow">{children}</span>
      <Icon name="external-link" />
      <span className="sr">{t("about.opensBrowser")}</span>
    </a>
  );
}

/** One change, with the `**title:**` at its start in bold. */
function Change({ text }: { text: string }) {
  const match = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      <b>{match[1]}</b> {match[2]}
    </>
  );
}

function News() {
  const t = useT();
  const lang = useContext(LanguageContext);
  return (
    <div className="scroll">
      <div className="col doc">
        <h1>{t("news.title")}</h1>
        <p className="sub">{t("news.sub")}</p>
        {shownEntries(CHANGELOG, __APP_VERSION__).map((entry) => (
          <section className="sgroup" key={entry.version} aria-labelledby={`news-${entry.version}`}>
            <h2 id={`news-${entry.version}`}>{versionLabel(entry.version)}</h2>
            <ul className="changes">
              {entry.items[lang].map((text) => (
                <li key={text}>
                  <Change text={text} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function CreditRows({ list }: { list: readonly Credit[] }) {
  return list.map((credit) => (
    <div className="srow" key={credit.name}>
      <div className="lbl">
        <b>
          {credit.url ? (
            <a className="link" href={credit.url} target="_blank" rel="noreferrer">
              {credit.name}
            </a>
          ) : (
            credit.name
          )}
        </b>
        {credit.version && <span>{credit.version}</span>}
      </div>
      <span className="tag">{credit.license}</span>
    </div>
  ));
}

function Credits({ api }: { api: TostWorkApi }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="scroll">
      <div className="col doc">
        <h1>{t("credits.title")}</h1>
        <p className="sub">{t("credits.sub")}</p>
        <section className="sgroup" aria-labelledby="credits-assets">
          <h2 id="credits-assets">{t("credits.assets")}</h2>
          <CreditRows list={BUNDLED_ASSETS} />
        </section>
        <section className="sgroup" aria-labelledby="credits-packages">
          <h2 id="credits-packages">{t("credits.packages")}</h2>
          <p className="sub">{t("credits.packages.d")}</p>
          <CreditRows list={credits} />
        </section>
        <section className="sgroup" aria-labelledby="credits-texts">
          <h2 id="credits-texts">{t("credits.texts")}</h2>
          <div className="srow">
            <div className="lbl">
              <span>{t("credits.texts.d")}</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                api.openLicenses().catch((err: unknown) => setError(errorText(err)));
              }}
            >
              <Icon name="book-2" />
              {t("credits.texts.open")}
            </button>
          </div>
          {error && (
            <p className="fld-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The terms of use or the privacy notice, in the app's language, from the Markdown files in `legal/`. */
function Legal({ doc }: { doc: LegalDoc }) {
  const lang = useContext(LanguageContext);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = legalHtml(doc, lang);
  }, [doc, lang]);
  return (
    <div className="scroll">
      <div className="col doc legal" ref={ref} />
    </div>
  );
}

/**
 * About: what Tost Work is, where its code and author are, what changed in each version, which open-source pieces it
 * is made of, and how to send feedback. What's new and Credits are pages of their own under it.
 */
export function About({
  api,
  page,
  onPage,
  onSettings,
}: {
  api: TostWorkApi;
  page: AboutPage;
  onPage: (page: AboutPage) => void;
  onSettings: () => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const feedback = feedbackUrl({
    version: __APP_VERSION__,
    build: __APP_BUILD__,
    platform: api.platform,
    language: lang,
  });
  const trail: { label: string; go?: () => void }[] = [
    { label: t("nav.settings"), go: onSettings },
    { label: t("about.crumb"), go: page === "home" ? undefined : () => onPage("home") },
    ...(page === "home" ? [] : [{ label: t(PAGE_TITLES[page]) }]),
  ];

  return (
    <main className="main">
      <div className="top">
        <nav className="crumb" aria-label={t("about.crumb")}>
          {trail.map((step, i) => (
            <Fragment key={step.label}>
              {i > 0 && <span className="t3">/</span>}
              {i === trail.length - 1 ? (
                <b aria-current="page">{step.label}</b>
              ) : (
                <button type="button" className="link" onClick={step.go}>
                  {step.label}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
      </div>
      {page === "news" && <News />}
      {page === "credits" && <Credits api={api} />}
      {(page === "terms" || page === "privacy") && <Legal doc={page} />}
      {page === "home" && (
        <div className="solo scrolls">
          <div className="about">
            <Logo size={44} />
            <h1>
              {t("about.title")}
              <br />
              <span>{t("about.tagline")}</span>
            </h1>
            <div className="ver">
              <span className="tag">
                {t("about.tag", { version: versionLabel(__APP_VERSION__), build: __APP_BUILD__ })}
              </span>
            </div>
            <p>{t("about.description")}</p>
            <div className="links">
              <ExternalLink href={SITE_URL} icon="web">
                tost.one
              </ExternalLink>
              <ExternalLink href={REPO_URL} icon="github">
                {t("about.source")}
              </ExternalLink>
              <button type="button" onClick={() => onPage("news")}>
                <Icon name="sparkles" />
                <span className="grow">{t("about.news", { version: versionLabel(__APP_VERSION__) })}</span>
                <Icon name="right" />
              </button>
              <button type="button" onClick={() => onPage("credits")}>
                <Icon name="book-2" />
                <span className="grow">{t("credits.title")}</span>
                <Icon name="right" />
              </button>
              <button type="button" onClick={() => onPage("terms")}>
                <Icon name="file" />
                <span className="grow">{t("legal.terms")}</span>
                <Icon name="right" />
              </button>
              <button type="button" onClick={() => onPage("privacy")}>
                <Icon name="lock" />
                <span className="grow">{t("legal.privacy")}</span>
                <Icon name="right" />
              </button>
              <ExternalLink href={feedback} icon="mail">
                {t("about.feedback")}
              </ExternalLink>
            </div>
          </div>
          <svg className="sprig right" viewBox="0 0 160 200" aria-hidden="true" style={{ right: 80, width: 120 }}>
            <path d="M20 200 C40 150 70 110 140 80" stroke="var(--ink)" strokeWidth="4" fill="none" />
            <path d="M62 132 C48 112 46 88 58 66 C74 86 74 112 62 132Z" fill="#CFC3AD" />
            <path d="M96 104 C88 82 92 60 108 44 C118 66 112 88 96 104Z" fill="#B3A28B" />
            <path d="M84 116 C104 108 126 112 142 126 C120 136 100 132 84 116Z" fill="#B3A28B" />
          </svg>
        </div>
      )}
    </main>
  );
}
