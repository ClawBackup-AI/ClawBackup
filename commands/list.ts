import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { listBackups, type ListBackupsOptions } from "../core/backup.js";
import { formatBytes } from "../utils/format.js";

export interface ListCommandOptions {
  type?: string;
  limit?: number;
  json?: boolean;
}

export async function listBackupsCommand(
  options: ListCommandOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { type, limit, json } = options;
  const { config, logger, stateDir } = ctx;

  const validTypes = ["all", "native", "clawbackup"] as const;
  type ValidType = typeof validTypes[number];
  
  let filterType: ValidType = "all";
  if (type !== undefined) {
    if (!validTypes.includes(type as ValidType)) {
      console.error(`Error: Invalid --type value "${type}", valid values are: ${validTypes.join(", ")}`);
      process.exit(1);
    }
    filterType = type as ValidType;
  }

  try {
    const listOptions: ListBackupsOptions = {
      type: filterType,
      limit,
      stateDir,
    };

    const backups = await listBackups(listOptions, { config, logger });

    if (json) {
      console.log(JSON.stringify(backups, null, 2));
      return;
    }

    if (backups.length === 0) {
      console.log("No backups found");
      return;
    }

    console.log("\nBackup list:\n");
    console.log("Type         ID                                  Name                    Size        Created");
    console.log("-".repeat(100));

    for (const backup of backups) {
      const typeLabel = backup.type === "native" ? "native" : "clawbackup";
      const size = formatBytes(backup.sizeBytes);
      const createdAt = new Date(backup.createdAt).toLocaleString();
      console.log(
        `${typeLabel.padEnd(12)} ${backup.id.padEnd(36)} ${(backup.name || "").slice(0, 24).padEnd(24)} ${size.padEnd(12)} ${createdAt}`,
      );
    }

    console.log(`\nTotal ${backups.length} backups`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to list backups: ${errorMessage}`);
    process.exit(1);
  }
}
