/** 单个 agent 的记忆服务：序列化文件工作、冻结读取与 per-agent 绑定。机制移植自 kongming-memory-v1。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  initializeMemoryFiles,
  readFrozenFile,
  replaceFrozenFile,
} from "./files.ts";
import { mountFrozenPrompt } from "./prompt.ts";
import { MemoryConfig } from "./config.ts";
import { mountMemoryReminder } from "./steer.ts";
import { mountCompactionRefresh } from "./compaction.ts";
import type { AgentMemory, MemoryFiles } from "./types.ts";

/**
 * 创建一个 agent 的记忆服务并登记清理；路径和模板由调用方提供，模板校验同步抛错，
 * 读写错误传播到请求或调用方。
 * @param ctx - 插件生命周期上下文。
 * @param files - 该 agent 的两份记忆文件路径。
 * @param config - 已校验的记忆配置。
 */
export function createAgentMemory(
  ctx: Context,
  files: MemoryFiles,
  config: MemoryConfig = MemoryConfig({}),
): AgentMemory {
  const promptConfig = MemoryConfig(config);
  let writing = Promise.resolve();
  let closed = false;
  let closing: Promise<void> | undefined;
  let publishedId: string | undefined;
  const bindings = new Map<Agent, () => Promise<void>>();
  const enqueue = async (action: () => Promise<void>): Promise<void> => {
    if (closed) throw Error("军机阁记忆服务已关闭");
    writing = writing.catch(() => undefined).then(action);
    await writing;
  };
  const memory: AgentMemory = {
    files,
    initialize: (signal) => enqueue(() => initializeMemoryFiles(files, signal)),
    async readFrozen(signal) {
      if (closed) throw Error("军机阁记忆服务已关闭");
      await writing;
      return readFrozenFile(files, signal);
    },
    refreshFrozen: (result, signal) =>
      enqueue(async () => {
        if (publishedId === result.compactionId) return;
        await replaceFrozenFile(files, signal);
        publishedId = result.compactionId;
      }),
    bindAgent(agent) {
      if (closed) throw Error("军机阁记忆服务已关闭");
      const existing = bindings.get(agent);
      if (existing !== undefined) return existing;
      const releasePrompt = mountFrozenPrompt(agent, memory, promptConfig);
      const releaseReminder = mountMemoryReminder(
        agent,
        files,
        promptConfig.reminderPrompt,
      );
      const releaseCompaction = mountCompactionRefresh(agent, memory);
      const release = async (): Promise<void> => {
        releaseReminder();
        releasePrompt();
        bindings.delete(agent);
        await releaseCompaction();
      };
      bindings.set(agent, release);
      return release;
    },
    close() {
      closed = true;
      return (closing ??= (async () => {
        await Promise.all([...bindings.values()].map((release) => release()));
        await writing.catch(() => {
          /* 文件工作失败已由调用方收到，收敛时不再重复报告。 */
        });
      })());
    },
  };
  ctx.effect(
    () => () => void memory.close(),
    "kmh-junji: settle agent memory",
  );
  return memory;
}
