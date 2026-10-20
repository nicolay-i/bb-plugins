import { afterEach, expect, it, vi } from "vitest";
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { quoteSelectedComment } from "./quote-comment";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("inserts only the selected text and leaves a blank line for the reply", () => {
  const composer = { insert: vi.fn(), focus: vi.fn() };
  vi.stubGlobal("window", { getSelection: () => ({ toString: () => "Первый\nВторой" }) });
  quoteSelectedComment({ message: { text: "Комментарии\nПервый\nВторой\nДругой пункт" }, composer } as unknown as PluginMessageActionContext);
  expect(composer.insert).toHaveBeenCalledWith("> Первый\n> Второй\n\n", { at: "end", block: true });
  expect(composer.focus).toHaveBeenCalledOnce();
});

it("rejects an empty selection or one from another message", () => {
  const composer = { insert: vi.fn(), focus: vi.fn() };
  for (const selectedText of ["", "Другой текст"]) {
    quoteSelectedComment({ selectedText, message: { text: "Тест" }, composer } as unknown as PluginMessageActionContext);
  }
  expect(toast.error).toHaveBeenCalledTimes(2);
  expect(composer.insert).not.toHaveBeenCalled();
});
