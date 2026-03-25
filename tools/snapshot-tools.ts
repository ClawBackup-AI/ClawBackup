import type {
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import {
  buildRollbackPlan,
  executeRollback,
  getFileHistory,
  getSessionHistory,
  previewRollback,
} from "../core/snapshot/rollback.js";
import { getStorageStats } from "../core/snapshot/cleanup.js";
import { readAllEvents, readEventsBySession } from "../core/snapshot/events.js";
import { formatBytes } from "../utils/format.js";

let serviceStateDir: string = "";

export function setSnapshotToolsStateDir(stateDir: string): void {
  serviceStateDir = stateDir;
}

export const snapshotStatusToolFactory: OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext
) => ({
  name: "snapshot_status",
  description:
    "Get snapshot storage status including total snapshots, size, and event count. Use this to monitor storage usage.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    try {
      const stats = await getStorageStats(serviceStateDir);
      return jsonResult({
        success: true,
        status: {
          totalSnapshots: stats.totalSnapshots,
          totalSizeBytes: stats.totalSizeBytes,
          totalSize: formatBytes(stats.totalSizeBytes),
          totalEvents: stats.totalEvents,
          oldestSnapshot: stats.oldestSnapshot,
          newestSnapshot: stats.newestSnapshot,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: errorMessage });
    }
  },
});

export const snapshotListToolFactory: OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext
) => ({
  name: "snapshot_list",
  description:
    "List snapshot events. Can filter by file path, session ID, or show recent events. Use this to see what files have been modified and can be rolled back.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Filter by file path to see history of a specific file",
      },
      session_id: {
        type: "string",
        description: "Filter by session ID to see all changes in a session",
      },
      limit: {
        type: "number",
        description: "Maximum number of events to return (default: 20)",
      },
    },
  },
  execute: async (_toolCallId: string, params: Record<string, unknown>) => {
    try {
      const { file_path, session_id, limit = 20 } = params;

      if (file_path) {
        const events = await getFileHistory(serviceStateDir, file_path as string, {
          limit: limit as number,
        });
        return jsonResult({
          success: true,
          file_path,
          count: events.length,
          events: events.map((e) => ({
            event_id: e.event_id,
            timestamp: e.timestamp,
            operation: e.operation_type,
            session_id: e.session_id,
            snapshot_id: e.snapshot_id,
            file_size: e.file_size,
          })),
        });
      }

      if (session_id) {
        const history = await getSessionHistory(serviceStateDir, session_id as string);
        return jsonResult({
          success: true,
          session_id,
          stats: {
            filesCreated: history.filesCreated,
            filesModified: history.filesModified,
            filesDeleted: history.filesDeleted,
          },
          events: history.events.slice(0, limit as number).map((e) => ({
            event_id: e.event_id,
            timestamp: e.timestamp,
            operation: e.operation_type,
            file_path: e.file_path,
          })),
        });
      }

      const allEvents = await readAllEvents(serviceStateDir);
      const recentEvents = allEvents
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit as number);

      return jsonResult({
        success: true,
        count: recentEvents.length,
        events: recentEvents.map((e) => ({
          event_id: e.event_id,
          timestamp: e.timestamp,
          operation: e.operation_type,
          file_path: e.file_path,
          session_id: e.session_id,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: errorMessage });
    }
  },
});

export const snapshotRollbackToolFactory: OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext
) => ({
  name: "snapshot_rollback",
  description:
    "Rollback files to a previous state. Can rollback by session ID, timestamp, or specific file paths. Use dry_run=true to preview changes without executing. Preview shows detailed information about what will change including file sizes, diffs, and risks.",
  parameters: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "Rollback all changes made in this session",
      },
      timestamp: {
        type: "string",
        description: "Rollback to this point in time (ISO 8601 format)",
      },
      file_paths: {
        type: "array",
        items: { type: "string" },
        description: "Specific file paths to rollback",
      },
      dry_run: {
        type: "boolean",
        description: "If true, only preview the rollback without executing (default: true)",
      },
    },
  },
  execute: async (_toolCallId: string, params: Record<string, unknown>) => {
    try {
      const { session_id, timestamp, file_paths, dry_run = true } = params;

      if (!session_id && !timestamp && (!file_paths || (file_paths as string[]).length === 0)) {
        return jsonResult({
          success: false,
          error: "Must specify session_id, timestamp, or file_paths",
        });
      }

      const rollbackOptions = {
        sessionId: session_id as string | undefined,
        timestamp: timestamp as string | undefined,
        filePaths: file_paths as string[] | undefined,
      };

      const preview = await previewRollback(serviceStateDir, rollbackOptions);

      if (dry_run) {
        return jsonResult({
          success: true,
          dry_run: true,
          preview: {
            summary: {
              totalFiles: preview.summary.totalFiles,
              restoreCount: preview.summary.restoreCount,
              deleteCount: preview.summary.deleteCount,
              skipCount: preview.summary.skipCount,
              totalBytesAffected: preview.summary.totalBytesAffected,
              warnings: preview.summary.warnings,
            },
            risks: preview.risks.map((r) => ({
              level: r.level,
              description: r.description,
              affectedFileCount: r.affectedFiles.length,
              sampleFiles: r.affectedFiles.slice(0, 5),
            })),
            operations: preview.operations.map((op) => ({
              file_path: op.filePath,
              action: op.action,
              reason: op.reason,
              current_exists: op.currentExists,
              current_size: op.currentSize,
              snapshot_size: op.snapshotSize,
              size_change: op.sizeChange,
              snapshot_timestamp: op.snapshotTimestamp,
              warning: op.warning,
              diff: op.diff ? {
                added_lines: op.diff.addedLines,
                removed_lines: op.diff.removedLines,
                is_text_file: op.diff.isTextFile,
              } : undefined,
            })),
          },
        });
      }

      const plan = await buildRollbackPlan(serviceStateDir, rollbackOptions);
      const result = await executeRollback(serviceStateDir, plan);

      return jsonResult({
        success: result.success,
        rollback_id: result.rollbackId,
        operations: result.operations.map((op) => ({
          file_path: op.filePath,
          action: op.action,
          success: op.success,
          error: op.error,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: errorMessage });
    }
  },
});

export const snapshotHistoryToolFactory: OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext
) => ({
  name: "snapshot_history",
  description:
    "Get detailed history of file modifications. Shows all operations on a file with timestamps and session info.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "File path to get history for",
      },
      limit: {
        type: "number",
        description: "Maximum number of history entries (default: 50)",
      },
    },
    required: ["file_path"],
  },
  execute: async (_toolCallId: string, params: Record<string, unknown>) => {
    try {
      const { file_path, limit = 50 } = params;

      if (!file_path) {
        return jsonResult({
          success: false,
          error: "file_path is required",
        });
      }

      const events = await getFileHistory(
        serviceStateDir,
        file_path as string,
        { limit: limit as number }
      );

      return jsonResult({
        success: true,
        file_path,
        count: events.length,
        history: events.map((e) => ({
          timestamp: e.timestamp,
          operation: e.operation_type,
          session_id: e.session_id,
          snapshot_id: e.snapshot_id,
          file_size: e.file_size,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: errorMessage });
    }
  },
});
