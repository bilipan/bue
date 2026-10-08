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

  test("链到目录指向该目录的 README", async () => {
    // 这两个文件都是 server 起来之后建的，不在启动时的清单里，
    // 所以从 /p/ 进去；重点是「链到目录」能落到一个真实页面
    writeFileSync(join(root, "guide", "README.md"), "# 指南首页\n");
    writeFileSync(join(root, "link-dir.md"), "[进指南](guide)\n");
    const r = await get("/p/link-dir.md");
    assert.equal(r.status, 200);
    assert.match(r.body, /href="\/p\/guide\/README\.md"/, "目录链接应指向该目录的 README");
    assert.equal((await get("/p/guide/README.md")).status, 200, "README 本身要打得开");
    rmSync(join(root, "guide", "README.md"));
    rmSync(join(root, "link-dir.md"));
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

describe("单文件模式下的文档间跳转（404 回归）", () => {
  let soloRoot: string;
  let solo: RunningServer;

  before(async () => {
    soloRoot = mkdtempSync(join(tmpdir(), "bue-solo-"));
    mkdirSync(join(soloRoot, "sub"), { recursive: true });
    // 只把 solo.md 传给 bue：workspace 里只有它一篇
    writeFileSync(join(soloRoot, "solo.md"), "# 单独\n\n[兄弟](other.md)\n[深层](sub/one.md)\n[目录](sub)\n");
    writeFileSync(join(soloRoot, "other.md"), "# 别的\n\n[回去](solo.md)\n");
    writeFileSync(join(soloRoot, "sub", "README.md"), "# 子目录首页\n");
    writeFileSync(join(soloRoot, "sub", "one.md"), "# 一\n\n## 小节\n\n[回上](../solo.md)\n");

    solo = await start({
      targets: [join(soloRoot, "solo.md")],
      port: 0,
      host: "127.0.0.1",
      theme: "auto",
      width: 768,
      toc: true,
    });
  });

  after(async () => {
    await solo?.close();
    rmSync(soloRoot, { recursive: true, force: true });
  });

  const getSolo = async (path: string) => {
    const res = await fetch(`${solo.url}${path}`);
    return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
  };

  test("链到没被扫描的兄弟文档不再 404（关键回归）", async () => {
    // 曾经的 bug：目标不在 workspace 清单里就原样返回相对 href，
    // 浏览器拿它对着 /solo.md 解析成 /other.md，必然 404
    const home = await getSolo("/");
    assert.match(home.body, /href="\/p\/other\.md"/, "应改写成能渲染的站内地址");
    const other = await getSolo("/p/other.md");
    assert.equal(other.status, 200, "点进去必须是 200，不是 404");
    assert.match(other.body, /别的/);
  });

  test("嵌套目录里的文档同样能打开，且带锚点", async () => {
    assert.equal((await getSolo("/p/sub/one.md")).status, 200);
    assert.equal((await getSolo("/p/sub/one.md#小节")).status, 200);
  });

  test("文档内继续跳转形成闭环", async () => {
    // solo.md 本身在 workspace 清单里，回链复用更短的 /d/solo
    const other = await getSolo("/p/other.md");
    assert.match(other.body, /href="\/d\/solo"/, "清单内的目标要复用 /d/ 地址");
    const one = await getSolo("/p/sub/one.md");
    assert.match(one.body, /href="\/d\/solo"/, "../solo.md 要能解析回根");
  });

  test("链到目录指向该目录的 README", async () => {
    assert.match((await getSolo("/")).body, /href="\/p\/sub\/README\.md"/);
    assert.equal((await getSolo("/p/sub/README.md")).status, 200);
  });

  test("文件真不存在时给 404 与提示页", async () => {
    writeFileSync(join(soloRoot, "gone.md"), "# 临时\n\n[没了](missing.md)\n");
    assert.match((await getSolo("/")).body, /href="\/p\/solo\.md"|href="\/p\/other\.md"/);
    const r = await getSolo("/p/missing.md");
    assert.equal(r.status, 404, "缺失文件必须是 404 状态码");
    assert.match(r.body, /找不到这个文档/);
    rmSync(join(soloRoot, "gone.md"));
  });

  test("/p/ 只认 markdown，非 markdown 一律 404", async () => {
    writeFileSync(join(soloRoot, "note.txt"), "不是 markdown\n");
    assert.equal((await getSolo("/p/note.txt")).status, 404);
    assert.equal((await getSolo("/p/sub")).status, 404, "目录本身不是文档");
  });

  test("/p/ 越界与 /assets/ 表现一致", async () => {
    // 裸 ../ 和 %2e%2e 都算 URL 的点段，先被规范化掉，压根到不了路由 → 404
    // （WHATWG URL 把 %2e%2e 也当点段，和 /assets/ 的既有行为一模一样）
    assert.equal((await getSolo("/p/../../../../etc/passwd")).status, 404);
    assert.equal((await getSolo("/p/%2e%2e/%2e%2e/etc/passwd")).status, 404);
    // %2f 编码的斜杠骗不过解析器，会穿到 safeResolve，必须 403
    assert.equal((await getSolo("/p/..%2f..%2f..%2fetc%2fpasswd")).status, 403);
  });
});

describe("slug 冲突时 /p/ 归一到 /d/", () => {
  test("清单里已有同 slug 的文档就 302 跳过去，不出现两个地址", async () => {
    // 目录模式：guide/install.md 在清单里，/p/guide/install.md 应 302 到 /d/guide/install
    const res = await fetch(`${server.url}/p/guide/install.md`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/d/guide/install");
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
