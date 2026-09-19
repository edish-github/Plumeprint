/**
 * Choosing a model provider.
 *
 * Configured entirely by environment, so no code changes when a team switches from a paid
 * key to a free one:
 *
 *   PLUMEPRINT_PROVIDER   anthropic | gemini | openai | none   (default: auto-detect)
 *   PLUMEPRINT_MODEL      overrides the provider's default model
 *   ANTHROPIC_API_KEY     for anthropic
 *   GEMINI_API_KEY        for gemini, from Google AI Studio, no credit card
 *   OPENAI_API_KEY        for any OpenAI-compatible endpoint
 *   OPENAI_BASE_URL       e.g. https://integrate.api.nvidia.com/v1
 *                              https://api.groq.com/openai/v1
 *                              https://openrouter.ai/api/v1
 *
 * With no key at all the product still works: case files are built from pipeline output
 * by the deterministic template.
 */

import Anthropic from "@anthropic-ai/sdk";

import { geminiClient, openAiCompatClient } from "./providers.js";
import type { ModelClient, ModelRequest, ModelResponse } from "./types-internal.js";

export type ProviderName = "anthropic" | "gemini" | "openai" | "none";

export const DEFAULT_MODELS: Record<Exclude<ProviderName, "none">, string> = {
  anthropic: "claude-sonnet-5",
  // Model names move; check what your key can call in AI Studio and override with
  // PLUMEPRINT_MODEL if this one is rejected.
  gemini: "gemini-2.5-flash",
  openai: "meta/llama-3.3-70b-instruct",
};

/** The narrow extraction task can use a cheaper model where one exists. */
export const EXTRACT_MODELS: Record<Exclude<ProviderName, "none">, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.5-flash-lite",
  openai: "meta/llama-3.3-70b-instruct",
};

export function detectProvider(): ProviderName {
  const explicit = process.env.PLUMEPRINT_PROVIDER as ProviderName | undefined;
  if (explicit) return explicit;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

export function hasModel(): boolean {
  return detectProvider() !== "none";
}

export function modelNameFor(provider: ProviderName, task: "agent" | "extract" = "agent"): string {
  if (provider === "none") return "none (deterministic template)";
  return (
    process.env.PLUMEPRINT_MODEL ??
    (task === "extract" ? EXTRACT_MODELS[provider] : DEFAULT_MODELS[provider])
  );
}

function anthropicClient(model: string): ModelClient {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return {
    async create(request: ModelRequest): Promise<ModelResponse> {
      const res = await client.messages.create({ ...request, model } as never);
      return res as unknown as ModelResponse;
    },
  };
}

/** Null when no key is configured; callers fall back to the template path. */
export function buildClient(task: "agent" | "extract" = "agent"):
  { client: ModelClient; provider: ProviderName; model: string } | null {
  const provider = detectProvider();
  if (provider === "none") return null;
  const model = modelNameFor(provider, task);

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    return { client: anthropicClient(model), provider, model };
  }
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
    return {
      client: geminiClient({ apiKey: process.env.GEMINI_API_KEY, model }),
      provider, model,
    };
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  return {
    client: openAiCompatClient({ apiKey: process.env.OPENAI_API_KEY, baseUrl, model }),
    provider, model,
  };
}

export function describeProvider(): string {
  const provider = detectProvider();
  if (provider === "none") {
    return "no model configured: case files come from the deterministic template";
  }
  return `${provider} · ${modelNameFor(provider)}`;
}
