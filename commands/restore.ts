import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { restoreBackup, type RestoreBackupOptions } from "../core/backup.js";

export interface RestoreCommandOptions {
  target?: string;
  password?: string;
  snapshot?: boolean;
  fromRemote?: string;
  json?: boolean;
}

export async function restoreBackupCommand(
  id: string,
  options: RestoreCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { target, password, snapshot, fromRemote, json } = options;
  const { config, logger, stateDir } = ctx;

  try {
    logger.info(`Restoring backup: ${id}`);

    const restoreOptions: RestoreBackupOptions = {
      backupId: id,
      targetPath: target,
      password,
      createSnapshot: !!snapshot,
      fromRemote,
      stateDir,
    };

    const result = await restoreBackup(restoreOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      logger.info("Restore completed!");
      logger.info(`  Restore path: ${result.targetPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to restore backup: ${errorMessage}`);
    process.exit(1);
  }
}
