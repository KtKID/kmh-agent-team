# 工作区地图与软连接约定的测试报告

比较基线为 `0cecacf0001675465fc5dc116d61b4f351b4df82`，工作区改动见 [code-baseline.txt](evidence/code-baseline.txt)。预期结果见[任务用例](../../../docs/spec/junji-workspace/tasks/task-workspace-scaffold.md#③-测试用例与变化)与[技术设计 §4.5](../../../docs/tech-design.md#45-工作区与项目软连接)。

## 用例结果

| 用例 | 实际结果 | 状态 |
| --- | --- | --- |
| T1 地图缺失时创建 | 临时父目录下无 `agent-team`，调用后目录与 `AGENTS.md` 出现；正文含「项目软连接」「负责人」列、`--follow` 与「不要自己 `ln -s`」。 | 通过 |
| T2 已存在不覆盖 | 预置自写地图后连续调用两次 `ensureWorkspaceDoc`，均返回 `present`，文件内容与调用前逐字相同。 | 通过 |
| T3 软连接扫描 | 普通目录与普通文件被忽略；两枚有效软连接按名字排序返回，目标路径为绝对真实路径；指向不存在目标的断链被跳过且不抛错。 | 通过（首版红灯后修复） |
| T4 目录缺失时扫描 | 传入不存在的路径返回空表，无异常。 | 通过 |
| T5 约定正文 | 空表渲染出「当前没有接入任何项目软连接」；单条软连接渲染出 `` `kmh-game-lab/` → `/tmp/kmh-game-lab` ``，并含 `AGENTS.md` 与软连接注意事项。 | 通过 |
| T6 模板稳定 | 连续两次 `renderWorkspaceDoc()` 结果一致。 | 通过 |
| R1 既有回归 | 32 项既有用例（注册表、记忆绑定、删除归档、孔明工具权限）全部通过。 | 通过 |
| 运行环境生效 | 现网为打包版客户端，加载的是已发布 `@ktkid/kmh-junji` 0.1.4，本仓库 `lib/` 未被加载；未做端到端验证。 | 未验证（需发布或临时覆盖后重启） |

## 执行

Node 25.6.1，pnpm 10.30.1。全部命令在独立仓 `kmh-plugin/kmh-agent-team` 执行，只写本仓库与系统临时目录。

- E1 [构建](evidence/build.log)：`pnpm --filter @kmh/kmh-junji build`，退出码 0。
- E2 [类型检查](evidence/typecheck.log)：`pnpm --filter @kmh/kmh-junji typecheck`，退出码 0。
- E3 [全量测试](evidence/node-test.log)：`pnpm --filter @kmh/kmh-junji test`，38 通过 / 0 失败。
- E4 [Lint](evidence/lint.log)：独立仓缺少 eslint 可执行文件，命令在检查前退出（`spawn ENOENT`），非本次改动引入。

## 红灯与修复

- T3 首版用 `readlink` 判断存在，断链也被收进约定（实际返回 `alpha/broken/zeta`），断言期望 `alpha/zeta` 失败；改为 `readlinkSync` + `statSync` 双检后转绿。
- 异步扫描版把 `await` 插在 persona 段注册之前，`bindPrompt` 并发进入时重复注册 `deployment:persona-prefix`，既有用例 `remove-agent.test.mjs` 报 `prompt section ... is already registered`；改为同步扫描后全量转绿。

## 未覆盖与局限

- 插件装载时自动创建地图、提示词约定进入真实会话上下文，均未在运行环境验证（原因见上表最后一行）。
- 客户端面板无改动，无浏览器验收项。
