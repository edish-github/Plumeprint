/**
 * The view model.
 *
 * Components take plain, already-computed shapes. Every date is a millisecond number and
 * every label is resolved here, so nothing is parsed or formatted during render.
 */

import { getEpisodes, getEvents, getSeries, getSite, getSites } from "./data";
import type { Episode, EventReport, Site, Verdict, VisibilityStatus } from "./types";

export interface ReportSummary {
  incident: number;
  facility: string | null;
  rn: string;
  start: number;
  end: number;
  pollutant_lb: number;
  status: VisibilityStatus;
  peak_ppb_during: number | null;
}

export interface EpisodeSummary {
  id: string;
  start: number;
  end: number;
  peak: number;
  peak_ppb: number;
  n_hours: number;
  verdict: Verdict;
  verdict_reason: string;
  wd_mean_deg: number | null;
  wind_source: string;
  matchedReportStart: number | null;
  matchedIncident: number | null;
}

export interface SiteView {
  site: Site;
  reports: ReportSummary[];
  episodes: EpisodeSummary[];
  from: number;
  to: number;
  maxPeakPpb: number;
  seriesByYear?: Record<number, (number | null)[]>;
}

const ms = (iso: string) => Date.parse(iso);

export function summariseReports(events: EventReport[], minLb: number): ReportSummary[] {
  return events
    .filter((e) => e.pollutant_lb >= minLb && e.visibility)
    .map((e) => ({
      incident: e.incident,
      facility: e.facility,
      rn: e.rn,
      start: ms(e.start_utc),
      end: ms(e.end_utc),
      pollutant_lb: e.pollutant_lb,
      status: e.visibility!.status,
      peak_ppb_during: e.visibility!.peak_ppb_during,
    }))
    .sort((a, b) => a.start - b.start);
}

export function summariseEpisodes(
  episodes: Episode[],
  events: EventReport[],
): EpisodeSummary[] {
  const byIncident = new Map(events.map((e) => [e.incident, e]));
  return episodes
    .map((e) => {
      // A thread is drawn for both matched and weak matches
      const matched =
        (e.verdict === "MATCHED" || e.verdict === "WEAK_MATCH") && e.best_incident !== null
          ? byIncident.get(e.best_incident)
          : undefined;
      return {
        id: e.id,
        start: ms(e.start_utc),
        end: ms(e.end_utc),
        peak: ms(e.t_peak_utc),
        peak_ppb: e.peak_ppb,
        n_hours: e.n_hours,
        verdict: e.verdict,
        verdict_reason: e.verdict_reason,
        wd_mean_deg: e.wd_mean_deg,
        wind_source: e.wind_source,
        matchedReportStart: matched ? ms(matched.start_utc) : null,
        matchedIncident: matched ? matched.incident : null,
      };
    })
    .sort((a, b) => a.start - b.start);
}

export async function buildSiteView(siteId: string, minLb = 1000): Promise<SiteView> {
  const site = await getSite(siteId);
  const events = await getEvents(siteId);
  const episodes = await getEpisodes(siteId);
  const primary = site.monitors.find((m) => m.role === "primary")?.id;

  const reports = summariseReports(events, minLb);
  const eps = summariseEpisodes(
    episodes.filter((e) => !primary || e.monitor_id === primary),
    events,
  );

  const seriesByYear: Record<number, (number | null)[]> = {};
  if (primary) {
    for (const y of site.years) {
      try {
        const s = await getSeries(siteId, primary, y);
        seriesByYear[y] = s.so2;
      } catch {
        // year series might be absent
      }
    }
  }

  const times = [
    ...reports.flatMap((r) => [r.start, r.end]),
    ...eps.flatMap((e) => [e.start, e.end]),
  ];
  return {
    site,
    reports,
    episodes: eps,
    from: times.length ? Math.min(...times) : Date.UTC(2021, 0, 1),
    to: times.length ? Math.max(...times) : Date.UTC(2026, 0, 1),
    maxPeakPpb: eps.reduce((m, e) => Math.max(m, e.peak_ppb), 1),
    seriesByYear,
  };
}

export async function allSiteIds(): Promise<string[]> {
  return (await getSites()).map((s) => s.id);
}

export { compass, formatDate, formatUtc } from "./format";
