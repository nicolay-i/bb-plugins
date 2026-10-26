import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { copyName, createAttachments, filesInInput, filesOnMessage, numbered } from "./attachments";
import type { DocFiles } from "./files";

describe("attached files", () => {
  it("reads the files a message request carries, under the names they were attached with", () => {
    const input = [
      { type: "text", text: "look" },
      { type: "localFile", path: "X5---1793005415909-xohhk6.html", name: "X5-перевозчикам.html" },
      { type: "localFile", path: "notes-1-abc.zip", name: "notes.zip" },
      { type: "localImage", path: "shot.png" },
      { type: "localFile", path: "../escape.pdf", name: "escape.pdf" },
    ];
    expect(filesInInput(input)).toEqual([
      { name: "X5-перевозчикам.html", path: "X5---1793005415909-xohhk6.html", supported: true },
      { name: "notes.zip", path: "notes-1-abc.zip", supported: false },
    ]);
  });

  it("reads the files on a message", () => {
    const message = {
      attachments: { localFileDetails: [{ path: "deck-1-a.pptx", name: "Deck.pptx", sizeBytes: 10 }] },
    };
    expect(filesOnMessage(message)).toEqual([{ name: "Deck.pptx", path: "deck-1-a.pptx", supported: true }]);
    expect(filesOnMessage({ attachments: null })).toEqual([]);
  });

  it("names copies safely and numbers clashes", () => {
    expect(copyName("a/b\\c.pdf")).toBe("a-b-c.pdf");
    expect(copyName("..hidden.md")).toBe("hidden.md");
    expect(copyName("   ")).toBe("attachment");
    expect(numbered("deck.pptx", 1)).toBe("deck.pptx");
    expect(numbered("deck.pptx", 3)).toBe("deck (3).pptx");
  });
});

describe("copying an attachment for review", () => {
  let root: string | null = null;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = null;
  });

  async function setup(bytes: string) {
    root = await mkdtemp(path.join(tmpdir(), "doc-review-attach-"));
    const kv = new Map<string, unknown>();
    const bb = {
      sdk: {
        threads: {
          get: async () => ({ id: "thr_1", projectId: "proj_1" }),
          storageLocation: async () => ({ hostId: "host_local", storageRootPath: root }),
        },
        projects: {
          attachments: {
            read: async () => ({ bytes: new TextEncoder().encode(bytes), mimeType: "text/html", sizeBytes: bytes.length }),
          },
        },
      },
      storage: {
        kv: {
          get: async (key: string) => kv.get(key) ?? null,
          set: async (key: string, value: unknown) => void kv.set(key, value),
        },
      },
    } as unknown as BbPluginApi;
    const files = { canonicalHost: async () => null } as unknown as DocFiles;
    return { attachments: createAttachments({ bb, files }), kv, root };
  }

  it("copies into the thread's storage and opens the same copy again, edits and all", async () => {
    const { attachments, root: dir } = await setup("<p>one</p>");
    const first = await attachments.copy("thr_1", { path: "page-1-a.html", name: "Страница.html" });
    expect(first).toBe("Doc Review/Страница.html");
    expect(await readFile(path.join(dir, first), "utf8")).toBe("<p>one</p>");

    // The agent changes the copy; opening the attachment again keeps the change.
    await writeFile(path.join(dir, first), "<p>edited</p>");
    expect(await attachments.copy("thr_1", { path: "page-1-a.html", name: "Страница.html" })).toBe(first);
    expect(await readFile(path.join(dir, first), "utf8")).toBe("<p>edited</p>");
  });

  it("does not overwrite another file of the same name", async () => {
    const { attachments, root: dir } = await setup("<p>new</p>");
    await mkdir(path.join(dir, "Doc Review"), { recursive: true });
    await writeFile(path.join(dir, "Doc Review", "page.html"), "<p>other</p>");
    const copied = await attachments.copy("thr_1", { path: "page-2-b.html", name: "page.html" });
    expect(copied).toBe("Doc Review/page (2).html");
    expect(await readFile(path.join(dir, "Doc Review", "page.html"), "utf8")).toBe("<p>other</p>");
  });

  it("refuses a path that is not a stored attachment name", async () => {
    const { attachments } = await setup("x");
    await expect(attachments.copy("thr_1", { path: "../secret", name: "a.html" })).rejects.toThrow(/not an attached file/);
  });
});
