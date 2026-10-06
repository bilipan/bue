import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/render/markdown.ts";

const identity = { rewriteUrl: (h: string) => h };

describe("renderMarkdown", () => {
  test("渲染基础 markdown", () => {
    const { html } = renderMarkdown("# 标题\n\n正文 **加粗**。", identity);
    assert.match(html, /<h1 id="标题">标题<\/h1>/);
    assert.match(html, /<strong>加粗<\/strong>/);
  });

  test("GFM 表格", () => {
    const { html } = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |", identity);
    assert.match(html, /<table>/);
    assert.match(html, /<th>a<\/th>/);
  });

  test("任务列表渲染成 checkbox", () => {
    const { html } = renderMarkdown("- [x] 完成\n- [ ] 未完成", identity);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /checked/);
  });

  test("mermaid 代码块变成占位 div 而非代码块", () => {
    const { html } = renderMarkdown("```mermaid\nflowchart LR\n  A-->B\n```", identity);
    assert.match(html, /class="mermaid"/);
    assert.doesNotMatch(html, /code-block/);
    assert.match(html, /mermaid-src/, "应附带可展开的源码");
  });

  test("mermaid 源码里的尖括号被转义，不会变成标签", () => {
    const { html } = renderMarkdown("```mermaid\nA[标签 <b>x</b>] --> B\n```", identity);
    assert.match(html, /&lt;b&gt;/);
    assert.doesNotMatch(html, /<b>x<\/b>/);
  });

  test("mermaid 图带缩放工具条和横向滚动容器", () => {
    const { html } = renderMarkdown("```mermaid\nflowchart LR\n  A-->B\n```", identity);
    assert.match(html, /class="mermaid-viewport"/, "放大后要有一层容器负责横向滚动");
    assert.match(html, /data-zoom-in/);
    assert.match(html, /data-zoom-out/);
    assert.match(html, /data-zoom-reset/);
    assert.match(html, /data-zoom-full/, "应有进入全屏查看的入口");
    assert.match(html, /data-zoom-level/, "应显示当前缩放比例");
  });

  test("缩放值存在 figure 上而不是 .mermaid 里", () => {
    // 主题切换会重绘并清空 .mermaid，画在里面的缩放值活不过一次切换
    const { html } = renderMarkdown("```mermaid\nflowchart LR\n  A-->B\n```", identity);
    assert.match(html, /<figure class="mermaid-figure" data-zoom="1">/);
  });

  test("mermaid 大写语言标记也能识别", () => {
    const { html } = renderMarkdown("```Mermaid\ngraph TD; A-->B\n```", identity);
    assert.match(html, /class="mermaid"/);
  });

  test("普通代码块带复制按钮并高亮", () => {
    const { html } = renderMarkdown("```ts\nconst a: number = 1;\n```", identity);
    assert.match(html, /class="code-block"/);
    assert.match(html, /data-copy/);
    assert.match(html, /language-ts/);
    assert.match(html, /hljs/, "应被 highlight.js 处理");
  });

  test("未知语言降级为纯转义文本，不抛错", () => {
    const { html } = renderMarkdown("```notalanguage\n<x>\n```", identity);
    assert.match(html, /&lt;x&gt;/);
  });

  test("rewriteUrl 作用于链接与图片", () => {
    const { html } = renderMarkdown("[a](guide/a.md)\n\n![b](img/b.png)", {
      rewriteUrl: (h) => (h.endsWith(".md") ? `/d/${h}` : `/assets/${h}`),
    });
    assert.match(html, /href="\/d\/guide\/a\.md"/);
    assert.match(html, /src="\/assets\/img\/b\.png"/);
  });

  test("外链与锚点原样保留", () => {
    const { html } = renderMarkdown("[外](https://example.com) [锚](#a-b)", identity);
    assert.match(html, /href="https:\/\/example\.com"/);
    assert.match(html, /href="#a-b"/);
  });

  test("图片带 alt 文本", () => {
    const { html } = renderMarkdown("![示意图](a.png)", identity);
    assert.match(html, /alt="示意图"/);
  });

  test("代码块里的 # 不会被当成标题", () => {
    const { html, toc } = renderMarkdown("```\n# 这是注释\n```\n\n## 真标题", identity);
    assert.match(html, /<h2 id="真标题"/);
    assert.equal(toc.length, 1);
  });

  test("setext 标题也能分配 id（预扫描回归）", () => {
    const { html, toc } = renderMarkdown("标题一\n=====\n\n标题二\n-----\n", identity);
    assert.match(html, /<h1 id="标题一"/);
    assert.match(html, /<h2 id="标题二"/);
    // 目录默认只收 h2 及更深的层级，h1 是页面主标题，不进目录
    assert.deepEqual(toc.map((i) => i.text), ["标题二"]);
  });

  test("只有 h1 时目录回退到实际层级，不至于塌掉", () => {
    const { toc } = renderMarkdown("# 甲\n\n# 乙\n\n# 丙", identity);
    assert.equal(toc.length, 3, "没有 h2 时应保留 h1，而不是返回空目录");
  });

  test("同名标题 id 去重", () => {
    const { html } = renderMarkdown("## 安装\n\n## 安装\n\n## 安装", identity);
    assert.match(html, /id="安装"/);
    assert.match(html, /id="安装-2"/);
    assert.match(html, /id="安装-3"/);
  });

  test("中英文混排标题都能生成锚点", () => {
    const { html } = renderMarkdown("## 安装 Install 指南", identity);
    assert.match(html, /id="安装-install-指南"/);
  });

  test("每次调用互不影响（不共享 id 计数器）", () => {
    const src = "## 安装";
    const a = renderMarkdown(src, identity);
    const b = renderMarkdown(src, identity);
    assert.match(a.html, /id="安装"/);
    assert.match(b.html, /id="安装"/, "第二次渲染不应出现 安装-2");
  });
});