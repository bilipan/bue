import { createRequire } from "node:module";
import hljs from "highlight.js/lib/common";

const require = createRequire(import.meta.url);

export const HLJS_THEME_LIGHT = require.resolve("highlight.js/styles/github.css");
export const HLJS_THEME_DARK = require.resolve("highlight.js/styles/github-dark.css");

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 高亮一段代码。不认识的语言降级为纯转义文本，不抛错——
 * 预览工具不该因为一个语言标记挂掉整页。
 */
export function highlightCode(code: string, lang: string | undefined): string {
  const language = lang?.trim().split(/\s+/)[0] ?? "";
  if (language && hljs.getLanguage(language)) {
    try {
      const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
      return value;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  return escapeHtml(code);
}