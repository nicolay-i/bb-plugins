import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, ReviewStore, type Db } from "./store";

function setup(migrations = MIGRATIONS) {
  const db = new Database(":memory:");
  for (const statement of migrations) db.exec(statement);
  const store = new ReviewStore(db as unknown as Db);
  const doc = store.upsertDoc(null, "/notes/plan.md", "md");
  return { db, store, doc };
}

function sentComment(store: ReviewStore, docId: string) {
  const comment = store.createComment({
    docId,
    anchor: { kind: "doc" },
    body: "Move the block to settings",
    docVersion: null,
  });
  store.markSent([comment.id], "thr_a");
  return comment;
}

describe("comment threads", () => {
  it("keeps every answer and reply in order", () => {
    const { store, doc } = setup();
    const comment = sentComment(store, doc.id);

    store.reply(comment.id, "Into the board settings?");
    const drafted = store.saveReply(comment.id, "Yes, and keep it on check-in");
    expect(drafted.status).toBe("draft");
    expect(drafted.thread.map((reply) => [reply.author, reply.sentAt === null])).toEqual([
      ["agent", false],
      ["user", true],
    ]);

    // Writing again replaces the unsent reply instead of adding another.
    expect(store.saveReply(comment.id, "Yes, keep it on check-in").thread).toHaveLength(2);

    store.markSent([comment.id], "thr_b");
    const done = store.resolve(comment.id, "Moved, check-in kept");
    expect(done.status).toBe("resolved");
    expect(done.agentNote).toBe("Moved, check-in kept");
    expect(done.thread.map((reply) => `${reply.author}: ${reply.body}`)).toEqual([
      "agent: Into the board settings?",
      "user: Yes, keep it on check-in",
      "agent: Moved, check-in kept",
    ]);
  });

  it("keeps a reply the user is writing when the agent answers meanwhile", () => {
    const { store, doc } = setup();
    const comment = sentComment(store, doc.id);
    store.reply(comment.id, "Which block?");
    store.saveReply(comment.id, "The mood one");
    const answered = store.resolve(comment.id, "Done anyway");
    expect(answered.status).toBe("draft");
    expect(answered.thread.at(-1)).toMatchObject({ author: "user", sentAt: null });
  });

  it("returns a discarded reply's comment to where the thread left it", () => {
    const { store, doc } = setup();
    const comment = sentComment(store, doc.id);
    store.reply(comment.id, "Which block?");
    store.saveReply(comment.id, "The mood one");
    expect(store.discardReply(comment.id)).toMatchObject({
      status: "replied",
      thread: [{ author: "agent" }],
    });

    store.resolve(comment.id, "Removed it");
    store.saveReply(comment.id, "Not removed, moved");
    const back = store.discardReply(comment.id);
    expect(back.status).toBe("resolved");
    expect(back.resolvedAt).not.toBeNull();
  });

  it("deletes the thread with its comment", () => {
    const { db, store, doc } = setup();
    const comment = sentComment(store, doc.id);
    store.reply(comment.id, "Why?");
    store.deleteComment(comment.id);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM replies`).get()).toEqual({ n: 0 });
  });

  it("moves notes written before threads into them", () => {
    const shipped = MIGRATIONS.slice(0, 5);
    const { db, store, doc } = setup(shipped);
    db.prepare(
      `INSERT INTO comments (id, doc_id, seq, status, anchor, body, created_at, updated_at, agent_note)
       VALUES ('c_old', ?, 1, 'replied', '{"kind":"doc"}', 'Shorter', 1, 2, 'Old question')`,
    ).run(doc.id);
    for (const statement of MIGRATIONS.slice(5)) db.exec(statement);
    expect(store.getComment("c_old")?.thread).toMatchObject([
      { author: "agent", body: "Old question", outcome: "replied" },
    ]);
  });
});
