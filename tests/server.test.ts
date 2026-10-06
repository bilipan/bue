import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, type RunningServer } from "../src/server.ts";

let root: string;
let server: RunningServer;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "bue-e2e-"));
  mkdirSync(join(root, "guide", "img"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# 首页\n\n[去安装页](guide/install.md)\n");
  writeFileSync(join(root, "guide", "install.md"), "# 安装\n\n[回首页](../README.md)\n");
  writeFileSync(join(root, "guide", "img", "p.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(root, "x.txt"), "不是 markdown\n");

  server = await start({
    targets: [root],
    port: 0,
    host: "127.0.0.1",
    theme: "auto",
    width: 768,
    toc: true,
  });
});

after(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; type: string; body: string }> {
  const res = await fetch(`${server.url}${path}`);
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

describe("目录模式路由", () => {
  test("首页渲染 README", async () => {
    const r = await get("/");
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/html/);
    assert.match(r.body, /首页/);
  });

  test("首页 HTML 不缓存，保证 Cmd+R 拿到新内容", async () => {
    const res = await fetch(`${server.url}/`);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("子文档通过 /d/<slug> 访问", async () => {
    const r = await get("/d/guide/install");
    assert.equal(r.status, 200);
    assert.match(r.body, /安装/);
  });

  test("/raw 返回原始 markdown", async () => {
    const r = await get("/raw/guide/install");
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/plain/);
    assert.match(r.body, /^# 安装/);
  });

  test("相对 .md 链接被改写成站内路由", async () => {
    assert.match((await get("/")).body, /href="\/d\/guide\/install"/);
    // ../README.md 也必须能改写（工作区内的 ../ 不是越界）
    assert.match((await get("/d/guide/install")).body, /href="\/d\/readme"/);
  });

  test("相对图片被改写成 /assets/", async () => {
    writeFileSync(join(root, "README.md"), "# 首页\n\n![图](guide/img/p.svg)\n");
    assert.match((await get("/")).body, /src="\/assets\/guide\/img\/p\.svg"/);
  });

  test("静态资源可访问且 MIME 正确", async () => {
    const r = await get("/assets/guide/img/p.svg");
    assert.equal(r.status, 200);
    assert.match(r.type, /image\/svg\+xml/);
  });

  test("vendor 资源可访问", async () => {
    const res = await fetch(`${server.url}/vendor/mermaid.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
  });

  test("hljs 主题可访问", async () => {
    assert.equal((await get("/vendor/hljs/github.css")).status, 200);
    assert.equal((await get("/vendor/hljs/github-dark.css")).status, 200);
  });
});

describe("错误处理", () => {
  test("不存在的文档返回 404（不是 200）", async () => {
    const r = await get("/d/nope");
    assert.equal(r.status, 404);
  });

  test("不存在的路由返回 404", async () => {
    assert.equal((await get("/nope")).status, 404);
  });

  test("不存在的 raw 返回 404", async () => {
    assert.equal((await get("/raw/nope")).status, 404);
  });

  test("目录穿越返回 403", async () => {
    const r = await get("/assets/..%2f..%2f..%2fetc%2fpasswd");
    assert.equal(r.status, 403);
  });

  test("越界的 ../ 也被拒绝", async () => {
    assert.equal((await get("/assets/../../../../etc/passwd")).status, 404);
  });
});

describe("实时重渲染", () => {
  test("每次请求都重新读盘", async () => {
    writeFileSync(join(root, "README.md"), "# 改过的标题\n");
    assert.match((await get("/")).body, /改过的标题/);
    writeFileSync(join(root, "README.md"), "# 又改一次\n");
    assert.match((await get("/")).body, /又改一次/);
  });
});
describe("启动参数校验", () => {
  test("路径不存在时 start 直接抛错", async () => {
    await assert.rejects(
      () => start({ targets: [join(root, "不存在.md")], port: 0, host: "127.0.0.1", theme: "auto", width: 768, toc: true }),
      /路径不存在/,
    );
  });

  test("非 Markdown 文件被拒绝", async () => {
    await assert.rejects(
      () => start({ targets: [join(root, "x.txt")], port: 0, host: "127.0.0.1", theme: "auto", width: 768, toc: true }),
      /不是 Markdown 文件/,
    );
  });

  test("显式指定已占用的端口时报错并给出换端口建议", async () => {
    await assert.rejects(
      () => start({ targets: [root], port: server.port, host: "127.0.0.1", theme: "auto", width: 768, toc: true }),
      /已被占用/,
    );
  });

  test("未指定端口时会向上探测，而不是死磕 3000", async () => {
    const second = await start({ targets: [root], port: undefined, host: "127.0.0.1", theme: "auto", width: 768, toc: true });
    try {
      assert.ok(second.port >= 3000);
      assert.notEqual(second.port, server.port, "第二个实例应换端口");
    } finally {
      await second.close();
    }
  });
});
