/**
 * The verifier.
 *
 * A case file is only worth publishing if every number in it came from a tool result and
 * every claim points at evidence that exists. This is plain code, deliberately: the check
 * on the model must not be another model.
 *
 * Three checks:
 *   numbers   every numeric literal in the prose appears in this run's tool results
 *   evidence  every cited ref was returned by a tool in this run
 *   language  no accusation words; the product says "no matching report", never "illegal"
 */

import type { CaseFile, ToolResultLike } from "./types-internal";

export interface Violation {
  kind: "schema" | "number" | "evidence" | "language";
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Words that turn an observation into an accusation. The audit can say a release has no
 * matching report; it cannot say the release was illegal, or that anyone lied.
 */
export const BANNED_WORDS = [
  "illegal", "illegally", "unlawful", "violation", "violated", "violating",
  "culprit", "guilty", "criminal", "lied", "lying", "cover-up", "coverup",
  "concealed", "conspiracy", "fraud", "negligent", "negligence", "blame", "blamed",
  "polluter", "offender", "perpetrator",
];

/** Small integers read as counts ("three reports"), not as claims about measurements. */
const COUNT_CEILING = 24;

const NUMBER_RE = /-?\d[\d,]*\.?\d*/g;

/** Everything the case file asserts about the world. */
function claimsOf(caseFile: CaseFile): string {
  return [
    caseFile.headline,
    ...(caseFile.reasoning ?? []).map((r) => r.claim),
    ...(caseFile.innocent_explanations ?? []),
    ...(caseFile.what_would_settle_it ?? []),
  ].join("\n");
}

/** Claims plus the request letter. Used for the language check, which applies everywhere. */
function textOf(caseFile: CaseFile): string {
  return [claimsOf(caseFile), caseFile.request_draft ?? ""].join("\n");
}

/** Every number anywhere in a tool result, including nested objects and arrays. */
export function collectNumbers(value: unknown, into = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(value);
    // Tool results carry full precision; prose rounds. Accept the rounded forms too.
    into.add(Math.round(value));
    into.add(Math.round(value * 10) / 10);
    into.add(Math.round(value * 100) / 100);
  } else if (typeof value === "string") {
    // Numbers embedded in strings (timestamps, ids, quantities in free text) count as seen.
    for (const m of value.matchAll(NUMBER_RE)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n)) into.add(n);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, into);
  }
  return into;
}

export function collectRefs(results: ToolResultLike[]): Set<string> {
  const refs = new Set<string>();
  for (const r of results) {
    for (const ref of (r.refs as string[] | undefined) ?? []) refs.add(ref);
  }
  return refs;
}

function numbersIn(text: string): number[] {
  // Strip ISO timestamps and ids first: their digits are labels, not measurements.
  const cleaned = text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:]+Z?/g, " ")
    .replace(/\b\d{2}-\d{3}-\d{4}\b/g, " ")
    .replace(/\bRN\d+\b/gi, " ");
  const out: number[] = [];
  for (const m of cleaned.matchAll(NUMBER_RE)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function isSupported(n: number, known: Set<number>): boolean {
  if (Number.isInteger(n) && Math.abs(n) <= COUNT_CEILING) return true;
  if (known.has(n)) return true;
  // A percentage the model derived from a share the tools returned.
  if (known.has(n / 100) || known.has(Math.round(n) / 100)) return true;
  for (const k of known) {
    if (Math.abs(k - n) < 0.005) return true;
    if (Math.abs(Math.round(k) - n) < 0.005) return true;
    if (Math.abs(Math.round(k * 10) / 10 - n) < 0.005) return true;
  }
  return false;
}

export function verify(
  caseFile: CaseFile,
  toolResults: ToolResultLike[],
  ruleVerdict?: string,
): VerifyResult {
  const violations: Violation[] = [];

  if (!caseFile.headline?.trim()) {
    violations.push({ kind: "schema", detail: "headline is empty" });
  }
  if (caseFile.headline && caseFile.headline.trim().split(/\s+/).length > 18) {
    violations.push({ kind: "schema", detail: "headline is longer than 18 words" });
  }
  if (!caseFile.reasoning?.length) {
    violations.push({ kind: "schema", detail: "reasoning is empty" });
  }
  if (!caseFile.innocent_explanations?.length) {
    violations.push({
      kind: "schema",
      detail: "innocent_explanations is empty; every case must offer benign explanations",
    });
  }
  if (ruleVerdict && caseFile.agrees_with_rules && caseFile.verdict !== ruleVerdict) {
    violations.push({
      kind: "schema",
      detail: `agrees_with_rules is true but verdict ${caseFile.verdict} differs from the rule verdict ${ruleVerdict}`,
    });
  }

  const known = new Set<number>();
  for (const r of toolResults) collectNumbers(r, known);
  // The number check covers claims only. The request letter is a form document: it carries
  // fee thresholds and addresses that are boilerplate, not assertions about the data. The
  // language check below still applies to it.
  for (const n of numbersIn(claimsOf(caseFile))) {
    if (!isSupported(n, known)) {
      violations.push({
        kind: "number",
        detail: `the number ${n} does not appear in any tool result from this run`,
      });
    }
  }

  const refs = collectRefs(toolResults);
  for (const step of caseFile.reasoning ?? []) {
    if (!step.evidence?.length) {
      violations.push({ kind: "evidence", detail: `claim has no evidence: "${step.claim.slice(0, 60)}"` });
      continue;
    }
    for (const ref of step.evidence) {
      if (!refs.has(ref)) {
        violations.push({ kind: "evidence", detail: `unknown evidence reference: ${ref}` });
      }
    }
  }

  const prose = textOf(caseFile).toLowerCase();
  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(prose)) {
      violations.push({ kind: "language", detail: `uses the word "${word}"` });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** The violations, phrased as a correction the model can act on in one retry. */
export function violationsAsPrompt(violations: Violation[]): string {
  const lines = violations.map((v) => `- [${v.kind}] ${v.detail}`).join("\n");
  return [
    "Your case file failed verification. Fix these and call submit_case_file once more:",
    lines,
    "",
    "Rules to keep in mind:",
    "- Every number must come from a tool result in this run. If you cannot source it, leave it out.",
    "- Every evidence id must be one a tool returned.",
    "- Never use accusation words. Say \"no matching report\", not \"illegal\" or \"violation\".",
  ].join("\n");
}
