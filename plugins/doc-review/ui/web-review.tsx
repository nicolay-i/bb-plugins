// The Review button beside the address bar of bb's own browser (desktop app
// only: elsewhere bb gives plugins no access to the page). It puts the review
// controls into the live page (src/web-ui.ts with the bridge), keeps them fed
// with the site's comments, and does what they ask: save a comment, reply,
// delete, take a picture of the tab for a drawing, and send the drafts to the
// thread that owns the tab. A site is one document; each comment remembers
// its page, and a page shows the comments left on it.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  type ExperimentalPluginBrowserPage,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { BRIDGE_SCRIPT } from "../src/html-bridge";
import { WEB_UI_SCRIPT } from "../src/web-ui";
import { anchorPage, samePage, type ReviewComment } from "../src/types";
import { readAnchor } from "./html-doc";
import { errorText, useReviewRpc } from "./use-review";

/** How often an active tab is checked for a reload that dropped the controls. */
const CHECK_MS = 2500;
/** A drawing waits this long for its picture before it is commented on without one. */
const CAPTURE_MS = 6000;
const BODY_MAX = 8000;

const buttonClass =
  "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const STATE = "globalThis.__docReviewWeb";

/** Installs the controls and the bridge once per document, then switches them on. */
function installExpression(config: unknown): string {
  return (
    "(function (bb, config) {\n" +
    `if (!${STATE}) {\n${WEB_UI_SCRIPT}\n${BRIDGE_SCRIPT}\n}\n` +
    `return ${STATE}.activate(config);\n` +
    `})(bb, ${JSON.stringify(config)})`
  );
}

/** bb's colors, resolved to values the page understands. */
function themeColors(): Record<string, string> {
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const read = (variable: string) => {
    probe.style.color = `var(${variable})`;
    return getComputedStyle(probe).color;
  };
  const theme = {
    bg: read("--background"),
    fg: read("--foreground"),
    popover: read("--popover"),
    popoverFg: read("--popover-foreground"),
    muted: read("--muted"),
    mutedFg: read("--muted-foreground"),
    accent: read("--accent"),
    border: read("--border"),
    primary: read("--primary"),
    primaryFg: read("--primary-foreground"),
    destructive: read("--destructive"),
    font: getComputedStyle(document.body).fontFamily,
  };
  probe.remove();
  return theme;
}

/** The tab's screenshot comes as JPEG; drawings keep PNG pictures. */
async function toPng(base64: string, mimeType: string): Promise<string> {
  const image = new Image();
  image.src = `data:${mimeType};base64,${base64}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function siteOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function WebReviewAction(props: ExperimentalPluginBrowserToolbarActionProps) {
  const page = props.experimental_page;
  if (page === null || siteOf(props.url) === null) return null;
  return <WebReview {...props} page={page} />;
}

function WebReview({
  threadId,
  tabId,
  url,
  isCompactViewport,
  page,
}: ExperimentalPluginBrowserToolbarActionProps & { page: ExperimentalPluginBrowserPage }) {
  const rpc = useReviewRpc();
  const site = siteOf(url);
  const [active, setActive] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  /** Counts installs: a fresh install needs the comments again. */
  const [installs, setInstalls] = useState(0);
  const [busy, setBusy] = useState(false);
  /** The picture for the drawing being commented on, as a PNG data URL. */
  const capture = useRef<string | null>(null);
  const latest = useRef({ active, docId, url, threadId, tabId });
  latest.current = { active, docId, url, threadId, tabId };

  const tell = useCallback(
    (message: Record<string, unknown>) =>
      page
        .evaluate(`${STATE} ? ${STATE}.fromPlugin(${JSON.stringify(message)}) : null`)
        .catch(() => null),
    [page],
  );

  const install = useCallback(async () => {
    await page.evaluate(installExpression({ theme: themeColors() }));
    setInstalls((count) => count + 1);
  }, [page]);

  const deactivate = useCallback(async () => {
    setActive(false);
    await page.evaluate(`${STATE} ? ${STATE}.deactivate() : null`).catch(() => null);
  }, [page]);

  // Without this button nobody answers the controls: switch them off with it
  // (the tab hidden behind another panel tab, or closed).
  useEffect(
    () => () => {
      void page.evaluate(`${STATE} ? ${STATE}.deactivate() : null`).catch(() => null);
    },
    [page],
  );

  // One document per site; a link to another site opens its own.
  useEffect(() => {
    if (!active || !site) return;
    let alive = true;
    rpc.call("web.open", { url: site }).then(
      (result) => alive && setDocId(result.doc.id),
      () => alive && setDocId(null),
    );
    return () => {
      alive = false;
    };
  }, [rpc, active, site]);

  const refetch = useCallback(() => {
    if (!docId) return;
    rpc.call("comments.list", { docId }).then(
      (result) => {
        if (latest.current.docId === docId) setComments(result.comments);
      },
      () => undefined,
    );
  }, [rpc, docId]);
  useEffect(refetch, [refetch]);
  useRealtime("review-changed", (payload: unknown) => {
    const ids = (payload as { docIds?: unknown } | null)?.docIds;
    if (docId && (!Array.isArray(ids) || ids.includes(docId))) refetch();
  });

  // A navigation or a reload drops what was installed: put it back.
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const check = async () => {
      const value = await page.evaluate(`${STATE} ? ${STATE}.state() : null`).catch(() => null);
      if (stopped || !latest.current.active) return;
      if ((value as { active?: unknown } | null)?.active !== true) await install().catch(() => undefined);
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, url, page, install]);

  const drafts = comments.filter((comment) => comment.status === "draft").length;

  // The page shows the comments left on it; Send takes every draft on the site.
  useEffect(() => {
    if (!active) return;
    void tell({
      type: "state",
      comments: comments.filter((comment) => {
        const where = anchorPage(comment.anchor);
        return where !== null && samePage(where, url);
      }),
      drafts,
    });
  }, [active, comments, drafts, url, installs, tell]);

  const handle = useCallback(
    async (data: Record<string, unknown>) => {
      const req = typeof data.req === "number" ? data.req : null;
      const done = (extra: Record<string, unknown> = {}) =>
        req === null ? Promise.resolve(null) : tell({ type: "done", req, ...extra });
      const { docId, url, threadId, tabId } = latest.current;
      const id = typeof data.id === "string" ? data.id : "";
      const body = typeof data.body === "string" ? data.body.trim().slice(0, BODY_MAX) : "";
      try {
        switch (data.type) {
          case "create": {
            const anchor = readAnchor(data.anchor);
            if (!docId || !anchor || !body) throw new Error("This comment could not be saved.");
            const picture = anchor.kind === "html-drawing" ? capture.current : null;
            capture.current = null;
            const save = (withPicture: boolean) =>
              rpc.call("comments.create", {
                docId,
                anchor: { ...anchor, url },
                body,
                docVersion: null,
                ...(withPicture && picture ? { capture: { kind: "png" as const, data: picture } } : {}),
              });
            // A picture too large to send still leaves the drawing saved without it.
            const comment = await save(true).catch((cause: unknown) => {
              if (!picture) throw cause;
              return save(false);
            });
            refetch();
            await done({ id: comment.id });
            return;
          }
          case "reply":
            if (!body) throw new Error("Write the reply first.");
            await rpc.call("comments.reply", { id, body });
            break;
          case "discard-reply":
            await rpc.call("comments.discardReply", { id });
            break;
          case "delete":
            await rpc.call("comments.delete", { id });
            break;
          case "send":
            if (!docId) throw new Error("This page is not ready yet.");
            await rpc.call("comments.send", { docId, target: { kind: "thread", threadId } });
            break;
          case "capture": {
            capture.current = null;
            try {
              const shot = await withTimeout(rpc.call("web.capture", { threadId, tabId }), CAPTURE_MS);
              capture.current = await toPng(shot.data, shot.mimeType);
            } catch {
              // The drawing goes without a picture; its elements still describe it.
            }
            break;
          }
          case "drop-capture":
            capture.current = null;
            break;
          case "close":
            await deactivate();
            return;
          default:
            return;
        }
        refetch();
        await done();
      } catch (cause) {
        await done({ error: errorText(cause) });
      }
    },
    [rpc, tell, refetch, deactivate],
  );

  useEffect(
    () =>
      page.onMessage((data) => {
        if (data && typeof data === "object" && !Array.isArray(data)) void handle(data as Record<string, unknown>);
      }),
    [page, handle],
  );

  const toggle = async () => {
    if (busy) return;
    if (active) {
      await deactivate();
      return;
    }
    setBusy(true);
    try {
      await install();
      setActive(true);
    } catch (cause) {
      console.warn(`Doc Review could not start on this page: ${errorText(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const label = active ? "Stop reviewing this page" : "Review this page: comment on text, elements, or a drawing";
  // Drafts waiting to be sent, otherwise the agent's answers waiting for you.
  const badge = drafts || comments.filter((comment) => comment.status === "replied").length;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={busy}
      onClick={() => void toggle()}
      className={cn(buttonClass, isCompactViewport ? "w-7" : "px-2", active && "bg-state-hover text-foreground")}
    >
      <Icon name={busy ? "Loading" : "MessageSquarePlus"} className={cn("size-4", busy && "animate-spin")} />
      {isCompactViewport ? null : <span>Review</span>}
      {active && badge ? (
        <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
