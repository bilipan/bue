import type { DocEntry, Workspace } from "../config.ts";
import { escapeHtml } from "../ui/shell.ts";

/**
 * 目录模式下没有 README 时的兜底索引页。
 * 按目录分组展示，让嵌套的文档结构一眼可见。
 */
export function renderIndex(workspace: Workspace): string {
  const groups = new Map<string, DocEntry[]>();
  for (const doc of workspace.docs) {
    const key = doc.dirSlug;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh"))
    .map(([dir, docs]) => {
      const heading = dir
        ? `<h2>${escapeHtml(dir)}</h2>`
        : "<h2>根目录</h2>";
      const items = docs
        .map(
          (d) =>
            `<li><a href="/d/${encodeURI(d.slug)}">${escapeHtml(d.title)}</a>` +
            `<div class="path">${escapeHtml(d.relPath)}</div></li>`,
        )
        .join("\n");
      return `${heading}\n<ul class="file-list">\n${items}\n</ul>`;
    })
    .join("\n");

  const total = workspace.docs.length;
  return `<h1>文档索引</h1>
<p>共 ${total} 篇文档，来自 <code>${escapeHtml(workspace.root)}</code></p>
${sections}\n`;
}