import { describe, expect, it } from "vitest";

import { buildDesktopWindowFailurePageHtml } from "./desktopWindowFailure";

describe("desktopWindowFailure", () => {
  it("renders failure details and escapes unsafe content", () => {
    const html = buildDesktopWindowFailurePageHtml({
      appDisplayName: "T3 Code (Dev)",
      heading: "Renderer crashed",
      summary: "Desktop shell hit a fatal renderer failure.",
      detailLines: ['URL: http://localhost:3000/?q=<script>alert("x")</script>'],
      logPath: "C:\\logs\\desktop-main.log",
    });

    expect(html).toContain("Renderer crashed");
    expect(html).toContain("Desktop shell switched to safe fallback page.");
    expect(html).toContain("C:\\logs\\desktop-main.log");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("omits optional sections when no details or log path exist", () => {
    const html = buildDesktopWindowFailurePageHtml({
      appDisplayName: "T3 Code (Alpha)",
      heading: "Page failed to load",
      summary: "Bundled app shell could not load.",
      detailLines: [],
      logPath: null,
    });

    expect(html).not.toContain("<h2>Details</h2>");
    expect(html).not.toContain("<h2>Log file</h2>");
  });
});
