import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type LocalApi,
  type ServerConfig,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { GeneralSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.makeUnsafe("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
    localStorage.clear();
  });

  afterEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Quality Guardrails")).toBeInTheDocument();
    await expect.element(page.getByText("Agent file-change gate")).toBeInTheDocument();
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("persists quality guardrail threshold and command settings", async () => {
    const updateSettings = vi
      .fn<LocalApi["server"]["updateSettings"]>()
      .mockResolvedValue(DEFAULT_SERVER_SETTINGS);
    window.nativeApi = {
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("spinbutton", { name: "File lines" }).fill("250");

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        qualityGate: {
          ...DEFAULT_SERVER_SETTINGS.qualityGate,
          maxFileLines: 250,
        },
      }),
    );

    await page.getByRole("switch", { name: "Lint" }).click();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        qualityGate: {
          ...DEFAULT_SERVER_SETTINGS.qualityGate,
          lint: false,
          maxFileLines: 250,
        },
      }),
    );

    await page.getByRole("switch", { name: "Intent" }).click();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        qualityGate: {
          ...DEFAULT_SERVER_SETTINGS.qualityGate,
          lint: false,
          requireIntent: false,
          maxFileLines: 250,
        },
      }),
    );
  });

  it("persists the Caveman response style setting", async () => {
    const updateSettings = vi
      .fn<LocalApi["server"]["updateSettings"]>()
      .mockResolvedValue(DEFAULT_SERVER_SETTINGS);
    window.nativeApi = {
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Caveman response style").click();
    await page.getByText("Ultra").click();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        responseStyle: "ultra",
      }),
    );
  });

  it("persists Amazon Q IAM Identity Center SSO settings", async () => {
    const updateSettings = vi
      .fn<LocalApi["server"]["updateSettings"]>()
      .mockResolvedValue(DEFAULT_SERVER_SETTINGS);
    window.nativeApi = {
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Toggle Amazon Q details" }).click();
    await page.getByLabelText("Start URL").fill("https://example.awsapps.com/start");
    await page.getByLabelText("Region").fill("us-east-1");

    await expect
      .element(
        page.getByText(
          "q login --license pro --identity-provider https://example.awsapps.com/start --region us-east-1",
        ),
      )
      .toBeInTheDocument();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          amazonQ: {
            ...DEFAULT_SERVER_SETTINGS.providers.amazonQ,
            identityProviderUrl: "https://example.awsapps.com/start",
            identityCenterRegion: "us-east-1",
          },
        },
      }),
    );
  });

  it("persists Kiro WSL execution settings", async () => {
    const updateSettings = vi
      .fn<LocalApi["server"]["updateSettings"]>()
      .mockResolvedValue(DEFAULT_SERVER_SETTINGS);
    window.nativeApi = {
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Toggle Kiro details" }).click();
    await expect
      .element(page.getByText('wsl.exe --exec bash -lc "exec \\"$@\\"" bash kiro-cli login'))
      .toBeInTheDocument();
    await page.getByRole("switch", { name: "Run Kiro through WSL" }).click();
    await page.getByRole("switch", { name: "Run Kiro through WSL" }).click();
    await page.getByLabelText("WSL distro").fill("Ubuntu");

    await expect
      .element(
        page.getByText('wsl.exe -d Ubuntu --exec bash -lc "exec \\"$@\\"" bash kiro-cli login'),
      )
      .toBeInTheDocument();

    await vi.waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          kiro: {
            ...DEFAULT_SERVER_SETTINGS.providers.kiro,
            executionMode: "wsl",
            wslDistro: "Ubuntu",
          },
        },
      }),
    );
  });
});
