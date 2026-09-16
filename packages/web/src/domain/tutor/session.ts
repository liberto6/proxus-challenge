import { Schema } from "effect";
import { AgentSession } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

/**
 * The current tutor session. The conversation is stored on the server; the
 * browser only remembers which session it was looking at.
 */
const storageKey = "proxus.tutor.sessionId";

const decodeSession = Schema.decodeUnknownSync(AgentSession);

const rememberedSessionId = (): string | undefined => {
  try {
    return window.localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
};

const rememberSessionId = (id: string) => {
  try {
    window.localStorage.setItem(storageKey, id);
  } catch {
    // Private mode or blocked storage: the session still works for this page load.
  }
};

export const createSession = async (): Promise<AgentSession> => {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`No se pudo crear la sesión (${response.status})`);
  }
  const session = decodeSession(await response.json());
  rememberSessionId(session.id);
  return session;
};

/** Loads the remembered session, or creates a new one when there is none or it no longer exists. */
export const loadOrCreateSession = async (): Promise<AgentSession> => {
  const id = rememberedSessionId();
  if (id === undefined) {
    return createSession();
  }

  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/sessions/${encodeURIComponent(id)}`);
  if (!response.ok) {
    return createSession();
  }
  return decodeSession(await response.json());
};
