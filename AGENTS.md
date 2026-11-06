# AGENTS.md

军机阁（kmh-junji）：基于 DeepSeek Harness 的用户自建 agent 团队插件。用户创建多个"大臣"agent，每个 agent 一对一永久绑定一个 DSH session，拥有独立记忆小本子（复用 kongming-memory-v1 双文件机制），侧边栏"军机阁"区块管理。

## 仓库定位

- 本仓库是独立插件仓库，最终通过 pnpm `link:` 挂进 kongming-os 的 `kmh-web` profile；不修改 DSH 上游 checkout（`/Volumes/machub_app/proj/kongming-os/third_party/dsh`，只读参照）。
- kongming-os 仓库路径：`/Volumes/machub_app/proj/kongming-os`；DSH 插件结构模板参照 `packages/kmh-team`，记忆机制参照 `packages/kongming-memory-v1`。

## 关键设计

- 需求与技术方案见 [docs/tech-design.md](docs/tech-design.md)（先读）。
- agent 数据落 `$DSH_HOME/agent-team/<agentId>/`：`agent.json`（含 sessionId，写后不变）+ `MEMORY.md` + `MEMORY.frozen.md`。
- agent↔session 一对一，创建后不换；persona 与模型按 agent.json 每次请求注入。
- 记忆：创建时初始化发布冻结；装配时注入冻结正文；收尾 steer 提醒记小本子；手动 /compact 成功后原子刷新冻结。

## 开发约定

- ESM、TypeScript strict、zod 协议、Cordis 插件注册走 `ctx.effect()`/`ctx.on()`（同 DSH 约定，见其 AGENTS.md）。
- 构建：`pnpm build`（esbuild host lib + client bundle）；检查：`pnpm typecheck` / `pnpm test`（node:test）。
- client UI 文案走 locale 字典，不硬编码。
- 对 kongming-os / `$DSH_HOME` 的一切写入都要在对话中明确说明并获得批准（工作区外）。

## 当前状态

- [x] 需求对齐（2026-11-05）：军机阁命名；插件方式开发；agent↔session 一对一；memory 用 kongming-memory-v1 机制 per-agent 目录化；创建面板 = 名字 + 系统提示词 + 模型。
- [x] Phase 0-4 开发完成（2026-11-06）：底座 / host 注册表与会话绑定 / per-agent 记忆 / 军机阁主面板与侧栏启动行 / bundle 注册（`dsh.bundle.patch`）。
- [x] 弹窗改用宿主 Modal 原语与真实主题 token（`9805303`），修复透明背景。
- [x] 隔离环境 E2E 全链路通过（创建/绑定/真实对话/记忆/压缩刷新/重启恢复/双 agent 隔离），见 [docs/verification-20261106.md](docs/verification-20261106.md)。
- [ ] 待用户：重载 60000 后目检弹窗视觉（client bundle 进启动时 VFS 包，需服务重载，浏览器刷新不换包）。
- 集成事实：kongming-os `profiles/kmh-web` 已链接本包（dependency + bundle），60090 测试实例可直接目检新版。
