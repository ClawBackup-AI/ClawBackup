import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { createBackup, type CreateBackupOptions } from "../core/backup.js";
import { formatBytes } from "../utils/format.js";

export interface CreateCommandOptions {
  name?: string;
  password?: string;
  storage?: string;
  output?: string;
  includeWorkspace?: boolean;
  onlyConfig?: boolean;
  workspace?: string[];
  json?: boolean;
  dryRun?: boolean;
}

export async function createBackupCommand(
  options: CreateCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { 
    name, 
    password, 
    storage, 
    output,
    includeWorkspace = true,
    onlyConfig = false,
    workspace = [],
    json,
    dryRun = false,
  } = options;
  const { config, logger, stateDir } = ctx;

  try {
    if (dryRun) {
      logger.info("Dry run mode, analyzing backup content...");
    } else {
      logger.info("Creating backup...");
    }

    const backupOptions: CreateBackupOptions = {
      name,
      password,
      storageBackend: storage,
      stateDir,
      outputPath: output,
      includeWorkspace,
      onlyConfig,
      workspaceDirs: workspace,
      dryRun,
    };

    const result = await createBackup(backupOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (dryRun) {
        logger.info("Dry run completed, content to be backed up:");
      } else {
        logger.info("Backup created successfully!");
      }
      logger.info(`  ID: ${result.id}`);
      logger.info(`  Name: ${result.name}`);
      logger.info(`  Size: ${formatBytes(result.sizeBytes)}`);
      logger.info(`  Encrypted: ${result.encrypted ? "Yes" : "No"}`);
      if (result.dryRun) {
        logger.info(`  Files to backup: ${result.assets.length}`);
        logger.info(`  Skipped items: ${result.skipped.length}`);
      } else {
        logger.info(`  Storage location: ${result.outputPath}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create backup: ${errorMessage}`);
    process.exit(1);
  }
}
