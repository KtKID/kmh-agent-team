# 工作区约定不得外泄本机路径

> 功能定义：[技术设计 §4.5 工作区与项目软连接](../../../tech-design.md#45-工作区与项目软连接)
> 比较基线：`bd94139`，工作区含本轮「工作区脚手架」的未提交改动（边界见 [evidence/code-baseline.txt](../../../../../reports/junji-workspace/02/evidence/code-baseline.txt)）
> 创建：2026-11-17

## ① 需求与变更

用户验收「工作区自动注入」段时指出：注入文本里写着 `` `kmh-game-lab/` → `/Volumes/machub_app/proj/kmh-plugin/kmh-game-lab` ``，以及工作目录的绝对路径——**这是使用者路径隐私外泄，换设备后这些路径全是错的**。要求改成只填示意路径，真实路径要么问用户、要么在搭建工作区时当场告知。

- 修改：§4.5「提示词装配」——注入文本只写软连接名（门牌），不写工作区根目录与软连接真实目标；真实目标用时现查（`ls -l` / `readlink`）。
- 修改：§4.5「工作区地图」——模板表格去掉「本机真实路径」列，只留软连接名、一句话简介、负责人。
- 不改变：`wx` 独占创建与「已存在不改写」；不改变软连接扫描规则（断链跳过、按名排序）；不改变 `cwd` 选填、记忆机制、client 面板。

## ② 精简技术设计

- `renderWorkspaceConvention(links)`：**去掉 `root` 参数**（原实现把 `root` 与 `link.target` 都拼进正文）。正文改为「工作目录用 `pwd` 确认 → 软连接名清单 → 真实目标用 `ls -l` / `readlink` 现查 → 地图与用法注意」。
- `renderWorkspaceDoc()`：表头由 `| 软连接 | 本机真实路径 | 一句话简介 | 负责人 |` 改为 `| 软连接 | 一句话简介 | 负责人 |`；删掉把 `/Volumes/...` 当例子的说明。
- `src/runtime.ts` 两处调用点跟随签名变化（`workspaceConvention()` 内部与降级分支）。
- 影响文件：`src/workspace.ts`、`src/runtime.ts`、`test/workspace.test.mjs`、文档三处。
- 遗留事实：`WorkspaceLink.target` 字段保留（扫描结果仍返回真实目标，供本机地图维护与其他调用方使用），只是**不再进入注入文本**。

## ③ 测试用例与变化

| 用例 | 类型 | 前提与触发 | 预期 / 禁止结果 |
|---|---|---|---|
| T5 约定正文不含路径 | 修改 | 空表、单条软连接各渲染一次（入参改为 `links` 单参数） | 出现 `## 工作区`、`` `kmh-game-lab/` ``、`AGENTS.md`、`readlink`、空表退化句；**断言正文不含 `root` 与 `target`**；禁止出现 `→` 形式的路径映射 |
| T7 模板不写死本机目录 | 新增 | 渲染模板 | 表头为三列（软连接 / 一句话简介 / 负责人）、含 `ls -l`；不含 `/Volumes/`、`/Users/`、`| 本机真实路径 |` |
| T1–T4、T6 | 沿用回归 | 同上任务 | 保持通过 |
| R1 既有回归 | 沿用 | `registry` / `kongming-integration` / `remove-agent` | 全部保持通过 |

风险取舍：注入文本不再自证「软连接指向哪」，成员需要多跑一次 `ls -l`；换取的是提示词里零本机路径，换设备无需改代码、截图与外发也不带出用户目录结构。

## ④ 技术实现

- `src/workspace.ts`：`renderWorkspaceConvention` 签名 `(links)`，正文重写（第五条改为「这里只写软连接名，不写目标路径」）；`renderWorkspaceDoc` 模板三列表格 + 「只记门牌与归属」说明，维护规则同步为「软连接名、一句话简介、负责人」。
- `src/runtime.ts`：`renderWorkspaceConvention(readWorkspaceLinksSync(this.root))`、降级分支 `renderWorkspaceConvention([])`。
- `test/workspace.test.mjs`：T5 改写并新增两条禁泄漏断言；新增 T7。
- 与计划差异：T7 首版断言用 `doc.includes("真实路径")`，被模板里「不记真实路径」这句自身命中而误红，改为查表头 `| 本机真实路径 |`。

## ⑤ 验证结果

- 构建退出码 0；`typecheck` 退出码 0；全量测试 **39 通过 / 0 失败**（38 沿用 + T7 新增）。
- 真实渲染实测（用构建产物对该机真实工作区跑一遍）：输出含 `` - `kmh-game-lab/` ``，不含 `/Users/`、不含 `/Volumes/`，两者检查均为 `false`。
- Lint 仍不可用：独立仓未安装 `eslint`（`spawn ENOENT`），属既有环境缺口。
- 未完成项：改动尚未进入运行环境——现网客户端从 `~/.kmh-os/profiles/kmh-client-v01/node_modules/@ktkid/kmh-junji` 加载，本仓 `lib/` 不被读取；生效需发版并升级 profile（发版号 `0.1.8`）。
- 用例明细与证据：[测试报告](../../../../../reports/junji-workspace/02/test-report.md)。
