import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import host from "../host";

it("subscribes once, emits invalidation and releases native watchers", async () => {
  const temp = path.resolve("../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(path.join(temp, "doc-review-watch-"));
  const file = path.join(root, "doc.html");
  await writeFile(file, "test");
  const dispose = vi.fn(async () => {});
  const watch = vi.fn(async (_options: unknown, _listener: (event: any) => Promise<void>) => ({ dispose }));
  const emit = vi.fn(async () => {});
  const lifecycle = new AbortController();
  const context = { experimental_watch: watch, experimental_emitSignal: emit, lifecycle: { signal: lifecycle.signal } } as any;
  try {
    const a = await host.handlers.fileVersion({ path: file }, context);
    const b = await host.handlers.fileVersion({ path: file }, context);
    expect(a).toBe(b);
    expect(watch).toHaveBeenCalledTimes(1);
    await watch.mock.calls[0][1]({ kind: "changed", changes: [{ path: "other.html", type: "update" }] });
    expect(emit).not.toHaveBeenCalled();
    await watch.mock.calls[0][1]({ kind: "changed", changes: [{ path: "doc.html", type: "update" }] });
    expect(emit).toHaveBeenCalledWith("changed", { path: file });
    await watch.mock.calls[0][1]({ kind: "changed", changes: [{ path: file, type: "delete" }] });
    await watch.mock.calls[0][1]({ kind: "changed", changes: [{ path: root, type: "delete" }] });
    await watch.mock.calls[0][1]({ kind: "rescan-required" });
    expect(emit).toHaveBeenCalledTimes(4);
    await watch.mock.calls[0][1]({ kind: "watch-error", message: "Native watcher failed" });
    expect(dispose).toHaveBeenCalledTimes(1);
    await host.handlers.fileVersion({ path: file }, context);
    expect(watch).toHaveBeenCalledTimes(2);
  } finally {
    lifecycle.abort();
    await host.dispose?.();
    await rm(root, { recursive: true, force: true });
  }
  expect(dispose).toHaveBeenCalledTimes(2);
});
