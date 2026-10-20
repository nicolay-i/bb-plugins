import Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { expect, it, vi } from "vitest";
import plugin from "../server";

it("sends readable text and agent-only context to current and new threads", async () => {
  const db = new Database(":memory:");
  const dispose: Array<() => void> = [];
  let handlers: any;
  const send = vi.fn(async (_args: any) => ({}));
  const spawn = vi.fn(async (_args: any) => ({ id: "new-thread" }));
  const bb = {
    pluginId: "doc-review", onDispose: (fn: () => void) => dispose.push(fn),
    storage: { database: () => db, migrate: (_db: unknown, statements: string[]) => statements.forEach((s) => db.exec(s)) },
    settings: { define: () => ({ get: async () => ({ rememberRecents: false }) }) },
    hosts: { experimental_client: () => ({ call: async () => "v1", experimental_onSignal: () => vi.fn(), experimental_onWorkerExit: () => vi.fn() }) },
    sdk: { subscribe: () => vi.fn(), system: { config: async () => ({ primaryHostId: "server" }) }, hosts: { get: async () => ({ status: "connected" }) },
      threads: { get: async () => ({ projectId: "project" }), send, spawn } },
    realtime: { publish: vi.fn() }, http: { route: vi.fn() }, cli: { register: vi.fn() },
    rpc: { register: (_contract: unknown, registered: any) => { handlers = registered; } },
  } as unknown as BbPluginApi;
  try {
    await plugin(bb);
    const { doc } = await handlers["doc.open"]({ path: "/reports/audit.html", source: { kind: "host", experimental_hostId: "remote" } });
    for (const target of [{ kind: "thread", threadId: "current-thread" }, { kind: "new-thread", projectId: "project" }]) {
      const comment = await handlers["comments.create"]({ docId: doc.id, anchor: { kind: "html-text", quote: "Evidence", prefix: "", suffix: "", selector: "#evidence" }, body: "Вынести в docs?", docVersion: "v1" });
      expect((await handlers["comments.handoffPrompt"]({ docId: doc.id, ids: [comment.id] })).prompt).toContain("bb doc-review resolve");
      expect((await handlers["comments.send"]({ docId: doc.id, ids: [comment.id], target })).sent).toBe(1);
      const args = target.kind === "thread" ? send.mock.calls[0]![0] : spawn.mock.calls[0]![0];
      expect(args.input[0].text).toContain("Комментарии к audit.html · 1");
      expect(args.input[0].text).toContain("Вынести в docs?");
      expect(args.input[0].text).not.toContain("#evidence");
      expect(args.input[1]).toMatchObject({ visibility: "agent-only", type: "text" });
      expect(args.input[1].text).toContain(comment.id);
      expect(args.input[1].text).toContain("#evidence");
      expect(args.input[1].text).toContain("bb doc-review resolve");
    }
    expect(send.mock.calls[0]![0].mode).toBe("queue-if-active");
  } finally {
    dispose.forEach((stop) => stop());
    db.close();
  }
});
