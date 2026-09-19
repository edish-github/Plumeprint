/**
 * Provider adapters, tested with fixtures.
 *
 * Each provider returns a different shape. What matters is that the agent loop sees the
 * same thing regardless, and that a model which misbehaves in a provider-specific way
 * (malformed tool arguments, empty content) degrades into something the loop can handle
 * rather than a crash.
 *
 * No API keys and no network: the fixtures are real response shapes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { getEpisodes, getSites } from "../lib/data.js";
import { investigate } from "../lib/llm/agent.js";
import { DEFAULT_MODELS, detectProvider, modelNameFor } from "../lib/llm/client.js";
import { parseGemini, parseOpenAi } from "../lib/llm/providers.js";
import { TOOL_SCHEMAS } from "../lib/llm/tools.js";
import type { ModelClient, ModelRequest } from "../lib/llm/types-internal.js";

/* ------------------------------------------------------------------ Gemini shape */

test("gemini function calls become tool_use blocks", () => {
  const res = parseGemini({
    candidates: [{
      content: {
        parts: [
          { text: "Let me look at the episode." },
          { functionCall: { name: "get_episode", args: { episode_id: "48-167-0005_20230420T13" } } },
        ],
      },
      finishReason: "STOP",
    }],
  });
  assert.equal(res.content.length, 2);
  assert.equal(res.content[0]!.type, "text");
  const call = res.content[1]!;
  assert.equal(call.type, "tool_use");
  assert.equal(call.name, "get_episode");
  assert.equal(call.input?.episode_id, "48-167-0005_20230420T13");
  assert.ok(call.id, "every tool_use needs an id the loop can echo back");
});

test("gemini calls without arguments still produce a usable block", () => {
  const res = parseGemini({
    candidates: [{ content: { parts: [{ functionCall: { name: "check_regional" } }] } }],
  });
  assert.equal(res.content[0]!.name, "check_regional");
  assert.deepEqual(res.content[0]!.input, {});
});

test("an empty gemini response yields no blocks rather than throwing", () => {
  assert.deepEqual(parseGemini({}).content, []);
  assert.deepEqual(parseGemini({ candidates: [] }).content, []);
  assert.deepEqual(parseGemini({ candidates: [{ content: { parts: [{ text: "  " }] } }] }).content, []);
});

/* ------------------------------------------------------------------ OpenAI shape */

test("openai tool calls become tool_use blocks with parsed arguments", () => {
  const res = parseOpenAi({
    choices: [{
      message: {
        content: null,
        tool_calls: [{
          id: "call_abc",
          function: { name: "find_reports", arguments: '{"episode_id":"x","pad_hours":48}' },
        }],
      },
      finish_reason: "tool_calls",
    }],
  });
  const call = res.content[0]!;
  assert.equal(call.type, "tool_use");
  assert.equal(call.id, "call_abc");
  assert.equal(call.input?.pad_hours, 48);
});

test("malformed tool arguments surface as data, not as a crash", () => {
  // Smaller free models do emit broken JSON. The loop should see a tool call it can run
  // and fail cleanly on, rather than the process dying mid-batch.
  const res = parseOpenAi({
    choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "get_report", arguments: "{oops" } }] } }],
  });
  assert.equal(res.content[0]!.name, "get_report");
  assert.equal(typeof res.content[0]!.input?._malformed_arguments, "string");
});

test("openai text-only replies become text blocks", () => {
  const res = parseOpenAi({ choices: [{ message: { content: "thinking out loud" }, finish_reason: "stop" }] });
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0]!.text, "thinking out loud");
});

/* ------------------------------------------------------------------ provider selection */

test("provider selection follows the environment", () => {
  const saved = { ...process.env };
  try {
    delete process.env.PLUMEPRINT_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.PLUMEPRINT_MODEL;
    assert.equal(detectProvider(), "none");

    process.env.GEMINI_API_KEY = "x";
    assert.equal(detectProvider(), "gemini");
    assert.equal(modelNameFor("gemini"), DEFAULT_MODELS.gemini);

    // An explicit key wins over auto-detection, and the model can always be overridden.
    process.env.ANTHROPIC_API_KEY = "y";
    assert.equal(detectProvider(), "anthropic");
    process.env.PLUMEPRINT_PROVIDER = "gemini";
    assert.equal(detectProvider(), "gemini");
    process.env.PLUMEPRINT_MODEL = "gemini-3-flash-preview";
    assert.equal(modelNameFor("gemini"), "gemini-3-flash-preview");
  } finally {
    for (const k of ["PLUMEPRINT_PROVIDER", "PLUMEPRINT_MODEL", "ANTHROPIC_API_KEY",
                     "GEMINI_API_KEY", "OPENAI_API_KEY"]) {
      delete process.env[k];
      if (saved[k]) process.env[k] = saved[k];
    }
  }
});

/* ------------------------------------------------------------------ end to end */

/** A fake HTTP layer returning provider-shaped payloads, so the whole loop is exercised. */
function providerBackedClient(
  shape: "gemini" | "openai",
  turns: { name: string; args: Record<string, unknown> }[],
): ModelClient & { seen: ModelRequest[] } {
  let i = 0;
  const seen: ModelRequest[] = [];
  return {
    seen,
    async create(request: ModelRequest) {
      seen.push(request);
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      if (shape === "gemini") {
        return parseGemini({
          candidates: [{ content: { parts: [{ functionCall: { name: turn.name, args: turn.args } }] } }],
        });
      }
      return parseOpenAi({
        choices: [{
          message: {
            tool_calls: [{
              id: `c${i}`,
              function: { name: turn.name, arguments: JSON.stringify(turn.args) },
            }],
          },
        }],
      });
    },
  };
}

async function anEpisode() {
  const sites = await getSites();
  const episodes = await getEpisodes(sites[0]!.id);
  return episodes[0]!;
}

for (const shape of ["gemini", "openai"] as const) {
  test(`the full loop runs against a ${shape}-shaped provider`, async () => {
    const episode = await anEpisode();
    const client = providerBackedClient(shape, [
      { name: "get_episode", args: { episode_id: episode.id } },
      { name: "find_reports", args: { episode_id: episode.id } },
      {
        name: "submit_case_file",
        args: {
          verdict: episode.verdict,
          agrees_with_rules: true,
          confidence_label: "low",
          headline: "The records disagree about this episode.",
          reasoning: [
            { claim: "The monitor recorded a period above its threshold.", evidence: [`ep:${episode.id}`] },
            { claim: "The filed reports were checked for the same window.", evidence: [`ep:${episode.id}`] },
            { claim: "The wind direction was steady throughout.", evidence: [`ep:${episode.id}`] },
          ],
          innocent_explanations: ["A release below the reportable quantity leaves no report."],
          what_would_settle_it: ["Sub-hourly monitor data for the window."],
          request_draft: "Dear Public Information Coordinator, I request the records below.",
        },
      },
    ]);
    const result = await investigate(episode.id, { client, model: `test-${shape}` });
    assert.equal(result.verified, true, JSON.stringify(result.violations));
    assert.deepEqual(result.trace.map((s) => s.tool), ["get_episode", "find_reports"]);
    // The loop must hand every provider the same tool schemas it was given.
    assert.equal((client.seen[0]!.tools as unknown[]).length, TOOL_SCHEMAS.length);
  });
}

test("a weak model that invents a number is still caught on any provider", async () => {
  const episode = await anEpisode();
  const client = providerBackedClient("gemini", [
    { name: "get_episode", args: { episode_id: episode.id } },
    {
      name: "submit_case_file",
      args: {
        verdict: episode.verdict,
        agrees_with_rules: true,
        confidence_label: "high",
        headline: "A clear release happened here.",
        reasoning: [
          { claim: "The monitor peaked at 812.5 ppb.", evidence: [`ep:${episode.id}`] },
          { claim: "The wind was steady.", evidence: [`ep:${episode.id}`] },
          { claim: "No report covers it.", evidence: [`ep:${episode.id}`] },
        ],
        innocent_explanations: ["A small release may go unreported."],
        what_would_settle_it: ["Sub-hourly data."],
        request_draft: "Dear Coordinator, please send the records.",
      },
    },
  ]);
  const result = await investigate(episode.id, { client, model: "test-weak" });
  // Two failed drafts fall back to the template, so an invented figure never reaches a reader.
  assert.equal(result.verified, "template");
  assert.ok(!JSON.stringify(result.case).includes("812.5"));
});
