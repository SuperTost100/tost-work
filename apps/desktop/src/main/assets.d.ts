/** electron-vite copies a file imported with ?asset into the build and gives its path at run time. */
declare module "*?asset" {
  const path: string;
  export default path;
}
