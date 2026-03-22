import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { verifyBackup, type VerifyBackupOptions } from "../core/backup.js";

export interface VerifyCommandOptions {
  json?: boolean;
}

export async function verifyBackupCommand(
  id: string,
  options: VerifyCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { json } = options;
  const { config, logger, stateDir } = ctx;

  try {
    logger.info(`Verifying backup: ${id}`);

    const verifyOptions: VerifyBackupOptions = {
      backupId: id,
      stateDir,
    };

    const result = await verifyBackup(verifyOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.valid) {
        logger.info("Verification passed! Backup is complete and usable.");
      } else {
        logger.error(`Verification failed: ${result.error}`);
        process.exit(1);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to verify backup: ${errorMessage}`);
    process.exit(1);
  }
}
