# 创建大臣时指定工作目录的测试报告

比较基线为 `16aeb0f2994fbc729d68c091469a8e571fda9ae8`。交付基线为该提交加 [源码和测试文件指纹](evidence/code-baseline.txt)所列的工作区修改。预期结果见[任务用例](../../../docs/task/task-junji-cwd.md#③-测试用例与变化)和[创建行为](../../../docs/tech-design.md#41-agent-注册表registry)。

## 用例结果

| 用例 | 实际结果 | 状态 |
| --- | --- | --- |
| T1 HTTP 指定工作目录 | 传入临时项目目录的符号链接。返回档案、磁盘档案、实时会话头及 JSONL 持久化都得到同一规范路径。会话加入原有项目工作区，读取到军机阁档案目录里的记忆文件，打开返回原会话 ID。 | 通过 |
| T2 拒绝无效目录 | 依次提交相对路径、缺失路径和普通文件。均返回目录错误，档案列表为空，会话创建控制器调用数为零。 | 通过 |
| T3 续建与旧记录兼容 | 注入会话创建失败，从磁盘恢复档案后以原 ID 在原目录完成创建。旧保留档案和省略 `cwd` 的新档案都使用军机阁默认工作区。 | 通过 |
| T4 孔明工具及权限 | 工具公布可选 `cwd`。省略时直接创建，受限会话拒绝审批时停止，有单次批准或完全权限时原样向宿主传递 `cwd`。 | 通过 |
| T5 原功能回归 | 28 项用例覆盖档案、记忆、会话转发、审批及归档，逐项结果见运行日志。 | 通过 |
| 创建面板 | 构建产物包含工作目录字段，中英文文案通过类型检查。60080 的运行镜像加载 v0.1.1，其客户端产物缺少该字段。 | 浏览器操作与截图待新版加载 |

HTTP 路由在测试中直接响应 `Request`。工作区、Agent 和会话持久化使用 DSH 真实服务。测试驱动替代 HTTP 路由注册器和会话控制器的创建、解析、改标题调用。孔明工具测试替代宿主审批和军机阁运行时，单独检查传参及访问决策。

## 执行

`pnpm --filter @kmh/kmh-junji build` 和 `pnpm typecheck` 在军机阁独立仓执行成功。Node 25.6.1 与 pnpm 10.30.1。构建和测试只使用独立仓及临时数据。

- E1 [原版本构建](evidence/baseline-build.log)与[红灯](evidence/red.log)。原实现拦截 HTTP 请求里的新字段、忽略无效路径、丢失续建路径，三个用例分别失败。
- E2 [新版构建](evidence/build.log)、[类型检查](evidence/typecheck.log)和[全量测试](evidence/node-test.log)，退出码均为 0。全量测试从插件包目录运行 `node --test --test-concurrency=1 --experimental-test-coverage`，选择 `test/*.test.mjs`，包含 32 通过、0 失败、0 跳过。
- E3 [专项复核](evidence/focused-check.log)。在插件包目录通过 `node --test --test-name-pattern` 复跑创建接口、无效目录、续建和工具四项变更用例，退出码 0。`git diff --check` 退出码 0。
- E4 [Lint](evidence/lint.log)和[格式检查](evidence/format.log)。独立仓缺少 ESLint 和 Prettier 可执行文件，两项命令在执行检查前退出。
- E5 [现有测试沙盒核查](evidence/sandbox.log)。通过只读 Docker 查询确认 60080 的军机阁版本与当前客户端产物，浏览器操作和截图待新版部署。

## 改动覆盖率

Node V8 [原始 LCOV](evidence/coverage/junji.lcov)针对 E2 的宿主产物。使用与实际构建输出逐字节核对过的 TypeScript 映射，将 `git diff --unified=0` 新侧行与覆盖率位置取交集。[逐文件明细](evidence/coverage/changed-lines.json)

| 宿主改动文件 | 覆盖行 | 相关分支 |
| --- | ---: | ---: |
| `kongming-integration.ts` | 27/27 | 14/14 |
| `paths.ts` | 17/17 | 6/6 |
| `protocol/index.ts` | 8/8 | 0/0 |
| `registry.ts` | 1/1 | 2/2 |
| `runtime.ts` | 5/5 | 8/8 |
| 合计 | 58/58 | 30/30 |

浏览器端 `AgentForm.tsx`、`JunjiPanel.tsx` 和 `locales.ts` 的执行覆盖待采集。测试代码、产物和文档不计入改动分母。

## 交付复核

- 功能对账已核实创建、默认目录、续建、已有档案、工具权限与数据目录。Web 操作证据及截图待新版沙盒。
- 技术复核通过协议、公开工作区接口、创建前目录校验、会话头持久化、续建和权限复用检查。默认来源为军机阁数据根，指定目录随保留档案存储，已创建会话的目录由宿主会话头持有。涉及同一 TypeScript 协议，无跨语言表示。
- 交付状态为插件已构建，主仓同步及 60080 页面验收待完成。Lint 与格式检查缺少本仓工具。
