# @kmh/kmh-junji · 军机阁

基于 DeepSeek Harness（DSH）的军机阁插件：用户创建多个「大臣」agent，每个 agent 一对一永久绑定一个专属 session，拥有独立记忆小本子，侧边栏「军机阁」区块统一管理。

## 功能

- **大臣管理**：创建/编辑 agent（名字 + 系统提示词 + 模型目录下拉）；agentId 为稳定 slug，重名自动追加 `-2`/`-3`，永不覆盖既有档案，损坏档案目录跳过并上报。
- **一对一专属会话**：agent↔session 创建时绑定，此后不换（`agent.json` 的 `sessionId` 写后不变）；persona 与模型按档案每次请求注入。
- **会话工作目录**。创建大臣时可填写服务端已存在的绝对目录，留空使用 `<DSH_HOME>/agent-team`。会话加入对应的工作区，档案与记忆仍保存在 `<DSH_HOME>/agent-team/<agentId>/`。
- **per-agent 记忆**：由 `@kmh/kongming-memory-v1` 绑定各 Agent 的原始与冻结文件。收尾通过 `kongming_memory_save` 追加长期条目，手动 `/compact` 成功后刷新该 Agent 的冻结记忆。
- **client UI**：侧边栏「军机阁」区块（agent 列表 + 模型微标签 + 启动行）、创建/编辑弹层（宿主 Modal 原语 + 真实主题 token）、点击进入该 agent 的专属会话。
- **孔明联动（可选）**：当宿主同时运行 `@kmh/kongming` 时，自动向孔明 Agent 挂载 `junji_*` 工具集与提示片段，孔明即可代管军机阁。

## 数据布局

```
<DSH_HOME>/agent-team/
  <agentId>/               ← agentId：创建时由名字生成的稳定 slug
    agent.json             ← { id, name, systemPrompt, model, cwd?, sessionId, createdAt, updatedAt }
    MEMORY.md              ← 原始记忆小本子（记忆工具追加）
    MEMORY.frozen.md       ← 冻结记忆（插件维护，装配时完整注入）
```

## 配置

| 字段 | 说明 |
| --- | --- |
| `promptTemplate` | 冻结记忆装配模板。必须包含 `{{originalMemoryPath}}`、`{{frozenMemoryPath}}`、`{{frozenMemory}}` 三个变量；缺省提供默认模板。 |
| `reminderPrompt` | 收尾提醒文案（提示 agent 通过记忆工具把有价值的内容追加到自己的原始记忆文件）；缺省提供默认文案。 |

## 安装与本地集成

使用 DeepSeek Harness 的「插件」→「添加插件」安装预编译包。步骤和适配版本见 [军机阁仓库首页](https://github.com/KtKID/kmh-agent-team#readme)。

以 kongming-os 的 `kmh-web` profile 为例（其他 DSH host 同理）：

1. profile 的 `package.json` dependencies 加本包（如 `"@kmh/kmh-junji": "link:…/packages/kmh-junji"`，或将来直接用 registry 版本号）；
2. `dsh.profile.bundles` 加包名 `@kmh/kmh-junji`——client 注入面与 bundle 补丁（`cordis.patch.yml`）由包内 `dsh` 配置自带；
3. 重建 profile（pnpm install + 重启 GUI）。

同侪依赖由宿主提供：`@deepseek-ai/cordis@4.0.6-alpha.1`、`@deepseek-ai/dsh-*@0.2.2-alpha.2`、`react@^18.3.1`（见 peerDependencies）。

## 孔明联动工具集

`@kmh/kongming` 在场时挂载（均以 `junji_` 前缀）：

- `junji_list_agents` / `junji_list_models` — 列出大臣与可用模型目录
- `junji_create_agent` — 创建大臣。可传 `cwd` 指定服务端绝对目录，由宿主按完全权限或单次确认执行。
- `junji_update_agent` — 改名、改提示词、改模型
- `junji_open_agent` — 准备某大臣的专属会话并返回 sessionId
- `junji_send` — 给指定大臣的专属会话发消息，回复自动回到孔明会话
- `junji_remove_agent` — 孔明会话设为完全权限时直接执行，其他模式按宿主规则取得单次批准后执行。停止成员的会话任务，归档会话，再删除档案与记忆。归档保留聊天历史。

## 模块导出

- `.` — host 侧 Cordis 插件入口
- `./client` — client bundle（web platform，由宿主 `__ModuleLoader__` 加载）
- `./protocol` — client↔host RPC 协议（zod schema）

## 开发

源码仓库：[KtKID/kmh-agent-team](https://github.com/KtKID/kmh-agent-team)（pnpm workspace；技术设计见 [docs/tech-design.md](https://github.com/KtKID/kmh-agent-team/blob/main/docs/tech-design.md)，验证记录见 docs/）。

```bash
pnpm install      # 仓库 postinstall 自动定位本地 kongming-os 并链接 DSH 同侪依赖
pnpm typecheck    # host + browser 双 tsconfig
pnpm test         # 先 build 再跑 node:test
pnpm build        # esbuild 双面构建（host lib + client bundle）
```

## License

MIT
