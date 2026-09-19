/**
 * Provider adapters.
 *
 * The agent loop speaks one narrow dialect: a request carrying a system prompt, tool
 * schemas and a message list, and a response carrying text and tool_use blocks. That
 * dialect happens to match the Anthropic Messages API, because that is what this was
 * built against first.
 *
 * These adapters translate that dialect to and from other providers, so the investigator
 * can run on whatever model a team can actually get hold of. Nothing in the agent loop,
 * the tools or the verifier changes: the verifier in particular matters more with a
 * smaller model, not less, because a weaker model is likelier to invent a number.
 *
 * Supported:
 *   anthropic  the Messages API
 *   gemini     Google AI Studio, free tier, no credit card
 *   openai     any OpenAI-compatible endpoint: NVIDIA NIM, Groq, OpenRouter, Together,
 *              a local Ollama, or OpenAI itself
 */

import type { ModelClient, ModelRequest, ModelResponse } from "./types-internal.js";

/* ------------------------------------------------------------------ shared shapes */

interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

function asBlocks(content: unknown): AnthropicBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as AnthropicBlock[];
  return [];
}

/** Tool results are JSON strings in our loop; providers want them as text either way. */
function resultText(block: AnthropicBlock): string {
  if (typeof block.content === "string") return block.content;
  return JSON.stringify(block.content ?? {});
}

let counter = 0;
const nextId = () => `call_${(counter += 1)}`;

/* ------------------------------------------------------------------ Gemini */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini rejects several JSON Schema keywords that Anthropic accepts. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = cleanSchema(value);
  }
  return out;
}

export function geminiClient(opts: {
  apiKey: string;
  model?: string;
  /** Gemini's free tier is rate limited per minute; the loop is slow anyway. */
  minIntervalMs?: number;
}): ModelClient {
  // Model names move fast. Override with PLUMEPRINT_MODEL after checking AI Studio for
  // what your key can currently call.
  const model = opts.model ?? "gemini-2.5-flash";
  const minInterval = opts.minIntervalMs ?? 7000;
  let lastCall = 0;

  return {
    async create(request: ModelRequest): Promise<ModelResponse> {
      const wait = minInterval - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();

      const contents = (request.messages as AnthropicMessage[]).map((m) => {
        const parts: Record<string, unknown>[] = [];
        for (const block of asBlocks(m.content)) {
          if (block.type === "text" && block.text) {
            parts.push({ text: block.text });
          } else if (block.type === "tool_use") {
            parts.push({ functionCall: { name: block.name, args: block.input ?? {} } });
          } else if (block.type === "tool_result") {
            parts.push({
              functionResponse: {
                name: block.tool_use_id ?? "tool",
                response: { result: resultText(block) },
              },
            });
          }
        }
        if (parts.length === 0) parts.push({ text: " " });
        return { role: m.role === "assistant" ? "model" : "user", parts };
      });

      const tools = (request.tools as AnthropicToolSchema[]).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: cleanSchema(t.input_schema),
      }));

      const forced =
        typeof request.tool_choice === "object" &&
        request.tool_choice !== null &&
        (request.tool_choice as { type?: string }).type === "tool"
          ? (request.tool_choice as { name?: string }).name
          : undefined;

      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        toolConfig: {
          functionCallingConfig: forced
            ? { mode: "ANY", allowedFunctionNames: [forced] }
            : { mode: "AUTO" },
        },
        generationConfig: { maxOutputTokens: request.max_tokens, temperature: 0.2 },
      };

      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return parseGemini(await res.json());
    },
  };
}

/** Exported so the translation can be tested against a fixture, with no key and no network. */
export function parseGemini(payload: unknown): ModelResponse {
  const candidate = (payload as {
    candidates?: { content?: { parts?: Record<string, unknown>[] }; finishReason?: string }[];
  }).candidates?.[0];
  const blocks: AnthropicBlock[] = [];
  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part.text === "string" && part.text.trim()) {
      blocks.push({ type: "text", text: part.text });
    }
    const call = part.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
    if (call?.name) {
      blocks.push({ type: "tool_use", id: nextId(), name: call.name, input: call.args ?? {} });
    }
  }
  return { content: blocks, stop_reason: candidate?.finishReason ?? null };
}

/* ------------------------------------------------------------------ OpenAI-compatible */

export function openAiCompatClient(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  minIntervalMs?: number;
}): ModelClient {
  const minInterval = opts.minIntervalMs ?? 0;
  let lastCall = 0;

  return {
    async create(request: ModelRequest): Promise<ModelResponse> {
      const wait = minInterval - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();

      const messages: Record<string, unknown>[] = [
        { role: "system", content: request.system },
      ];
      for (const m of request.messages as AnthropicMessage[]) {
        const blocks = asBlocks(m.content);
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        if (toolResults.length) {
          // OpenAI wants one message per tool result, addressed by call id.
          for (const block of toolResults) {
            messages.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: resultText(block),
            });
          }
          continue;
        }
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const calls = blocks.filter((b) => b.type === "tool_use");
        if (m.role === "assistant" && calls.length) {
          messages.push({
            role: "assistant",
            content: text || null,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
            })),
          });
        } else {
          messages.push({ role: m.role, content: text });
        }
      }

      const tools = (request.tools as AnthropicToolSchema[]).map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));

      const forced =
        typeof request.tool_choice === "object" &&
        request.tool_choice !== null &&
        (request.tool_choice as { type?: string }).type === "tool"
          ? (request.tool_choice as { name?: string }).name
          : undefined;

      const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          tools,
          tool_choice: forced ? { type: "function", function: { name: forced } } : "auto",
          max_tokens: request.max_tokens,
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        throw new Error(`${opts.baseUrl} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return parseOpenAi(await res.json());
    },
  };
}

/** Exported for fixture testing, as with Gemini. */
export function parseOpenAi(payload: unknown): ModelResponse {
  const choice = (payload as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
      finish_reason?: string;
    }[];
  }).choices?.[0];
  const blocks: AnthropicBlock[] = [];
  const message = choice?.message;
  if (message?.content?.trim()) blocks.push({ type: "text", text: message.content });
  for (const call of message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(call.function?.arguments ?? "{}");
    } catch {
      // A model that emits malformed arguments should surface as a tool error the loop
      // can report, not as a crash.
      input = { _malformed_arguments: call.function?.arguments ?? "" };
    }
    blocks.push({ type: "tool_use", id: call.id ?? nextId(), name: call.function?.name, input });
  }
  return { content: blocks, stop_reason: choice?.finish_reason ?? null };
}
