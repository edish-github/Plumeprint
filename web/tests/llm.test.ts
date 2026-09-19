/**
 * The LLM layer, tested without an API key.
 *
 * A scripted model client replays a fixed sequence of tool calls, so the loop, the
 * verifier and the fallback are all exercised deterministically. What this cannot test is
 * whether the real model writes good prose; what it does test is that nothing it writes
 * can reach a user unverified.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { getEpisodes, getSites } from "../lib/data";
import { investigate, toStoredCase } from "../lib/llm/agent";
import { buildTemplateCase } from "../lib/llm/template";
import { angDiff, hourScore, runTool, summarise, TOOL_SCHEMAS } from "../lib/llm/tools";
import type { CaseFile, ModelClient, ModelRequest, ModelResponse } from "../lib/llm/types-internal";
import { collectNumbers, verify } from "../lib/llm/verifier";

/** A model that replays scripted turns and records what it was sent. */
function scripted(turns: ModelResponse[]): ModelClient & { requests: ModelRequest[] } {
  let i = 0;
  const requests: ModelRequest[] = [];
  return {
    requests,
    async create(request: ModelRequest) {
      requests.push(request);
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      return turn!;
    },
  };
}

const useTool = (id: string, name: string, input: Record<string, unknown>): ModelResponse => ({
  content: [{ type: "tool_use", id, name, input }],
});

async function anEpisode(verdict?: string) {
  const sites = await getSites();
  for (const site of sites) {
    const episodes = await getEpisodes(site.id);
    const hit = verdict ? episodes.find((e) => e.verdict === verdict) : episodes[0];
    if (hit) return hit;
  }
  throw new Error(`no episode with verdict ${verdict}`);
}

/* ------------------------------------------------------------------ geometry parity */

test("angDiff matches the pipeline's wrap-around behaviour", () => {
  assert.equal(angDiff(350, 10), 20);
  assert.equal(angDiff(10, 350), 20);
  assert.equal(angDiff(0, 180), 180);
});

test("hourScore is 1 inside the span and NaN-free for calm hours", () => {
  const sigma = { measured: 15, modelled: 25, light: 45, lightMs: 1.5, calmMs: 0.5 };
  assert.equal(hourScore(145, 5, 133, 13, "openmeteo", sigma), 1);
  assert.equal(hourScore(145, 0.2, 145, 0, "aqs", sigma), null);
  assert.equal(hourScore(null, 5, 145, 0, "aqs", sigma), null);
  const oneSigma = hourScore(170, 5, 145, 0, "openmeteo", sigma)!;
  assert.ok(Math.abs(oneSigma - Math.exp(-0.5)) < 1e-9);
});

/* ------------------------------------------------------------------ tools */

test("every tool schema is declared and dispatchable", async () => {
  const names = TOOL_SCHEMAS.map((t) => t.name);
  assert.ok(names.includes("submit_case_file"));
  for (const name of names) {
    if (name === "submit_case_file") continue;
    const result = await runTool(name, {});
    // Missing arguments must produce a handled error, never a thrown exception.
    assert.ok("error" in result, `${name} should report an error for empty args`);
  }
});

test("get_episode returns the episode with its rule verdict and evidence refs", async () => {
  const episode = await anEpisode();
  const result = await runTool("get_episode", { episode_id: episode.id });
  assert.equal(result.episode_id, episode.id);
  assert.equal(result.rule_verdict, episode.verdict);
  assert.equal(result.peak_ppb, episode.peak_ppb);
  assert.ok(result.refs?.includes(`ep:${episode.id}`));
  assert.ok(Array.isArray(result.hours) && (result.hours as unknown[]).length > 0);
});

test("find_reports on an unexplained episode says so plainly", async () => {
  const episode = await anEpisode("UNEXPLAINED");
  const result = await runTool("find_reports", { episode_id: episode.id, pad_hours: 0 });
  assert.equal(result.n_found, 0);
  assert.match(String(result.note), /not proof/i);
});

test("list_upwind_facilities ranks by how much of the episode was upwind", async () => {
  const episode = await anEpisode();
  const result = await runTool("list_upwind_facilities", { episode_id: episode.id });
  const rows = result.facilities as { share_of_episode_upwind: number | null }[];
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok((rows[i - 1]!.share_of_episode_upwind ?? 0) >= (rows[i]!.share_of_episode_upwind ?? 0));
  }
});

test("unknown tools and ids fail without throwing", async () => {
  assert.match(String((await runTool("nope", {})).error), /unknown tool/);
  assert.match(String((await runTool("get_episode", { episode_id: "nope" })).error), /unknown episode/);
  assert.match(String((await runTool("get_report", { incident: -1 })).error), /unknown incident/);
});

test("summaries stay one readable line", async () => {
  const episode = await anEpisode();
  const result = await runTool("get_episode", { episode_id: episode.id });
  const line = summarise("get_episode", result);
  assert.ok(line.length < 90 && !line.includes("\n"));
});

/* ------------------------------------------------------------------ verifier */

const goodCase = (episodeId: string, verdict: CaseFile["verdict"] = "UNEXPLAINED"): CaseFile => ({
  verdict,
  agrees_with_rules: true,
  confidence_label: "medium",
  headline: "No filed report covers this episode.",
  reasoning: [
    { claim: "The monitor read above its threshold for several hours.", evidence: [`ep:${episodeId}`] },
    { claim: "No facility filed a report for the window.", evidence: [`ep:${episodeId}`] },
    { claim: "The wind was steady through the episode.", evidence: [`ep:${episodeId}`] },
  ],
  innocent_explanations: ["A release below the reportable quantity leaves no report."],
  what_would_settle_it: ["Sub-hourly monitor data for the window."],
  request_draft: "Dear Public Information Coordinator, I request records for this period.",
});

test("a clean case file passes", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  assert.equal(verify(goodCase(episode.id, episode.verdict), results, episode.verdict).ok, true);
});

test("an invented number is caught", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  const bad = goodCase(episode.id, episode.verdict);
  bad.reasoning[0]!.claim = "The monitor peaked at 918.4 ppb during the episode.";
  const check = verify(bad, results);
  assert.equal(check.ok, false);
  assert.ok(check.violations.some((v) => v.kind === "number" && v.detail.includes("918.4")));
});

test("a real number from the tools is accepted", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  const ok = goodCase(episode.id, episode.verdict);
  ok.reasoning[0]!.claim = `The monitor peaked at ${episode.peak_ppb} ppb during the episode.`;
  assert.equal(verify(ok, results, episode.verdict).ok, true);
});

test("an unknown evidence reference is caught", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  const bad = goodCase(episode.id, episode.verdict);
  bad.reasoning[1]!.evidence = ["inc:999999999"];
  const check = verify(bad, results);
  assert.equal(check.ok, false);
  assert.ok(check.violations.some((v) => v.kind === "evidence"));
});

test("every accusation word is caught", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  for (const word of ["illegal", "violation", "culprit", "lied", "cover-up", "polluter", "blame"]) {
    const bad = goodCase(episode.id, episode.verdict);
    bad.headline = `This was an ${word} release.`;
    const check = verify(bad, results);
    assert.equal(check.ok, false, `"${word}" should be rejected`);
    assert.ok(check.violations.some((v) => v.kind === "language"));
  }
});

test("a claim with no evidence is caught", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  const bad = goodCase(episode.id, episode.verdict);
  bad.reasoning[0]!.evidence = [];
  assert.ok(verify(bad, results).violations.some((v) => v.kind === "evidence"));
});

test("claiming agreement while disagreeing is caught", async () => {
  const episode = await anEpisode();
  const results = [await runTool("get_episode", { episode_id: episode.id })];
  const bad = goodCase(episode.id);
  bad.verdict = "MATCHED";
  bad.agrees_with_rules = true;
  assert.equal(verify(bad, results, "UNEXPLAINED").ok, false);
});

test("collectNumbers reaches into nested tool results", () => {
  const found = collectNumbers({ a: 1.234, b: [{ c: 5 }], d: "peak 43.7 ppb" });
  assert.ok(found.has(1.234) && found.has(5) && found.has(43.7));
});

/* ------------------------------------------------------------------ template */

test("the template case file passes its own verifier", async () => {
  const episode = await anEpisode();
  const built = await buildTemplateCase(episode.id);
  const results = [
    await runTool("get_episode", { episode_id: episode.id }),
    await runTool("find_reports", { episode_id: episode.id }),
    await runTool("list_upwind_facilities", { episode_id: episode.id }),
  ];
  const check = verify(built, results, episode.verdict);
  assert.equal(check.ok, true, JSON.stringify(check.violations));
});

test("the template works for every verdict the pipeline produces", async () => {
  for (const verdict of ["UNEXPLAINED", "MATCHED", "WEAK_MATCH"]) {
    let episode;
    try {
      episode = await anEpisode(verdict);
    } catch {
      continue; // that verdict may not occur in this data slice
    }
    const built = await buildTemplateCase(episode.id);
    assert.equal(built.verdict, verdict);
    assert.ok(built.reasoning.length >= 3, `${verdict} needs at least three claims`);
    assert.ok(built.innocent_explanations.length >= 2);
    assert.ok(built.request_draft.includes("Texas Public Information Act"));
    assert.ok(!/\b(illegal|violation|culprit)\b/i.test(JSON.stringify(built)));
  }
});

/* ------------------------------------------------------------------ agent loop */

test("the loop runs tools, then accepts a verified submission", async () => {
  const episode = await anEpisode();
  const client = scripted([
    useTool("t1", "get_episode", { episode_id: episode.id }),
    useTool("t2", "find_reports", { episode_id: episode.id }),
    useTool("t3", "submit_case_file", goodCase(episode.id, episode.verdict) as unknown as Record<string, unknown>),
  ]);
  const result = await investigate(episode.id, { client });
  assert.equal(result.verified, true);
  assert.equal(result.trace.length, 2);
  assert.deepEqual(result.trace.map((s) => s.tool), ["get_episode", "find_reports"]);
  assert.equal(client.requests[0]!.system.includes("PlumePrint's investigator"), true);
});

test("a failed draft gets exactly one retry, then falls back", async () => {
  const episode = await anEpisode();
  const bad = goodCase(episode.id, episode.verdict);
  bad.headline = "This facility acted illegally.";
  const client = scripted([
    useTool("t1", "get_episode", { episode_id: episode.id }),
    useTool("t2", "submit_case_file", bad as unknown as Record<string, unknown>),
    useTool("t3", "submit_case_file", bad as unknown as Record<string, unknown>),
  ]);
  const result = await investigate(episode.id, { client });
  assert.equal(result.verified, "template");
  assert.ok(!/illegal/i.test(JSON.stringify(result.case)));
  assert.ok(result.violations?.some((v) => v.includes("language")));
});

test("the retry prompt names the violations", async () => {
  const episode = await anEpisode();
  const bad = goodCase(episode.id, episode.verdict);
  bad.reasoning[0]!.claim = "The peak was 918.4 ppb.";
  const client = scripted([
    useTool("t1", "get_episode", { episode_id: episode.id }),
    useTool("t2", "submit_case_file", bad as unknown as Record<string, unknown>),
    useTool("t3", "submit_case_file", goodCase(episode.id, episode.verdict) as unknown as Record<string, unknown>),
  ]);
  const result = await investigate(episode.id, { client });
  assert.equal(result.verified, true);
  const sent = JSON.stringify(client.requests.at(-1)!.messages);
  assert.ok(sent.includes("918.4"), "the retry should tell the model which number was unsupported");
});

test("a model that never submits still ends with a usable case", async () => {
  const episode = await anEpisode();
  const client = scripted([useTool("t1", "get_episode", { episode_id: episode.id })]);
  const result = await investigate(episode.id, { client, maxTurns: 3 });
  assert.equal(result.verified, "template");
  assert.ok(result.case.headline.length > 0);
  assert.ok(result.turnsUsed <= 3);
});

test("a model that only talks is nudged back to the tools", async () => {
  const episode = await anEpisode();
  const client = scripted([
    { content: [{ type: "text", text: "Let me think about this." }] },
    useTool("t1", "get_episode", { episode_id: episode.id }),
    useTool("t2", "submit_case_file", goodCase(episode.id, episode.verdict) as unknown as Record<string, unknown>),
  ]);
  const result = await investigate(episode.id, { client });
  assert.equal(result.verified, true);
});

test("the final turn forces a submission", async () => {
  const episode = await anEpisode();
  const client = scripted([useTool("t1", "get_episode", { episode_id: episode.id })]);
  await investigate(episode.id, { client, maxTurns: 2 });
  const last = client.requests.at(-1)!;
  assert.deepEqual(last.tool_choice, { type: "tool", name: "submit_case_file" });
});

test("stored cases carry provenance", async () => {
  const episode = await anEpisode();
  const client = scripted([
    useTool("t1", "get_episode", { episode_id: episode.id }),
    useTool("t2", "submit_case_file", goodCase(episode.id, episode.verdict) as unknown as Record<string, unknown>),
  ]);
  const stored = toStoredCase(await investigate(episode.id, { client }));
  assert.equal(stored.episode_id, episode.id);
  assert.equal(stored.verified, true);
  assert.match(stored.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(stored.model.length > 0);
});
