/**
 * Client-safe date and direction formatting utilities.
 */

/** Bearing to a compass word, for prose a reader recognises. */
export function compass(deg: number | null): string {
  if (deg === null) return "an unknown direction";
  const points = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return points[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

export function formatUtc(ms: number, tz: string): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDate(ms: number, tz: string): string {
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
