import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError } from "../src/args.ts";

describe("parseArgs", () => {
  test("单个目标 + 默认选项", () => {
    const r = parseArgs(["README.md"]);
    assert.equal(r.kind, "options");
    if (r.kind !== "options") return;
    assert.deepEqual(r.options.targets, ["README.md"]);
    assert.equal(r.options.port, undefined);
    assert.equal(r.options.host, "127.0.0.1");
    assert.equal(r.options.theme, "auto");
    assert.equal(r.options.width, 768);
    assert.equal(r.options.toc, true);
    assert.equal(r.options.open, true);
  });

  test("多个目标", () => {
    const r = parseArgs(["a.md", "b.md"]);
    if (r.kind !== "options") throw new Error("期望 options");
    assert.deepEqual(r.options.targets, ["a.md", "b.md"]);
  });

  test("--port 与 -p 等价", () => {
    for (const flag of ["--port", "-p"]) {
      const r = parseArgs(["a.md", flag, "4000"]);
      if (r.kind !== "options") throw new Error("期望 options");
      assert.equal(r.options.port, 4000);
    }
  });

  test("--theme 校验取值", () => {
    for (const t of ["auto", "light", "dark"]) {
      const r = parseArgs(["a.md", "--theme", t]);
      if (r.kind !== "options") throw new Error("期望 options");
      assert.equal(r.options.theme, t);
    }
    assert.throws(() => parseArgs(["a.md", "--theme", "blue"]), UsageError);
  });

  test("--no-toc / --no-open 关闭开关", () => {
    const r = parseArgs(["a.md", "--no-toc", "--no-open"]);
    if (r.kind !== "options") throw new Error("期望 options");
    assert.equal(r.options.toc, false);
    assert.equal(r.options.open, false);
  });

  test("--width 边界", () => {
    const ok = parseArgs(["a.md", "--width", "320"]);
    if (ok.kind !== "options") throw new Error("期望 options");
    assert.equal(ok.options.width, 320);
    assert.throws(() => parseArgs(["a.md", "--width", "10"]), UsageError);
    assert.throws(() => parseArgs(["a.md", "--width", "abc"]), UsageError);
  });

  test("--help / -h", () => {
    assert.equal(parseArgs(["--help"]).kind, "help");
    assert.equal(parseArgs(["-h"]).kind, "help");
  });

  test("--version / -v 优先于其他参数", () => {
    assert.equal(parseArgs(["-v", "a.md"]).kind, "version");
  });

  test("缺少选项值报错", () => {
    assert.throws(() => parseArgs(["a.md", "--port"]), UsageError);
    assert.throws(() => parseArgs(["a.md", "--theme"]), UsageError);
  });

  test("未知选项报错", () => {
    assert.throws(() => parseArgs(["a.md", "--nope"]), UsageError);
  });

  test("无目标报错", () => {
    assert.throws(() => parseArgs([]), UsageError);
    assert.throws(() => parseArgs(["--port", "3000"]), UsageError);
  });

  test("非选项参数可含短横线开头以外的字符", () => {
    const r = parseArgs(["./a-b/c.md"]);
    if (r.kind !== "options") throw new Error("期望 options");
    assert.deepEqual(r.options.targets, ["./a-b/c.md"]);
  });
});