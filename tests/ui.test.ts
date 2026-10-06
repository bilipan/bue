import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderShell } from "../src/ui/shell.ts";

const themeCss = readFileSync(new URL("../src/ui/theme.css", import.meta.url), "utf8");
const clientJs = readFileSync(new URL("../src/ui/client.js", import.meta.url), "utf8");

/*
 * 回归护栏：这个 bug 出现过一次——宽屏下目录常驻，而 CSS 里有
 * body.toc-open { overflow: hidden }，导致目录一显示整页就再也滚不动。
 * 这些断言的作用就是让"锁死页面滚动"这种写法以后无法悄悄溜回来。
 */
describe("页面滚动任何时候都必须可用", () => {
  test("CSS 不得给 body / html 加 overflow: hidden", () => {
    const offenders = themeCss
      .split("\n")
      .map((line, i) => ({ line: line.trim(), i }))
      .filter(({ line }) => /^(body|html)\b[^,{]*\{?[^}]*overflow\s*:\s*hidden/.test(line));
    assert.deepEqual(
      offenders.map((o) => `第 ${o.i + 1} 行: ${o.line}`),
      [],
      "锁定 body/html 滚动会让目录一显示页面就滚不动",
    );
  });

  test("CSS 里没有 body.toc-open 这类加锁开关", () => {
    assert.doesNotMatch(themeCss, /body\.toc-open/, "不要再用 body class 控制滚动锁定");
  });

  test("客户端不再通过 body class 控制目录状态", () => {
    assert.doesNotMatch(clientJs, /document\.body\.classList/, "目录开关不该再挂在 body 上");
  });

  test("没有全屏遮罩：遮罩会吃掉正文区域的触摸滚动", () => {
    assert.doesNotMatch(themeCss, /\.scrim/, "不要用遮罩隔离抽屉");
    const html = renderShell({
      title: "t",
      breadcrumb: ["a"],
      bodyHtml: "<p>x</p>",
      toc: [],
      theme: "auto",
      width: 768,
      showToc: false,
      showSwitcher: false,
    });
    assert.doesNotMatch(html, /class="scrim"/, "外壳里不应再输出遮罩元素");
  });

  test("抽屉自身可独立滚动，且不锁住文档滚动", () => {
    assert.match(themeCss, /\.bue-toc\s*\{[^}]*overflow-y:\s*auto/s, "目录面板应能自己滚动");
    assert.match(themeCss, /overscroll-behavior:\s*contain/, "抽屉滚动不应把滚动传给页面");
  });

  test("区分拖动与点击：拖动滚动不应关闭抽屉", () => {
    assert.match(clientJs, /pointerdown/, "要记录按下位置来区分拖动和点击");
    assert.match(clientJs, />\s*8\s*\|/, "位移超过阈值应判定为拖动而非点击");
  });
});

describe("宽屏目录是常驻侧栏", () => {
  /** 取某个 addEventListener 处理器开头的一段文本，用于检查守卫顺序 */
  function handlerHead(marker: string, length = 400): string {
    const i = clientJs.indexOf(marker);
    assert.notEqual(i, -1, `client.js 里应存在 ${marker}`);
    return clientJs.slice(i, i + length);
  }

  test("点目录项：宽屏守卫必须排在 close() 之前", () => {
    const head = handlerHead('toc.addEventListener("click"');
    const guard = head.indexOf("if (wide.matches) return;");
    const closeCall = head.indexOf("close()");
    assert.notEqual(guard, -1, "点目录项的处理器必须先判断视口宽度");
    assert.notEqual(closeCall, -1);
    assert.ok(guard < closeCall, "宽屏时必须提前 return，不能走到 close()");
  });

  test("文档级外部点击：宽屏守卫必须排在 close() 之前", () => {
    const head = handlerHead('document.addEventListener("click"');
    const guard = head.indexOf("if (wide.matches) return;");
    const closeCall = head.indexOf("close()");
    assert.notEqual(guard, -1, "宽屏常驻侧栏不应被外部点击关掉");
    assert.ok(guard < closeCall);
  });
});
