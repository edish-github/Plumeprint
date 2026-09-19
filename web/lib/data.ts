/**
 * Reading the JSON contract.
 *
 * Everything is loaded from disk and cached in memory. Nothing here calls a network
 * service, which is the whole point: the site works from committed files.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CoverageRow, Episode, EventReport, Facility, Fingerprint, Meta, Site, StoredCase,
} from "./types";

export const DATA_DIR = process.env.PLUMEPRINT_DATA ?? join(process.cwd(), "public", "data");

const cache = new Map<string, unknown>();

async function loadJson<T>(...parts: string[]): Promise<T> {
  const path = join(DATA_DIR, ...parts);
  const hit = cache.get(path);
  if (hit !== undefined) return hit as T;
  const parsed = JSON.parse(await readFile(path, "utf8")) as T;
  cache.set(path, parsed);
  return parsed;
}

export function clearCache(): void {
  cache.clear();
}

export const getMeta = () => loadJson<Meta>("meta.json");
export const getSites = () => loadJson<Site[]>("sites.json");
export const getEvents = (siteId: string) => loadJson<EventReport[]>("events", `${siteId}.json`);
export const getEpisodes = (siteId: string) => loadJson<Episode[]>("episodes", `${siteId}.json`);
export const getFingerprint = (siteId: string) => loadJson<Fingerprint>("fingerprint", `${siteId}.json`);
export const getCoverage = (siteId: string) => loadJson<CoverageRow[]>("coverage", `${siteId}.json`);

export interface SeriesPayload {
  monitor_id: string;
  year: number;
  t0: string;
  step_h: number;
  n: number;
  so2: (number | null)[];
  wd?: (number | null)[];
  ws?: (number | null)[];
  src?: string[];
}

export const getSeries = (siteId: string, monitorId: string, year: number | string) =>
  loadJson<SeriesPayload>("series", siteId, monitorId, `${year}.json`);

export async function getSite(siteId: string): Promise<Site> {
  const site = (await getSites()).find((s) => s.id === siteId);
  if (!site) throw new Error(`unknown site: ${siteId}`);
  return site;
}

/** Which site an episode belongs to, found by its monitor.
 *  Errors are phrased for the model that will read them: it should learn that the id was
 *  wrong, not that some internal lookup missed. */
export async function siteOfEpisode(episodeId: string): Promise<Site> {
  const monitorId = episodeId.split("_")[0];
  const site = (await getSites()).find((s) => s.monitors.some((m) => m.id === monitorId));
  if (!site) {
    throw new Error(
      `unknown episode: ${episodeId} (its monitor id "${monitorId}" is not one of ours)`,
    );
  }
  return site;
}

export async function getEpisode(episodeId: string): Promise<{ site: Site; episode: Episode }> {
  const site = await siteOfEpisode(episodeId);
  const episode = (await getEpisodes(site.id)).find((e) => e.id === episodeId);
  if (!episode) throw new Error(`unknown episode: ${episodeId}`);
  return { site, episode };
}

export async function getReport(
  incident: number,
): Promise<{ site: Site; report: EventReport } | null> {
  for (const site of await getSites()) {
    const report = (await getEvents(site.id)).find((e) => e.incident === incident);
    if (report) return { site, report };
  }
  return null;
}

export async function getFacility(siteId: string, rn: string): Promise<Facility | null> {
  const site = await getSite(siteId);
  return site.facilities.find((f) => f.rn === rn) ?? null;
}

export async function getStoredCase(episodeId: string): Promise<StoredCase | null> {
  try {
    return await loadJson<StoredCase>("cases", `${episodeId}.json`);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ helpers */

/** Facilities with usable coordinates, nearest first. */
export function placedFacilities(site: Site): Facility[] {
  return site.facilities
    .filter((f) => f.lat !== null && f.lon !== null && f.distance_m !== null)
    .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
}

/** Reports overlapping a window, widened by padHours on each side. */
export function reportsOverlapping(
  reports: EventReport[],
  startUtc: string,
  endUtc: string,
  padHours = 0,
): EventReport[] {
  const pad = padHours * 3_600_000;
  const from = Date.parse(startUtc) - pad;
  const to = Date.parse(endUtc) + pad;
  return reports
    .filter((r) => Date.parse(r.start_utc) <= to && Date.parse(r.end_utc) >= from)
    .sort((a, b) => b.pollutant_lb - a.pollutant_lb);
}

/** UTC timestamp rendered in a site's local time, for prose the reader will recognise. */
export function localTime(utc: string, tz: string): string {
  return new Date(utc).toLocaleString("en-US", {
    timeZone: tz, year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}
