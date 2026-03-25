import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { SnapshotEvent, FileOperationType } from "../../types.js";
import { getSnapshotsDir, loadSnapshotIndex, saveSnapshotIndex } from "./storage.js";

const EVENTS_FILE_NAME = "events.jsonl";

export function getEventsFilePath(stateDir: string): string {
  return path.join(getSnapshotsDir(stateDir), EVENTS_FILE_NAME);
}

export function generateEventId(): string {
  return `evt-${crypto.randomUUID()}`;
}

export async function appendEvent(stateDir: string, event: SnapshotEvent): Promise<void> {
  const eventsPath = getEventsFilePath(stateDir);
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(eventsPath, line, "utf-8");
  
  const index = await loadSnapshotIndex(stateDir);
  index.stats.totalEvents++;
  await saveSnapshotIndex(stateDir, index);
}

export async function readAllEvents(stateDir: string): Promise<SnapshotEvent[]> {
  const eventsPath = getEventsFilePath(stateDir);
  try {
    const content = await fs.readFile(eventsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as SnapshotEvent);
  } catch {
    return [];
  }
}

export async function readEventsBySession(
  stateDir: string,
  sessionId: string
): Promise<SnapshotEvent[]> {
  const allEvents = await readAllEvents(stateDir);
  return allEvents.filter((e) => e.session_id === sessionId);
}

export async function readEventsByFilePath(
  stateDir: string,
  filePath: string
): Promise<SnapshotEvent[]> {
  const allEvents = await readAllEvents(stateDir);
  return allEvents.filter((e) => e.file_path === filePath);
}

export async function readEventsBeforeTime(
  stateDir: string,
  timestamp: string
): Promise<SnapshotEvent[]> {
  const allEvents = await readAllEvents(stateDir);
  return allEvents.filter((e) => e.timestamp <= timestamp);
}

export async function getLatestEventForFile(
  stateDir: string,
  filePath: string,
  beforeTime?: string
): Promise<SnapshotEvent | undefined> {
  const events = await readEventsByFilePath(stateDir, filePath);
  const filtered = beforeTime
    ? events.filter((e) => e.timestamp <= beforeTime)
    : events;
  
  if (filtered.length === 0) return undefined;
  
  return filtered.reduce((latest, current) => {
    return current.timestamp > latest.timestamp ? current : latest;
  });
}

export async function getFileStateAtTime(
  stateDir: string,
  filePath: string,
  timestamp: string
): Promise<{
  exists: boolean;
  operation: FileOperationType;
  snapshotId: string | null;
  event: SnapshotEvent | undefined;
}> {
  const events = await readEventsByFilePath(stateDir, filePath);
  const relevantEvents = events.filter((e) => e.timestamp <= timestamp);
  
  if (relevantEvents.length === 0) {
    return {
      exists: true,
      operation: "UPDATE",
      snapshotId: null,
      event: undefined,
    };
  }
  
  const latestEvent = relevantEvents.reduce((latest, current) => {
    return current.timestamp > latest.timestamp ? current : latest;
  });
  
  const exists = latestEvent.operation_type !== "DELETE";
  
  return {
    exists,
    operation: latestEvent.operation_type,
    snapshotId: latestEvent.snapshot_id,
    event: latestEvent,
  };
}

export async function getAllFilesAtTime(
  stateDir: string,
  timestamp: string
): Promise<Map<string, { operation: FileOperationType; snapshotId: string | null; event: SnapshotEvent }>> {
  const events = await readEventsBeforeTime(stateDir, timestamp);
  const fileStates = new Map<string, { operation: FileOperationType; snapshotId: string | null; event: SnapshotEvent }>();
  
  for (const event of events) {
    const existing = fileStates.get(event.file_path);
    if (!existing || event.timestamp > existing.event.timestamp) {
      fileStates.set(event.file_path, {
        operation: event.operation_type,
        snapshotId: event.snapshot_id,
        event,
      });
    }
  }
  
  for (const [filePath, state] of fileStates) {
    if (state.operation === "DELETE") {
      fileStates.delete(filePath);
    }
  }
  
  return fileStates;
}

export async function getEventsForRollback(
  stateDir: string,
  options: {
    sessionId?: string;
    timestamp?: string;
    filePaths?: string[];
  }
): Promise<SnapshotEvent[]> {
  let events = await readAllEvents(stateDir);
  
  if (options.sessionId) {
    events = events.filter((e) => e.session_id === options.sessionId);
  }
  
  if (options.timestamp) {
    events = events.filter((e) => e.timestamp <= options.timestamp!);
  }
  
  if (options.filePaths && options.filePaths.length > 0) {
    const filePathSet = new Set(options.filePaths);
    events = events.filter((e) => filePathSet.has(e.file_path));
  }
  
  return events;
}

export async function deleteEventsBySnapshotId(
  stateDir: string,
  snapshotId: string
): Promise<number> {
  const events = await readAllEvents(stateDir);
  const remaining = events.filter((e) => e.snapshot_id !== snapshotId);
  
  if (remaining.length !== events.length) {
    const eventsPath = getEventsFilePath(stateDir);
    const content = remaining.map((e) => JSON.stringify(e)).join("\n");
    await fs.writeFile(eventsPath, content + (content ? "\n" : ""), "utf-8");
    
    const index = await loadSnapshotIndex(stateDir);
    index.stats.totalEvents = remaining.length;
    await saveSnapshotIndex(stateDir, index);
  }
  
  return events.length - remaining.length;
}

export async function getSessionFileRecords(
  stateDir: string,
  sessionId: string
): Promise<Map<string, SnapshotEvent>> {
  const events = await readEventsBySession(stateDir, sessionId);
  const fileRecords = new Map<string, SnapshotEvent>();
  
  for (const event of events) {
    if (!fileRecords.has(event.file_path)) {
      fileRecords.set(event.file_path, event);
    }
  }
  
  return fileRecords;
}
