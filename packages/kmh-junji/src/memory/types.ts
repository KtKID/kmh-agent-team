/** 军机阁记忆模块类型契约；文件、提示词、提醒与压缩模块共同引用。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CompactionResult } from "@deepseek-ai/dsh-compaction";
import type { SessionId } from "@deepseek-ai/dsh-session";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "kmh-junji:memory-reminder": {
      readonly kind: "kmh-junji:memory-reminder";
      readonly form: "instructions";
      readonly sessionId: SessionId;
      readonly turn: number;
    };
  }
}

/** 单个 agent 的两份记忆文件绝对路径（位于其独立目录）。 */
export interface MemoryFiles {
  /** 大臣通过现有文件工具维护的原始记忆小本子。 */
  readonly original: string;
  /** 提示词每次完整读取、由插件复制发布的冻结记忆。 */
  readonly frozen: string;
}

/** 单个 agent 的记忆服务：冻结加载、收尾提醒与手动压缩刷新。机制移植自 kongming-memory-v1。 */
export interface AgentMemory {
  /** 本 agent 的两份文件路径。 */
  readonly files: MemoryFiles;
  /** 补齐原始文件，首次复制冻结文件；失败保留已有文件并拒绝。 */
  initialize(signal?: AbortSignal): Promise<void>;
  /** 等待当前发布完成并读取完整冻结正文；读取失败直接拒绝。 */
  readFrozen(signal?: AbortSignal): Promise<string>;
  /** 接受已成功完成的压缩结果并完整刷新；失败保留完整旧版并拒绝。 */
  refreshFrozen(result: CompactionResult, signal?: AbortSignal): Promise<void>;
  /** 为该 agent 绑定冻结提示、同轮收尾提醒与手动刷新；返回异步清理入口。 */
  bindAgent(agent: Agent): () => Promise<void>;
  /** 释放监听并等待文件工作收敛；清理错误向调用者传播。 */
  close(): Promise<void>;
}
