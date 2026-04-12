export interface DesktopWindowFailurePageInput {
  readonly appDisplayName: string;
  readonly heading: string;
  readonly summary: string;
  readonly detailLines: ReadonlyArray<string>;
  readonly logPath: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildDesktopWindowFailurePageHtml(input: DesktopWindowFailurePageInput): string {
  const detailSection =
    input.detailLines.length > 0
      ? `<section><h2>Details</h2><pre>${escapeHtml(input.detailLines.join("\n"))}</pre></section>`
      : "";
  const logSection = input.logPath
    ? `<section><h2>Log file</h2><pre>${escapeHtml(input.logPath)}</pre></section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.appDisplayName)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1115;
        --panel: rgba(255, 255, 255, 0.05);
        --border: rgba(255, 255, 255, 0.12);
        --fg: #f4f7fb;
        --muted: #b8c0cc;
        --danger: #ff8a7a;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 32px;
        background:
          radial-gradient(circle at top, rgba(255, 138, 122, 0.16), transparent 36%),
          var(--bg);
        color: var(--fg);
        font-family: "Segoe UI", "SF Pro Display", "Inter", sans-serif;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 28px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--panel);
        backdrop-filter: blur(8px);
      }
      p,
      li {
        color: var(--muted);
        line-height: 1.55;
      }
      h1,
      h2 {
        margin: 0 0 12px;
      }
      h1 {
        color: var(--danger);
        font-size: 30px;
      }
      h2 {
        margin-top: 24px;
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        color: var(--fg);
      }
      ul {
        margin: 18px 0 0;
        padding-left: 20px;
      }
      section {
        margin-top: 22px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.summary)}</p>
      <ul>
        <li>Desktop shell switched to safe fallback page.</li>
        <li>Close and relaunch app after checking log.</li>
      </ul>
      ${detailSection}
      ${logSection}
    </main>
  </body>
</html>`;
}
