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
    window.__bueMermaid.run({ nodes: nodes }).catch(function (e) {
      reportMermaidError(nodes, e);
    });
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
    initMermaid();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();