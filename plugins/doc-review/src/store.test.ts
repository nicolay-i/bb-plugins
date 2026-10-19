import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { MIGRATIONS, ReviewStore, type Db } from "./store";

it("keeps Windows document identity across separators and isolates hosts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    const store = new ReviewStore(db as unknown as Db);
    const original = store.upsertDoc("windows", "D:\\Reports/audit.html", "html");
    expect(store.upsertDoc("windows", "D:/Reports/audit.html", "html")).toEqual(original);
    expect(store.upsertDoc("another-host", "D:/Reports/audit.html", "html").id).not.toBe(original.id);
    expect(db.prepare("SELECT count(*) AS count FROM docs").get()?.count).toBe(2);
  } finally {
    db.close();
  }
});
