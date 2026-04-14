import { ArchiveIcon, ArchiveX, LoaderIcon, RefreshCwIcon, Undo2Icon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  type PiRuntimeSnapshot,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { Equal } from "effect";
import { buildKiroLoginCommand, hasKiroIdentityCenterLoginSettings } from "@t3tools/shared/kiro";
import { APP_VERSION } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { isElectron } from "../../env";
import { usePiRuntime } from "../../hooks/usePiRuntime";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktopUpdateReactQuery";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../../store";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  applyProvidersUpdated,
  useServerAvailableEditors,
  useServerConfig,
  useServerKeybindingsConfigPath,
  useServerObservability,
} from "../../rpc/serverState";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const CONNECTION_STATUS_STYLES = {
  success: "bg-success",
  muted: "bg-muted-foreground/40",
  warning: "bg-warning",
} as const;

type ConnectionSummary = {
  headline: string;
  detail: string;
  dotClassName: (typeof CONNECTION_STATUS_STYLES)[keyof typeof CONNECTION_STATUS_STYLES];
};

function getPiProviderSummary(
  runtime: PiRuntimeSnapshot | null,
  providerId: string,
  label: string,
): ConnectionSummary {
  if (!runtime) {
    return {
      headline: "Checking runtime",
      detail: `Waiting for DGCode to load Pi's ${label} catalog.`,
      dotClassName: CONNECTION_STATUS_STYLES.muted,
    };
  }

  const provider = runtime.providers.find((entry) => entry.provider === providerId);
  if (!provider) {
    return {
      headline: "Unavailable",
      detail: `${label} is not present in Pi's current model catalog.`,
      dotClassName: CONNECTION_STATUS_STYLES.warning,
    };
  }

  if (provider.availableModels > 0) {
    return {
      headline: "Authenticated",
      detail: `${provider.availableModels} of ${provider.totalModels} ${label} models are ready in the Pi runtime.`,
      dotClassName: CONNECTION_STATUS_STYLES.success,
    };
  }

  return {
    headline: "Not authenticated",
    detail: `Pi knows ${provider.totalModels} ${label} models, but none are connected yet.`,
    dotClassName: CONNECTION_STATUS_STYLES.warning,
  };
}

function getServerProviderSummary(
  provider: ServerProvider | null,
  label: string,
): ConnectionSummary {
  if (!provider) {
    return {
      headline: "Checking status",
      detail: `Waiting for DGCode to probe the ${label} CLI.`,
      dotClassName: CONNECTION_STATUS_STYLES.muted,
    };
  }

  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: "Disabled",
      detail: provider.message ?? `${label} is disabled in settings.`,
      dotClassName: CONNECTION_STATUS_STYLES.muted,
    };
  }

  if (!provider.installed) {
    return {
      headline: "Not installed",
      detail: provider.message ?? `${label} CLI is not installed or not on PATH.`,
      dotClassName: CONNECTION_STATUS_STYLES.warning,
    };
  }

  if (provider.auth.status === "authenticated" && provider.status === "ready") {
    const authLabel = provider.auth.label ?? "authenticated";
    const versionDetail = provider.version ? ` Version ${provider.version}.` : "";
    return {
      headline: "Authenticated",
      detail: `${authLabel} is ready.${versionDetail}`,
      dotClassName: CONNECTION_STATUS_STYLES.success,
    };
  }

  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? `Run the ${label} login flow, then reload status.`,
      dotClassName: CONNECTION_STATUS_STYLES.warning,
    };
  }

  return {
    headline: provider.status === "error" ? "Error" : "Needs attention",
    detail: provider.message ?? `DGCode could not verify the ${label} CLI status.`,
    dotClassName: CONNECTION_STATUS_STYLES.warning,
  };
}

function thresholdInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseThresholdInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function useRelativeTimeTick(intervalMs = 1_000) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

function SettingsPageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">{children}</div>
    </div>
  );
}

function ConnectionCard({
  title,
  summary,
  actions,
  children,
}: {
  title: string;
  summary: ConnectionSummary;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-h-5 items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", summary.dotClassName)} />
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.headline}
              {summary.detail ? ` - ${summary.detail}` : null}
            </p>
          </div>
          {actions ? (
            <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">{children}</div>
      ) : null}
    </div>
  );
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();

  const updateState = updateStateQuery.data ?? null;

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          });
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null },
        ),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "Install failed.",
          });
        });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        if (!result.checked) {
          toastManager.add({
            type: "error",
            title: "Could not check for updates",
            description:
              result.state.message ?? "Automatic updates are not available in this build.",
          });
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not check for updates",
          description: error instanceof Error ? error.message : "Update check failed.",
        });
      });
  }, [queryClient, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : "Current version of the application.";

  return (
    <SettingsRow
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant={action === "install" ? "default" : "outline"}
                disabled={buttonDisabled}
                onClick={handleButtonClick}
              >
                {buttonLabel}
              </Button>
            }
          />
          {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
        </Tooltip>
      }
    />
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();

  const areConnectionHelperSettingsDirty =
    !Equal.equals(settings.providers.kiro, DEFAULT_UNIFIED_SETTINGS.providers.kiro) ||
    !Equal.equals(settings.providers.codex, DEFAULT_UNIFIED_SETTINGS.providers.codex);
  const isQualityGateDirty = !Equal.equals(
    settings.qualityGate,
    DEFAULT_UNIFIED_SETTINGS.qualityGate,
  );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(areConnectionHelperSettingsDirty ? ["Connection helpers"] : []),
      ...(isQualityGateDirty ? ["Quality guardrails"] : []),
    ],
    [
      areConnectionHelperSettingsDirty,
      isQualityGateDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffWordWrap,
      settings.timestampFormat,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    onRestored?.();
  }, [changedSettingLabels, onRestored, resetSettings, setTheme]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [openingPathByTarget, setOpeningPathByTarget] = useState({
    keybindings: false,
    logsDirectory: false,
    piAuthFile: false,
  });
  const [openPathErrorByTarget, setOpenPathErrorByTarget] = useState<
    Partial<Record<"keybindings" | "logsDirectory" | "piAuthFile", string | null>>
  >({});
  const [isRefreshingProviderStatus, setIsRefreshingProviderStatus] = useState(false);
  const [isLaunchingAuthFlow, setIsLaunchingAuthFlow] = useState({
    codex: false,
    kiro: false,
  });

  const serverConfig = useServerConfig();
  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const {
    snapshot: piRuntime,
    checkedAt: piRuntimeCheckedAt,
    isRefreshing: isRefreshingPiRuntime,
    refreshRuntime: refreshPiRuntime,
  } = usePiRuntime();
  const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
  const piAuthFilePath = piRuntime?.authFilePath ?? null;
  const diagnosticsDescription = (() => {
    const exports: string[] = [];
    if (observability?.otlpTracesEnabled && observability.otlpTracesUrl) {
      exports.push(`traces to ${observability.otlpTracesUrl}`);
    }
    if (observability?.otlpMetricsEnabled && observability.otlpMetricsUrl) {
      exports.push(`metrics to ${observability.otlpMetricsUrl}`);
    }
    const mode = observability?.localTracingEnabled ? "Local trace file" : "Terminal logs only";
    return exports.length > 0 ? `${mode}. OTLP exporting ${exports.join(" and ")}.` : `${mode}.`;
  })();

  const qualityGate = settings.qualityGate;
  const isQualityGateDirty = !Equal.equals(qualityGate, DEFAULT_UNIFIED_SETTINGS.qualityGate);
  const updateQualityGate = useCallback(
    (patch: Partial<typeof qualityGate>) => {
      updateSettings({
        qualityGate: {
          ...qualityGate,
          ...patch,
        },
      });
    },
    [qualityGate, updateSettings],
  );

  const refreshServerProviders = useCallback(() => {
    setIsRefreshingProviderStatus(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .then((payload) => {
        applyProvidersUpdated(payload);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not refresh provider status",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      })
      .finally(() => {
        setIsRefreshingProviderStatus(false);
      });
  }, []);

  const openInPreferredEditor = useCallback(
    (
      target: "keybindings" | "logsDirectory" | "piAuthFile",
      path: string | null,
      failureMessage: string,
    ) => {
      if (!path) return;
      setOpenPathErrorByTarget((existing) => ({ ...existing, [target]: null }));
      setOpeningPathByTarget((existing) => ({ ...existing, [target]: true }));

      const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        setOpenPathErrorByTarget((existing) => ({
          ...existing,
          [target]: "No available editors found.",
        }));
        setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        return;
      }

      void ensureLocalApi()
        .shell.openInEditor(path, editor)
        .catch((error) => {
          setOpenPathErrorByTarget((existing) => ({
            ...existing,
            [target]: error instanceof Error ? error.message : failureMessage,
          }));
        })
        .finally(() => {
          setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        });
    },
    [availableEditors],
  );

  const openKeybindingsFile = useCallback(() => {
    openInPreferredEditor("keybindings", keybindingsConfigPath, "Unable to open keybindings file.");
  }, [keybindingsConfigPath, openInPreferredEditor]);

  const openLogsDirectory = useCallback(() => {
    openInPreferredEditor("logsDirectory", logsDirectoryPath, "Unable to open logs folder.");
  }, [logsDirectoryPath, openInPreferredEditor]);

  const openPiAuthFile = useCallback(() => {
    openInPreferredEditor("piAuthFile", piAuthFilePath, "Unable to open Pi auth file.");
  }, [openInPreferredEditor, piAuthFilePath]);

  const openKeybindingsError = openPathErrorByTarget.keybindings ?? null;
  const openDiagnosticsError = openPathErrorByTarget.logsDirectory ?? null;
  const openPiAuthFileError = openPathErrorByTarget.piAuthFile ?? null;
  const isOpeningKeybindings = openingPathByTarget.keybindings;
  const isOpeningLogsDirectory = openingPathByTarget.logsDirectory;
  const isOpeningPiAuthFile = openingPathByTarget.piAuthFile;

  const codexSummary = useMemo(
    () => getPiProviderSummary(piRuntime, "openai-codex", "Codex"),
    [piRuntime],
  );
  const kiroProvider = useMemo(
    () => serverConfig?.providers.find((entry) => entry.provider === "kiro") ?? null,
    [serverConfig],
  );
  const kiroLoginCommand = useMemo(
    () =>
      buildKiroLoginCommand(
        {
          binaryPath: settings.providers.kiro.binaryPath,
          executionMode: settings.providers.kiro.executionMode,
          wslDistro: settings.providers.kiro.wslDistro,
          identityProviderUrl: settings.providers.kiro.identityProviderUrl,
          identityCenterRegion: settings.providers.kiro.identityCenterRegion,
        },
        { platform: "win32" },
      ),
    [
      settings.providers.kiro.binaryPath,
      settings.providers.kiro.executionMode,
      settings.providers.kiro.identityCenterRegion,
      settings.providers.kiro.identityProviderUrl,
      settings.providers.kiro.wslDistro,
    ],
  );
  const kiroHasIdentityCenterSettings = useMemo(
    () =>
      hasKiroIdentityCenterLoginSettings({
        identityProviderUrl: settings.providers.kiro.identityProviderUrl,
        identityCenterRegion: settings.providers.kiro.identityCenterRegion,
      }),
    [settings.providers.kiro.identityCenterRegion, settings.providers.kiro.identityProviderUrl],
  );
  const kiroSummary = useMemo<ConnectionSummary>(() => {
    if (!isElectron) {
      return {
        headline: "Desktop only",
        detail: "Kiro login helpers are only available in the desktop app.",
        dotClassName: CONNECTION_STATUS_STYLES.muted,
      };
    }

    return getServerProviderSummary(kiroProvider, "Kiro");
  }, [kiroProvider]);

  const launchAuthFlow = useCallback(
    async (provider: "codex" | "kiro") => {
      setIsLaunchingAuthFlow((existing) => ({ ...existing, [provider]: true }));
      try {
        await ensureLocalApi().shell.launchAuthFlow(
          provider === "kiro"
            ? {
                provider,
                executionMode: settings.providers.kiro.executionMode,
                wslDistro: settings.providers.kiro.wslDistro,
                identityProviderUrl: settings.providers.kiro.identityProviderUrl,
                identityCenterRegion: settings.providers.kiro.identityCenterRegion,
              }
            : { provider },
        );
        toastManager.add({
          type: "success",
          title: provider === "codex" ? "Opened Codex login" : "Opened Kiro login",
          description:
            provider === "codex"
              ? "A Pi terminal opened. Run `/login openai-codex`, then complete ChatGPT sign-in in your browser."
              : "A Kiro login terminal opened. Complete the CLI login flow there, then reload status.",
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: provider === "codex" ? "Could not open Codex login" : "Could not open Kiro login",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      } finally {
        setIsLaunchingAuthFlow((existing) => ({ ...existing, [provider]: false }));
      }
    },
    [
      settings.providers.kiro.executionMode,
      settings.providers.kiro.identityCenterRegion,
      settings.providers.kiro.identityProviderUrl,
      settings.providers.kiro.wslDistro,
    ],
  );

  const piModelCountSummary = piRuntime
    ? `${piRuntime.configuredModelCount} authenticated model${piRuntime.configuredModelCount === 1 ? "" : "s"} across ${piRuntime.providers.length} provider${piRuntime.providers.length === 1 ? "" : "s"}.`
    : "Loading Pi model catalog.";
  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Theme"
          description="Choose how DGCode looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Archive confirmation"
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />

        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Pi Runtime"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ProviderLastChecked lastCheckedAt={piRuntimeCheckedAt} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingPiRuntime}
                    onClick={() => refreshPiRuntime()}
                    aria-label="Refresh Pi runtime status"
                  >
                    {isRefreshingPiRuntime ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">Refresh Pi runtime status</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <SettingsRow
          title="Catalog"
          description="DGCode now reads its model catalog from the Pi runtime instead of the legacy T3 provider bridge."
          status={
            piRuntime?.loadError
              ? `Runtime warning: ${piRuntime.loadError}`
              : "Pi runtime loaded successfully."
          }
          control={
            <div className="rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-[11px] font-medium text-foreground">
              {piModelCountSummary}
            </div>
          }
        />

        <SettingsRow
          title="Pi auth file"
          description="Pi stores subscription and API credentials here. DGCode points Pi at this app-owned auth file instead of the default home-directory location."
          status={piAuthFilePath ?? "Pi auth path unavailable until the runtime finishes loading."}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!piAuthFilePath || isOpeningPiAuthFile}
              onClick={() => openPiAuthFile()}
            >
              {isOpeningPiAuthFile ? "Opening..." : "Open file"}
            </Button>
          }
        >
          {openPiAuthFileError ? (
            <p className="mt-3 text-xs text-destructive">{openPiAuthFileError}</p>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Connections">
        <ConnectionCard
          title="Codex subscription"
          summary={codexSummary}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!isElectron || isLaunchingAuthFlow.codex}
                onClick={() => void launchAuthFlow("codex")}
              >
                {isLaunchingAuthFlow.codex ? "Opening..." : "Open login"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isRefreshingPiRuntime}
                onClick={() => refreshPiRuntime()}
              >
                Reload models
              </Button>
            </>
          }
        >
          <p className="text-xs text-muted-foreground">
            Pi&apos;s provider docs use interactive <code>/login</code> for subscription providers.
            DGCode opens Pi in the same auth directory used by the app, then you can finish the
            ChatGPT Plus or Pro login for <code>openai-codex</code>.
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="Kiro helper"
          summary={kiroSummary}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!isElectron || isLaunchingAuthFlow.kiro}
                onClick={() => void launchAuthFlow("kiro")}
              >
                {isLaunchingAuthFlow.kiro ? "Opening..." : "Open login"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isRefreshingProviderStatus}
                onClick={() => refreshServerProviders()}
              >
                {isRefreshingProviderStatus ? "Reloading..." : "Reload status"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-xs font-medium text-foreground">Run Kiro through WSL</div>
                <p className="text-xs text-muted-foreground">
                  Keep this on when your Kiro account only works through the Linux-side CLI.
                </p>
              </div>
              <Switch
                checked={
                  settings.providers.kiro.executionMode === "auto" ||
                  settings.providers.kiro.executionMode === "wsl"
                }
                onCheckedChange={(checked) =>
                  updateSettings({
                    providers: {
                      ...settings.providers,
                      kiro: {
                        ...settings.providers.kiro,
                        executionMode: checked ? "wsl" : "host",
                      },
                    },
                  })
                }
                aria-label="Run Kiro through WSL"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="kiro-identity-provider-url" className="block">
                <span className="text-xs font-medium text-foreground">IAM Identity Center URL</span>
                <Input
                  id="kiro-identity-provider-url"
                  className="mt-1.5"
                  value={settings.providers.kiro.identityProviderUrl}
                  onChange={(event) =>
                    updateSettings({
                      providers: {
                        ...settings.providers,
                        kiro: {
                          ...settings.providers.kiro,
                          identityProviderUrl: event.target.value,
                        },
                      },
                    })
                  }
                  placeholder="https://example.awsapps.com/start"
                  spellCheck={false}
                />
              </label>

              <label htmlFor="kiro-identity-center-region" className="block">
                <span className="text-xs font-medium text-foreground">Region</span>
                <Input
                  id="kiro-identity-center-region"
                  className="mt-1.5"
                  value={settings.providers.kiro.identityCenterRegion}
                  onChange={(event) =>
                    updateSettings({
                      providers: {
                        ...settings.providers,
                        kiro: {
                          ...settings.providers.kiro,
                          identityCenterRegion: event.target.value,
                        },
                      },
                    })
                  }
                  placeholder="us-east-1"
                  spellCheck={false}
                />
              </label>
            </div>

            {settings.providers.kiro.executionMode === "auto" ||
            settings.providers.kiro.executionMode === "wsl" ? (
              <label htmlFor="kiro-wsl-distro" className="block">
                <span className="text-xs font-medium text-foreground">WSL distro</span>
                <Input
                  id="kiro-wsl-distro"
                  className="mt-1.5"
                  value={settings.providers.kiro.wslDistro}
                  onChange={(event) =>
                    updateSettings({
                      providers: {
                        ...settings.providers,
                        kiro: {
                          ...settings.providers.kiro,
                          wslDistro: event.target.value,
                        },
                      },
                    })
                  }
                  placeholder="Default distro"
                  spellCheck={false}
                />
              </label>
            ) : null}

            <div className="rounded-lg border border-border/70 bg-muted/18 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Login command
              </div>
              <code className="mt-1 block break-all text-xs text-foreground">
                {kiroLoginCommand}
              </code>
              <p className="mt-1 text-xs text-muted-foreground">
                {kiroHasIdentityCenterSettings
                  ? "DGCode will prefill IAM Identity Center login, including WSL if enabled."
                  : "Add both IAM Identity Center fields to prefill enterprise login, or leave them blank for the generic Kiro Pro flow."}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Kiro runs through DGCode&apos;s CLI orchestration path rather than Pi&apos;s live
              model catalog. Authenticate here, reload status, then pick <code>Kiro</code> in the
              composer model menu.
            </p>
          </div>
        </ConnectionCard>
      </SettingsSection>

      <SettingsSection title="Quality Guardrails">
        <SettingsRow
          title="Agent file-change gate"
          description="Run project checks and maintainability thresholds after agent file changes."
          resetAction={
            isQualityGateDirty ? (
              <SettingResetButton
                label="quality guardrails"
                onClick={() =>
                  updateSettings({
                    qualityGate: DEFAULT_UNIFIED_SETTINGS.qualityGate,
                  })
                }
              />
            ) : null
          }
          status={
            qualityGate.enabled
              ? "Failures are reported back into the next agent turn before unrelated work."
              : "Disabled. Agent file changes will not be checked automatically."
          }
          control={
            <Switch
              checked={qualityGate.enabled}
              onCheckedChange={(checked) => updateQualityGate({ enabled: Boolean(checked) })}
            />
          }
        />
        <SettingsRow
          title="Commit / push proof"
          description="Require commit-like actions to capture why the change exists and which functional commands proved it before commit or push."
        >
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["requireIntent", "Intent", "Require a clear why for commit-related actions."],
                [
                  "requireFunctionalValidation",
                  "Functional validation",
                  "Require runnable commands that prove the intended behavior.",
                ],
              ] as const
            ).map(([key, label, description]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{description}</span>
                </span>
                <Switch
                  checked={qualityGate[key]}
                  onCheckedChange={(checked) => updateQualityGate({ [key]: Boolean(checked) })}
                />
              </label>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Project checks"
          description="Use non-mutating repository commands to catch formatting, lint, and type errors."
        >
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["format", "Format", "bun run fmt:check"],
                ["lint", "Lint", "bun run lint"],
                ["typecheck", "Typecheck", "bun run typecheck"],
              ] as const
            ).map(([key, label, command]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{label}</span>
                  <code className="block truncate text-[11px] text-muted-foreground">
                    {command}
                  </code>
                </span>
                <Switch
                  checked={qualityGate[key]}
                  onCheckedChange={(checked) => updateQualityGate({ [key]: Boolean(checked) })}
                />
              </label>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Maintainability thresholds"
          description="Blank values disable that threshold. Metrics apply to changed JS/TS files."
        >
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["maxFileLines", "File lines"],
                ["maxFunctionLines", "Function lines"],
                ["maxCyclomaticComplexity", "Cyclomatic complexity"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <Input
                  type="number"
                  min={1}
                  value={thresholdInputValue(qualityGate[key])}
                  placeholder="Disabled"
                  onChange={(event) =>
                    updateQualityGate({ [key]: parseThresholdInput(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          title="Keybindings"
          description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openKeybindingsError ? (
                <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
              ) : (
                <span className="mt-1 block">Opens in your preferred editor.</span>
              )}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!keybindingsConfigPath || isOpeningKeybindings}
              onClick={openKeybindingsFile}
            >
              {isOpeningKeybindings ? "Opening..." : "Open file"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        {isElectron ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description="Current version of the application."
          />
        )}
        <SettingsRow
          title="Diagnostics"
          description={diagnosticsDescription}
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openDiagnosticsError ? (
                <span className="mt-1 block text-destructive">{openDiagnosticsError}</span>
              ) : null}
            </>
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!logsDirectoryPath || isOpeningLogsDirectory}
              onClick={openLogsDirectory}
            >
              {isOpeningLogsDirectory ? "Opening..." : "Open logs folder"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useStore(selectProjectsAcrossEnvironments);
  const threads = useStore(selectThreadsAcrossEnvironments);
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const archivedGroups = useMemo(() => {
    return projects
      .map((project) => ({
        project,
        threads: threads
          .filter((thread) => thread.projectId === project.id && thread.archivedAt !== null)
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [projects, threads]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadRef);
      }
    },
    [confirmAndDeleteThread, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <ArchiveIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived threads</EmptyTitle>
              <EmptyDescription>Archived threads will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(
                    scopeThreadRef(thread.environmentId, thread.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                  onClick={() =>
                    void unarchiveThread(scopeThreadRef(thread.environmentId, thread.id)).catch(
                      (error) => {
                        toastManager.add({
                          type: "error",
                          title: "Failed to unarchive thread",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        });
                      },
                    )
                  }
                >
                  <ArchiveX className="size-3.5" />
                  <span>Unarchive</span>
                </Button>
              </div>
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
