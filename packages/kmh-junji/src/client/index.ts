/** 军机阁客户端入口（Phase 0：注册文案；Phase 3 实装侧边栏区块与创建面板）。 */
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { NS, en, zh, type JunjiKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 军机阁侧边栏与创建面板文案。 */
    junji: JunjiKey;
  }
}

/** 客户端所需服务：槽位注册与本地化。 */
export const inject = ["slots", "locale"];

/**
 * 注册军机阁文案字典。
 * @param ctx - 客户端 Context。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "kmh-junji: dictionaries",
  );
}
