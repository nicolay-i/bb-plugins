import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { DocFiles } from "./files";
import type { DocRow } from "./store";

const doc = {
  hostId: "host-windows",
  absPath: "D:/Documents/Projects/peptides/.tmp/reports/audit.html",
} as DocRow;

describe("DocFiles.version on another host", () => {
  it("requests only metadata from the file's host", async () => {
    const call = vi.fn().mockResolvedValue("m123-c456-s3000000");
    const read = vi.fn();
    const bb = { hosts: { experimental_client: () => ({ call }) }, sdk: { files: { read } } } as unknown as BbPluginApi;
    expect(await new DocFiles(bb, ".tmp").version(doc)).toBe("m123-c456-s3000000");
    expect(call).toHaveBeenCalledWith("fileVersion", { path: doc.absPath }, { hostId: doc.hostId });
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves host failures instead of claiming the file is gone", async () => {
    const error = new Error("Host is disconnected");
    const call = vi.fn().mockRejectedValue(error);
    const bb = { hosts: { experimental_client: () => ({ call }) } } as unknown as BbPluginApi;
    await expect(new DocFiles(bb, ".tmp").version(doc)).rejects.toBe(error);
  });
});

it("resolves a Windows host file on a Mac/Linux server", async () => {
  const bb = { sdk: { system: { config: async () => ({ primaryHostId: "host-mac" }) } } } as unknown as BbPluginApi;
  expect(await new DocFiles(bb, ".tmp").resolve("D:/Documents/Projects/peptides/.tmp/reports/../audit.html", {
    kind: "host", experimental_hostId: "host-windows", threadId: null, environmentId: null, projectId: null,
  })).toEqual({ absPath: "D:/Documents/Projects/peptides/.tmp/audit.html", hostId: "host-windows" });
});
