import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { createReadStream, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import type { StorageBackendInterface } from "../types.js";

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  maxRetries?: number;
  timeout?: number;
  partSize?: number;
}

const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 30000;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  operation: string,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("ETIMEDOUT") ||
        lastError.message.includes("ENOTFOUND") ||
        lastError.message.includes("SlowDown") ||
        lastError.message.includes("503");
      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError!;
}

export class S3StorageBackend implements StorageBackendInterface {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private maxRetries: number;
  private timeout: number;
  private partSize: number;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix || "clawbackup/";
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.partSize = config.partSize ?? DEFAULT_PART_SIZE;

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestHandler: {
        requestTimeout: this.timeout,
      },
    });
  }

  async put(key: string, data: Buffer): Promise<string> {
    const objectKey = this.getObjectKey(key);
    await withRetry(
      async () => {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            Body: data,
          }),
        );
      },
      this.maxRetries,
      `put ${key}`,
    );
    return `s3://${this.bucket}/${objectKey}`;
  }

  async putStream(key: string, filePath: string): Promise<boolean> {
    const objectKey = this.getObjectKey(key);
    const stats = statSync(filePath);
    const fileSize = stats.size;

    if (fileSize <= this.partSize) {
      const data = await fs.readFile(filePath);
      await this.put(key, data);
      return true;
    }

    const uploadId = await withRetry(
      async () => {
        const response = await this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: objectKey,
          }),
        );
        return response.UploadId!;
      },
      this.maxRetries,
      `createMultipartUpload ${key}`,
    );

    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    let partNumber = 1;
    let position = 0;

    try {
      const fd = await fs.open(filePath, "r");

      try {
        while (position < fileSize) {
          const chunkSize = Math.min(this.partSize, fileSize - position);
          const buffer = Buffer.alloc(chunkSize);
          await fd.read(buffer, 0, chunkSize, position);

          const part = await withRetry(
            async () => {
              const response = await this.client.send(
                new UploadPartCommand({
                  Bucket: this.bucket,
                  Key: objectKey,
                  PartNumber: partNumber,
                  UploadId: uploadId,
                  Body: buffer,
                }),
              );
              return { PartNumber: partNumber, ETag: response.ETag! };
            },
            this.maxRetries,
            `uploadPart ${key} part ${partNumber}`,
          );

          parts.push(part);
          partNumber++;
          position += chunkSize;
        }
      } finally {
        await fd.close();
      }

      await withRetry(
        async () => {
          await this.client.send(
            new CompleteMultipartUploadCommand({
              Bucket: this.bucket,
              Key: objectKey,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            }),
          );
        },
        this.maxRetries,
        `completeMultipartUpload ${key}`,
      );

      return true;
    } catch (err) {
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: objectKey,
            UploadId: uploadId,
          }),
        );
      } catch {
        // ignore abort errors
      }
      throw err;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const objectKey = this.getObjectKey(key);
    try {
      return await withRetry(
        async () => {
          const response = await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: objectKey,
            }),
          );
          if (!response.Body) {
            return null;
          }
          const byteArray = await response.Body.transformToByteArray();
          return Buffer.from(byteArray);
        },
        this.maxRetries,
        `get ${key}`,
      );
    } catch (err) {
      const code = (err as { Code?: string; name?: string })?.Code ?? (err as Error).name;
      if (code === "NoSuchKey" || code === "NotFound") {
        return null;
      }
      throw err;
    }
  }

  async getStream(key: string, targetPath: string): Promise<boolean> {
    const objectKey = this.getObjectKey(key);
    try {
      const { createWriteStream } = await import("node:fs");
      const { pipeline } = await import("node:stream/promises");
      
      const response = await withRetry(
        async () => {
          return await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: objectKey,
            }),
          );
        },
        this.maxRetries,
        `getStream ${key}`,
      );
      
      if (!response.Body) {
        return false;
      }
      
      const writeStream = createWriteStream(targetPath);
      const readableStream = response.Body as NodeJS.ReadableStream;
      
      await pipeline(readableStream, writeStream);
      return true;
    } catch (err) {
      const code = (err as { Code?: string; name?: string })?.Code ?? (err as Error).name;
      if (code === "NoSuchKey" || code === "NotFound") {
        return false;
      }
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const objectPrefix = prefix ? this.getObjectKey(prefix) : this.prefix;
    const files: string[] = [];
    let continuationToken: string | undefined;

    await withRetry(
      async () => {
        do {
          const response = await this.client.send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: objectPrefix,
              ContinuationToken: continuationToken,
            }),
          );

          if (response.Contents) {
            for (const object of response.Contents) {
              if (object.Key) {
                files.push(object.Key.replace(this.prefix, ""));
              }
            }
          }

          continuationToken = response.NextContinuationToken;
        } while (continuationToken);
      },
      this.maxRetries,
      `list ${prefix}`,
    );

    return files;
  }

  async delete(key: string): Promise<void> {
    const objectKey = this.getObjectKey(key);
    await withRetry(
      async () => {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
          }),
        );
      },
      this.maxRetries,
      `delete ${key}`,
    );
  }

  private getObjectKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
