import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { deleteBackup, type DeleteBackupOptions } from "../core/backup.js";

export interface DeleteCommandOptions {
  yes?: boolean;
  json?: boolean;
}

export async function deleteBackupCommand(
  id: string,
  options: DeleteCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { yes, json } = options;
  const { config, logger, stateDir } = ctx;

  try {
    if (!yes) {
      logger.warn(`About to delete backup: ${id}`);
      logger.warn("Use --yes flag to confirm deletion");
      return;
    }

    logger.info(`Deleting backup: ${id}`);

    const deleteOptions: DeleteBackupOptions = {
      backupId: id,
      stateDir,
    };

    const result = await deleteBackup(deleteOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      logger.info("Deleted successfully!");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to delete backup: ${errorMessage}`);
    process.exit(1);
  }
}
