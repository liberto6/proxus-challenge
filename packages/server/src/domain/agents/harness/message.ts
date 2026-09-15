export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage;

export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
}

/**
 * A tool call decided by the model. `id` pairs the call with its result so the
 * history can be rendered back to the model as native tool-call / tool-result
 * parts instead of free text.
 */
export interface ToolCallMessage {
  readonly role: "tool-call";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  /** Provider-specific data that must travel back with the call (e.g. Gemini thought signatures). */
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ToolResultMessage {
  readonly role: "tool-result";
  readonly id: string;
  readonly name: string;
  readonly result: unknown;
  readonly isFailure: boolean;
}

export const AgentMessage = {
  user: (content: string): UserMessage => ({
    role: "user",
    content
  }),
  assistant: (content: string): AssistantMessage => ({
    role: "assistant",
    content
  }),
  toolCall: (id: string, name: string, input: unknown, metadata?: Record<string, unknown>): ToolCallMessage => ({
    role: "tool-call",
    id,
    name,
    input,
    ...(metadata !== undefined && Object.keys(metadata).length > 0 ? { metadata } : {})
  }),
  toolResult: (id: string, name: string, result: unknown, isFailure: boolean): ToolResultMessage => ({
    role: "tool-result",
    id,
    name,
    result,
    isFailure
  })
};
