/** 军机阁协议：agent 档案与客户端请求的 zod 契约（host 与 client 共用真源）。 */
import { z } from "zod";

const text = z.string().trim().min(1);

/** agent 的模型选择；语义与 DSH ModelSelection 一致。 */
export const AgentModelSchema = z
  .object({ provider: text, model: text, reasoningEffort: text.optional() })
  .strict();
export type AgentModel = z.infer<typeof AgentModelSchema>;

/**
 * 一个大臣的档案（agent.json）。
 * `sessionId` 一经写入永不变更（agent↔session 一对一永久绑定）；
 * `phase` 为 reserved 表示目录已建但专属会话尚未创建完成。
 */
export const AgentRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: text,
  systemPrompt: z.string().min(1),
  model: AgentModelSchema,
  sessionId: z.string().min(1),
  phase: z.enum(["reserved", "ready"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

/** 创建 agent 的输入；sessionId 由 host 生成并绑定。 */
export const CreateAgentInputSchema = z
  .object({ name: text, systemPrompt: text, model: AgentModelSchema })
  .strict();
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

/** 更新 agent 的输入；sessionId 与 id 不可变。 */
export const UpdateAgentInputSchema = z
  .object({
    name: text.optional(),
    systemPrompt: z.string().min(1).optional(),
    model: AgentModelSchema.optional(),
  })
  .strict();
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

/** 创建结果：档案加专属会话 id。 */
export const AgentCreatedSchema = z.object({
  agent: AgentRecordSchema,
  sessionId: z.string().min(1),
});
export type AgentCreated = z.infer<typeof AgentCreatedSchema>;

/** 模型目录（透传 sessionController.modelCatalog()）。 */
export const ModelCatalogSchema = z.object({
  default: AgentModelSchema,
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      models: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  failures: z.array(
    z.object({ id: z.string(), name: z.string(), message: z.string() }),
  ),
  routableProviders: z.array(z.string()),
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;

/** 客户端引导数据：agent 列表 + 模型目录。 */
export const BootstrapSchema = z.object({
  agents: z.array(AgentRecordSchema),
  catalog: ModelCatalogSchema,
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

/** agent 列表响应。 */
export const AgentListSchema = z.object({ agents: z.array(AgentRecordSchema) });
export type AgentList = z.infer<typeof AgentListSchema>;

/** 打开会话响应。 */
export const OpenedSchema = z.object({ sessionId: z.string().min(1) });
export type Opened = z.infer<typeof OpenedSchema>;

/** 失败响应。 */
export const ErrorSchema = z.object({ message: z.string().min(1) });
