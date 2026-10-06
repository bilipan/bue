import { spawn } from "node:child_process";

/** 各平台打开 URL/文件用的命令 */
function opener(): { cmd: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "win32":
      return { cmd: "cmd", args: ["/c", "start", ""] };
    default:
      return { cmd: "xdg-open", args: [] };
  }
}

export function openInBrowser(target: string): void {
  const { cmd, args } = opener();
  try {
    const child = spawn(cmd, [...args, target], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      /* 打不开就算了，用户可以手动访问打印出来的地址 */
    });
    child.unref();
  } catch {
    /* 同上 */
  }
}