"use client";

/**
 * The two ledgers.
 *
 * Top lane: what facilities told the regulator, grouped into facility lanes,
 * one bar per filed report, coloured by whether the monitor saw it.
 * Bottom lane: what the air recorded, with the continuous hourly SO2 area trace
 * and dots on each episode above 5 ppb, coloured by verdict.
 * Arched threads join the pairs that match.
 *
 * Visual design faithfully reproduces the reference figure (17-two-ledgers-texas-city-2023.png).
 */

import Link from "next/link";
import { useState } from "react";
import type { EpisodeSummary, ReportSummary } from "@/lib/view";
import { compass, formatDate } from "@/lib/format";

const W = 1020;
const H = 450;
const PAD_L = 165;
const PAD_R = 25;
const TOP_LANE = { y: 45, h: 105 };
const BOT_LANE = { y: 220, h: 155 };
const AXIS_Y = 385;
const MAX_PPB_SCALE = 50; // sqrt scale up to 50 ppb

const VERDICT_VAR: Record<string, string> = {
  MATCHED: "var(--matched)",
  WEAK_MATCH: "var(--weak)",
  UNEXPLAINED: "var(--unexplained)",
  REGIONAL: "var(--regional)",
};

const STATUS_VAR: Record<string, string> = {
  SEEN: "var(--matched)",
  FAINT: "var(--weak)",
  UNSEEN_WIND_TOWARD: "var(--unexplained)",
  UNSEEN_WIND_AWAY: "var(--unseen)",
  UNSEEN_UNKNOWN: "var(--unseen)",
  NO_DATA: "var(--hairline-strong)",
};

export interface TwoLedgersProps {
  reports: ReportSummary[];
  episodes: EpisodeSummary[];
  from: number;
  to: number;
  maxPeakPpb: number;
  seriesByYear?: Record<number, (number | null)[]>;
  siteId?: string;
  years?: number[];
  initialYear?: number | "all";
  activeEpisodeId?: string | null;
  onSelectEpisode?: (id: string | null) => void;
  activeReportIncident?: number | null;
  onSelectReport?: (incident: number | null) => void;
  tz?: string;
}

export function TwoLedgers({
  reports,
  episodes,
  from,
  to,
  maxPeakPpb: _maxPeakPpb,
  seriesByYear = {},
  siteId = "texas-city",
  years = [2021, 2022, 2023, 2024, 2025],
  initialYear,
  activeEpisodeId: controlledActiveEpisodeId,
  onSelectEpisode,
  activeReportIncident: controlledActiveReportIncident,
  onSelectReport,
  tz = "America/Chicago",
}: TwoLedgersProps) {
  // Internal state if uncontrolled
  const [internalEpisodeId, setInternalEpisodeId] = useState<string | null>(null);
  const [internalReportIncident, setInternalReportIncident] = useState<number | null>(null);

  const activeEpisodeId = controlledActiveEpisodeId !== undefined ? controlledActiveEpisodeId : internalEpisodeId;
  const activeReportIncident = controlledActiveReportIncident !== undefined ? controlledActiveReportIncident : internalReportIncident;

  const handleSelectEpisode = (id: string | null) => {
    if (onSelectEpisode) onSelectEpisode(id);
    else setInternalEpisodeId(id);
    if (id !== null) {
      if (onSelectReport) onSelectReport(null);
      else setInternalReportIncident(null);
    }
  };

  const handleSelectReport = (incident: number | null) => {
    if (onSelectReport) onSelectReport(incident);
    else setInternalReportIncident(incident);
  };
  // Default to 2023 reference year when available (as shown in reference figure 17)
  const defaultSelection = initialYear ?? (years.includes(2023) ? 2023 : "all");
  const [selectedYear, setSelectedYear] = useState<number | "all">(defaultSelection);

  // Compute active time range
  let activeFrom = from;
  let activeTo = to;
  let isSingleYear = false;

  if (selectedYear !== "all") {
    isSingleYear = true;
    activeFrom = Date.UTC(selectedYear, 0, 1);
    activeTo = Date.UTC(selectedYear, 11, 31, 23, 59, 59);
  }

  const span = Math.max(activeTo - activeFrom, 1);
  const chartW = W - PAD_L - PAD_R;
  const x = (t: number) => PAD_L + ((t - activeFrom) / span) * chartW;

  // Filter items for active view
  const activeReports = reports.filter(
    (r) => r.end >= activeFrom - 24 * 3600 * 1000 && r.start <= activeTo + 24 * 3600 * 1000
  );
  const activeEpisodes = episodes.filter(
    (e) => e.start >= activeFrom && e.start <= activeTo + 24 * 3600 * 1000
  );

  // Facility Lanes (3 distinct lanes like the reference diagram)
  // Top 2 facilities get dedicated rows, remaining facilities share 'Other facilities'
  const allFacilities = [...new Set(reports.map((r) => r.facility ?? "Other facilities"))];
  const facilityTotals = allFacilities.map((name) => ({
    name,
    lb: reports
      .filter((r) => (r.facility ?? "Other facilities") === name)
      .reduce((sum, r) => sum + r.pollutant_lb, 0),
  })).sort((a, b) => b.lb - a.lb);

  const topFac1 = facilityTotals[0]?.name;
  const topFac2 = facilityTotals[1]?.name;

  const lanes: { id: string; label: string; sublabel?: string }[] = [];
  if (siteId === "texas-city") {
    lanes.push(
      { id: "blanchard", label: "Marathon refinery", sublabel: "(Blanchard)" },
      { id: "valero", label: "Valero refinery" },
      { id: "other", label: "Other facilities" }
    );
  } else if (topFac1 && topFac2) {
    lanes.push(
      { id: "fac1", label: cleanFacilityName(topFac1) },
      { id: "fac2", label: cleanFacilityName(topFac2) },
      { id: "other", label: "Other facilities" }
    );
  } else {
    lanes.push(
      { id: "primary", label: "Primary facility" },
      { id: "other", label: "Other facilities" }
    );
  }

  const laneOf = (facilityName: string | null): number => {
    if (!facilityName) return lanes.length - 1;
    const lower = facilityName.toLowerCase();
    if (siteId === "texas-city") {
      if (lower.includes("blanchard") || lower.includes("galveston bay") || lower.includes("marathon")) return 0;
      if (lower.includes("valero")) return 1;
      return 2;
    }
    if (topFac1 && facilityName === topFac1) return 0;
    if (topFac2 && facilityName === topFac2) return 1;
    return lanes.length - 1;
  };

  const nRows = lanes.length;
  const rowH = TOP_LANE.h / nRows;

  // Sqrt Scale for SO2
  const sqrtScale = (ppb: number) =>
    BOT_LANE.h * Math.sqrt(Math.max(ppb, 0) / MAX_PPB_SCALE);

  const yTicks = [0, 1, 5, 15, 30, 45];

  // Statistics for callout banners
  const bigReports = activeReports.filter((r) => r.pollutant_lb >= 1000);
  const unseenBigCount = bigReports.filter(
    (r) => (r.peak_ppb_during ?? 0) < 2 || r.status.startsWith("UNSEEN")
  ).length;
  const unexplainedCount = activeEpisodes.filter((e) => e.verdict === "UNEXPLAINED").length;

  // Hourly SO2 series area path
  let hourlyAreaPath = "";
  if (isSingleYear && seriesByYear[selectedYear as number]) {
    const rawSo2 = seriesByYear[selectedYear as number]!;
    const n = rawSo2.length;
    // Downsample taking max of each 2-hour window to preserve all sharp spikes cleanly
    const pts: { x: number; y: number }[] = [];
    const stepH = 2;
    for (let i = 0; i < n; i += stepH) {
      let maxVal = 0;
      for (let j = 0; j < stepH && i + j < n; j++) {
        const v = rawSo2[i + j];
        if (v !== null && v !== undefined && v > maxVal) maxVal = v;
      }
      const t = activeFrom + i * 3600 * 1000;
      const px = Math.min(Math.max(x(t), PAD_L), W - PAD_R);
      const py = AXIS_Y - sqrtScale(maxVal);
      pts.push({ x: px, y: py });
    }
    if (pts.length > 1) {
      hourlyAreaPath = `M ${pts[0]!.x},${AXIS_Y} ` +
        pts.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
        ` L ${pts[pts.length - 1]!.x},${AXIS_Y} Z`;
    }
  } else if (!isSingleYear) {
    // All years overview: sample 12 hours max
    const allPts: { x: number; y: number }[] = [];
    years.forEach((yr) => {
      const s = seriesByYear[yr];
      if (!s) return;
      const yrStart = Date.UTC(yr, 0, 1);
      const stepH = 12;
      for (let i = 0; i < s.length; i += stepH) {
        let maxVal = 0;
        for (let j = 0; j < stepH && i + j < s.length; j++) {
          const v = s[i + j];
          if (v !== null && v !== undefined && v > maxVal) maxVal = v;
        }
        const t = yrStart + i * 3600 * 1000;
        const px = Math.min(Math.max(x(t), PAD_L), W - PAD_R);
        const py = AXIS_Y - sqrtScale(maxVal);
        allPts.push({ x: px, y: py });
      }
    });
    if (allPts.length > 1) {
      hourlyAreaPath = `M ${allPts[0]!.x},${AXIS_Y} ` +
        allPts.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
        ` L ${allPts[allPts.length - 1]!.x},${AXIS_Y} Z`;
    }
  }

  // Time axis ticks
  const timeTicks = isSingleYear
    ? monthTicks(selectedYear as number)
    : yearTicks(activeFrom, activeTo);

  return (
    <figure style={{ margin: 0 }}>
      {/* Year Selection Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "var(--s3)",
          padding: "var(--s3) var(--s4)",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono caption" style={{ color: "var(--ink-mute)", marginRight: "var(--s1)" }}>
            PERIOD:
          </span>
          {years.includes(2023) && (
            <button
              type="button"
              onClick={() => setSelectedYear(2023)}
              style={yearBtnStyle(selectedYear === 2023)}
            >
              2023 (Reference)
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedYear("all")}
            style={yearBtnStyle(selectedYear === "all")}
          >
            All Years ({years[0]}–{years.at(-1)})
          </button>
          {years
            .filter((y) => y !== 2023)
            .map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => setSelectedYear(yr)}
                style={yearBtnStyle(selectedYear === yr)}
              >
                {yr}
              </button>
            ))}
        </div>

        <div className="mono caption" style={{ color: "var(--ink-mute)" }}>
          {activeEpisodes.length} episodes · {activeReports.length} reports (≥1,000 lb)
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", background: "var(--surface)" }}
        role="img"
        aria-label="Two ledgers comparison chart"
      >
        {/* Top Lane Header & Callouts */}
        <text x={PAD_L} y={23} fontSize="10.5" fill="var(--ink)" fontWeight="600" letterSpacing="0.4">
          TOP — what facilities told the regulator: self-reported events listing SO2 (bar height ~ log of pounds)
        </text>
        <text x={W - PAD_R} y={23} fontSize="10.5" fill="var(--ink-mute)" fontWeight="600" textAnchor="end">
          {bigReports.length > 0
            ? `${unseenBigCount} of ${bigReports.length} reported releases ≥ 1,000 lb SO2 never lifted the monitor above 2 ppb`
            : "No large releases reported"}
        </text>

        {/* Top Lane Facility Labels & Guidelines */}
        {lanes.map((lane, idx) => {
          const laneCenterY = TOP_LANE.y + idx * rowH + rowH / 2;
          return (
            <g key={lane.id}>
              <line
                x1={PAD_L}
                y1={TOP_LANE.y + idx * rowH + rowH}
                x2={W - PAD_R}
                y2={TOP_LANE.y + idx * rowH + rowH}
                stroke="var(--hairline)"
                strokeDasharray="2 3"
                strokeWidth={0.7}
              />
              <text
                x={PAD_L - 12}
                y={lane.sublabel ? laneCenterY - 4 : laneCenterY + 4}
                fontSize="10"
                fill="var(--ink)"
                textAnchor="end"
                fontWeight="500"
              >
                {lane.label}
              </text>
              {lane.sublabel && (
                <text
                  x={PAD_L - 12}
                  y={laneCenterY + 8}
                  fontSize="8.5"
                  fill="var(--ink-mute)"
                  textAnchor="end"
                >
                  {lane.sublabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Report Bars */}
        {activeReports.map((r) => {
          const x0 = Math.max(x(r.start), PAD_L);
          const x1 = Math.min(Math.max(x(r.end), x0 + 3), W - PAD_R);
          if (x1 < PAD_L || x0 > W - PAD_R) return null;
          const row = laneOf(r.facility);
          const h = Math.max(4, Math.min(rowH - 6, 4 + 2.5 * Math.log10(1 + r.pollutant_lb)));
          const yPos = TOP_LANE.y + row * rowH + (rowH - h) / 2;
          const isSelected = r.incident === activeReportIncident;
          return (
            <g
              key={r.incident}
              style={{ cursor: "pointer" }}
              onClick={(ev) => {
                ev.stopPropagation();
                handleSelectReport(isSelected ? null : r.incident);
              }}
            >
              {isSelected && (
                <rect
                  x={x0 - 2.5}
                  y={yPos - 2.5}
                  width={Math.max(x1 - x0, 2.5) + 5}
                  height={h + 5}
                  rx={2.5}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                />
              )}
              <rect
                x={x0}
                y={yPos}
                width={Math.max(x1 - x0, 2.5)}
                height={h}
                rx={1.5}
                fill={STATUS_VAR[r.status] ?? "var(--unseen)"}
                stroke={isSelected ? "var(--accent)" : "var(--ink)"}
                strokeWidth={isSelected ? 1.2 : 0.5}
                opacity={isSelected ? 1 : 0.92}
              >
                <title>{`${r.facility ?? "unknown"} · incident ${r.incident} · ${r.pollutant_lb.toLocaleString()} lb · ${r.status}`}</title>
              </rect>
            </g>
          );
        })}

        {/* Top Legend */}
        <g transform={`translate(${W - PAD_R - 260}, ${TOP_LANE.y + TOP_LANE.h + 16})`}>
          <rect x={0} y={0} width={9} height={9} fill="var(--matched)" stroke="var(--ink)" strokeWidth={0.5} />
          <text x={14} y={8} fontSize="9.5" fill="var(--ink-soft)">seen by the monitor</text>
          <rect x={115} y={0} width={9} height={9} fill="var(--weak)" stroke="var(--ink)" strokeWidth={0.5} />
          <text x={129} y={8} fontSize="9.5" fill="var(--ink-soft)">faint bump</text>
          <rect x={190} y={0} width={9} height={9} fill="var(--unseen)" stroke="var(--ink)" strokeWidth={0.5} />
          <text x={204} y={8} fontSize="9.5" fill="var(--ink-soft)">unseen</text>
        </g>

        {/* Connecting Threads (Graceful Arcs) */}
        {activeEpisodes
          .filter((e) => e.matchedReportStart !== null)
          .map((e) => {
            const x0 = x(e.matchedReportStart!);
            const matchedRep = activeReports.find((r) => r.incident === e.matchedIncident);
            const row = laneOf(matchedRep?.facility ?? null);
            const reportBarH = Math.max(4, Math.min(rowH - 6, 4 + 2.5 * Math.log10(1 + (matchedRep?.pollutant_lb ?? 1000))));
            const y0 = TOP_LANE.y + row * rowH + (rowH + reportBarH) / 2;

            const x1 = x(e.peak);
            const y1 = AXIS_Y - sqrtScale(e.peak_ppb);

            const dx = x1 - x0;
            const midY = (y0 + y1) / 2;
            const bow = Math.abs(dx) > 70 ? dx * 0.12 : 36;
            const cp1X = x0 + bow;
            const cp1Y = midY - 18;
            const cp2X = x1 + bow * 0.4;
            const cp2Y = midY + 18;

            const isThreadActive = e.id === activeEpisodeId || (matchedRep && matchedRep.incident === activeReportIncident);
            const strokeCol = isThreadActive ? "var(--accent)" : (VERDICT_VAR[e.verdict] ?? "var(--matched)");
            return (
              <g key={`thread-${e.id}`}>
                <path
                  d={`M ${x0},${y0} C ${cp1X},${cp1Y} ${cp2X},${cp2Y} ${x1},${y1}`}
                  fill="none"
                  stroke={strokeCol}
                  strokeWidth={isThreadActive ? 2.8 : 1.8}
                  opacity={isThreadActive ? 1 : 0.88}
                />
                {/* Indicator at connection start */}
                <circle cx={x0} cy={y0} r={isThreadActive ? 3 : 2} fill={strokeCol} />
              </g>
            );
          })}

        {/* Bottom Lane Header & Callouts */}
        <text x={PAD_L} y={BOT_LANE.y - 12} fontSize="10.5" fill="var(--ink)" fontWeight="600" letterSpacing="0.4">
          BOTTOM — what the air recorded: hourly SO2 at EPA monitor; dots mark episodes of 5 ppb or more
        </text>
        <text x={W - PAD_R} y={BOT_LANE.y - 12} fontSize="10.5" fill="var(--unexplained)" fontWeight="600" textAnchor="end">
          {activeEpisodes.length > 0
            ? `${unexplainedCount} of ${activeEpisodes.length} episodes have no overlapping SO2 report from any facility in the county`
            : "No episodes recorded"}
        </text>

        {/* Sqrt Scale Y-Axis for Bottom Lane */}
        <text
          transform={`rotate(-90 28 ${(BOT_LANE.y + AXIS_Y) / 2})`}
          x={28}
          y={(BOT_LANE.y + AXIS_Y) / 2}
          textAnchor="middle"
          fontSize="9.5"
          fill="var(--ink-mute)"
        >
          SO2 at the monitor (ppb, sqrt scale)
        </text>

        {yTicks.map((val) => {
          const cy = AXIS_Y - sqrtScale(val);
          return (
            <g key={`ytick-${val}`}>
              <line
                x1={PAD_L}
                y1={cy}
                x2={W - PAD_R}
                y2={cy}
                stroke="var(--hairline)"
                strokeDasharray={val === 0 ? undefined : "2 4"}
                strokeWidth={val === 0 ? 1 : 0.6}
              />
              <text x={PAD_L - 8} y={cy + 3.5} fontSize="9.5" fill="var(--ink-mute)" textAnchor="end" className="mono">
                {val}
              </text>
            </g>
          );
        })}

        {/* Continuous Hourly SO2 Trace (Filled Area) */}
        {hourlyAreaPath && (
          <path d={hourlyAreaPath} fill="var(--ink)" opacity={0.75} />
        )}

        {/* Episode Stems and Dots */}
        {activeEpisodes.map((e) => {
          const cx = x(e.peak);
          const cy = AXIS_Y - sqrtScale(e.peak_ppb);
          const isSelected = e.id === activeEpisodeId;
          return (
            <g key={e.id}>
              <line
                x1={cx}
                y1={AXIS_Y}
                x2={cx}
                y2={cy}
                stroke={isSelected ? "var(--accent)" : (VERDICT_VAR[e.verdict] ?? "var(--ink)")}
                strokeWidth={isSelected ? 1.6 : 0.9}
                opacity={isSelected ? 1 : 0.7}
              />

              {/* Focus Rings for Selected Episode */}
              {isSelected && (
                <>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={10.5}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    strokeDasharray="3 2"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={15}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={0.8}
                    opacity={0.6}
                  />
                </>
              )}

              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 6.2 : 4.8}
                fill={VERDICT_VAR[e.verdict] ?? "var(--ink)"}
                stroke={isSelected ? "var(--ink)" : "var(--ink)"}
                strokeWidth={isSelected ? 1.5 : 0.8}
              >
                <title>{`${e.peak_ppb} ppb · ${e.n_hours} h · ${e.verdict}`}</title>
              </circle>

              {/* Large invisible hit area for easy click/touch */}
              <circle
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleSelectEpisode(isSelected ? null : e.id);
                }}
              />
            </g>
          );
        })}

        {/* Bottom Legend */}
        <g transform={`translate(${PAD_L}, ${AXIS_Y + 38})`}>
          <circle cx={4} cy={4} r={4.5} fill="var(--matched)" stroke="var(--ink)" strokeWidth={0.6} />
          <text x={14} y={7.5} fontSize="9.5" fill="var(--ink-soft)">matched</text>
          <circle cx={80} cy={4} r={4.5} fill="var(--weak)" stroke="var(--ink)" strokeWidth={0.6} />
          <text x={90} y={7.5} fontSize="9.5" fill="var(--ink-soft)">weak match (startup window)</text>
          <circle cx={240} cy={4} r={4.5} fill="var(--unexplained)" stroke="var(--ink)" strokeWidth={0.6} />
          <text x={250} y={7.5} fontSize="9.5" fill="var(--ink-soft)">no matching report</text>
        </g>

        {/* X-Axis Baseline & Time Ticks */}
        <line x1={PAD_L} y1={AXIS_Y} x2={W - PAD_R} y2={AXIS_Y} stroke="var(--hairline-strong)" strokeWidth={1} />
        {timeTicks.map((t) => (
          <g key={t.time}>
            <line x1={x(t.time)} y1={AXIS_Y} x2={x(t.time)} y2={AXIS_Y + 5} stroke="var(--hairline-strong)" />
            <text x={x(t.time)} y={AXIS_Y + 16} fontSize="10" fill="var(--ink)" textAnchor="middle" fontWeight="500">
              {t.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Interactive Inspector Dock */}
      {(() => {
        const selectedEp = activeEpisodeId ? episodes.find((e) => e.id === activeEpisodeId) : null;
        const selectedRep = activeReportIncident ? reports.find((r) => r.incident === activeReportIncident) : null;

        if (selectedEp) {
          return (
            <div
              style={{
                borderTop: "1px solid var(--hairline)",
                background: "var(--surface)",
                padding: "clamp(0.85rem, 1.8vw, 1.25rem) clamp(1rem, 2.5vw, 1.5rem)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "var(--s3)",
              }}
            >
              <div>
                <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`verdict d-${selectedEp.verdict}`}>
                    {selectedEp.verdict.replace(/_/g, " ")}
                  </span>
                  <span className="mono caption" style={{ color: "var(--ink-mute)" }}>
                    {formatDate(selectedEp.start, tz)} · {selectedEp.n_hours}h duration
                  </span>
                </div>
                <div style={{ marginTop: "var(--s2)", fontSize: "1.05rem", fontWeight: 500 }}>
                  Peak:{" "}
                  <strong style={{ color: selectedEp.verdict === "UNEXPLAINED" ? "var(--unexplained)" : "var(--matched)" }}>
                    {selectedEp.peak_ppb} ppb SO2
                  </strong>
                  {" · "}Wind from {compass(selectedEp.wd_mean_deg)} ({selectedEp.wd_mean_deg ?? "—"}°)
                  {selectedEp.matchedIncident && ` · Matched Incident #${selectedEp.matchedIncident}`}
                </div>
                <div className="caption" style={{ color: "var(--ink-soft)", marginTop: "var(--s1)" }}>
                  {selectedEp.verdict_reason}
                  {" · "}
                  <span style={{ color: "var(--accent)" }}>Upwind cone swept on satellite map below ↓</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.8rem" }}
                  onClick={() => {
                    document.getElementById("satellite-map")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  View on Map ↓
                </button>
                <Link
                  href={`/site/${siteId}/case/${selectedEp.id}/`}
                  className="btn btn-primary"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.95rem", textDecoration: "none" }}
                >
                  Open AI Case File →
                </Link>
                <button
                  type="button"
                  onClick={() => handleSelectEpisode(null)}
                  className="btn"
                  title="Close inspection"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.65rem", color: "var(--ink-mute)" }}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        }

        if (selectedRep) {
          return (
            <div
              style={{
                borderTop: "1px solid var(--hairline)",
                background: "var(--surface)",
                padding: "clamp(0.85rem, 1.8vw, 1.25rem) clamp(1rem, 2.5vw, 1.5rem)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "var(--s3)",
              }}
            >
              <div>
                <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`verdict d-${selectedRep.status}`}>
                    {selectedRep.status.replace(/UNSEEN_/, "").replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="mono caption" style={{ color: "var(--ink-mute)" }}>
                    Incident #{selectedRep.incident} · {formatDate(selectedRep.start, tz)}
                  </span>
                </div>
                <div style={{ marginTop: "var(--s2)", fontSize: "1.05rem", fontWeight: 500 }}>
                  {cleanFacilityName(selectedRep.facility ?? "Facility")} · <strong>{selectedRep.pollutant_lb.toLocaleString()} lb SO2</strong>
                </div>
                <div className="caption" style={{ color: "var(--ink-soft)", marginTop: "var(--s1)" }}>
                  Monitor peak during event: <span className="mono">{selectedRep.peak_ppb_during ?? 0} ppb</span>
                  {selectedRep.status.includes("WIND_AWAY")
                    ? " · Wind was not blowing toward the monitor; plume moved away."
                    : " · Monitor was downwind; peak did not register significant spike."}
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
                <a
                  href={`https://www2.tceq.texas.gov/oce/eer/index.cfm?fuseaction=main.getDetails&target=${selectedRep.incident}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.85rem", textDecoration: "none" }}
                >
                  Official TCEQ Filing ↗
                </a>
                <button
                  type="button"
                  onClick={() => handleSelectReport(null)}
                  className="btn"
                  title="Close inspection"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.65rem", color: "var(--ink-mute)" }}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            style={{
              borderTop: "1px solid var(--hairline)",
              background: "var(--surface)",
              padding: "0.65rem clamp(1rem, 2.5vw, 1.5rem)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--s2)",
            }}
          >
            <span className="caption" style={{ color: "var(--ink-mute)" }}>
              💡 Click any episode dot below to sweep the upwind cone on the satellite map and open its case file, or click a report bar above.
            </span>
            {activeEpisodes.length > 0 && (
              <button
                type="button"
                className="btn"
                style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem" }}
                onClick={() => {
                  const worst = [...activeEpisodes].sort((a, b) => b.peak_ppb - a.peak_ppb)[0];
                  if (worst) handleSelectEpisode(worst.id);
                }}
              >
                Inspect Highest Spike
              </button>
            )}
          </div>
        );
      })()}
    </figure>
  );
}

function yearBtnStyle(active: boolean) {
  return {
    background: active ? "var(--ink)" : "var(--paper)",
    color: active ? "var(--paper)" : "var(--ink)",
    border: "1px solid var(--hairline-strong)",
    borderRadius: "var(--r-sm)",
    padding: "0.25rem 0.65rem",
    fontSize: "0.82rem",
    fontFamily: "var(--font-mono)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };
}

function cleanFacilityName(name: string): string {
  return name
    .replace(/REFINING.*$/i, "refinery")
    .replace(/FACILITY.*$/i, "")
    .replace(/PLANT.*$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function monthTicks(year: number): { time: number; label: string }[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out: { time: number; label: string }[] = [];
  for (let m = 0; m < 12; m++) {
    out.push({
      time: Date.UTC(year, m, 1),
      label: months[m]!,
    });
  }
  // Add ending Jan tick
  out.push({
    time: Date.UTC(year + 1, 0, 1),
    label: "Jan",
  });
  return out;
}

function yearTicks(from: number, to: number): { time: number; label: string }[] {
  const out: { time: number; label: string }[] = [];
  for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) {
    const t = Date.UTC(y, 0, 1);
    if (t >= from && t <= to) {
      out.push({
        time: t,
        label: String(y),
      });
    }
  }
  return out;
}
