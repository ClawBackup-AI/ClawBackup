import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { SnapshotRecord, SnapshotCompression, SnapshotIndex } from "../../types.js";

const SNAPSHOTS_DIR_NAME = "snapshots";
const DATA_DIR_NAME = "data";
const INDEX_FILE_NAME = "index.json";
const SNAPSHOTS_FILE_NAME = "snapshots.json";
const EVENTS_FILE_NAME = "events.jsonl";
const CLAWBACKUPS_DIR_NAME = "clawbackups";

function getClawBackupsDir(stateDir: string): string {
  return path.join(stateDir, CLAWBACKUPS_DIR_NAME);
}

export function getSnapshotsDir(stateDir: string): string {
  return path.join(getClawBackupsDir(stateDir), SNAPSHOTS_DIR_NAME);
}

export function getDataDir(stateDir: string): string {
  return path.join(getSnapshotsDir(stateDir), DATA_DIR_NAME);
}

export function getIndexFilePath(stateDir: string): string {
  return path.join(getSnapshotsDir(stateDir), INDEX_FILE_NAME);
}

export function getSnapshotsFilePath(stateDir: string): string {
  return path.join(getSnapshotsDir(stateDir), SNAPSHOTS_FILE_NAME);
}

export function getEventsFilePath(stateDir: string): string {
  return path.join(getSnapshotsDir(stateDir), EVENTS_FILE_NAME);
}

export function buildStoragePath(snapshotId: string, fileHash: string): string {
  const hashPrefix = fileHash.slice(0, 2);
  return path.join(DATA_DIR_NAME, hashPrefix, `${snapshotId}.dat`);
}

export function generateSnapshotId(): string {
  return `snap-${crypto.randomUUID()}`;
}

export function computeFileHash(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function ensureSnapshotDirs(stateDir: string): Promise<void> {
  const snapshotsDir = getSnapshotsDir(stateDir);
  const dataDir = getDataDir(stateDir);
  
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  
  for (let i = 0; i < 256; i++) {
    const prefix = i.toString(16).padStart(2, "0");
    await fs.mkdir(path.join(dataDir, prefix), { recursive: true });
  }
}

export async function loadSnapshotIndex(stateDir: string): Promise<SnapshotIndex> {
  const indexPath = getIndexFilePath(stateDir);
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      stats: {
        totalSnapshots: 0,
        totalSizeBytes: 0,
        totalEvents: 0,
      },
    };
  }
}

export async function saveSnapshotIndex(stateDir: string, index: SnapshotIndex): Promise<void> {
  const indexPath = getIndexFilePath(stateDir);
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

export async function loadSnapshots(stateDir: string): Promise<Map<string, SnapshotRecord>> {
  const snapshotsPath = getSnapshotsFilePath(stateDir);
  try {
    const content = await fs.readFile(snapshotsPath, "utf-8");
    const data = JSON.parse(content);
    const map = new Map<string, SnapshotRecord>();
    for (const [id, record] of Object.entries(data.snapshots || {})) {
      map.set(id, record as SnapshotRecord);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveSnapshots(stateDir: string, snapshots: Map<string, SnapshotRecord>): Promise<void> {
  const snapshotsPath = getSnapshotsFilePath(stateDir);
  const data: Record<string, SnapshotRecord> = {};
  for (const [id, record] of snapshots) {
    data[id] = record;
  }
  await fs.writeFile(snapshotsPath, JSON.stringify({ snapshots: data }, null, 2), "utf-8");
}

export async function writeSnapshotContent(
  stateDir: string,
  storagePath: string,
  content: Buffer,
  compression: SnapshotCompression = "none"
): Promise<void> {
  const fullPath = path.join(getSnapshotsDir(stateDir), storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  
  if (compression === "gzip") {
    await pipeline(
      Readable.from(content),
      createGzip(),
      createWriteStream(fullPath)
    );
  } else {
    await fs.writeFile(fullPath, content);
  }
}

export async function readSnapshotContent(
  stateDir: string,
  storagePath: string,
  compression: SnapshotCompression = "none"
): Promise<Buffer> {
  const fullPath = path.join(getSnapshotsDir(stateDir), storagePath);
  
  if (compression === "gzip") {
    const chunks: Buffer[] = [];
    await pipeline(
      createReadStream(fullPath),
      createGunzip(),
      async function* (source) {
        for await (const chunk of source) {
          chunks.push(chunk);
        }
      }
    );
    return Buffer.concat(chunks);
  } else {
    return await fs.readFile(fullPath);
  }
}

export async function deleteSnapshotContent(
  stateDir: string,
  storagePath: string
): Promise<void> {
  const fullPath = path.join(getSnapshotsDir(stateDir), storagePath);
  try {
    await fs.rm(fullPath, { force: true });
  } catch {
    // Ignore errors if file doesn't exist
  }
}

export async function findSnapshotByHash(
  snapshots: Map<string, SnapshotRecord>,
  fileHash: string
): Promise<SnapshotRecord | undefined> {
  for (const record of snapshots.values()) {
    if (record.file_hash === fileHash) {
      return record;
    }
  }
  return undefined;
}

export async function getSnapshotStats(stateDir: string): Promise<{
  totalSnapshots: number;
  totalSizeBytes: number;
  totalEvents: number;
}> {
  const index = await loadSnapshotIndex(stateDir);
  return index.stats;
}

export async function calculateTotalStorageSize(stateDir: string): Promise<number> {
  const snapshots = await loadSnapshots(stateDir);
  let totalSize = 0;
  for (const record of snapshots.values()) {
    totalSize += record.size;
  }
  return totalSize;
}
