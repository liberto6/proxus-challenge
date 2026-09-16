import { generalFolderId } from "@proxus/shared";

/**
 * What the browser remembers between visits: the folder that was open and the
 * conversation inside it. Everything else lives on the server.
 */
const folderKey = "proxus.folderId";
const sessionKey = "proxus.tutor.sessionId";

const read = (key: string): string | undefined => {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page load only.
  }
};

export const rememberedFolderId = (): string => read(folderKey) ?? generalFolderId;
export const rememberedSessionId = (): string | undefined => read(sessionKey);

export const rememberCurrent = (folderId: string, sessionId: string | undefined) => {
  write(folderKey, folderId);
  if (sessionId !== undefined) write(sessionKey, sessionId);
};
