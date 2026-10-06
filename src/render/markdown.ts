import { Marked } from "marked";
import { escapeHtml, highlightCode } from "./highlight.ts";
import { createIdAllocator, pruneToc, type TocItem } from "./toc.ts";

export interface RenderOptions {
  /** 把 markdown 里的相对 URL（.md 链接、图片等）改写成站内路由 */
  rewriteUrl: (href: string) => string;
}

export interface RenderResult {
  html: string;
  toc: TocItem[];
}

/**
 * 把 markdown 源码渲染成 HTML 片段。
 *
 * 每次调用都新建 Marked 实例：渲染器闭包里持有本次的 id 映射与 TOC，
 * 复用实例会让并发请求互相污染（server 每次请求都调这里）。
 */
export function renderMarkdown(source: string, options: RenderOptions): RenderResult {
  const toc: TocItem[] = [];
  const allocateId = createIdAllocator();

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const plain = stripTags(html);
        const id = allocateId(plain);
        toc.push({ id, text: plain, depth });
        // h1 已经是页面主标题，工具条里也会显示文件名，这里不再重复生成锚点
        const anchor = depth === 1 ? "" : `<a class="anchor" href="#${id}" aria-hidden="true">#</a>`;
        return `<h${depth} id="${id}">${anchor}${html}</h${depth}>\n`;
      },

      code({ text, lang }) {
        if ((lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() === "mermaid") {
          return mermaidBlock(text);
        }
        const language = lang?.trim().split(/\s+/)[0] ?? "";
        const cls = language ? `hljs language-${escapeHtml(language)}` : "hljs";
        return (
          `<div class="code-block"><button class="copy-btn" type="button" data-copy aria-label="复制代码">复制</button>` +
          `<pre><code class="${cls}">${highlightCode(text, lang)}</code></pre></div>\n`
        );
      },

      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = options.rewriteUrl(href ?? "");
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(target)}"${titleAttr}>${inner}</a>`;
      },

      image({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const src = options.rewriteUrl(href ?? "");
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(inner)}"${titleAttr} loading="lazy">`;
      },
    },
  });

  return { html: marked.parse(source) as string, toc: pruneToc(toc) };
}

/** mermaid 代码块：正文放 .mermaid 占位（客户端渲染），源码折叠在 details 里 */
function mermaidBlock(code: string): string {
  return (
    `<figure class="mermaid-figure">` +
    `<div class="mermaid">${escapeHtml(code)}</div>` +
    `<details class="mermaid-src"><summary>查看源码</summary>` +
    `<pre><code class="hljs">${escapeHtml(code)}</code></pre></details>` +
    `</figure>\n`
  );
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}