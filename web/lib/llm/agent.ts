/**
 * The investigator.
 *
 * A bounded tool loop: the model gathers evidence through the tools, then calls
 * submit_case_file exactly once. The draft goes through the verifier; one retry is allowed
 * with the violations spelled out; a second failure falls back to a deterministic case
 * file built from the same data.
 *
 * The model client is injected rather than constructed here, so the loop can be driven by
 * a scripted client in tests, with no API key and no network.
 */

import { runTool, summarise, TOOL_SCHEMAS } from "./tools";
import type {
  AgentStep, CaseFile, ModelClient, ModelResponse, StoredCase, ToolResultLike,
} from "./types-internal";
import { buildTemplateCase } from "./template";
import { verify, violationsAsPrompt } from "./verifier";

export const AGENT_MODEL = "claude-sonnet-5";
export const MAX_TURNS = 8;

export const AGENT_SYSTEM = `You are PlumePrint's investigator. You examine one air-pollution episode recorded by a public air monitor and judge how well public self-reported emission events explain it. You work only through the tools.

Rules:
1. Use only facts returned by tools. Never state a number a tool did not return.
2. Cite evidence with the reference ids the tools give you, such as ep:..., inc:..., fac:..., mon:..., fp:...
3. get_episode returns a rule-based verdict. Test it against the evidence, explain it in plain words, and say whether you agree and how confident you are. You may disagree; say so explicitly if you do.
4. Always weigh innocent explanations: a release below the reportable quantity, permitted emissions in poor dispersion, ships or other mobile sources, a source outside the searched counties, a regional event, or an instrument artefact.
5. Never use accusation words: illegal, violation, culprit, guilty, lied, cover-up, blame, polluter, offender. Say "no matching report" and "upwind-consistent" instead. You are describing a gap between two public records, not alleging wrongdoing.
6. Name a facility only alongside its own filed report, or its position relative to the wind.
7. Write for a resident, not a regulator. Short sentences, no jargon, no hedging beyond what the evidence requires.

A usual order: get_episode, then check_regional, then list_upwind_facilities, then find_reports, then get_report on the best candidates, and get_facility_history when the timing looks adjacent rather than overlapping. Finish by calling submit_case_file exactly once.`;

export interface InvestigateOptions {
  client: ModelClient;
  model?: string;
  maxTurns?: number;
  onStep?: (step: AgentStep) => void;
}

export interface InvestigateResult {
  episodeId: string;
  case: CaseFile;
  trace: AgentStep[];
  verified: boolean | "template";
  model: string;
  turnsUsed: number;
  violations?: string[];
}

interface Message {
  role: "user" | "assistant";
  content: unknown;
}

function toolUseBlocks(response: ModelResponse) {
  return response.content.filter((b) => b.type === "tool_use" && b.name);
}

export async function investigate(
  episodeId: string,
  opts: InvestigateOptions,
): Promise<InvestigateResult> {
  const model = opts.model ?? AGENT_MODEL;
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const trace: AgentStep[] = [];
  const results: ToolResultLike[] = [];
  const messages: Message[] = [
    { role: "user", content: `Investigate episode ${episodeId}. Begin with get_episode.` },
  ];

  let ruleVerdict: string | undefined;
  let draft: CaseFile | null = null;
  let retried = false;
  let turn = 0;

  while (turn < maxTurns) {
    turn += 1;
    const lastTurn = turn === maxTurns;
    const response = await opts.client.create({
      model,
      max_tokens: 2000,
      system: AGENT_SYSTEM,
      tools: TOOL_SCHEMAS,
      messages,
      // On the final turn the model must finish rather than gather more evidence.
      tool_choice: lastTurn ? { type: "tool", name: "submit_case_file" } : { type: "auto" },
    });
    messages.push({ role: "assistant", content: response.content });

    const calls = toolUseBlocks(response);
    if (calls.length === 0) {
      messages.push({
        role: "user",
        content: "Continue using the tools, then call submit_case_file exactly once.",
      });
      continue;
    }

    const toolResults: unknown[] = [];
    let submitted = false;

    for (const call of calls) {
      if (call.name === "submit_case_file") {
        draft = call.input as unknown as CaseFile;
        const check = verify(draft, results, ruleVerdict);
        if (check.ok) {
          return { episodeId, case: draft, trace, verified: true, model, turnsUsed: turn };
        }
        if (retried) {
          // Two failed attempts is a pattern, not a slip. Publish something defensible.
          const fallback = await buildTemplateCase(episodeId);
          return {
            episodeId, case: fallback, trace, verified: "template", model, turnsUsed: turn,
            violations: check.violations.map((v) => `${v.kind}: ${v.detail}`),
          };
        }
        retried = true;
        submitted = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: violationsAsPrompt(check.violations),
        });
        continue;
      }

      const result = await runTool(call.name!, (call.input ?? {}) as Record<string, unknown>);
      results.push(result);
      if (call.name === "get_episode" && typeof result.rule_verdict === "string") {
        ruleVerdict = result.rule_verdict;
      }
      const step: AgentStep = {
        seq: trace.length + 1,
        tool: call.name!,
        args: (call.input ?? {}) as Record<string, unknown>,
        summary: summarise(call.name!, result),
      };
      trace.push(step);
      opts.onStep?.(step);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
    if (submitted) continue;
  }

  // Ran out of turns without a clean submission.
  const fallback = draft ?? (await buildTemplateCase(episodeId));
  const check = draft ? verify(draft, results, ruleVerdict) : { ok: false, violations: [] };
  return {
    episodeId,
    case: check.ok && draft ? draft : await buildTemplateCase(episodeId),
    trace,
    verified: check.ok && draft ? true : "template",
    model,
    turnsUsed: turn,
    violations: check.ok ? undefined : ["ran out of turns before a verified case file"],
  };
}

export function toStoredCase(result: InvestigateResult): StoredCase {
  return {
    episode_id: result.episodeId,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    model: result.model,
    verified: result.verified,
    trace: result.trace,
    case: result.case,
  };
}
