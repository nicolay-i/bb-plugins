import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./src/host-contract.js";
import { fileVersion } from "./src/file-version.js";

const watches = new Map<string, { close(): Promise<void> }>();

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    fileVersion: async ({ path: filePath }, context) => {
      if (!path.isAbsolute(filePath) || filePath.includes("\0")) throw new Error("Expected an absolute file path.");
      if (!watches.has(filePath)) {
        if (watches.size >= 64) await watches.values().next().value!.close();
        const subscription = await context.experimental_watch({ rootPath: path.dirname(filePath), debounceMs: 25, maxWaitMs: 100 }, async (event) => {
          if (event.kind === "watch-error") { await watches.get(filePath)?.close(); return; }
          await context.experimental_emitSignal("changed", { path: filePath });
        });
        const timer = setTimeout(() => { void entry.close().catch((error) => console.error("Doc Review watcher cleanup failed:", error)); }, 5 * 60 * 1000);
        timer.unref();
        const entry = { async close() {
          if (watches.get(filePath) !== entry) return;
          watches.delete(filePath);
          clearTimeout(timer);
          await subscription.dispose();
          if (!context.lifecycle.signal.aborted) await context.experimental_emitSignal("changed", { path: filePath });
        } };
        watches.set(filePath, entry);
      }
      return fileVersion(filePath);
    },
  },
  dispose: async () => {
    await Promise.all([...watches.values()].map((entry) => entry.close()));
  },
});
