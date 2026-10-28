import { describe, expect, it } from "vitest";
import { samePage } from "./types";

describe("pages of a live site", () => {
  it("ignore the query, the hash, and a trailing slash", () => {
    expect(samePage("https://a.example/room/1?x=2#top", "https://a.example/room/1/")).toBe(true);
    expect(samePage("https://a.example/", "https://a.example")).toBe(true);
  });

  it("differ by path or origin", () => {
    expect(samePage("https://a.example/room/1", "https://a.example/room/2")).toBe(false);
    expect(samePage("https://a.example/room/1", "http://a.example/room/1")).toBe(false);
    expect(samePage("not a url", "https://a.example/")).toBe(false);
  });
});
