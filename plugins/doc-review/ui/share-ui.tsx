// Sharing comments through PDFs, in the panel: the download menu that offers
// a PDF with the comments in it, and the bar over a PDF that carries another
// reviewer's comments, with buttons to bring them in.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { ViewerLink } from "../src/contract";
import type { ReviewDoc } from "../src/types";
import { errorText, useReviewRpc } from "./use-review";

/** Starts a download of `url` saved as `name`. */
function download(url: string, name: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * The download button: the original file, and for paged documents a PDF
 * with the comments written in, signed with the name the user gives.
 */
export function DownloadMenu({
  doc,
  original,
  shareable,
}: {
  doc: ReviewDoc;
  original: ViewerLink;
  /** Comments that would go into the PDF; null when the document has no pages. */
  shareable: number | null;
}) {
  const rpc = useReviewRpc();
  const [open, setOpen] = useState(false);
  const [signer, setSigner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || signer !== null) return;
    rpc.call("export.signer", null).then(
      (result) => setSigner((current) => current ?? result.signer ?? ""),
      () => setSigner((current) => current ?? ""),
    );
  }, [open, rpc, signer]);

  if (shareable === null) {
    return (
      <Button asChild type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground">
        <a href={original.url} download={doc.name} aria-label={`Download ${doc.name}`}>
          <Icon name="Download" className="size-4" />
        </a>
      </Button>
    );
  }

  const exportPdf = async () => {
    setBusy(true);
    try {
      const result = await rpc.call("doc.export", { docId: doc.id, signer: signer?.trim() || null });
      download(result.link.url, result.name);
      setOpen(false);
    } catch (cause) {
      toast.error(`Could not make the PDF: ${errorText(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative flex">
      <Button
        type="button"
        variant={open ? "secondary" : "ghost"}
        size="icon"
        className="size-8 text-muted-foreground"
        aria-label="Download"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="Download" className="size-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          <a
            href={original.url}
            download={doc.name}
            className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            <span>Original file</span>
            <span className="max-w-full truncate text-xs text-muted-foreground">{doc.name}</span>
          </a>
          <div className="my-1 h-px bg-border" />
          <form
            className="flex flex-col gap-2 px-2 py-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (shareable > 0 && !busy) void exportPdf();
            }}
          >
            <div>
              <div>PDF with comments</div>
              <p className="text-xs text-muted-foreground">
                {shareable > 0
                  ? `${shareable} comment${shareable === 1 ? "" : "s"} with drawings, readable in any PDF viewer. Doc Review in another bb imports them.`
                  : "No comments on pages or on the whole document yet."}
              </p>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Sign as
              <Input
                value={signer ?? ""}
                placeholder="Your name"
                maxLength={120}
                className="h-8 text-sm"
                onChange={(event) => setSigner(event.target.value)}
              />
            </label>
            <Button type="submit" size="sm" disabled={shareable === 0 || busy}>
              {busy ? <Icon name="Loading" className="size-3.5 animate-spin" /> : <Icon name="Download" className="size-3.5" />}
              Download PDF
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

interface SharedSummary {
  by: string | null;
  file: string;
  count: number;
  newHere: number;
  original: { path: string; newThere: number } | null;
}

/** What a PDF carries from another reviewer, refreshed when its comments change. */
export function useShared(doc: ReviewDoc, changes: unknown) {
  const rpc = useReviewRpc();
  const [shared, setShared] = useState<SharedSummary | null>(null);
  const load = useCallback(() => {
    if (doc.kind !== "pdf") return;
    rpc.call("doc.shared", { docId: doc.id }).then(
      (result) => setShared(result.shared),
      () => setShared(null),
    );
  }, [rpc, doc.id, doc.kind]);
  useEffect(() => load(), [load, doc.version, changes]);
  return { shared, reload: load };
}

/** The bar over a PDF with another reviewer's comments in it. */
export function SharedBanner({
  doc,
  shared,
  onImported,
  onOpen,
}: {
  doc: ReviewDoc;
  shared: SharedSummary;
  onImported: () => void;
  onOpen: (docId: string) => void;
}) {
  const rpc = useReviewRpc();
  const [busy, setBusy] = useState<"here" | "original" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const there = shared.original && shared.original.newThere > 0 ? shared.original : null;
  // Once they are on the file they were written on, the PDF has nothing more to offer.
  const done = shared.original !== null && !there;
  if (dismissed || done || (shared.newHere === 0 && !there)) return null;

  const bring = async (into: "here" | "original") => {
    setBusy(into);
    try {
      const result = await rpc.call("comments.import", { docId: doc.id, into });
      const parts = [
        ...(result.added > 0 ? [`${result.added} new comment${result.added === 1 ? "" : "s"}`] : []),
        ...(result.updated > 0 ? [`replies on ${result.updated}`] : []),
      ];
      const what = parts.length > 0 ? `Imported ${parts.join(" and ")}` : "Nothing new to import";
      if (into === "here") toast.success(result.added > 0 ? `${what}. New comments wait as drafts.` : `${what}.`);
      else
        toast.success(`${what} into ${result.name}.`, {
          action: { label: "Open", onClick: () => onOpen(result.docId) },
        });
      onImported();
    } catch (cause) {
      toast.error(`Could not import the comments: ${errorText(cause)}`);
    } finally {
      setBusy(null);
    }
  };

  const who = shared.by ?? "Another reviewer";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2 text-xs">
      <Icon name="MessageSquare" className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{who}</span> left {shared.count} comment{shared.count === 1 ? "" : "s"} on{" "}
        <span className="font-medium">{shared.file}</span> in this PDF. Import them to reply, change them, or send them
        to an agent.
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {there ? (
          <Button type="button" size="sm" className="h-7" disabled={busy !== null} onClick={() => void bring("original")}>
            {busy === "original" ? <Icon name="Loading" className="size-3.5 animate-spin" /> : null}
            Import into {shared.file}
          </Button>
        ) : null}
        {shared.newHere > 0 ? (
          <Button
            type="button"
            size="sm"
            variant={there ? "outline" : "default"}
            className="h-7"
            disabled={busy !== null}
            onClick={() => void bring("here")}
          >
            {busy === "here" ? <Icon name="Loading" className="size-3.5 animate-spin" /> : null}
            {there ? "Import here" : "Import"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Hide"
          onClick={() => setDismissed(true)}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
