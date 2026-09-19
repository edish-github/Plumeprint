import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseActions } from "@/components/CaseActions";
import { RequestDraft } from "@/components/RequestDraft";
import { getEpisodes, getEvents, getSites, getStoredCase } from "@/lib/data";
import { compass, formatUtc } from "@/lib/view";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const params: { siteId: string; episodeId: string }[] = [];
  for (const site of await getSites()) {
    for (const episode of await getEpisodes(site.id)) {
      // Only episodes that have a cached case file; the rest would render an empty page.
      if (await getStoredCase(episode.id)) {
        params.push({ siteId: site.id, episodeId: episode.id });
      }
    }
  }
  return params;
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ siteId: string; episodeId: string }>;
}) {
  const { siteId, episodeId } = await params;
  const site = (await getSites()).find((s) => s.id === siteId);
  if (!site) notFound();
  const episode = (await getEpisodes(siteId)).find((e) => e.id === episodeId);
  const stored = await getStoredCase(episodeId);
  if (!episode || !stored) notFound();

  const events = await getEvents(siteId);
  const candidates = episode.candidates.slice(0, 5);
  const c = stored.case;

  return (
    <div className="page-narrow" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
      <CaseActions siteId={site.id} siteName={site.name} />

      <div className="panel" style={{ padding: "clamp(1.5rem, 3.5vw, 2.5rem)" }}>
        <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
          <Link href="/" style={{ textDecoration: "none" }}>PlumePrint</Link> ·{" "}
          <Link href={`/site/${site.id}/`} style={{ textDecoration: "none" }}>{site.name}</Link> · Case File
        </p>

        <div style={{ display: "flex", gap: "var(--s3)", alignItems: "center", flexWrap: "wrap" }}>
          <span className={`verdict d-${c.verdict}`}>{c.verdict.replace(/_/g, " ")}</span>
          <span className="caption" style={{ color: "var(--ink-mute)" }}>confidence: {c.confidence_label}</span>
          {!c.agrees_with_rules && (
            <span className="verdict d-WEAK_MATCH">investigator disagrees with the rules</span>
          )}
        </div>

        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.7rem)", marginTop: "var(--s4)" }}>{c.headline}</h1>

        <p className="small" style={{ marginTop: "var(--s3)", color: "var(--ink-soft)", marginBottom: 0 }}>
          {formatUtc(Date.parse(episode.start_utc), site.tz)} · {episode.n_hours} hours duration · peak{" "}
          <strong className="mono" style={{ color: c.verdict === "UNEXPLAINED" ? "var(--unexplained)" : "var(--matched)" }}>
            {episode.peak_ppb} ppb
          </strong>{" "}
          against background of <span className="mono">{episode.baseline_ppb} ppb</span> · wind from the{" "}
          <strong>{compass(episode.wd_mean_deg)}</strong> ({episode.wd_mean_deg ?? "—"}°, {episode.wind_source === "aqs" ? "measured on-site" : "modelled"})
        </p>
      </div>

      <section className="panel" style={{ marginTop: "var(--gap)", padding: "clamp(1.5rem, 3vw, 2.25rem)" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "var(--s4)" }}>What the records show</h2>
        <ol style={{ paddingLeft: "var(--s5)", margin: 0 }}>
          {c.reasoning.map((step, i) => (
            <li key={i} style={{ marginBottom: i < c.reasoning.length - 1 ? "var(--s4)" : 0 }}>
              <div style={{ fontWeight: 450, lineHeight: 1.5 }}>{step.claim}</div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "var(--s2)" }}>
                {step.evidence.map((ev) => (
                  <span
                    key={ev}
                    className="mono caption"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--hairline-strong)",
                      padding: "0.15rem 0.45rem",
                      borderRadius: "var(--r-sm)",
                      fontSize: "0.76rem",
                      color: "var(--ink-soft)",
                    }}
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div
        className="cols"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))", marginTop: "var(--gap)" }}
      >
        <section className="panel" style={{ padding: "clamp(1.25rem, 2.5vw, 1.75rem)" }}>
          <h3 style={{ fontSize: "1.2rem", marginTop: 0 }}>Other explanations that fit</h3>
          <p className="small" style={{ color: "var(--ink-soft)" }}>
            No matching report is not evidence of wrongdoing. Each of these would look the
            same in these records:
          </p>
          <ul style={{ paddingLeft: "var(--s4)", margin: 0 }}>
            {c.innocent_explanations.map((x, i) => (
              <li key={i} className="small" style={{ marginBottom: "var(--s2)" }}>{x}</li>
            ))}
          </ul>
        </section>

        <section className="panel" style={{ padding: "clamp(1.25rem, 2.5vw, 1.75rem)" }}>
          <h3 style={{ fontSize: "1.2rem", marginTop: 0 }}>What would settle it</h3>
          <ul style={{ paddingLeft: "var(--s4)", margin: 0 }}>
            {c.what_would_settle_it.map((x, i) => (
              <li key={i} className="small" style={{ marginBottom: "var(--s2)" }}>{x}</li>
            ))}
          </ul>
        </section>
      </div>

      {candidates.length > 0 && (
        <section className="panel" style={{ marginTop: "var(--gap)", padding: "clamp(1.25rem, 2.5vw, 1.75rem)", overflowX: "auto" }}>
          <div style={{ marginBottom: "var(--s3)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: "1.35rem", margin: 0 }}>Reports considered</h2>
            <span className="caption" style={{ color: "var(--ink-mute)" }}>Evaluated across temporal & directional windows</span>
          </div>
          <table className="rows">
            <thead>
              <tr>
                <th>Facility</th>
                <th>Incident</th>
                <th>Reported</th>
                <th>Time fit</th>
                <th>Upwind fit</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((cand) => {
                const report = events.find((e) => e.incident === cand.incident);
                return (
                  <tr key={cand.incident}>
                    <td>{cand.facility}</td>
                    <td>
                      <a href={report?.url} target="_blank" rel="noopener noreferrer" className="mono caption">
                        {cand.incident} ↗
                      </a>
                    </td>
                    <td className="num">{cand.pollutant_lb.toLocaleString()} lb</td>
                    <td className="num">{pct(cand.s_time)}</td>
                    <td className="num">{pct(cand.s_bearing)}</td>
                    <td className="num">{cand.confidence?.toFixed(2) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {stored.trace.length > 0 && (
        <section className="panel" style={{ marginTop: "var(--gap)", padding: "clamp(1.25rem, 2.5vw, 1.75rem)" }}>
          <h2 style={{ fontSize: "1.35rem", marginBottom: "var(--s3)" }}>How this was investigated</h2>
          <ol className="small" style={{ paddingLeft: "var(--s5)", margin: 0 }}>
            {stored.trace.map((step) => (
              <li key={step.seq} style={{ marginBottom: "var(--s2)" }}>
                <span className="mono" style={{ color: "var(--accent)", fontWeight: 500 }}>{step.tool}</span> — {step.summary}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section id="records-request" className="panel" style={{ marginTop: "var(--gap)", padding: "clamp(1.5rem, 3vw, 2.25rem)" }}>
        <h2 style={{ fontSize: "1.45rem", marginBottom: "var(--s2)" }}>Ask for the records yourself</h2>
        <p className="small" style={{ color: "var(--ink-soft)" }}>
          This is a formal request for public records under the Texas Public Information Act (Texas Gov&rsquo;t Code § 552),
          not an accusation. Review it, download or copy it, and submit it to TCEQ Open Records.
        </p>
        <RequestDraft text={c.request_draft} />
      </section>

      <p className="caption" style={{ marginTop: "var(--s6)", maxWidth: "46rem", color: "var(--ink-mute)" }}>
        Written by {stored.model}
        {stored.verified === true
          ? ", and checked against the source data: every number here appears in a tool result, and every reference resolves."
          : ", assembled directly from pipeline output."}{" "}
        Rule-based verdict: {episode.verdict.replace(/_/g, " ")} — {episode.verdict_reason}.
      </p>
    </div>
  );
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
}
