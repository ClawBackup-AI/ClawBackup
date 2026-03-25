import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SnapshotConfig, SnapshotRecord } from "../../types.js";
import type { PluginLogger } from "openclaw/plugin-sdk";
import {
  loadSnapshots,
  saveSnapshots,
  loadSnapshotIndex,
  saveSnapshotIndex,
  deleteSnapshotContent,
  calculateTotalStorageSize,
} from "./storage.js";
import {
  readAllEvents,
  deleteEventsBySnapshotId,
} from "./events.js";

export interface CleanupResult {
  deletedSnapshots: number;
  deletedEvents: number;
  freedSpaceBytes: number;
  errors: string[];
}

export async function runCleanup(
  stateDir: string,
  config: SnapshotConfig,
  logger: PluginLogger
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedSnapshots: 0,
    deletedEvents: 0,
    freedSpaceBytes: 0,
    errors: [],
  };
  
  try {
    const currentSize = await calculateTotalStorageSize(stateDir);
    const maxSize = config.retention.maxTotalSizeMB * 1024 * 1024;
    
    if (currentSize <= maxSize) {
      logger.info?.(`[Cleanup] Storage within limits: ${formatBytes(currentSize)} / ${formatBytes(maxSize)}`);
      return result;
    }
    
    logger.info?.(
      `[Cleanup] Storage exceeds limit: ${formatBytes(currentSize)} / ${formatBytes(maxSize)}. Starting cleanup...`
    );
    
    const targetSize = maxSize * 0.9;
    const bytesToFree = currentSize - targetSize;
    
    const cleanupPlan = await buildCleanupPlan(stateDir, bytesToFree);
    
    for (const item of cleanupPlan.toDelete) {
      try {
        await deleteSnapshotWithEvents(stateDir, item.snapshot_id);
        result.deletedSnapshots++;
        result.freedSpaceBytes += item.size;
      } catch (err) {
        const errorMsg = `Failed to delete snapshot ${item.snapshot_id}: ${err}`;
        result.errors.push(errorMsg);
        logger.error?.(errorMsg);
      }
    }
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalSnapshots -= result.deletedSnapshots;
    index.stats.totalSizeBytes -= result.freedSpaceBytes;
    await saveSnapshotIndex(stateDir, index);
    
    logger.info?.(
      `[Cleanup] Completed. Freed ${formatBytes(result.freedSpaceBytes)}, deleted ${result.deletedSnapshots} snapshots`
    );
    
    return result;
  } catch (err) {
    const errorMsg = `Cleanup failed: ${err}`;
    result.errors.push(errorMsg);
    logger.error?.(errorMsg);
    return result;
  }
}

interface CleanupPlan {
  toDelete: Array<{ snapshot_id: string; size: number; created_at: string }>;
  bytesToFree: number;
}

async function buildCleanupPlan(
  stateDir: string,
  bytesToFree: number
): Promise<CleanupPlan> {
  const snapshots = await loadSnapshots(stateDir);
  const events = await readAllEvents(stateDir);
  
  const snapshotUsage = new Map<string, { count: number; lastUsed: string }>();
  
  for (const event of events) {
    if (event.snapshot_id) {
      const usage = snapshotUsage.get(event.snapshot_id);
      if (usage) {
        usage.count++;
        if (event.timestamp > usage.lastUsed) {
          usage.lastUsed = event.timestamp;
        }
      } else {
        snapshotUsage.set(event.snapshot_id, {
          count: 1,
          lastUsed: event.timestamp,
        });
      }
    }
  }
  
  const candidates: Array<{ snapshot_id: string; size: number; created_at: string; priority: number }> = [];
  
  for (const [snapshotId, record] of snapshots) {
    const usage = snapshotUsage.get(snapshotId);
    const lastUsed = usage?.lastUsed || record.created_at;
    const refCount = record.ref_count;
    
    const ageInDays = (Date.now() - new Date(record.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const priority = ageInDays * (1 / Math.max(refCount, 1));
    
    candidates.push({
      snapshot_id: snapshotId,
      size: record.size,
      created_at: lastUsed,
      priority,
    });
  }
  
  candidates.sort((a, b) => b.priority - a.priority);
  
  const toDelete: CleanupPlan["toDelete"] = [];
  let freedBytes = 0;
  
  for (const candidate of candidates) {
    if (freedBytes >= bytesToFree) {
      break;
    }
    toDelete.push({
      snapshot_id: candidate.snapshot_id,
      size: candidate.size,
      created_at: candidate.created_at,
    });
    freedBytes += candidate.size;
  }
  
  return {
    toDelete,
    bytesToFree,
  };
}

async function deleteSnapshotWithEvents(
  stateDir: string,
  snapshotId: string
): Promise<void> {
  const snapshots = await loadSnapshots(stateDir);
  const record = snapshots.get(snapshotId);
  
  if (!record) {
    return;
  }
  
  if (record.ref_count > 1) {
    record.ref_count--;
    await saveSnapshots(stateDir, snapshots);
    return;
  }
  
  await deleteSnapshotContent(stateDir, record.storage_path);
  snapshots.delete(snapshotId);
  await saveSnapshots(stateDir, snapshots);
  
  await deleteEventsBySnapshotId(stateDir, snapshotId);
}

export async function cleanupOrphanedSnapshots(
  stateDir: string,
  logger: PluginLogger
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedSnapshots: 0,
    deletedEvents: 0,
    freedSpaceBytes: 0,
    errors: [],
  };
  
  const snapshots = await loadSnapshots(stateDir);
  const events = await readAllEvents(stateDir);
  
  const referencedSnapshots = new Set<string>();
  for (const event of events) {
    if (event.snapshot_id) {
      referencedSnapshots.add(event.snapshot_id);
    }
  }
  
  for (const [snapshotId, record] of snapshots) {
    if (!referencedSnapshots.has(snapshotId)) {
      try {
        await deleteSnapshotContent(stateDir, record.storage_path);
        snapshots.delete(snapshotId);
        result.deletedSnapshots++;
        result.freedSpaceBytes += record.size;
        logger.info?.(`[Cleanup] Deleted orphaned snapshot: ${snapshotId}`);
      } catch (err) {
        const errorMsg = `Failed to delete orphaned snapshot ${snapshotId}: ${err}`;
        result.errors.push(errorMsg);
        logger.error?.(errorMsg);
      }
    }
  }
  
  if (result.deletedSnapshots > 0) {
    await saveSnapshots(stateDir, snapshots);
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalSnapshots -= result.deletedSnapshots;
    index.stats.totalSizeBytes -= result.freedSpaceBytes;
    await saveSnapshotIndex(stateDir, index);
  }
  
  return result;
}

export async function cleanupOldEvents(
  stateDir: string,
  maxAgeDays: number,
  logger: PluginLogger
): Promise<{ deletedEvents: number }> {
  const cutoffTime = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const events = await readAllEvents(stateDir);
  
  const recentEvents = events.filter((e) => e.timestamp >= cutoffTime);
  const deletedCount = events.length - recentEvents.length;
  
  if (deletedCount > 0) {
    const eventsPath = path.join(stateDir, "snapshots", "events.jsonl");
    const content = recentEvents.map((e) => JSON.stringify(e)).join("\n");
    await fs.writeFile(eventsPath, content + (content ? "\n" : ""), "utf-8");
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalEvents = recentEvents.length;
    await saveSnapshotIndex(stateDir, index);
    
    logger.info?.(`[Cleanup] Deleted ${deletedCount} old events (older than ${maxAgeDays} days)`);
  }
  
  return { deletedEvents: deletedCount };
}

export async function getStorageStats(stateDir: string): Promise<{
  totalSnapshots: number;
  totalSizeBytes: number;
  totalEvents: number;
  oldestSnapshot: string | null;
  newestSnapshot: string | null;
  sizeByExtension: Record<string, number>;
}> {
  const snapshots = await loadSnapshots(stateDir);
  const index = await loadSnapshotIndex(stateDir);
  
  let oldestSnapshot: string | null = null;
  let newestSnapshot: string | null = null;
  const sizeByExtension: Record<string, number> = {};
  
  for (const record of snapshots.values()) {
    if (!oldestSnapshot || record.created_at < oldestSnapshot) {
      oldestSnapshot = record.created_at;
    }
    if (!newestSnapshot || record.created_at > newestSnapshot) {
      newestSnapshot = record.created_at;
    }
  }
  
  return {
    totalSnapshots: snapshots.size,
    totalSizeBytes: index.stats.totalSizeBytes,
    totalEvents: index.stats.totalEvents,
    oldestSnapshot,
    newestSnapshot,
    sizeByExtension,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  
  return `${size.toFixed(2)} ${units[i]}`;
}
