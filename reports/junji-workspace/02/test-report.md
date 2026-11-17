# 测试报告 · 工作区约定不写本机路径

- 任务：[task-workspace-path-privacy.md](../../../docs/spec/junji-workspace/tasks/task-workspace-path-privacy.md)
- 代码基线：`bd94139`（工作区含上一任务未提交改动，边界见 [evidence/code-baseline.txt](evidence/code-baseline.txt)）
- 环境：macOS / Node 25.6.1 / pnpm 10.30.1；仓库 `/Volumes/machub_app/proj/kmh-plugin/kmh-agent-team/packages/kmh-junji`
- 日期：2026-11-17

## 1. 结论

| 项 | 结果 |
|---|---|
| `pnpm build` | 退出码 0 |
| `pnpm typecheck` | 退出码 0 |
| `pnpm test` | **39 通过 / 0 失败** |
| 真实渲染实测（本机真实工作区） | 注入正文不含 `/Users/`、不含 `/Volumes/` |
| `pnpm lint` | 未执行：独立仓未安装 eslint（`spawn ENOENT`），既有环境缺口 |

## 2. 用例明细

| 编号 | 用例 | 类型 | 结果 | 说明 |
|---|---|---|---|---|
| T5 | 约定正文只列软连接名，空表退化说明 | 修改 | 通过 | 入参由 `(root, links)` 改为 `(links)`；新增断言「正文不含 root」「正文不含 target」 |
| T7 | 地图模板只记门牌与归属 | 新增 | 通过 | 断言三列表头、含 `ls -l`、不含 `/Volumes/`、`/Users/`、`| 本机真实路径 |` |
| T1 | 地图缺失时创建 | 沿用回归 | 通过 | — |
| T2 | 已存在不覆盖 | 沿用回归 | 通过 | — |
| T3 | 软连接扫描（跳过断链、按名排序） | 沿用回归 | 通过 | 扫描仍返回 `target`，只是不进注入文本 |
| T4 | 目录缺失返回空表 | 沿用回归 | 通过 | — |
| T6 | 模板渲染稳定 | 沿用回归 | 通过 | — |
| R1 | registry / kongming-integration / remove-agent 等既有 32 项 | 沿用回归 | 通过 | 见 [evidence/node-test.log](evidence/node-test.log) |

原始输出：[build.log](evidence/build.log)、[typecheck.log](evidence/typecheck.log)、[node-test.log](evidence/node-test.log)、[code-baseline.txt](evidence/code-baseline.txt)。

## 3. 红灯记录

1. T7 首版断言 `doc.includes("真实路径")` —— 被模板中「只记门牌与归属，不记真实路径」这句自身命中，测试误红。改为查表头 `| 本机真实路径 |` 后转绿。**教训：禁泄漏断言不要用会出现在"禁止说明"里的词。**
2. T7 第一次运行前未重建 `lib/`，测试读的是上一版产物（表头仍是四列）也会红；已固化「改源码先 build 再 test」的取证顺序（测试从 `../lib/src/workspace.js` 导入）。

## 4. 真实渲染实测

用构建产物对当前机器真实工作区（软连接 `kmh-game-lab`）跑一次 `readWorkspaceLinksSync` + `renderWorkspaceConvention`：

```text
## 工作区（军机阁自动注入）
- 你当前的工作目录就是军机阁工作区（用 `pwd` 确认）。项目本体不在这个目录里，通过下面的软连接访问：
- `kmh-game-lab/`
- 这里只写软连接名，不写目标路径：要指向哪里，用 `ls -l <名字>` 或 `readlink <名字>` 现查。
...
--- 泄漏检查 ---
含 /Users/: false | 含 /Volumes/: false
```

## 5. 未覆盖与未决

- 未做浏览器端验收：本轮只改宿主侧文本渲染，client 面板与 Web 交互无改动。
- 未在当前运行环境验证：现网客户端从 `~/.kmh-os/profiles/kmh-client-v01/node_modules/@ktkid/kmh-junji` 加载，本仓 `lib/` 不被读取，生效需发版 `0.1.8` 并升级 profile。
- 本机既有 `~/.kmh-os/agent-team/AGENTS.md`（人工维护版）仍带一列真实路径，属用户数据；是否抹除待用户决定（插件不会改写既有地图）。
