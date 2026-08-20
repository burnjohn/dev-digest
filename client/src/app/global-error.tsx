/* Last-resort boundary: catches errors thrown by the ROOT layout itself, which
   error.tsx cannot. It replaces the root layout entirely, so it must render its
   own <html>/<body> and cannot rely on globals.css or the vendored UI kit —
   plain inline styles only. */
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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          color: "#e6edf3",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div role="alert" style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            DevDigest hit an unexpected error
          </div>
          <div style={{ fontSize: 14, color: "#9da7b3", lineHeight: 1.5, marginBottom: 16 }}>
            {error.message || "The application shell failed to render."}
          </div>
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "#21262d",
              color: "#e6edf3",
              fontSize: 14,
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
