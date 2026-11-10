# kmh-agent-team · 军机阁

基于 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的用户自建 agent 团队插件仓库。核心包为 **@kmh/kmh-junji（军机阁）**：用户创建多个「大臣」agent，每个 agent 一对一永久绑定一个 DSH session，拥有独立记忆小本子，侧边栏「军机阁」区块统一管理。

## 功能

- **大臣管理**：名字 + 系统提示词 + 模型目录，创建/编辑弹层（宿主 Modal 原语 + 真实主题 token）。
- **一对一专属会话**：agent↔session 创建时绑定，此后不换；persona 与模型按 `agent.json` 每次请求注入。
- **per-agent 记忆**：复用 kongming-memory-v1 双文件机制（`MEMORY.md` 原始小本子 + `MEMORY.frozen.md` 冻结记忆）——创建时初始化发布冻结、装配时注入冻结正文、收尾提醒记小本子、手动 /compact 成功后原子刷新冻结。
- **侧边栏区块**：军机阁 agent 列表 + 启动行，点击进入该 agent 的专属会话。

## 仓库结构

```
kmh-agent-team/
  packages/kmh-junji/    ← @kmh/kmh-junji 插件包（host Cordis 插件 + client React UI）
  scripts/link-dsh.mjs   ← postinstall：运行时定位 kongming-os 并链接 DSH 同侪依赖
  docs/                  ← 技术设计与验证记录
```

## 开发

前置：本地的 [kongming-os](https://github.com/KtKID/kongming-os) checkout（含 `third_party/dsh`）。

```bash
pnpm install          # postinstall 自动探测 kongming-os；探测不到时设 KONGMING_OS_DIR 指向其仓库根
pnpm typecheck        # host + browser 双 tsconfig
pnpm test             # 先 build 再跑 node:test
pnpm build            # esbuild 双面构建（host lib + client bundle）
```

DSH 同侪依赖不在 devDependencies 写死 `link:` 路径：`scripts/link-dsh.mjs` 按 `KONGMING_OS_DIR` → 逐级向上探测的顺序定位 kongming-os，幂等符号链接进包内 node_modules；版本面以 peerDependencies 为准。

## 集成

通过 pnpm `link:` 挂进 kongming-os 的 `kmh-web` profile（dependencies + `dsh.profile.bundles` + `dsh.bundle.patch`），详见 [docs/tech-design.md](docs/tech-design.md)。

## 验证

隔离环境 E2E 全链路（创建/绑定/真实对话/记忆/压缩刷新/重启恢复/双 agent 隔离）与浏览器级 CDP 验证均已通过，见 [docs/verification-20261106.md](docs/verification-20261106.md)。

## License

[MIT](LICENSE)
