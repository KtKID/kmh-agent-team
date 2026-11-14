/** 军机阁客户端入口：注册主面板、侧边栏启动行与文案，打开动作经 uiWorkspace 进入专属会话。 */
import { createElement, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { JunjiPanel } from "./JunjiPanel.tsx";
import { openAgent } from "./transport.ts";
import { NS, en, zh, type JunjiKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 军机阁侧边栏与创建面板文案。 */
    junji: JunjiKey;
  }
}

/** 浏览器半的公开服务依赖。 */
export const inject = ["slots", "locale", "sessions", "uiWorkspace"];

/** 军机阁主面板与侧栏启动行共用的面板 id。 */
const PANEL_ID = brandString<MainPanelId>("kmh-junji");

/** @param props - 宿主提供的侧栏尺寸。 @returns 跟随宿主前景色的双层飞檐图标。 */
function JunjiIcon({ size }: PropsRuntime<"sidebar.panellist">): ReactNode {
  return createElement(
    "svg",
    {
      "aria-hidden": true,
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    createElement("path", {
      d: "M3 6.5C5 6.1 6.6 4.9 8 2.5c1.4 2.4 3 3.6 5 4H3Z",
    }),
    createElement("path", {
      d: "M4.5 6.5C4 8 3 9.2 1.5 10h13c-1.5-.8-2.5-2-3-3.5M4 10v3.5M12 10v3.5M3 13.5h10",
    }),
  );
}

/**
 * 注册军机阁主面板、侧栏启动行与文案。
 * @param ctx - 浏览器插件的生命周期上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));
  const t = ctx.locale.bind(NS);
  const open = async (id: string): Promise<void> => {
    const opened = await openAgent(id);
    await ctx.sessions.refresh();
    ctx.uiWorkspace.openSession(brandString<SessionId>(opened.sessionId));
  };
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ open }),
      },
      JunjiPanel,
    ),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 4,
        locale: NS,
        label: () => t("panel"),
      },
      JunjiIcon,
    ),
  );
}
