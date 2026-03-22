import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { StorageBackendInterface } from "../types.js";

export class LocalStorageBackend implements StorageBackendInterface {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async putStream(key: string, sourcePath: string): Promise<boolean> {
    const targetPath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(targetPath);
    await pipeline(readStream, writeStream);
    return true;
  }

  async get(key: string): Promise<Buffer | null> {
    if (path.isAbsolute(key)) {
      try {
        return await fs.readFile(key);
      } catch {
        return null;
      }
    }
    const filePath = path.join(this.basePath, key);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getStream(key: string, targetPath: string): Promise<boolean> {
    let sourcePath: string;
    if (path.isAbsolute(key)) {
      sourcePath = key;
    } else {
      sourcePath = path.join(this.basePath, key);
    }
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
    if (path.isAbsolute(key)) {
      await fs.unlink(key).catch(() => {});
      return;
    }
    const filePath = path.join(this.basePath, key);
    await fs.unlink(filePath).catch(() => {});
  }
}
