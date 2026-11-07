/** Where the code lives, and where feedback goes: the testers and the course participants can all reach GitHub. */
export const REPO_URL = "https://github.com/SuperTost100/tost-work";
export const SITE_URL = "https://tost.one";

export interface FeedbackInfo {
  version: string;
  build: string;
  platform: "darwin" | "win32" | "linux";
  language: "en" | "it";
}

const OS_NAMES = { darwin: "macOS", win32: "Windows", linux: "Linux" } as const;
const LANGUAGE_NAMES = { en: "English", it: "Italian" } as const;

/**
 * A new GitHub issue with no title and the body started: what the report is about, so it doesn't have to be asked for.
 * The body stays in English, like the rest of the issues in the repository.
 */
export function feedbackUrl(info: FeedbackInfo): string {
  const body = [
    `Tost Work ${info.version} (build ${info.build})`,
    `OS: ${OS_NAMES[info.platform]}`,
    `Language: ${LANGUAGE_NAMES[info.language]}`,
    "",
    "",
  ].join("\n");
  return `${REPO_URL}/issues/new?${new URLSearchParams({ title: "", body })}`;
}

/**
 * The repository's bug form, with the version and the system already filled in, so the person only says what happened.
 * GitHub fills a form field from the query parameter named after its id (`.github/ISSUE_TEMPLATE/bug.yml`).
 */
export function bugReportUrl(info: Omit<FeedbackInfo, "language"> & { logs?: string }): string {
  const params = new URLSearchParams({
    template: "bug.yml",
    version: `${info.version} · build ${info.build}`,
    os: OS_NAMES[info.platform],
  });
  // The events log of a test build: nothing the user wrote or named, so it can go in a public report.
  if (info.logs) params.set("logs", `Events before the report, times in UTC:\n\n\`\`\`\n${info.logs}\n\`\`\``);
  return `${REPO_URL}/issues/new?${params}`;
}

export const OS_NAME = OS_NAMES;
