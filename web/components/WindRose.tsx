/**
 * The directional fingerprint, drawn as a polar bar chart.
 *
 * Each wedge is one 10-degree wind bin; its length is the share of hours from that
 * direction that land in the monitor's worst 5%. Bins inside the dominant lobe are
 * emphasised. Bootstrap intervals are drawn as a faint outer arc, so a wide interval
 * reads as uncertainty rather than as a confident spike.
 */

import type { FingerprintPeriod } from "@/lib/types";

const SIZE = 320;
const C = SIZE / 2;
const R = SIZE / 2 - 34;

function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

function wedge(from: number, to: number, r: number): string {
  const [x0, y0] = polar(from, 0);
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  return `M${x0},${y0} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`;
}

export function WindRose({ period }: { period: FingerprintPeriod }) {
  const max = Math.max(...period.bins.map((b) => b.hi ?? b.cpf ?? 0), 0.01);
  const scale = (v: number) => (v / max) * R;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ width: "100%", maxWidth: "26rem", height: "auto" }}
      role="img"
      aria-label={`Wind rose. The worst hours arrive mostly from ${period.peak_deg} degrees.`}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="var(--hairline)" strokeWidth={0.6} />
      ))}
      {period.bins.map((b) => {
        const cpf = b.cpf ?? 0;
        if (cpf <= 0) return null;
        return (
          <g key={b.deg}>
            {b.hi !== null && (
              <path d={wedge(b.deg, b.deg + 9, scale(b.hi))} fill="var(--hairline-strong)" opacity={0.3} />
            )}
            <path
              d={wedge(b.deg, b.deg + 9, scale(cpf))}
              fill={b.lobe ? "var(--unexplained)" : "var(--hairline-strong)"}
              opacity={b.lobe ? 0.9 : 0.5}
            >
              <title>{`${b.deg}–${b.deg + 10}° · ${Math.round(cpf * 100)}% of ${b.n} hours`}</title>
            </path>
          </g>
        );
      })}
      {(["N", "E", "S", "W"] as const).map((label, i) => {
        const [x, y] = polar(i * 90, R + 16);
        return (
          <text key={label} x={x} y={y} fontSize="11" fill="var(--ink-mute)" textAnchor="middle" dominantBaseline="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
