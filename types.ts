import type { Platform } from "node:os";

export type BackupId = string;
export type BackupType = "clawbackup" | "native";

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
