# 军机阁验证记录（2026-11-06）

## 验证环境

- 隔离实例：`http://127.0.0.1:60090`，`DSH_HOME=/tmp/junji-e2e/home`（临时目录，凭据从 `~/.kmh-os/.credentials.yaml` 只读复制）
- 启动方式：kongming-os kmh-web profile 原样 + `--patch` 端口覆盖（60000 与 `~/.kmh-os` 全程未动）
- profile 展开：11 个 bundle 全部解析成功、零 skipping；组合 entries 含 `kmh-junji` 行
- 军机阁插件版本：commit `9805303`（含 Modal 弹窗修复）

## API 级端到端结果（对真实服务、真实模型 deepseek-flash）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 侧边栏 bundle 装载 | ✅ | 启动日志 0 skipping；`/api/kmh-junji/bootstrap` 返回 agents+模型目录 |
| 2 | 创建（名字/系统提示词/模型） | ✅ | `司马懿`、`司马懿-2`、`杨仪` phase=ready；slug 重名追加 -2 |
| 3 | 独立目录与记忆文件 | ✅ | `$DSH_HOME/agent-team/<id>/{agent.json,MEMORY.md,MEMORY.frozen.md}` |
| 4 | 永久会话绑定 | ✅ | `open` 多次返回同一 sessionId；重启后不变 |
| 5 | persona 生效 | ✅ | 模型回复"仲达，司马懿——魏国谋臣，善守善算，专候调遣。"；日志 persona 命中 ×9 |
| 6 | 冻结记忆装配注入 | ✅ | 每次请求系统提示词含 `junji-memory` 段 |
| 7 | 收尾提醒驱动记小本子 | ✅ | `kmh-junji:memory-reminder` ×2；模型用文件工具写入长期偏好/身份风格/维护规则 |
| 8 | `/compact` 冻结刷新 | ✅ | "Compacted 45 history items (~11734 tokens)"；frozen 0→390 字节，与原始逐字节一致 |
| 9 | 压缩后新请求用新冻结 | ✅ | 新回复逐字引用记忆"司马懿，字仲达…自称"（仅存在于记忆文件） |
| 10 | 重启恢复 | ✅ | kill+重启后三 agent 恢复、sessionId 不变、冻结保留 |
| 11 | 双 agent 隔离 | ✅ | 独立 sessionId/目录/记忆，内容互不相同 |

## 分层说明

- **UI 视觉**（60000 实测，用户操作）：侧栏入口、空列表、➕ 表单、模型目录 ——通过（修复前版本）
- **弹窗背景修复**（Modal 原语 + 真实主题 token）：bundle 回归通过（旧 token 0 残留）；60090 实例已载新版待目检；60000 需重载后生效（client bundle 打进启动时 VFS 包，浏览器刷新不换包）
- **浏览器自动化**：本机无独立系统 Chromium、现存 profile 挂载需本会话不可得的 launch grant，未能自动化；以 API 级真实链路 + 用户实测替代

## 浏览器级补充验证（同日，裸 CDP 驱动自建 Chrome 对 60090）

| 检查 | 结果 | computed style 证据 |
|---|---|---|
| 侧栏"军机阁"入口 | ✅ | DOM 按钮存在并可点击 |
| 军机阁面板 | ✅ | `[data-junji-panel]` 挂载 |
| **弹窗卡面背景（本次修复点）** | ✅ | `rgb(44, 44, 46)`（bg-layer-2 暗色解析值，非 rgba(0,0,0,0)）；阴影 + 28px 圆角 + z-index 1000 |
| 弹窗遮罩 | ✅ | `.mask::after` 背景 `rgba(0, 0, 0, 0.5)` |
| 表单字段主题 | ✅ | 输入框 `rgb(35,35,36)` 底 + `rgba(255,255,255,0.2)` 边框（bg-layer-1 / border-l4） |
| 创建表单完整 | ✅ | 标题"创建大臣"、名字/系统提示词 textarea/模型 select 齐备 |
| **点击 agent → 专属会话** | ✅ | 点击列表行后面板关闭、输入框（composer）出现，即 uiWorkspace.openSession 导航生效 |
| 面板列表 | ✅ | 三行命名 agent（两个"司马懿"为同名不同 id，slug 已去重）+ 图标按钮 |

截图存档：`/tmp/junji-e2e/after-click.png`（点击 agent 进入会话后的页面）。

## 复验入口

```sh
# 60090 实例（仍在运行；token 见 /tmp/junji-e2e/web2.log）
open "http://127.0.0.1:60090/?token=$(grep -o 'token=[^ ]*' /tmp/junji-e2e/web2.log | head -1 | cut -d= -f2)"
# 证据与脚本
ls /tmp/junji-e2e/          # e2e.mjs / e2e2.mjs / e2e3.mjs / restore.mjs / web*.log
# 清理
kill $(lsof -nP -iTCP:60090 -sTCP:LISTEN -t) && rm -rf /tmp/junji-e2e
```
