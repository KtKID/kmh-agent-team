/** 军机阁协议：agent 档案与客户端请求的 zod 契约（host 与 client 共用真源）。 */
import { z } from "zod";

/** agent 的模型选择；provider/model 语义与 DSH 模型选择一致。 */
export const AgentModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
});
export type AgentModel = z.infer<typeof AgentModelSchema>;

/**
 * 一个大臣的档案（agent.json）。
 * `sessionId` 一经写入永不变更（agent↔session 一对一永久绑定）；
 * `phase` 为 reserved 表示目录已建但专属会话尚未创建完成。
 */
export const AgentRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: AgentModelSchema,
  sessionId: z.string().min(1),
  phase: z.enum(["reserved", "ready"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

/** 创建 agent 的输入；sessionId 由 host 生成并绑定。 */
export const CreateAgentInputSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: AgentModelSchema,
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

/** 更新 agent 的输入；sessionId 与 id 不可变。 */
export const UpdateAgentInputSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  model: AgentModelSchema.optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

/** 创建结果：档案加专属会话 id。 */
export const AgentCreatedSchema = z.object({
  agent: AgentRecordSchema,
  sessionId: z.string().min(1),
});
export type AgentCreated = z.infer<typeof AgentCreatedSchema>;
