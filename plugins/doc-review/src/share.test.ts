import { describe, expect, it } from "vitest";
import { parseShared } from "./share";

const base = {
  format: "bb-doc-review",
  version: 1,
  file: { name: "deck.pptx", kind: "presentation", pages: 2 },
  exportedBy: "Фома",
  exportedAt: 1,
  comments: [
    { id: "c_1", author: "Фома", anchor: { kind: "doc" }, body: "Ок", createdAt: 1, thread: [] },
    {
      id: "c_2",
      author: "Фома",
      anchor: { kind: "page-area", page: 3, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, text: "" },
      body: "On the list page",
      createdAt: 2,
      thread: [],
    },
  ],
};

describe("comments carried in a PDF", () => {
  it("reads what Doc Review wrote, keeping only places the file has", () => {
    const shared = parseShared(JSON.stringify(base));
    expect(shared?.comments.map((comment) => comment.id)).toEqual(["c_1"]);
  });

  it("refuses a file name with folders in it", () => {
    for (const name of ["../../secret.docx", "a/b.pptx", "a\\b.pptx", ".."]) {
      expect(parseShared(JSON.stringify({ ...base, file: { ...base.file, name } }))).toBeNull();
    }
  });

  it("refuses anything else", () => {
    expect(parseShared("not json")).toBeNull();
    expect(parseShared(JSON.stringify({ ...base, format: "other" }))).toBeNull();
    expect(parseShared(JSON.stringify({ ...base, comments: [{ ...base.comments[0], anchor: { kind: "md-text" } }] }))).toBeNull();
  });
});
