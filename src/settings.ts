import type { ThemeMode } from "./args.ts";

/** 影响页面渲染的选项子集（与监听/端口等无关） */
export interface RenderSettings {
  theme: ThemeMode;
  width: number;
  toc: boolean;
}

export function toRenderSettings(o: {
  theme: ThemeMode;
  width: number;
  toc: boolean;
}): RenderSettings {
  return { theme: o.theme, width: o.width, toc: o.toc };
}