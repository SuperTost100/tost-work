declare module "virtual:credits" {
  import type { Credit } from "../../shared/credits";

  /** The npm packages the app ships and their licences, made by credits.ts when the app is built. */
  const credits: readonly Credit[];
  export default credits;
}
