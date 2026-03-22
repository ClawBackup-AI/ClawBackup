import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { OpenClawConfig, PluginLogger } from "openclaw/plugin-sdk";
import { listStorageBackends, addStorageBackend, removeStorageBackend } from "../core/storage.js";
import type { StorageBackend } from "../types.js";

export async function backendsCommand(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const backends = await listStorageBackends(ctx);

  console.log("\nConfigured storage backends:\n");

  for (const backend of backends) {
    const defaultTag = backend.isDefault ? " (default)" : "";
    console.log(`  [${backend.backendId}] ${backend.name} (${backend.backendType})${defaultTag}`);

    if (backend.backendType === "local") {
      console.log(`      Path: default`);
    } else if (backend.backendType === "s3") {
      console.log(`      Bucket: ${backend.config.bucket || "Not configured"}`);
      console.log(`      Region: ${backend.config.region || "Default"}`);
      if (backend.config.endpoint) {
        console.log(`      Endpoint: ${backend.config.endpoint}`);
      }
    }
  }

  console.log("\nUse 'clawbackup backends add' to add a new storage backend");
  console.log("Use 'clawbackup backends remove <id>' to remove a storage backend\n");
}

export async function backendsAddCommand(
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\nAdd new storage backend\n");

    const backendType = await rl.question("Storage type (s3): ");
    
    if (backendType.toLowerCase() !== "s3") {
      console.log("Currently only S3 storage backend is supported");
      rl.close();
      return;
    }

    const name = await rl.question("Display name (e.g., My S3 Storage): ");
    const endpoint = await rl.question("Endpoint (e.g., https://s3.amazonaws.com, optional): ");
    const region = await rl.question("Region (e.g., us-east-1, default us-east-1): ");
    const bucket = await rl.question("Bucket name (required): ");
    const accessKeyId = await rl.question("Access Key ID (required): ");
    const secretAccessKey = await rl.question("Secret Access Key (required): ");
    const prefix = await rl.question("Storage prefix (optional): ");
    const setDefault = await rl.question("Set as default storage backend? (y/N): ");

    if (!bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      console.log("\nError: Bucket name, Access Key ID, and Secret Access Key are required");
      rl.close();
      return;
    }

    const newBackend: Omit<StorageBackend, "backendId"> = {
      backendType: "s3",
      name: name.trim() || "S3 Storage",
      config: {
        endpoint: endpoint.trim() || undefined,
        region: region.trim() || "us-east-1",
        bucket: bucket.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        prefix: prefix.trim() || undefined,
      },
      isDefault: setDefault.toLowerCase() === "y",
    };

    const added = await addStorageBackend(newBackend, ctx);
    console.log(`\nStorage backend added: ${added.name} (${added.backendId})\n`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`\nFailed to add: ${errorMessage}\n`);
  } finally {
    rl.close();
  }
}

export async function backendsRemoveCommand(
  backendId: string,
  ctx: { config: OpenClawConfig; logger: PluginLogger; stateDir: string },
): Promise<void> {
  try {
    await removeStorageBackend(backendId, ctx);
    console.log(`\nStorage backend removed: ${backendId}\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`\nFailed to remove: ${errorMessage}\n`);
  }
}
