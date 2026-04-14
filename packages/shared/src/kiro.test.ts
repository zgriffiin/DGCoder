import { describe, expect, it } from "vitest";

import { buildKiroLoginCommand, hasKiroIdentityCenterLoginSettings } from "./kiro";

describe("Kiro IAM Identity Center login helpers", () => {
  it("builds a pro login command with configured Start URL and Region", () => {
    expect(
      buildKiroLoginCommand(
        {
          binaryPath: "kiro-cli",
          executionMode: "host",
          identityProviderUrl: "https://example.awsapps.com/start",
          identityCenterRegion: "us-east-1",
        },
        { platform: "linux" },
      ),
    ).toBe(
      "kiro-cli login --license pro --identity-provider https://example.awsapps.com/start --region us-east-1",
    );
  });

  it("wraps enterprise login in WSL when configured on Windows", () => {
    expect(
      buildKiroLoginCommand(
        {
          binaryPath: "kiro-cli",
          executionMode: "wsl",
          wslDistro: "Ubuntu",
          identityProviderUrl: "https://example.awsapps.com/start",
          identityCenterRegion: "us-east-1",
        },
        { platform: "win32" },
      ),
    ).toBe(
      'wsl.exe -d Ubuntu --exec bash -lc "exec \\"$@\\"" bash kiro-cli login --license pro --identity-provider https://example.awsapps.com/start --region us-east-1',
    );
  });

  it("falls back to the generic pro flow until both enterprise fields are configured", () => {
    expect(
      buildKiroLoginCommand(
        {
          binaryPath: "kiro-cli",
          executionMode: "host",
          identityProviderUrl: "https://example.awsapps.com/start",
          identityCenterRegion: "",
        },
        { platform: "linux" },
      ),
    ).toBe("kiro-cli login --license pro");
    expect(
      hasKiroIdentityCenterLoginSettings({
        identityProviderUrl: "https://example.awsapps.com/start",
        identityCenterRegion: "",
      }),
    ).toBe(false);
  });
});
