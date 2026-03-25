import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import {
  buildRollbackPlan,
  executeRollback,
  getFileHistory,
  getSessionHistory,
  rollbackFiles,
  rollbackSession,
  rollbackToTime,
  previewRollback,
} from "../core/snapshot/rollback.js";
import {
  getStorageStats,
  runCleanup,
  cleanupOrphanedSnapshots,
  cleanupOldEvents,
} from "../core/snapshot/cleanup.js";
import { readAllEvents, readEventsBySession } from "../core/snapshot/events.js";
import { getSnapshotStats } from "../core/snapshot/storage.js";
import { getDefaultSnapshotConfig, mergeSnapshotConfig } from "../core/snapshot/manager.js";
import { formatBytes } from "../utils/format.js";

interface SnapshotCommandContext {
  config: OpenClawConfig;
  logger: PluginLogger;
  stateDir: string;
}

export async function snapshotStatusCommand(
  options: { json?: boolean },
  ctx: SnapshotCommandContext
): Promise<void> {
  const stats = await getStorageStats(ctx.stateDir);
  
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  
  console.log("\n📊 Snapshot Storage Status\n");
  console.log("─".repeat(40));
  console.log(`Total Snapshots: ${stats.totalSnapshots}`);
  console.log(`Total Size: ${formatBytes(stats.totalSizeBytes)}`);
  console.log(`Total Events: ${stats.totalEvents}`);
  
  if (stats.oldestSnapshot) {
    console.log(`Oldest Snapshot: ${stats.oldestSnapshot}`);
  }
  if (stats.newestSnapshot) {
    console.log(`Newest Snapshot: ${stats.newestSnapshot}`);
  }
  console.log();
}

export async function snapshotListCommand(
  options: {
    file?: string;
    session?: string;
    limit?: number;
    json?: boolean;
  },
  ctx: SnapshotCommandContext
): Promise<void> {
  if (options.file) {
    const events = await getFileHistory(ctx.stateDir, options.file, { limit: options.limit || 20 });
    
    if (options.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }
    
    console.log(`\n📁 History for: ${options.file}\n`);
    console.log("─".repeat(80));
    
    if (events.length === 0) {
      console.log("No events found for this file.");
      return;
    }
    
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleString();
      const op = event.operation_type.padEnd(8);
      const snapshot = event.snapshot_id ? ` [${event.snapshot_id.slice(0, 12)}...]` : "";
      console.log(`${time} | ${op} | ${event.session_id.slice(0, 12)}...${snapshot}`);
    }
    console.log();
    return;
  }
  
  if (options.session) {
    const history = await getSessionHistory(ctx.stateDir, options.session);
    
    if (options.json) {
      console.log(JSON.stringify(history, null, 2));
      return;
    }
    
    console.log(`\n📝 Session: ${options.session}\n`);
    console.log("─".repeat(60));
    console.log(`Files Created:  ${history.filesCreated}`);
    console.log(`Files Modified: ${history.filesModified}`);
    console.log(`Files Deleted:  ${history.filesDeleted}`);
    console.log(`Total Events:   ${history.events.length}`);
    console.log();
    return;
  }
  
  const events = await readAllEvents(ctx.stateDir);
  const limit = options.limit || 50;
  const recentEvents = events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
  
  if (options.json) {
    console.log(JSON.stringify(recentEvents, null, 2));
    return;
  }
  
  console.log(`\n📋 Recent Events (last ${limit})\n`);
  console.log("─".repeat(100));
  
  if (recentEvents.length === 0) {
    console.log("No events found.");
    return;
  }
  
  for (const event of recentEvents) {
    const time = new Date(event.timestamp).toLocaleString();
    const op = event.operation_type.padEnd(8);
    const file = event.file_path.length > 50 
      ? "..." + event.file_path.slice(-47) 
      : event.file_path;
    console.log(`${time} | ${op} | ${file}`);
  }
  console.log();
}

export async function snapshotRollbackCommand(
  options: {
    session?: string;
    time?: string;
    file?: string;
    dryRun?: boolean;
    json?: boolean;
    yes?: boolean;
    preview?: boolean;
  },
  ctx: SnapshotCommandContext
): Promise<void> {
  if (!options.session && !options.time && !options.file) {
    console.error("Error: Please specify --session, --time, or --file");
    process.exit(1);
  }
  
  const rollbackOptions = {
    sessionId: options.session,
    timestamp: options.time,
    filePaths: options.file ? [options.file] : undefined,
  };
  
  const previewResult = await previewRollback(ctx.stateDir, rollbackOptions);
  
  if (options.json) {
    console.log(JSON.stringify(previewResult, null, 2));
    return;
  }
  
  console.log("\n🔍 Rollback Preview\n");
  console.log("═".repeat(70));
  
  console.log("\n📊 Summary:");
  console.log("─".repeat(50));
  console.log(`  Total Files Affected: ${previewResult.summary.totalFiles}`);
  console.log(`  Files to Restore:     ${previewResult.summary.restoreCount}`);
  console.log(`  Files to Delete:      ${previewResult.summary.deleteCount}`);
  console.log(`  Files to Skip:        ${previewResult.summary.skipCount}`);
  console.log(`  Total Bytes Affected: ${formatBytes(previewResult.summary.totalBytesAffected)}`);
  
  if (previewResult.summary.warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    for (const warning of previewResult.summary.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  
  if (previewResult.risks.length > 0) {
    console.log("\n⚡ Risk Assessment:");
    for (const risk of previewResult.risks) {
      const levelIcon = risk.level === "high" ? "🔴" : risk.level === "medium" ? "🟡" : "🟢";
      console.log(`  ${levelIcon} [${risk.level.toUpperCase()}] ${risk.description}`);
      if (risk.affectedFiles.length <= 3) {
        for (const file of risk.affectedFiles) {
          console.log(`      - ${file}`);
        }
      } else {
        console.log(`      - ${risk.affectedFiles.slice(0, 3).join(", ")} and ${risk.affectedFiles.length - 3} more`);
      }
    }
  }
  
  console.log("\n📝 Detailed Operations:");
  console.log("─".repeat(70));
  
  const maxDisplay = 20;
  const displayOps = previewResult.operations.slice(0, maxDisplay);
  
  for (const op of displayOps) {
    const actionIcon = op.action === "restore" ? "📥" : op.action === "delete" ? "🗑️" : "⏭️";
    const actionText = op.action.toUpperCase().padEnd(8);
    
    console.log(`\n  ${actionIcon} ${actionText} ${op.filePath}`);
    console.log(`     Reason: ${op.reason}`);
    
    if (op.currentExists) {
      console.log(`     Current: ${formatBytes(op.currentSize || 0)} (exists)`);
    } else {
      console.log(`     Current: (does not exist)`);
    }
    
    if (op.snapshotSize !== undefined) {
      console.log(`     Snapshot: ${formatBytes(op.snapshotSize)} from ${op.snapshotTimestamp || "unknown"}`);
    }
    
    if (op.sizeChange !== undefined) {
      const changeSign = op.sizeChange >= 0 ? "+" : "";
      console.log(`     Size Change: ${changeSign}${formatBytes(op.sizeChange)}`);
    }
    
    if (op.diff && op.diff.isTextFile) {
      const added = op.diff.addedLines || 0;
      const removed = op.diff.removedLines || 0;
      console.log(`     Diff: +${added} lines, -${removed} lines`);
    }
    
    if (op.warning) {
      console.log(`     ⚠️  ${op.warning}`);
    }
  }
  
  if (previewResult.operations.length > maxDisplay) {
    console.log(`\n  ... and ${previewResult.operations.length - maxDisplay} more operations`);
  }
  
  console.log();
  
  if (options.dryRun || options.preview) {
    console.log("─".repeat(70));
    console.log("📋 This is a preview. No changes have been made.");
    console.log("   Run without --dry-run to execute the rollback.");
    return;
  }
  
  if (!options.yes) {
    console.log("═".repeat(70));
    console.log("Proceed with rollback? [y/N]");
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });
    
    if (answer !== "y" && answer !== "yes") {
      console.log("Rollback cancelled.");
      return;
    }
  }
  
  const plan = await buildRollbackPlan(ctx.stateDir, rollbackOptions);
  const result = await executeRollback(ctx.stateDir, plan, ctx.logger);
  
  console.log("\n✅ Rollback Result\n");
  console.log("─".repeat(40));
  console.log(`Success: ${result.success}`);
  console.log(`Rollback ID: ${result.rollbackId}`);
  
  const succeeded = result.operations.filter((o) => o.success).length;
  const failed = result.operations.filter((o) => !o.success).length;
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log("\nFailed operations:");
    for (const op of result.operations.filter((o) => !o.success)) {
      console.log(`  ${op.filePath}: ${op.error}`);
    }
  }
  console.log();
}

export async function snapshotCleanupCommand(
  options: {
    orphaned?: boolean;
    oldEvents?: number;
    json?: boolean;
  },
  ctx: SnapshotCommandContext
): Promise<void> {
  const config = getDefaultSnapshotConfig();
  let result = {
    deletedSnapshots: 0,
    deletedEvents: 0,
    freedSpaceBytes: 0,
    errors: [] as string[],
  };
  
  if (options.orphaned) {
    console.log("Cleaning orphaned snapshots...");
    const orphanedResult = await cleanupOrphanedSnapshots(ctx.stateDir, ctx.logger);
    result.deletedSnapshots += orphanedResult.deletedSnapshots;
    result.freedSpaceBytes += orphanedResult.freedSpaceBytes;
    result.errors.push(...orphanedResult.errors);
  }
  
  if (options.oldEvents) {
    console.log(`Cleaning events older than ${options.oldEvents} days...`);
    const eventsResult = await cleanupOldEvents(ctx.stateDir, options.oldEvents, ctx.logger);
    result.deletedEvents += eventsResult.deletedEvents;
  }
  
  if (!options.orphaned && !options.oldEvents) {
    console.log("Running standard cleanup...");
    result = await runCleanup(ctx.stateDir, config, ctx.logger);
  }
  
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  
  console.log("\n🧹 Cleanup Result\n");
  console.log("─".repeat(40));
  console.log(`Deleted Snapshots: ${result.deletedSnapshots}`);
  console.log(`Deleted Events: ${result.deletedEvents}`);
  console.log(`Freed Space: ${formatBytes(result.freedSpaceBytes)}`);
  
  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
  console.log();
}
