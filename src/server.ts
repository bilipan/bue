import { createServer, type Server } from "node:http";
import { buildWorkspace, type Workspace } from "./config.ts";
import { createHandler } from "./routes/document.ts";
import { toRenderSettings, type RenderSettings } from "./settings.ts";

export interface StartOptions extends RenderSettings {
  targets: string[];
  port: number | undefined;
  host: string;
}

export interface RunningServer {
  url: string;
  port: number;
  workspace: Workspace;
  close: () => Promise<void>;
}

/**
 * 绑定端口。requested 为 undefined 时从 3000 起向上探测；传 0 表示让系统分配。
 * 注意 0 是 falsy，不能用 `requested || 3000` 判断，否则端口 0 会被当成"未指定"。
 */
export async function listen(
  host: string,
  requested: number | undefined,
): Promise<{ server: Server; port: number }> {
  const first = requested ?? 3000;
  const attempts = requested === undefined ? 50 : 1;

  for (let i = 0; i < attempts; i++) {
    const want = first + i;
    const server = createServer();
    const ok = await new Promise<boolean>((done) => {
      server.once("error", () => done(false));
      server.listen(want, host, () => done(true));
    });
    if (ok) {
      // want 可能是 0（系统分配），必须回读真实端口
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : want;
      return { server, port };
    }
    server.close();
    if (attempts === 1) {
      throw new Error(`端口 ${want} 已被占用，换一个：bue --port ${want + 1}`);
    }
  }
  throw new Error(`从 ${first} 到 ${first + attempts - 1} 都没找到空闲端口`);
}

export async function start(options: StartOptions): Promise<RunningServer> {
  const workspace = buildWorkspace(options.targets);
  if (workspace.docs.length === 0) {
    throw new Error(
      `在 ${workspace.root} 下没有找到任何 Markdown 文件` +
        `（支持 .md / .markdown）。检查一下路径是否写对了。`,
    );
  }

  const handler = createHandler(workspace, toRenderSettings(options));
  const { server, port } = await listen(options.host, options.port);
  server.on("request", (req, res) => {
    void handler(req, res);
  });

  const displayHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
  return {
    url: `http://${displayHost}:${port}`,
    port,
    workspace,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((err) => (err ? fail(err) : done()));
        server.closeAllConnections?.();
      }),
  };
}