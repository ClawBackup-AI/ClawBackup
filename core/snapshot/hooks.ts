import type {
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
  PluginHookSessionContext,
  PluginLogger,
} from "openclaw/plugin-sdk";
import type { SnapshotConfig, DetectedFileOperation } from "../../types.js";
import {
  detectFileOperations,
  isFileModificationTool,
} from "./detector.js";
import {
  createSnapshot,
  initSessionTracker,
  clearSessionTracker,
  mergeSnapshotConfig,
  getDefaultSnapshotConfig,
  processFileOperations,
} from "./manager.js";
import { ensureSnapshotDirs } from "./storage.js";
import { runCleanup } from "./cleanup.js";

export interface SnapshotHookContext {
  stateDir: string;
  config: SnapshotConfig;
  logger: PluginLogger;
}

let hookContext: SnapshotHookContext | null = null;

export function initSnapshotHooks(
  stateDir: string,
  userConfig: Partial<SnapshotConfig> | undefined,
  logger: PluginLogger
): void {
  hookContext = {
    stateDir,
    config: mergeSnapshotConfig(userConfig),
    logger,
  };
  
  ensureSnapshotDirs(stateDir).catch((err) => {
    logger.error?.(`Failed to initialize snapshot directories: ${err}`);
  });
  
  if (hookContext.config.retention.cleanupTriggers.onStartup) {
    runCleanup(stateDir, hookContext.config, logger).catch((err) => {
      logger.error?.(`Snapshot cleanup failed on startup: ${err}`);
    });
  }
}

export function updateSnapshotConfig(userConfig: Partial<SnapshotConfig> | undefined): void {
  if (hookContext) {
    hookContext.config = mergeSnapshotConfig(userConfig);
  }
}

export function getSnapshotHookContext(): SnapshotHookContext | null {
  return hookContext;
}

export async function handleBeforeToolCall(
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext
): Promise<PluginHookBeforeToolCallResult | void> {
  if (!hookContext || !hookContext.config.enabled) {
    return;
  }
  
  const { toolName, params } = event;
  const { sessionId, workspaceDir } = ctx;
  
  if (!sessionId) {
    return;
  }
  
  if (!isFileModificationTool(toolName)) {
    return;
  }
  
  try {
    const operations = await detectFileOperations({
      toolName,
      params: params as Record<string, unknown>,
      workspaceDir,
    });
    
    if (operations.length === 0) {
      return;
    }
    
    const filteredOperations = await filterOperationsBySession(
      operations,
      sessionId,
      hookContext.stateDir
    );
    
    if (filteredOperations.length === 0) {
      return;
    }
    
    await processFileOperations(
      hookContext.stateDir,
      filteredOperations,
      sessionId,
      toolName,
      event.toolCallId,
      hookContext.config
    );
    
    hookContext.logger.info?.(
      `[Snapshot] Created ${filteredOperations.length} snapshot(s) for tool: ${toolName}`
    );
  } catch (err) {
    hookContext.logger.error?.(
      `[Snapshot] Failed to create snapshot for tool ${toolName}: ${err}`
    );
  }
  
  return;
}

async function filterOperationsBySession(
  operations: DetectedFileOperation[],
  sessionId: string,
  stateDir: string
): Promise<DetectedFileOperation[]> {
  const { isFileRecordedInSession } = await import("./manager.js");
  
  return operations.filter((op) => {
    return !isFileRecordedInSession(sessionId, op.filePath);
  });
}

export async function handleSessionStart(
  event: PluginHookSessionStartEvent,
  ctx: PluginHookSessionContext
): Promise<void> {
  if (!hookContext || !hookContext.config.enabled) {
    return;
  }
  
  const { sessionId } = event;
  
  if (!sessionId) {
    return;
  }
  
  initSessionTracker(sessionId);
  hookContext.logger.info?.(`[Snapshot] Session started: ${sessionId}`);
}

export async function handleSessionEnd(
  event: PluginHookSessionEndEvent,
  ctx: PluginHookSessionContext
): Promise<void> {
  if (!hookContext || !hookContext.config.enabled) {
    return;
  }
  
  const { sessionId } = event;
  
  if (!sessionId) {
    return;
  }
  
  if (hookContext.config.retention.cleanupTriggers.onSessionEnd) {
    try {
      await runCleanup(hookContext.stateDir, hookContext.config, hookContext.logger);
    } catch (err) {
      hookContext.logger.error?.(`[Snapshot] Cleanup failed on session end: ${err}`);
    }
  }
  
  clearSessionTracker(sessionId);
  hookContext.logger.info?.(`[Snapshot] Session ended: ${sessionId}`);
}

export function createSnapshotHooks() {
  return {
    beforeToolCall: handleBeforeToolCall,
    sessionStart: handleSessionStart,
    sessionEnd: handleSessionEnd,
  };
}
