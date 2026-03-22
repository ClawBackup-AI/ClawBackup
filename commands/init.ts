import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";

const CONFIG_FILE_NAME = "config.json";

async function loadConfig(stateDir: string): Promise<Record<string, unknown>> {
  const configPath = path.join(stateDir, CONFIG_FILE_NAME);
  try {
    const data = await fs.readFile(configPath, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(stateDir: string, config: Record<string, unknown>): Promise<void> {
  const configPath = path.join(stateDir, CONFIG_FILE_NAME);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export async function initCommand(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { config, logger, stateDir } = ctx;

  console.log("ClawBackup Initialization Wizard");
  console.log();

  const pluginConfig = await loadConfig(stateDir);

  if (pluginConfig.initialized) {
    console.log("ClawBackup has already been initialized.");
    console.log("Run 'clawbackup status' to view status.");
    return;
  }

  console.log("Please configure ClawBackup basic settings:");
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answers: { defaultStorage?: string; enableEncryption?: boolean } = {};

  const defaultStorage = await rl.question("Select default storage backend (local/s3) [local]: ");
  answers.defaultStorage = defaultStorage || "local";

  const enableEncryption = await rl.question("Enable encryption? (y/n) [n]: ");
  answers.enableEncryption = enableEncryption?.toLowerCase() === "y";

  rl.close();

  const newConfig = {
    ...pluginConfig,
    initialized: true,
    defaultStorage: answers.defaultStorage,
    encryption: {
      enabled: answers.enableEncryption,
    },
  };

  await saveConfig(stateDir, newConfig);

  console.log();
  console.log("Initialization completed!");
  console.log();
  console.log("Configuration summary:");
  console.log(`  Default storage: ${answers.defaultStorage}`);
  console.log(`  Encryption: ${answers.enableEncryption ? "Enabled" : "Disabled"}`);
}
