"use client";

import Link from "next/link";
import { useState } from "react";

export function CaseActions({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      if (typeof window !== "undefined") {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      }
    } catch {
      // Fallback if clipboard API is restricted
    }
  };

  const handleJumpToDraft = () => {
    document.getElementById("records-request")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--s3)",
        marginBottom: "var(--s4)",
      }}
    >
      <Link
        href={`/site/${siteId}/`}
        className="btn"
        style={{
          fontSize: "0.84rem",
          padding: "0.38rem 0.85rem",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        <span>←</span>
        <span>Back to {siteName} workspace</span>
      </Link>

      <div style={{ display: "flex", gap: "var(--s2)", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleJumpToDraft}
          className="btn"
          style={{ fontSize: "0.82rem", padding: "0.38rem 0.85rem" }}
        >
          Draft Records Request ↓
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="btn"
          style={{
            fontSize: "0.82rem",
            padding: "0.38rem 0.85rem",
            background: copied ? "var(--matched)" : undefined,
            color: copied ? "var(--paper)" : undefined,
            borderColor: copied ? "var(--matched)" : undefined,
            transition: "all 0.15s ease",
          }}
        >
          {copied ? "✓ Link copied!" : "Share case file"}
        </button>
      </div>
    </div>
  );
}
