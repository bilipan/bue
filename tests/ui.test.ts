import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderShell } from "../src/ui/shell.ts";

const themeCss = readFileSync(new URL("../src/ui/theme.css", import.meta.url), "utf8");
const clientJs = readFileSync(new URL("../src/ui/client.js", import.meta.url), "utf8");

function shell(o: Partial<Parameters<typeof renderShell>[0]> = {}) {
  return renderShell({
    title: "t",
    breadcrumb: ["a"],
    bodyHtml: "<p>x</p>",
    toc: [{ id: "h", text: "标题", depth: 2 }],
    theme: "auto",
    width: 768,
    showToc: true,
    showSwitcher: false,
    ...o,
  });
}

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
    const html = shell();
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
  /** 取某个函数体，用于检查内部实现 */
  function body(marker: string): string {
    const start = clientJs.indexOf(marker);
    assert.notEqual(start, -1, `client.js 里应存在 ${marker}`);
    // 注意：第二个参数必须给 start，否则会从头找第一个同缩进的闭合括号
    return clientJs.slice(start, clientJs.indexOf("\n  }", start));
  }

  test("缩放走内联 style.width，并清掉 mermaid 写的内联 max-width", () => {
    // mermaid 会给 svg 写 style="max-width: 380px"，不清掉放大就会被卡死
    assert.match(clientJs, /\.style\.width\s*=/, "缩放应直接改 svg 的内联宽度");
    assert.match(clientJs, /\.style\.maxWidth\s*=\s*"none"/, "放大时必须显式清掉那条内联 max-width");
  });

  test("固有尺寸取自 viewBox，svg 换了要重量", () => {
    assert.match(clientJs, /viewBox/, "应优先从 viewBox 取原始尺寸");
    assert.match(clientJs, /cached\.svg === svg/, "主题切换换了 svg 节点，必须重新量原始尺寸");
  });

  test("缩放值存在 figure 的 data-zoom 上", () => {
    assert.match(clientJs, /fig\.setAttribute\("data-zoom"/, "缩放值要落在 figure 上才能跨重绘存活");
  });

  test("缩放记的是相对适配容器的倍数，不是绝对像素", () => {
    assert.match(clientJs, /function fitRatio\(/, "要有「适配容器」的比例换算");
    assert.match(
      clientJs,
      /var scale = fitRatio\(fig, base\) \* zoom/,
      "实际缩放 = 适配比例 × 倍数，容器变宽时倍数不用动",
    );
  });

  test("适配按钮回到倍数 1，还原 mermaid 自己的内联样式", () => {
    assert.match(clientJs, /data-zoom-fit"\)\) \{[\s\S]*?return applyZoom\(fig, 1\)/, "「适配容器尺寸」= 倍数 1");
    assert.match(
      clientJs,
      /if \(base\.style == null\) svg\.removeAttribute\("style\"\);\s*\n\s*else svg\.setAttribute\("style", base\.style\)/,
      "倍数 1 必须还原本来的 max-width，清空会让小图撑满变形",
    );
    assert.match(clientJs, /style: svg\.getAttribute\("style"\)/, "要在改动前先记下原始内联样式");
  });

  test("重绘完成后重新套用缩放", () => {
    assert.match(
      clientJs,
      /run\(\{ nodes: nodes \}\)[\s\S]*?then\([\s\S]*?syncAllFigures\(\)/,
      "切主题后应把缩放套回新 svg",
    );
    assert.match(clientJs, /addEventListener\("resize", syncAllFigures\)/, "容器变宽要重算适配比例");
  });

  test("放大后的溢出两轴都可滚，且居中要用 safe", () => {
    // 竖长的 sequence 放大后可能只溢出纵向，只给横向滚动那半截就看不到
    assert.match(themeCss, /\.mermaid-viewport\s*\{[^}]*overflow:\s*auto/s, "两个方向都要能滚");
    const vpRule = themeCss.slice(themeCss.indexOf(".mermaid-viewport {"), themeCss.indexOf("}", themeCss.indexOf(".mermaid-viewport {")));
    assert.match(vpRule, /justify-content:\s*safe center/, "普通 center 会让溢出部分滚不到");
    assert.match(vpRule, /align-items:\s*safe center/, "纵向同理：比框高时要靠上对齐才够得着");
  });

  test("viewport 高度按适配时的图高锁死，缩放不改外框", () => {
    assert.match(
      clientJs,
      /vp\.style\.height = Math\.ceil\(base\.h \* fitRatio\(fig, base\)\) \+ "px"/,
      "高度要按「适配时的图高」写死，否则放大竖长的图会把外框一起顶高",
    );
    // 锁高时若按 border-box 算，那点上下内边距会从 height 里扣，
    // 适配时就凭空多出纵向溢出、冒出一条滚动条
    const vpRule = themeCss.slice(themeCss.indexOf(".mermaid-viewport {"), themeCss.indexOf("}", themeCss.indexOf(".mermaid-viewport {")));
    assert.match(vpRule, /box-sizing:\s*content-box/, "JS 写的 height 必须当内容高用");
  });

  test("svg 用 block，消掉 inline 基线间隙", () => {
    // svg 默认 inline，底下留约 7px 基线间隙；高度锁死后这点余量
    // 就变成真实的纵向溢出，适配状态下凭空冒出滚动条
    assert.match(themeCss, /\.mermaid-viewport > \.mermaid > svg\s*\{[^}]*display:\s*block/s);
    assert.match(themeCss, /\.mermaid-viewport > \.mermaid > svg\s*\{[^}]*margin-inline:\s*auto/s, "改 block 后要自己居中");
  });

  test("两轴都要有「可挪」空间才算能拖", () => {
    // 竖长的图放大后只溢出纵向，只看 scrollWidth 会漏掉；
    // 内容比框小（缩小过头、或窄图）也该能挪，那是 transform 的活
    const m = body("function panMetrics(fig)");
    assert.match(m, /maxX: Math\.max\(0, vp\.scrollWidth - vp\.clientWidth\)/);
    assert.match(m, /maxY: Math\.max\(0, vp\.scrollHeight - vp\.clientHeight\)/);
    // clientHeight 含内边距，减图高前得先把内边距扣掉，否则空隙会多算几 px，
    // 一张刚好铺满的图会被误判成可拖
    assert.match(m, /availX = vp\.clientWidth - \(parseFloat\(cs\.paddingLeft\) \|\| 0\)/);
    assert.match(m, /availY = vp\.clientHeight - \(parseFloat\(cs\.paddingTop\) \|\| 0\)/);
    assert.match(m, /slackX: Math\.max\(0, \(availX - box\.width - 1\) \/ 2\)/, "内容比框小的空隙也算可挪");
    assert.match(m, /slackY: Math\.max\(0, \(availY - box\.height - 1\) \/ 2\)/);
    assert.match(
      clientJs,
      /m\.maxX > 0 \|\| m\.maxY > 0 \|\| m\.slackX > 0 \|\| m\.slackY > 0/,
      "溢出或有空隙都算可拖",
    );
  });

  test("平移有两条路：有滚动范围用滚动，否则用 transform 在空隙里挪", () => {
    const v = body("function applyView(fig)");
    assert.match(v, /v\.freeX = m\.maxX > 0 \? 0 : clamp\(v\.freeX, -m\.slackX, m\.slackX\)/, "两套机制不能同时生效");
    assert.match(v, /v\.freeY = m\.maxY > 0 \? 0 : clamp\(v\.freeY, -m\.slackY, m\.slackY\)/);
    assert.match(v, /svg\.style\.transform = "translate\(/, "空隙里要靠 transform 挪");
    assert.match(v, /removeProperty\("transform"\)/, "没位移时要把 transform 撤掉");
  });

  test("拖动模式一开就接管 pointer，不看是否适配尺寸", () => {
    const down = clientJs.slice(
      clientJs.indexOf('document.addEventListener("pointerdown"'),
      clientJs.indexOf('document.addEventListener("pointermove"'),
    );
    assert.doesNotMatch(down, /data-zoom|data-overflow/, "拖动不该挂在缩放或溢出状态上");
    assert.match(down, /if \(!fig \|\| !panningOn\(fig\) \|\| !fig\.hasAttribute\("data-pannable"\)\) return;/, "只认拖动模式和是否有东西可挪");
    assert.match(down, /\.mermaid-tools/, "工具条自身不能被当成拖图");
    assert.match(down, /panMetrics\(fig\)/, "按下时就要记下这次的滚动/空隙范围");
  });

  test("拖动的每个方向各自选一条路，且都不越界", () => {
    const move = clientJs.slice(
      clientJs.indexOf('document.addEventListener("pointermove"'),
      clientJs.indexOf("var endDrag"),
    );
    assert.match(move, /if \(drag\.maxX > 0\) drag\.vp\.scrollLeft = clamp\([\s\S]*?, 0, drag\.maxX\)/);
    assert.match(move, /else drag\.free\.freeX = clamp\([\s\S]*?, -drag\.slackX, drag\.slackX\)/);
    assert.match(move, /if \(drag\.maxY > 0\) drag\.vp\.scrollTop = clamp\([\s\S]*?, 0, drag\.maxY\)/);
    assert.match(move, /else drag\.free\.freeY = clamp\([\s\S]*?, -drag\.slackY, drag\.slackY\)/);
  });

  test("适配按钮把位移也归零", () => {
    assert.match(clientJs, /data-zoom-fit"\)\) \{[\s\S]*?free\.freeX = 0;[\s\S]*?free\.freeY = 0;/, "适配 = 回到容器大小并居中");
  });

  test("touch-action 只在「拖动模式 + 有东西可挪」时生效", () => {
    // 无条件设 touch-action: none 会吃掉窄屏上按住图时的页面滚动
    assert.match(
      themeCss,
      /\.mermaid-figure\[data-pan="on"\]\[data-pannable\] \.mermaid-viewport\s*\{[^}]*touch-action:\s*none/s,
    );
    const viewportRule = themeCss.slice(themeCss.indexOf(".mermaid-viewport {"), themeCss.indexOf("}", themeCss.indexOf(".mermaid-viewport {")));
    assert.doesNotMatch(viewportRule, /touch-action/, "viewport 本身不该设 touch-action");
  });

  test("缩放以视口中心为锚，不往右跳", () => {
    assert.match(clientJs, /function zoomBy\(fig, factor\)/);
    assert.match(clientJs, /data-zoom-in"\)\) return zoomBy\(fig, ZOOM_STEP\)/, "放大要走带锚点的路径");
    const z = body("function zoomBy(fig, factor)");
    assert.match(z, /vp\.scrollLeft = cx \* k - vp\.clientWidth \/ 2/);
    assert.match(z, /vp\.scrollTop = cy \* k - vp\.clientHeight \/ 2/);
    assert.match(z, /free\.freeX \*= k;/, "空隙里的位移也要跟着缩放走，否则会跳一下");
    assert.match(z, /free\.freeY \*= k;/);
  });

  test("图没渲染出来前不显示工具条", () => {
    assert.match(themeCss, /\.mermaid-figure:not\(\[data-rendered\]\) \.mermaid-tools\s*\{\s*display:\s*none/);
  });

  test("工具条浮在图的右上角，不占文档流", () => {
    const i = themeCss.indexOf(".mermaid-tools {");
    assert.notEqual(i, -1);
    const rule = themeCss.slice(i, themeCss.indexOf("}", i));
    assert.match(rule, /position:\s*absolute/, "工具条要脱离文档流，不能把图往下顶");
    assert.match(rule, /top:\s*8px/);
    assert.match(rule, /right:\s*8px/);
    assert.match(themeCss, /\.mermaid-figure\s*\{[^}]*position:\s*relative/s, "figure 得是定位参照");
  });

  test("按钮是纯图标：统一描边，没有文字内容", () => {
    const svgRule = themeCss.slice(themeCss.indexOf(".mermaid-tool svg {"), themeCss.indexOf("}", themeCss.indexOf(".mermaid-tool svg {")));
    assert.match(svgRule, /fill:\s*none/, "图标走描边");
    assert.match(svgRule, /stroke:\s*currentColor/);
    assert.doesNotMatch(clientJs, /mermaid-level|data-zoom-level/, "不再有百分比读数");
  });

  test("拖动模式：开关控制平移，并同步 aria-pressed", () => {
    assert.match(clientJs, /function togglePan\(/);
    assert.match(clientJs, /fig\.setAttribute\("data-pan", "on"\)/, "开关状态落在 figure 上");
    assert.match(clientJs, /btn\.setAttribute\("aria-pressed", on \? "true" : "false"\)/, "按钮要报出开关状态");
    assert.match(themeCss, /\.mermaid-tool\[aria-pressed="true"\]/, "打开时按钮要点亮");
  });

  test("不做全屏预览：相关代码与样式都不该再有", () => {
    assert.doesNotMatch(clientJs, /fullscreen|openViewer|closeViewer/, "全屏层已移除");
    assert.doesNotMatch(themeCss, /\.mermaid-fullscreen/, "全屏层样式已移除");
    assert.doesNotMatch(clientJs, /cloneNode/, "没有需要搬运/克隆节点的场景了");
  });
});

describe("没有目录时正文居中并放宽", () => {
  test("宽度上限写在 CSS，不是内联 style", () => {
    // 内联的 max-width 优先级高于任何类规则，会把下面「没有目录时放宽」压掉
    assert.doesNotMatch(shell(), /<article class="markdown-body" style=/, "正文宽度别再走内联 style");
    assert.match(themeCss, /\.markdown-body\s*\{[^}]*max-width:\s*var\(--content-width\)/s);
  });

  test("layout 居中，且有目录时才占侧栏那 320px", () => {
    assert.match(themeCss, /\.bue-layout\s*\{[^}]*justify-content:\s*center/s, "没有目录时正文要居中");
    assert.match(
      themeCss,
      /\.bue-layout:not\(\.has-toc\) \.markdown-body\s*\{\s*max-width:\s*none;/,
      "没有目录就不该被阅读宽度卡住",
    );
  });

  test("has-toc 只在真的渲染出目录时才有", () => {
    assert.match(shell(), /<div class="bue-layout has-toc">/, "有目录项时带上标记");
    assert.match(shell({ toc: [] }), /<div class="bue-layout">/, "目录为空时不留侧栏位置");
    assert.match(shell({ showToc: false }), /<div class="bue-layout">/, "--no-toc 时不留侧栏位置");
  });
});

describe("mermaid 图不带阴影", () => {
  test("主题变量关掉 mermaid 自带的投影", () => {
    // 主题注入在 svg 内部 <style> 里的那些（flowchart / pie / gantt 的节点）
    assert.match(clientJs, /themeVariables:\s*\{\s*dropShadow:\s*"none"\s*\}/);
  });

  test("硬编码在 filter 属性上的投影由 CSS 兜住", () => {
    // sequence 的 actor 是 filter=\"url(#…-drop-shadow)\" 写成属性的，
    // 主题变量管不到；呈现属性本来就输给作者样式，所以不必上 !important
    assert.match(themeCss, /\.mermaid-figure svg \[filter\]\s*\{\s*filter:\s*none;/);
  });
});
