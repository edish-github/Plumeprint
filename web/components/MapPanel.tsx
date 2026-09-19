"use client";

import Link from "next/link";
import { useState } from "react";

import { SiteMap, type MapEpisode } from "./SiteMap";
import type { Facility, Monitor } from "@/lib/types";
import type { EpisodeSummary } from "@/lib/view";
import { compass } from "@/lib/format";

/**
 * Map plus episode picker.
 *
 * Selecting an episode sweeps the upwind cone across the map. The cone is the honest
 * version of the claim: it shows the arc the air came from, not a line to a culprit,
 * because one monitor cannot tell distance along that arc.
 */
export interface MapPanelProps {
  monitor: Monitor;
  facilities: Facility[];
  episodes: (MapEpisode & { label: string; verdict: string })[];
  tz: string;
  selectedEpisodeId?: string | null;
  onSelectEpisode?: (id: string | null) => void;
  allEpisodes?: EpisodeSummary[];
  siteId?: string;
}

export function MapPanel({
  monitor,
  facilities,
  episodes,
  tz: _tz,
  selectedEpisodeId: controlledSelectedId,
  onSelectEpisode,
  allEpisodes,
  siteId,
}: MapPanelProps) {
  const [internalSelected, setInternalSelected] = useState<string | null>(episodes[0]?.id ?? null);
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelected;

  const handleSelect = (id: string | null) => {
    if (onSelectEpisode) onSelectEpisode(id);
    else setInternalSelected(id);
  };

  // Resolve episode object from episodes or allEpisodes
  let episode: MapEpisode | null = null;
  let episodeLabel: string | null = null;
  let episodeVerdict: string | null = null;

  if (selectedId) {
    const fromPills = episodes.find((e) => e.id === selectedId);
    if (fromPills) {
      episode = fromPills;
      episodeLabel = fromPills.label;
      episodeVerdict = fromPills.verdict;
    } else if (allEpisodes) {
      const fromAll = allEpisodes.find((e) => e.id === selectedId);
      if (fromAll) {
        episode = {
          id: fromAll.id,
          wd_mean_deg: fromAll.wd_mean_deg,
          ws_mean_ms: null,
          wind_source: fromAll.wind_source,
          peak_ppb: fromAll.peak_ppb,
        };
        episodeLabel = `${fromAll.peak_ppb} ppb`;
        episodeVerdict = fromAll.verdict;
      }
    }
  }

  return (
    <div id="satellite-map">
      <SiteMap monitor={monitor} facilities={facilities} episode={episode} />

      <div
        style={{
          padding: "var(--s4) var(--s5) var(--s4)",
          borderTop: "1px solid var(--hairline)",
          background: "var(--surface)",
        }}
      >
        {episode && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--s3)",
              marginBottom: "var(--s3)",
              paddingBottom: "var(--s3)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <div>
              <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center" }}>
                {episodeVerdict && (
                  <span className={`verdict d-${episodeVerdict}`}>
                    {episodeVerdict.replace(/_/g, " ")}
                  </span>
                )}
                <span className="mono caption" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  UPWIND CONE ACTIVE
                </span>
              </div>
              <p className="small" style={{ margin: "var(--s1) 0 0 0", fontWeight: 500 }}>
                Air arrived from the <strong>{compass(episode.wd_mean_deg)}</strong> ({episode.wd_mean_deg ?? "—"}°)
                {" "}during this {episode.peak_ppb} ppb event. Facilities in the shaded cone were upwind.
              </p>
            </div>

            <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center" }}>
              {siteId && (
                <Link
                  href={`/site/${siteId}/case/${episode.id}/`}
                  className="btn btn-primary"
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.9rem", textDecoration: "none" }}
                >
                  Open Case File →
                </Link>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => handleSelect(null)}
                style={{ fontSize: "0.82rem", padding: "0.35rem 0.65rem", color: "var(--ink-mute)" }}
                title="Clear cone"
              >
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "var(--s2)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span className="caption" style={{ color: "var(--ink-mute)", marginRight: "var(--s2)" }}>
            Show the wind during:
          </span>
          {episodes.map((e) => (
            <button
              key={e.id}
              className="btn"
              aria-pressed={e.id === selectedId}
              onClick={() => handleSelect(e.id === selectedId ? null : e.id)}
              style={{ fontSize: "0.82rem", padding: "0.3em 0.85em" }}
            >
              {e.label}
            </button>
          ))}
        </div>

        <p className="caption" style={{ marginTop: "var(--s3)", marginBottom: 0, color: "var(--ink-soft)" }}>
          The shaded arc is where the air came from during the selected episode, widened by the
          uncertainty of the wind reading. Anything inside it was upwind; the arc says
          nothing about how far along it a source sat.
        </p>
      </div>
    </div>
  );
}
