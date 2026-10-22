/** electron-vite copies `?asset` imports into the build output and resolves them to a file path. */
declare module "*?asset" {
  const path: string;
  export default path;
}
