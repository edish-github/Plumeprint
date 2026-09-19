/** Shared shapes for the LLM layer, kept apart from the public data contract. */

export type { CaseFile, AgentStep, StoredCase, Verdict } from "../types";

/** Anything a tool returned. Only `refs` is relied on structurally. */
export interface ToolResultLike {
  [key: string]: unknown;
  refs?: string[];
}

/** The subset of the Anthropic Messages API the agent loop depends on.
 *  Declaring it here keeps the loop testable with a scripted model and no API key. */
export interface ModelBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ModelResponse {
  content: ModelBlock[];
  stop_reason?: string | null;
}

export interface ModelRequest {
  model: string;
  max_tokens: number;
  system: string;
  tools: unknown[];
  messages: unknown[];
  tool_choice?: unknown;
}

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
}
