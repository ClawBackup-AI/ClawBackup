import * as path from "node:path";
import * as fs from "node:fs/promises";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import type { BackupId, BackupManifest, BackupEntry, StorageBackendInterface, BackupAsset, BackupAssetKind } from "../types.js";
import { LocalStorageBackend } from "./storage/local.js";
import { getPluginConfig } from "./config.js";
import { discoverNativeBackups } from "./native.js";
import { generateBackupId } from "../utils/crypto.js";

const DEFAULT_BACKUP_DIR_NAME = "clawbackups";
const OPENCLAW_DIR_NAME = ".openclaw";

function getBackupDir(stateDir: string): string {
  return path.join(stateDir, DEFAULT_BACKUP_DIR_NAME);
}

function getIndexFile(stateDir: string): string {
  return path.join(getBackupDir(stateDir), "clawbackups.json");
}

function getTempDir(): string {
  return process.env.TMPDIR || os.tmpdir();
}

function buildTempArchivePath(outputPath: string): string {
  return `${outputPath}.${crypto.randomUUID()}.tmp`;
}

async function publishTempArchive(params: {
  tempArchivePath: string;
  outputPath: string;
}): Promise<void> {
  try {
    await fs.rename(params.tempArchivePath, params.outputPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing backup file: ${params.outputPath}`, { cause: err });
    }
    if (code !== "EXDEV") {
      throw err;
    }
    // Fallback to copyFile + rm for cross-device (different drives/filesystems)
    try {
      await fs.copyFile(params.tempArchivePath, params.outputPath, fsConstants.COPYFILE_EXCL);
    } catch (copyErr) {
      const copyCode = (copyErr as NodeJS.ErrnoException | undefined)?.code;
      if (copyCode === "EEXIST") {
        throw new Error(`Refusing to overwrite existing backup file: ${params.outputPath}`, { cause: copyErr });
      }
      throw copyErr;
    }
    await fs.rm(params.tempArchivePath, { force: true });
  }
}

async function canonicalizePath(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  const suffix: string[] = [];
  let probe = resolved;
  while (true) {
    try {
      const realProbe = await fs.realpath(probe);
      return suffix.length === 0 ? realProbe : path.join(realProbe, ...suffix.toReversed());
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        return resolved;
      }
      suffix.push(path.basename(probe));
      probe = parent;
    }
  }
}

function encodeAbsolutePathForArchive(sourcePath: string): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  const windowsMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (windowsMatch) {
    const drive = windowsMatch[1]!.toUpperCase();
    const rest = windowsMatch[2]!;
    return path.posix.join("windows", drive, rest);
  }
  if (normalized.startsWith("/")) {
    return path.posix.join("posix", normalized.slice(1));
  }
  return path.posix.join("relative", normalized);
}

function decodeArchivePathToAbsolute(archivePath: string): string {
  const normalized = archivePath.replaceAll("\\", "/");
  
  if (normalized.startsWith("windows/")) {
    const parts = normalized.split("/");
    if (parts.length >= 3) {
      const drive = parts[1];
      const rest = parts.slice(2).join("/");
      return `${drive}:/${rest}`;
    }
  }
  
  if (normalized.startsWith("posix/")) {
    return "/" + normalized.slice(6);
  }
  
  if (normalized.startsWith("relative/")) {
    return normalized.slice(9);
  }
  
  return normalized;
}

function shortenPath(fullPath: string, baseDir: string): string {
  const relative = path.relative(baseDir, fullPath);
  if (relative && !relative.startsWith("..")) {
    return relative;
  }
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }
  return fullPath;
}

interface BackupIndex {
  schemaVersion: number;
  indexedAt: string;
  backups: BackupEntry[];
}

export interface CreateBackupOptions {
  name?: string;
  password?: string;
  storageBackend?: string;
  includeWorkspace?: boolean;
  onlyConfig?: boolean;
  sourceDir?: string;
  stateDir: string;
  outputPath?: string;
  workspaceDirs?: string[];
  dryRun?: boolean;
}

export interface CreateBackupResult {
  id: BackupId;
  name: string;
  createdAt: string;
  sizeBytes: number;
  contentHash: string;
  encrypted: boolean;
  storageBackend: string;
  storagePath: string;
  outputPath?: string;
  dryRun: boolean;
  assets: BackupAsset[];
  skipped: Array<{ kind: BackupAssetKind; sourcePath: string; reason: string }>;
}

export interface ListBackupsOptions {
  type?: "all" | "native" | "clawbackup";
  limit?: number;
  stateDir: string;
}

export interface RestoreBackupOptions {
  backupId: BackupId;
  targetPath?: string;
  password?: string;
  createSnapshot?: boolean;
  stateDir: string;
  agentDir?: string;
  fromRemote?: string;
}

export interface RestoreBackupResult {
  backupId: BackupId;
  targetPath: string;
  success: boolean;
}

export interface SyncBackupOptions {
  backupId: BackupId;
  storageBackend?: string;
  force?: boolean;
  stateDir: string;
}

export interface SyncBackupResult {
  success: boolean;
  backupId?: BackupId;
  remotePath?: string;
  error?: string;
}

export interface DeleteBackupOptions {
  backupId: BackupId;
  stateDir: string;
}

export interface DeleteBackupResult {
  success: boolean;
  backupId: BackupId;
}

export interface VerifyBackupOptions {
  backupId: BackupId;
  stateDir: string;
}

export interface VerifyBackupResult {
  valid: boolean;
  backupId: BackupId;
  error?: string;
}

export interface BackupStatusResult {
  totalBackups: number;
  totalSizeBytes: number;
  lastBackupAt?: string;
  nativeBackupsCount: number;
  storageBackends: Array<{
    id: string;
    name: string;
    type: string;
    backupCount: number;
    usedBytes: number;
  }>;
}

async function loadBackupIndex(stateDir: string): Promise<BackupIndex> {
  const indexFile = getIndexFile(stateDir);
  try {
    const data = await fs.readFile(indexFile, "utf8");
    return JSON.parse(data);
  } catch {
    return {
      schemaVersion: 1,
      indexedAt: new Date().toISOString(),
      backups: [],
    };
  }
}

async function saveBackupIndex(index: BackupIndex, stateDir: string): Promise<void> {
  const backupDir = getBackupDir(stateDir);
  const indexFile = getIndexFile(stateDir);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(indexFile, JSON.stringify(index, null, 2), "utf8");
}

interface BackupPlan {
  assets: BackupAsset[];
  skipped: Array<{ kind: BackupAssetKind; sourcePath: string; reason: string }>;
  paths: {
    stateDir: string;
    configPath: string;
    credentialsDir: string;
    workspaceDirs: string[];
  };
}

function collectWorkspaceDirs(config: OpenClawConfig): string[] {
  const dirs = new Set<string>();
  const defaults = config?.agents?.defaults;
  if (typeof (defaults as Record<string, unknown>)?.workspace === "string") {
    const workspace = (defaults as Record<string, unknown>).workspace as string;
    if (workspace.trim()) {
      const resolved = workspace.startsWith("~") 
        ? path.join(os.homedir(), workspace.slice(1))
        : workspace;
      dirs.add(path.resolve(resolved));
    }
  }
  const list = Array.isArray(config?.agents?.list) ? config?.agents?.list : [];
  for (const agent of list) {
    const workspace = (agent as Record<string, unknown>)?.workspace;
    if (typeof workspace === "string" && workspace.trim()) {
      const resolved = workspace.startsWith("~")
        ? path.join(os.homedir(), workspace.slice(1))
        : workspace;
      dirs.add(path.resolve(resolved));
    }
  }
  return [...dirs];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBackupPlan(
  stateDir: string,
  config: OpenClawConfig,
  options: { includeWorkspace?: boolean; onlyConfig?: boolean; workspaceDirs?: string[] },
): Promise<BackupPlan> {
  const { includeWorkspace = true, onlyConfig = false, workspaceDirs: explicitWorkspaceDirs = [] } = options;
  
  const assets: BackupAsset[] = [];
  const skipped: Array<{ kind: BackupAssetKind; sourcePath: string; reason: string }> = [];
  
  const configPath = path.join(stateDir, "openclaw.json");
  const credentialsDir = path.join(stateDir, "oauth");
  
  const autoWorkspaceDirs = includeWorkspace ? collectWorkspaceDirs(config) : [];
  const workspaceDirs = explicitWorkspaceDirs.length > 0 ? explicitWorkspaceDirs : autoWorkspaceDirs;
  
  const paths: BackupPlan["paths"] = {
    stateDir,
    configPath,
    credentialsDir,
    workspaceDirs: includeWorkspace ? workspaceDirs : [],
  };

  const isPathWithin = (child: string, parent: string): boolean => {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const addAsset = async (
    kind: BackupAssetKind,
    sourcePath: string,
  ): Promise<boolean> => {
    try {
      const exists = await pathExists(sourcePath);
      if (exists) {
        const canonicalPath = await canonicalizePath(sourcePath);
        assets.push({
          kind,
          sourcePath: canonicalPath,
          archivePath: encodeAbsolutePathForArchive(canonicalPath),
          displayPath: shortenPath(canonicalPath, stateDir),
        });
        return true;
      } else {
        skipped.push({ kind, sourcePath, reason: "Path does not exist" });
        return false;
      }
    } catch {
      skipped.push({ kind, sourcePath, reason: "Path inaccessible" });
      return false;
    }
  };

  if (onlyConfig) {
    await addAsset("config", configPath);
  } else {
    await addAsset("state", stateDir);
    
    if (includeWorkspace && workspaceDirs.length > 0) {
      for (const workspaceDir of workspaceDirs) {
        if (isPathWithin(workspaceDir, stateDir)) {
          skipped.push({ kind: "workspace", sourcePath: workspaceDir, reason: "Already included in state directory" });
          continue;
        }
        await addAsset("workspace", workspaceDir);
      }
    }
  }

  return { assets, skipped, paths };
}

async function createTarArchive(
  assets: BackupAsset[],
  outputPath: string,
): Promise<void> {
  const tar = await import("tar");
  const files = assets.map((a) => a.sourcePath);
  
  const sourceToArchive = new Map<string, string>();
  for (const asset of assets) {
    const normalizedSource = asset.sourcePath.replaceAll("\\", "/");
    sourceToArchive.set(normalizedSource, asset.archivePath);
    if (!normalizedSource.startsWith("/")) {
      sourceToArchive.set("/" + normalizedSource, asset.archivePath);
    }
  }
  
  await tar.c(
    {
      file: outputPath,
      gzip: true,
      portable: true,
      preservePaths: true,
      map: (header) => {
        const originalPath = header.name;
        const archivePath = sourceToArchive.get(originalPath) || sourceToArchive.get("/" + originalPath);
        if (archivePath) {
          header.name = archivePath;
        }
        return header;
      },
    },
    files,
  );
}

async function hashFileStream(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function encryptFileStream(
  inputPath: string,
  outputPath: string,
  password: string,
): Promise<void> {
  const { pipeline } = await import("node:stream/promises");
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, 100000, 32, "sha256");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  const inputStream = createReadStream(inputPath);
  const outputStream = createWriteStream(outputPath);

  await new Promise<void>((resolve, reject) => {
    outputStream.write(Buffer.concat([salt, iv]), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  await pipeline(inputStream, cipher, outputStream, { end: true });
}

async function decryptBackup(
  data: Buffer,
  password: string,
): Promise<Buffer> {
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const key = crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    salt,
    100000,
    32,
    "sha256",
  );
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
}

async function createDecipherStream(
  inputPath: string,
  password: string,
): Promise<{ stream: NodeJS.ReadableStream; headerSize: number }> {
  const fd = await fs.open(inputPath, "r");
  try {
    const headerBuffer = Buffer.alloc(32);
    await fd.read(headerBuffer, 0, 32, 0);
    const salt = headerBuffer.subarray(0, 16);
    const iv = headerBuffer.subarray(16, 32);
    const key = crypto.pbkdf2Sync(
      Buffer.from(password, "utf8"),
      salt,
      100000,
      32,
      "sha256",
    );
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const encryptedStream = createReadStream(inputPath, { start: 32 });
    encryptedStream.on("close", () => {
      fd.close().catch(() => {});
    });
    return { stream: encryptedStream.pipe(decipher), headerSize: 32 };
  } catch (err) {
    await fd.close();
    throw err;
  }
}

export async function createBackup(
  options: CreateBackupOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<CreateBackupResult> {
  const { 
    name, 
    password, 
    storageBackend, 
    includeWorkspace = true, 
    onlyConfig = false, 
    sourceDir, 
    stateDir,
    outputPath,
    workspaceDirs = [],
    dryRun = false,
  } = options;
  const { config, logger } = ctx;
  const pluginConfig = getPluginConfig(config);
  const targetBackend = storageBackend || pluginConfig.defaultStorage || "local";
  const shouldEncrypt = !!password;
  const backupId = generateBackupId();
  const backupName = name || `backup-${new Date().toISOString().slice(0, 10)}`;
  const createdAt = new Date().toISOString();

  const actualStateDir = sourceDir || path.join(os.homedir(), OPENCLAW_DIR_NAME);
  
  const isPathWithin = (child: string, parent: string): boolean => {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const resolveDefaultOutputPath = async (sourcePaths: string[]): Promise<string> => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const basename = `${timestamp}-clawbackup.tar.gz`;
    const cwd = path.resolve(process.cwd());
    const canonicalCwd = await canonicalizePath(cwd).catch(() => cwd);
    const cwdInsideSource = sourcePaths.some((srcPath) => isPathWithin(canonicalCwd, srcPath));
    if (cwdInsideSource) {
      const homeDir = os.homedir();
      if (homeDir && !isPathWithin(homeDir, actualStateDir)) {
        return path.join(homeDir, basename);
      }
      return path.join(path.dirname(actualStateDir), basename);
    }
    return path.join(cwd, basename);
  };

  logger.info("Analyzing backup content...");
  const plan = await resolveBackupPlan(actualStateDir, config, { includeWorkspace, onlyConfig, workspaceDirs });
  const { assets, skipped, paths } = plan;
  
  logger.info(`Found ${assets.length} paths to backup`);
  for (const asset of assets) {
    logger.info(`  - ${asset.kind}: ${asset.displayPath}`);
  }
  if (skipped.length > 0) {
    logger.info(`Skipping ${skipped.length} items`);
    for (const entry of skipped) {
      logger.info(`  - ${entry.kind}: ${entry.sourcePath} (${entry.reason})`);
    }
  }

  if (assets.length === 0) {
    throw new Error(
      onlyConfig
        ? "No OpenClaw configuration file found to backup"
        : "No local OpenClaw state found to backup"
    );
  }

  const sourcePaths = [...new Set(assets.map((a) => path.dirname(a.sourcePath)))];
  
  let targetOutputPath: string;
  if (outputPath) {
    if (outputPath.endsWith(path.sep) || outputPath.endsWith("/")) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const basename = `${timestamp}-clawbackup.tar.gz`;
      targetOutputPath = path.join(outputPath, basename);
    } else {
      targetOutputPath = outputPath;
    }
  } else {
    targetOutputPath = await resolveDefaultOutputPath(sourcePaths);
  }
  
  const canonicalOutput = await canonicalizePath(targetOutputPath);
  const overlappingAsset = assets.find((asset) => isPathWithin(canonicalOutput, asset.sourcePath));
  if (overlappingAsset) {
    throw new Error(
      `Backup output cannot be inside source path: ${targetOutputPath} is inside ${overlappingAsset.sourcePath}`
    );
  }

  const result: CreateBackupResult = {
    id: backupId,
    name: backupName,
    createdAt,
    sizeBytes: 0,
    contentHash: "",
    encrypted: shouldEncrypt,
    storageBackend: targetBackend,
    storagePath: "",
    outputPath: targetOutputPath,
    dryRun,
    assets,
    skipped,
  };

  if (dryRun) {
    logger.info("Dry run mode, backup file not actually written");
    return result;
  }

  const tempDir = await fs.mkdtemp(path.join(getTempDir(), "clawbackup-"));
  const tempArchivePath = buildTempArchivePath(targetOutputPath);
  
  try {
    await fs.mkdir(path.dirname(targetOutputPath), { recursive: true });
    
    const tar = await import("tar");
    const manifestPath = path.join(tempDir, "manifest.json");
    
    const manifest: BackupManifest = {
      schemaVersion: 1,
      backupId,
      name: backupName,
      createdAt,
      sizeBytes: 0,
      contentHash: "",
      runtimeVersion: process.env.npm_package_version || "1.0.0",
      platform: os.platform(),
      nodeVersion: process.version,
      options: { includeWorkspace, onlyConfig },
      paths,
      assets,
      skipped,
      encryption: shouldEncrypt
        ? { algorithm: "AES-256-CBC", keyDerivation: "PBKDF2", iterations: 100000 }
        : undefined,
      storageBackend: targetBackend,
      storagePath: "",
    };
    
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const sourceToArchive = new Map<string, string>();
    for (const asset of assets) {
      const normalizedSource = asset.sourcePath.replaceAll("\\", "/");
      sourceToArchive.set(normalizedSource, asset.archivePath);
    }

    if (shouldEncrypt) {
      logger.info("Creating and encrypting backup...");
      const tempTarPath = path.join(tempDir, `${backupId}.tar.gz`);

      await tar.c(
        {
          file: tempTarPath,
          gzip: true,
          portable: true,
          preservePaths: true,
          filter: (filePath: string) => !isPathWithin(filePath, getBackupDir(actualStateDir)),
          map: (header) => {
            const originalPath = header.name;
            const archivePath = sourceToArchive.get(originalPath);
            if (archivePath) {
              header.name = archivePath;
            }
            return header;
          },
        },
        [manifestPath, ...assets.map((a) => a.sourcePath)],
      );

      await encryptFileStream(tempTarPath, tempArchivePath, password!);

      const encStats = await fs.stat(tempArchivePath);
      result.sizeBytes = encStats.size;
      manifest.sizeBytes = encStats.size;
      result.contentHash = await hashFileStream(tempArchivePath);
      manifest.contentHash = result.contentHash;
    } else {
      logger.info("Creating backup...");

      await tar.c(
        {
          file: tempArchivePath,
          gzip: true,
          portable: true,
          preservePaths: true,
          filter: (filePath: string) => !isPathWithin(filePath, getBackupDir(actualStateDir)),
          map: (header) => {
            const originalPath = header.name;
            const archivePath = sourceToArchive.get(originalPath);
            if (archivePath) {
              header.name = archivePath;
            }
            return header;
          },
        },
        [manifestPath, ...assets.map((a) => a.sourcePath)],
      );

      const stats = await fs.stat(tempArchivePath);
      result.sizeBytes = stats.size;
      manifest.sizeBytes = stats.size;
      result.contentHash = await hashFileStream(tempArchivePath);
      manifest.contentHash = result.contentHash;
    }

    await publishTempArchive({ tempArchivePath, outputPath: targetOutputPath });

    const resolvedStoragePath = path.resolve(targetOutputPath);
    result.storagePath = resolvedStoragePath;
    manifest.storagePath = resolvedStoragePath;

    const backupDirForIndex = getBackupDir(stateDir);
    await fs.mkdir(backupDirForIndex, { recursive: true });
    await fs.writeFile(
      path.join(backupDirForIndex, `${backupId}.manifest.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const index = await loadBackupIndex(stateDir);
    const entry: BackupEntry = {
      id: backupId,
      type: "clawbackup",
      name: backupName,
      createdAt,
      sizeBytes: result.sizeBytes,
      encrypted: shouldEncrypt,
      storageBackend: targetBackend,
      storagePath: resolvedStoragePath,
    };
    index.backups.push(entry);
    index.indexedAt = new Date().toISOString();
    await saveBackupIndex(index, stateDir);

    logger.info(`Backup created: ${backupId}`);
    logger.info(`Storage location: ${targetOutputPath}`);

    return result;
  } finally {
    await fs.rm(tempArchivePath, { force: true }).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function listBackups(
  options: ListBackupsOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<BackupEntry[]> {
  const { type = "all", limit = 50, stateDir } = options;
  const { logger } = ctx;

  const backupDir = getBackupDir(stateDir);
  await fs.mkdir(backupDir, { recursive: true });
  const index = await loadBackupIndex(stateDir);
  const nativeBackups = await discoverNativeBackups(backupDir);
  const allBackups = [...index.backups, ...nativeBackups];

  const entries: BackupEntry[] = [];
  for (const backup of allBackups) {
    if (type === "all" || backup.type === type) {
      entries.push(backup);
    }
  }

  entries.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (limit && entries.length > limit) {
    entries.length = limit;
  }

  return entries;
}

export async function restoreBackup(
  options: RestoreBackupOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<RestoreBackupResult> {
  const { backupId, targetPath, password, createSnapshot, stateDir, agentDir, fromRemote } = options;
  const { config, logger } = ctx;

  logger.info(`Restoring backup: ${backupId}`);

  const backupDir = getBackupDir(stateDir);
  const index = await loadBackupIndex(stateDir);
  const entry = index.backups.find((b) => b.id === backupId);
  if (!entry) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const localStorage = new LocalStorageBackend(backupDir);
  let manifestData = await localStorage.get(`${backupId}.manifest.json`);

  let backupFilePath: string;
  let cleanupTempFile = false;

  try {
    if (fromRemote) {
      logger.info(`Restoring from remote storage: ${fromRemote}`);
      const { getStorageBackend } = await import("./storage.js");
      const remoteStorage = await getStorageBackend(fromRemote, { config, logger, stateDir });
      
      const remoteKey = path.basename(entry.storagePath);
      const tempDir = getTempDir();
      await fs.mkdir(tempDir, { recursive: true });
      backupFilePath = path.join(tempDir, `${backupId}.tar.gz`);
      cleanupTempFile = true;
      
      logger.info("Downloading backup file from remote...");
      if (remoteStorage.getStream) {
        const success = await remoteStorage.getStream(remoteKey, backupFilePath);
        if (!success) {
          throw new Error(`Remote backup file not found: ${remoteKey}`);
        }
      } else {
        const data = await remoteStorage.get(remoteKey);
        if (!data) {
          throw new Error(`Remote backup file not found: ${remoteKey}`);
        }
        await fs.writeFile(backupFilePath, data);
      }
      
      if (!manifestData) {
        logger.info("Downloading backup manifest from remote...");
        const manifestRemoteKey = `${backupId}.manifest.json`;
        if (remoteStorage.getStream) {
          const manifestPath = path.join(tempDir, `${backupId}.manifest.json`);
          const success = await remoteStorage.getStream(manifestRemoteKey, manifestPath);
          if (success) {
            manifestData = await fs.readFile(manifestPath);
          }
        } else {
          manifestData = await remoteStorage.get(manifestRemoteKey);
        }
      }
      
      logger.info("Remote download completed");
    } else {
      backupFilePath = entry.storagePath;
      try {
        await fs.access(backupFilePath);
      } catch {
        throw new Error(`Backup data not found: ${backupId}`);
      }
    }
  } catch (err) {
    if (cleanupTempFile) {
      await fs.unlink(backupFilePath).catch(() => {});
    }
    throw err;
  }

  if (!manifestData) {
    if (cleanupTempFile) {
      await fs.unlink(backupFilePath).catch(() => {});
    }
    throw new Error(`Backup manifest not found: ${backupId}`);
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestData.toString());
  } catch (parseError) {
    if (cleanupTempFile) {
      await fs.unlink(backupFilePath).catch(() => {});
    }
    throw new Error(`Backup manifest corrupted: ${backupId}, reason: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }

  if (entry.encrypted && !password) {
    if (cleanupTempFile) {
      await fs.unlink(backupFilePath).catch(() => {});
    }
    throw new Error(`Backup "${backupId}" is encrypted, please provide decryption password (--password option)`);
  }

  const target = path.resolve(targetPath || agentDir || path.join(os.homedir(), OPENCLAW_DIR_NAME));

  const parentDir = path.dirname(target);
  try {
    await fs.access(parentDir, fsConstants.W_OK);
  } catch {
    throw new Error(`Target parent directory does not exist or is not writable: ${parentDir}`);
  }

  let snapshotPath: string | undefined;
  if (createSnapshot) {
    let targetExists = false;
    try {
      targetExists = (await fs.stat(target)).isDirectory();
    } catch {
      // target doesn't exist yet
    }
    if (targetExists) {
      const targetBasename = path.basename(target);
      if (!targetBasename || targetBasename === "/" || targetBasename === "\\") {
        logger.warn("Target path is root directory, cannot create snapshot, skipping snapshot feature");
      } else {
        logger.info("Creating pre-restore snapshot...");
        const snapshotsDir = path.join(stateDir, "snapshots");
        await fs.mkdir(snapshotsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/:/g, "-");
        snapshotPath = path.join(snapshotsDir, `${ts}-pre-restore-${backupId}.tar.gz`);
        const tarSnap = await import("tar");
        await tarSnap.c(
          { file: snapshotPath, gzip: true, portable: true, cwd: parentDir },
          [targetBasename],
        );
        logger.info(`Snapshot saved: ${snapshotPath}`);
      }
    } else {
      logger.info("Target directory does not exist, skipping snapshot");
    }
  }

  await fs.mkdir(target, { recursive: true });

  const tar = await import("tar");
  const { pipeline } = await import("node:stream/promises");

  const userSpecifiedTarget = !!targetPath || !!agentDir;
  
  let stripComponents = 0;
  if (userSpecifiedTarget && manifest.assets.length > 0) {
    const firstAsset = manifest.assets[0];
    if (firstAsset) {
      const archivePathParts = firstAsset.archivePath.split("/");
      if (archivePathParts.length > 2) {
        if (archivePathParts[0] === "windows" || archivePathParts[0] === "posix") {
          stripComponents = 2;
        }
      }
    }
  }

  const tarExtractOptions = {
    cwd: target,
    preservePaths: !userSpecifiedTarget,
    strip: userSpecifiedTarget ? stripComponents : 0,
    filter: (filePath: string) => {
      const normalized = filePath.replaceAll("\\", "/");
      return !normalized.includes(`/${DEFAULT_BACKUP_DIR_NAME}/`) &&
             !normalized.endsWith(`/${DEFAULT_BACKUP_DIR_NAME}`);
    },
  };

  try {
    if (entry.encrypted && password) {
      logger.info("Decrypting and restoring backup...");
      const { stream: decipherStream } = await createDecipherStream(backupFilePath, password);
      const gunzip = (await import("node:zlib")).createGunzip();
      await pipeline(
        decipherStream,
        gunzip,
        tar.x(tarExtractOptions),
      );
    } else {
      logger.info("Restoring backup...");
      const readStream = createReadStream(backupFilePath);
      const gunzip = (await import("node:zlib")).createGunzip();
      await pipeline(
        readStream,
        gunzip,
        tar.x(tarExtractOptions),
      );
    }
  } catch (restoreError) {
    if (snapshotPath) {
      logger.info("Restore failed, rolling back from snapshot...");
      try {
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(target, { recursive: true });
        const tarRollback = await import("tar");
        await tarRollback.x({
          file: snapshotPath,
          cwd: parentDir,
          preservePaths: true,
        });
        logger.info("Rollback successful");
      } catch (rollbackError) {
        const msg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        logger.error(`Rollback failed, please restore manually using snapshot: ${snapshotPath} (${msg})`);
        throw restoreError;
      } finally {
        await fs.unlink(snapshotPath).catch(() => {});
      }
    }
    throw restoreError;
  }

  if (snapshotPath) {
    await fs.unlink(snapshotPath).catch(() => {});
    logger.info("Pre-restore snapshot cleaned up");
  }

  if (cleanupTempFile) {
    await fs.unlink(backupFilePath).catch(() => {});
    logger.info("Temporary files cleaned up");
  }

  logger.info(`Restore completed: ${backupId}`);

  return {
    backupId,
    targetPath: target,
    success: true,
  };
}

export async function syncBackup(
  options: SyncBackupOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<SyncBackupResult> {
  const { backupId, storageBackend, force, stateDir } = options;
  const { config, logger } = ctx;

  logger.info(`Syncing backup: ${backupId}`);

  const backupDir = getBackupDir(stateDir);
  const index = await loadBackupIndex(stateDir);
  const entry = index.backups.find((b) => b.id === backupId);
  if (!entry) {
    return {
      success: false,
      backupId,
      error: "Backup not found",
    };
  }

  try {
    await fs.access(entry.storagePath);
  } catch {
    return {
      success: false,
      backupId,
      error: "Backup data not found",
    };
  }

  const localStorage = new LocalStorageBackend(backupDir);
  const manifestData = await localStorage.get(`${backupId}.manifest.json`);

  const { getStorageBackend, listStorageBackends } = await import("./storage.js");
  const backends = await listStorageBackends({ config, logger, stateDir });
  const defaultBackend = backends.find((b) => b.isDefault);
  
  const targetBackendId = storageBackend || defaultBackend?.backendId;
  if (!targetBackendId) {
    return {
      success: false,
      backupId,
      error: "No target storage backend specified, and no default backend configured. Please use --storage to specify or configure a default backend",
    };
  }
  
  let targetStorage: StorageBackendInterface;
  try {
    targetStorage = await getStorageBackend(targetBackendId, { config, logger, stateDir });
  } catch {
    return {
      success: false,
      backupId,
      error: `Storage backend not found: ${targetBackendId}`,
    };
  }

  const remoteKey = path.basename(entry.storagePath);

  if (!force) {
    const existing = await targetStorage.get(remoteKey);
    if (existing) {
      return {
        success: false,
        backupId,
        error: "Remote backup with same name already exists, use --force to overwrite",
      };
    }
  }

  let remotePath: string;
  if (targetStorage.putStream) {
    const result = await targetStorage.putStream(remoteKey, entry.storagePath);
    remotePath = typeof result === "string" ? result : `s3://${targetBackendId}/${remoteKey}`;
  } else {
    const backupData = await fs.readFile(entry.storagePath);
    remotePath = await targetStorage.put(remoteKey, backupData);
  }

  if (manifestData) {
    await targetStorage.put(`${backupId}.manifest.json`, manifestData);
  }

  entry.remoteSync = {
    storageBackend: targetBackendId,
    storagePath: remotePath,
    syncedAt: new Date().toISOString(),
  };
  await saveBackupIndex(index, stateDir);

  logger.info(`Sync completed: ${remotePath}`);

  return {
    success: true,
    backupId,
    remotePath,
  };
}

export async function deleteBackup(
  options: DeleteBackupOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<DeleteBackupResult> {
  const { backupId, stateDir } = options;
  const { config, logger } = ctx;

  logger.info(`Deleting backup: ${backupId}`);

  const backupDir = getBackupDir(stateDir);
  const index = await loadBackupIndex(stateDir);
  const entryIndex = index.backups.findIndex((b) => b.id === backupId);
  if (entryIndex === -1) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const entry = index.backups[entryIndex];
  
  await fs.unlink(entry.storagePath).catch(() => {});
  await fs.unlink(path.join(backupDir, `${backupId}.manifest.json`)).catch(() => {});

  if (entry.remoteSync) {
    logger.info(`Deleting remote copy: ${entry.remoteSync.storagePath}`);
    try {
      const { getStorageBackend } = await import("./storage.js");
      const remoteStorage = await getStorageBackend(entry.remoteSync.storageBackend, { config, logger, stateDir });
      await remoteStorage.delete(entry.remoteSync.storagePath);
      await remoteStorage.delete(`${backupId}.manifest.json`).catch(() => {});
      logger.info(`Remote copy deleted`);
    } catch (remoteError) {
      logger.warn(`Failed to delete remote copy: ${remoteError instanceof Error ? remoteError.message : String(remoteError)}`);
    }
  }

  index.backups.splice(entryIndex, 1);
  await saveBackupIndex(index, stateDir);

  logger.info(`Backup deleted: ${backupId}`);

  return {
    success: true,
    backupId,
  };
}

export async function verifyBackup(
  options: VerifyBackupOptions,
  ctx: { config: OpenClawConfig; logger: PluginLogger },
): Promise<VerifyBackupResult> {
  const { backupId, stateDir } = options;
  const { logger } = ctx;

  logger.info(`Verifying backup: ${backupId}`);

  const backupDir = getBackupDir(stateDir);
  const index = await loadBackupIndex(stateDir);
  const entry = index.backups.find((b) => b.id === backupId);
  if (!entry) {
    return {
      valid: false,
      backupId,
      error: "Backup not found",
    };
  }

  const storage = new LocalStorageBackend(backupDir);
  const manifestData = await storage.get(`${backupId}.manifest.json`);
  if (!manifestData) {
    return {
      valid: false,
      backupId,
      error: "Backup manifest not found",
    };
  }

  const backupPath = entry.storagePath;
  try {
    await fs.access(backupPath);
  } catch {
    return {
      valid: false,
      backupId,
      error: "Backup data not found",
    };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestData.toString());
  } catch (parseError) {
    return {
      valid: false,
      backupId,
      error: `Backup manifest corrupted: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    };
  }

  logger.info(`Calculating file hash (streaming)...`);
  const actualHash = await hashFileStream(backupPath);
  if (actualHash !== manifest.contentHash) {
    return {
      valid: false,
      backupId,
      error: "Content hash mismatch",
    };
  }

  logger.info(`Verification passed: ${backupId}`);

  return {
    valid: true,
    backupId,
  };
}

export async function getBackupStatus(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<BackupStatusResult> {
  const { config, logger, stateDir } = ctx;

  const backupDir = getBackupDir(stateDir);
  const index = await loadBackupIndex(stateDir);
  const nativeBackups = await discoverNativeBackups(backupDir);
  const allBackups = [...index.backups, ...nativeBackups];

  const totalSize = allBackups.reduce((sum, b) => sum + b.sizeBytes, 0);
  const lastBackup = allBackups.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];

  const { listStorageBackends } = await import("./storage.js");
  const backends = await listStorageBackends({ config, logger, stateDir });
  
  const storageBackends = backends.map((backend) => {
    const backendBackups = index.backups.filter(
      (b) => b.storageBackend === backend.backendId || 
             (b.remoteSync?.storageBackend === backend.backendId)
    );
    const backendSize = backendBackups.reduce((sum, b) => sum + b.sizeBytes, 0);
    
    return {
      id: backend.backendId,
      name: backend.name,
      type: backend.backendType,
      backupCount: backendBackups.length,
      usedBytes: backendSize,
    };
  });

  return {
    totalBackups: allBackups.length,
    totalSizeBytes: totalSize,
    lastBackupAt: lastBackup?.createdAt,
    nativeBackupsCount: nativeBackups.length,
    storageBackends,
  };
}
