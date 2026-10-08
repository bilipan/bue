/**
 * bue 预览页客户端。
 *
 * 必须是经典 script（不能 type="module"）：经典脚本不需要 CORS 校验，
 * module script 在 file:// 下会被浏览器拦截，这里虽然走 http，但保持同一套
 * 代码在 file:// 打开导出的 HTML 时也能工作。
 *
 * 约定：
 *   - mermaid 通过 /vendor/mermaid.js 提供，挂载在 window.mermaid
 *   - 主题写进 <html data-theme>，hljs 主题通过切换 <link disabled> 生效
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var THEME_KEY = "bue-theme";
  var HLJS_LIGHT = "/vendor/hljs/github.css";
  var HLJS_DARK = "/vendor/hljs/github-dark.css";

  /* ---------------- 主题 ---------------- */

  function storedTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null; // file:// 或隐私模式下 localStorage 可能抛 SecurityError
    }
  }

  function saveTheme(v) {
    try {
      localStorage.setItem(THEME_KEY, v);
    } catch (e) {
      /* 存不了就用本次会话的值 */
    }
  }

  function prefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function syncHrefTheme() {
    var explicit = root.getAttribute("data-theme");
    var dark = explicit ? explicit === "dark" : prefersDark();
    var links = document.querySelectorAll("link[data-hljs-theme]");
    for (var i = 0; i < links.length; i++) {
      links[i].disabled = (links[i].getAttribute("data-hljs-theme") === "dark") !== dark;
    }
    return dark;
  }

  function applyTheme(explicit) {
    if (explicit) {
      root.setAttribute("data-theme", explicit);
    } else {
      root.removeAttribute("data-theme");
    }
    var dark = syncHrefTheme();
    if (window.__bueMermaid) rerenderMermaid(dark);
  }

  function initThemeButton() {
    var btn = document.getElementById("theme-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var current = root.getAttribute("data-theme");
      if (!current) current = prefersDark() ? "dark" : "light";
      var next = current === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
      btn.setAttribute("title", next === "dark" ? "切换到亮色" : "切换到暗色");
    });
  }

  /* ---------------- 目录抽屉 ---------------- */

  function initToc() {
    var toc = document.getElementById("toc");
    var btn = document.getElementById("toc-btn");
    if (!toc || !btn) return;

    // null = 跟随视口（宽屏常驻、窄屏收起）；用户点过之后记住手动选择
    var manualOpen = null;
    var wide = window.matchMedia("(min-width: 900px)");

    function apply() {
      var open = manualOpen === null ? wide.matches : manualOpen;
      toc.hidden = !open;
      btn.setAttribute("aria-pressed", open ? "true" : "false");
    }

    function close() {
      manualOpen = false;
      apply();
    }

    btn.addEventListener("click", function () {
      manualOpen = toc.hidden;
      apply();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && manualOpen) close();
    });

    /*
     * 窄屏下抽屉是覆盖在正文右侧的侧栏，正文那一侧保持可点可滚——
     * 所以这里不放遮罩（遮罩会吃掉正文区域的触摸滚动）。
     * 改为点抽屉外关掉抽屉。
     *
     * 必须区分「点一下」和「拖动滚动」：Chrome 在 mouseup 后仍会派发 click，
     * 不看位移就会导致拖一下正文抽屉立刻消失。
     */
    var downPos = null;
    document.addEventListener(
      "pointerdown",
      function (e) {
        downPos = { x: e.clientX, y: e.clientY };
      },
      true,
    );

    document.addEventListener("click", function (e) {
      if (!manualOpen) return;
      if (wide.matches) return;
      if (toc.contains(e.target) || btn.contains(e.target)) return;
      if (downPos && (Math.abs(e.clientX - downPos.x) > 8 || Math.abs(e.clientY - downPos.y) > 8)) {
        return; // 是拖动滚动，不是点击
      }
      close();
    });

    /*
     * 窄屏下点目录项跳完锚点后顺手收起抽屉，否则会挡住刚跳转到的内容。
     * 宽屏目录是常驻侧栏，点条目只该滚页面，绝不能把它收起。
     */
    toc.addEventListener("click", function (e) {
      if (wide.matches) return;
      if (e.target.closest && e.target.closest("a")) close();
    });

    // 视口跨过断点时丢掉手动选择，重新跟随视口
    wide.addEventListener("change", function () {
      manualOpen = null;
      apply();
    });
    apply();

    initScrollSpy(toc);
  }

  function initScrollSpy(toc) {
    var links = toc.querySelectorAll("a[href^='#']");
    if (!links.length || !("IntersectionObserver" in window)) return;

    var byId = {};
    var targets = [];
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute("href").slice(1);
      var el = document.getElementById(id);
      if (el) {
        byId[id] = links[i];
        targets.push(el);
      }
    }
    if (!targets.length) return;

    var visible = {};
    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          visible[entries[i].target.id] = entries[i].isIntersecting;
        }
        // 取文档顺序里第一个可见的标题作为当前项
        var current = null;
        for (var j = 0; j < targets.length; j++) {
          if (visible[targets[j].id]) {
            current = targets[j].id;
            break;
          }
        }
        if (!current) return;
        for (var k = 0; k < links.length; k++) links[k].classList.remove("active");
        if (byId[current]) byId[current].classList.add("active");
      },
      { rootMargin: "-70px 0px -70% 0px", threshold: 0 },
    );
    for (var m = 0; m < targets.length; m++) observer.observe(targets[m]);
  }

  /* ---------------- Mermaid ---------------- */

  /**
   * Mermaid 源码的唯一真相来源是同 figure 里的 <details> 源码块——
   * .mermaid 节点在首次渲染后就被 SVG 覆盖，textContent 已不可用。
   */
  function mermaidSource(el) {
    var fig = el.closest(".mermaid-figure");
    var src = fig && fig.querySelector(".mermaid-src code");
    if (src) return (src.textContent || "").trim();
    return (el.textContent || "").trim();
  }

  function rerenderMermaid(dark) {
    if (!window.__bueMermaid) return;
    var nodes = document.querySelectorAll(".mermaid");
    if (!nodes.length) return;

    // 已渲染过的节点要先还原成纯源码并清掉 data-processed，否则 mermaid 会跳过
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].getAttribute("data-processed")) continue;
      nodes[i].removeAttribute("data-processed");
      nodes[i].innerHTML = "";
      nodes[i].appendChild(document.createTextNode(mermaidSource(nodes[i])));
    }

    window.__bueMermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    window.__bueMermaid.run({ nodes: nodes }).then(
      function () {
        // 重绘换了新的 svg 节点，把 data-zoom 上存的缩放套回去
        syncAllFigures();
      },
      function (e) {
        reportMermaidError(nodes, e);
      },
    );
  }

  function reportMermaidError(nodes, err) {
    var message = (err && (err.message || err.str || String(err))) || "未知错误";
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-processed")) continue;
      el.innerHTML = "";
      var box = document.createElement("div");
      box.className = "mermaid-error";
      box.textContent = "Mermaid 渲染失败：" + message + "\n\n" + mermaidSource(el);
      el.appendChild(box);
    }
    syncAllFigures(); // 渲染失败时工具条要跟着隐藏
  }

  function initMermaid() {
    var nodes = document.querySelectorAll(".mermaid");
    if (!nodes.length) return;
    var script = document.createElement("script");
    script.src = "/vendor/mermaid.js";
    script.onload = function () {
      window.__bueMermaid = window.mermaid;
      delete window.mermaid;
      rerenderMermaid(syncHrefTheme());
    };
    script.onerror = function () {
      reportMermaidError(nodes, "无法加载 /vendor/mermaid.js");
    };
    document.head.appendChild(script);
  }

  /* ---------------- 图缩放 ---------------- */

  /*
   * data-zoom 记的是「相对适配容器的倍数」，不是绝对像素：
   * 1 = 刚好铺满容器宽度（也就是加缩放之前的原样），2 = 两倍宽。
   * 记绝对像素的话容器一变宽就得重算一遍，这里把换算留给 applyZoom。
   */
  var ZOOM_MIN = 0.1;
  var ZOOM_MAX = 20;
  var ZOOM_STEP = 1.25;

  // figure -> { svg, w, h, style }：svg 节点换了（主题切换会重绘）就重新量，
  // 因为量到的必须是「原始尺寸」，量已缩放过的宽度会越滚越大
  var baseSizes = new WeakMap();
  // figure -> { freeX, freeY }：内容比框小时用来在空隙里挪的位移（px）
  var freePans = new WeakMap();

  function figureOf(node) {
    return node && node.closest ? node.closest(".mermaid-figure") : null;
  }

  function svgOf(fig) {
    return fig.querySelector(".mermaid > svg");
  }

  function viewportOf(fig) {
    return fig.querySelector(".mermaid-viewport");
  }

  function zoomOf(fig) {
    var v = parseFloat(fig.getAttribute("data-zoom"));
    return v > 0 ? v : 1;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function baseSize(fig, svg) {
    var cached = baseSizes.get(fig);
    if (cached && cached.svg === svg) return cached;

    var box = svg.viewBox && svg.viewBox.baseVal;
    var w = box && box.width ? box.width : parseFloat(svg.getAttribute("width"));
    var h = box && box.height ? box.height : parseFloat(svg.getAttribute("height"));
    if (!w) {
      // viewBox 和 width 属性都没有才退回实测——必须趁还没缩放时量
      var rect = svg.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
    }
    var size = { svg: svg, w: w || 0, h: h || 0, style: svg.getAttribute("style") };
    baseSizes.set(fig, size);
    return size;
  }

  /** 适配容器时的比例：比容器宽就按容器宽收窄，窄图保持原始大小 */
  function fitRatio(fig, base) {
    var vp = viewportOf(fig);
    if (!vp || !base.w || !vp.clientWidth) return 1;
    return Math.min(1, vp.clientWidth / base.w);
  }

  function applyZoom(fig, zoom) {
    zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    fig.setAttribute("data-zoom", String(zoom));

    var svg = svgOf(fig);
    if (!svg) {
      fig.removeAttribute("data-rendered");
      return;
    }
    var base = baseSize(fig, svg);
    var vp = viewportOf(fig);

    /*
     * 高度锁在「适配时的图高」，不随缩放变。
     * 否则放大一张竖长的图会把外框一起顶高、页面跟着跳，
     * 而这层本来就是拿来装溢出内容的——锁住之后缩放只改内部可视范围，
     * 外框尺寸始终和加缩放之前一致。
     */
    if (vp && base.h) vp.style.height = Math.ceil(base.h * fitRatio(fig, base)) + "px";

    if (zoom === 1) {
      /*
       * 适配 = 原样：把 mermaid 自己写的内联样式还回去。它写的
       * max-width 就是图的固有宽度——窄图不会被拉大，宽图由 CSS 的
       * max-width: 100% 收窄到容器宽。清成空串反而会让 svg 退回
       * width="100%" 撑满容器，把小图放大变形。
       */
      if (base.style == null) svg.removeAttribute("style");
      else svg.setAttribute("style", base.style);
    } else {
      /*
       * 放大时必须显式压掉那条内联 max-width，否则放大到比它更宽
       * 就被卡住不动；width 给死 px，配合 viewport 的双向滚动。
       */
      var scale = fitRatio(fig, base) * zoom;
      svg.style.maxWidth = "none";
      svg.style.width = base.w ? Math.round(base.w * scale) + "px" : "";
      svg.style.height = "auto";
    }
    fig.setAttribute("data-rendered", "");
    applyView(fig);
  }

  /**
   * 以视口中心为锚缩放：放大前后「看到的中间那一块」保持不动。
   * 不锚定的话，每次点放大都在往右跳，配合拖动根本没法看清某一块。
   */
  function zoomBy(fig, factor) {
    var old = zoomOf(fig);
    var next = clamp(old * factor, ZOOM_MIN, ZOOM_MAX);
    if (next === old) return;

    var vp = viewportOf(fig);
    var svg = svgOf(fig);
    if (!vp || !svg) return applyZoom(fig, next);

    var free = freePanOf(fig);
    var cx = vp.scrollLeft + vp.clientWidth / 2;
    var cy = vp.scrollTop + vp.clientHeight / 2;
    applyZoom(fig, next);
    var k = next / old;
    vp.scrollLeft = cx * k - vp.clientWidth / 2;
    vp.scrollTop = cy * k - vp.clientHeight / 2;
    // 内容比框小的那部分（放大后未必还小）也按同一比例挪，不然会跳一下
    free.freeX *= k;
    free.freeY *= k;
    applyView(fig);
  }

  /* ---------------- 平移 ---------------- */

  /**
   * 一个方向上有两种表达，择一而用：
   *  - 内容比框大 → 用 viewport 的滚动（scrollLeft/scrollTop），和滚动条、
   *    滚轮、和内容的超滚范围都天然一致
   *  - 内容比框小 → 滚动没有范围，拖不动。改用 transform 在空出来的空隙里挪，
   *    这正是「适配尺寸 / 缩小到比框还小」时用户要的：拖动模式一开就该能拖。
   * 两条路都以「内容不能被拖出视野」为界。
   */
  function panMetrics(fig) {
    var vp = viewportOf(fig);
    var svg = svgOf(fig);
    if (!vp || !svg) return null;
    var box = svg.getBoundingClientRect();
    /*
     * clientHeight 含上下内边距，而那点内边距不是可平移的空间——
     * 直接拿它减图高会把空隙算多出几 px，于是一张「刚好铺满、其实无处可拖」
     * 的图也会被判成可拖，顺手 touch-action 把页面滚动也吃了。
     * 再留 1px 余量，让亚像素的量测误差归零。
     */
    var cs = getComputedStyle(vp);
    var availX = vp.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var availY = vp.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    return {
      vp: vp,
      svg: svg,
      maxX: Math.max(0, vp.scrollWidth - vp.clientWidth),
      maxY: Math.max(0, vp.scrollHeight - vp.clientHeight),
      // 内容比框小，空出来的一半（居中摆放时左右各这么多）
      slackX: Math.max(0, (availX - box.width - 1) / 2),
      slackY: Math.max(0, (availY - box.height - 1) / 2),
    };
  }

  function freePanOf(fig) {
    var v = freePans.get(fig);
    if (!v) {
      v = { freeX: 0, freeY: 0 };
      freePans.set(fig, v);
    }
    return v;
  }

  function applyView(fig) {
    var m = panMetrics(fig);
    if (!m) return;
    var v = freePanOf(fig);

    // 有滚动范围就不该再有位移，否则两套机制会互相打架
    v.freeX = m.maxX > 0 ? 0 : clamp(v.freeX, -m.slackX, m.slackX);
    v.freeY = m.maxY > 0 ? 0 : clamp(v.freeY, -m.slackY, m.slackY);

    if (m.maxX > 0 || m.maxY > 0) {
      m.vp.scrollLeft = clamp(m.vp.scrollLeft, 0, m.maxX);
      m.vp.scrollTop = clamp(m.vp.scrollTop, 0, m.maxY);
    }
    if (v.freeX || v.freeY) {
      m.svg.style.transform = "translate(" + Math.round(v.freeX) + "px," + Math.round(v.freeY) + "px)";
    } else {
      m.svg.style.removeProperty("transform");
    }
    markPannable(fig);
  }

  /**
   * 有没有东西可挪：某一轴溢出，或者某一轴有空隙。
   * 两者都没有时（比如宽图刚好铺满）拖了也不会动，那种情况下不该抢手势。
   */
  function markPannable(fig) {
    var m = panMetrics(fig);
    var pannable = !!m && (m.maxX > 0 || m.maxY > 0 || m.slackX > 0 || m.slackY > 0);
    if (pannable) fig.setAttribute("data-pannable", "");
    else fig.removeAttribute("data-pannable");
  }

  function syncFigure(fig) {
    if (fig) applyZoom(fig, zoomOf(fig));
  }

  function syncAllFigures() {
    var figs = document.querySelectorAll(".mermaid-figure");
    for (var i = 0; i < figs.length; i++) syncFigure(figs[i]);
  }

  /* 拖动模式：开关控制「按住图拖 = 平移」还是「正常选中文本」 */

  function panningOn(fig) {
    return fig.getAttribute("data-pan") === "on";
  }

  function togglePan(fig, btn) {
    var on = !panningOn(fig);
    if (on) fig.setAttribute("data-pan", "on");
    else {
      fig.removeAttribute("data-pan");
      fig.removeAttribute("data-dragging");
    }
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function initDiagramZoom() {
    if (!document.querySelector(".mermaid-figure")) return;

    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;

      var btn = e.target.closest(".mermaid-tools button");
      if (!btn) return;
      var fig = figureOf(btn);
      if (!fig) return;

      if (btn.hasAttribute("data-pan-toggle")) return togglePan(fig, btn);
      if (btn.hasAttribute("data-zoom-fit")) {
        // 适配 = 回到容器大小，位移也一并归零
        var free = freePanOf(fig);
        free.freeX = 0;
        free.freeY = 0;
        var vp = viewportOf(fig);
        if (vp) {
          vp.scrollLeft = 0;
          vp.scrollTop = 0;
        }
        return applyZoom(fig, 1);
      }
      if (btn.hasAttribute("data-zoom-in")) return zoomBy(fig, ZOOM_STEP);
      if (btn.hasAttribute("data-zoom-out")) return zoomBy(fig, 1 / ZOOM_STEP);
    });

    /*
     * 拖动模式一开就接管 pointer，不看当前是不是适配尺寸：
     * 拖动模式的意义就是「拖画布」，等用户先放大到溢出才生效是反的。
     * 但「真的没东西可挪」（宽图刚好铺满框）时仍然放行，否则 preventDefault
     * 会把触摸滚页面一起吃掉。工具条自身排除掉，别把点按钮当成拖图。
     */
    var drag = null;
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest && e.target.closest(".mermaid-tools")) return;
      var fig = figureOf(e.target);
      if (!fig || !panningOn(fig) || !fig.hasAttribute("data-pannable")) return;

      var m = panMetrics(fig);
      var free = freePanOf(fig);
      drag = {
        fig: fig,
        vp: m.vp,
        svg: m.svg,
        free: free,
        x: e.clientX,
        y: e.clientY,
        left: m.vp.scrollLeft,
        top: m.vp.scrollTop,
        freeX: free.freeX,
        freeY: free.freeY,
        maxX: m.maxX,
        maxY: m.maxY,
        slackX: m.slackX,
        slackY: m.slackY,
      };
      fig.setAttribute("data-dragging", "");
      if (m.vp.setPointerCapture) m.vp.setPointerCapture(e.pointerId);
      e.preventDefault(); // 否则会顺手选中图里的文字
    });
    document.addEventListener("pointermove", function (e) {
      if (!drag) return;
      // 内容跟着手走：手往左挪，内容就往左走
      var dx = drag.x - e.clientX;
      var dy = drag.y - e.clientY;
      if (drag.maxX > 0) drag.vp.scrollLeft = clamp(drag.left + dx, 0, drag.maxX);
      else drag.free.freeX = clamp(drag.freeX + dx, -drag.slackX, drag.slackX);
      if (drag.maxY > 0) drag.vp.scrollTop = clamp(drag.top + dy, 0, drag.maxY);
      else drag.free.freeY = clamp(drag.freeY + dy, -drag.slackY, drag.slackY);

      if (!drag.maxX && !drag.maxY && (drag.free.freeX || drag.free.freeY)) {
        drag.svg.style.transform =
          "translate(" + Math.round(drag.free.freeX) + "px," + Math.round(drag.free.freeY) + "px)";
      }
    });
    var endDrag = function () {
      if (!drag) return;
      drag.fig.removeAttribute("data-dragging");
      drag = null;
    };
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    /*
     * 缩放是相对适配容器的倍数，所以容器一变宽只需重新套一遍，
     * 倍数不用动——不存在「放大到不再溢出却看不出区别」的中间态。
     */
    window.addEventListener("resize", syncAllFigures);
  }

  /* ---------------- 复制按钮 ---------------- */

  function initCopyButtons() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-copy]") : null;
      if (!btn) return;
      var block = btn.closest(".code-block");
      var code = block && block.querySelector("code");
      if (!code) return;
      var text = code.innerText;
      var done = function (ok) {
        var old = btn.textContent;
        btn.textContent = ok ? "已复制" : "复制失败";
        setTimeout(function () {
          btn.textContent = old;
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            done(true);
          },
          function () {
            done(false);
          },
        );
      } else {
        done(false);
      }
    });
  }

  /* ---------------- 图片放大 ---------------- */

  function initLightbox() {
    var box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    var img = document.createElement("img");
    box.appendChild(img);
    document.body.appendChild(box);

    function close() {
      box.hidden = true;
      img.removeAttribute("src");
    }
    box.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.tagName === "IMG" && t.closest(".markdown-body")) {
        img.src = t.getAttribute("src");
        box.hidden = false;
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    var saved = storedTheme();
    applyTheme(saved);
    initThemeButton();
    initToc();
    initCopyButtons();
    initLightbox();
    initDiagramZoom();
    initMermaid();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();