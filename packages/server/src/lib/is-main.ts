import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * True when the module at `moduleUrl` is the script Node was started with.
 *
 * Portable replacement for `import.meta.main`, which is undefined on Node
 * versions before 22.18 / 24, where the guard silently skipped the script body.
 */
export const isMain = (moduleUrl: string): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }

  return moduleUrl === pathToFileURL(path.resolve(entry)).href;
};
