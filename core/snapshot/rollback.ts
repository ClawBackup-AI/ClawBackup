import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  SnapshotEvent,
  RollbackOptions,
  RollbackResult,
  FileOperationType,
} from "../../types.js";
import type { PluginLogger } from "openclaw/plugin-sdk";
import {
  loadSnapshots,
  readSnapshotContent,
} from "./storage.js";
import {
  readAllEvents,
  readEventsBySession,
  getAllFilesAtTime,
  getLatestEventForFile,
} from "./events.js";

export interface RollbackPlan {
  operations: Array<{
    filePath: string;
    action: "restore" | "delete" | "skip";
    snapshotId: string | null;
    reason: string;
    event?: SnapshotEvent;
  }>;
  totalFiles: number;
  restoreCount: number;
  deleteCount: number;
  skipCount: number;
}

export interface RollbackPreview {
  summary: {
    totalFiles: number;
    restoreCount: number;
    deleteCount: number;
    skipCount: number;
    totalBytesAffected: number;
    warnings: string[];
  };
  operations: Array<{
    filePath: string;
    action: "restore" | "delete" | "skip";
    reason: string;
    currentExists: boolean;
    currentSize?: number;
    snapshotSize?: number;
    sizeChange?: number;
    snapshotTimestamp?: string;
    snapshotId?: string;
    warning?: string;
    diff?: {
      addedLines?: number;
      removedLines?: number;
      isTextFile: boolean;
    };
  }>;
  risks: Array<{
    level: "low" | "medium" | "high";
    description: string;
    affectedFiles: string[];
  }>;
}

export async function previewRollback(
  stateDir: string,
  options: RollbackOptions
): Promise<RollbackPreview> {
  const plan = await buildRollbackPlan(stateDir, options);
  const snapshots = await loadSnapshots(stateDir);
  const operations: RollbackPreview["operations"] = [];
  const warnings: string[] = [];
  const risks: RollbackPreview["risks"] = [];
  let totalBytesAffected = 0;
  
  for (const op of plan.operations) {
    const preview: RollbackPreview["operations"][number] = {
      filePath: op.filePath,
      action: op.action,
      reason: op.reason,
      currentExists: false,
    };
    
    try {
      const currentStats = await fs.stat(op.filePath);
      preview.currentExists = true;
      preview.currentSize = currentStats.size;
    } catch {
      preview.currentExists = false;
    }
    
    if (op.snapshotId) {
      const record = snapshots.get(op.snapshotId);
      if (record) {
        preview.snapshotSize = record.size;
        preview.snapshotTimestamp = record.created_at;
        preview.snapshotId = op.snapshotId;
        
        if (preview.currentExists && preview.currentSize !== undefined) {
          preview.sizeChange = record.size - preview.currentSize;
        } else if (!preview.currentExists) {
          preview.sizeChange = record.size;
        }
        
        totalBytesAffected += record.size;
        
        if (preview.currentExists && preview.currentSize !== undefined) {
          try {
            const diff = await computeFileDiff(
              stateDir,
              op.filePath,
              record.storage_path,
              record.compression
            );
            preview.diff = diff;
          } catch {
            // 无法计算差异，忽略
          }
        }
      }
    }
    
    if (op.action === "delete" && preview.currentExists) {
      totalBytesAffected += preview.currentSize || 0;
    }
    
    if (op.action === "delete" && preview.currentExists) {
      const ext = path.extname(op.filePath).toLowerCase();
      const importantExts = [".json", ".yaml", ".yml", ".toml", ".env", ".config"];
      if (importantExts.includes(ext)) {
        preview.warning = "Deleting a configuration file";
        warnings.push(`Configuration file will be deleted: ${op.filePath}`);
      }
    }
    
    if (op.action === "restore" && !op.snapshotId) {
      preview.warning = "No snapshot available for restore";
      warnings.push(`Cannot restore ${op.filePath}: no snapshot found`);
    }
    
    operations.push(preview);
  }
  
  const deleteOps = operations.filter((o) => o.action === "delete" && o.currentExists);
  if (deleteOps.length > 5) {
    risks.push({
      level: "medium",
      description: `Large number of files (${deleteOps.length}) will be deleted`,
      affectedFiles: deleteOps.map((o) => o.filePath).slice(0, 5),
    });
  }
  
  const restoreOps = operations.filter((o) => o.action === "restore");
  const largeRestores = restoreOps.filter((o) => (o.snapshotSize || 0) > 1024 * 1024);
  if (largeRestores.length > 0) {
    risks.push({
      level: "low",
      description: `${largeRestores.length} large file(s) will be restored (>1MB each)`,
      affectedFiles: largeRestores.map((o) => o.filePath),
    });
  }
  
  const skipOps = operations.filter((o) => o.action === "skip");
  if (skipOps.length > 0) {
    risks.push({
      level: "low",
      description: `${skipOps.length} file(s) cannot be rolled back`,
      affectedFiles: skipOps.map((o) => o.filePath),
    });
  }
  
  const configFiles = operations.filter((o) => {
    const ext = path.extname(o.filePath).toLowerCase();
    return [".json", ".yaml", ".yml", ".toml", ".env", ".config"].includes(ext);
  });
  if (configFiles.length > 0) {
    risks.push({
      level: "medium",
      description: `${configFiles.length} configuration file(s) will be affected`,
      affectedFiles: configFiles.map((o) => o.filePath),
    });
  }
  
  return {
    summary: {
      totalFiles: plan.totalFiles,
      restoreCount: plan.restoreCount,
      deleteCount: plan.deleteCount,
      skipCount: plan.skipCount,
      totalBytesAffected,
      warnings,
    },
    operations,
    risks,
  };
}

async function computeFileDiff(
  stateDir: string,
  currentFilePath: string,
  snapshotStoragePath: string,
  compression: "none" | "gzip"
): Promise<{ addedLines?: number; removedLines?: number; isTextFile: boolean }> {
  try {
    const currentContent = await fs.readFile(currentFilePath);
    const snapshotContent = await readSnapshotContent(stateDir, snapshotStoragePath, compression);
    
    const isTextFile = isTextContent(currentContent) && isTextContent(snapshotContent);
    
    if (!isTextFile) {
      return { isTextFile: false };
    }
    
    const currentLines = currentContent.toString("utf-8").split("\n");
    const snapshotLines = snapshotContent.toString("utf-8").split("\n");
    
    const currentSet = new Set(currentLines);
    const snapshotSet = new Set(snapshotLines);
    
    let addedLines = 0;
    let removedLines = 0;
    
    for (const line of currentSet) {
      if (!snapshotSet.has(line)) {
        addedLines++;
      }
    }
    
    for (const line of snapshotSet) {
      if (!currentSet.has(line)) {
        removedLines++;
      }
    }
    
    return {
      addedLines,
      removedLines,
      isTextFile: true,
    };
  } catch {
    return { isTextFile: false };
  }
}

function isTextContent(content: Buffer): boolean {
  for (let i = 0; i < Math.min(content.length, 8192); i++) {
    const byte = content[i];
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

export async function buildRollbackPlan(
  stateDir: string,
  options: RollbackOptions
): Promise<RollbackPlan> {
  const operations: RollbackPlan["operations"] = [];
  
  if (options.sessionId) {
    const events = await readEventsBySession(stateDir, options.sessionId);
    const fileEvents = new Map<string, SnapshotEvent>();
    
    for (const event of events) {
      if (!fileEvents.has(event.file_path)) {
        fileEvents.set(event.file_path, event);
      }
    }
    
    for (const [filePath, event] of fileEvents) {
      const op = buildRollbackOperation(filePath, event);
      operations.push(op);
    }
  } else if (options.timestamp) {
    const fileStates = await getAllFilesAtTime(stateDir, options.timestamp);
    
    for (const [filePath, state] of fileStates) {
      operations.push({
        filePath,
        action: state.operation === "CREATE" ? "delete" : "restore",
        snapshotId: state.snapshotId,
        reason: state.operation === "CREATE" ? "created_after_timestamp" : "modified_after_timestamp",
        event: state.event,
      });
    }
  } else if (options.filePaths && options.filePaths.length > 0) {
    for (const filePath of options.filePaths) {
      const latestEvent = await getLatestEventForFile(stateDir, filePath);
      
      if (latestEvent) {
        const op = buildRollbackOperation(filePath, latestEvent);
        operations.push(op);
      } else {
        operations.push({
          filePath,
          action: "skip",
          snapshotId: null,
          reason: "no_events_found",
        });
      }
    }
  }
  
  return {
    operations,
    totalFiles: operations.length,
    restoreCount: operations.filter((o) => o.action === "restore").length,
    deleteCount: operations.filter((o) => o.action === "delete").length,
    skipCount: operations.filter((o) => o.action === "skip").length,
  };
}

function buildRollbackOperation(
  filePath: string,
  event: SnapshotEvent
): RollbackPlan["operations"][number] {
  switch (event.operation_type) {
    case "CREATE":
      return {
        filePath,
        action: "delete",
        snapshotId: null,
        reason: "file_was_created",
        event,
      };
    case "UPDATE":
    case "DELETE":
      return {
        filePath,
        action: event.snapshot_id ? "restore" : "skip",
        snapshotId: event.snapshot_id,
        reason: event.snapshot_id ? "file_was_modified" : "no_snapshot_available",
        event,
      };
    case "RENAME":
      return {
        filePath,
        action: "restore",
        snapshotId: event.snapshot_id,
        reason: "file_was_renamed",
        event,
      };
    default:
      return {
        filePath,
        action: "skip",
        snapshotId: null,
        reason: "unknown_operation",
        event,
      };
  }
}

export async function executeRollback(
  stateDir: string,
  plan: RollbackPlan,
  logger?: PluginLogger
): Promise<RollbackResult> {
  const rollbackId = `rollback-${crypto.randomUUID()}`;
  const results: RollbackResult["operations"] = [];
  
  for (const op of plan.operations) {
    try {
      switch (op.action) {
        case "restore":
          await restoreFile(stateDir, op.filePath, op.snapshotId!, logger);
          results.push({
            filePath: op.filePath,
            action: "restore",
            success: true,
          });
          break;
          
        case "delete":
          await deleteFile(op.filePath, logger);
          results.push({
            filePath: op.filePath,
            action: "delete",
            success: true,
          });
          break;
          
        case "skip":
          results.push({
            filePath: op.filePath,
            action: "skip",
            success: false,
            error: op.reason,
          });
          break;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger?.error?.(`[Rollback] Failed to ${op.action} ${op.filePath}: ${errorMessage}`);
      results.push({
        filePath: op.filePath,
        action: op.action,
        success: false,
        error: errorMessage,
      });
    }
  }
  
  const success = results.every((r) => r.success || r.action === "skip");
  
  return {
    success,
    operations: results,
    rollbackId,
  };
}

async function restoreFile(
  stateDir: string,
  filePath: string,
  snapshotId: string,
  logger?: PluginLogger
): Promise<void> {
  const snapshots = await loadSnapshots(stateDir);
  const record = snapshots.get(snapshotId);
  
  if (!record) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  
  const content = await readSnapshotContent(
    stateDir,
    record.storage_path,
    record.compression
  );
  
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  
  logger?.info?.(`[Rollback] Restored: ${filePath}`);
}

async function deleteFile(filePath: string, logger?: PluginLogger): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { force: true, recursive: true });
    } else {
      await fs.rm(filePath, { force: true });
    }
    logger?.info?.(`[Rollback] Deleted: ${filePath}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      logger?.info?.(`[Rollback] File already deleted: ${filePath}`);
      return;
    }
    throw err;
  }
}

export async function rollbackToTime(
  stateDir: string,
  timestamp: string,
  options: { dryRun?: boolean; logger?: PluginLogger } = {}
): Promise<RollbackResult> {
  const plan = await buildRollbackPlan(stateDir, { timestamp });
  
  if (options.dryRun) {
    return {
      success: true,
      operations: plan.operations.map((op) => ({
        filePath: op.filePath,
        action: op.action,
        success: true,
      })),
    };
  }
  
  return executeRollback(stateDir, plan, options.logger);
}

export async function rollbackSession(
  stateDir: string,
  sessionId: string,
  options: { dryRun?: boolean; logger?: PluginLogger } = {}
): Promise<RollbackResult> {
  const plan = await buildRollbackPlan(stateDir, { sessionId });
  
  if (options.dryRun) {
    return {
      success: true,
      operations: plan.operations.map((op) => ({
        filePath: op.filePath,
        action: op.action,
        success: true,
      })),
    };
  }
  
  return executeRollback(stateDir, plan, options.logger);
}

export async function rollbackFiles(
  stateDir: string,
  filePaths: string[],
  options: { dryRun?: boolean; logger?: PluginLogger } = {}
): Promise<RollbackResult> {
  const plan = await buildRollbackPlan(stateDir, { filePaths });
  
  if (options.dryRun) {
    return {
      success: true,
      operations: plan.operations.map((op) => ({
        filePath: op.filePath,
        action: op.action,
        success: true,
      })),
    };
  }
  
  return executeRollback(stateDir, plan, options.logger);
}

export async function getFileHistory(
  stateDir: string,
  filePath: string,
  options?: { limit?: number }
): Promise<SnapshotEvent[]> {
  const events = await readAllEvents(stateDir);
  const fileEvents = events
    .filter((e) => e.file_path === filePath)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  
  if (options?.limit) {
    return fileEvents.slice(0, options.limit);
  }
  
  return fileEvents;
}

export async function getSessionHistory(
  stateDir: string,
  sessionId: string
): Promise<{
  events: SnapshotEvent[];
  filesModified: number;
  filesCreated: number;
  filesDeleted: number;
}> {
  const events = await readEventsBySession(stateDir, sessionId);
  
  const fileStats = {
    filesModified: 0,
    filesCreated: 0,
    filesDeleted: 0,
  };
  
  const seenFiles = new Set<string>();
  
  for (const event of events) {
    if (!seenFiles.has(event.file_path)) {
      seenFiles.add(event.file_path);
      switch (event.operation_type) {
        case "CREATE":
          fileStats.filesCreated++;
          break;
        case "UPDATE":
          fileStats.filesModified++;
          break;
        case "DELETE":
          fileStats.filesDeleted++;
          break;
      }
    }
  }
  
  return {
    events,
    ...fileStats,
  };
}
