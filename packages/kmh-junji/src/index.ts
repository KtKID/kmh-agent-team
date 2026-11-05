/** 军机阁插件宿主入口（Phase 0：装载与目录解析；注册表与记忆分阶段接入）。 */
import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { junjiRoot } from "./paths.ts";

export const name = "kmh-junji";
/** 会话创建/恢复、提示词装配与工作区挂载所需的生产服务。 */
export const inject = [
  "agents",
  "sessions",
  "systemPrompt",
  "sessionController",
  "workspaceRegistry",
];

export const Config = Schema.object({});
export type Config = ReturnType<typeof Config>;

/**
 * @param ctx - 插件生命周期上下文。
 * @param config - 已校验的插件配置。
 */
export function apply(ctx: Context, config: Config): void {
  ctx.logger.info(`军机阁已装载，数据目录：${junjiRoot()}`);
  void config;
}
