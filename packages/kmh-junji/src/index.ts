/** 军机阁插件宿主：agent 注册表、一对一专属会话与军机阁 workspace。 */
import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { junjiRoot } from "./paths.ts";
import { AgentStore } from "./registry.ts";
import { JunjiRuntime } from "./runtime.ts";
import { mountWeb } from "./web.ts";

export const name = "kmh-junji";
/** 会话创建/恢复、提示词装配、workspace 挂载与 Web 路由所需的生产服务。 */
export const inject = [
  "agents",
  "sessions",
  "systemPrompt",
  "sessionController",
  "workspaceRegistry",
  "connection",
];

export const Config = Schema.object({});
export type Config = ReturnType<typeof Config>;

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** 军机阁运行时。 */
    junji: JunjiRuntime;
  }
}

export { JunjiRuntime } from "./runtime.ts";

/**
 * @param ctx - 插件生命周期上下文。
 * @param config - 已校验的插件配置。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const root = junjiRoot();
  const runtime = new JunjiRuntime(ctx, new AgentStore(root), root);
  try {
    await runtime.restore();
  } catch (error) {
    ctx.logger.warn(
      `军机阁启动恢复失败，入口重试会重新扫描档案目录：${String(error)}`,
    );
  }
  ctx.provide("junji", runtime);
  mountWeb(ctx, runtime);
  void config;
}
