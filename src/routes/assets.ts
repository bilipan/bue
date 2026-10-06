import { relative, resolve, sep } from "node:path";

export type PathResult =
  | { ok: true; absPath: string }
  | { ok: false; reason: string };

/**
 * 把 URL 里的相对路径解析成绝对路径，并保证结果仍在 allowedRoot 之内。
 *
 * baseDir 只是解析的起点，可以是子目录（比如当前文档所在目录，
 * 这样 ../README.md 才能正确解析）；allowedRoot 才是安全边界——
 * 拿 baseDir 当边界会把工作区内合法的 ../ 误判成越界。
 *
 * 防护点（缺一个就是目录穿越漏洞）：
 *  - 拒绝含 NUL 的路径
 *  - decodeURIComponent 之后仍可能藏着 %2e%2e，所以要 decode 完再判
 *  - 拒绝绝对路径与盘符
 *  - resolve 之后必须仍在 allowedRoot 内
 */
export function safeResolve(allowedRoot: string, baseDir: string, urlPath: string): PathResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { ok: false, reason: "非法 URL 编码" };
  }

  if (decoded.includes("\0")) return { ok: false, reason: "路径含空字节" };

  // 统一成 POSIX 分隔符再判，Windows 上传来的可能是反斜杠
  const normalized = decoded.replace(/\\/g, "/");

  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return { ok: false, reason: "只允许站内相对路径" };
  }

  const rootAbs = resolve(allowedRoot);
  const absPath = resolve(resolve(baseDir), normalized);
  const rel = relative(rootAbs, absPath);

  // 精确判断越界：只拒绝 ".." 和 "../..."，避免误伤 ..foo 这类合法文件名
  if (rel === ".." || rel.startsWith(".." + sep)) {
    return { ok: false, reason: "路径越界" };
  }

  // 只查相对段：Windows 的绝对路径本身含盘符冒号，查全路径会把一切请求拒掉
  if (process.platform === "win32" && /[<>:"|?*]/.test(rel)) {
    return { ok: false, reason: "非法路径" };
  }

  return { ok: true, absPath };
}