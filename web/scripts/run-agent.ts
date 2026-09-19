/**
 * Generate the cached case files the site serves.
 *
 * With ANTHROPIC_API_KEY set, each selected episode is investigated by the agent and the
 * result is verified before it is written. Without a key, every case is built from the
 * deterministic template instead, so a fresh clone still produces a complete, honest site.
 *
 *   npx tsx scripts/run-agent.ts                    every flagged episode
 *   npx tsx scripts/run-agent.ts --site texas-city  one site
 *   npx tsx scripts/run-agent.ts --limit 5 --force  a quick sample, ignoring cache
 *   npx tsx scripts/run-agent.ts --template         force the no-model path
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, getEpisodes, getSites } from "../lib/data";
import { buildClient, describeProvider, hasModel } from "../lib/llm/client";
import { investigate, toStoredCase } from "../lib/llm/agent";
import { buildTemplateCase } from "../lib/llm/template";
import type { Episode, StoredCase } from "../lib/types";

const CASES_DIR = join(DATA_DIR, "cases");

/** Which episodes earn an investigation: the interesting ones, plus a few clear matches
 *  so the site shows what agreement looks like, not only disagreement. */
function selectEpisodes(episodes: Episode[]): Episode[] {
  const flagged = episodes.filter((e) => e.verdict === "UNEXPLAINED" || e.verdict === "WEAK_MATCH");
  const matched = episodes
    .filter((e) => e.verdict === "MATCHED")
    .sort((a, b) => b.peak_ppb - a.peak_ppb)
    .slice(0, 5);
  const regional = episodes.filter((e) => e.verdict === "REGIONAL").slice(0, 2);
  return [...flagged, ...matched, ...regional].sort((a, b) => b.peak_ppb - a.peak_ppb);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const onlySite = arg("site");
  const limit = Number(arg("limit") ?? Infinity);
  const force = flag("force");
  const templateOnly = flag("template") || !hasModel();

  if (templateOnly && !flag("template")) {
    console.log("No model key found: writing template case files.");
    console.log("Every episode still gets a complete case; the prose is assembled from");
    console.log("pipeline output rather than written by a model.");
    console.log("Set GEMINI_API_KEY (free, no card) or OPENAI_API_KEY + OPENAI_BASE_URL");
    console.log("to have the investigator write them instead.\n");
  } else if (!templateOnly) {
    console.log(`using ${describeProvider()}\n`);
  }

  await mkdir(CASES_DIR, { recursive: true });
  const built = templateOnly ? null : buildClient("agent");

  let written = 0;
  let skipped = 0;
  const failures: string[] = [];
  const counts = { verified: 0, template: 0 };

  for (const site of await getSites()) {
    if (onlySite && site.id !== onlySite) continue;
    const selected = selectEpisodes(await getEpisodes(site.id));
    console.log(`${site.name}: ${selected.length} episodes selected`);

    for (const episode of selected.slice(0, Math.min(selected.length, limit - written))) {
      const path = join(CASES_DIR, `${episode.id}.json`);
      if (existsSync(path) && !force) {
        skipped += 1;
        continue;
      }
      try {
        let stored: StoredCase;
        if (built) {
          const result = await investigate(episode.id, { client: built.client, model: built.model });
          stored = toStoredCase(result);
          if (result.verified === "template" && result.violations) {
            console.warn(`  ${episode.id}: fell back to template (${result.violations[0]})`);
          }
        } else {
          stored = {
            episode_id: episode.id,
            generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
            model: "none (deterministic template)",
            verified: "template",
            trace: [],
            case: await buildTemplateCase(episode.id),
          };
        }
        await writeFile(path, JSON.stringify(stored, null, 1), "utf8");
        counts[stored.verified === true ? "verified" : "template"] += 1;
        written += 1;
        if (written % 25 === 0) console.log(`  ${written} written`);
      } catch (err) {
        // Free tiers rate-limit mid-batch, and any provider can have a bad minute. One
        // failed call must not leave an episode with no case file at all, so the
        // deterministic template takes over for that episode and the run continues.
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(`${episode.id}: ${reason}`);
        try {
          await writeFile(path, JSON.stringify({
            episode_id: episode.id,
            generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
            model: "template (model call failed)",
            verified: "template",
            trace: [],
            case: await buildTemplateCase(episode.id),
          } satisfies StoredCase, null, 1), "utf8");
          counts.template += 1;
          written += 1;
        } catch {
          // If even the template cannot be built, the episode is genuinely broken.
        }
      }
      if (written >= limit) break;
    }
    if (written >= limit) break;
  }

  console.log(`\nwrote ${written} case files (${counts.verified} model-verified, ` +
    `${counts.template} template), skipped ${skipped} already present`);
  if (failures.length) {
    console.error(`\n${failures.length} model calls failed and fell back to the template:`);
    for (const f of failures.slice(0, 6)) console.error(`  ${f}`);
    if (failures.length > 6) console.error(`  ... and ${failures.length - 6} more`);
    console.error("The site is complete either way; re-run later to upgrade these.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
