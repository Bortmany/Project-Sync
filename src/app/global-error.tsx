// Last-resort error screen for the whole app, in plain English.

"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'Candara, "Segoe UI", "Trebuchet MS", system-ui, sans-serif',
          background: "#F5F6F7",
          color: "#5F6062",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ color: "#003E51", fontSize: 22, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, fontSize: 14 }}>
            The page could not be loaded. Nothing you were working on has been lost. Please try
            again, and tell your administrator if it keeps happening.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              background: "#00558C",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
