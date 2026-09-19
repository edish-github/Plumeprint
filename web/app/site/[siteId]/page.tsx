import Link from "next/link";
import { notFound } from "next/navigation";

import { Grain } from "@/components/Grain";
import { SiteWorkspace } from "@/components/SiteWorkspace";
import { getFingerprint, getSites } from "@/lib/data";
import { buildSiteView } from "@/lib/view";

export const dynamic = "force-static";

export async function generateStaticParams() {
  return (await getSites()).map((s) => ({ siteId: s.id }));
}

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const sites = await getSites();
  if (!sites.some((s) => s.id === siteId)) notFound();

  const view = await buildSiteView(siteId);
  const { site, reports, episodes } = view;
  const h = site.headline.all;
  const primary = site.monitors.find((m) => m.role === "primary")!;
  const fingerprint = (await getFingerprint(siteId))[primary.id]?.["0"] ?? null;

  const unexplained = [...episodes]
    .filter((e) => e.verdict === "UNEXPLAINED")
    .sort((a, b) => b.peak_ppb - a.peak_ppb)
    .slice(0, 10);
  const unseen = [...reports]
    .filter((r) => r.status.startsWith("UNSEEN"))
    .sort((a, b) => b.pollutant_lb - a.pollutant_lb)
    .slice(0, 10);

  return (
    <>
      <div className="page" style={{ paddingTop: "var(--s6)" }}>
        <div className="hero" style={{ padding: "clamp(2rem, 5vw, 3.5rem) clamp(1.5rem, 4vw, 3.5rem)" }}>
          <Grain opacity={0.26} />
          <div style={{ position: "relative" }}>
            <p className="eyebrow">
              <Link href="/" style={{ textDecoration: "none" }}>PlumePrint</Link>
              {" · "}
              {site.counties.join(" · ")} County
            </p>
            <h1 style={{ fontSize: "clamp(2.4rem, 5vw, 3.8rem)" }}>{site.name}</h1>
            <p className="lead" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
              Monitor <span className="mono">{primary.id}</span>, {coveredYears(site.years)}, against every emission event filed in{" "}
              {site.counties.join(" or ")} County.{" "}
              {primary.has_onsite_wind
                ? "Wind is measured at the monitor itself."
                : "The monitor records no wind of its own, so modelled wind is used and judged more loosely."}
            </p>
          </div>
        </div>
      </div>

      <section className="page">
        <div className="cols">
          {[
            { n: h.episodes_unexplained, d: h.episodes_total, label: "episodes with no matching report", eyebrow: "Unexplained episodes", color: "var(--unexplained)" },
            { n: h.reports_not_seen, d: h.reports_assessed, label: "reported releases the monitor never clearly saw", eyebrow: "Unseen releases", color: "var(--ink-soft)" },
            { n: h.episodes_matched, d: null, label: "episodes a filed report does explain", eyebrow: "Matched episodes", color: "var(--matched)" },
          ].map((f) => (
            <div
              key={f.label}
              className="panel"
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                padding: "clamp(1.5rem, 3vw, 2.25rem)",
              }}
            >
              <div>
                <p className="eyebrow" style={{ color: f.color, marginBottom: "var(--s2)" }}>
                  {f.eyebrow}
                </p>
                <div className="figure-sm" style={{ color: f.color, fontSize: "clamp(2.4rem, 4.5vw, 3.2rem)", lineHeight: 1 }}>
                  {f.n}
                  {f.d !== null && <span className="of"> / {f.d}</span>}
                </div>
              </div>
              <p className="small" style={{ marginTop: "var(--s4)", marginBottom: 0, color: "var(--ink-soft)" }}>
                {f.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <SiteWorkspace
        site={site}
        reports={reports}
        episodes={episodes}
        from={view.from}
        to={view.to}
        maxPeakPpb={view.maxPeakPpb}
        seriesByYear={view.seriesByYear}
        years={site.years}
        fingerprint={fingerprint}
        unexplained={unexplained}
        unseen={unseen}
      />
    </>
  );
}



function coveredYears(years: number[]): string {
  const now = new Date().getUTCFullYear();
  const real = years.filter((y) => y <= now);
  return real.length > 1 ? `${real[0]} to ${real.at(-1)}` : String(real[0] ?? "");
}
