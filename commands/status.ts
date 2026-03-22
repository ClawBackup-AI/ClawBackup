import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { getBackupStatus } from "../core/backup.js";
import { formatBytes } from "../utils/format.js";

export interface StatusCommandOptions {
  json?: boolean;
}

export async function statusCommand(
  options: StatusCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { json } = options;
  const { config, logger, stateDir } = ctx;

  try {
    const status = await getBackupStatus({ config, logger, stateDir });

    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log("\n=== Backup Status Overview ===\n");
      console.log(`Total backups: ${status.totalBackups}`);
      console.log(`Total size: ${formatBytes(status.totalSizeBytes)}`);
      console.log(`Last backup: ${status.lastBackupAt || "None"}`);
      console.log(`Native backups: ${status.nativeBackupsCount}`);
      console.log("\n=== Storage Backends ===\n");
      for (const backend of status.storageBackends) {
        console.log(`[${backend.id}] ${backend.name} (${backend.type})`);
        console.log(`  Backups: ${backend.backupCount}, Size: ${formatBytes(backend.usedBytes)}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get status: ${errorMessage}`);
    process.exit(1);
  }
}
