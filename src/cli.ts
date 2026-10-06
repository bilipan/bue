#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs, UsageError, HELP } from "./args.ts";
import { start } from "./server.ts";
import { openInBrowser } from "./open.ts";

function version(): string {
  try {
    const pkg = new URL("../package.json", import.meta.url);
    return (JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`bue ${version()}\n`);
    return;
  }

  const o = parsed.options;
  const server = await start({
    targets: o.targets,
    port: o.port,
    host: o.host,
    theme: o.theme,
    width: o.width,
    toc: o.toc,
  });

  const { url, workspace } = server;
  const lines = [
    "",
    `  bue  已启动  ${process.pid === undefined ? "" : `pid ${process.pid}`}`,
    "",
    `  ${url}`,
    "",
    `  文档    ${workspace.docs.length} 篇`,
    `  根目录  ${workspace.root}`,
    "",
    "  改完文件按 Cmd+R / F5 刷新即可看到最新内容。",
    "  退出：Ctrl+C，或 pkill bue",
    "",
  ];
  process.stdout.write(lines.join("\n"));

  if (o.open) openInBrowser(url);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    process.stdout.write("\nbue 正在关闭…\n");
    void server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    // 兜底：连接迟迟不断开时强制退出
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    process.stderr.write(`bue: ${e.message}\n\n`);
    process.stderr.write(HELP);
    process.exit(2);
  }
  const err = e as Error;
  process.stderr.write(`bue: ${err.message ?? String(e)}\n`);
  process.exit(1);
});