import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * 前端依赖以静态文件提供。只列白名单里的几个文件，不开放整个 node_modules。
 * mermaid 走 dist/mermaid.min.js 这个 UMD 单文件——它内部没有动态 import，
 * 所以不会出现 mermaid.esm 入口那种按需拉 chunk 的瀑布。
 *
 * 进程内缓存：这些文件在一次运行期间不会变，没必要每个请求重读 5.5MB。
 */
const cache = new Map<string, string>();

function load(specifier: string): string {
  const hit = cache.get(specifier);
  if (hit !== undefined) return hit;
  const text = readFileSync(require.resolve(specifier), "utf8");
  cache.set(specifier, text);
  return text;
}

const VENDOR: Record<string, { specifier: string; type: string }> = {
  "/vendor/mermaid.js": { specifier: "mermaid/dist/mermaid.min.js", type: "text/javascript; charset=utf-8" },
  "/vendor/hljs/github.css": { specifier: "highlight.js/styles/github.css", type: "text/css; charset=utf-8" },
  "/vendor/hljs/github-dark.css": { specifier: "highlight.js/styles/github-dark.css", type: "text/css; charset=utf-8" },
};

export function isVendorPath(pathname: string): boolean {
  return pathname in VENDOR;
}

export function serveVendor(pathname: string): Response {
  const entry = VENDOR[pathname];
  if (!entry) return new Response("Not Found", { status: 404 });

  try {
    return new Response(load(entry.specifier), {
      headers: {
        "content-type": entry.type,
        "cache-control": "public, max-age=3600, must-revalidate",
      },
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return new Response(
      `bue: 无法加载 ${pathname}（${err.code ?? err.message}）。请确认依赖已安装：pnpm install`,
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}

/** 静态资源的 MIME 表，只覆盖预览场景会遇到的类型 */
export function mimeType(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return table[ext] ?? "application/octet-stream";
}

export function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}