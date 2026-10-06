import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { safeResolve } from "../src/routes/assets.ts";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "bue-root-"));
const docs = join(root, "docs");
mkdirSync(docs, { recursive: true });
mkdirSync(join(docs, "img"), { recursive: true });

describe("safeResolve", () => {
  test("放行普通相对路径", () => {
    const r = safeResolve(root, root, "a.png");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.absPath, join(root, "a.png"));
  });

  test("放行嵌套相对路径", () => {
    const r = safeResolve(root, root, "docs/img/b.svg");
    assert.equal(r.ok, true);
  });

  test("放行仍在根内的 ../（关键回归）", () => {
    // baseDir 是子目录时 ../ 必须能用，否则文档之间的相对链接全断
    const r = safeResolve(root, docs, "../README.md");
    assert.equal(r.ok, true, "../README.md 未越界，不该被拒");
    if (r.ok) assert.equal(r.absPath, join(root, "README.md"));
  });

  test("放行 ..foo 这类合法文件名", () => {
    const r = safeResolve(root, root, "..foo");
    assert.equal(r.ok, true, "..foo 不是目录穿越，不该被拒");
  });

  test("拦截逃出根目录的 ../", () => {
    const r = safeResolve(root, root, "../outside.md");
    assert.equal(r.ok, false);
  });

  test("拦截多重 ../", () => {
    const r = safeResolve(root, docs, "../../outside.md");
    assert.equal(r.ok, false);
  });

  test("拦截 URL 编码的 ../（%2e%2e）", () => {
    const r = safeResolve(root, root, "%2e%2e/%2e%2e/etc/passwd");
    assert.equal(r.ok, false);
  });

  test("拦截编码的斜杠 ..%2f", () => {
    const r = safeResolve(root, root, "..%2f..%2fetc%2fpasswd");
    assert.equal(r.ok, false);
  });

  test("拦截反斜杠形式的穿越", () => {
    const r = safeResolve(root, root, "..\\..\\etc\\passwd");
    assert.equal(r.ok, false);
  });

  test("拦截绝对路径", () => {
    assert.equal(safeResolve(root, root, "/etc/passwd").ok, false);
  });

  test("拦截 Windows 盘符", () => {
    assert.equal(safeResolve(root, root, "C:/Windows/system.ini").ok, false);
  });

  test("拦截空字节", () => {
    assert.equal(safeResolve(root, root, "a%00.md").ok, false);
  });

  test("拦截非法 URL 编码", () => {
    assert.equal(safeResolve(root, root, "%E0%A4%A").ok, false);
  });

  test("同名兄弟目录不会被误判为在根内", () => {
    // /tmp/bue-root-xxx-evil 不能因为字符串前缀像 /tmp/bue-root-xxx 就放行
    const r = safeResolve(root, root, "../bue-root-evil/file.md");
    assert.equal(r.ok, false);
  });
});