# AGENTS.md — bue

本地 Markdown 预览服务器。Node 22.18+ 原生执行 TypeScript，**没有构建步骤**。

## 命令

```bash
pnpm install
pnpm test                      # node --test，自动发现 tests/**/*.test.ts
pnpm typecheck                 # tsc --noEmit
pnpm start -- examples/demo.md # 本地跑
pnpm link --global             # 暴露全局 bue
```

改完代码后：`pnpm typecheck` + `pnpm test` 都要过。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `src/cli.ts` | 入口，`#!/usr/bin/env node`，参数解析后装配并监听 SIGINT |
| `src/args.ts` | argv 解析与帮助文本，纯函数无副作用 |
| `src/config.ts` | 扫目录、算 slug 与文档根目录，产出 `Workspace` |
| `src/settings.ts` | `RenderSettings`（theme / width / toc），从 CLI 选项裁剪 |
| `src/server.ts` | 端口探测 + `node:http` 服务装配 |
| `src/routes/document.ts` | 路由分发、相对 URL 改写、文档页渲染 |
| `src/routes/index.ts` | 目录模式无 README 时的文件索引页 |
| `src/routes/assets.ts` | `safeResolve` 路径穿越防护 + `/assets/*` |
| `src/routes/vendor.ts` | 前端依赖白名单 + 进程内缓存 |
| `src/render/markdown.ts` | marked 流水线（代码块 / mermaid / 标题 id / 链接与图片） |
| `src/render/toc.ts` | 标题 slug、id 去重分配、目录层级裁剪 |
| `src/render/highlight.ts` | hljs 封装，主题 CSS 路径 |
| `src/ui/theme.css` | GitHub README 风样式，`light-dark()` 双主题 |
| `src/ui/client.js` | 浏览器端：主题、目录、mermaid、图缩放与拖动平移、复制、灯箱 |
| `src/ui/shell.ts` | HTML 外壳拼装，CSS/JS 内联 |
| `examples/demo.md` | 单文件能力验收样例 |
| `examples/docs/` | 多文件目录模式样例 |

## 必须遵守的平台约束

这几条都是踩过坑确认的，改代码时不要绕过：

1. **相对 import 必须带显式 `.ts` 扩展名。** `./foo` 会 `ERR_MODULE_NOT_FOUND`。
2. **只用 Node 原生可擦除的 TS 语法。** tsconfig 开了 `erasableSyntaxOnly`：不能用 enum、namespace、参数属性、装饰器。
3. **内联 `<script>` 前必须转义 `</script`。** `shell.ts` 的 `inlineScript()` 负责；mermaid 里就有这类模板字符串，不转义会直接语法崩。
4. **HTML 路由的 404 必须带 404 状态码。** `notFound()` 封装，不要用 `html()`。
5. **`safeResolve(allowedRoot, baseDir, urlPath)` 的两个路径参数不能合并。** `baseDir` 是解析起点（当前文档目录），`allowedRoot` 才是安全边界（工作区根）。合并会把合法的 `../` 判成越界。
6. **不要锁页面滚动，也不要加遮罩。** 宽屏目录是常驻侧栏，一旦出现 `body { overflow: hidden }` 整页就滚不动（真出过这个 bug）。窄屏抽屉靠「点抽屉外」关闭，不靠遮罩——遮罩会吃掉正文区域的触摸滚动。`tests/ui.test.ts` 守着这条。
7. **凡是"收起目录"的逻辑都必须先判 `wide.matches`。** 宽屏目录是常驻侧栏，点目录项、点页面空白都不能把它收起——只有工具条按钮能。只有窄屏抽屉才该自动收起。这条同样有测试守着。
8. **改 mermaid 缩放先读这三条坑。** 倍数 1（适配）必须还原本来的内联 `max-width`，清空会让小图撑满变形；放大时反过来要显式写 `max-width: none`，否则被 mermaid 的内联值卡住。`data-zoom` 记的是「相对适配容器的倍数」而不是绝对像素——别改成存 px，容器一变宽就得逐图重算。
9. **缩放不得改变容器尺寸。** viewport 的高度由 JS 按「适配时的图高」写死，缩放只改内部可视范围；否则放大一张竖长的图会把外框顶高、整页跟着跳。配套两个细节别改掉：viewport 是 `box-sizing: content-box`（否则上下内边距从 height 里扣，适配时凭空多出纵向溢出），svg 是 `display: block`（inline svg 底下留约 7px 基线间隙，同样会变成一条多余的滚动条）。
10. **溢出要两轴都能滚，`safe center` 也要两轴都给。** 竖长的 sequence 放大后往往只溢出纵向，只给横向滚动那半截就永远看不到；只判 `scrollWidth` 会漏掉这种图、误以为没东西可拖。
11. **flex 容器里的 mermaid 图要显式给 `align-items`。** 默认 `stretch` 会把 svg 拉成容器那么高，看起来像缩放失灵。
12. **拖动模式一开就接管 pointer，不看是不是适配尺寸。** 拖动模式的意义就是「拖画布」，等用户先放大到溢出才生效是反的。但平移有两条路，别搞混：内容比框大用 viewport 滚动，内容比框小滚动没有范围、改用 `transform` 在空隙里挪，两条都以「内容不能被拖出视野」为界，且同一轴上不能同时生效。只有「真的无处可挪」（宽图刚好铺满）才放行，否则 `preventDefault()` / `touch-action: none` 会吃掉页面滚动。算空隙前记得先扣掉 viewport 的内边距——`clientHeight` 是含 padding 的，直接减图高会把空隙多算几 px。
13. **缩放以视口中心为锚。** 不锚定的话每点一次放大都在往右跳，配合拖动根本没法盯住某一块；空隙里的 `freeX/freeY` 也要按同比例跟着缩放走。
14. **相对链接永远不要把原始 href 原样还给浏览器。** 浏览器是拿它对着当前 URL 解析的，正文页在 `/d/<slug>` 或 `/p/<path>` 下，`[b](other.md)` 会被解析成 `/d/other.md` 必然 404。改写器要么给出站内绝对地址，要么明确知道自己没处理好——`return href` 这种写法已经害出过一次线上 404（单文件模式里链到没被扫描的兄弟文档）。`tests/server.test.ts` 的「单文件模式下的文档间跳转」就是这条的护栏。
15. **`.md` 链接有两个地址，别只认一个。** 扫进 workspace 的用 `/d/<slug>`，没扫进去的用 `/p/<路径>` 按盘上文件渲染。`/p/` 命中清单同 slug 时 302 归一到 `/d/`。
16. **markdown 扩展名清单只写在 `config.ts` 一处**（`MARKDOWN_EXTS` / `stripMarkdownExt`）。别再在路由里手写 `/\.(md|markdown|mdown|mkd)$/` 这类副本，扩展名一改就会漂。
17. **正文宽度别走内联 style。** 内联的 `max-width` 优先级高于类规则，会把「没有目录时放宽并居中」压掉。宽度上限写在 `.markdown-body`，`.bue-layout` 用 `.has-toc` 区分有没有侧栏。

## 架构要点

- **无文件监听、无 SSE、无热重载。** 每次请求重新读盘渲染，用户按 `Cmd+R`。这是刻意的，见 README「设计取舍」。不要主动加 watcher。
- **`renderMarkdown` 每次调用新建 `Marked` 实例**，渲染器闭包持有本次的标题 id 映射。这是防请求间状态污染，别图省事提成单例。
- **标题 id 在渲染时分配**（`createIdAllocator`），不预扫描源码——marked 还认 setext 标题，预扫描会漏算。
- **slug 必须走 `config.ts` 的 `slugifyPath()`。** `buildWorkspace` 和 URL 重写器共用它，各自实现必然漂移。
- **HTML `no-store` / vendor 长缓存。** 别把两个反了。
- **mermaid 走 `/vendor/mermaid.js`（UMD 单文件）**，不要改成 `mermaid.esm.min.js`，那会引入 chunk 懒加载瀑布。
- **workspace 是启动时的快照。** 新增的文件不在清单里，但照样能通过 `/p/` 打开；反过来别指望清单会跟着磁盘变。

## 手动验收清单

改前端相关代码后，用浏览器（`playwright` 或 Chrome DevTools MCP）过一遍 `examples/demo.md`：

- 6 张 mermaid 图（flowchart / flowchart-elk / sequence / state / gantt / pie）全部出图，无 `.mermaid-error`
- 主题切换：body 背景变 `#0d1117`、hljs 主题 link 切换、mermaid 重绘
- **mermaid 节点不带阴影**：`[...document.querySelectorAll('.mermaid svg *')].filter((n) => getComputedStyle(n).filter !== 'none')` 应为 0（sequence 的 actor 也要算进去）
- 代码块复制按钮、图片灯箱、目录滚动高亮、锚点跳转
- 目录模式：`examples/docs/` 下跨文档跳转、相对图片 `/assets/` 加载、404 状态码
- 窄屏（<900px）：TOC 默认收起且不遮挡工具条，抽屉可开可关
- `--no-toc`：正文应居中（左右留白相等）且明显变宽，mermaid 列宽跟着变大
- **宽屏点目录项后目录必须仍在**（只滚动页面，不收起侧栏）；窄屏点目录项才收起抽屉
- **滚动任何时候都可用**：宽屏目录展开/收起两种状态都能滚；窄屏抽屉打开时正文仍能滚动（含真实触摸滑动），抽屉自身也能独立滚
- 图工具条：6 张图右上角都有，四个图标按钮（拖动 / 缩小 / 放大 / 适配），没有文字标签
- 图缩放：`放大` 两三次后左右两端都能滚到（尤其 gantt / sequence）；`适配` 后宽度回到铺满列宽，窄图不被拉大
- **缩放时容器尺寸不能变**：放大前后量 figure 的 `getBoundingClientRect().height`，要一模一样（否则页面会跳）
- **适配状态下不能冒出滚动条**：逐张看 6 张图，`scrollWidth/scrollHeight` 都该正好等于 `clientWidth/clientHeight`（多出 1–7px 就是基线间隙或内边距被算进了锁高）
- **切主题后缩放倍数不变**（重绘换了新 svg 节点，缩放要套回去）；改变窗口宽度后倍数也不变，只是适配比例重算
- 拖动模式：打开后按钮点亮、光标变抓手；**在适配尺寸下也要能拖**（窄图、缩小到比框还小这两种有「空隙」的情况），宽图刚好铺满框时拖了不动是正常的
- 拖动方向：宽图拖横向、sequence 拖纵向，两个方向都要试；两轴都溢出时四个角都要够得着
- **拖动模式开着但图无处可挪时，按住图仍能正常滚动页面**（窄屏用真实触摸滑一遍，这条最容易被改坏）
- 文档间跳转：`demo.md` 底部「文档间跳转」四条链接逐条点开，全是 200 而不是 404；跨文档锚点要真的滚到对应小节（看 `window.scrollY`）；从 `pipeline.md` 里的 `../README.md` 能跳回文档站