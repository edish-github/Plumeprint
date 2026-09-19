"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ErrorEvent, GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { circleRing, collection, polygon, sigmaFor, wedgeRing } from "@/lib/geo";
import type { Facility, Monitor } from "@/lib/types";

/**
 * The site map.
 *
 * Shows where the monitor sits, how large each facility actually is, and, when an episode
 * is selected, the arc of sky the wind came from during it. Facility footprints are drawn
 * at true scale because that is the point: a two-kilometre refinery next door subtends a
 * far wider angle than a compressor station across town, and the bearing test allows for
 * exactly that.
 *
 * Tiles come from a keyless public server. If they fail the geometry still renders on a
 * plain background, so the map degrades rather than disappearing.
 */

export interface MapEpisode {
  id: string;
  wd_mean_deg: number | null;
  ws_mean_ms: number | null;
  wind_source: string;
  peak_ppb: number;
}

interface SiteMapProps {
  monitor: Monitor;
  facilities: Facility[];
  episode?: MapEpisode | null;
  /** How far the upwind cone is drawn. Direction is evidence; distance is not. */
  coneMetres?: number;
  height?: number;
}

const IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function SiteMap({
  monitor, facilities, episode = null, coneMetres = 6000, height = 540,
}: SiteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: "raster",
            tiles: [IMAGERY],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              "Imagery &copy; Esri, Maxar, Earthstar Geographics · facility locations from EPA FRS",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#20222a" } },
          { id: "imagery", type: "raster", source: "imagery" },
        ],
      },
      center: [monitor.lon, monitor.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    instance.on("error", (e: ErrorEvent) => {
      // A failed tile is not a failed map: the geometry below is the actual evidence.
      if (String(e?.error?.message ?? "").includes("tile")) setTilesFailed(true);
    });

    instance.on("load", () => {
      const placed = facilities.filter((f) => f.lat !== null && f.lon !== null);

      instance.addSource("footprints", {
        type: "geojson",
        data: collection(
          placed.map((f) =>
            polygon(circleRing(f.lat!, f.lon!, f.radius_m ?? 250), {
              name: f.name ?? f.rn,
              lb: f.pollutant_lb_total,
              reports: f.n_reports,
              radius: f.radius_m,
              source: f.footprint_source,
            }),
          ),
        ),
      });
      instance.addLayer({
        id: "footprint-fill",
        type: "fill",
        source: "footprints",
        paint: { "fill-color": "#c2571a", "fill-opacity": 0.22 },
      });
      instance.addLayer({
        id: "footprint-line",
        type: "line",
        source: "footprints",
        paint: { "line-color": "#f0a06a", "line-width": 1.2 },
      });
      instance.addLayer({
        id: "footprint-label",
        type: "symbol",
        source: "footprints",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-max-width": 14,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.3 },
      });

      instance.addSource("cone", { type: "geojson", data: collection([]) });
      // The cone sits over bright satellite imagery, so it needs a firm edge to read as
      // a deliberate claim rather than a haze artefact.
      instance.addLayer({
        id: "cone-fill",
        type: "fill",
        source: "cone",
        paint: { "fill-color": "#ffe08a", "fill-opacity": 0.42 },
      }, "footprint-fill");
      instance.addLayer({
        id: "cone-line",
        type: "line",
        source: "cone",
        paint: { "line-color": "#ffd24d", "line-width": 1.6, "line-dasharray": [3, 2] },
      }, "footprint-fill");

      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;background:#fff;border:2px solid #111;transform:rotate(45deg)";
      el.title = `Monitor ${monitor.id}`;
      new maplibregl.Marker({ element: el })
        .setLngLat([monitor.lon, monitor.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<strong>Monitor ${monitor.id}</strong>`))
        .addTo(instance);

      const bounds = new maplibregl.LngLatBounds([monitor.lon, monitor.lat], [monitor.lon, monitor.lat]);
      for (const f of placed) bounds.extend([f.lon!, f.lat!]);
      instance.fitBounds(bounds, { padding: 60, maxZoom: 13.5, animate: false });

      instance.on("click", "footprint-fill", (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${p.name}</strong><br/>${Number(p.lb).toLocaleString()} lb across ` +
            `${p.reports} reports<br/><span style="opacity:.7">footprint ${p.radius} m ` +
            `(${p.source})</span>`,
          )
          .addTo(instance);
      });
      instance.on("mouseenter", "footprint-fill", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "footprint-fill", () => {
        instance.getCanvas().style.cursor = "";
      });
    });

    return () => {
      instance.remove();
      map.current = null;
    };
  }, [monitor, facilities]);

  // The cone updates without rebuilding the map, so selecting episodes stays instant.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const apply = () => {
      const source = instance.getSource("cone") as GeoJSONSource | undefined;
      if (!source) return;
      if (!episode || episode.wd_mean_deg === null) {
        source.setData(collection([]));
        return;
      }
      const sigma = sigmaFor(episode.ws_mean_ms, episode.wind_source);
      const ring = wedgeRing(
        monitor.lat, monitor.lon,
        episode.wd_mean_deg - sigma, episode.wd_mean_deg + sigma, coneMetres,
      );
      source.setData(collection([polygon(ring, { episode: episode.id })]));
    };
    if (instance.isStyleLoaded()) apply();
    else instance.once("idle", apply);
  }, [episode, monitor, coneMetres]);

  return (
    <div>
      <div
        ref={container}
        style={{
          height,
          width: "100%",
          borderTopLeftRadius: "calc(var(--r-lg) - 4px)",
          borderTopRightRadius: "calc(var(--r-lg) - 4px)",
          overflow: "hidden",
        }}
      />
      {tilesFailed && (
        <p className="caption" style={{ padding: "var(--s3) var(--s5)", margin: 0, color: "var(--ink-mute)" }}>
          Satellite tiles did not load. The facility outlines and wind cone above are drawn
          from the data itself and are unaffected.
        </p>
      )}
    </div>
  );
}
