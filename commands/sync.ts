import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { syncBackup, type SyncBackupOptions } from "../core/backup.js";

export interface SyncCommandOptions {
  storage?: string;
  force?: boolean;
  json?: boolean;
}

export async function syncBackupCommand(
  id: string,
  options: SyncCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { storage, force, json } = options;
  const { config, logger, stateDir } = ctx;

  try {
    logger.info(`Syncing backup to remote: ${id}`);

    const syncOptions: SyncBackupOptions = {
      backupId: id,
      storageBackend: storage,
      force,
      stateDir,
    };

    const result = await syncBackup(syncOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        logger.info("Sync completed!");
        if (result.remotePath) {
          logger.info(`  Remote path: ${result.remotePath}`);
        }
      } else {
        logger.error(`Sync failed: ${result.error}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Sync failed: ${errorMessage}`);
    process.exit(1);
  }
}
