import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";

import "./tokens.css";

/* A serif with real editorial presence for display, a quiet sans for reading, and a mono
   for anything a reader might need to quote: monitor ids, incident numbers, quantities. */
const serif = Instrument_Serif({
  subsets: ["latin"], weight: ["400"], style: ["normal", "italic"],
  variable: "--font-serif", display: "swap",
});
const sans = Inter({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-face", display: "swap",
});

export const metadata: Metadata = {
  title: "PlumePrint — the air keeps its own records",
  description:
    "Audits what industrial facilities told the regulator against what the air monitors and the wind recorded.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(250,247,242,.88)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--hairline)" }}>
          <div
            className="page"
            style={{ display: "flex", alignItems: "center", gap: "var(--s5)", height: "3.6rem" }}
          >
            <Link
              href="/"
              style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", textDecoration: "none", letterSpacing: "-0.02em" }}
            >
              PlumePrint
            </Link>
            <span className="caption" style={{ flex: 1 }}>the air keeps its own records</span>
            <Link href="/methods/" className="small" style={{ textDecoration: "none" }}>
              Methods
            </Link>
          </div>
        </header>

        <main>{children}</main>

        <footer style={{ borderTop: "1px solid var(--hairline)", marginTop: "var(--s9)", padding: "var(--s7) 0 var(--s8)" }}>
          <div className="page split">
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem" }}>PlumePrint</div>
              <p className="small" style={{ marginTop: "var(--s2)" }}>
                Built for NextStep Hacks 2026 from public records only. No matching report
                does not mean an illegal release.
              </p>
            </div>
            <div className="caption" style={{ display: "grid", gap: "var(--s2)", alignContent: "start" }}>
              <span>EPA AQS · hourly monitor and wind data</span>
              <span>TCEQ · self-reported emission events</span>
              <span>EPA FRS and ECHO · facility locations</span>
              <span>Weather data by Open-Meteo.com</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
