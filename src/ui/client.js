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

    // 全屏层里正拿着被移走的那个 svg：重绘会再造一个，DOM 里就会出现两份
    // 重复 id 的 SVG（marker / clipPath 全靠 id 引用），箭头会集体失效
    closeViewer();

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

  var ZOOM_MIN = 0.25;
  var ZOOM_MAX = 8;
  var ZOOM_STEP = 0.25;

  // figure -> { svg, w, h }：svg 节点换了（主题切换会重绘）就重新量，
  // 因为量到的必须是「原始尺寸」，量已缩放过的宽度会越滚越大
  var baseSizes = new WeakMap();
  var viewer = null;

  function figureOf(node) {
    return node && node.closest ? node.closest(".mermaid-figure") : null;
  }

  function svgOf(fig) {
    return fig.querySelector(".mermaid > svg");
  }

  /**
   * figure 当前的 svg 节点。全屏查看时它已经被搬进画布，不在 figure 里面了，
   * 这时候还去 figure 里找就会拿到 null——缩放会静默失效，关闭时甚至会把图弄丢。
   */
  function activeSvg(fig) {
    if (viewer && viewer.fig === fig) {
      var moved = viewer.canvas.querySelector("svg");
      if (moved) return moved;
    }
    return svgOf(fig);
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

  /**
   * 把缩放套到 svg 上。缩放值只认 figure 上的 data-zoom，
   * 全屏层里改的也是它，关掉层回到正文还是同一个大小。
   */
  function applyZoom(fig, scale) {
    scale = clamp(scale, ZOOM_MIN, ZOOM_MAX);
    fig.setAttribute("data-zoom", String(scale));

    var level = fig.querySelector("[data-zoom-level]");
    if (level) level.textContent = Math.round(scale * 100) + "%";

    var svg = activeSvg(fig);
    if (!svg) {
      fig.removeAttribute("data-rendered");
      return;
    }
    var base = baseSize(fig, svg);
    if (scale === 1) {
      /*
       * 100% 是「原样」：把 mermaid 自己写的内联样式还回去。它写的
       * max-width 就是图的固有宽度——窄图不会被拉大，宽图由 CSS 的
       * max-width: 100% 收窄。清成空串反而会让 svg 退回 width="100%"
       * 撑满容器，把小图放大变形。
       */
      if (base.style == null) svg.removeAttribute("style");
      else svg.setAttribute("style", base.style);
    } else {
      /*
       * 放大时必须显式压掉那条内联 max-width，否则放大到比它更宽
       * 就被卡住不动；width 给死 px，配合 viewport 的横向滚动。
       */
      svg.style.maxWidth = "none";
      svg.style.width = base.w ? Math.round(base.w * scale) + "px" : "";
      svg.style.height = "auto";
    }
    fig.setAttribute("data-rendered", "");
  }

  function syncFigure(fig) {
    if (!fig) return;
    applyZoom(fig, zoomOf(fig));
  }

  function syncAllFigures() {
    var figs = document.querySelectorAll(".mermaid-figure");
    for (var i = 0; i < figs.length; i++) syncFigure(figs[i]);
  }

  /* 全屏查看：层里滚轮缩放、拖拽平移、Esc 关闭 */

  function openViewer(fig) {
    closeViewer(); // 先把上一张可能还开着的放回正文，再取本图的 svg
    var svg = svgOf(fig);
    if (!svg) return;

    var box = document.createElement("div");
    box.className = "mermaid-fullscreen";

    var canvas = document.createElement("div");
    canvas.className = "mermaid-fullscreen-canvas";

    var closeBtn = document.createElement("button");
    closeBtn.className = "mermaid-fullscreen-close";
    closeBtn.type = "button";
    closeBtn.textContent = "关闭";

    /*
     * 把真实的 svg 节点搬进来，不能克隆一份：mermaid 生成的 SVG 里箭头
     * marker、clipPath 全靠 DOM id 引用，克隆会出现重复 id，引用全乱。
     */
    viewer = { fig: fig, canvas: canvas, home: svg.parentNode };
    canvas.appendChild(svg);
    box.appendChild(canvas);
    box.appendChild(closeBtn);
    document.body.appendChild(box);

    var scale = zoomOf(fig);
    applyZoom(fig, scale);
    fitViewer(scale);

    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        zoomViewerBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      },
      { passive: false },
    );

    var drag = null;
    canvas.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
      canvas.classList.add("panning");
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return;
      canvas.scrollLeft = drag.left - (e.clientX - drag.x);
      canvas.scrollTop = drag.top - (e.clientY - drag.y);
    });
    var endDrag = function () {
      drag = null;
      canvas.classList.remove("panning");
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    closeBtn.addEventListener("click", closeViewer);
  }

  /** 层内容小到不用滚时，居中显示 */
  function fitViewer(scale) {
    var canvas = viewer.canvas;
    var fig = viewer.fig;
    var svg = activeSvg(fig);
    if (!svg || !scale) return;
    var base = baseSize(fig, svg);
    var overflowX = base.w * scale - canvas.clientWidth;
    var overflowY = base.h * scale - canvas.clientHeight;
    if (overflowX > 0) canvas.scrollLeft = overflowX / 2;
    if (overflowY > 0) canvas.scrollTop = overflowY / 2;
    else canvas.scrollTop = 0;
  }

  /** 以光标为锚点缩放：缩放前后光标下的那个点保持不动 */
  function zoomViewerBy(factor, clientX, clientY) {
    var fig = viewer.fig;
    var canvas = viewer.canvas;
    var old = zoomOf(fig);
    var next = clamp(old * factor, ZOOM_MIN, ZOOM_MAX);
    if (next === old) return;

    var rect = canvas.getBoundingClientRect();
    var atX = clientX - rect.left;
    var atY = clientY - rect.top;
    var contentX = canvas.scrollLeft + atX;
    var contentY = canvas.scrollTop + atY;

    applyZoom(fig, next);
    canvas.scrollLeft = contentX * (next / old) - atX;
    canvas.scrollTop = contentY * (next / old) - atY;
  }

  function closeViewer() {
    if (!viewer) return;
    var fig = viewer.fig;
    var canvas = viewer.canvas;
    var svg = activeSvg(fig);
    if (svg) viewer.home.appendChild(svg); // 搬回正文，缩放状态保持在 data-zoom 上
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    var box = document.querySelector(".mermaid-fullscreen");
    if (box && box.parentNode) box.parentNode.removeChild(box);
    viewer = null;
    syncFigure(fig);
  }

  function initDiagramZoom() {
    if (!document.querySelector(".mermaid-figure")) return;

    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;

      var full = e.target.closest("[data-zoom-full]");
      if (full) {
        var f = figureOf(full);
        if (!f) return;
        if (viewer && viewer.fig === f) closeViewer();
        else openViewer(f);
        return;
      }

      var step = e.target.closest("[data-zoom-in]");
      var fig = figureOf(step || e.target);
      if (!fig) return;

      if (step) {
        applyZoom(fig, zoomOf(fig) + ZOOM_STEP);
        return;
      }
      if (e.target.closest("[data-zoom-out]")) {
        applyZoom(fig, zoomOf(fig) - ZOOM_STEP);
        return;
      }
      if (e.target.closest("[data-zoom-reset]")) {
        applyZoom(fig, 1);
        return;
      }
      // 点图本体（全屏按钮和工具条已在上文处理掉）进入全屏
      if (svgOf(fig) && e.target.closest(".mermaid-viewport")) openViewer(fig);
    });

    document.addEventListener("keydown", function (e) {
      if (!viewer) return;
      if (e.key === "Escape") {
        closeViewer();
        return;
      }
      if (e.key === "+" || e.key === "=") {
        zoomViewerBy(1 + ZOOM_STEP, centerX(), centerY());
      } else if (e.key === "-" || e.key === "_") {
        zoomViewerBy(1 / (1 + ZOOM_STEP), centerX(), centerY());
      } else if (e.key === "0") {
        applyZoom(viewer.fig, 1);
        fitViewer(1);
      }
    });

    window.addEventListener("resize", function () {
      // 放大到不再溢出容器时回落原始大小，免得留一个看不出区别的 150%
      var figs = document.querySelectorAll(".mermaid-figure");
      for (var i = 0; i < figs.length; i++) {
        var fig = figs[i];
        var svg = svgOf(fig);
        var vp = fig.querySelector(".mermaid-viewport");
        if (!svg || !vp || zoomOf(fig) <= 1) continue;
        if (svg.getBoundingClientRect().width <= vp.clientWidth + 1) applyZoom(fig, 1);
      }
    });
  }

  function centerX() {
    var r = viewer.canvas.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  function centerY() {
    var r = viewer.canvas.getBoundingClientRect();
    return r.top + r.height / 2;
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