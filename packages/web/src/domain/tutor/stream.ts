import { Schema } from "effect";
import { AgentEvent, type TutorChatRequest } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

const AgentEventFromJsonString = Schema.fromJsonString(AgentEvent);
const decodeEvent = Schema.decodeUnknownSync(AgentEventFromJsonString);

/**
 * Streams one tutor turn as typed `AgentEvent`s (NDJSON). Pass an `AbortSignal`
 * to cancel: the server stops the turn when the connection closes.
 */
export async function* streamTutorMessage(
  input: TutorChatRequest,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/tutor/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/x-ndjson"
    },
    body: JSON.stringify(input),
    ...(signal === undefined ? {} : { signal })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.body === null) {
    throw new Error("Tutor stream response did not include a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        yield decodeEvent(trimmed);
      }
    }
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining.length > 0) {
    yield decodeEvent(remaining);
  }
}
