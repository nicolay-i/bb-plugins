// Files attached to chat messages, opened in Doc Review. bb keeps an attached
// file in the project's attachment store, and its chip in the chat opens a
// built-in preview no plugin can take over. So the panel lists a thread's
// attachments, and the one the user picks is copied into the thread's
// storage, where Doc Review opens it like any stored file and the agent can
// read and change it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { joinPath, type DocFiles } from "./files.js";
import { docKindFor } from "./types.js";

/** Where in the thread's storage the copies go. */
export const COPY_FOLDER = "Doc Review";
/** Messages looked through for attachments, newest first (bb lists at most 100 events at a time). */
const MESSAGES_SCANNED = 100;
/** The largest attachment copied for review. */
const COPY_MAX_BYTES = 64 * 1024 * 1024;

export interface AttachedFile {
  /** The name the file was attached under. */
  name: string;
  /** Its stored name in the project's attachments. */
  path: string;
  /** Whether Doc Review opens files of this kind. */
  supported: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A stored name bb gave an attachment: one path segment, nothing that climbs. */
function isStoredName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[/\\\u0000]/.test(value) && value !== "." && value !== "..";
}

function fileOf(name: unknown, stored: unknown): AttachedFile | null {
  if (!isStoredName(stored)) return null;
  const shown = typeof name === "string" && name.trim() ? name.trim() : stored;
  return { name: shown, path: stored, supported: docKindFor(shown) !== null || docKindFor(stored) !== null };
}

/** The files a turn request carries: `localFile` inputs stored with the project. */
export function filesInInput(input: unknown): AttachedFile[] {
  if (!Array.isArray(input)) return [];
  const files: AttachedFile[] = [];
  for (const item of input) {
    const entry = asRecord(item);
    if (entry?.type !== "localFile") continue;
    const file = fileOf(entry.name, entry.path);
    if (file) files.push(file);
  }
  return files;
}

/** The files on a message as `threads.message` returns it. */
export function filesOnMessage(message: unknown): AttachedFile[] {
  const details = asRecord(asRecord(message)?.attachments)?.localFileDetails;
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail) => {
    const entry = asRecord(detail);
    const file = entry ? fileOf(entry.name, entry.path) : null;
    return file ? [file] : [];
  });
}

/** A file name safe to put in a folder: no separators or control characters. */
export function copyName(name: string): string {
  const cleaned = name
    .replace(/[/\\\u0000-\u001f\u007f]+/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(-200);
  return cleaned || "attachment";
}

/** `deck.pptx`, `deck (2).pptx`, `deck (3).pptx`, … */
export function numbered(name: string, n: number): string {
  if (n < 2) return name;
  const ext = path.posix.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
}

export function createAttachments(deps: { bb: BbPluginApi; files: DocFiles }) {
  const { bb, files } = deps;

  /**
   * The thread's attachments, newest first; with `seq`, the ones on that
   * message (a message the history no longer lists falls back to all).
   */
  async function list(threadId: string, seq: number | null): Promise<AttachedFile[]> {
    if (seq !== null) {
      const found = await bb.sdk.threads.message({ threadId, seq }).catch(() => null);
      const onMessage = filesOnMessage(found?.message);
      if (onMessage.length > 0) return onMessage;
    }
    const events = await bb.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "desc",
      limit: String(MESSAGES_SCANNED),
    });
    const seen = new Set<string>();
    const all: AttachedFile[] = [];
    for (const event of events) {
      for (const file of filesInInput(asRecord(event.data)?.input)) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        all.push(file);
      }
    }
    return all;
  }

  /**
   * Copies an attachment into the thread's storage and returns its path
   * there. The same attachment opens the same copy again, with whatever the
   * agent has changed in it since.
   */
  async function copy(threadId: string, file: { path: string; name: string }): Promise<string> {
    if (!isStoredName(file.path)) throw new Error("This is not an attached file.");
    const thread = await bb.sdk.threads.get({ threadId });
    const projectId = asRecord(thread)?.projectId;
    if (typeof projectId !== "string" || !projectId) throw new Error("This chat has no project to keep its attachments.");
    const storage = await bb.sdk.threads.storageLocation({ threadId });
    const hostId = await files.canonicalHost(storage.hostId);

    const read = async (relative: string): Promise<Buffer | null> => {
      const absPath = joinPath(storage.storageRootPath, relative);
      if (hostId === null) return await readFile(absPath).catch(() => null);
      const found = await bb.sdk.files.read({ hostId, path: absPath }).catch(() => null);
      return found ? Buffer.from(found.content, found.contentEncoding === "base64" ? "base64" : "utf8") : null;
    };
    /** Writes a new file; false when one of that name turned up first. */
    const write = async (relative: string, bytes: Uint8Array): Promise<boolean> => {
      const absPath = joinPath(storage.storageRootPath, relative);
      if (hostId === null) {
        await mkdir(path.posix.dirname(absPath), { recursive: true });
        try {
          await writeFile(absPath, bytes, { flag: "wx" });
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw error;
        }
      }
      const result = await bb.sdk.files.write({
        hostId,
        path: absPath,
        content: Buffer.from(bytes).toString("base64"),
        contentEncoding: "base64",
        createParents: true,
        // Null: only where no file is.
        expectedSha256: null,
      });
      return asRecord(result)?.outcome !== "conflict";
    };

    const key = `attachment-copy:${threadId}:${file.path}`;
    const known = await bb.storage.kv.get<string>(key);
    if (known && (await read(known)) !== null) return known;

    const attached = await bb.sdk.projects.attachments.read({ projectId, path: file.path });
    if (attached.sizeBytes > COPY_MAX_BYTES) throw new Error("This file is too large to review.");
    const bytes = Buffer.from(attached.bytes);
    const name = copyName(file.name);
    for (let n = 1; n < 100; n += 1) {
      const relative = path.posix.join(COPY_FOLDER, numbered(name, n));
      let there = await read(relative);
      if (there === null && !(await write(relative, bytes))) there = await read(relative);
      // A file of that name from before: the same bytes are this copy, others are another file.
      if (there !== null && !there.equals(bytes)) continue;
      await bb.storage.kv.set(key, relative);
      return relative;
    }
    throw new Error("Could not find a free name for the copy.");
  }

  return { list, copy };
}
