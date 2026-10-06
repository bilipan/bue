import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

export interface DocEntry {
  /** 站点内唯一标识，例如 "guide/install" */
  slug: string;
  /** 绝对路径 */
  absPath: string;
  /** 展示用标题（优先取文件内一级标题，退化为文件名） */
  title: string;
  /** 相对文档根目录的路径，用于分组展示 */
  relPath: string;
  /** 所属目录的 slug（根目录为 ""），用于导航树 */
  dirSlug: string;
}

export interface Workspace {
  /** 所有文档，按 slug 排序 */
  docs: DocEntry[];
  /** 文档根目录，所有静态资源相对它解析 */
  root: string;
  /** slug → 文档 */
  bySlug: Map<string, DocEntry>;
}

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "dist", "build", ".next", ".cache"]);

export function isMarkdown(file: string): boolean {
  return MARKDOWN_EXT.has(extname(file).toLowerCase());
}

/** 取文件名里的 slug：去扩展名、非法字符转连字符 */
function fileSlug(file: string): string {
  return basename(file, extname(file));
}

/**
 * 把相对路径的各段转成 slug，用 / 连接。
 * config 和 URL 重写器都必须走这个函数，否则两边的 slug 会漂移。
 */
export function slugifyPath(relPath: string): string {
  const segments = relPath
    .split(sep)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
  return segments.join("/");
}

/** 从 markdown 源码里粗取第一个一级标题，作为导航标题 */
function titleFromSource(source: string, fallback: string): string {
  const m = /^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(source);
  if (m?.[1]) return m[1].trim();
  return fallback;
}

function dirSlugOf(relPath: string): string {
  const dir = dirname(relPath);
  return dir === "." ? "" : dir.split(sep).join("/");
}

function walk(dir: string, root: string, out: DocEntry[], depth: number): void {
  if (depth > 12) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(abs, root, out, depth + 1);
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      const relPath = relative(root, abs);
      out.push(makeEntry(abs, relPath));
    }
  }
}

function makeEntry(abs: string, relPath: string): DocEntry {
  const stem = slugifyPath(fileSlug(relPath));
  let title = stem || "untitled";
  try {
    title = titleFromSource(readFileSync(abs, "utf8"), title);
  } catch {
    /* 读不到就用文件名，渲染时再报具体错误 */
  }
  const relDir = dirSlugOf(relPath);
  const slug = relDir ? `${slugifyPath(relDir)}/${stem}` : stem;
  return { slug, absPath: abs, title, relPath, dirSlug: relDir };
}

/**
 * 把 CLI 参数解析成一份文档清单 + 文档根目录。
 * - 单个 .md → 根目录 = 该文件所在目录，slug = 文件名
 * - 多个文件 / 目录 → 根目录 = 它们的公共祖先目录，slug = 相对路径
 */
export function buildWorkspace(targets: string[]): Workspace {
  const abs: string[] = [];
  let root: string;

  // 目标不存在时要立刻报错，而不是静默起一个处处 404 的服务器
  for (const t of targets) {
    if (!existsSync(resolve(t))) throw new Error(`路径不存在：${resolve(t)}`);
  }

  if (targets.length === 1 && isDirectory(resolve(targets[0]!))) {
    root = resolve(targets[0]!);
    const docs: DocEntry[] = [];
    walk(root, root, docs, 0);
    return finish(docs, root);
  }

  for (const t of targets) {
    const p = resolve(t);
    if (isDirectory(p)) {
      const docs: DocEntry[] = [];
      walk(p, p, docs, 0);
      abs.push(...docs.map((d) => d.absPath));
    } else if (!isMarkdown(p)) {
      throw new Error(
        `不是 Markdown 文件：${p}\n` +
          `bue 只支持 ${[...MARKDOWN_EXT].join(" / ")}，请换一个文件，或直接传它所在的目录。`,
      );
    } else {
      abs.push(p);
    }
  }

  root = abs.length === 1 ? dirname(abs[0]!) : commonAncestor(abs);
  const seen = new Set<string>();
  const docs: DocEntry[] = [];
  for (const p of abs) {
    const rel = relative(root, p);
    if (rel.startsWith("..") || seen.has(rel)) continue;
    seen.add(rel);
    docs.push(makeEntry(p, rel));
  }
  return finish(docs, root);
}

function finish(docs: DocEntry[], root: string): Workspace {
  docs.sort((a, b) => a.slug.localeCompare(b.slug, "zh"));
  // slug 冲突（同目录不同扩展名，如 a.md 与 a.markdown）时保留先出现的
  const bySlug = new Map<string, DocEntry>();
  for (const d of docs) if (!bySlug.has(d.slug)) bySlug.set(d.slug, d);
  return { docs: [...bySlug.values()], root, bySlug };
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function commonAncestor(files: string[]): string {
  if (files.length === 0) return process.cwd();
  const split = files.map((f) => resolve(f).split(sep));
  const first = split[0]!;
  let common = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < common && i < parts.length && parts[i] === first[i]) i++;
    common = i;
  }
  return first.slice(0, common).join(sep) || sep;
}