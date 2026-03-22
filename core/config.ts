import type { OpenClawConfig } from "openclaw/plugin-sdk";

export interface PluginConfig {
  initialized?: boolean;
  defaultStorage?: string;
  encryption?: {
    enabled?: boolean;
    algorithm?: string;
  };
  autoBackup?: {
    enabled?: boolean;
    schedule?: string;
  };
}

export function getPluginConfig(config: OpenClawConfig): PluginConfig {
  const pluginConfig = config.plugins?.entries?.clawbackup?.config as PluginConfig | undefined;
  return pluginConfig || {
    initialized: false,
    defaultStorage: "local",
    encryption: {
      enabled: false,
    },
    autoBackup: {
      enabled: false,
    },
  };
}

export function updatePluginConfig(
  config: OpenClawConfig,
  newConfig: Partial<PluginConfig>,
): void {
  if (!config.plugins) {
    config.plugins = { entries: {} };
  }
  if (!config.plugins.entries) {
    config.plugins.entries = {};
  }
  const existing = config.plugins.entries.clawbackup || {};
  config.plugins.entries.clawbackup = {
    ...existing,
    config: {
      ...(existing.config as PluginConfig),
      ...newConfig,
    },
  };
}
