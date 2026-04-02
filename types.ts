type Platform = NodeJS.Platform;

export type BackupId = string;
export type BackupType = "clawbackup" | "native";

export type FileOperationType = "CREATE" | "UPDATE" | "DELETE" | "RENAME";

export type SnapshotCompression = "none" | "gzip";

export interface SnapshotEvent {
  event_id: string;
  session_id: string;
  timestamp: string;
  operation_type: FileOperationType;
  file_path: string;
  snapshot_id: string | null;
  file_hash: string | null;
  file_size: number;
  original_path?: string;
}

export interface SnapshotRecord {
  snapshot_id: string;
  file_hash: string;
  storage_path: string;
  size: number;
  compression: SnapshotCompression;
  created_at: string;
  ref_count: number;
}

export interface SnapshotIndex {
  schemaVersion: number;
  updatedAt: string;
  stats: {
    totalSnapshots: number;
    totalSizeBytes: number;
    totalEvents: number;
  };
}

export interface SnapshotConfig {
  enabled: boolean;
  filter: {
    maxFileSize: number;
    excludeExtensions: string[];
    excludePatterns: string[];
    includeExtensions?: string[];
    additionalExcludeExtensions?: string[];
    additionalExcludePatterns?: string[];
  };
  retention: {
    maxTotalSizeMB: number;
    cleanupTriggers: {
      onSessionEnd: boolean;
      onStartup: boolean;
    };
  };
  deduplication: {
    enabled: boolean;
    hashAlgorithm: "sha256";
  };
}

export interface SessionSnapshotTracker {
  sessionId: string;
  startedAt: string;
  recordedFiles: Set<string>;
}

export interface RollbackOptions {
  timestamp?: string;
  sessionId?: string;
  filePaths?: string[];
  dryRun?: boolean;
}

export interface RollbackResult {
  success: boolean;
  operations: Array<{
    filePath: string;
    action: "restore" | "delete" | "skip";
    success: boolean;
    error?: string;
  }>;
  rollbackId?: string;
}

export interface DetectedFileOperation {
  filePath: string;
  operationType: FileOperationType;
  originalPath?: string;
}

export type BackupAssetKind = "state" | "config" | "credentials" | "workspace" | "agents" | "plugins";

export interface BackupEntry {
  id: BackupId;
  type: BackupType;
  name: string;
  createdAt: string;
  sizeBytes: number;
  encrypted: boolean;
  storageBackend: string;
  storagePath: string;
  remoteSync?: {
    storageBackend: string;
    storagePath: string;
    syncedAt: string;
  };
}

export interface BackupAsset {
  kind: BackupAssetKind;
  sourcePath: string;
  archivePath: string;
  displayPath: string;
}

export interface BackupManifest {
  schemaVersion: number;
  backupId: BackupId;
  name: string;
  createdAt: string;
  sizeBytes: number;
  contentHash: string;
  runtimeVersion?: string;
  platform?: Platform;
  nodeVersion?: string;
  options: {
    includeWorkspace: boolean;
    onlyConfig: boolean;
  };
  paths: {
    stateDir: string;
    configPath: string;
    credentialsDir: string;
    agentsDir?: string;
    pluginsDir?: string;
    workspaceDirs: string[];
  };
  assets: BackupAsset[];
  skipped: Array<{
    kind: BackupAssetKind;
    sourcePath: string;
    reason: string;
  }>;
  encryption?: {
    algorithm: string;
    keyDerivation: string;
    iterations?: number;
  };
  tags?: string[];
  storageBackend: string;
  storagePath: string;
}

export interface StorageBackend {
  backendId: string;
  backendType: "local" | "s3";
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
}

export interface StorageBackendInterface {
  put(key: string, data: Buffer): Promise<string>;
  putStream?(key: string, filePath: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  getStream?(key: string, filePath: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}
