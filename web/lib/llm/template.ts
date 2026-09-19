/**
 * The case file the pipeline can write by itself.
 *
 * This exists for three reasons, in order of importance:
 *   1. It is the fallback when the model's draft fails verification twice.
 *   2. It means the product still works with no API key at all, so a judge who opens the
 *      site sees every case file, not an error state.
 *   3. It is the baseline the model has to beat. If the generated prose is not clearly
 *      better than this, the model is not earning its place.
 *
 * Every sentence is assembled from pipeline output. Nothing here is generated.
 */

import { getEpisode, getEvents, getSite, localTime, placedFacilities } from "../data";
import type { CaseFile, Episode, Site, Verdict } from "../types";

/** Source records shout names in capitals; prose written for a resident should not. */
function titleCase(name: string | null | undefined): string {
  if (!name) return "the facility";
  return name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function degToCompass(deg: number | null): string {
  if (deg === null) return "an unknown direction";
  const points = ["north", "north-north-east", "north-east", "east-north-east", "east",
    "east-south-east", "south-east", "south-south-east", "south", "south-south-west",
    "south-west", "west-south-west", "west", "west-north-west", "north-west", "north-north-west"];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]!;
}

const HEADLINES: Record<Verdict, (e: Episode) => string> = {
  MATCHED: (e) => `A filed report explains this ${e.peak_ppb} ppb episode.`,
  WEAK_MATCH: (e) => `A report overlaps this ${e.peak_ppb} ppb episode, but the fit is partial.`,
  UNEXPLAINED: (e) => `No filed report covers this ${e.peak_ppb} ppb episode.`,
  REGIONAL: (e) => `This ${e.peak_ppb} ppb episode looks regional, not local.`,
};

const INNOCENT_COMMON = [
  "A release below the reportable quantity would leave no filed report at all.",
  "Permitted, routine emissions can build up when the air is still and the plume stays low.",
  "Ships, trucks and other mobile sources are not covered by this reporting system.",
  "A source outside the searched counties would not appear in this search.",
];

export async function buildTemplateCase(episodeId: string): Promise<CaseFile> {
  const { site, episode } = await getEpisode(episodeId);
  const events = await getEvents(site.id);
  const facilities = placedFacilities(site);

  const startLocal = localTime(episode.start_utc, site.tz);
  const direction = degToCompass(episode.wd_mean_deg);
  const windWord = episode.wind_source === "aqs" ? "measured at the monitor" : "modelled";
  const best = episode.candidates.find((c) => c.is_best) ?? episode.candidates[0];
  const bestReport = best ? events.find((e) => e.incident === best.incident) : undefined;
  const nearest = facilities[0];

  const reasoning: CaseFile["reasoning"] = [
    {
      claim: `The monitor recorded ${episode.peak_ppb} ppb at its peak on ${startLocal}, ` +
        `against a background near ${episode.baseline_ppb} ppb, over ${episode.n_hours} hours.`,
      evidence: [`ep:${episode.id}`, `mon:${episode.monitor_id}`],
    },
    {
      claim: `Through the episode the wind came from the ${direction}, ${windWord}.`,
      evidence: [`ep:${episode.id}`],
    },
  ];

  if (best && bestReport) {
    reasoning.push({
      claim: `The closest filed report is incident ${best.incident} from ${titleCase(best.facility)}, ` +
        `listing ${bestReport.pollutant_lb} pounds, with ${Math.round((best.s_time ?? 0) * 100)}% ` +
        `of the episode's hours inside its window.`,
      evidence: [`inc:${best.incident}`, `fac:${best.rn}`],
    });
  } else {
    reasoning.push({
      claim: `No facility in ${site.counties.map(titleCase).join(" or ")} County filed a report listing this ` +
        `pollutant for this window.`,
      evidence: [`ep:${episode.id}`],
    });
    if (nearest) {
      reasoning.push({
        claim: `The nearest facility with public coordinates is ${titleCase(nearest.name)}, ` +
          `${((nearest.distance_m ?? 0) / 1000).toFixed(1)} km away.`,
        evidence: [`fac:${nearest.rn}`],
      });
    }
  }

  if (episode.verdict === "REGIONAL" || episode.regional_monitors_high > 0) {
    reasoning.push({
      claim: `Other monitors were also high during this window, which points away from a ` +
        `single nearby source and makes the absence of a local report unremarkable.`,
      evidence: [`ep:${episode.id}`],
    });
  }

  const settle = [
    "Sub-hourly data from the monitor for this window, which would show whether the rise was a sharp plume or a slow build.",
    "Any complaint or investigation records the agency holds for this date.",
  ];
  if (!best) {
    settle.push("Records of any emission event, maintenance, startup or shutdown at facilities upwind within 24 hours.");
  }

  return {
    verdict: episode.verdict,
    agrees_with_rules: true,
    confidence_label: episode.verdict === "UNEXPLAINED" && episode.n_hours >= 3 ? "medium" : "low",
    headline: HEADLINES[episode.verdict](episode),
    reasoning,
    innocent_explanations: INNOCENT_COMMON.slice(0, best ? 2 : 4),
    what_would_settle_it: settle.slice(0, 3),
    request_draft: buildRequestDraft(site, episode),
  };
}

export function buildRequestDraft(site: Site, episode: Episode): string {
  const startLocal = localTime(episode.start_utc, site.tz);
  const endLocal = localTime(episode.end_utc, site.tz);
  return [
    "To: Texas Commission on Environmental Quality, Public Information Coordinator",
    `Subject: Public information request, air monitoring and incident records, ${site.name}`,
    "",
    "Dear Public Information Coordinator,",
    "",
    "Under the Texas Public Information Act, I request copies of the following records.",
    "",
    `1. All ambient air monitoring data, at the finest time resolution held, for monitor ` +
      `${episode.monitor_id} from ${startLocal} to ${endLocal} local time.`,
    "2. Any citizen complaints, investigation reports or field notes relating to air quality " +
      `in ${site.name} for that period.`,
    "3. Any emission event, maintenance, startup or shutdown notifications received for " +
      `facilities in ${site.counties.map(titleCase).join(" or ")} County covering that period, including ` +
      "any submitted after the deadline.",
    "",
    "This is a request for public records. It is not an allegation that any facility did " +
    "anything improper.",
    "",
    "If any portion is withheld, please cite the exemption claimed and release the remainder. " +
    "If fees will exceed $50, please contact me first with an estimate.",
    "",
    "Sincerely,",
    "[your name]",
    "[your address]",
    "[your email and phone]",
  ].join("\n");
}
