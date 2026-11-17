# 变更记录

## v0.1.7 · 2026-11-17

- 修复军机阁安装包的浏览器模块注册名，客户端可按 `@ktkid/kmh-junji` 加载军机阁。

## v0.1.3 · 2026-11-15

- 创建大臣时可在 Web 表单填写工作目录。创建接口和孔明的 `junji_create_agent` 同样接受可选 `cwd`，使用宿主上已存在的绝对目录。
- 大臣的专属会话加入对应的工作区。省略 `cwd` 时使用 `<DSH_HOME>/agent-team`，创建中断后的续建继续使用原目录和会话 ID。
- 各大臣的档案和记忆保存在 `<DSH_HOME>/agent-team/<agentId>/`。`kongming_memory_save` 按大臣 ID 追加到该目录的 `MEMORY.md`。

## v0.1.2 · 2026-11-15

以下改动随 v0.1.3 一同公开发布。

- 复用孔明的共享记忆实现。大臣可用 `kongming_memory_save` 追加到各自的原始记忆文件，手动压缩后刷新冻结记忆。
- 大臣在记忆收尾前向孔明回传任务答复。孔明会话使用完全权限时可直接删除大臣。
- 补充军机阁图标与演示素材，支持从孔明主仓子模块构建。

## v0.1.1 及更早

[GitHub Releases](https://github.com/KtKID/kmh-agent-team/releases)
