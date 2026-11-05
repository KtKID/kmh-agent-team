/** 将 agent 的系统提示词绑定到其 Agent 作用域，覆盖部署默认人格。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import { PERSONA_PREFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";

/**
 * 在该 agent 的会话上以用户设定的系统提示词遮蔽部署级 persona 前缀段，
 * 其余段落（运行时上下文、工具说明等）保持不变。
 * @param agent - agent 的真实 Agent 运行时。
 * @param systemPrompt - 创建面板填写的系统提示词。
 * @returns 幂等清理入口；卸载或换提示词时调用。
 */
export function mountAgentPrompt(
  agent: Agent,
  systemPrompt: string,
): () => void {
  const release = agent.ctx.systemPrompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: agent.ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
    text: systemPrompt,
    interpolate: false,
  });
  let active = true;
  return () => {
    if (active) {
      active = false;
      release();
    }
  };
}
