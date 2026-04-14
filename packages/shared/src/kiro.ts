import {
  resolveCliAgentCommand,
  type CliAgentCommandSettings,
  type ResolveCliAgentCommandOptions,
} from "./cliAgentCommand";

export interface KiroLoginSettings extends CliAgentCommandSettings {
  readonly identityProviderUrl?: string;
  readonly identityCenterRegion?: string;
}

type KiroIdentityCenterSettings = Pick<
  KiroLoginSettings,
  "identityProviderUrl" | "identityCenterRegion"
>;

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function hasKiroIdentityCenterLoginSettings(settings: KiroIdentityCenterSettings): boolean {
  return Boolean(nonEmpty(settings.identityProviderUrl) && nonEmpty(settings.identityCenterRegion));
}

export function buildKiroLoginCommand(
  settings: KiroLoginSettings,
  options?: ResolveCliAgentCommandOptions,
): string {
  const args = ["login", "--license", "pro"];
  const identityProviderUrl = nonEmpty(settings.identityProviderUrl);
  const identityCenterRegion = nonEmpty(settings.identityCenterRegion);

  if (identityProviderUrl && identityCenterRegion) {
    args.push("--identity-provider", identityProviderUrl, "--region", identityCenterRegion);
  }

  return resolveCliAgentCommand(settings, args, options).display;
}
