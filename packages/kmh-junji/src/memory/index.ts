/** 军机阁记忆模块出口：per-agent 双文件记忆（机制移植自 kongming-memory-v1）。 */
export { resolveMemoryFiles } from "./files.ts";
export { createAgentMemory } from "./service.ts";
export { MemoryConfig } from "./config.ts";
export type { AgentMemory, MemoryFiles } from "./types.ts";
