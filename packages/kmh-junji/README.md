# @kmh/kmh-junji · 军机阁

基于 DeepSeek Harness（DSH）的军机阁插件：用户创建多个「大臣」agent，每个 agent 一对一永久绑定一个专属 session，拥有独立记忆小本子，侧边栏「军机阁」区块统一管理。

## 功能

- **大臣管理**：创建/编辑 agent（名字 + 系统提示词 + 模型目录下拉）；agentId 为稳定 slug，重名自动追加 `-2`/`-3`，永不覆盖既有档案，损坏档案目录跳过并上报。
- **一对一专属会话**：agent↔session 创建时绑定，此后不换（`agent.json` 的 `sessionId` 写后不变）；persona 与模型按档案每次请求注入。
- **per-agent 记忆**：双文件机制（移植 kongming-memory-v1）——创建时初始化发布冻结；装配时注入冻结正文；收尾 steer 提醒记小本子；手动 `/compact` 成功后原子刷新冻结。
- **client UI**：侧边栏「军机阁」区块（agent 列表 + 模型微标签 + 启动行）、创建/编辑弹层（宿主 Modal 原语 + 真实主题 token）、点击进入该 agent 的专属会话。
- **孔明联动（可选）**：当宿主同时运行 `@kmh/kongming` 时，自动向孔明 Agent 挂载 `junji_*` 工具集与提示片段，孔明即可代管军机阁。

## 数据布局

```
<DSH_HOME>/agent-team/
  <agentId>/               ← agentId：创建时由名字生成的稳定 slug
    agent.json             ← { id, name, systemPrompt, model, sessionId, createdAt, updatedAt }
    MEMORY.md              ← 原始记忆小本子（agent 自己维护）
    MEMORY.frozen.md       ← 冻结记忆（插件维护，装配时完整注入）
```

## 配置

| 字段 | 说明 |
| --- | --- |
| `promptTemplate` | 冻结记忆装配模板。必须包含 `{{originalMemoryPath}}`、`{{frozenMemoryPath}}`、`{{frozenMemory}}` 三个变量；缺省提供默认模板。 |
| `reminderPrompt` | 收尾提醒文案（提示 agent 把有价值内容记入原始记忆文件）；缺省提供默认文案。 |

## 集成到 DSH host

以 kongming-os 的 `kmh-web` profile 为例（其他 DSH host 同理）：

1. profile 的 `package.json` dependencies 加本包（如 `"@kmh/kmh-junji": "link:…/packages/kmh-junji"`，或将来直接用 registry 版本号）；
2. `dsh.profile.bundles` 加包名 `@kmh/kmh-junji`——client 注入面与 bundle 补丁（`cordis.patch.yml`）由包内 `dsh` 配置自带；
3. 重建 profile（pnpm install + 重启 GUI）。

同侪依赖由宿主提供：`@deepseek-ai/cordis@4.0.6-alpha.1`、`@deepseek-ai/dsh-*@0.2.2-alpha.2`、`react@^18.3.1`（见 peerDependencies）。

## 孔明联动工具集

`@kmh/kongming` 在场时挂载（均以 `junji_` 前缀）：

- `junji_list_agents` / `junji_list_models` — 列出大臣与可用模型目录
- `junji_create_agent` / `junji_update_agent` — 创建 / 改名、改提示词、改模型
- `junji_open_agent` — 准备某大臣的专属会话并返回 sessionId
- `junji_remove_agent` — 用户批准后停止成员的会话任务，归档会话，再删除档案与记忆。归档保留聊天历史。

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
