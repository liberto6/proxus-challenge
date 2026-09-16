import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { AgentMessage } from "../schemas/agent-message.ts";
import { AgentSession, AgentSessionListResponse } from "../schemas/agent-session.ts";

/**
 * One tutor turn. The conversation lives on the server: the client sends the
 * session id and the new input only, never the history.
 */
/** What the student has open in the interface while asking, so the tutor can refer to it. */
export const TutorUiContext = Schema.Struct({
  openArtifactId: Schema.optional(Schema.String),
  openQuestionId: Schema.optional(Schema.String),
  /** Node of the open diagram the student is looking at. */
  openNodeId: Schema.optional(Schema.String)
});
export type TutorUiContext = typeof TutorUiContext.Type;

export const TutorChatRequest = Schema.Struct({
  sessionId: Schema.String,
  input: Schema.String,
  maxSteps: Schema.optional(Schema.Number),
  context: Schema.optional(TutorUiContext)
});
export type TutorChatRequest = typeof TutorChatRequest.Type;

export const TutorChatResponse = Schema.Struct({
  output: Schema.String,
  newMessages: Schema.Array(AgentMessage),
  messages: Schema.Array(AgentMessage)
});
export type TutorChatResponse = typeof TutorChatResponse.Type;

/** Stream events for `/tutor/chat/stream`: see `AgentEvent` in `schemas/agent-event.ts`. */
export { AgentEvent as TutorChatStreamEvent } from "../schemas/agent-event.ts";
export type { AgentEvent as TutorChatStreamEventType } from "../schemas/agent-event.ts";

export class TutorApi extends HttpApiGroup.make("tutor")
  .add(
    HttpApiEndpoint.post("chat", "/chat", {
      payload: TutorChatRequest,
      success: TutorChatResponse
    }),
    HttpApiEndpoint.post("createSession", "/sessions", {
      success: AgentSession
    }),
    HttpApiEndpoint.get("listSessions", "/sessions", {
      success: AgentSessionListResponse
    }),
    HttpApiEndpoint.get("getSession", "/sessions/:id", {
      params: {
        id: Schema.String
      },
      success: AgentSession
    })
  )
  .prefix("/tutor")
{}
