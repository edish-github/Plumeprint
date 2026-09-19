"use client";

import Link from "next/link";
import { useState } from "react";

import { MapPanel } from "./MapPanel";
import { TwoLedgers } from "./TwoLedgers";
import { WindRose } from "./WindRose";
import type { Site } from "@/lib/types";
import type { EpisodeSummary, ReportSummary } from "@/lib/view";
import { compass, formatDate } from "@/lib/format";

export interface SiteWorkspaceProps {
  site: Site;
  reports: ReportSummary[];
  episodes: EpisodeSummary[];
  from: number;
  to: number;
  maxPeakPpb: number;
  seriesByYear?: Record<number, (number | null)[]>;
  years: number[];
  fingerprint: any;
  unexplained: EpisodeSummary[];
  unseen: ReportSummary[];
}

export function SiteWorkspace({
  site,
  reports,
  episodes,
  from,
  to,
  maxPeakPpb,
  seriesByYear = {},
  years,
  fingerprint,
  unexplained,
  unseen,
}: SiteWorkspaceProps) {
  const primary = site.monitors.find((m) => m.role === "primary")!;

  // Default active episode to the highest unexplained peak
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(
    unexplained[0]?.id ?? null
  );
  const [activeReportIncident, setActiveReportIncident] = useState<number | null>(null);

  const handleSelectEpisode = (id: string | null) => {
    setActiveEpisodeId(id);
    if (id !== null) setActiveReportIncident(null);
  };

  const handleSelectReport = (incident: number | null) => {
    setActiveReportIncident(incident);
  };

  const mapPillEpisodes = unexplained.slice(0, 6).map((e) => ({
    id: e.id,
    wd_mean_deg: e.wd_mean_deg,
    ws_mean_ms: null,
    wind_source: e.wind_source,
    peak_ppb: e.peak_ppb,
    verdict: e.verdict,
    label: `${formatDate(e.start, site.tz)} · ${e.peak_ppb} ppb`,
  }));

  return (
    <>
      {/* Two Ledgers Visualization */}
      <section className="page" id="two-ledgers">
        <div className="panel panel-flush">
          <TwoLedgers
            reports={reports}
            episodes={episodes}
            from={from}
            to={to}
            maxPeakPpb={maxPeakPpb}
            seriesByYear={seriesByYear}
            siteId={site.id}
            years={years}
            activeEpisodeId={activeEpisodeId}
            onSelectEpisode={handleSelectEpisode}
            activeReportIncident={activeReportIncident}
            onSelectReport={handleSelectReport}
            tz={site.tz}
          />
        </div>
      </section>

      {/* Satellite Map with Upwind Cone */}
      <section className="page">
        <div className="panel panel-flush" style={{ overflow: "hidden" }}>
          <MapPanel
            monitor={primary}
            facilities={site.facilities}
            tz={site.tz}
            episodes={mapPillEpisodes}
            allEpisodes={episodes}
            selectedEpisodeId={activeEpisodeId}
            onSelectEpisode={handleSelectEpisode}
            siteId={site.id}
          />
        </div>
      </section>

      {/* The Fingerprint (Wind Rose) */}
      <section className="page">
        <div
          className="panel split"
          style={{
            padding: "clamp(2rem, 4vw, 3.5rem)",
            alignItems: "center",
          }}
        >
          <div>
            <p className="eyebrow">The fingerprint</p>
            <h2 style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.5rem)" }}>Where the worst hours come from.</h2>
            <p className="small" style={{ marginTop: "var(--s4)", lineHeight: 1.6 }}>
              The share of hours from each wind direction that land in this monitor&rsquo;s
              worst five per cent. One trajectory can be wrong. A pattern that holds across
              years is evidence.
            </p>
            {fingerprint && (
              <p className="caption" style={{ marginTop: "var(--s4)", color: "var(--ink-mute)", lineHeight: 1.6 }}>
                Peak direction <strong style={{ color: "var(--accent)" }}>{fingerprint.peak_deg}°</strong>, from the{" "}
                <strong>{compass(fingerprint.peak_deg)}</strong>. Threshold{" "}
                <span className="mono">{fingerprint.threshold_ppb} ppb</span>.{" "}
                {Math.round(fingerprint.measured_wind_share * 100)}% of hours use wind
                measured on site. The pale outer band is the 90% interval.
              </p>
            )}
          </div>
          <div style={{ display: "grid", placeItems: "center", minWidth: 0, width: "100%" }}>
            {fingerprint ? <WindRose period={fingerprint} /> : <p className="small">No fingerprint available.</p>}
          </div>
        </div>
      </section>

      {/* Episodes with no matching report */}
      <section className="page">
        <div className="panel" style={{ padding: "var(--s4) var(--s5)", overflowX: "auto" }}>
          <div
            style={{
              marginBottom: "var(--s3)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "var(--s2)",
            }}
          >
            <h3 style={{ fontSize: "1.15rem", fontWeight: 500, margin: 0 }}>
              Episodes with no matching report
            </h3>
            <span className="caption" style={{ color: "var(--ink-mute)" }}>
              Air recorded · No report filed · Click to inspect on map
            </span>
          </div>

          <table className="rows">
            <thead>
              <tr>
                <th>Date</th>
                <th>Peak</th>
                <th>Hours</th>
                <th>Wind from</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unexplained.map((e) => {
                const isSelected = e.id === activeEpisodeId;
                return (
                  <tr
                    key={e.id}
                    style={{
                      background: isSelected ? "var(--paper-warm)" : undefined,
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                        {isSelected && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "var(--accent)",
                              display: "inline-block",
                            }}
                          />
                        )}
                        {formatDate(e.start, site.tz)}
                      </span>
                    </td>
                    <td className="num">
                      <strong style={{ color: "var(--unexplained)" }}>{e.peak_ppb} ppb</strong>
                    </td>
                    <td className="num">{e.n_hours}</td>
                    <td>{compass(e.wd_mean_deg)} ({e.wd_mean_deg ?? "—"}°)</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          fontSize: "0.78rem",
                          padding: "0.22rem 0.65rem",
                          marginRight: "var(--s2)",
                          background: isSelected ? "var(--ink)" : undefined,
                          color: isSelected ? "var(--paper)" : undefined,
                        }}
                        onClick={() => {
                          handleSelectEpisode(e.id);
                          document.getElementById("satellite-map")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        {isSelected ? "Cone active ↓" : "Show on map"}
                      </button>
                      <Link
                        href={`/site/${site.id}/case/${e.id}/`}
                        className="small"
                        style={{ fontWeight: 500, textDecoration: "none" }}
                      >
                        Open case →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reported releases the monitor did not see */}
      <section className="page">
        <div className="panel" style={{ padding: "var(--s4) var(--s5)", overflowX: "auto" }}>
          <div
            style={{
              marginBottom: "var(--s3)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "var(--s2)",
            }}
          >
            <h3 style={{ fontSize: "1.15rem", fontWeight: 500, margin: 0 }}>
              Reported releases the monitor did not see
            </h3>
            <span className="caption" style={{ color: "var(--ink-mute)" }}>
              Filed by facilities · Not seen by monitor
            </span>
          </div>

          <table className="rows">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Filed</th>
                <th>Reported</th>
                <th>Monitor peak</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unseen.map((r) => {
                const isSelected = r.incident === activeReportIncident;
                return (
                  <tr
                    key={r.incident}
                    style={{
                      background: isSelected ? "var(--paper-warm)" : undefined,
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td style={{ maxWidth: "20rem" }}>{titleCase(r.facility)}</td>
                    <td>{formatDate(r.start, site.tz)}</td>
                    <td className="num">{r.pollutant_lb.toLocaleString()} lb</td>
                    <td className="num">{r.peak_ppb_during ?? "—"} ppb</td>
                    <td>
                      <span className={`verdict d-${r.status}`}>
                        {r.status.replace(/UNSEEN_/, "").replace(/_/g, " ").toLowerCase()}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          fontSize: "0.78rem",
                          padding: "0.22rem 0.65rem",
                          marginRight: "var(--s2)",
                          background: isSelected ? "var(--ink)" : undefined,
                          color: isSelected ? "var(--paper)" : undefined,
                        }}
                        onClick={() => {
                          handleSelectReport(r.incident);
                          document.getElementById("two-ledgers")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        {isSelected ? "Highlighted ↑" : "Highlight in ledger"}
                      </button>
                      <a
                        href={`https://www2.tceq.texas.gov/oce/eer/index.cfm?fuseaction=main.getDetails&target=${r.incident}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono caption"
                        style={{ textDecoration: "none" }}
                      >
                        {r.incident} ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption" style={{ marginTop: "var(--s2)", paddingLeft: "var(--s2)", marginBottom: 0 }}>
          &ldquo;Wind toward&rdquo; means the monitor was downwind for part of the release
          and still recorded nothing unusual.
        </p>
      </section>
    </>
  );
}

function titleCase(name: string | null): string {
  if (!name) return "—";
  return name
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bUsa?\b/g, "US")
    .replace(/\bLp\b/g, "LP");
}
