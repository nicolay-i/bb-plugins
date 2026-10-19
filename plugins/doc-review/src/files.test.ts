import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { DocFiles } from "./files";
import type { DocRow } from "./store";

const doc = {
  hostId: "host-windows",
  absPath: "D:/Documents/Projects/peptides/.tmp/reports/audit.html",
} as DocRow;

describe("DocFiles.version on another host", () => {
  it("reads the file from its host and uses its content hash", async () => {
    const read = vi.fn().mockResolvedValue({ sha256: "0123456789abcdef0123456789abcdef" });
    const bb = { sdk: { files: { read } } } as unknown as BbPluginApi;
    expect(await new DocFiles(bb, ".tmp").version(doc)).toBe("h0123456789abcdef");
    expect(read).toHaveBeenCalledWith({ hostId: doc.hostId, path: doc.absPath });
  });

  it("preserves read failures instead of claiming the file is gone", async () => {
    const error = new Error("Host is disconnected");
    const read = vi.fn().mockRejectedValue(error);
    const bb = { sdk: { files: { read } } } as unknown as BbPluginApi;
    await expect(new DocFiles(bb, ".tmp").version(doc)).rejects.toBe(error);
  });
});

it("resolves a Windows host file on a Mac/Linux server", async () => {
  const bb = { sdk: { system: { config: async () => ({ primaryHostId: "host-mac" }) } } } as unknown as BbPluginApi;
  expect(await new DocFiles(bb, ".tmp").resolve("D:/Documents/Projects/peptides/.tmp/reports/../audit.html", {
    kind: "host", experimental_hostId: "host-windows", threadId: null, environmentId: null, projectId: null,
  })).toEqual({ absPath: "D:/Documents/Projects/peptides/.tmp/audit.html", hostId: "host-windows" });
});
