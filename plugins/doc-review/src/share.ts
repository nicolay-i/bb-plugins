// Comments carried inside an exported PDF for another bb with Doc Review:
// the export attaches them as a JSON file, and Doc Review on the other side
// reads it back and merges the comments into a document there. Ids travel
// with every comment and reply, so a file that comes back with answers adds
// only what is new.
import { z } from "zod";
import { anchorSchema } from "./contract.js";
import { isPageAnchor, type DocKind, type ReviewComment } from "./types.js";

/** The attachment's name inside the PDF. */
export const SHARE_FILE = "doc-review-comments.json";
const FORMAT = "bb-doc-review";
/** A name for people who exported without signing. */
export const UNNAMED = "Reviewer";

const MAX_COMMENTS = 2000;
const MAX_THREAD = 200;
const MAX_TEXT = 20_000;
const MAX_NAME = 120;

const nameSchema = z.string().trim().min(1).max(MAX_NAME).nullable();

const replySchema = z.object({
  id: z.string().min(1).max(64),
  author: z.enum(["user", "agent"]),
  /** For a person, who wrote it; for an agent, whose agent it is. */
  name: nameSchema,
  body: z.string().max(MAX_TEXT),
  outcome: z.enum(["replied", "resolved"]).nullable(),
  createdAt: z.number(),
});

const commentSchema = z.object({
  id: z.string().min(1).max(64),
  author: nameSchema,
  anchor: anchorSchema,
  body: z.string().max(MAX_TEXT),
  createdAt: z.number(),
  thread: z.array(replySchema).max(MAX_THREAD),
});

const sharedSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  file: z.object({
    /** The file the comments were written on, such as the deck a PDF was made from: a bare name, no folders. */
    name: z
      .string()
      .min(1)
      .max(255)
      .refine((name) => !/[/\\\u0000]/.test(name) && name !== "." && name !== "..", "A file name without folders."),
    kind: z.enum(["pdf", "text", "presentation"]),
    /** The pages of that file: an export adds pages after them for its list of comments. */
    pages: z.number().int().min(1),
  }),
  exportedBy: nameSchema,
  exportedAt: z.number(),
  comments: z.array(commentSchema).max(MAX_COMMENTS),
});

export type SharedReview = z.infer<typeof sharedSchema>;
export type SharedComment = SharedReview["comments"][number];

/** Whether a comment can travel: one on the whole document or on a page. */
export function shareable(comment: ReviewComment): boolean {
  return comment.anchor.kind === "doc" || isPageAnchor(comment.anchor);
}

/**
 * The comments of a paged document as they travel. Whatever this bb's user
 * wrote is signed with `signer`; what came from others keeps its names.
 */
export function buildShared(input: {
  comments: readonly ReviewComment[];
  file: { name: string; kind: DocKind; pages: number };
  signer: string | null;
  now?: number;
}): SharedReview {
  const kind = input.file.kind === "text" || input.file.kind === "presentation" ? input.file.kind : "pdf";
  return {
    format: FORMAT,
    version: 1,
    file: { name: input.file.name, kind, pages: input.file.pages },
    exportedBy: input.signer,
    exportedAt: input.now ?? Date.now(),
    comments: input.comments.filter(shareable).map((comment) => ({
      id: comment.originId ?? comment.id,
      author: comment.author ?? input.signer,
      anchor: comment.anchor,
      body: comment.body,
      createdAt: comment.createdAt,
      thread: comment.thread.map((reply) => ({
        id: reply.originId ?? reply.id,
        author: reply.author,
        name: reply.name ?? input.signer,
        body: reply.body,
        outcome: reply.outcome,
        createdAt: reply.createdAt,
      })),
    })),
  };
}

/** The comments in an attachment, or null when it is not one Doc Review wrote. */
export function parseShared(text: string): SharedReview | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = sharedSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Only places a paged document has; pages past the original are the list.
  const pages = parsed.data.file.pages;
  return {
    ...parsed.data,
    comments: parsed.data.comments.filter(
      (comment) => comment.anchor.kind === "doc" || (isPageAnchor(comment.anchor) && comment.anchor.page <= pages),
    ),
  };
}
