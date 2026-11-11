/**
 * 孔明会话军机阁工具集测试：junji_send 发送、错误路径与挂载释放（fake ctx/runtime，
 * sendAndWatch 走 session-kit 真函数）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mountKongmingTools } from "../lib/src/kongming-integration.js";

/** 构造收集事件监听与工具注册的 fake 宿主上下文。 */
function makeCtx() {
  const handlers = new Map();
  const effects = [];
  const ctx = {
    /** 目标会话表：sessionId → fake 大臣 Agent（resolveAgent 查这里）。 */
    targets: new Map(),
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const remaining = handlers.get(event) ?? [];
        const index = remaining.indexOf(handler);
        if (index >= 0) remaining.splice(index, 1);
      };
    },
    emit(event, ...args) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
    },
    liveHandlers: () =>
      [...handlers.values()].reduce((sum, list) => sum + list.length, 0),
    effect(factory) {
      // cordis effect 接收工厂，返回值才是清理函数。
      effects.push(factory());
    },
    runCleanups() {
      for (const cleanup of effects.splice(0)) cleanup();
    },
    async serial(_event, visitor) {
      await visitor(ctx.agent);
    },
    agents: {
      get(id) {
        return id === ctx.agent?.id ? ctx.agent : undefined;
      },
    },
    logger: { warn: () => {} },
    sessionController: {
      async resolveAgent(sessionId) {
        const target = ctx.targets.get(sessionId);
        return target === undefined
          ? { error: { code: "session/not-found", message: "会话不存在" } }
          : { agent: target };
      },
    },
  };
  return ctx;
}

/** 构造最小 fake Agent（孔明或大臣）。 */
function makeAgent(id) {
  const agent = {
    id,
    session: { id, header: {} },
    followupCalls: [],
    steerCalls: [],
    inbox: { nextTurn: [], nextStep: [] },
    followup(message) {
      agent.followupCalls.push(message);
    },
    steer(message) {
      agent.steerCalls.push(message);
    },
    ctx: {
      tools: { registrations: [], register(definition) {
        agent.ctx.tools.registrations.push(definition);
        return () => {};
      } },
      systemPrompt: {
        section() {
          return () => {};
        },
        getSectionOrder() {
          return 0;
        },
      },
    },
  };
  return agent;
}

/** 挂载工具集到 fake 宿主，返回 {ctx, kongming, defs, exec}。 */
async function mount(runtime) {
  const ctx = makeCtx();
  const kongming = makeAgent("kongming-session");
  ctx.agent = kongming;
  for (const record of runtime.list()) ctx.targets.set(record.sessionId, runtime.target);
  await mountKongmingTools(ctx, runtime);
  const defs = kongming.ctx.tools.registrations;
  const exec = { agent: kongming, signal: new AbortController().signal, callId: "c1" };
  return { ctx, kongming, defs, exec };
}

/** 最小军机阁 runtime：一个大臣「司马懿」绑定 target 会话。 */
function makeRuntime(target) {
  const runtime = {
    openCalls: [],
    target,
    async open(id) {
      runtime.openCalls.push(id);
      if (id !== "司马懿") throw Error(`军机阁没有名为 ${id} 的大臣`);
      return { sessionId: target.id };
    },
    list() {
      return [{ id: "司马懿", name: "司马懿", sessionId: target.id }];
    },
  };
  return runtime;
}

/** 按名查找并执行工具；async 包装使同步守卫抛出也走 rejected promise。 */
async function execTool(defs, name, input, exec) {
  const definition = defs.find((entry) => entry.name === name);
  assert.ok(definition, `工具集应包含 ${name}`);
  return definition.execute(input, exec);
}

test("tool_registered：工具集包含 junji_send", async () => {
  const { defs } = await mount(makeRuntime(makeAgent("junji-session")));
  const definition = defs.find((entry) => entry.name === "junji_send");
  assert.ok(definition, "应注册 junji_send");
  assert.match(definition.description, /Junji/i);
});

test("send_happy_path：就绪会话后投递 kmh-relay 消息并返回回执", async () => {
  const target = makeAgent("junji-session");
  const { defs, exec } = await mount(makeRuntime(target));
  const raw = await execTool(defs, "junji_send", { agentId: "司马懿", content: "查一下军情" }, exec);
  const receipt = JSON.parse(raw);
  assert.equal(receipt.status, "queued");
  assert.equal(receipt.agentId, "司马懿");
  assert.equal(receipt.sessionId, "junji-session");
  assert.ok(receipt.dispatchId);
  assert.equal(target.followupCalls.length, 1);
  const message = target.followupCalls[0];
  assert.equal(message.source.kind, "kmh-relay");
  assert.equal(message.source.targetSessionId, "junji-session");
  assert.ok(message.content.some((block) => block.text === "查一下军情"));
});

test("send_agent_not_found：大臣不存在时报错且不投递", async () => {
  const target = makeAgent("junji-session");
  const { defs, exec } = await mount(makeRuntime(target));
  await assert.rejects(
    execTool(defs, "junji_send", { agentId: "无此大臣", content: "hi" }, exec),
    /军机阁没有名为/,
  );
  assert.equal(target.followupCalls.length, 0);
});

test("send_blank_content：空白正文报错", async () => {
  const target = makeAgent("junji-session");
  const { defs, exec } = await mount(makeRuntime(target));
  await assert.rejects(
    execTool(defs, "junji_send", { agentId: "司马懿", content: "   " }, exec),
  );
  assert.equal(target.followupCalls.length, 0);
});

test("send_source_inactive：挂载释放后工具拒绝执行", async () => {
  const target = makeAgent("junji-session");
  const { ctx, defs, exec } = await mount(makeRuntime(target));
  ctx.runCleanups();
  // 释放后 lifetime 信号中止，工具入口在守卫处拒绝（AbortError）。
  await assert.rejects(
    execTool(defs, "junji_send", { agentId: "司马懿", content: "hi" }, exec),
  );
});

test("send_flow_combo：发送→作答→回传孔明一次（真 sendAndWatch 链路）", async () => {
  const target = makeAgent("junji-session");
  const { ctx, kongming, defs, exec } = await mount(makeRuntime(target));
  const raw = await execTool(defs, "junji_send", { agentId: "司马懿", content: "报上近况" }, exec);
  const { dispatchId } = JSON.parse(raw);
  ctx.emit("agent/inbox/claimed", { agent: target, message: target.followupCalls[0], turn: 2 });
  ctx.emit("session/event", target.session, {
    type: "assistant/message",
    data: { turn: 2, message: { content: [{ type: "text", text: "一切安好" }] } },
  });
  ctx.emit("session/event", target.session, {
    type: "turn/end",
    data: { turn: 2, reason: { kind: "completed" } },
  });
  assert.equal(kongming.followupCalls.length, 1, "回传一次");
  const reply = kongming.followupCalls[0];
  assert.equal(reply.source.kind, "kmh-relay");
  assert.equal(reply.source.senderSessionId, "junji-session");
  assert.equal(reply.source.dispatchId, dispatchId);
  assert.ok(reply.content.some((block) => block.text?.includes("一切安好")));
});

test("send_release_tracked：挂载释放清理轮次监听", async () => {
  const target = makeAgent("junji-session");
  const { ctx, defs, exec } = await mount(makeRuntime(target));
  // 基线 = 挂载注册的宿主级事件监听（真实宿主由插件生命周期清理，fake 不模拟）。
  const baseline = ctx.liveHandlers();
  await execTool(defs, "junji_send", { agentId: "司马懿", content: "hi" }, exec);
  assert.ok(ctx.liveHandlers() > baseline, "发送后注册轮次监听");
  ctx.runCleanups();
  assert.equal(ctx.liveHandlers(), baseline, "释放后轮次监听清空");
});
