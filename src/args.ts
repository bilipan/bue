export type ThemeMode = "auto" | "light" | "dark";

export interface Options {
  /** 待预览的文件或目录路径，绝对路径 */
  targets: string[];
  port: number | undefined;
  host: string;
  theme: ThemeMode;
  width: number;
  toc: boolean;
  open: boolean;
}

export class UsageError extends Error {}

export const HELP = `bue — 本地 Markdown 预览服务器

用法
  bue <file|dir...> [选项]

示例
  bue README.md              预览单个文件
  bue docs/                   预览整个目录（按目录结构生成导航）
  bue a.md b.md               同时预览多个文件

选项
  -p, --port <n>       监听端口，默认从 3000 起自动探测空闲端口
  -H, --host <host>    监听地址，默认 127.0.0.1
  -t, --theme <mode>   主题：auto（默认，跟随系统）| light | dark
      --width <px>     正文宽度，默认 768
      --no-toc         隐藏右侧目录
      --no-open        启动后不自动打开浏览器
  -v, --version        打印版本号
  -h, --help           显示本帮助

说明
  · 每次请求都会重新读盘并渲染，所以改完文件按 Cmd+R / F5 即可看到最新内容。
  · 本工具不做 HTML 消毒：它只预览你自己的本地文件。
`;

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new UsageError(`选项 ${flag} 缺少参数`);
  return value;
}

function parseInteger(flag: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new UsageError(`选项 ${flag} 需要一个整数，收到 "${raw}"`);
  const n = Number(raw);
  if (n < min || n > max) throw new UsageError(`选项 ${flag} 需要在 ${min}–${max} 之间，收到 ${n}`);
  return n;
}

function parseTheme(raw: string): ThemeMode {
  if (raw === "auto" || raw === "light" || raw === "dark") return raw;
  throw new UsageError(`选项 --theme 只接受 auto | light | dark，收到 "${raw}"`);
}

export interface ParseOutcome {
  kind: "options";
  options: Options;
}

export type ParseResult = ParseOutcome | { kind: "help" } | { kind: "version" };

export function parseArgs(argv: string[]): ParseResult {
  const targets: string[] = [];
  let port: number | undefined;
  let host = "127.0.0.1";
  let theme: ThemeMode = "auto";
  let width = 768;
  let toc = true;
  let open = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        return { kind: "help" };
      case "-v":
      case "--version":
        return { kind: "version" };
      case "-p":
      case "--port":
        port = parseInteger(arg, requireValue(arg, argv[++i]), 1, 65535);
        break;
      case "-H":
      case "--host":
        host = requireValue(arg, argv[++i]);
        break;
      case "-t":
      case "--theme":
        theme = parseTheme(requireValue(arg, argv[++i]));
        break;
      case "--width":
        width = parseInteger(arg, requireValue(arg, argv[++i]), 320, 2400);
        break;
      case "--no-toc":
        toc = false;
        break;
      case "--no-open":
        open = false;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`未知选项 ${arg}`);
        targets.push(arg);
    }
  }

  if (targets.length === 0) throw new UsageError("请至少指定一个要预览的文件或目录");

  return { kind: "options", options: { targets, port, host, theme, width, toc, open } };
}