/** 两个插件都启用时，为孔明的固定会话挂载军机阁工具和提示词。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-user-approval";
import { sendAndWatch } from "@kmh/session-kit";
import { z } from "zod";
import {
  CreateAgentInputSchema,
  ModelCatalogSchema,
  UpdateAgentInputSchema,
} from "./protocol/index.ts";
import type { JunjiRuntime } from "./runtime.ts";

// 与 @kmh/kongming/events 一致的可选事件契约，仅用于类型检查。
declare module "@deepseek-ai/cordis" {
  interface Events {
    "kongming/agent-ready"(payload: { agent: Agent }): void | Promise<void>;
    "kongming/agent-detached"(payload: { agent: Agent }): void | Promise<void>;
    "kongming/visit-agents"(
      visit: (agent: Agent) => void | Promise<void>,
    ): void | Promise<void>;
  }
}

const agentId = z.string().trim().min(1).describe("Exact Junji Agent ID");
const AgentInput = z.strictObject({ agentId });
const UpdateInput = AgentInput.extend({ patch: UpdateAgentInputSchema });
const SendInput = AgentInput.extend({
  content: z.string().min(1).describe("Message text to send to the agent"),
});
const EmptyInput = z.strictObject({});

/** 将共用的输入校验规则转换成 DSH 支持的 JSON Schema 格式。 */
function tool<Schema extends z.ZodType>(
  name: string,
  description: string,
  schema: Schema,
  run: (input: z.output<Schema>, exec: ToolRunContext) => unknown,
): ToolDefinition {
  const { $schema: _dialect, ...parameters } = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    override: ({ jsonSchema }) => {
      delete jsonSchema.minLength;
    },
  });
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: "string" },
      render: (_input, value) => [{ type: "text", text: String(value) }],
    },
    async execute(input, exec) {
      return JSON.stringify(await run(schema.parse(input), exec));
    },
  };
}

function definitions(
  ctx: Context,
  runtime: JunjiRuntime,
  source: Agent,
  trackings: (() => void)[],
) {
  return [
    tool(
      "junji_list_agents",
      "List Junji Agents and their bound sessions.",
      EmptyInput,
      () =>
        runtime.list().map(({ systemPrompt: _prompt, ...record }) => record),
    ),
    tool(
      "junji_list_models",
      "List available provider and model IDs for Junji Agents.",
      EmptyInput,
      async () =>
        ModelCatalogSchema.parse(await ctx.sessionController.modelCatalog()),
    ),
    tool(
      "junji_create_agent",
      "Create a persistent Junji Agent with its own session. Use exact provider and model IDs from junji_list_models.",
      CreateAgentInputSchema,
      (input) => runtime.create(input),
    ),
    tool(
      "junji_update_agent",
      "Change the name, system prompt, or model of a Junji Agent in its existing session.",
      UpdateInput,
      ({ agentId, patch }) => runtime.update(agentId, patch),
    ),
    tool(
      "junji_open_agent",
      "Prepare a Junji Agent's existing session and return its session ID. A reserved Agent resumes its original creation.",
      AgentInput,
      ({ agentId }) => runtime.open(agentId),
    ),
    tool(
      "junji_remove_agent",
      "Request user approval to stop and archive a Junji Agent's session, then delete its profile and memory. The archived session retains its history.",
      AgentInput,
      async ({ agentId }, { callId, signal }) => {
        const record = runtime.list().find(({ id }) => id === agentId);
        if (record === undefined)
          throw Error(`军机阁没有名为 ${agentId} 的大臣`);
        const decision = await ctx.get("approval")?.request({
          agent: source,
          toolName: "junji_remove_agent",
          callId,
          reason: `停止并归档军机阁大臣「${record.name}」（${agentId}）的会话，删除其档案和记忆，保留会话历史。`,
          signal,
        });
        signal.throwIfAborted();
        if (decision !== "allowed-once") throw Error("删除大臣需要用户确认");
        await runtime.remove(agentId, record);
        return { removed: true, agentId };
      },
    ),
    tool(
      "junji_send",
      "Send a text message to a Junji Agent's bound session. The agent answers in its own session and the reply arrives automatically in this Kongming session. Wait for it; do not repeat or poll.",
      SendInput,
      async ({ agentId, content }) => {
        if (content.trim() === "") throw Error("消息正文不能为空白");
        // open 同时保障专属会话已就绪（reserved 档案续建、ready 档案可装载）。
        const { sessionId } = await runtime.open(agentId);
        const { dispatchId, release } = await sendAndWatch(ctx, {
          from: source,
          toSessionId: sessionId,
          content: [{ type: "text", text: content }],
        });
        // 轮次跟踪的释放入口交给挂载生命周期，卸载时统一清理。
        trackings.push(release);
        return { dispatchId, sessionId, agentId, status: "queued" as const };
      },
    ),
  ];
}

/** 订阅孔明会话的绑定与释放事件，并接入已经绑定的会话。 */
export async function mountKongmingTools(
  ctx: Context,
  runtime: JunjiRuntime,
): Promise<void> {
  const bindings = new Map<Agent, () => void>();
  let active = true;
  const detach = (agent: Agent) => {
    bindings.get(agent)?.();
    bindings.delete(agent);
  };
  const attach = (agent: Agent) => {
    if (!active || bindings.has(agent)) return;
    const lifetime = new AbortController();
    const releases: (() => void)[] = [];
    const release = () => {
      lifetime.abort();
      for (const off of releases.reverse()) off();
    };
    try {
      for (const definition of definitions(ctx, runtime, agent, releases)) {
        releases.push(
          agent.ctx.tools.register(
            {
              ...definition,
              execute(input, exec) {
                const signal = AbortSignal.any([exec.signal, lifetime.signal]);
                signal.throwIfAborted();
                if (exec.agent !== agent || ctx.agents.get(agent.id) !== agent)
                  throw Error("军机阁工具仅供当前孔明会话使用");
                return definition.execute(input, { ...exec, signal });
              },
            },
            { when: ({ agent: caller }) => caller === agent },
          ),
        );
      }
      releases.push(
        agent.ctx.systemPrompt.section({
          name: "kmh-junji:kongming",
          order:
            agent.ctx.systemPrompt.getSectionOrder(
              "DEPLOYMENT_PERSONA_SUFFIX",
            ) + 1,
          text: "军机阁可以创建不同专项 Agent，相关工具都以 junji_ 开头。用户提到军机阁时，指的就是这个功能。",
          interpolate: false,
        }),
      );
      bindings.set(agent, release);
    } catch (error) {
      release();
      ctx.logger.warn(`军机阁接入孔明失败：${String(error)}`);
    }
  };
  ctx.on("kongming/agent-ready", ({ agent }) => attach(agent));
  ctx.on("kongming/agent-detached", ({ agent }) => detach(agent));
  ctx.effect(
    () => () => {
      active = false;
      for (const agent of bindings.keys()) detach(agent);
    },
    "kmh-junji: release Kongming tools",
  );
  await ctx.serial("kongming/visit-agents", attach);
}
