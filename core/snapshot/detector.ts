import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { DetectedFileOperation, FileOperationType } from "../../types.js";

const PATH_PARAM_KEYS = [
  "path",
  "filePath",
  "file_path",
  "targetFile",
  "target_file",
  "output",
  "destination",
  "dest",
];

const PATCH_FILE_MARKERS = {
  ADD_FILE: "*** Add File: ",
  DELETE_FILE: "*** Delete File: ",
  UPDATE_FILE: "*** Update File: ",
  MOVE_TO: "*** Move to: ",
};

export interface DetectOperationsOptions {
  toolName: string;
  params: Record<string, unknown>;
  cwd?: string;
  workspaceDir?: string;
}

export async function detectFileOperations(
  options: DetectOperationsOptions
): Promise<DetectedFileOperation[]> {
  const { toolName, params, cwd, workspaceDir } = options;
  const operations: DetectedFileOperation[] = [];
  
  switch (toolName) {
    case "apply_patch":
      operations.push(...detectPatchOperations(params, cwd, workspaceDir));
      break;
      
    case "write_file":
    case "write":
      operations.push(...await detectWriteFileOperations(params, cwd, workspaceDir));
      break;
      
    case "edit_file":
    case "edit":
      operations.push(...await detectEditFileOperations(params, cwd, workspaceDir));
      break;
      
    case "delete_file":
    case "delete":
    case "remove_file":
    case "remove":
      operations.push(...await detectDeleteFileOperations(params, cwd, workspaceDir));
      break;
      
    case "rename_file":
    case "rename":
    case "move_file":
    case "move":
      operations.push(...await detectRenameFileOperations(params, cwd, workspaceDir));
      break;
      
    case "bash":
      operations.push(...await detectBashFileOperations(params, cwd, workspaceDir));
      break;
      
    case "gateway":
      operations.push(...await detectGatewayOperations(params, workspaceDir));
      break;
      
    case "memory":
      operations.push(...await detectMemoryOperations(params, workspaceDir));
      break;
      
    default:
      break;
  }
  
  return deduplicateOperations(operations);
}

function extractFilePath(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveFilePath(rawPath: string, cwd?: string, workspaceDir?: string): string {
  let resolved = rawPath;
  
  if (!path.isAbsolute(resolved)) {
    const basePath = workspaceDir || cwd || process.cwd();
    resolved = path.resolve(basePath, resolved);
  }
  
  return path.normalize(resolved);
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在或无法访问
  }
  
  return files;
}

function detectPatchOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): DetectedFileOperation[] {
  const operations: DetectedFileOperation[] = [];
  const input = params.input || params.patch || params.content;
  
  if (typeof input !== "string") {
    return operations;
  }
  
  const lines = input.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    
    if (line.startsWith(PATCH_FILE_MARKERS.ADD_FILE)) {
      const filePath = line.slice(PATCH_FILE_MARKERS.ADD_FILE.length).trim();
      if (filePath) {
        operations.push({
          filePath: resolveFilePath(filePath, cwd, workspaceDir),
          operationType: "CREATE",
        });
      }
    } else if (line.startsWith(PATCH_FILE_MARKERS.DELETE_FILE)) {
      const filePath = line.slice(PATCH_FILE_MARKERS.DELETE_FILE.length).trim();
      if (filePath) {
        operations.push({
          filePath: resolveFilePath(filePath, cwd, workspaceDir),
          operationType: "DELETE",
        });
      }
    } else if (line.startsWith(PATCH_FILE_MARKERS.UPDATE_FILE)) {
      const filePath = line.slice(PATCH_FILE_MARKERS.UPDATE_FILE.length).trim();
      if (filePath) {
        let originalPath: string | undefined;
        
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1]!.trim();
          if (nextLine.startsWith(PATCH_FILE_MARKERS.MOVE_TO)) {
            originalPath = filePath;
          }
        }
        
        operations.push({
          filePath: resolveFilePath(filePath, cwd, workspaceDir),
          operationType: "UPDATE",
          originalPath: originalPath ? resolveFilePath(originalPath, cwd, workspaceDir) : undefined,
        });
      }
    }
  }
  
  return operations;
}

async function detectWriteFileOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const filePath = extractFilePath(params, PATH_PARAM_KEYS);
  
  if (!filePath) {
    return operations;
  }
  
  const resolvedPath = resolveFilePath(filePath, cwd, workspaceDir);
  
  try {
    await fs.access(resolvedPath);
    operations.push({ filePath: resolvedPath, operationType: "UPDATE" });
  } catch {
    operations.push({ filePath: resolvedPath, operationType: "CREATE" });
  }
  
  return operations;
}

async function detectEditFileOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const filePath = extractFilePath(params, PATH_PARAM_KEYS);
  
  if (!filePath) {
    return operations;
  }
  
  const resolvedPath = resolveFilePath(filePath, cwd, workspaceDir);
  operations.push({ filePath: resolvedPath, operationType: "UPDATE" });
  
  return operations;
}

async function detectDeleteFileOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const filePath = extractFilePath(params, PATH_PARAM_KEYS);
  
  if (!filePath) {
    return operations;
  }
  
  const resolvedPath = resolveFilePath(filePath, cwd, workspaceDir);
  
  try {
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      const files = await listFilesRecursively(resolvedPath);
      for (const file of files) {
        operations.push({ filePath: file, operationType: "DELETE" });
      }
    } else {
      operations.push({ filePath: resolvedPath, operationType: "DELETE" });
    }
  } catch {
    operations.push({ filePath: resolvedPath, operationType: "DELETE" });
  }
  
  return operations;
}

async function detectRenameFileOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  
  const sourcePath = extractFilePath(params, ["source", "sourcePath", "source_path", "from", "oldPath", "old_path"]);
  const destPath = extractFilePath(params, ["destination", "destinationPath", "destination_path", "to", "newPath", "new_path", "target", "targetPath"]);
  
  if (sourcePath && destPath) {
    const resolvedSource = resolveFilePath(sourcePath, cwd, workspaceDir);
    const resolvedDest = resolveFilePath(destPath, cwd, workspaceDir);
    
    try {
      const sourceStats = await fs.stat(resolvedSource);
      if (sourceStats.isDirectory()) {
        const files = await listFilesRecursively(resolvedSource);
        for (const file of files) {
          const relativePath = path.relative(resolvedSource, file);
          const destFile = path.join(resolvedDest, relativePath);
          operations.push({ filePath: file, operationType: "DELETE" });
          operations.push({ filePath: destFile, operationType: "CREATE", originalPath: file });
        }
      } else {
        operations.push({ filePath: resolvedSource, operationType: "DELETE" });
        operations.push({ filePath: resolvedDest, operationType: "CREATE", originalPath: resolvedSource });
      }
    } catch {
      operations.push({ filePath: resolvedSource, operationType: "DELETE" });
      operations.push({ filePath: resolvedDest, operationType: "CREATE", originalPath: resolvedSource });
    }
  }
  
  return operations;
}

async function detectBashFileOperations(
  params: Record<string, unknown>,
  cwd?: string,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const command = params.command || params.cmd || params.script;
  
  if (typeof command !== "string") {
    return operations;
  }
  
  const writePatterns = [
    />\s*([^\s>&|]+)/g,
    />>\s*([^\s>&|]+)/g,
  ];
  
  for (const pattern of writePatterns) {
    const matches = command.matchAll(pattern);
    for (const match of matches) {
      const filePath = match[1];
      if (filePath && !filePath.startsWith("&") && !filePath.startsWith("|")) {
        const resolvedPath = resolveFilePath(filePath, cwd, workspaceDir);
        operations.push({ filePath: resolvedPath, operationType: "UPDATE" });
      }
    }
  }
  
  const rmMatch = command.match(/\brm\s+(-[rf]+\s+)?(["']?)([^\s"'&|]+)\2/);
  if (rmMatch) {
    const filePath = rmMatch[3];
    const hasRecursive = rmMatch[1]?.includes("r") || rmMatch[1]?.includes("R");
    if (filePath) {
      const resolvedPath = resolveFilePath(filePath, cwd, workspaceDir);
      
      if (hasRecursive) {
        try {
          const stats = await fs.stat(resolvedPath);
          if (stats.isDirectory()) {
            const files = await listFilesRecursively(resolvedPath);
            for (const file of files) {
              operations.push({ filePath: file, operationType: "DELETE" });
            }
          } else {
            operations.push({ filePath: resolvedPath, operationType: "DELETE" });
          }
        } catch {
          operations.push({ filePath: resolvedPath, operationType: "DELETE" });
        }
      } else {
        operations.push({ filePath: resolvedPath, operationType: "DELETE" });
      }
    }
  }
  
  const mvMatch = command.match(/\bmv\s+(["']?)([^\s"'&|]+)\1\s+(["']?)([^\s"'&|]+)\3/);
  if (mvMatch) {
    const sourcePath = mvMatch[2];
    const destPath = mvMatch[4];
    if (sourcePath && destPath) {
      const resolvedSource = resolveFilePath(sourcePath, cwd, workspaceDir);
      const resolvedDest = resolveFilePath(destPath, cwd, workspaceDir);
      
      try {
        const sourceStats = await fs.stat(resolvedSource);
        if (sourceStats.isDirectory()) {
          const files = await listFilesRecursively(resolvedSource);
          for (const file of files) {
            const relativePath = path.relative(resolvedSource, file);
            const destFile = path.join(resolvedDest, relativePath);
            operations.push({ filePath: file, operationType: "DELETE" });
            operations.push({ filePath: destFile, operationType: "CREATE", originalPath: file });
          }
        } else {
          operations.push({ filePath: resolvedSource, operationType: "DELETE" });
          operations.push({ filePath: resolvedDest, operationType: "CREATE", originalPath: resolvedSource });
        }
      } catch {
        operations.push({ filePath: resolvedSource, operationType: "DELETE" });
        operations.push({ filePath: resolvedDest, operationType: "CREATE", originalPath: resolvedSource });
      }
    }
  }
  
  const cpMatch = command.match(/\bcp\s+(["']?)([^\s"'&|]+)\1\s+(["']?)([^\s"'&|]+)\3/);
  if (cpMatch) {
    const destPath = cpMatch[4];
    if (destPath) {
      const resolvedDest = resolveFilePath(destPath, cwd, workspaceDir);
      operations.push({ filePath: resolvedDest, operationType: "CREATE" });
    }
  }
  
  return operations;
}

async function detectGatewayOperations(
  params: Record<string, unknown>,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const action = params.action || params.method;
  
  if (action === "config.patch" || action === "config.apply") {
    const stateDir = workspaceDir ? path.join(workspaceDir, ".openclaw") : 
      process.env.OPENCLAW_STATE_DIR || path.join(require("node:os").homedir(), ".openclaw");
    const configPath = path.join(stateDir, "config.json");
    operations.push({ filePath: configPath, operationType: "UPDATE" });
  }
  
  return operations;
}

async function detectMemoryOperations(
  params: Record<string, unknown>,
  workspaceDir?: string
): Promise<DetectedFileOperation[]> {
  const operations: DetectedFileOperation[] = [];
  const action = params.action || params.method;
  
  if (action === "save" || action === "update" || action === "delete") {
    const stateDir = workspaceDir ? path.join(workspaceDir, ".openclaw") :
      process.env.OPENCLAW_STATE_DIR || path.join(require("node:os").homedir(), ".openclaw");
    const memoryPath = path.join(stateDir, "memory", "memory.json");
    operations.push({ filePath: memoryPath, operationType: "UPDATE" });
  }
  
  return operations;
}

function deduplicateOperations(operations: DetectedFileOperation[]): DetectedFileOperation[] {
  const seen = new Map<string, DetectedFileOperation>();
  
  for (const op of operations) {
    const existing = seen.get(op.filePath);
    if (!existing) {
      seen.set(op.filePath, op);
    } else {
      if (op.operationType === "DELETE") {
        seen.set(op.filePath, op);
      } else if (existing.operationType === "CREATE" && op.operationType === "UPDATE") {
        seen.set(op.filePath, { ...op, operationType: "CREATE" });
      }
    }
  }
  
  return Array.from(seen.values());
}

export function isFileModificationTool(toolName: string): boolean {
  const modificationTools = [
    "apply_patch",
    "write_file", "write",
    "edit_file", "edit",
    "delete_file", "delete", "remove_file", "remove",
    "rename_file", "rename", "move_file", "move",
    "bash",
    "gateway",
    "memory",
  ];
  
  return modificationTools.includes(toolName);
}
