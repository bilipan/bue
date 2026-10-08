import { readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  docEntryFor,
  isDirectory,
  isMarkdown,
  README_EXTS,
  slugifyPath,
  stripMarkdownExt,
  type DocEntry,
  type Workspace,
} from "../config.ts";
import { renderMarkdown } from "../render/markdown.ts";
import { renderNotFound, renderShell } from "../ui/shell.ts";
import { renderIndex } from "./index.ts";
import { safeResolve } from "./assets.ts";
import { isRegularFile, isVendorPath, mimeType, serveVendor } from "./vendor.ts";
import type { RenderSettings } from "../settings.ts";

function html(body: string, status = 200): Response {
  // 每次请求都重新渲染，不给浏览器留旧副本，Cmd+R 一定拿到最新内容
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 404 必须带 404 状态码，否则浏览器和缓存会当成正常页面 */
function notFound(message: string, detail = ""): Response {
  return html(renderNotFound(message, detail), 404);
}

/**
 * markdown 里的相对 URL 处理。三种目标：
 *  - 指向本地 .md → 改写成站内路由，这样目录模式能真正跳转
 *  - 指向目录 → 改写成该目录的 README（没有就原样留下）
 *  - 其余相对路径（图片、pdf…）→ 改写成 /assets/<相对根目录的路径>，
 *    否则 /d/guide/install 页面里的 ../img/a.png 会被解析到 /d/img/ 下
 *
 * .md 目标分两种地址：扫进 workspace 的用 /d/<slug>（短、稳定）；
 * 没扫进来的（单文件模式最常见：只装了一篇，却链到隔壁的 b.md）
 * 用 /p/<路径> 按盘上文件直接渲染。绝不能因为「不在清单里」就把原始相对
 * href 丢回浏览器——浏览器会拿它对着 /d/<slug> 解析，必然 404。
 */
function createUrlRewriter(workspace: Workspace, doc: DocEntry) {
  const slugs = new Set(workspace.docs.map((d) => d.slug));

  function encodePath(rel: string): string {
    return rel.split("/").map(encodeURIComponent).join("/");
  }

  const rewrite: (href: string) => string = (href) => {
    if (!href) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) {
      return href;
    }

    const hashAt = href.indexOf("#");
    const hash = hashAt === -1 ? "" : href.slice(hashAt);
    const withoutHash = hashAt === -1 ? href : href.slice(0, hashAt);
    const queryAt = withoutHash.indexOf("?");
    const query = queryAt === -1 ? "" : withoutHash.slice(queryAt);
    const clean = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
    if (!clean) return href;

    // 相对路径是相对「当前文档所在目录」，不是相对文档根目录
    const docDir = doc.dirSlug ? resolve(workspace.root, doc.dirSlug) : workspace.root;
    const abs = safeResolve(workspace.root, docDir, clean);
    if (!abs.ok) return href;

    const rel = relative(workspace.root, abs.absPath).split(sep).join("/");
    const suffix = `${query}${hash}`;

    // 链到目录：指向该目录的 README，符合「进文件夹看首页」的直觉
    if (isDirectory(abs.absPath)) {
      const readme = findReadmeIn(abs.absPath);
      if (!readme) return href;
      return rewrite(relative(docDir, readme).split(sep).join("/") + suffix);
    }

    if (isMarkdown(rel)) {
      const slug = slugifyPath(stripMarkdownExt(rel));
      const base = slugs.has(slug) ? `/d/${encodePath(slug)}` : `/p/${encodePath(rel)}`;
      return `${base}${suffix}`;
    }

    return `/assets/${encodePath(rel)}${suffix}`;
  };

  return rewrite;
}

/** 目录里的 README（任一受支持的扩展名），用来解析「链到目录」的链接 */
function findReadmeIn(dir: string): string | undefined {
  for (const ext of README_EXTS) {
    const candidate = join(dir, `README${ext}`);
    if (isRegularFile(candidate)) return candidate;
  }
  return undefined;
}

function renderDoc(doc: DocEntry, workspace: Workspace, settings: RenderSettings): Response {
  let source: string;
  try {
    source = readFileSync(doc.absPath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return notFound("读取文件失败", `${doc.relPath}（${err.code ?? err.message}）`);
  }

  const { html: body, toc } = renderMarkdown(source, {
    rewriteUrl: createUrlRewriter(workspace, doc),
  });
  const crumb = doc.relPath.split(sep);

  return html(
    renderShell({
      title: `${doc.title} · bue`,
      breadcrumb: crumb,
      bodyHtml: body,
      toc,
      theme: settings.theme,
      width: settings.width,
      showToc: settings.toc,
      showSwitcher: workspace.docs.length > 1,
    }),
  );
}

function serveAsset(workspace: Workspace, pathname: string): Response {
  const rel = pathname.slice("/assets/".length);
  const safe = safeResolve(workspace.root, workspace.root, rel);
  if (!safe.ok) return forbidden(safe.reason);
  if (!isRegularFile(safe.absPath)) return new Response("404 Not Found", { status: 404 });

  try {
    const body = readFileSync(safe.absPath);
    return new Response(body, {
      headers: {
        "content-type": mimeType(safe.absPath),
        "cache-control": "no-cache",
      },
    });
  } catch {
    return new Response("500 Internal Server Error", { status: 500 });
  }
}

function serveRaw(workspace: Workspace, slug: string): Response {
  const doc = workspace.bySlug.get(slug);
  if (!doc) return new Response("404 Not Found", { status: 404 });
  try {
    return new Response(readFileSync(doc.absPath, "utf8"), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("500 Internal Server Error", { status: 500 });
  }
}

/**
 * 按盘上路径渲染一篇 markdown：`/p/<相对根目录的路径>`。
 *
 * workspace 是启动时扫出来的清单，单文件模式只装了一篇，
 * 但文档里链到的兄弟文件同样在磁盘上、同样该能打开。
 * 安全边界仍然是工作区根目录，和 /assets/ 一致。
 */
function servePath(workspace: Workspace, urlPath: string, settings: RenderSettings): Response {
  const safe = safeResolve(workspace.root, workspace.root, urlPath);
  if (!safe.ok) return forbidden(safe.reason);
  if (!isRegularFile(safe.absPath) || !isMarkdown(safe.absPath)) {
    return notFound("找不到这个文档", urlPath);
  }

  const relPath = relative(workspace.root, safe.absPath);
  // slug 已经被清单占着时（同名不同扩展名）走 /d/，避免两个地址抢一篇文档
  const entry = docEntryFor(safe.absPath, relPath);
  if (workspace.bySlug.has(entry.slug)) {
    return redirect(`/d/${entry.slug.split("/").map(encodeURIComponent).join("/")}`);
  }
  return renderDoc(entry, workspace, settings);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

/** 路径越界这类请求一律 403，和 /assets/ 保持一致，不要混成 404 */
function forbidden(reason: string): Response {
  return new Response(`403 ${reason}`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** 首页：单文件直接渲染；多文件优先 README，否则给索引页 */
function serveRoot(workspace: Workspace, settings: RenderSettings): Response {
  const readme = findReadme(workspace);
  if (readme) return renderDoc(readme, workspace, settings);
  if (workspace.docs.length === 1) return renderDoc(workspace.docs[0]!, workspace, settings);
  return html(
    renderShell({
      title: "文档索引 · bue",
      breadcrumb: [basename(workspace.root)],
      bodyHtml: renderIndex(workspace),
      toc: [],
      theme: settings.theme,
      width: settings.width,
      showToc: false,
      showSwitcher: false,
    }),
  );
}

function findReadme(workspace: Workspace): DocEntry | undefined {
  return workspace.docs.find((d) => d.dirSlug === "" && /^readme$/i.test(d.slug));
}

export function createHandler(workspace: Workspace, settings: RenderSettings) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    let response: Response;

    try {
      response = route(pathname, workspace, settings);
    } catch (e) {
      const err = e as Error;
      process.stderr.write(`bue: 处理 ${pathname} 时出错：${err.stack ?? err.message}\n`);
      response = notFound("服务端渲染出错", err.message);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

function route(pathname: string, workspace: Workspace, settings: RenderSettings): Response {
  if (isVendorPath(pathname)) return serveVendor(pathname);
  if (pathname.startsWith("/assets/")) return serveAsset(workspace, pathname);
  if (pathname.startsWith("/raw/")) return serveRaw(workspace, decodeSegment(pathname.slice("/raw/".length)));
  if (pathname.startsWith("/p/")) {
    return servePath(workspace, pathname.slice("/p/".length), settings);
  }
  if (pathname.startsWith("/d/")) {
    const slug = decodeSegment(pathname.slice("/d/".length));
    const doc = workspace.bySlug.get(slug);
    return doc ? renderDoc(doc, workspace, settings) : notFound("文档不存在", pathname);
  }
  if (pathname === "/") return serveRoot(workspace, settings);
  return notFound("没有这个路由", pathname);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}