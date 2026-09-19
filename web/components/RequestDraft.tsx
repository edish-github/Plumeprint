"use client";

import { useState } from "react";

/** The records request, with a copy button. The user sends it themselves; the app never
 *  contacts an agency on anyone's behalf. */
export function RequestDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadTxt() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tpia-records-request.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const mailtoUrl = `mailto:open.records@tceq.texas.gov?subject=TPIA%20Public%20Information%20Request%20-%20Air%20Quality%20Records&body=${encodeURIComponent(text)}`;

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--s3)", flexWrap: "wrap", alignItems: "center", marginBottom: "var(--s4)" }}>
        <button
          onClick={copy}
          className="btn btn-solid"
          style={{
            background: copied ? "var(--matched)" : undefined,
            borderColor: copied ? "var(--matched)" : undefined,
          }}
        >
          {copied ? "✓ Copied to clipboard!" : "Copy request draft"}
        </button>
        <button onClick={downloadTxt} className="btn">
          Download .txt
        </button>
        <a
          href={mailtoUrl}
          className="btn"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "none" }}
        >
          Email TCEQ Open Records ↗
        </a>
        <span className="caption" style={{ color: "var(--ink-mute)", marginLeft: "auto" }}>
          Target: open.records@tceq.texas.gov · Texas Gov&rsquo;t Code § 552
        </span>
      </div>
      <pre
        className="panel"
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
          lineHeight: 1.7,
          margin: 0,
          background: "var(--paper-warm)",
          color: "var(--ink-soft)",
          border: "1px solid var(--hairline-strong)",
        }}
      >
        {text}
      </pre>
    </div>
  );
}
