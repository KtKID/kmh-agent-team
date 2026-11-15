/** 解析军机阁档案目录与大臣会话工作目录。 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { realpathNormalize } from "@deepseek-ai/dsh-workspace";

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
 * @param cwd - 新大臣会话的服务端工作目录。
 * @returns 已存在目录的规范绝对路径。
 * @throws 路径不是可解析的绝对目录时抛出错误。
 */
export async function resolveAgentCwd(cwd: string): Promise<string> {
  const message = `工作目录必须是服务端已存在的绝对目录：${cwd}`;
  try {
    const canonical = await realpathNormalize(cwd);
    if ((await stat(canonical)).isDirectory()) return canonical;
  } catch (cause) {
    throw Error(message, { cause });
  }
  throw Error(message);
}

/**
 * @param root - 军机阁根目录。
 * @param agentId - agent 稳定标识（slug）。
 * @returns 单个 agent 的独立目录。
 */
export function agentDir(root: string, agentId: string): string {
  return join(root, agentId);
}
