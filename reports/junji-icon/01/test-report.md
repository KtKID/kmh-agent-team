# 军机阁图标测试报告

2026-11-13 · 比较基线 `f42f0ba`。图标 PNG SHA-256 为 `ef32927622a6e96317810ad323904be19e9da8046cb11c1d27bd5dc9279a96c7`，客户端入口 SHA-256 为 `49fee41ad7197884a52be5df588a0d91872582779210f480006483fe7ad1daae`。发行包在临时目录生成并安装到独立的官方 DSH `0.2.2-rc.2` Web profile。

| 用例 | 结果 | 实际证据 |
| --- | --- | --- |
| T1 README 与发行包资源 | 通过 | README 首行引用 `docs/assets/junji-icon.png`，与包目录的 PNG 字节一致。解包读取 `package.json#icon`，比较包内 PNG 与源码资源，字节一致。实测 384 × 384、RGBA、170209 字节，低于 256 KiB。浏览器产物包含飞檐路径。 |
| T2 DSH 界面 | 通过 | Chrome 打开隔离 Harness 的插件管理页和军机阁详情。列表卡片及详情图标为 36 px，组件行为 30 px，均加载 PNG。展开与收起侧栏的 SVG 分别为 16 px、18 px，描边使用 `currentColor`。本次界面截图使用浅色主题。复验时对完整详情图标外框取图，实测 PNG 元素与外框中心重合，横纵中心差均为 0 px。 |
| T3 类型、构建和既有回归 | 通过 | 仓库根运行 `pnpm typecheck`、`pnpm test` 和 `node scripts/pack-release.mjs`（输出到临时目录），均退出 0。20 项测试通过。测试明细见附件。 |

- [隔离安装日志](evidence/install.log)
- [插件详情图标截图](evidence/plugin-card.jpg) · [侧栏图标截图](evidence/sidebar.jpg)
- [既有测试明细及宿主代码覆盖率](evidence/node-test.log)

Node 测试采集宿主代码，行覆盖率 76.83%，分支覆盖率 76.00%。改动的客户端图标函数通过浏览器核验，打包脚本的资源复制路径通过 T1 实际执行，两处未采集行或分支覆盖率。仓库的 lint 和格式检查缺少 ESLint 与 Prettier，未运行到代码检查阶段。`git diff --check` 通过。

交付对账核对 [需求及用例](../../../docs/task/task-junji-icon.md)、[技术设计与变更记录](../../../docs/tech-design.md) 和本报告。README 置顶、发行包资源和侧栏显示均有对应结果。技术核验确认图标通过 DSH 公开元信息和原有侧栏 slot 接入，文件随包发布，尺寸与颜色由宿主控制。公共 Release 的升级与主仓 Web 重启属于后续生效操作。
