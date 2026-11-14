/** 军机阁删除回归，运行真实宿主会话和归档，使用可中断的测试模型。 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { createUserMessage, LlmAdapter } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import SandboxPolicy, { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import * as Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import Storage from "@deepseek-ai/dsh-storage";
import * as StorageDomain from "@deepseek-ai/dsh-storage-domain";
import * as StorageJson from "@deepseek-ai/dsh-storage-json";
import ApprovalService, {
  setApprovalPolicy,
} from "@deepseek-ai/dsh-user-approval";
import Workspaces from "@deepseek-ai/dsh-workspace";
import { mountKongmingTools } from "../lib/src/kongming-integration.js";
import { JunjiRuntime } from "../lib/src/runtime.js";
import { AgentStore } from "../lib/src/registry.js";
import { MemoryConfig } from "../lib/src/memory/config.js";

const model = { provider: "mock", model: "mock" };
const member = { name: "司马测试", systemPrompt: "测试专属会话", model };
const options = { timeout: 10_000 };

/** 等待真实循环的取消信号，清理时可释放阻塞的测试请求。 */
class BlockingAdapter extends LlmAdapter {
  entered = Promise.withResolvers();
  release = Promise.withResolvers();
  calls = 0;

  resolveModel(provider, id) {
    return Promise.resolve({ provider, id, name: id });
  }

  async *stream({ signal }) {
    this.calls++;
    assert.ok(signal);
    const aborted = once(signal, "abort");
    this.entered.resolve(signal);
    await Promise.race([aborted, this.release.promise]);
    signal.throwIfAborted();
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

function prompt(text) {
  return createUserMessage({
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
}

/** 在临时目录安装生产执行循环和 JSON 归档，注册清理并返回测试入口。 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "junji-removal-"));
  const ctx = new Context();
  const adapter = new BlockingAdapter();
  t.after(async () => {
    adapter.release.resolve();
    try {
      await ctx.fiber.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Persistence, { root: join(root, "sessions") });
  await ctx.plugin(Storage);
  await ctx.plugin(StorageJson, { root: join(root, "storage") });
  await ctx.plugin(StorageDomain, { backend: "json" });
  await ctx.plugin(Workspaces);
  ctx.llm.registerAdapter(["mock"], adapter);
  const driver = await mountAgentLoopTestHarness(ctx);
  const store = new AgentStore(join(root, "agent-team"));
  const runtime = new JunjiRuntime(
    ctx,
    store,
    store.root,
    MemoryConfig({ reminderPrompt: "" }),
  );
  return { ctx, driver, runtime, store, adapter };
}

/** 落下绑定档案并打开对应的真实工作区会话。 */
async function addMember({ ctx, driver, store, runtime }) {
  const record = { ...(await store.reserve(member)), phase: "ready" };
  await store.commit(record);
  const sessionId = SessionId(record.sessionId);
  const agent = await driver.create(sessionId, model, { cwd: store.root });
  const workspace = await ctx.workspaceRegistry.create(store.root, "军机阁");
  await workspace.attachSession(sessionId);
  await runtime.restore();
  return { record, agent, sessionId, workspace };
}

test(
  "T1：删除先打断生成和清空队列，再归档并保留会话历史",
  options,
  async (t) => {
    const host = await fixture(t);
    const { ctx, runtime, store, adapter } = host;
    const { record, agent, sessionId, workspace } = await addMember(host);
    const unrelated = await store.reserve({ ...member, name: "信息收集员" });
    await runtime.restore();
    agent.followup(prompt("正在执行的任务"));
    const signal = await Promise.race([
      adapter.entered.promise,
      agent.whenIdle().then(() => {
        const end = agent.session
          .snapshotEvents()
          .findLast((event) => event.type === "turn/end");
        assert.fail(`测试模型未进入生成：${JSON.stringify(end?.data.reason)}`);
      }),
    ]);
    agent.followup(prompt("等待中的任务"));
    assert.equal(agent.status, "running");
    assert.equal(agent.inbox.nextTurn.length, 1);

    const archiveSession = ctx.workspaceRegistry.archiveSession.bind(
      ctx.workspaceRegistry,
    );
    const archive = t.mock.method(
      ctx.workspaceRegistry,
      "archiveSession",
      (id, opts) => {
        assert.equal(id, sessionId);
        assert.equal(signal.aborted, true, "归档前模型请求已经收到取消");
        const end = agent.session
          .snapshotEvents()
          .findLast((event) => event.type === "turn/end");
        assert.equal(end?.data.reason.kind, "aborted", "归档前轮次已经结束");
        return archiveSession(id, opts);
      },
    );
    await runtime.remove(record.id);

    assert.equal(signal.aborted, true, "删除应取消正在运行的模型请求");
    assert.equal(agent.status, "idle");
    assert.equal(agent.inbox.nextTurn.length, 0);
    assert.equal(adapter.calls, 1);
    assert.equal(archive.mock.callCount(), 1);
    assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [sessionId]);
    assert.ok(workspace.sessionIds.includes(sessionId));
    assert.equal(ctx.sessions.get(sessionId), agent.session);
    assert.equal(await ctx.sessions.flush(agent.session), true);
    await using history = await ctx.sessionPersistence.open(sessionId, "read");
    const { events } = await history.read();
    const storedEnd = events.findLast((event) => event.type === "turn/end");
    assert.equal(storedEnd?.data.reason.kind, "aborted");
    assert.deepEqual(
      runtime.list().map((item) => item.id),
      [unrelated.id],
    );
    await assert.rejects(store.read(record.id), { code: "ENOENT" });
  },
);

test("T2：成员创建中断后可清理无会话的档案", options, async (t) => {
  const { runtime, store, ctx } = await fixture(t);
  const reserved = await store.reserve(member);
  await runtime.restore();
  await runtime.remove(reserved.id);
  assert.deepEqual(runtime.list(), []);
  assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, []);
  await assert.rejects(store.read(reserved.id), { code: "ENOENT" });
});

test("T3：归档失败时保留档案，重试成功后移除", options, async (t) => {
  const host = await fixture(t);
  const { ctx, runtime, store } = host;
  const { record, sessionId } = await addMember(host);
  const archive = t.mock.method(
    ctx.workspaceRegistry,
    "archiveSession",
    async () => {
      throw Error("测试归档写入失败");
    },
  );
  await assert.rejects(runtime.remove(record.id), /测试归档写入失败/);
  assert.equal((await store.read(record.id)).sessionId, sessionId);
  assert.deepEqual(
    runtime.list().map((item) => item.id),
    [record.id],
  );
  assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, []);
  archive.mock.restore();

  await runtime.remove(record.id);
  assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [sessionId]);
  assert.deepEqual(runtime.list(), []);
});

test("孔明切换为完全权限后直接删除并归档", options, async (t) => {
  const host = await fixture(t);
  const { ctx, driver, runtime, store } = host;
  await ctx.plugin(ApprovalService, { policy: "ask" });
  await ctx.plugin(SandboxPolicy, { mode: "workspace-write" });
  const { record, agent, sessionId } = await addMember(host);
  const kongming = await driver.create(SessionId("kongming"), model, {
    cwd: store.root,
  });
  ctx.on("kongming/visit-agents", (visit) => visit(kongming));
  await mountKongmingTools(ctx, runtime);
  const toolName = "junji_remove_agent";
  const tool = ctx.tools.get(toolName, kongming);
  assert.ok(tool);
  assert.equal(ctx.tools.get(toolName, agent), undefined);
  const remove = (callId) =>
    tool.execute(
      { agentId: record.id },
      { agent: kongming, callId, signal: new AbortController().signal },
    );
  const session = kongming.session;
  setApprovalPolicy(session, "never");
  session.append("turn/start", { turn: 1 });
  await assert.rejects(remove("restricted"), /删除大臣需要用户确认/);
  assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, []);
  assert.deepEqual(
    runtime.list().map((item) => item.id),
    [record.id],
  );
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });

  setSandboxMode(session, "danger-full-access");
  session.append("turn/start", { turn: 2 });
  const result = await remove("full-access");
  session.append("turn/end", { turn: 2, reason: { kind: "completed" } });

  assert.deepEqual(JSON.parse(result), { removed: true, agentId: record.id });
  assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [sessionId]);
  assert.equal(ctx.sessions.get(sessionId), agent.session);
  assert.deepEqual(runtime.list(), []);
  await assert.rejects(store.read(record.id), { code: "ENOENT" });
  const requests = session
    .snapshotEvents()
    .filter((event) => event.type === "approval/asked");
  assert.deepEqual(
    requests.map((event) => event.data.callId),
    ["restricted"],
  );
});
