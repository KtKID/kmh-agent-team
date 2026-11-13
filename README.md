# 军机阁

军机阁是 [DeepSeek Harness](https://www.deepseek.com/harness/) 的团队插件。你可以为写作、代码审阅、资料整理等工作创建专职助手（「大臣」），在侧栏统一管理。每位大臣有自己的模型、专属会话和记忆小本子。

## 安装

1. 从 [DeepSeek Harness 官网](https://www.deepseek.com/harness/) 获取 Harness，并打开侧栏「插件」→「添加插件」。
2. 将下面的预编译安装包地址粘贴到「包名或地址」，点击「安装」。
3. 安装完成后选择「立即启用」。侧栏出现「军机阁」即表示插件已加载。

```text
https://github.com/KtKID/kmh-agent-team/releases/latest/download/kmh-junji.tgz
```

当前安装包适配 DeepSeek Harness `0.2.2-rc.2`，已在该版本的 Web 界面验证。指定版本的安装包和变更记录见 [GitHub Releases](https://github.com/KtKID/kmh-agent-team/releases)。

## 创建第一位大臣

1. 在 Harness 登录 DeepSeek 账号或配置一个可用的模型。 [官方模型配置指南](https://deepseek-harness.github.io/deepseek-harness/guide/providers)
2. 打开侧栏「军机阁」，点击右上角「+」。名字填「文档助手」，系统提示词填「你负责把会议笔记整理成待办清单」，然后选一个可用模型。
3. 点击「创建」。进入文档助手的专属会话后，发送「把这两条会议笔记整理成待办：周三发初稿，周五收反馈」，应收到待办清单。下次从军机阁点开这位大臣，会回到同一会话。

## 功能

- **专属会话与记忆**。为每位大臣设置职责和模型，使用独立的小本子记录长期信息。
- **成员管理**。随时修改名字、提示词和模型。删除成员会停止其任务、归档会话，并移除成员档案和记忆。聊天历史仍可从归档中查看。
- **孔明联动**。同时启用孔明插件时，孔明可以把任务发给指定大臣，并在大臣回复后自动收到结果。

## 从源码开发

军机阁包名为 `@kmh/kmh-junji`。开发使用 Node.js 24.9+ 和 pnpm，需要本地 `kongming-os`（已初始化并构建 DSH）以及位于本仓库同级目录的 `kmh-session-kit`。先在 `kmh-session-kit` 安装依赖并运行 `pnpm build`，再在本仓库运行：

```sh
pnpm install
pnpm typecheck
pnpm test
node scripts/pack-release.mjs
```

`pnpm test` 会先构建军机阁。打包命令生成 `dist/kmh-junji.tgz`，包含预编译的宿主模块、浏览器模块和插件配置。可将文件的绝对路径填入 Harness 的「添加插件」进行本地验证。

开发配置和孔明工具见 [包文档](packages/kmh-junji/README.md)，本地 KMH 接入见 [技术设计](docs/tech-design.md#6-集成与加载)。问题反馈请提交到 [GitHub Issues](https://github.com/KtKID/kmh-agent-team/issues)。

## 许可证

[MIT](LICENSE)
