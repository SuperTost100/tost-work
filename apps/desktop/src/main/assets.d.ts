/** electron-vite copies a file imported with ?asset into the build and gives its path at run time. */
declare module "*?asset" {
  const path: string;
  export default path;
}

// A text file's contents, bundled into the main process at build time: the instructions every task starts with.
declare module "*.md?raw" {
  const text: string;
  export default text;
}
