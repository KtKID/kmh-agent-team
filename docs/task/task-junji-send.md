# 孔明向军机阁大臣会话发消息并收回回复

> spec: 无，独立任务（背景见 [docs/tech-design.md](../tech-design.md) 与孔明侧 [kmh-kongming 会话发单 spec](../../../kmh-kongming/docs/spec/kongming-session-dispatch-mvp/spec.md)）
> 创建: 2026-11-11

## ① 需求

### 功能方向

孔明可以用新工具 `junji_send` 把一段任务消息发给指定大臣的专属会话；大臣按自己的系统提示词与记忆小本子作答；作答轮次结束后，结果自动回传孔明会话一次，孔明据此向用户答复。用户在侧栏点开大臣会话时，能看到这条来自孔明的消息（来源可识别，孔明 bundle 的折叠投影按 relay 标记兼容展示）。

### 功能边界

- 做：`junji_send(agentId, content)` 挂到孔明会话工具集（第 7 个）；查档案拿 sessionId（复用 `runtime.open` 的会话就绪保障）；底层调 `@kmh/session-kit` 的 `sendAndWatch`（排队投递 + 轮次跟踪 + 一次回传）；挂载释放时清理未完成的跟踪
- 不做：不做军机阁侧折叠 UI（孔明 bundle 的投影已按 `form: "relay"` 兼容 `kmh-relay`）；不支持附件与 steer/append 补发（后续需要再开）；不改既有 6 个工具的任何行为
- 不做：不动主仓（构建生效与重启另行确认时机）

### 不能破坏的不变量

- 普通会话零感知：工具仍只挂孔明会话（`kongming/agent-ready` 事件绑定机制不变）
- 既有 6 工具行为不变；军机阁 10 项既有测试全绿
- 大臣会话仍是普通会话，用户人工对话不受影响
- 工作区干净（基线 83c0ff9 已提交），本次改动独立成提交

## ② 测试用例（先写，此刻失败）

### unit

- tool_registered：孔明工具集 definitions 包含 `junji_send`，描述与参数 schema（agentId 必填、content 为非空文本数组）→ 功能方向
- send_happy_path：档案存在时按序 `runtime.open`（就绪会话）→ `sendAndWatch`（from=孔明 Agent、toSessionId=档案 sessionId、正文原样）；返回排队回执 `{dispatchId, sessionId, agentId, status:"queued"}` → 功能方向
- send_agent_not_found：agentId 不存在时报「军机阁没有名为 X 的大臣」，不投递 → 边界
- send_blank_content：纯空白正文报错，不投递 → 边界
- send_source_inactive：挂载已释放时工具执行抛「军机阁工具仅供当前孔明会话使用」（现有守卫覆盖新工具）→ 不变量
- send_release_tracked：每次 send 的跟踪释放入口被收集，挂载释放时全部调用 → 功能方向

### smoke

- send_flow_combo：fake ctx/runtime 完整走一遍 junji_send execute → 目标 followup 收到 kmh-relay 消息（前缀默认文案、正文正确）→ 触发领取与轮次结束 → 孔明 followup 收到一次回传（session-kit 真函数链路）→ 功能方向

### e2e（按需）

浏览器真机验证由用户在 60000 完成（孔明会话实际调用 junji_send，核对大臣会话折叠与回传）；隔离环境真实宿主 fixture 军机阁仓尚未建设，不在本任务搭，依据：跨仓迁移 fixture 成本高，底层链路已有孔明侧 dispatch.test.ts 真实宿主回归覆盖（同一 sendAndWatch 通道）。

## ③ 技术实现

### 实现步骤

1. 依赖：`packages/kmh-junji/package.json` devDependencies 加 `@kmh/session-kit: link:../../../kmh-session-kit`（本仓开发用；主仓运行时由 profile/根链接提供，同 kongming 模式）；`scripts/link-dsh.mjs` 无需改
2. `src/kongming-integration.ts`：import `sendAndWatch`；definitions 追加 `junji_send` 工具（Input：agentId + content 文本块数组；execute：`runtime.open(agentId)` → `sendAndWatch` → 收集 release → 返回回执）；attach 的 releases 集合与释放清理
3. `runtime.ts` 不改（`open` 已返回就绪 sessionId）

### 涉及文件

- packages/kmh-junji/package.json: devDep link
- packages/kmh-junji/src/kongming-integration.ts: 新工具与释放管理
- test/kongming-integration.test.mjs（新增）: ② 全部用例

## ④ 验证结果

### 测试输出

```
$ pnpm test   （pretest: build；node --test 全量）
✔ tool_registered：工具集包含 junji_send
✔ send_happy_path：就绪会话后投递 kmh-relay 消息并返回回执
✔ send_agent_not_found：大臣不存在时报错且不投递
✔ send_blank_content：空白正文报错
✔ send_source_inactive：挂载释放后工具拒绝执行
✔ send_flow_combo：发送→作答→回传孔明一次（真 sendAndWatch 链路）
✔ send_release_tracked：挂载释放清理轮次监听
ℹ tests 17  pass 17  fail 0   （新增 7 + 既有 10）
```

TDD 红→绿记录：断言先写（7/7 红，失败点为工具集无 junji_send）；实现一次到位。中途修过三处测试自身问题：makeRuntime 返回字面量自引用未定义、fake ctx 缺 targets 表、fake `ctx.effect` 未按「工厂返回清理函数」语义处理（另两处断言按真实机制修正：释放后拒绝来自 lifetime 信号中止而非 agents.get 检查；宿主级 ctx.on 监听由插件生命周期清理，fake 按「监听数差值」断言）。实现侧另做 tsconfig `paths` 归一（与 kongming 同款，解决 session-kit registry 版同侪依赖与本地 DSH 的 cordis 双实体类型冲突）。

### 不变量回归

```
$ pnpm typecheck   （host + browser 双 tsconfig）  无错误
$ pnpm build                                          无错误
$ pnpm test                                            既有 10 项全绿（含 memory/registry 回归）
```

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内（仅工具新增与 devDep/paths 配置，runtime 未动）
- [x] 不变量未破坏
