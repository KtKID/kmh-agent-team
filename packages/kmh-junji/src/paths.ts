/** 军机阁数据目录解析：所有 agent 目录位于 DSH home 下的 agent-team/。 */
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

/**
 * @param env - 启动进程环境。
 * @returns 军机阁根目录（`<dsh-home>/agent-team`），每个 agent 一个子目录。
 */
export function junjiRoot(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveDshHome(undefined, env), "agent-team");
}

/**
 * @param root - 军机阁根目录。
 * @param agentId - agent 稳定标识（slug）。
 * @returns 单个 agent 的独立目录。
 */
export function agentDir(root: string, agentId: string): string {
  return join(root, agentId);
}
