export interface TocItem {
  id: string;
  text: string;
  depth: number;
}

/**
 * 把标题文本转成 URL fragment。
 * 保留 CJK 与字母数字，其余折叠成连字符；中文标题也能得到稳定可读的锚点。
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * 创建标题 id 分配器：同名标题按出现顺序加 -2 / -3 后缀。
 * 必须在渲染时直接调用，不能靠预扫描源码来预测——marked 还会识别
 * setext 标题和引用块内的标题，预扫描的正则会漏算导致 id 整体错位。
 */
export function createIdAllocator(): (text: string) => string {
  const used = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

/**
 * 决定目录里保留哪些层级：默认展示 h2/h3；若全文没有 h2，就回退到实际出现过的最浅两层。
 * 避免长文目录被 h4 以下淹没，也避免短文目录整个塌掉。
 */
export function pruneToc(items: TocItem[]): TocItem[] {
  if (items.length === 0) return [];
  const hasH2 = items.some((i) => i.depth <= 2);
  const shallowest = Math.min(...items.map((i) => i.depth));
  const base = hasH2 ? 2 : shallowest;
  const limit = base + 2;
  const pruned = items.filter((i) => i.depth >= base && i.depth < limit);
  return pruned.length > 0 ? pruned : items.slice(0, 60);
}