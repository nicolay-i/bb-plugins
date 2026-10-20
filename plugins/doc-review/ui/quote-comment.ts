import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

export function quoteSelectedComment(context: PluginMessageActionContext) {
  const selected = (context.selectedText ?? window.getSelection()?.toString() ?? "").trim();
  if (!selected || !context.message.text.includes(selected)) {
    toast.error("Сначала выделите текст в этом сообщении.");
    return;
  }
  if (!context.composer) {
    toast.error("Поле ввода этого чата недоступно.");
    return;
  }
  context.composer.insert(selected.split(/\r?\n/).map((line) => `> ${line}`).join("\n") + "\n\n", { at: "end", block: true });
  context.composer.focus();
}
