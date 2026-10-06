# bue

本地 Markdown 预览服务器。`bue 某个.md` 直接起服务并在浏览器里渲染，支持 Mermaid、代码高亮、表格和目录导航。

```bash
bue README.md
```

## 安装

需要 Node 22.18 以上（用到 Node 原生的 TypeScript 执行，无构建步骤）。

```bash
pnpm install
pnpm link --global     # 得到全局 bue 命令
```

## 用法

```bash
bue <file|dir...> [选项]
```

| 选项 | 说明 |
| --- | --- |
| `-p, --port <n>` | 监听端口，默认从 3000 起自动探测空闲端口 |
| `-H, --host <host>` | 监听地址，默认 `127.0.0.1` |
| `-t, --theme <mode>` | `auto`（默认，跟随系统）/ `light` / `dark` |
| `--width <px>` | 正文宽度，默认 `768` |
| `--no-toc` | 隐藏右侧目录 |
| `--no-open` | 启动后不自动打开浏览器 |
| `-v, --version` `-h, --help` | 版本号 / 帮助 |

```bash
bue README.md                  # 单文件
bue docs/                       # 整个目录，递归扫描并生成站内导航
bue a.md b.md                   # 多个文件
bue docs/ --no-open --port 4000  # 不自动开浏览器，指定端口
```

## 刷新方式

**每次请求都会重新读盘并渲染**，所以改完文件按 `Cmd+R` / `F5` 即可看到最新内容。

本工具**不做文件监听、不做自动热重载**——这是刻意的取舍：省掉 watcher 和 SSE 长连接，换来更少的活动部件。按一下刷新键的成本远小于维护长连接的复杂度。

## 支持的能力

- **Markdown**：marked + GFM，表格、任务列表、脚注式引用
- **Mermaid**：` ```mermaid ` 代码块，浏览器端渲染。渲染失败时在该位置显示错误和源码，不会白屏
- **图缩放**：每张图自带 `− / 百分比 / + / 1:1 / 全屏`，放大后横向滚动；全屏里可滚轮缩放、拖拽平移、`Esc` 退出。切主题重绘后缩放保持不变
- **代码高亮**：highlight.js，内联复制按钮
- **相对资源**：md 里的 `./img/a.png`、指向其他 md 的 `[链接](guide/install.md)` 都会被改写成站内路由，目录模式可以直接互跳
- **目录**：右侧折叠面板，`IntersectionObserver` 滚动高亮，宽屏常驻 / 窄屏抽屉
- **主题**：CSS `light-dark()` 双主题，跟随系统，可手动切换并记住选择
- **中文标题锚点**：`## 安装` → `#安装`，重名标题自动加 `-2` 后缀

## 路由

| 路由 | 说明 |
| --- | --- |
| `/` | 单文件渲染该文件；目录模式渲染 `README.md`，没有则给文件索引页 |
| `/d/<slug>` | 打开某篇文档，slug 为相对路径去扩展名 |
| `/raw/<slug>` | 查看 Markdown 源码 |
| `/assets/*` | 文档根目录下的静态资源（图片、pdf…） |
| `/vendor/mermaid.js` `/vendor/hljs/*.css` | 前端依赖 |

## 设计取舍

几个刻意的决定，记录下来免得以后「优化」掉：

- **HTML 一律 `no-store`，前端资源走长缓存。** 每次请求都重新渲染，所以绝不能让浏览器拿旧副本；mermaid 有 5.5MB，重复预览时不该反复重传。
- **mermaid 用 UMD 单文件而不是 ESM 入口。** `mermaid.esm.min.js` 是 30KB 的懒加载入口，一个 `flowchart-elk` 就要拉 1.6MB 的 elk chunk。UMD 版本全量内联，没有 chunk 瀑布。
- **图的缩放值存在 `figure[data-zoom]` 上，不存在 svg 或 `.mermaid` 里。** 主题切换会重绘并清空 `.mermaid`，缩放值得活在重绘之外才留得住；重绘完再把新 svg 套回同一个值。
- **全屏查看是搬运真实 svg 节点，不是克隆。** mermaid 生成的 SVG 里箭头 marker、clipPath 全靠 DOM id 引用，克隆一份会出现重复 id，引用直接失效。所以关闭时要把节点搬回原来的 figure。
- **100% 时不动 svg 的内联样式。** mermaid 自己写的 `max-width` 就是图的固有宽度：窄图不放大、宽图由 CSS 收窄。清成空串会让 svg 退回 `width="100%"` 撑满容器，把小图拉变形。
- **图缩放和全屏层都不锁页面滚动。** 溢出交给容器横向滚动 + `overscroll-behavior: contain`，和目录抽屉、图片灯箱一个原则。
- **每次渲染都新建 `Marked` 实例。** 渲染器闭包里持有本次的标题 id 映射，复用实例会让并发请求互相污染。
- **标题 id 在渲染时分配，不靠预扫描源码。** marked 还认 setext 标题（`===` 下划线式），预扫描的正则会漏算导致 id 整体错位。
- **路径安全边界是工作区根目录，不是当前文档目录。** `../README.md` 在工作区内是合法的，拿文档目录当边界会把站内相对链接全判成越界。
- **不做 HTML 消毒。** 它只预览你自己的本地文件，引入 DOMPurify 只会增加摩擦。

## 已知限制

- 没有自动热重载，按 `Cmd+R` 刷新。
- 目录模式递归深度上限 12 层，自动跳过 `node_modules`、`.git`、`dist`、点目录。
- Mermaid 需要 WASM 的图类型（`flowchart-elk`、handDrawn 风格）在个别环境下可能失败，会回落到显示源码。
- 忘了关进程会占住端口：`pkill bue`。

## 开发

```bash
pnpm test        # node --test
pnpm typecheck   # tsc --noEmit
pnpm start -- examples/demo.md
```

`examples/demo.md` 是覆盖全部能力的验收样例，`examples/docs/` 是多文件目录模式样例。