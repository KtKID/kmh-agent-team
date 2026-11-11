/** 军机阁运行时：agent↔session 一对一永久绑定的创建、恢复、更新与提示词装载。 */
import { mkdir, realpath } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, ModelSelection } from "@deepseek-ai/dsh-agent";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { WorkspaceUnknownSessionError } from "@deepseek-ai/dsh-workspace";
import type { Workspace } from "@deepseek-ai/dsh-workspace/types";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { AgentStore } from "./registry.ts";
import { mountAgentPrompt } from "./prompt.ts";
import {
  createAgentMemory,
  resolveMemoryFiles,
  type AgentMemory,
  type MemoryConfig,
} from "./memory/index.ts";
import type {
  AgentCreated,
  AgentModel,
  AgentRecord,
  CreateAgentInput,
  UpdateAgentInput,
} from "./protocol/index.ts";

/** 军机阁专属 workspace 的展示标题。 */
export const JUNJI_WORKSPACE_TITLE = "军机阁";

/** 军机阁运行时；每个 agent 的会话由这里的映射唯一寻址。 */
export class JunjiRuntime {
  private readonly records = new Map<string, AgentRecord>();
  private readonly prompts = new Map<string, () => void>();
  private readonly liveAgents = new Map<string, Agent>();
  private readonly memories = new Map<string, AgentMemory>();
  private readonly memoryReleases = new Map<string, () => Promise<void>>();
  private canonicalRoot: string | undefined;
  private workspace: Workspace | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private operations = Promise.resolve();

  /**
   * @param ctx - 插件生命周期上下文。
   * @param store - agent 档案存储。
   * @param root - 军机阁根目录（`<dsh-home>/agent-team`）。
   * @param memoryConfig - 记忆模板配置。
   */
  constructor(
    readonly ctx: Context,
    readonly store: AgentStore,
    readonly root: string,
    private readonly memoryConfig: MemoryConfig,
  ) {
    ctx.on("agent/created", ({ agent }) => {
      if (this.closed) return;
      const record = this.recordBySession(agent.id);
      if (record !== undefined) this.bindPrompt(record, agent);
    });
    // DSH emit 调度会接管异步清理观察器的拒绝。
    ctx.on("agent/disposed", ({ agent }) => {
      this.releasePrompt(agent.id);
    });
    ctx.effect(() => () => this.close(), "kmh-junji: settle runtime");
  }

  /** 启动恢复：读档案、装载已存活 agent 的提示词；单个损坏档案不阻塞。 */
  async restore(): Promise<void> {
    const { records, invalid } = await this.store.list();
    for (const entry of invalid)
      this.ctx.logger.warn(
        `军机阁跳过损坏档案目录 ${entry.id}：${entry.reason}`,
      );
    for (const record of records) {
      this.records.set(record.id, record);
      const live = this.ctx.agents.get(SessionId(record.sessionId));
      if (live !== undefined) this.bindPrompt(record, live);
    }
  }

  /** @returns 全部档案，按创建时间升序。 */
  list(): readonly AgentRecord[] {
    return [...this.records.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  /**
   * 创建 agent：独占档案 → 专属会话 → 绑定提示词/模型/标题 → ready 落盘。
   * 会话创建失败时档案留在 reserved，可用 open(id) 续建。
   * @param input - 已校验的创建输入。
   * @returns 档案与专属会话 id。
   */
  async create(input: CreateAgentInput): Promise<AgentCreated> {
    return this.run(async () => {
      const selection = await this.resolveModel(input.model);
      const record = await this.store.reserve(input);
      this.records.set(record.id, record);
      const ready = await this.ensureAgent(record, selection);
      return { agent: ready, sessionId: ready.sessionId };
    });
  }

  /**
   * 打开 agent：reserved 档案续建会话，ready 档案确认会话可装载。
   * @param id - agent 稳定标识。
   * @returns 专属会话 id，客户端据此切换会话。
   */
  async open(id: string): Promise<{ sessionId: string }> {
    return this.run(async () => {
      const ready = await this.ensureAgent(this.requireRecord(id));
      return { sessionId: ready.sessionId };
    });
  }

  /**
   * 更新档案并同步会话侧：改名 → 会话标题；换模型 → 会话模型选择；
   * 换系统提示词 → 重挂 persona 段（下一次请求生效）。
   * @param id - agent 稳定标识。
   * @param patch - 已校验的更新输入。
   * @returns 更新后的完整档案。
   */
  async update(id: string, patch: UpdateAgentInput): Promise<AgentRecord> {
    return this.run(() => this.updateRecord(id, patch));
  }

  private async updateRecord(
    id: string,
    patch: UpdateAgentInput,
  ): Promise<AgentRecord> {
    const record = this.requireRecord(id);
    const selection =
      patch.model === undefined
        ? undefined
        : await this.resolveModel(patch.model);
    const agent =
      selection !== undefined && record.phase === "ready"
        ? await this.resolveAgent(record)
        : undefined;
    const next = await this.store.update(id, patch);
    this.records.set(id, next);
    if (patch.name !== undefined && record.phase === "ready")
      await this.ctx.sessionController.rename({
        sessionId: SessionId(next.sessionId),
        title: next.name,
      });
    if (selection !== undefined && agent !== undefined)
      agent.model.select(selection);
    if (patch.systemPrompt !== undefined) {
      const live = this.liveAgents.get(next.sessionId);
      if (live !== undefined) {
        this.prompts.get(next.sessionId)?.();
        this.prompts.set(
          next.sessionId,
          mountAgentPrompt(live, patch.systemPrompt),
        );
      }
    }
    return next;
  }

  /**
   * 停止并归档成员的专属会话，再移除档案与记忆。归档异常时保留档案供重试。
   * @param id - agent 稳定标识。
   * @param approved - 工具获得批准时显示的档案版本。
   */
  async remove(id: string, approved?: AgentRecord): Promise<void> {
    return this.run(() => this.removeRecord(id, approved));
  }

  private async removeRecord(
    id: string,
    approved?: AgentRecord,
  ): Promise<void> {
    const record = this.requireRecord(id);
    if (approved !== undefined && record !== approved)
      throw Error("大臣档案在确认期间已变更，请重新确认");
    const sessionId = SessionId(record.sessionId);
    const agent = this.ctx.agents.get(sessionId);
    if (agent !== undefined) {
      agent.cancel({ kind: "user" }, { keepInbox: false });
      await agent.whenIdle();
    }
    try {
      // 宿主归档同时停止关联活动，并封住取消与归档之间的新唤醒。
      await this.ctx.workspaceRegistry.archiveSession(sessionId, {
        stopActivity: true,
      });
    } catch (error) {
      // 创建中断可能只留下成员档案，此时没有会话可归档。
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error;
    }
    await this.ctx.agents.get(sessionId)?.whenIdle();
    this.releasePrompt(sessionId);
    const memory = this.memories.get(record.sessionId);
    if (memory !== undefined) {
      this.memories.delete(record.sessionId);
      await memory.close().catch(() => {
        /* 删除路径上的收敛失败不阻塞目录移除，文件随目录一并删除。 */
      });
    }
    await this.store.remove(id);
    this.records.delete(id);
  }

  /** 建（或复用）军机阁 workspace 并返回规范路径；目录先建后规范。 */
  private async ensureRoot(): Promise<string> {
    if (this.canonicalRoot !== undefined) return this.canonicalRoot;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.canonicalRoot = await realpath(this.root);
    return this.canonicalRoot;
  }

  /** 军机阁 workspace：按规范路径复用已有，否则以“军机阁”标题创建。 */
  private async ensureWorkspace(): Promise<Workspace> {
    if (this.workspace !== undefined) return this.workspace;
    const canonical = await this.ensureRoot();
    const existing = this.ctx.workspaceRegistry
      .list()
      .find((workspace) => workspace.path === canonical);
    this.workspace =
      existing ??
      (await this.ctx.workspaceRegistry.create(
        canonical,
        JUNJI_WORKSPACE_TITLE,
      ));
    return this.workspace;
  }

  /** 完成或确认 agent 的专属会话；reserved 档案从这里续建。 */
  private async ensureAgent(
    record: AgentRecord,
    validated?: ModelSelection,
  ): Promise<AgentRecord> {
    if (record.phase === "ready") {
      this.bindPrompt(record, await this.resolveAgent(record));
      return record;
    }
    const selection = validated ?? (await this.resolveModel(record.model));
    const workspace = await this.ensureWorkspace();
    const created = await this.ctx.sessionController.create({
      sessionId: SessionId(record.sessionId),
      cwd: await this.ensureRoot(),
    });
    if (created.sessionId !== SessionId(record.sessionId))
      throw Error("军机阁会话创建返回了不同的会话，已拒绝绑定");
    const agent = await this.resolveAgent(record);
    this.bindPrompt(record, agent);
    agent.model.select(selection);
    await this.ctx.sessionController.rename({
      sessionId: SessionId(record.sessionId),
      title: record.name,
    });
    if (!(await this.ctx.sessions.flush(agent.session)))
      throw Error("军机阁会话保存失败，请重试");
    await workspace.attachSession(SessionId(record.sessionId));
    const ready: AgentRecord = {
      ...record,
      phase: "ready",
      updatedAt: new Date().toISOString(),
    };
    await this.store.commit(ready);
    this.records.set(ready.id, ready);
    return ready;
  }

  /** 校验可用模型，返回可直接写入目标会话的模型选择。 */
  private async resolveModel(model: AgentModel): Promise<ModelSelection> {
    const models = await this.ctx.llm.listModels(model.provider);
    if (!models.some(({ id }) => id === model.model))
      throw Error(`模型 ${model.provider}/${model.model} 当前不可用`);
    const selection = {
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
    };
    await this.ctx.llm.resolveCallConfig(selection);
    return selection;
  }

  /** 取回档案绑定的原会话 Agent。 */
  private async resolveAgent(record: AgentRecord): Promise<Agent> {
    const resolved = await this.ctx.sessionController.resolveAgent(
      SessionId(record.sessionId),
    );
    if ("error" in resolved)
      throw Error(`军机阁会话恢复失败：${resolved.error.message}`);
    return resolved.agent;
  }

  private recordBySession(sessionId: SessionId): AgentRecord | undefined {
    for (const record of this.records.values())
      if (record.sessionId === sessionId) return record;
    return undefined;
  }

  private bindPrompt(record: AgentRecord, agent: Agent): void {
    this.liveAgents.set(record.sessionId, agent);
    if (!this.prompts.has(record.sessionId))
      this.prompts.set(
        record.sessionId,
        mountAgentPrompt(agent, record.systemPrompt),
      );
    void this.bindMemory(record, agent);
  }

  /** 记忆绑定：创建或复用该 agent 的记忆服务，初始化文件（创建时加载）并挂全部监听。 */
  private async bindMemory(record: AgentRecord, agent: Agent): Promise<void> {
    if (this.memoryReleases.has(record.sessionId)) return;
    let memory = this.memories.get(record.sessionId);
    if (memory === undefined) {
      memory = createAgentMemory(
        this.ctx,
        resolveMemoryFiles(this.store.dir(record.id)),
        this.memoryConfig,
      );
      this.memories.set(record.sessionId, memory);
    }
    const release = await memory.bindAgent(agent);
    this.memoryReleases.set(record.sessionId, release);
    await memory.initialize();
  }

  /** 释放某会话的提示词段、记忆绑定与存活引用；记忆服务保留供重新绑定。 */
  private releasePrompt(sessionId: SessionId): void {
    const release = this.prompts.get(sessionId);
    if (release === undefined) return;
    this.prompts.delete(sessionId);
    this.liveAgents.delete(sessionId);
    release();
    const releaseMemory = this.memoryReleases.get(sessionId);
    if (releaseMemory !== undefined) {
      this.memoryReleases.delete(sessionId);
      void releaseMemory();
    }
  }

  private requireRecord(id: string): AgentRecord {
    const record = this.records.get(id);
    if (record === undefined) throw Error(`军机阁没有名为 ${id} 的大臣`);
    return record;
  }

  /** 串行处理档案变更，停用时等已经开始的工作收尾。 */
  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operations.then(() => {
      if (this.closed) throw Error("军机阁插件已停用");
      return action();
    });
    this.operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 停止插件：取消存活 agent 的执行并释放全部提示词绑定；会话与档案保留。 */
  close(): Promise<void> {
    this.closed = true;
    return (this.closing ??= this.closeOnce());
  }

  private async closeOnce(): Promise<void> {
    await this.operations;
    for (const [sessionId, agent] of this.liveAgents) {
      agent.cancel({ kind: "disposed" }, { keepInbox: true });
      await agent.whenIdle();
      await this.ctx.sessions.flush(agent.session).catch(() => {
        /* 卸载时保存失败不阻塞收敛，会话文件由底座持久化策略兜底。 */
      });
      this.releasePrompt(SessionId(sessionId));
    }
    for (const memory of this.memories.values())
      await memory.close().catch(() => {
        /* 收敛失败不阻塞卸载，文件工作已尽力完成。 */
      });
    this.memories.clear();
  }
}
