# 军机阁（kmh-junji）技术设计

> 状态：草案 v1，待用户确认后实施。
> 日期：2026-11-05

## 1. 需求

基于 DeepSeek Harness（DSH）构建用户自建 agent 团队功能"军机阁"：

1. 用户可创建多个 agent（孔明的"大臣"），每个 agent 是持久实体。
2. 每个 agent 与一个 DSH session **一对一永久绑定**，创建后不换 session。
3. 每个 agent 有独立的记忆小本子（memory）：创建 agent 时加载、触发压缩时加载，agent 自己通过通用文件工具读写。
4. 记忆机制**复用 `@kmh/kongming-memory-v1` 插件**（原始 MEMORY.md + 冻结 MEMORY.frozen.md 的双文件模式）。
5. 每个 agent 独立目录，位于 `<home>/agent-team/<agentId>/`（home 为服务端 DSH home）。
6. 每个 agent 的会话支持独立压缩（DSH compaction 本身 per-session，天然独立；记忆冻结随压缩刷新）。
7. Web 侧边栏新增"军机阁"区块：已创建 agent 的列表 + ➕ 创建入口。
8. 创建面板（弹出）：agent 名字 + 系统提示词 + 模型选择。

### 明确不做（一期）

- 不做 agent 间互发消息 / 任务板（已有 DSH experimental agent-team 覆盖模型侧协作）。
- 不做团队群聊 @点名（已有 `@kmh/kmh-team` 覆盖）。
- 不做每 agent 工具/技能/权限差异配置（沿用默认 preset 的工具面）。
- 不做 agent 多会话（一 agent 一 session，明确不变更）。

## 2. 架构总览

```
kmh-agent-team/                                ← 独立仓库（本仓库）
  packages/kmh-junji/                          ← @kmh/kmh-junji 插件包
    src/index.ts            host 侧入口（Cordis 插件）
    src/registry/           agent 注册表（CRUD + 持久化）
    src/memory/             per-agent 记忆机制（移植 kongming-memory-v1）
    src/session/            agent↔session 一对一绑定、persona/模型注入
    src/protocol/           client↔host 协议（zod）
    src/web.ts              client 插件注册（web platform）
    src/client/             client 侧 UI（React）
      JunjiSidebarSection.tsx   侧边栏"军机阁"区块
      AgentCreatePanel.tsx      创建面板（名字/系统提示词/模型）
      AgentList.tsx             agent 列表
    build.mjs               esbuild 双面构建（host lib + client bundle）
```

- 开发位置：本仓库（用户已确认），通过 pnpm `link:` 挂进 kongming-os 的 `profiles/kmh-web`（与 `kmh-team` 同模式），不改 DSH 上游 checkout。
- 宿主：kongming-os `kmh-web` profile（当前 60000 端口 GUI），KMH home 映射为 DSH home。

## 3. 数据布局

```
$DSH_HOME/agent-team/
  <agentId>/                 ← agentId：稳定 slug（创建时由名字生成，重名加 -2/-3）
    agent.json               ← { id, name, systemPrompt, model, sessionId, createdAt, updatedAt }
    MEMORY.md                ← 原始记忆小本子（agent 自己用 read/write/edit 维护）
    MEMORY.frozen.md         ← 冻结记忆（插件维护，装配时完整读取）
  registry.json              ← 索引（可选，agent 目录扫描亦可；一期直接扫目录 + agent.json）
```

- 与 kongming-memory-v1 的 `$home/.kongming/MEMORY.md` 同构，但路径按 agent 参数化。
- `agent.json` 是唯一事实源；`sessionId` 一经写入不变更。

## 4. Host 侧设计

### 4.1 Agent 注册表（registry）

- 服务：`junji.agents` — `list() / create(input) / remove(id) / update(id, patch)`。
- `create(input: { name, systemPrompt, model })`：
  1. 生成 slug agentId，建目录，写 agent.json；
  2. 初始化 MEMORY.md（空文件 0600）与 MEMORY.frozen.md（首次发布：原始为空时保留已有冻结/发布空冻结——沿用 kongming-memory-v1 initializeMemoryFiles 语义）；
  3. 创建专属 DSH session（persona=systemPrompt、model=model），回写 sessionId。
- `remove(id)`：按成员绑定的会话 ID 打断运行中的任务，清理活动会话的待处理输入，等待该轮结束后调用宿主归档，再移除成员档案和记忆。会话历史随归档保留；取消归档只恢复会话。宿主归档失败时保留成员档案供重试。
- `update(id, { name?, systemPrompt?, model? })`：写 agent.json；systemPrompt/model 变更只影响后续请求（persona 装配是每次请求时进行）。

### 4.2 Agent↔Session 一对一绑定（session/）

- 创建 session 时以该 agent 的 persona（系统提示词）与模型实例化（实现路径二选一，Phase 1 研究定案）：
  - **路径 A**：host 服务调用 `dsh-agent-preset-registry` 动态注册一个 per-agent preset（内挂 `dsh-persona` 行，`complete: true` 用系统提示词整体作为身份），session 创建时选择该 preset；
  - **路径 B**：不走 preset，junji 自己在 `system-prompt/assemble` 监听里按 session→agent 映射注入 persona 段（与 memory 注入同一监听，顺序：persona 在前、记忆在后）。
  - 初步倾向 B：避免 N 个动态 preset 的注册表膨胀，且与记忆注入同构；A 的优势是复用 preset 的 KV cache 稳定性，Phase 1 用证据定案。
- 点击 agent → client 通过既有 session 切换 API 打开其 sessionId；session 不可被换成别人的。
- 模型：创建面板选择的模型写入 agent.json，每次请求按此路由（复用 DSH 模型选择机制，Phase 1 确认 per-session model 的设置入口）。

### 4.3 Per-agent 记忆（memory/，移植 kongming-memory-v1 机制）

移植 `packages/kongming-memory-v1/src` 的 files.ts / prompt.ts / steer.ts / compaction.ts 逻辑，参数化为 per-agent：

| 时机 | 行为 | 来源插件对应 |
|---|---|---|
| agent 创建 / 插件装载扫到 agent | 补齐空 MEMORY.md；MEMORY.frozen.md 缺失时发布，已有且原始非空时完整重发；原始为空保留既有冻结 | `initializeMemoryFiles` |
| 每次提示词装配 | 读完整冻结正文，经 promptTemplate（`{{originalMemoryPath}}` `{{frozenMemoryPath}}` `{{frozenMemory}}`）注入该 agent session 的系统提示词 | `system-prompt/assemble` 注入 |
| 普通任务收尾 | `agent/turn-stopping` 事件 steer 一次提醒（每会话每轮最多一次，max-tokens 轮跳过），提示模型把有价值内容写进原始小本子 | steer.ts |
| 手动 `/compact` 成功 | 核对压缩回执后，原始文件经临时文件原子替换发布为新冻结 | compaction.ts / `refreshFrozen(result)` |

- 绑定模型：kongming-memory-v1 绑定的是 `kongming/agent-ready` 单 agent 事件；junji 改为对**注册表中全部 agent 的 session** 建立绑定（agent→session 1:1 映射使绑定简单：按 sessionId 过滤装配/收尾/压缩事件）。
- 提醒文案与提示模板默认值沿用 kongming-memory-v1 的 cordis.patch.yml 文案（中文），做成 junji 的可配置项。
- **满足需求中"创建时加载 + 压缩时加载"**：创建时 initialize+发布冻结；压缩成功时重发冻结；两次加载之间，装配每次都读冻结正文（与原插件一致）。

### 4.4 独立压缩

- 每个 agent 独立 session ⇒ DSH compaction 天然 per-session 独立，无需额外开发。
- junji 监听该 session 的压缩成功回执 → 刷新冻结记忆（4.3 表最后一行）。
- UI 不新增压缩按钮（沿用输入框 `/compact` 与自动压缩）；二期可加 agent 卡片上的"压缩并归档记忆"入口。

## 5. Client 侧设计

- **侧边栏"军机阁"区块**：通过 client 插件注入（`dsh.client.inject` 同 kmh-team 模式）。区块 = 标题行（"军机阁" + ➕）+ agent 列表（名字 + 模型微标签 + 最近活动时间）；点击 agent → 打开其专属 session；右键/hover 菜单：编辑（改系统提示词/模型/名字）、删除（确认后停止任务、归档会话并移除记忆目录）。
- **创建面板**（点 ➕ 弹出）：名字（必填）、系统提示词（多行 textarea，必填，带占位示例）、模型（下拉，来自模型目录）；提交 → host create → 列表刷新 → 直接打开新 agent 会话。
- **编辑面板**：同创建面板复用，预填现值。
- **模型下拉**：箭头距右边框约 12 像素，长模型名有独立的文字空间，鼠标和键盘均可选择。
- i18n：文案走 locale 字典（kmh 一期为中文为主，结构上留 en）。
- 侧边栏注入的扩展点（ui-sidebar 的 section 契约 / ui-slots）在 Phase 3 开工时先做一次 spike 验证；若 ui-sidebar 不开放第三方 section，降级方案为"新建会话"旁的入口 + 会话头部署名（参照 kmh-team 的接入方式），但目标仍是侧边栏区块。

## 6. 集成与加载

1. 本仓库 pnpm workspace；DSH 同侪依赖不在 devDependencies 写死 `link:` 路径（仓库相对 kongming-os 的位置不稳定），由 postinstall 脚本 `scripts/link-dsh.mjs` 运行时定位（env `KONGMING_OS_DIR` 优先，否则自仓库根逐级向上探测 `kongming-os/third_party/dsh`）并符号链接进包内 node_modules；版本面以 peerDependencies 声明为准（peer 面同 kmh-team）。
2. kongming-os `profiles/kmh-web/package.json`：dependencies 加 `"@kmh/kmh-junji": "link:/Volumes/machub_app/proj/kmh-plugin/kmh-agent-team/packages/kmh-junji"`，`dsh.profile.bundles` 加包名——**这步改的是 kongming-os 仓库（本工作区之外），需要用户批准或用户自己改**。
3. 重建 profile（kongming-os 侧 pnpm install + 重启 GUI）。

## 7. 分期计划

| 阶段 | 内容 | 验证 |
|---|---|---|
| Phase 0 | 仓库底座：workspace、包骨架、build.mjs、tsconfig、AGENTS.md、设计文档 | `pnpm build` + typecheck 通过 |
| Phase 1 | Host：registry + 目录持久化 + session 创建/绑定 + persona/模型注入（A/B 路径 spike 定案） | node:test 单测（目录、初始化、绑定不变量） |
| Phase 2 | Host：per-agent 记忆（初始化/装配注入/收尾提醒/压缩刷新） | 单测 + 本地 headless 冒烟 |
| Phase 3 | Client：军机阁区块 + 创建/编辑面板 + 打开会话 | 构建产物 + 浏览器手动验证 |
| Phase 4 | 集成 kmh-web profile + 端到端浏览器验证（创建→对话→记忆写入→/compact→冻结刷新） | e2e-thread-task 流程 + 截图证据 |

## 8. 验收标准

1. 侧边栏出现"军机阁"，点 ➕ 弹创建面板，填名字/系统提示词/模型创建成功，列表即时出现。
2. 点 agent 进入其专属会话；发消息走其 persona 与所选模型。
3. 对话收尾后 agent 把内容记进自己的 `MEMORY.md`（`$DSH_HOME/agent-team/<id>/`）。
4. `/compact` 成功后 `MEMORY.frozen.md` 被原始文件原子替换；下次装配注入新冻结正文。
5. 两个 agent 并行使用，会话、记忆、压缩互不串扰（目录级隔离 + sessionId 不变）。
6. 删除 agent 时打断正在执行的会话任务，归档其历史会话并移除成员档案及记忆。成员和会话从默认侧栏收起，历史可从已归档列表恢复。
7. 重启 GUI 后 agent 列表与绑定关系完整恢复。

## 9. 风险与待研究

- **R1 侧边栏第三方区块**：ui-sidebar 是否开放 section 注册待 spike；有降级方案（§5）。
- **R2 per-session persona/模型**：路径 A/B 定案（§4.2）；模型 per-session 设置入口待查 session-controller API。
- **R3 压缩回执监听**：kongming-memory-v1 依赖手动 `/compact` 的成功回执事件；junji 需确认该事件按 session 可过滤、自动压缩是否也需刷新冻结（原插件语义：只有手动压缩刷新；一期沿用）。
- **R4 工作区沙箱**：集成阶段需写 kongming-os（工作区外）与 `$DSH_HOME`，涉及审批；开发期全部产物落在本仓库。

## 变更记录

- 2026-11-11 · 修改 §4.1、§5 删除大臣 · 停止任务并归档会话 · [任务记录](task/task-remove-agent-archive.md)
- 2026-11-06 · 修改 §5 模型下拉 · 增加箭头右侧留白 · [任务记录](task/task-model-select-chevron.md) · 60000 已复验样式
