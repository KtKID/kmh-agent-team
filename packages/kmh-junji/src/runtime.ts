/** 军机阁运行时：agent↔session 一对一永久绑定的创建、恢复、更新与提示词装载。 */
import { mkdir, realpath } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Workspace } from "@deepseek-ai/dsh-workspace/types";
import type {} from "@deepseek-ai/dsh-workspace";
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
    ctx.effect(() => () => void this.close(), "kmh-junji: settle runtime");
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
    this.requireOpen();
    const record = await this.store.reserve(input);
    this.records.set(record.id, record);
    const ready = await this.ensureAgent(record);
    return { agent: ready, sessionId: ready.sessionId };
  }

  /**
   * 打开 agent：reserved 档案续建会话，ready 档案确认会话可装载。
   * @param id - agent 稳定标识。
   * @returns 专属会话 id，客户端据此切换会话。
   */
  async open(id: string): Promise<{ sessionId: string }> {
    this.requireOpen();
    const ready = await this.ensureAgent(this.requireRecord(id));
    return { sessionId: ready.sessionId };
  }

  /**
   * 更新档案并同步会话侧：改名 → 会话标题；换模型 → 会话模型选择；
   * 换系统提示词 → 重挂 persona 段（下一次请求生效）。
   * @param id - agent 稳定标识。
   * @param patch - 已校验的更新输入。
   * @returns 更新后的完整档案。
   */
  async update(id: string, patch: UpdateAgentInput): Promise<AgentRecord> {
    this.requireOpen();
    this.requireRecord(id);
    const next = await this.store.update(id, patch);
    this.records.set(id, next);
    if (patch.name !== undefined)
      await this.ctx.sessionController.rename({
        sessionId: SessionId(next.sessionId),
        title: next.name,
      });
    if (patch.model !== undefined)
      await this.selectModel(next.sessionId, patch.model);
    if (patch.systemPrompt !== undefined) {
      const live = this.liveAgents.get(next.sessionId);
      if (live !== undefined) {
        this.releasePrompt(SessionId(next.sessionId));
        this.prompts.set(
          next.sessionId,
          mountAgentPrompt(live, patch.systemPrompt),
        );
      }
    }
    return next;
  }

  /**
   * 删除 agent：目录与记忆一并移除；专属会话保留（历史不销毁）。
   * @param id - agent 稳定标识。
   */
  async remove(id: string): Promise<void> {
    this.requireOpen();
    const record = this.requireRecord(id);
    this.releasePrompt(SessionId(record.sessionId));
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
  private async ensureAgent(record: AgentRecord): Promise<AgentRecord> {
    if (record.phase === "ready") {
      const alive = await this.ctx.sessionController.resolveAgent(
        SessionId(record.sessionId),
      );
      if ("error" in alive)
        throw Error(`军机阁会话恢复失败：${alive.error.message}`);
      this.bindPrompt(record, alive.agent);
      return record;
    }
    const workspace = await this.ensureWorkspace();
    const created = await this.ctx.sessionController.create({
      sessionId: SessionId(record.sessionId),
      cwd: await this.ensureRoot(),
    });
    if (created.sessionId !== SessionId(record.sessionId))
      throw Error("军机阁会话创建返回了不同的会话，已拒绝绑定");
    const alive = await this.ctx.sessionController.resolveAgent(
      SessionId(record.sessionId),
    );
    if ("error" in alive)
      throw Error(`军机阁会话恢复失败：${alive.error.message}`);
    this.bindPrompt(record, alive.agent);
    await this.selectModel(record.sessionId, record.model);
    await this.ctx.sessionController.rename({
      sessionId: SessionId(record.sessionId),
      title: record.name,
    });
    if (!(await this.ctx.sessions.flush(alive.agent.session)))
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

  /** 按 agent 选择会话模型；reasoningEffort 仅在有值时携带。 */
  private async selectModel(sessionId: string, model: AgentModel): Promise<void> {
    await this.ctx.sessionController.selectModel({
      sessionId: SessionId(sessionId),
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: model.reasoningEffort }),
    });
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
  private async bindMemory(
    record: AgentRecord,
    agent: Agent,
  ): Promise<void> {
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

  private requireOpen(): void {
    if (this.closed) throw Error("军机阁插件已停用");
  }

  /** 停止插件：取消存活 agent 的执行并释放全部提示词绑定；会话与档案保留。 */
  close(): Promise<void> {
    this.closed = true;
    return (this.closing ??= this.closeOnce());
  }

  private async closeOnce(): Promise<void> {
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
