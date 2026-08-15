/* Last-resort boundary: catches errors thrown by the ROOT layout itself, which
   `app/error.tsx` cannot — it renders inside that layout.

   This file replaces the root layout entirely, so it must ship its own <html>
   and <body>, and it runs with no providers: no next-intl (hence literal
   English), no theme, no query client. Keep it dependency-free on purpose —
   a boundary that can itself throw is not a boundary. */
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0b0d10",
          color: "#e6e8eb",
        }}
      >
        <div style={{ textAlign: "center", padding: 28, maxWidth: 420 }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#9aa4ae", margin: "0 0 20px" }}>
            {error.message}
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: 14,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #2a2f36",
              background: "#151920",
              color: "#e6e8eb",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
