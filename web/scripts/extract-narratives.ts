/**
 * Read the cause text on every filed report into a structured taxonomy.
 *
 * Roughly a thousand reports carry a sentence or two of free text: "Sulfur trains C&D
 * tripped and caused unit upset", "Compressor malfunction caused unit upset which resulted
 * in intermittent flaring". Those sentences hold facts no column in the database captures:
 * whether the release went up a flare (elevated, so it may pass over a nearby monitor),
 * whether it was intermittent, whether the operator knew the root cause.
 *
 * This is the job code cannot do and the model can. It runs once, in batch, and the result
 * is cached, so the site never waits on it.
 *
 *   npx tsx scripts/extract-narratives.ts              all reports
 *   npx tsx scripts/extract-narratives.ts --limit 20   a sample
 */

import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// zod resolves its v3-compatible surface at the package root; JSON Schema generation
// lives on the v4 entry point, which is what the structured-output API expects.
import * as z from "zod/v4";

import { DATA_DIR, getEvents, getSites } from "../lib/data";
import { buildClient, describeProvider, hasModel } from "../lib/llm/client";
import type { EventReport } from "../lib/types";

const OUT = join(DATA_DIR, "narratives.json");
const CONCURRENCY = 4;

export const Narrative = z.object({
  cause_category: z.enum([
    "flaring_upset", "sulfur_unit_trip", "power_or_steam_loss", "equipment_failure",
    "leak_or_fugitive", "startup", "shutdown", "maintenance", "weather", "operator_error",
    "unknown",
  ]),
  release_pathway: z.enum(["flare", "stack_or_incinerator", "fugitive", "tank_or_vessel",
                           "multiple", "unknown"]),
  /** Flares and stacks release high, which is how a large release can pass over a nearby
   *  ground monitor and barely register. Null when the text does not say. */
  elevated_release: z.boolean().nullable(),
  intermittent: z.boolean(),
  pollutant_relevant: z.boolean(),
  root_cause_known: z.boolean(),
  summary: z.string().max(180),
});

export type Narrative = z.infer<typeof Narrative>;

export const EXTRACT_SYSTEM = `You read one self-reported air emission event filed by a Texas facility and return structured fields.

Use only the text given. Prefer "unknown" to a guess: a wrong category is worse than an honest blank.

Guidance:
- elevated_release is true when the text describes a flare, stack or incinerator, false when it describes a ground-level leak or a tank, and null when it does not say.
- intermittent is true when the text says the release came and went, rather than running continuously.
- root_cause_known is false when the text says the cause is still under investigation.
- summary is one neutral sentence, 25 words or fewer, describing what happened. Do not judge the facility, and do not use words like illegal, violation or negligent.`;

function renderReport(report: EventReport): string {
  return [
    `Facility: ${report.facility ?? "unknown"}`,
    `Event type: ${report.event_type ?? "unknown"}`,
    `Duration: ${report.duration_h ?? "unknown"} hours`,
    `Process units: ${report.process_units ?? "not stated"}`,
    `Emission points: ${report.n_emission_points}`,
    `Reported pollutant quantity: ${report.pollutant_lb} lb`,
    "",
    `Cause as filed: ${report.cause ?? "not stated"}`,
    `Actions taken: ${report.actions ?? "not stated"}`,
    `Basis for quantities: ${report.basis ?? "not stated"}`,
  ].join("\n");
}

/** Every provider can return JSON text; not every provider takes a JSON Schema the same
 *  way. Asking for JSON and validating with zod works everywhere and fails loudly. */
async function extract(
  client: { create: (r: never) => Promise<{ content: { type: string; text?: string }[] }> },
  model: string,
  report: EventReport,
): Promise<Narrative> {
  const schema = JSON.stringify(z.toJSONSchema(Narrative));
  const res = await client.create({
    model,
    max_tokens: 500,
    system: `${EXTRACT_SYSTEM}\n\nReturn a single JSON object matching this schema, and nothing else. No prose, no markdown fence.\n${schema}`,
    tools: [],
    messages: [{ role: "user", content: renderReport(report) }],
  } as never);
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return Narrative.parse(JSON.parse(text));
}

const flag = (name: string) => process.argv.includes(`--${name}`);
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  if (!hasModel()) {
    console.error("No model key found (tried ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY).");
    console.error("Narrative extraction is the one part of the product that needs a model:");
    console.error("it reads free text. The site works without it; cause text simply stays");
    console.error("unstructured, and case files quote it directly instead.");
    process.exit(0);
  }

  const limit = Number(arg("limit") ?? Infinity);
  const force = flag("force");
  const existing: Record<string, Narrative> =
    existsSync(OUT) && !force ? JSON.parse(readFileSync(OUT, "utf8")) : {};

  const reports: EventReport[] = [];
  for (const site of await getSites()) {
    for (const report of await getEvents(site.id)) {
      if (!report.cause?.trim()) continue;
      if (existing[String(report.incident)] && !force) continue;
      reports.push(report);
    }
  }
  const todo = reports.slice(0, limit);
  console.log(`${todo.length} reports to extract (${Object.keys(existing).length} already cached)`);

  const built = buildClient("extract");
  if (!built) process.exit(0);
  console.log(`using ${describeProvider()}`);
  const failures: string[] = [];
  let done = 0;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (report) => {
      try {
        existing[String(report.incident)] = await extract(built.client as never, built.model, report);
      } catch (err) {
        failures.push(`${report.incident}: ${err instanceof Error ? err.message : String(err)}`);
      }
      done += 1;
      if (done % 50 === 0) console.log(`  ${done}/${todo.length}`);
    }));
    await writeFile(OUT, JSON.stringify(existing, null, 1), "utf8");   // checkpoint as we go
  }

  console.log(`\nwrote ${Object.keys(existing).length} narratives to ${OUT}`);
  if (failures.length) {
    console.error(`${failures.length} failed; first few:`);
    for (const f of failures.slice(0, 5)) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
