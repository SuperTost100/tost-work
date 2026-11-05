/** One piece of open-source software the app ships with, and the licence it comes with. */
export interface Credit {
  name: string;
  /** Missing for fonts and icons, which have no version of their own here. */
  version?: string;
  /** An SPDX identifier, or the text the package gives when it has none. */
  license: string;
  /** Where to read about it, always https. */
  url: string | null;
}

/**
 * The file with every licence the app ships, which the build writes into `LICENSES_DIR` and electron-builder copies
 * to the app's resources (electron-builder.yml says the same).
 */
export const LICENSES_FILE = "THIRD-PARTY-LICENSES.txt";
export const LICENSES_DIR = "resources/generated";

/**
 * What the app ships besides npm packages: the fonts in `assets/fonts` and the icons in `assets/icons`. Unlike the
 * packages, nothing generates these, so a font or icon set added to the app is added here too.
 */
export const BUNDLED_ASSETS: readonly Credit[] = [
  { name: "Schibsted Grotesk", license: "SIL OFL 1.1", url: "https://github.com/schibsted/schibsted-grotesk" },
  { name: "IBM Plex Mono", license: "SIL OFL 1.1", url: "https://github.com/IBM/plex" },
  { name: "Carlito", license: "SIL OFL 1.1", url: "https://github.com/googlefonts/carlito" },
  { name: "Caladea", license: "SIL OFL 1.1", url: "https://github.com/huertatipografica/Caladea" },
  { name: "MingCute icons", license: "Apache-2.0", url: "https://www.mingcute.com/" },
];
