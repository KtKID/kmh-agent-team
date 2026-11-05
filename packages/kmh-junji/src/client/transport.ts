/** 军机阁浏览器请求封装；同源 DSH 鉴权通道，响应经 zod 校验。 */
import {
  AgentCreatedSchema,
  AgentListSchema,
  BootstrapSchema,
  ErrorSchema,
  OpenedSchema,
  type AgentCreated,
  type AgentList,
  type AgentRecord,
  type Bootstrap,
  type CreateAgentInput,
  type Opened,
  type UpdateAgentInput,
} from "../protocol/index.ts";

/** @param response - 原始响应。 @returns 解析后的失败消息。 */
async function failure(response: Response): Promise<string> {
  try {
    return ErrorSchema.parse(await response.json()).message;
  } catch {
    return `请求失败（HTTP ${response.status}）`;
  }
}

/** @param action - 插件固定路由段。 @param body - 可选 JSON 请求体。 @param signal - 可选取消。 @returns 待业务 schema 校验的响应。 */
async function request(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/kmh-junji/${action}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw Error(await failure(response));
  return response.json();
}

/** @param signal - 调用者取消。 @returns agent 列表与模型目录。 */
export async function bootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  return BootstrapSchema.parse(await request("bootstrap", undefined, signal));
}

/** @param signal - 调用者取消。 @returns agent 列表。 */
export async function listAgents(signal?: AbortSignal): Promise<AgentList> {
  return AgentListSchema.parse(await request("list", undefined, signal));
}

/** @param input - 创建输入。 @returns 档案与专属会话。 */
export async function createAgent(input: CreateAgentInput): Promise<AgentCreated> {
  return AgentCreatedSchema.parse(await request("create", input));
}

/**
 * @param id - agent 稳定标识。
 * @param patch - 更新输入。
 * @returns 更新后的档案。
 */
export async function updateAgent(
  id: string,
  patch: UpdateAgentInput,
): Promise<AgentRecord> {
  const value: unknown = await request(
    `update?id=${encodeURIComponent(id)}`,
    patch,
  );
  return AgentListSchema.shape.agents.element.parse(
    (value as { agent: unknown }).agent,
  );
}

/** @param id - agent 稳定标识。 */
export async function removeAgent(id: string): Promise<void> {
  await request(`remove?id=${encodeURIComponent(id)}`);
}

/** @param id - agent 稳定标识。 @returns 专属会话 id。 */
export async function openAgent(id: string): Promise<Opened> {
  return OpenedSchema.parse(
    await request(`open?id=${encodeURIComponent(id)}`),
  );
}
