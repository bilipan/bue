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

/**
 * 工具条图标。统一用描边（不是实心），描边属性写在 theme.css 的
 * .mermaid-tool svg 上，这里只给路径。
 */
const MERMAID_ICONS = {
  /** 拖动模式：四向箭头 */
  pan: '<path d="M8 1.5v13M1.5 8h13"/><path d="M6 3.5 8 1.5l2 2M6 12.5l2 2 2-2M3.5 6 1.5 8l2 2M12.5 6l2 2-2 2"/>',
  /** 放大：放大镜 + 加号 */
  zoomIn: '<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 14 14M7 5v4M5 7h4"/>',
  /** 缩小：放大镜 + 减号 */
  zoomOut: '<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 14 14M5 7h4"/>',
  /** 适配容器尺寸：四角取景框 */
  fit: '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/>',
} as const;

type MermaidIcon = keyof typeof MERMAID_ICONS;

function mermaidTool(icon: MermaidIcon, label: string, attrs: string): string {
  return (
    `<button class="mermaid-tool" type="button" ${attrs} aria-label="${label}" title="${label}">` +
    `<svg viewBox="0 0 16 16" aria-hidden="true">${MERMAID_ICONS[icon]}</svg>` +
    `</button>`
  );
}

/**
 * mermaid 代码块：正文放 .mermaid 占位（客户端渲染），源码折叠在 details 里。
 *
 * 图可缩放，所以正文外面套一层 .mermaid-viewport——放大后超出 figure 宽度时
 * 由它横向滚动。缩放值写在 figure 的 data-zoom 上（不写在 .mermaid 里），
 * 主题切换会重绘并清空 .mermaid，画在 figure 上才跨重绘存活。
 *
 * data-zoom 记的是「相对适配容器的倍数」：1 就是刚好铺满容器宽度。
 * 记绝对像素的话容器一变宽就得重算，这里交给 client 去乘。
 */
function mermaidBlock(code: string): string {
  return (
    `<figure class="mermaid-figure" data-zoom="1">` +
    `<div class="mermaid-viewport"><div class="mermaid">${escapeHtml(code)}</div></div>` +
    `<div class="mermaid-tools">` +
    mermaidTool("pan", "拖动模式", 'data-pan-toggle aria-pressed="false"') +
    mermaidTool("zoomOut", "缩小", "data-zoom-out") +
    mermaidTool("zoomIn", "放大", "data-zoom-in") +
    mermaidTool("fit", "适配容器尺寸", "data-zoom-fit") +
    `</div>` +
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