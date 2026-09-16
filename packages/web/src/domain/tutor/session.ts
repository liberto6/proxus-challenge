import { Schema } from "effect";
import { AgentSession, folderOf } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

/**
 * Conversations live on the server inside a folder. The browser remembers
 * which one it was looking at (see `domain/folders/current.ts`).
 */
const decodeSession = Schema.decodeUnknownSync(AgentSession);

export const createSession = async (folderId: string): Promise<AgentSession> => {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId })
  });
  if (!response.ok) {
    throw new Error(`No se pudo crear la conversación (${response.status})`);
  }
  return decodeSession(await response.json());
};

export const deleteSession = async (id: string): Promise<void> => {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`No se pudo borrar la conversación (${response.status})`);
  }
};

/** The stored session, or `undefined` when it no longer exists. */
export const loadSession = async (id: string): Promise<AgentSession | undefined> => {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/sessions/${encodeURIComponent(id)}`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`No se pudo cargar la conversación (${response.status})`);
  }
  return decodeSession(await response.json());
};

/**
 * The remembered conversation of a folder, or a new one when there is none,
 * it no longer exists, or it belongs to another folder.
 */
export const resumeOrCreateSession = async (folderId: string, rememberedId: string | undefined): Promise<AgentSession> => {
  if (rememberedId !== undefined) {
    const session = await loadSession(rememberedId);
    if (session !== undefined && folderOf(session) === folderId) {
      return session;
    }
  }
  return createSession(folderId);
};
