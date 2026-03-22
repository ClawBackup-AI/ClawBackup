import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { StorageBackendInterface } from "../types.js";

export class LocalStorageBackend implements StorageBackendInterface {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  private validateKey(key: string): void {
    if (path.isAbsolute(key)) {
      throw new Error(`Invalid key: absolute paths are not allowed`);
    }

    const normalized = path.normalize(key);
    if (normalized.startsWith("..")) {
      throw new Error(`Invalid key: path traversal detected`);
    }

    const resolved = path.resolve(this.basePath, key);
    if (!resolved.startsWith(this.basePath + path.sep) && resolved !== this.basePath) {
      throw new Error(`Invalid key: path escapes storage directory`);
    }
  }

  async put(key: string, data: Buffer): Promise<string> {
    this.validateKey(key);
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async putStream(key: string, sourcePath: string): Promise<boolean> {
    this.validateKey(key);
    const targetPath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(targetPath);
    await pipeline(readStream, writeStream);
    return true;
  }

  async get(key: string): Promise<Buffer | null> {
    this.validateKey(key);
    const filePath = path.join(this.basePath, key);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getStream(key: string, targetPath: string): Promise<boolean> {
    this.validateKey(key);
    const sourcePath = path.join(this.basePath, key);
    try {
      await fs.access(sourcePath);
    } catch {
      return false;
    }
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(targetPath);
    await pipeline(readStream, writeStream);
    return true;
  }

  async list(prefix?: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await fs.readdir(this.basePath, { recursive: true });
      for (const entry of entries) {
        if (typeof entry !== "string") continue;
        if (prefix && !entry.startsWith(prefix)) continue;
        files.push(entry);
      }
    } catch {
    }
    return files;
  }

  async delete(key: string): Promise<void> {
    this.validateKey(key);
    const filePath = path.join(this.basePath, key);
    await fs.unlink(filePath).catch(() => {});
  }
}
