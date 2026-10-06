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

describe("mermaid 图缩放", () => {
  test("缩放走内联 style.width，并清掉 mermaid 写的内联 max-width", () => {
    // mermaid 会给 svg 写 style="max-width: 380px"，不清掉放大就会被卡死
    assert.match(clientJs, /\.style\.width\s*=/, "缩放应直接改 svg 的内联宽度");
    assert.match(clientJs, /\.style\.maxWidth\s*=\s*"none"/, "必须显式清掉 mermaid 的内联 max-width");
  });

  test("固有尺寸取自 viewBox，svg 换了要重量", () => {
    assert.match(clientJs, /viewBox/, "应优先从 viewBox 取原始尺寸");
    assert.match(clientJs, /cached\.svg === svg/, "主题切换换了 svg 节点，必须重新量原始尺寸");
  });

  test("缩放值存在 figure 的 data-zoom 上", () => {
    assert.match(clientJs, /fig\.setAttribute\("data-zoom"/, "缩放值要落在 figure 上才能跨重绘存活");
  });

  test("重绘完成后重新套用缩放", () => {
    assert.match(clientJs, /run\(\{ nodes: nodes \}\)[\s\S]*?then\([\s\S]*?syncAllFigures\(\)/, "切主题后应把缩放套回新 svg");
    assert.match(clientJs, /closeViewer\(\);[\s\S]{0,400}?removeAttribute\("data-processed"\)/, "重绘前要先放回全屏层里的 svg");
  });

  test("放大后的溢出由 viewport 横向滚动，且居中要用 safe", () => {
    assert.match(themeCss, /\.mermaid-viewport\s*\{[^}]*overflow-x:\s*auto/s, "放大后要能横向滚动");
    assert.match(
      themeCss,
      /\.mermaid-viewport\s*\{[^}]*justify-content:\s*safe center/s,
      "普通 center 会让溢出部分滚不到，必须 safe center",
    );
  });

  test("两个 flex 容器都要显式 align-items", () => {
    // 默认的 align-items: stretch 会把 svg 拉成容器那么高，
    // 宽图放大时高度卡住不动，看起来像缩放失灵
    for (const sel of [".mermaid-viewport", ".mermaid-fullscreen-canvas"]) {
      const i = themeCss.indexOf(sel + " {");
      assert.notEqual(i, -1, `theme.css 里应有 ${sel} 规则`);
      assert.match(
        themeCss.slice(i, themeCss.indexOf("}", i)),
        /align-items:\s*safe center|align-items:\s*flex-start/,
        `${sel} 必须显式给 align-items，别让 stretch 拉高 svg`,
      );
    }
  });

  test("图没渲染出来前不显示工具条", () => {
    assert.match(themeCss, /\.mermaid-figure:not\(\[data-rendered\]\) \.mermaid-tools\s*\{\s*display:\s*none/);
  });

  test("全屏层搬真实 svg 节点，不许克隆", () => {
    // mermaid 的 SVG 里 marker / clipPath 全靠 DOM id 引用，
    // 克隆一份会出现重复 id，箭头标记会集体失效
    assert.doesNotMatch(clientJs, /cloneNode/, "全屏查看请搬运真实节点，别克隆");
    assert.match(clientJs, /canvas\.appendChild\(svg\)/);
    assert.match(clientJs, /viewer\.home\.appendChild\(svg\)/, "关闭时要把 svg 搬回正文");
  });

  test("取 svg 节点必须走 activeSvg：全屏时它已经不在 figure 里了", () => {
    // 照 svgOf() 取节点，全屏里会拿到 null：缩放静默失效，
    // closeViewer 还会连图一起丢掉（正文里那张图直接消失）
    assert.match(clientJs, /function activeSvg\(fig\)/);
    const applyZoom = clientJs.slice(clientJs.indexOf("function applyZoom"));
    const body = applyZoom.slice(0, applyZoom.indexOf("\n  }"));
    assert.match(body, /activeSvg\(fig\)/, "applyZoom 要用 activeSvg");
    const closeViewer = clientJs.slice(clientJs.indexOf("function closeViewer"));
    assert.match(
      closeViewer.slice(0, closeViewer.indexOf("\n  }")),
      /activeSvg\(fig\)/,
      "closeViewer 要用 activeSvg，否则关掉全屏图就没了",
    );
  });

  test("100% 交回 mermaid 自己的内联样式，不能清空", () => {
    assert.match(
      clientJs,
      /if \(base\.style == null\) svg\.removeAttribute\("style"\);\s*\n\s*else svg\.setAttribute\("style", base\.style\)/,
      "100% 必须还原本来的 max-width，清空会让小图撑满变形",
    );
    assert.match(clientJs, /style: svg\.getAttribute\("style"\)/, "要在改动前先记下原始内联样式");
  });

  test("全屏层不锁页面滚动，靠 overscroll-behavior 断传递", () => {
    assert.match(themeCss, /\.mermaid-fullscreen-canvas\s*\{[^}]*overscroll-behavior:\s*contain/s);
    assert.match(themeCss, /\.mermaid-fullscreen-canvas\s*\{[^}]*touch-action:\s*none/s, "触摸拖拽平移需要独占手势");
    const fullscreenRule = themeCss.slice(themeCss.indexOf(".mermaid-fullscreen"));
    assert.doesNotMatch(fullscreenRule, /overflow\s*:\s*hidden/, "全屏层不该锁住任何滚动");
  });

  test("全屏层支持滚轮缩放、拖拽平移和 Esc 关闭", () => {
    assert.match(clientJs, /addEventListener\(\s*"wheel"/, "全屏里应能滚轮缩放");
    assert.match(clientJs, /passive:\s*false/, "不 passive 才拦得住页面的滚轮缩放");
    assert.match(clientJs, /pointerdown/, "全屏里应能拖拽平移");
    assert.match(clientJs, /e\.key === "Escape"[\s\S]{0,120}closeViewer\(\)/, "Esc 应关闭全屏层");
  });
});
