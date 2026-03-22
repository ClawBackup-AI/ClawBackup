import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import type { StorageBackend, StorageBackendInterface } from "../types.js";
import { LocalStorageBackend } from "./storage/local.js";
import { S3StorageBackend, type S3StorageConfig } from "./storage/s3.js";

import { getPluginConfig } from "./config.js";

import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

const DEFAULT_BACKUP_DIR_NAME = "clawbackups";
const BACKENDS_CONFIG_FILE_NAME = "backends.json";
const ENCRYPTION_KEY_FILE_NAME = ".encryption_key";
const ENCRYPTION_KEY_ENV = "CLAWBACKUP_ENCRYPTION_KEY";
const SENSITIVE_FIELDS = ["accessKeyId", "secretAccessKey", "password"];

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const AUTH_TAG_LENGTH = 16;

function getBackupDir(stateDir: string): string {
  return path.join(stateDir, DEFAULT_BACKUP_DIR_NAME);
}

function getBackendsConfigFile(stateDir: string): string {
  return path.join(getBackupDir(stateDir), BACKENDS_CONFIG_FILE_NAME);
}

function getEncryptionKeyFile(stateDir: string): string {
  return path.join(getBackupDir(stateDir), ENCRYPTION_KEY_FILE_NAME);
}

const encryptionKeyCache = new Map<string, string>();

async function getEncryptionKey(stateDir: string): Promise<string> {
  const cached = encryptionKeyCache.get(stateDir);
  if (cached) {
    return cached;
  }
  const envKey = process.env[ENCRYPTION_KEY_ENV];
  if (envKey) {
    encryptionKeyCache.set(stateDir, envKey);
    return envKey;
  }
  const keyFile = getEncryptionKeyFile(stateDir);
  try {
    const savedKey = await fs.readFile(keyFile, "utf8");
    const key = savedKey.trim();
    encryptionKeyCache.set(stateDir, key);
    return key;
  } catch {
    const newKey = crypto.randomBytes(KEY_LENGTH).toString("hex");
    const backupDir = getBackupDir(stateDir);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(keyFile, newKey, { mode: 0o600 });
    encryptionKeyCache.set(stateDir, newKey);
    return newKey;
  }
}
function encryptSensitiveData(data: string, key: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derivedKey = crypto.pbkdf2Sync(
    Buffer.from(key, "utf8"),
    salt,
    100000,
    KEY_LENGTH,
    "sha512",
  );
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    derivedKey,
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(data, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const result = Buffer.concat([
    salt,
    iv,
    authTag,
    encrypted,
  ]);
  return `enc:${result.toString("base64")}`;
}
function decryptSensitiveData(encryptedData: string, key: string): string {
  if (!encryptedData.startsWith("enc:")) {
    return encryptedData;
  }
  const data = Buffer.from(encryptedData.slice(4), "base64");
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const derivedKey = crypto.pbkdf2Sync(
    Buffer.from(key, "utf8"),
    salt,
    100000,
    KEY_LENGTH,
    "sha512",
  );
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    derivedKey,
    iv,
  );
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
function encryptBackendConfig(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.includes(field) && typeof value === "string") {
      result[field] = encryptSensitiveData(value, key);
    } else {
      result[field] = value;
    }
  }
  return result;
}
function decryptBackendConfig(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.includes(field) && typeof value === "string") {
      try {
        result[field] = decryptSensitiveData(value, key);
      } catch {
        result[field] = value;
      }
    } else {
      result[field] = value;
    }
  }
  return result;
}
interface BackendsConfig {
  schemaVersion: number;
  backends: StorageBackend[];
  encrypted?: boolean;
}
async function loadBackendsConfig(stateDir: string): Promise<BackendsConfig> {
  const configFile = getBackendsConfigFile(stateDir);
  const encryptionKey = await getEncryptionKey(stateDir);
  try {
    const data = await fs.readFile(configFile, "utf8");
    const parsed = JSON.parse(data);
    if (parsed.encrypted) {
      for (const backend of parsed.backends) {
        backend.config = decryptBackendConfig(backend.config, encryptionKey);
      }
    }
    return parsed;
  } catch {
    return {
      schemaVersion: 1,
      backends: [
        {
          backendId: "local",
          backendType: "local",
          name: "Local Storage",
          config: {},
          isDefault: true,
        },
      ],
    };
  }
}
async function saveBackendsConfig(stateDir: string, config: BackendsConfig): Promise<void> {
  const backupDir = getBackupDir(stateDir);
  const configFile = getBackendsConfigFile(stateDir);
  const encryptionKey = await getEncryptionKey(stateDir);
  const configToSave: BackendsConfig = {
    ...config,
    encrypted: true,
    backends: config.backends.map((backend) => ({
      ...backend,
      config: encryptBackendConfig(backend.config, encryptionKey),
    })),
  };
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(configToSave, null, 2), "utf8");
}
export async function listStorageBackends(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<StorageBackend[]> {
  const backendsConfig = await loadBackendsConfig(ctx.stateDir);
  return backendsConfig.backends;
}
export async function addStorageBackend(
  backend: Omit<StorageBackend, "backendId">,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<StorageBackend> {
  const { config, logger, stateDir } = ctx;
  const backendsConfig = await loadBackendsConfig(stateDir);
  const pluginConfig = getPluginConfig(config);
  const backendId = `backend_${Date.now().toString(16)}`;
  const newBackend: StorageBackend = {
    ...backend,
    backendId,
  };
  if (newBackend.isDefault) {
    for (const b of backendsConfig.backends) {
      b.isDefault = false;
    }
  }
  if (backend.backendType === "s3") {
    logger.info("Validating S3 connection...");
    try {
      await testS3Connection(newBackend.config);
      logger.info("S3 connection validated successfully");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`S3 connection validation failed: ${errorMsg}`);
    }
  }
  backendsConfig.backends.push(newBackend);
  await saveBackendsConfig(stateDir, backendsConfig);
  logger.info(`Storage backend added: ${newBackend.name} (${newBackend.backendId})`);
  return newBackend;
}
async function testS3Connection(config: Record<string, unknown>): Promise<void> {
  const endpoint = config.endpoint as string | undefined;
  const region = (config.region as string) || "us-east-1";
  const bucket = config.bucket as string;
  const accessKeyId = config.accessKeyId as string;
  const secretAccessKey = config.secretAccessKey as string;
  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}
export async function removeStorageBackend(
  backendId: string,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const { config, logger, stateDir } = ctx;
  const backendsConfig = await loadBackendsConfig(stateDir);
  const index = backendsConfig.backends.findIndex((b) => b.backendId === backendId);
  if (index === -1) {
    throw new Error(`Storage backend not found: ${backendId}`);
  }
  const removed = backendsConfig.backends.splice(index, 1)[0];
  await saveBackendsConfig(stateDir, backendsConfig);
  logger.info(`Storage backend removed: ${removed.name} (${backendId})`);
}
export async function getStorageBackend(
  backendId: string,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<StorageBackendInterface> {
  const backendsConfig = await loadBackendsConfig(ctx.stateDir);
  const backend = backendsConfig.backends.find(
    (b) => b.backendId === backendId || (backendId === "local" && b.backendType === "local")
  );
  if (!backend) {
    throw new Error(`Storage backend not found: ${backendId}`);
  }
  return createStorageBackend(backend, ctx.stateDir);
}
export async function getDefaultStorageBackend(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<StorageBackendInterface> {
  const backendsConfig = await loadBackendsConfig(ctx.stateDir);
  const defaultBackend = backendsConfig.backends.find((b) => b.isDefault) || backendsConfig.backends[0];
  if (!defaultBackend) {
    return new LocalStorageBackend(getBackupDir(ctx.stateDir));
  }
  return createStorageBackend(defaultBackend, ctx.stateDir);
}
function createStorageBackend(backend: StorageBackend, stateDir: string): StorageBackendInterface {
  switch (backend.backendType) {
    case "local":
      return new LocalStorageBackend(getBackupDir(stateDir));
    case "s3": {
      const bucket = backend.config.bucket as string | undefined;
      const accessKeyId = backend.config.accessKeyId as string | undefined;
      const secretAccessKey = backend.config.secretAccessKey as string | undefined;
      const missingFields: string[] = [];
      if (!bucket) missingFields.push("bucket (Bucket name)");
      if (!accessKeyId) missingFields.push("accessKeyId (Access Key ID)");
      if (!secretAccessKey) missingFields.push("secretAccessKey (Secret Access Key)");
      if (missingFields.length > 0) {
        throw new Error(`S3 storage backend configuration missing required fields: ${missingFields.join(", ")}`);
      }
      return new S3StorageBackend({
        endpoint: backend.config.endpoint as string,
        region: (backend.config.region as string) || "us-east-1",
        bucket: bucket!,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        prefix: backend.config.prefix as string,
      });
    }
    default:
      throw new Error(`Unsupported storage backend type: ${backend.backendType}`);
  }
}
