import { isAbsolute } from "node:path";

/** Checks for values that come from the interface, because IPC is a trust boundary. */
export const text = (v: unknown, field: string, max = 20_000): string => {
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  if (v.length > max) throw new Error(`${field} is too long`);
  return v;
};

/** Absolute paths only: a relative or empty path would resolve against wherever the app happens to run. */
export const absolutePath = (v: unknown, field: string): string => {
  const path = text(v, field, 4096);
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`);
  return path;
};

export const paths = (v: unknown, field: string, max = 20): string[] => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${field} must be a list`);
  if (v.length > max) throw new Error(`${field} can have at most ${max} files`);
  return v.map((p) => absolutePath(p, field));
};
