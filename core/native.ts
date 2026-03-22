import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { BackupEntry } from "../types.js";

const NATIVE_BACKUP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.\d{3}Z-openclaw-backup\.tar\.gz$/;

export async function discoverNativeBackups(backupDir: string): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];

  try {
    await fs.mkdir(backupDir, { recursive: true });
    const files = await fs.readdir(backupDir);

    for (const file of files) {
      const match = file.match(NATIVE_BACKUP_PATTERN);
      if (!match) {
        continue;
      }

      const filePath = path.join(backupDir, file);
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        continue;
      }

      const timestampStr = match[1];
      const createdAt = parseNativeBackupTimestamp(timestampStr);

      entries.push({
        id: file.replace(".tar.gz", ""),
        type: "native",
        name: file.replace(".tar.gz", ""),
        createdAt,
        sizeBytes: stat.size,
        encrypted: false,
        storageBackend: "local",
        storagePath: filePath,
      });
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return entries;
}

function parseNativeBackupTimestamp(timestampStr: string): string {
  // Input format: "2026-01-15T14-30-00" (colons replaced with hyphens)
  // Output format: "2026-01-15T14:30:00.000Z" (ISO 8601)
  const parts = timestampStr.split("T");
  if (parts.length !== 2) {
    return new Date().toISOString();
  }
  
  const datePart = parts[0]; // "2026-01-15"
  const timePart = parts[1]; // "14-30-00"
  
  // Replace hyphens with colons in time part
  const normalizedTime = timePart.replace(/-/g, ":"); // "14:30:00"
  
  return `${datePart}T${normalizedTime}.000Z`;
}
