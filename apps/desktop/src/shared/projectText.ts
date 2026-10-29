import { type Language, translate } from "./i18n";

/** What the confirmation says before a project is removed: what goes with it, and that its folder stays. */
export function removalText(
  lang: Language,
  name: string,
  usage: { tasks: number; jobs: number },
): { message: string; detail: string } {
  const items: string[] = [];
  if (usage.tasks === 1) items.push(translate(lang, "projects.oneTask"));
  else if (usage.tasks > 1) items.push(translate(lang, "projects.tasks", { n: String(usage.tasks) }));
  if (usage.jobs === 1) items.push(translate(lang, "project.removeOneJob"));
  else if (usage.jobs > 1) items.push(translate(lang, "project.removeJobs", { n: String(usage.jobs) }));
  const gone = items.length
    ? `${translate(lang, "project.removeGone", { items: new Intl.ListFormat(lang, { type: "conjunction" }).format(items) })} `
    : "";
  return {
    message: translate(lang, "project.removeConfirm", { name }),
    detail: gone + translate(lang, "project.removeStays"),
  };
}
