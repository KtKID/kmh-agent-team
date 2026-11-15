/** 军机阁成员生命周期及记忆隔离回归，经真实宿主会话和持久化执行。 */
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import {
  createUserMessage,
  LlmAdapter,
  ToolCallId,
} from "@deepseek-ai/dsh-llm";
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
import { Config as MemoryConfig } from "../lib/src/index.js";
import { mountWeb } from "../lib/src/web.js";

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

  listModels(provider) {
    return Promise.resolve([{ provider, id: model.model, name: model.model }]);
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
async function fixture(
  t,
  adapter = new BlockingAdapter(),
  memoryConfig = { reminderPrompt: "" },
) {
  const root = await mkdtemp(join(tmpdir(), "junji-removal-"));
  const ctx = new Context();
  t.after(async () => {
    adapter.release?.resolve();
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
    MemoryConfig(memoryConfig),
  );
  return { ctx, driver, runtime, store, adapter };
}

/** 用真实执行循环处理会话创建，替代测试宿主未装配的 RPC 控制器。 */
function mountCreateController({ ctx, driver }) {
  const controller = {
    async create({ sessionId, cwd }) {
      await driver.create(sessionId, model, { cwd });
      return { sessionId };
    },
    async resolveAgent(sessionId) {
      return { agent: ctx.agents.get(sessionId) };
    },
    async rename() {},
  };
  ctx.provide("sessionController", controller);
  return controller;
}

test("创建接口将自定义目录写入会话头并复用项目工作区", options, async (t) => {
  const host = await fixture(t);
  const { ctx, runtime, store } = host;
  mountCreateController(host);
  const parent = dirname(store.root);
  const project = await mkdir(join(parent, "项目目录"), { recursive: true });
  const path = await realpath(project);
  const alias = join(parent, "项目入口");
  await symlink(path, alias, "dir");
  const workspace = await ctx.workspaceRegistry.create(path, "我的项目");

  const routes = new Map();
  mountWeb(
    { connection: { fetch: { register: (route) => routes.set(route.path, route.fetch) } } },
    runtime,
  );
  const url = new URL("http://localhost/api/kmh-junji/create");
  const response = await routes.get(url.pathname)(
    new Request(url, { method: "POST", body: JSON.stringify({ ...member, cwd: alias }) }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const { agent, sessionId } = await response.json();
  assert.equal(agent.cwd, path);
  assert.equal((await store.read(agent.id)).cwd, path);
  assert.equal(ctx.sessions.get(sessionId).header.cwd, path);
  const persisted = await ctx.sessionPersistence.list();
  const stored = persisted.find(({ header }) => header.id === sessionId);
  assert.equal(stored.header.cwd, path);
  assert.deepEqual(workspace.sessionIds, [sessionId]);
  assert.equal(workspace.title, "我的项目");
  assert.equal(
    await readFile(join(store.dir(agent.id), "MEMORY.md"), "utf8"),
    "",
  );
  assert.deepEqual(await runtime.open(agent.id), { sessionId });
});

test("无效工作目录在保留档案前拒绝", options, async (t) => {
  const host = await fixture(t);
  const { runtime, store } = host;
  const controller = mountCreateController(host);
  const create = t.mock.method(controller, "create");
  const file = join(dirname(store.root), "file.txt");
  await writeFile(file, "测试文件");
  for (const cwd of ["relative/path", join(dirname(store.root), "missing"), file]) {
    await assert.rejects(runtime.create({ ...member, cwd }), /工作目录/);
  }
  assert.deepEqual(runtime.list(), []);
  assert.deepEqual((await store.list()).records, []);
  assert.equal(create.mock.callCount(), 0);
});

test("恢复保留档案时沿用自定义目录，旧档案使用军机阁默认目录", options, async (t) => {
  const host = await fixture(t);
  const { ctx, runtime, store } = host;
  const controller = mountCreateController(host);
  const project = await mkdir(join(dirname(store.root), "project"), {
    recursive: true,
  });
  const path = await realpath(project);
  const create = t.mock.method(controller, "create", async () => {
    throw Error("测试会话创建中断");
  });
  await assert.rejects(
    runtime.create({ ...member, cwd: path }),
    /测试会话创建中断/,
  );
  create.mock.restore();
  const [reserved] = (await store.list()).records;
  assert.equal(reserved.phase, "reserved");
  assert.equal(reserved.cwd, path);
  const legacy = await store.reserve({ ...member, name: "旧档案" });
  assert.equal(legacy.cwd, undefined);
  await runtime.restore();

  for (const [record, cwd, title] of [
    [reserved, path, "project"],
    [legacy, await realpath(store.root), "军机阁"],
  ]) {
    const { sessionId } = await runtime.open(record.id);
    assert.equal(sessionId, record.sessionId);
    assert.equal(ctx.sessions.get(sessionId).header.cwd, cwd);
    assert.equal((await store.read(record.id)).phase, "ready");
    const workspace = await ctx.workspaceRegistry.resolveByPath(cwd);
    assert.equal(workspace.title, title);
    assert.deepEqual(workspace.sessionIds, [sessionId]);
  }

  const { agent, sessionId } = await runtime.create({ ...member, name: "默认目录" });
  assert.equal(agent.cwd, undefined);
  assert.equal(ctx.sessions.get(sessionId).header.cwd, await realpath(store.root));
});

/** 落下绑定档案并打开对应的真实工作区会话。 */
async function addMember(
  { ctx, driver, store, runtime },
  input = member,
  original,
) {
  const record = { ...(await store.reserve(input)), phase: "ready" };
  await store.commit(record);
  const dir = store.dir(record.id);
  if (original !== undefined) {
    await writeFile(join(dir, "MEMORY.md"), original);
    await writeFile(join(dir, "MEMORY.frozen.md"), "旧冻结版本\n");
  }
  const sessionId = SessionId(record.sessionId);
  const agent = await driver.create(sessionId, model, { cwd: store.root });
  const workspace = await ctx.workspaceRegistry.create(store.root, "军机阁");
  await workspace.attachSession(sessionId);
  await runtime.restore();
  return { record, agent, sessionId, workspace, dir };
}

test(
  "共享记忆按成员绑定原文件、收尾和保存工具，普通会话保持静默",
  options,
  async (t) => {
    const requests = [];
    const saveTool = "kongming_memory_save";
    const reminderKind = "kongming-memory-v1:reminder";
    const entry = "新条目：计划先核对值班表";
    const adapter = new (class extends LlmAdapter {
      resolveModel(provider, id) {
        return Promise.resolve({ provider, id, name: id });
      }

      async *stream(options) {
        requests.push(options);
        if (requests.length === 2) {
          const id = ToolCallId("save-member-a");
          const args = JSON.stringify({ content: entry });
          yield { type: "block-start", index: 0, blockType: "tool-call" };
          yield {
            type: "tool-call-delta",
            index: 0,
            id,
            name: saveTool,
            argumentsDelta: args,
          };
          yield {
            type: "block-end",
            index: 0,
            block: { type: "tool-call", id, name: saveTool, arguments: args },
          };
          yield { type: "finish", reason: { kind: "tool-calls" } };
          return;
        }
        const text = "通";
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text };
        yield { type: "block-end", index: 0, block: { type: "text", text } };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    })();
    const host = await fixture(t, adapter, {});
    const originalA = "甲的旧记忆：巡查松林\n";
    const originalB = "乙的旧记忆：照看竹屋\n";
    const a = await addMember(host, member, originalA);
    const b = await addMember(host, { ...member, name: "庞统测试" }, originalB);
    const ordinary = await host.driver.create(SessionId("ordinary"), model, {
      cwd: host.store.root,
    });
    assert.ok(host.ctx.tools.get(saveTool, a.agent));
    assert.ok(host.ctx.tools.get(saveTool, b.agent));
    assert.equal(host.ctx.tools.get(saveTool, ordinary), undefined);

    for (const agent of [a.agent, b.agent, ordinary]) {
      agent.followup(prompt("请继续"));
      await agent.whenIdle();
    }
    assert.equal(requests.length, 6);
    const [requestA, , , requestB, , requestOrdinary] = requests;
    assert.ok(JSON.stringify(requestA.messages).includes(originalA.trim()));
    assert.ok(!JSON.stringify(requestA.messages).includes(originalB.trim()));
    assert.ok(JSON.stringify(requestB.messages).includes(originalB.trim()));
    assert.ok(!JSON.stringify(requestB.messages).includes(originalA.trim()));
    assert.ok(
      !JSON.stringify(requestOrdinary.messages).includes("kongming-memory"),
    );

    for (const bound of [a, b]) {
      const reminders = bound.agent.session
        .snapshotEvents()
        .filter(
          (event) =>
            event.type === "user/message" &&
            event.data.source.kind === reminderKind,
        );
      assert.equal(reminders.length, 1);
      assert.equal(reminders[0].data.source.sessionId, bound.sessionId);
      const reminder = reminders[0].data.content[0].text;
      assert.ok(reminder.includes(saveTool));
      assert.ok(reminder.includes(join(bound.dir, "MEMORY.md")));
      assert.ok(reminder.includes(join(bound.dir, "MEMORY.frozen.md")));
    }
    const results = a.agent.session
      .snapshotEvents()
      .filter((event) => event.type === "tool/result");
    assert.equal(results.length, 1);
    assert.equal(results[0].data.message.isError, false);
    assert.equal(
      await readFile(join(a.dir, "MEMORY.md"), "utf8"),
      originalA + entry + "\n",
    );
    assert.equal(
      await readFile(join(a.dir, "MEMORY.frozen.md"), "utf8"),
      originalA,
    );
    assert.equal(await readFile(join(b.dir, "MEMORY.md"), "utf8"), originalB);
    assert.equal(
      await readFile(join(b.dir, "MEMORY.frozen.md"), "utf8"),
      originalB,
    );
  },
);

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
