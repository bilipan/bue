import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspace, slugifyPath, isMarkdown } from "../src/config.ts";

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "bue-ws-"));
  mkdirSync(join(root, "guide"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, ".hidden"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# README 标题\n");
  writeFileSync(join(root, "Guide Notes.md"), "# 散装笔记\n");
  writeFileSync(join(root, "notes.txt"), "不是 markdown\n");
  writeFileSync(join(root, "guide", "Install Steps.md"), "# 安装步骤\n");
  writeFileSync(join(root, "guide", "api.md"), "# API\n");
  writeFileSync(join(root, "guide", "Bare Notes.md"), "只有正文，没有标题。\n");
  writeFileSync(join(root, "node_modules", "pkg", "README.md"), "# 不该被扫到\n");
  writeFileSync(join(root, ".hidden", "secret.md"), "# 隐藏目录不该被扫到\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

describe("slugifyPath", () => {
  test("保留目录分隔符", () => {
    assert.equal(slugifyPath("guide/install-steps"), "guide/install-steps");
  });

  test("每段独立小写化", () => {
    assert.equal(slugifyPath("Guide/Install"), "guide/install");
  });

  test("去掉空段", () => {
    assert.equal(slugifyPath("guide//install"), "guide/install");
  });

  test("中文保留", () => {
    assert.equal(slugifyPath("指南/安装"), "指南/安装");
  });
});

describe("isMarkdown", () => {
  test("识别支持的扩展名", () => {
    for (const f of ["a.md", "a.markdown", "a.mdown", "a.mkd", "A.MD"]) {
      assert.equal(isMarkdown(f), true, f);
    }
  });

  test("拒绝其他扩展名", () => {
    for (const f of ["a.txt", "a.ts", "a.mdx", "a"]) {
      assert.equal(isMarkdown(f), false, f);
    }
  });
});

describe("buildWorkspace", () => {
  test("目录模式：递归收集、跳过忽略目录", () => {
    const ws = buildWorkspace([root]);
    const slugs = new Set(ws.docs.map((d) => d.slug));
    assert.deepEqual(
      [...slugs].sort(),
      ["guide-notes", "guide/api", "guide/bare-notes", "guide/install-steps", "readme"],
    );
    assert.equal(ws.root, root);
  });

  test("标题优先取文件内一级标题", () => {
    const ws = buildWorkspace([root]);
    const bySlug = new Map(ws.docs.map((d) => [d.slug, d]));
    assert.equal(bySlug.get("readme")?.title, "README 标题");
    assert.equal(bySlug.get("guide/install-steps")?.title, "安装步骤");
  });

  test("没有一级标题时退化为文件名 slug", () => {
    const ws = buildWorkspace([root]);
    const plain = ws.bySlug.get("guide/bare-notes");
    assert.equal(plain?.title, "bare-notes", "无标题时应回落到文件名 slug");
  });

  test("slug 与 URL 重写器一致（嵌套目录）", () => {
    const ws = buildWorkspace([root]);
    // slugifyPath 与 buildWorkspace 必须给出同一个 slug，否则站内跳转会失效
    assert.ok(ws.bySlug.has(slugifyPath("guide/install-steps")));
    assert.ok(ws.bySlug.has(slugifyPath("README")));
  });

  test("单文件：根目录是文件所在目录，而不是文件本身", () => {
    const ws = buildWorkspace([join(root, "guide", "api.md")]);
    assert.equal(ws.root, join(root, "guide"));
    assert.equal(ws.docs.length, 1);
    assert.equal(ws.docs[0]?.slug, "api");
  });

  test("单文件：根目录用于解析相对资源", () => {
    const ws = buildWorkspace([join(root, "README.md")]);
    assert.equal(ws.root, root, "图片 ./guide/img/x.png 要能相对根目录解析");
  });

  test("多文件：根目录是公共祖先", () => {
    const ws = buildWorkspace([join(root, "README.md"), join(root, "guide", "api.md")]);
    assert.equal(ws.root, root);
    assert.deepEqual([...new Set(ws.docs.map((d) => d.slug))].sort(), ["guide/api", "readme"]);
  });

  test("dirSlug 记录所属目录", () => {
    const ws = buildWorkspace([root]);
    const nested = ws.bySlug.get("guide/api");
    assert.equal(nested?.dirSlug, "guide");
    assert.equal(ws.bySlug.get("readme")?.dirSlug, "");
  });
});
describe("buildWorkspace 的输入校验", () => {
  test("路径不存在时立刻报错，而不是起一个处处 404 的服务器", () => {
    assert.throws(() => buildWorkspace([join(root, "不存在.md")]), /路径不存在/);
  });

  test("非 Markdown 文件给出明确提示", () => {
    assert.throws(() => buildWorkspace([join(root, "notes.txt")]), /不是 Markdown 文件/);
  });

  test("目录里没有 markdown 时返回空清单（由 server 层转成友好提示）", () => {
    const empty = mkdtempSync(join(tmpdir(), "bue-empty-"));
    writeFileSync(join(empty, "x.txt"), "不是 markdown\n");
    const ws = buildWorkspace([empty]);
    assert.equal(ws.docs.length, 0);
    rmSync(empty, { recursive: true, force: true });
  });
});
