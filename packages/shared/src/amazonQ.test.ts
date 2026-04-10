import { describe, expect, it } from "vitest";
import {
  buildAmazonQIdentityCenterLoginCommand,
  hasAmazonQIdentityCenterLoginSettings,
} from "./amazonQ";

describe("Amazon Q IAM Identity Center login helpers", () => {
  it("builds a pro login command with configured Start URL and Region", () => {
    expect(
      buildAmazonQIdentityCenterLoginCommand({
        binaryPath: "q",
        identityProviderUrl: "https://example.awsapps.com/start",
        identityCenterRegion: "us-east-1",
      }),
    ).toBe(
      "q login --license pro --identity-provider https://example.awsapps.com/start --region us-east-1",
    );
  });

  it("falls back to the interactive pro flow until both SSO fields are configured", () => {
    expect(
      buildAmazonQIdentityCenterLoginCommand({
        binaryPath: "C:/Program Files/Amazon Q/q.exe",
        identityProviderUrl: "https://example.awsapps.com/start",
        identityCenterRegion: "",
      }),
    ).toBe('"C:/Program Files/Amazon Q/q.exe" login --license pro');
    expect(
      hasAmazonQIdentityCenterLoginSettings({
        identityProviderUrl: "https://example.awsapps.com/start",
        identityCenterRegion: "",
      }),
    ).toBe(false);
  });
});
