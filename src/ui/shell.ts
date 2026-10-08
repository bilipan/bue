import { readFileSync } from "node:fs";
import type { TocItem } from "../render/toc.ts";

const themeCss = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const clientJs = readFileSync(new URL("./client.js", import.meta.url), "utf8");

export interface ShellOptions {
  title: string;
  /** 工具条面包屑：目录层级 -> 文件名 */
  breadcrumb: string[];
  bodyHtml: string;
  toc: TocItem[];
  /** 服务端决定的初始主题，写成 data-theme 交给客户端接管 */
  theme: "auto" | "light" | "dark";
  width: number;
  showToc: boolean;
  /** 是否提供文档间导航（多文件时才需要） */
  showSwitcher: boolean;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ICONS = {
  toc: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 3h12.5v1.5H1.75zm0 4.25h12.5v1.5H1.75zm0 4.25h12.5V13H1.75z"/></svg>',
  theme:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 1.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 12.5Zm0-11a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 1.5Zm0 11.25a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75Zm7.25-7.25a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1 0-1.5h1a.75.75 0 0 1 .75.75Zm-14.5 0a.75.75 0 0 1 .75.75h1a.75.75 0 0 1 0 1.5h-1a.75.75 0 0 1-.75-.75Z"/></svg>',
} as const;

// 内联 SVG favicon：省掉一次请求，也就不会有 /favicon.ico 的 404 噪音
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="#0969da"/>' +
      '<path d="M16 7l9 5-9 5-9-5 9-5zm-7 9.5l5.5 3v6.2L9 22.5v-6zm11 0v6l5.5 3.2v-6.2L20 16.5z" fill="#fff"/>' +
      "</svg>",
  );

export function renderShell(o: ShellOptions): string {
  const themeAttr = o.theme === "auto" ? "" : ` data-theme="${o.theme}"`;

  const crumb = o.breadcrumb
    .map((part, i) =>
      i === o.breadcrumb.length - 1
        ? `<span class="name">${escapeHtml(part)}</span>`
        : `<span>${escapeHtml(part)}</span><span class="sep">/</span>`,
    )
    .join("");

  const toc = o.showToc && o.toc.length > 0 ? renderToc(o.toc) : "";

  return `<!doctype html>
<html lang="zh"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/vendor/hljs/github.css" data-hljs-theme="light">
<link rel="stylesheet" href="/vendor/hljs/github-dark.css" data-hljs-theme="dark">
<style>
:root { --content-width: ${o.width}px; }
${themeCss}
</style>
</head>
<body>
<header class="bue-bar">
  <div class="bue-crumb">${crumb}</div>
  ${o.showSwitcher ? '<a class="btn" href="/" title="返回文档索引"><span class="label">索引</span></a>' : ""}
  <span class="spacer"></span>
  <button class="btn" id="toc-btn" type="button" aria-pressed="false" title="目录">${ICONS.toc}<span class="label">目录</span></button>
  <button class="btn" id="theme-btn" type="button" title="切换主题">${ICONS.theme}<span class="label">主题</span></button>
</header>
<div class="bue-layout${toc ? " has-toc" : ""}">
  <article class="markdown-body">
${o.bodyHtml}
  </article>
${toc}
</div>
<script>
${inlineScript(clientJs)}
</script>
</body>
</html>
`;
}

/**
 * 内联脚本前必须转义 </script，否则 HTML 解析器会提前结束 script 块，
 * 剩下内容被当成正文，整页 JS 语法崩掉。（mermaid 里就有这类模板字符串。）
 */
function inlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

function renderToc(items: TocItem[]): string {
  const links = items
    .map(
      (i) =>
        `<li><a class="depth-${i.depth}" href="#${escapeHtml(i.id)}">${escapeHtml(i.text)}</a></li>`,
    )
    .join("");
  return `<nav class="bue-toc" id="toc" hidden aria-label="目录">
  <h2>目录</h2>
  <ul>${links}</ul>
</nav>`;
}

export function renderNotFound(message: string, detail = ""): string {
  const detailHtml = detail ? `<p><code>${escapeHtml(detail)}</code></p>` : "";
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 · bue</title>
<link rel="icon" href="${FAVICON}">
<style>
${themeCss}
</style>
</head>
<body>
<header class="bue-bar"><div class="bue-crumb"><span class="name">404</span></div></header>
<div class="bue-404">
  <h1>找不到这个页面</h1>
  <p>${escapeHtml(message)}</p>
  ${detailHtml}
  <p><a href="/">返回索引</a></p>
</div>
</body>
</html>
`;
}