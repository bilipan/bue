import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { slugifyHeading, createIdAllocator, pruneToc } from "../src/render/toc.ts";

describe("slugifyHeading", () => {
  test("英文标题小写并用连字符连接", () => {
    assert.equal(slugifyHeading("Getting Started"), "getting-started");
  });

  test("保留中文", () => {
    assert.equal(slugifyHeading("快速开始"), "快速开始");
  });

  test("中英混排", () => {
    assert.equal(slugifyHeading("安装 Install 指南"), "安装-install-指南");
  });

  test("去掉标点", () => {
    assert.equal(slugifyHeading("Hello, World! (2026)"), "hello-world-2026");
  });

  test("空标题有兜底", () => {
    assert.equal(slugifyHeading("   "), "section");
    assert.equal(slugifyHeading("!!!"), "section");
  });

  test("连续空白折叠成一个连字符", () => {
    assert.equal(slugifyHeading("a    b"), "a-b");
  });
});

describe("createIdAllocator", () => {
  test("首次出现不加后缀", () => {
    const alloc = createIdAllocator();
    assert.equal(alloc("安装"), "安装");
  });

  test("重复标题依次加后缀", () => {
    const alloc = createIdAllocator();
    assert.equal(alloc("安装"), "安装");
    assert.equal(alloc("安装"), "安装-2");
    assert.equal(alloc("安装"), "安装-3");
  });

  test("不同标题互不影响", () => {
    const alloc = createIdAllocator();
    assert.equal(alloc("A"), "a");
    assert.equal(alloc("B"), "b");
    assert.equal(alloc("A"), "a-2");
  });
});

describe("pruneToc", () => {
  const item = (depth: number, text: string) => ({ id: text, text, depth });

  test("有 h2 时保留 h2/h3", () => {
    const got = pruneToc([item(2, "a"), item(3, "b"), item(4, "c")]);
    assert.deepEqual(got.map((i) => i.text), ["a", "b"]);
  });

  test("只有 h1 时回退保留全部", () => {
    const got = pruneToc([item(1, "a"), item(1, "b")]);
    assert.equal(got.length, 2);
  });

  test("空输入返回空", () => {
    assert.deepEqual(pruneToc([]), []);
  });

  test("层级跳跃时不丢内容", () => {
    const got = pruneToc([item(2, "a"), item(5, "deep")]);
    assert.ok(got.length > 0);
  });
});