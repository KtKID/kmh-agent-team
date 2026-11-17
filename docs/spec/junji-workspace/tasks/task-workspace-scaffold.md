# 工作区地图与软连接约定自动就绪

> 功能定义：[技术设计 §4.5 工作区与项目软连接](../../../tech-design.md#45-工作区与项目软连接)
> 比较基线：`0cecacf0001675465fc5dc116d61b4f351b4df82`，工作区仅有本次改动（见 [evidence/code-baseline.txt](../../../../../reports/junji-workspace/01/evidence/code-baseline.txt)）
> 创建：2026-11-16

## ① 需求与变更

用户要求：军机阁成员是跨项目的高一级助手，不应把会话工作目录绑在某个仓库；工作区固定为 `<DSH_HOME>/agent-team`，要用的项目以软连接挂进来，并在工作区里放一份 `AGENTS.md` 记录每个软连接项目的简介与负责人。

关键约束：**换一个环境装这套客户端时，这套约定不能靠孔明手工补**。因此军机阁必须在创建/装载工作区后自行判断地图是否存在、不存在就创建（**不得错误覆盖**），并在装配成员提示词时自动带上「软连接与地图维护方式」。本轮接入的项目只有 `kmh-game-lab`，但机制不得写死任何项目路径。

- 新增：§4.5「工作区与项目软连接」功能定义。
- 不改变：`cwd` 选填行为（§4.1）、记忆机制（§4.3）、client 面板。

## ② 精简技术设计

- 新增宿主模块 `src/workspace.ts`：`renderWorkspaceDoc()` 出模板正文；`ensureWorkspaceDoc(root)` 建目录后以 `wx` 独占写入，`EEXIST` 记为 `present`；`readWorkspaceLinksSync(root)` 扫描工作区软连接（只收 `isSymbolicLink`、`statSync` 成功的项，断链跳过，按名字排序）；`renderWorkspaceConvention(root, links)` 出提示词约定段。
- `src/index.ts` 的 `apply()` 在装配运行时之前调用 `ensureWorkspaceDoc(junjiRoot())`，成功创建/失败均只记日志，不阻塞装载。
- `src/prompt.ts` 的 `mountAgentPrompt` 增加可选 `suffix`，把约定段接在人格正文之后（同一 persona 段内，不新增系统提示词段）。
- `src/runtime.ts` 的 `bindPrompt` 与 `update()` 传入 `workspaceConvention()`。
- **并发约束（实现中踩到）**：绑定走 `agent/created` 与 `ensureAgent` 两条路径，同一会话可能并发进入 `bindPrompt`。若在 `mountAgentPrompt` 之前插入 `await`，`prompts` 映射尚未落位，两次注册同名 persona 段会抛 `prompt section "deployment:persona-prefix" is already registered`。因此扫描改为同步实现（`readWorkspaceLinksSync`），`workspaceConvention()` 保持同步。
- 影响文件：`src/workspace.ts`（新增）、`src/prompt.ts`、`src/runtime.ts`、`src/index.ts`、`test/workspace.test.mjs`（新增）、文档三处。

## ③ 测试用例与变化

| 用例 | 类型 | 前提与触发 | 预期 / 禁止结果 |
|---|---|---|---|
| T1 地图缺失时创建 | 新增 | 临时父目录下无 `agent-team`，调用 `ensureWorkspaceDoc` | 目录与 `AGENTS.md` 出现，正文含软连接表、负责人列、`--follow` 与「不要自己 `ln -s`」；禁止创建出空文件 |
| T2 已存在不覆盖 | 新增 | 预置自写地图，连续调用两次 | 返回 `present`，内容与调用前逐字相同；禁止覆盖或截断 |
| T3 软连接扫描 | 新增 | 目录内含普通目录、普通文件、有效软连接两枚、断链一枚 | 只返回两枚有效软连接且按名字排序，断链不出现；禁止抛错 |
| T4 目录缺失时扫描 | 新增 | 传入不存在的路径 | 返回空表；禁止抛错 |
| T5 约定正文 | 新增 | 空表与单条软连接各渲染一次 | 空表时出现「当前没有接入任何项目软连接」；有链接时出现 `` `名称/` → `目标` ``；含 `AGENTS.md` 与软连接注意事项 |
| T6 模板稳定 | 新增 | 连续渲染模板 | 两次结果一致 |
| R1 既有回归 | 沿用 | 现有 `registry` / `kongming-integration` / `remove-agent` 用例 | 32 项全部保持通过 |

风险取舍：扫描改为同步读取工作区目录（条目数与文件系统调用都极小），换取装配路径无 `await`；地图写入失败只记日志，不阻断插件装载——地图是提示词增强，不应成为启动硬依赖。

## ④ 技术实现

- `src/workspace.ts`：`ensureWorkspaceDoc` / `readWorkspaceLinksSync` / `readWorkspaceLinks`（异步包装）/ `renderWorkspaceDoc` / `renderWorkspaceConvention`。
- `src/index.ts`：`apply()` 中先 `ensureWorkspaceDoc(root)`，`created` 时 `logger.info`，异常 `logger.warn`。
- `src/prompt.ts`：`mountAgentPrompt(agent, systemPrompt, suffix?)`，`suffix` 为空串或省略时不追加。
- `src/runtime.ts`：`bindPrompt` 与 `update` 装配时传入 `this.workspaceConvention()`；该私有方法内部 `try/catch`，扫描异常退化为「暂无项目」。
- 与计划差异：计划用异步扫描，实测撞到并发重复注册，改为同步扫描 + 异步包装保留给测试与其他调用方。

## ⑤ 验证结果

- 构建 `pnpm --filter @kmh/kmh-junji build` 退出码 0；类型检查 `typecheck` 退出码 0；全量测试 **38 通过 / 0 失败**（32 沿用 + 6 新增）。
- 红灯记录：T3 首版实现用 `readlink` 判存在，断链也被收进约定，测试先红后改为 `readlinkSync` + `statSync` 双检；并发重复注册由既有回归用例暴露（`remove-agent.test.mjs`）后修复。
- Lint 无法执行：独立仓缺少 `eslint` 可执行文件（`spawn ENOENT`），与上一任务记录一致，属环境缺口。
- 未完成项：改动尚未进入当前运行环境——现网是打包版客户端（`~/.kmh-os/profiles/kmh-client-v01/node_modules/@ktkid/kmh-junji`，已发布版 0.1.4），本仓库 `lib/` 不被它加载；生效需发布新版本并升级 profile，或临时覆盖该目录后重启客户端（待用户选择）。
- 详细用例结果、证据与环境：[测试报告](../../../../../reports/junji-workspace/01/test-report.md)。
