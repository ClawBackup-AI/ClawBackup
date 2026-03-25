import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  SnapshotConfig,
  SnapshotRecord,
  SnapshotEvent,
  FileOperationType,
  SessionSnapshotTracker,
  DetectedFileOperation,
} from "../../types.js";
import {
  getSnapshotsDir,
  ensureSnapshotDirs,
  loadSnapshots,
  saveSnapshots,
  loadSnapshotIndex,
  saveSnapshotIndex,
  generateSnapshotId,
  computeFileHash,
  buildStoragePath,
  writeSnapshotContent,
  findSnapshotByHash,
  deleteSnapshotContent,
} from "./storage.js";
import {
  generateEventId,
  appendEvent,
  readEventsBySession,
  getSessionFileRecords,
} from "./events.js";

const DEFAULT_CONFIG: SnapshotConfig = {
  enabled: true,
  filter: {
    maxFileSize: 100 * 1024 * 1024,
    excludeExtensions: [
      ".exe", ".dll", ".so", ".dylib",
      ".iso", ".img", ".dmg",
      ".zip", ".tar", ".gz", ".rar", ".7z",
      ".mp4", ".avi", ".mkv", ".mov",
      ".mp3", ".wav", ".flac",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx",
      ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
      ".ttf", ".otf", ".woff", ".woff2",
      ".db", ".sqlite", ".sqlite3",
    ],
    excludePatterns: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.cache/**",
    ],
  },
  retention: {
    maxTotalSizeMB: 5000,
    cleanupTriggers: {
      onSessionEnd: true,
      onStartup: true,
    },
  },
  deduplication: {
    enabled: true,
    hashAlgorithm: "sha256",
  },
};

export function getDefaultSnapshotConfig(): SnapshotConfig {
  return { ...DEFAULT_CONFIG };
}

export function mergeSnapshotConfig(userConfig?: Partial<SnapshotConfig>): SnapshotConfig {
  if (!userConfig) return { ...DEFAULT_CONFIG };
  
  return {
    enabled: userConfig.enabled ?? DEFAULT_CONFIG.enabled,
    filter: {
      maxFileSize: userConfig.filter?.maxFileSize ?? DEFAULT_CONFIG.filter.maxFileSize,
      excludeExtensions: userConfig.filter?.excludeExtensions ?? DEFAULT_CONFIG.filter.excludeExtensions,
      excludePatterns: userConfig.filter?.excludePatterns ?? DEFAULT_CONFIG.filter.excludePatterns,
    },
    retention: {
      maxTotalSizeMB: userConfig.retention?.maxTotalSizeMB ?? DEFAULT_CONFIG.retention.maxTotalSizeMB,
      cleanupTriggers: {
        onSessionEnd: userConfig.retention?.cleanupTriggers?.onSessionEnd ?? DEFAULT_CONFIG.retention.cleanupTriggers.onSessionEnd,
        onStartup: userConfig.retention?.cleanupTriggers?.onStartup ?? DEFAULT_CONFIG.retention.cleanupTriggers.onStartup,
      },
    },
    deduplication: {
      enabled: userConfig.deduplication?.enabled ?? DEFAULT_CONFIG.deduplication.enabled,
      hashAlgorithm: userConfig.deduplication?.hashAlgorithm ?? DEFAULT_CONFIG.deduplication.hashAlgorithm,
    },
  };
}

const sessionTrackers = new Map<string, SessionSnapshotTracker>();

export function getSessionTracker(sessionId: string): SessionSnapshotTracker | undefined {
  return sessionTrackers.get(sessionId);
}

export function initSessionTracker(sessionId: string): SessionSnapshotTracker {
  const tracker: SessionSnapshotTracker = {
    sessionId,
    startedAt: new Date().toISOString(),
    recordedFiles: new Set(),
  };
  sessionTrackers.set(sessionId, tracker);
  return tracker;
}

export function clearSessionTracker(sessionId: string): void {
  sessionTrackers.delete(sessionId);
}

export function isFileRecordedInSession(sessionId: string, filePath: string): boolean {
  const tracker = sessionTrackers.get(sessionId);
  return tracker?.recordedFiles.has(filePath) ?? false;
}

export function markFileRecordedInSession(sessionId: string, filePath: string): void {
  const tracker = sessionTrackers.get(sessionId);
  if (tracker) {
    tracker.recordedFiles.add(filePath);
  }
}

export async function shouldBackupFile(
  filePath: string,
  config: SnapshotConfig
): Promise<{ shouldBackup: boolean; reason: string }> {
  const ext = path.extname(filePath).toLowerCase();
  
  if (config.filter.excludeExtensions.includes(ext)) {
    return { shouldBackup: false, reason: "excluded_extension" };
  }
  
  for (const pattern of config.filter.excludePatterns) {
    if (matchGlobPattern(filePath, pattern)) {
      return { shouldBackup: false, reason: "excluded_pattern" };
    }
  }
  
  try {
    const stats = await fs.stat(filePath);
    
    if (stats.isDirectory()) {
      return { shouldBackup: false, reason: "is_directory" };
    }
    
    if (stats.size > config.filter.maxFileSize) {
      return { shouldBackup: false, reason: "file_too_large" };
    }
    return { shouldBackup: true, reason: "ok" };
  } catch {
    return { shouldBackup: false, reason: "file_not_exist" };
  }
}

function matchGlobPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  
  if (normalizedPattern.includes("**")) {
    const parts = normalizedPattern.split("**");
    if (parts.length === 2) {
      const [prefix, suffix] = parts;
      const matchesPrefix = prefix === "" || normalizedPath.startsWith(prefix);
      const matchesSuffix = suffix === "" || normalizedPath.endsWith(suffix);
      return matchesPrefix && matchesSuffix;
    }
  }
  
  if (normalizedPattern.includes("*")) {
    const regexPattern = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${regexPattern}$`).test(normalizedPath);
  }
  
  return normalizedPath === normalizedPattern;
}

export async function getFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return computeFileHash(content);
}

export async function hasFileContentChanged(
  stateDir: string,
  filePath: string,
  sessionId: string
): Promise<boolean> {
  const events = await readEventsBySession(stateDir, sessionId);
  const fileEvents = events.filter((e) => e.file_path === filePath);
  
  if (fileEvents.length === 0) {
    return true;
  }
  
  try {
    const currentHash = await getFileHash(filePath);
    const lastEvent = fileEvents[fileEvents.length - 1];
    return lastEvent?.file_hash !== currentHash;
  } catch {
    return true;
  }
}

export interface CreateSnapshotOptions {
  stateDir: string;
  filePath: string;
  operationType: FileOperationType;
  sessionId: string;
  toolName: string;
  toolCallId?: string;
  originalPath?: string;
  config: SnapshotConfig;
}

export interface CreateSnapshotResult {
  eventId: string;
  snapshotId: string | null;
  skipped: boolean;
  skipReason?: string;
}

export async function createSnapshot(
  options: CreateSnapshotOptions
): Promise<CreateSnapshotResult> {
  const { stateDir, filePath, operationType, sessionId, toolName, toolCallId, originalPath, config } = options;
  
  await ensureSnapshotDirs(stateDir);
  
  if (isFileRecordedInSession(sessionId, filePath)) {
    return {
      eventId: generateEventId(),
      snapshotId: null,
      skipped: true,
      skipReason: "already_recorded_in_session",
    };
  }
  
  if (operationType === "CREATE") {
    const eventId = generateEventId();
    const event: SnapshotEvent = {
      event_id: eventId,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      operation_type: "CREATE",
      file_path: filePath,
      snapshot_id: null,
      file_hash: null,
      file_size: 0,
    };
    
    await appendEvent(stateDir, event);
    markFileRecordedInSession(sessionId, filePath);
    
    return { eventId, snapshotId: null, skipped: false };
  }
  
  const { shouldBackup, reason } = await shouldBackupFile(filePath, config);
  
  if (!shouldBackup) {
    let fileSize = 0;
    let fileHash: string | null = null;
    
    if (reason !== "file_not_exist") {
      try {
        const stats = await fs.stat(filePath);
        fileSize = stats.size;
        fileHash = await getFileHash(filePath);
      } catch {
        // Ignore errors
      }
    }
    
    const eventId = generateEventId();
    const event: SnapshotEvent = {
      event_id: eventId,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      operation_type: operationType,
      file_path: filePath,
      snapshot_id: null,
      file_hash: fileHash,
      file_size: fileSize,
      original_path: originalPath,
    };
    
    await appendEvent(stateDir, event);
    markFileRecordedInSession(sessionId, filePath);
    
    return {
      eventId,
      snapshotId: null,
      skipped: true,
      skipReason: reason,
    };
  }
  
  const contentChanged = await hasFileContentChanged(stateDir, filePath, sessionId);
  if (!contentChanged) {
    const eventId = generateEventId();
    const event: SnapshotEvent = {
      event_id: eventId,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      operation_type: operationType,
      file_path: filePath,
      snapshot_id: null,
      file_hash: null,
      file_size: 0,
    };
    
    await appendEvent(stateDir, event);
    markFileRecordedInSession(sessionId, filePath);
    
    return {
      eventId,
      snapshotId: null,
      skipped: true,
      skipReason: "content_unchanged",
    };
  }
  
  const content = await fs.readFile(filePath);
  const fileHash = computeFileHash(content);
  const fileSize = content.length;
  
  const snapshots = await loadSnapshots(stateDir);
  let snapshotRecord = config.deduplication.enabled
    ? await findSnapshotByHash(snapshots, fileHash)
    : undefined;
  
  let snapshotId: string;
  
  if (snapshotRecord) {
    snapshotRecord.ref_count++;
    snapshotId = snapshotRecord.snapshot_id;
  } else {
    snapshotId = generateSnapshotId();
    const storagePath = buildStoragePath(snapshotId, fileHash);
    
    snapshotRecord = {
      snapshot_id: snapshotId,
      file_hash: fileHash,
      storage_path: storagePath,
      size: fileSize,
      compression: "none",
      created_at: new Date().toISOString(),
      ref_count: 1,
    };
    
    await writeSnapshotContent(stateDir, storagePath, content, "none");
    snapshots.set(snapshotId, snapshotRecord);
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalSnapshots++;
    index.stats.totalSizeBytes += fileSize;
    await saveSnapshotIndex(stateDir, index);
  }
  
  await saveSnapshots(stateDir, snapshots);
  
  const eventId = generateEventId();
  const event: SnapshotEvent = {
    event_id: eventId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    operation_type: operationType,
    file_path: filePath,
    snapshot_id: snapshotId,
    file_hash: fileHash,
    file_size: fileSize,
    original_path: originalPath,
  };
  
  await appendEvent(stateDir, event);
  markFileRecordedInSession(sessionId, filePath);
  
  return { eventId, snapshotId, skipped: false };
}

export async function processFileOperations(
  stateDir: string,
  operations: DetectedFileOperation[],
  sessionId: string,
  toolName: string,
  toolCallId: string | undefined,
  config: SnapshotConfig
): Promise<CreateSnapshotResult[]> {
  const results: CreateSnapshotResult[] = [];
  
  for (const op of operations) {
    const result = await createSnapshot({
      stateDir,
      filePath: op.filePath,
      operationType: op.operationType,
      sessionId,
      toolName,
      toolCallId,
      originalPath: op.originalPath,
      config,
    });
    results.push(result);
  }
  
  return results;
}

export async function restoreSnapshotContent(
  stateDir: string,
  snapshotId: string,
  targetPath: string
): Promise<void> {
  const snapshots = await loadSnapshots(stateDir);
  const record = snapshots.get(snapshotId);
  
  if (!record) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  
  const { readSnapshotContent } = await import("./storage.js");
  const content = await readSnapshotContent(stateDir, record.storage_path, record.compression);
  
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content);
}

export async function deleteSnapshotWithRefCount(
  stateDir: string,
  snapshotId: string
): Promise<boolean> {
  const snapshots = await loadSnapshots(stateDir);
  const record = snapshots.get(snapshotId);
  
  if (!record) {
    return false;
  }
  
  record.ref_count--;
  
  if (record.ref_count <= 0) {
    await deleteSnapshotContent(stateDir, record.storage_path);
    snapshots.delete(snapshotId);
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalSnapshots--;
    index.stats.totalSizeBytes -= record.size;
    await saveSnapshotIndex(stateDir, index);
  }
  
  await saveSnapshots(stateDir, snapshots);
  return true;
}
