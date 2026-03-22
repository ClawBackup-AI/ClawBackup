import * as crypto from "node:crypto";

export function generateBackupId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString("hex");
  return `bak_${timestamp.toString(16)}-${random}`;
}

export async function computeHash(data: Buffer): Promise<string> {
  return crypto.createHash("sha256").update(data).digest("hex");
}
