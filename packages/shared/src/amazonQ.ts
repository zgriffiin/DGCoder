export interface AmazonQIdentityCenterLoginSettings {
  readonly binaryPath?: string;
  readonly identityProviderUrl?: string;
  readonly identityCenterRegion?: string;
}

const SAFE_CLI_ARG_PATTERN = /^[A-Za-z0-9_./:=@%+-]+$/;

function formatCliArg(value: string): string {
  return SAFE_CLI_ARG_PATTERN.test(value) ? value : JSON.stringify(value);
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function hasAmazonQIdentityCenterLoginSettings(
  settings: AmazonQIdentityCenterLoginSettings,
): boolean {
  return Boolean(nonEmpty(settings.identityProviderUrl) && nonEmpty(settings.identityCenterRegion));
}

export function buildAmazonQIdentityCenterLoginCommand(
  settings: AmazonQIdentityCenterLoginSettings,
): string {
  const binaryPath = nonEmpty(settings.binaryPath) ?? "q";
  const args = [binaryPath, "login", "--license", "pro"];
  const identityProviderUrl = nonEmpty(settings.identityProviderUrl);
  const identityCenterRegion = nonEmpty(settings.identityCenterRegion);

  if (identityProviderUrl && identityCenterRegion) {
    args.push("--identity-provider", identityProviderUrl, "--region", identityCenterRegion);
  }

  return args.map(formatCliArg).join(" ");
}
