/**
 * The investigator's tools.
 *
 * Every tool is a pure function over the exported JSON. The model cannot reach data these
 * functions do not hand it, which is what makes the verifier's job possible: any number in
 * a case file must have come through here, or it was invented.
 *
 * Each result carries `refs`, the evidence ids the model must cite.
 */

import {
  getCoverage, getEpisode, getEpisodes, getEvents, getFingerprint, getReport, getSites,
  localTime, placedFacilities, reportsOverlapping,
} from "../data";
import type { Episode, EventReport, Site } from "../types";

export interface ToolResult {
  [key: string]: unknown;
  refs?: string[];
}

export const TOOL_NAMES = [
  "get_episode",
  "get_monitor_context",
  "check_regional",
  "list_upwind_facilities",
  "find_reports",
  "get_report",
  "get_facility_history",
  "submit_case_file",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/* ------------------------------------------------------------------ geometry helpers */

const DEG = Math.PI / 180;

/** Smallest absolute angle between two bearings. Mirrors pipeline/geo.py. */
export function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
}

/** Per-hour upwind score, matching the pipeline's exp(-0.5 (delta/sigma)^2). */
export function hourScore(
  wd: number | null, ws: number | null, bearing: number, alpha: number,
  windSource: string, sigma: { measured: number; modelled: number; light: number; lightMs: number; calmMs: number },
): number | null {
  if (wd === null || ws === null || ws < sigma.calmMs) return null;
  const s = ws < sigma.lightMs ? sigma.light : windSource === "aqs" ? sigma.measured : sigma.modelled;
  const delta = Math.max(0, angDiff(wd, bearing) - alpha);
  return Math.exp(-0.5 * (delta / s) ** 2);
}

const SIGMA = { measured: 15, modelled: 25, light: 45, lightMs: 1.5, calmMs: 0.5 };

function round(x: number | null | undefined, places = 2): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/* ------------------------------------------------------------------ tools */

export async function get_episode(args: { episode_id: string }): Promise<ToolResult> {
  const { site, episode } = await getEpisode(args.episode_id);
  const monitor = site.monitors.find((m) => m.id === episode.monitor_id);
  return {
    episode_id: episode.id,
    site: site.name,
    monitor: { id: episode.monitor_id, has_onsite_wind: monitor?.has_onsite_wind ?? null },
    local_start: localTime(episode.start_utc, site.tz),
    local_end: localTime(episode.end_utc, site.tz),
    start_utc: episode.start_utc,
    end_utc: episode.end_utc,
    n_hours: episode.n_hours,
    peak_ppb: episode.peak_ppb,
    mean_ppb: episode.mean_ppb,
    baseline_ppb: episode.baseline_ppb,
    threshold_ppb: episode.threshold_ppb,
    wind_from_deg: episode.wd_mean_deg,
    wind_speed_ms: episode.ws_mean_ms,
    wind_source: episode.wind_source === "aqs" ? "measured on site" : "modelled",
    rule_verdict: episode.verdict,
    rule_reason: episode.verdict_reason,
    best_incident: episode.best_incident,
    best_confidence: episode.best_confidence,
    n_candidate_reports: episode.candidates.length,
    concurrent_reports_without_pollutant: episode.concurrent_non_pollutant,
    hours: episode.hours.map((h) => ({ t: h.t, ppb: h.ppb, wind_from_deg: h.wd, ws_ms: h.ws })),
    refs: [`ep:${episode.id}`, `mon:${episode.monitor_id}`],
  };
}

export async function get_monitor_context(args: { monitor_id: string }): Promise<ToolResult> {
  const sites = await getSites();
  const site = sites.find((s) => s.monitors.some((m) => m.id === args.monitor_id));
  if (!site) return { error: `unknown monitor: ${args.monitor_id}` };
  const monitor = site.monitors.find((m) => m.id === args.monitor_id)!;
  const fp = (await getFingerprint(site.id))[args.monitor_id] ?? {};
  const all = fp["0"];
  const perYear = Object.entries(fp)
    .filter(([year]) => year !== "0")
    .map(([year, p]) => ({ year: Number(year), peak_deg: p.peak_deg }))
    .sort((a, b) => a.year - b.year);
  const peakBin = all?.bins.find((b) => b.deg === all.peak_deg);
  const coverage = (await getCoverage(site.id))
    .filter((c) => c.monitor_id === args.monitor_id)
    .slice(0, 8)
    .map((c) => ({
      facility: c.facility, rn: c.rn,
      distance_km: round((c.distance_m ?? 0) / 1000, 1),
      bearing_deg: round(c.bearing_deg, 0),
      upwind_share_of_hours: c.upwind_share_hours,
      reported_lb: c.pollutant_lb_total,
      share_of_that_mass_monitor_was_downwind_for: c.visible_mass_share,
    }));
  return {
    monitor_id: args.monitor_id,
    site: site.name,
    has_onsite_wind: monitor.has_onsite_wind,
    measured_wind_share: all?.measured_wind_share ?? null,
    top_percentile_threshold_ppb: all?.threshold_ppb ?? null,
    dominant_wind_direction_for_high_hours: all?.peak_deg ?? null,
    peak_bin_probability: peakBin?.cpf ?? null,
    peak_bin_interval: peakBin ? [peakBin.lo, peakBin.hi] : null,
    lobe_bins_deg: all?.bins.filter((b) => b.lobe).map((b) => b.deg) ?? [],
    peak_direction_by_year: perYear,
    facilities_by_reported_mass: coverage,
    refs: [`mon:${args.monitor_id}`, `fp:${args.monitor_id}`],
  };
}

export async function check_regional(args: { episode_id: string }): Promise<ToolResult> {
  const { site, episode } = await getEpisode(args.episode_id);
  const others: unknown[] = [];
  for (const other of await getSites()) {
    for (const m of other.monitors) {
      if (m.id === episode.monitor_id) continue;
      const eps = await getEpisodes(other.id);
      const overlapping = eps.filter(
        (e) => e.monitor_id === m.id &&
          Date.parse(e.start_utc) < Date.parse(episode.end_utc) &&
          Date.parse(e.end_utc) > Date.parse(episode.start_utc),
      );
      if (overlapping.length) {
        others.push({
          monitor_id: m.id, site: other.name, n_overlapping_episodes: overlapping.length,
          peak_ppb: Math.max(...overlapping.map((e) => e.peak_ppb)),
        });
      }
    }
  }
  return {
    episode_id: episode.id,
    rule_said_regional: episode.verdict === "REGIONAL",
    regional_check_ran: episode.regional_checked,
    context_monitors_high_during_window: episode.regional_monitors_high,
    other_monitors_with_overlapping_episodes: others,
    note: others.length === 0
      ? "No other monitor in the project recorded an episode at the same time, which points to a local source rather than a regional haze day."
      : "Other monitors recorded episodes at the same time, which may indicate a regional cause.",
    refs: [`ep:${episode.id}`],
  };
}

export async function list_upwind_facilities(args: { episode_id: string }): Promise<ToolResult> {
  const { site, episode } = await getEpisode(args.episode_id);
  const facilities = placedFacilities(site);
  const rows = facilities.map((f) => {
    const scores = episode.hours.map((h) =>
      hourScore(h.wd, h.ws, f.bearing_deg ?? 0, f.alpha_deg ?? 0, episode.wind_source, SIGMA));
    const usable = scores.filter((s): s is number => s !== null);
    const upwind = usable.filter((s) => s >= 0.5);
    return {
      facility: f.name, rn: f.rn,
      distance_km: round((f.distance_m ?? 0) / 1000, 1),
      direction_from_monitor_deg: round(f.bearing_deg, 0),
      angular_half_width_deg: round(f.alpha_deg, 1),
      hours_upwind: upwind.length,
      hours_with_usable_wind: usable.length,
      share_of_episode_upwind: usable.length ? round(upwind.length / usable.length, 2) : null,
      coordinates_from: f.coord_source,
      footprint_from: f.footprint_source,
      total_reported_lb: f.pollutant_lb_total,
    };
  });
  rows.sort((a, b) => (b.share_of_episode_upwind ?? 0) - (a.share_of_episode_upwind ?? 0));
  return {
    episode_id: episode.id,
    wind_during_episode_from_deg: episode.wd_mean_deg,
    facilities: rows,
    note: "Upwind means the wind arrived from that facility's direction, allowing for its width and the wind's uncertainty. It does not by itself mean the facility released anything.",
    refs: [`ep:${episode.id}`, ...rows.map((r) => `fac:${r.rn}`)],
  };
}

export async function find_reports(
  args: { episode_id: string; pad_hours?: number },
): Promise<ToolResult> {
  const { site, episode } = await getEpisode(args.episode_id);
  const pad = args.pad_hours ?? 24;
  const all = await getEvents(site.id);
  const overlapping = reportsOverlapping(all, episode.start_utc, episode.end_utc, pad);
  const byIncident = new Map(episode.candidates.map((c) => [c.incident, c]));
  return {
    episode_id: episode.id,
    searched_counties: site.counties,
    window_padded_hours: pad,
    n_found: overlapping.length,
    reports: overlapping.map((r) => {
      const c = byIncident.get(r.incident);
      return {
        incident: r.incident, facility: r.facility, rn: r.rn,
        start_utc: r.start_utc, end_utc: r.end_utc, duration_h: r.duration_h,
        local_start: localTime(r.start_utc, site.tz),
        pollutant_lb: r.pollutant_lb,
        lists_the_pollutant: r.pollutant_lb > 0,
        event_type: r.event_type,
        cause: r.cause,
        scored_confidence: c?.confidence ?? null,
        time_overlap_share: c?.s_time ?? null,
        upwind_score: c?.s_bearing ?? null,
        url: r.url,
      };
    }),
    note: overlapping.length === 0
      ? "No facility in the searched counties filed any report covering this window. That is not proof of an unreported release: a release below the reportable quantity, permitted emissions, a mobile source, or a source outside these counties would all leave no report."
      : undefined,
    refs: [`ep:${episode.id}`, ...overlapping.map((r) => `inc:${r.incident}`)],
  };
}

export async function get_report(args: { incident: number }): Promise<ToolResult> {
  const found = await getReport(args.incident);
  if (!found) return { error: `unknown incident: ${args.incident}` };
  const { site, report } = found;
  const facility = site.facilities.find((f) => f.rn === report.rn);
  return {
    incident: report.incident, facility: report.facility, operator: report.operator, rn: report.rn,
    event_type: report.event_type, report_type: report.report_type,
    start_utc: report.start_utc, end_utc: report.end_utc, duration_h: report.duration_h,
    local_start: localTime(report.start_utc, site.tz),
    notified_utc: report.notified_utc,
    pollutant_lb: report.pollutant_lb,
    n_emission_points: report.n_emission_points,
    process_units: report.process_units,
    cause: report.cause, actions_taken: report.actions, basis_for_quantities: report.basis,
    monitor_saw: report.visibility
      ? {
          status: report.visibility.status,
          peak_ppb_during: report.visibility.peak_ppb_during,
          baseline_ppb: report.visibility.baseline_ppb,
          share_of_hours_monitor_was_downwind: report.visibility.upwind_share,
        }
      : null,
    distance_from_monitor_km: round((facility?.distance_m ?? 0) / 1000, 1),
    source_url: report.url,
    refs: [`inc:${report.incident}`, `fac:${report.rn}`],
  };
}

export async function get_facility_history(
  args: { rn: string; days?: number; around_episode_id?: string },
): Promise<ToolResult> {
  const days = args.days ?? 30;
  const sites = await getSites();
  const site = sites.find((s) => s.facilities.some((f) => f.rn === args.rn));
  if (!site) return { error: `unknown facility: ${args.rn}` };
  const facility = site.facilities.find((f) => f.rn === args.rn)!;
  const all = (await getEvents(site.id)).filter((e) => e.rn === args.rn);

  let window = all;
  if (args.around_episode_id) {
    const { episode } = await getEpisode(args.around_episode_id);
    const centre = Date.parse(episode.start_utc);
    const span = days * 86_400_000;
    window = all.filter((e) => Math.abs(Date.parse(e.start_utc) - centre) <= span);
  }
  const counts = all.reduce<Record<string, number>>((acc, e) => {
    const status = e.visibility?.status ?? "NOT_ASSESSED";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    rn: args.rn, facility: facility.name,
    distance_km: round((facility.distance_m ?? 0) / 1000, 1),
    coordinates_from: facility.coord_source,
    total_reports: all.length,
    total_reported_lb: facility.pollutant_lb_total,
    visibility_across_all_reports: counts,
    reports_near_the_episode: window.map((e) => ({
      incident: e.incident, start_utc: e.start_utc, duration_h: e.duration_h,
      pollutant_lb: e.pollutant_lb, event_type: e.event_type, cause: e.cause,
      monitor_saw: e.visibility?.status ?? null,
    })),
    refs: [`fac:${args.rn}`, ...window.map((e) => `inc:${e.incident}`)],
  };
}

/* ------------------------------------------------------------------ dispatch */

type Handler = (args: never) => Promise<ToolResult>;

const HANDLERS: Record<Exclude<ToolName, "submit_case_file">, Handler> = {
  get_episode: get_episode as Handler,
  get_monitor_context: get_monitor_context as Handler,
  check_regional: check_regional as Handler,
  list_upwind_facilities: list_upwind_facilities as Handler,
  find_reports: find_reports as Handler,
  get_report: get_report as Handler,
  get_facility_history: get_facility_history as Handler,
};

export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const handler = HANDLERS[name as Exclude<ToolName, "submit_case_file">];
  if (!handler) return { error: `unknown tool: ${name}` };
  try {
    return await (handler as (a: Record<string, unknown>) => Promise<ToolResult>)(args);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** A one-line summary for the evidence board, so a reader follows without reading JSON. */
export function summarise(name: string, result: ToolResult): string {
  if (result.error) return `error: ${String(result.error)}`;
  switch (name) {
    case "get_episode":
      return `${result.n_hours} h, peak ${result.peak_ppb} ppb, wind from ${result.wind_from_deg}°`;
    case "get_monitor_context":
      return `high hours mostly arrive from ${result.dominant_wind_direction_for_high_hours}°`;
    case "check_regional": {
      const n = (result.other_monitors_with_overlapping_episodes as unknown[])?.length ?? 0;
      return n === 0 ? "no other monitor was high at the same time" : `${n} other monitors were also high`;
    }
    case "list_upwind_facilities": {
      const rows = (result.facilities as { facility: string; share_of_episode_upwind: number | null }[]) ?? [];
      const top = rows[0];
      return top ? `${rows.length} facilities checked, closest fit ${top.facility}` : "no placed facilities";
    }
    case "find_reports":
      return `${result.n_found} reports overlap the padded window`;
    case "get_report":
      return `incident ${result.incident}: ${result.pollutant_lb} lb, monitor ${
        (result.monitor_saw as { status?: string } | null)?.status ?? "not assessed"}`;
    case "get_facility_history":
      return `${result.total_reports} reports on file, ${result.total_reported_lb} lb total`;
    default:
      return name;
  }
}

/* ------------------------------------------------------------------ schemas */

const s = (description: string) => ({ type: "string" as const, description });
const n = (description: string) => ({ type: "number" as const, description });

export const TOOL_SCHEMAS = [
  {
    name: "get_episode",
    description:
      "The episode itself: every hour with its reading and wind, the monitor's threshold, and the rule-based verdict with its reason. Start here.",
    input_schema: {
      type: "object" as const,
      properties: { episode_id: s("Episode id, e.g. 48-167-0005_20230420T13") },
      required: ["episode_id"], additionalProperties: false,
    },
  },
  {
    name: "get_monitor_context",
    description:
      "Long-run behaviour of this monitor: which wind directions bring its worst hours, whether that pattern is stable year to year, and how often it sits downwind of each facility.",
    input_schema: {
      type: "object" as const,
      properties: { monitor_id: s("Monitor id, e.g. 48-167-0005") },
      required: ["monitor_id"], additionalProperties: false,
    },
  },
  {
    name: "check_regional",
    description:
      "Whether other monitors were also high during this window. Use it before calling anything local, so a regional haze day is not mistaken for a nearby release.",
    input_schema: {
      type: "object" as const,
      properties: { episode_id: s("Episode id") },
      required: ["episode_id"], additionalProperties: false,
    },
  },
  {
    name: "list_upwind_facilities",
    description:
      "Every facility with known coordinates, with the share of episode hours the wind arrived from its direction, its distance and its angular width.",
    input_schema: {
      type: "object" as const,
      properties: { episode_id: s("Episode id") },
      required: ["episode_id"], additionalProperties: false,
    },
  },
  {
    name: "find_reports",
    description:
      "Self-reported emission events overlapping the episode window, any pollutant, with the padding you choose. Use a wider pad to catch a release reported as starting slightly later.",
    input_schema: {
      type: "object" as const,
      properties: {
        episode_id: s("Episode id"),
        pad_hours: n("Hours of padding each side of the episode. Default 24."),
      },
      required: ["episode_id"], additionalProperties: false,
    },
  },
  {
    name: "get_report",
    description:
      "One filed report in full: quantities, cause text, actions taken, the basis for the estimate, and what the monitor recorded during it.",
    input_schema: {
      type: "object" as const,
      properties: { incident: n("TCEQ incident number, e.g. 399287") },
      required: ["incident"], additionalProperties: false,
    },
  },
  {
    name: "get_facility_history",
    description:
      "A facility's filing history, and how often the monitor recorded anything during its reports. Useful when timing looks adjacent rather than overlapping.",
    input_schema: {
      type: "object" as const,
      properties: {
        rn: s("TCEQ regulated entity number, e.g. RN102535077"),
        days: n("Window each side of the episode. Default 30."),
        around_episode_id: s("Episode to centre the window on"),
      },
      required: ["rn"], additionalProperties: false,
    },
  },
  {
    name: "submit_case_file",
    description:
      "Finish the investigation. Call exactly once, with every claim backed by evidence ids the tools returned.",
    input_schema: {
      type: "object" as const,
      properties: {
        verdict: {
          type: "string" as const, enum: ["MATCHED", "WEAK_MATCH", "UNEXPLAINED", "REGIONAL"],
          description: "Your verdict, which may differ from the rule-based one.",
        },
        agrees_with_rules: { type: "boolean" as const, description: "Does your verdict match get_episode's rule_verdict?" },
        confidence_label: { type: "string" as const, enum: ["low", "medium", "high"] },
        headline: s("One sentence, 18 words or fewer, in plain language."),
        reasoning: {
          type: "array" as const, minItems: 3, maxItems: 6,
          items: {
            type: "object" as const,
            properties: {
              claim: s("One specific claim. Every number must come from a tool result."),
              evidence: { type: "array" as const, items: { type: "string" as const },
                description: "Evidence ids returned by tools, e.g. ep:..., inc:..., fac:..." },
            },
            required: ["claim", "evidence"], additionalProperties: false,
          },
        },
        innocent_explanations: {
          type: "array" as const, minItems: 2, maxItems: 4, items: { type: "string" as const },
          description: "Lawful or benign explanations that fit the same evidence.",
        },
        what_would_settle_it: {
          type: "array" as const, minItems: 1, maxItems: 3, items: { type: "string" as const },
          description: "The specific records or measurements that would resolve the question.",
        },
        request_draft: s("A public-records request the resident can review and send themselves."),
      },
      required: ["verdict", "agrees_with_rules", "confidence_label", "headline", "reasoning",
                 "innocent_explanations", "what_would_settle_it", "request_draft"],
      additionalProperties: false,
    },
  },
];
