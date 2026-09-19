import Link from "next/link";

import { Grain } from "@/components/Grain";
import { getMeta, getSites } from "@/lib/data";

export const dynamic = "force-static";

export default async function Home() {
  const sites = await getSites();
  const meta = await getMeta();

  const t = sites.reduce(
    (acc, s) => {
      const h = s.headline.all;
      return {
        episodes: acc.episodes + h.episodes_total,
        unexplained: acc.unexplained + h.episodes_unexplained,
        assessed: acc.assessed + h.reports_assessed,
        notSeen: acc.notSeen + h.reports_not_seen,
      };
    },
    { episodes: 0, unexplained: 0, assessed: 0, notSeen: 0 },
  );

  return (
    <>
      <div className="page" style={{ paddingTop: "var(--s6)" }}>
        <div className="hero" style={{ padding: "clamp(2.5rem, 7vw, 6rem) clamp(1.5rem, 5vw, 4.5rem)" }}>
          <Grain />
          <div style={{ position: "relative" }}>
            <p className="eyebrow">Texas · sulfur dioxide · 2021 to 2025</p>
            <h1 style={{ maxWidth: "18ch" }}>
              The air keeps its <span className="serif-em">own</span> records.
            </h1>
            <p className="lead" style={{ marginTop: "var(--s5)" }}>
              Facilities must report their accidental releases. Public monitors record the
              air hour by hour. Nobody checks one against the other.
            </p>
            <p className="lead" style={{ color: "var(--ink)", marginBottom: 0 }}>
              We did, in both directions, and the two records rarely agree.
            </p>
            <div style={{ marginTop: "var(--s5)", display: "flex", gap: "var(--s3)", flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/site/texas-city/" className="btn btn-primary" style={{ padding: "0.6rem 1.4rem", fontSize: "0.95rem", textDecoration: "none" }}>
                Explore Texas City (Reference Site) →
              </Link>
              <Link href="/methods/" className="btn" style={{ padding: "0.6rem 1.25rem", fontSize: "0.95rem", textDecoration: "none" }}>
                Read Methods & Limits
              </Link>
            </div>
          </div>
        </div>
      </div>

      <section className="page">
        <div className="split">
          <div
            className="panel"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "clamp(2rem, 4vw, 3rem)",
            }}
          >
            <div>
              <p className="eyebrow" style={{ color: "var(--unexplained)", marginBottom: "var(--s3)" }}>
                Monitor ledger · Unexplained
              </p>
              <div className="figure" style={{ color: "var(--unexplained)" }}>
                {t.unexplained}
                <span className="of"> / {t.episodes}</span>
              </div>
            </div>
            <p className="lead" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
              pollution episodes recorded by the monitors have{" "}
              <strong style={{ fontWeight: 500 }}>no matching report</strong> from any
              facility in the same county.
            </p>
          </div>

          <div
            className="panel"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "clamp(2rem, 4vw, 3rem)",
            }}
          >
            <div>
              <p className="eyebrow" style={{ color: "var(--ink-mute)", marginBottom: "var(--s3)" }}>
                Facility ledger · Unseen
              </p>
              <div className="figure" style={{ color: "var(--ink-soft)" }}>
                {t.notSeen}
                <span className="of"> / {t.assessed}</span>
              </div>
            </div>
            <p className="lead" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
              releases the facilities reported themselves left{" "}
              <strong style={{ fontWeight: 500 }}>no clear trace</strong> at the nearest
              monitor.
            </p>
          </div>
        </div>
      </section>

      <section className="page">
        <div className="panel-dark split" style={{ alignItems: "center" }}>
          <div>
            <p className="eyebrow" style={{ color: "#8f8a7c" }}>The case that started it</p>
            <h2 style={{ maxWidth: "16ch" }}>
              8,830 pounds. A city told to stay indoors. The monitor read 1.5.
            </h2>
          </div>
          <p className="small" style={{ maxWidth: "36rem", marginBottom: 0 }}>
            On 27 June 2023 the Galveston Bay Refinery reported releasing 8,830 lb of
            sulfur dioxide, and Texas City issued its first shelter-in-place in over a
            decade. The county&rsquo;s only sulfur dioxide monitor, 1.4 km away, peaked at
            1.5 ppb. Two hundred and twenty-eight other hours that year read higher. If the
            paperwork and the air can disagree that completely about an event everyone
            noticed, we wondered what else they disagree about.
          </p>
        </div>
      </section>

      <section className="page">
        <div className="cols">
          {sites.map((s) => {
            const h = s.headline.all;
            return (
              <Link key={s.id} href={`/site/${s.id}/`} className="tile">
                <h3>{s.name}</h3>
                <p className="caption" style={{ marginTop: "var(--s2)" }}>
                  {s.counties.join(" · ")} County
                </p>
                <div style={{ display: "flex", gap: "var(--s6)", marginTop: "var(--s5)" }}>
                  <div>
                    <div className="figure-sm" style={{ color: "var(--unexplained)" }}>
                      {h.episodes_unexplained}
                      <span className="of"> / {h.episodes_total}</span>
                    </div>
                    <div className="caption" style={{ marginTop: "var(--s2)" }}>
                      episodes unexplained
                    </div>
                  </div>
                  <div>
                    <div className="figure-sm" style={{ color: "var(--ink-soft)" }}>
                      {h.reports_not_seen}
                      <span className="of"> / {h.reports_assessed}</span>
                    </div>
                    <div className="caption" style={{ marginTop: "var(--s2)" }}>
                      reports not seen
                    </div>
                  </div>
                </div>
                <p className="small" style={{ marginTop: "var(--s5)", marginBottom: 0 }}>
                  Open the record →
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="page">
        <div className="panel split split-wide" style={{ padding: "clamp(2rem, 5vw, 3.5rem)" }}>
          <div>
            <p className="eyebrow">How it works</p>
            <h2 style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)" }}>
              Three public records, put on one clock.
            </h2>
            <p className="small" style={{ marginTop: "var(--s4)", maxWidth: "28ch" }}>
              Every verdict is grounded in physical evidence and explicit rules, so every match
              and mismatch can be audited.
            </p>
          </div>
          <div style={{ display: "grid", gap: "var(--s4)" }}>
            {[
              ["What the air recorded",
               "Hourly sulfur dioxide from EPA monitors, with the wind measured at the monitor itself wherever it exists."],
              ["What was reported",
               "Every emission event facilities filed with the state, parsed down to the pound and the cause they gave for it."],
              ["Which way the wind blew",
               "A facility counts as upwind only when the wind arrived from its direction, allowing for the width of the plant and the uncertainty of the reading."],
              ["Where the two disagree",
               "Rules decide each verdict, so every one of them can be explained to a resident and argued with by a regulator."],
            ].map(([title, body], i) => (
              <div
                key={title}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2.5rem 1fr",
                  gap: "var(--s4)",
                  alignItems: "baseline",
                  paddingBottom: i < 3 ? "var(--s4)" : 0,
                  borderBottom: i < 3 ? "1px solid var(--hairline)" : "none",
                }}
              >
                <span className="mono caption" style={{ color: "var(--accent)", fontWeight: 600 }}>0{i + 1}</span>
                <div>
                  <h3 style={{ fontSize: "1.15rem" }}>{title}</h3>
                  <p className="small" style={{ marginTop: "var(--s2)", marginBottom: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page">
        <div className="panel" style={{ background: "var(--paper-warm)" }}>
          <p className="eyebrow">What this does not claim</p>
          <p className="lead" style={{ marginBottom: 0, maxWidth: "52rem" }}>
            {meta.caveat}{" "}
            <Link href="/methods/">Read the methods and limits →</Link>
          </p>
        </div>
      </section>
    </>
  );
}
