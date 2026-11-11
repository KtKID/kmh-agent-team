/**
 * 运行时定位 kongming-os，把 DSH 同侪依赖符号链接进包内 node_modules。
 *
 * 不在 devDependencies 里写死 `link:` 相对路径（仓库相对 kongming-os 的位置
 * 不稳定：可能是兄弟目录，也可能嵌套在 kongming-os/packages/ 下）；定位顺序：
 *   1. env KONGMING_OS_DIR（显式指定 kongming-os 仓库根）
 *   2. 自本仓库根逐级向上探测 <祖先>/kongming-os/third_party/dsh
 *   3. 祖先自身即是 kongming-os checkout（<祖先>/third_party/dsh）
 *
 * cordis 额外说明：它带 bin，若走 pnpm link 依赖会在安装时对工作区外只读 DSH
 * checkout 里的 bin 源文件执行 chmod（被文件沙箱拒绝 EPERM），因此也一并在此
 * 链接，版本面以 peerDependencies 声明为准。
 */
import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(repoRoot, "packages/kmh-junji");
const DSH_MARKER = "third_party/dsh/vendor/cordis/package.json";

/** dsh 同侪依赖 → kongming-os 内路径（相对 kongming-os 仓库根）。 */
const DSH_PACKAGES = {
  cordis: "vendor/cordis",
  schemastery: "vendor/schemastery",
  "dsh-agent": "packages/core/agent",
  "dsh-session": "packages/core/session",
  "dsh-home-paths": "packages/util/home-paths",
  "dsh-system-prompt": "packages/core/system-prompt",
  "dsh-tools": "packages/core/tools",
  "dsh-user-approval": "packages/interaction/user-approval",
  "dsh-workspace": "packages/workspace/workspace",
  "dsh-client-connection": "packages/client/connection",
  "dsh-api-session-controller": "packages/api/session-controller",
  "dsh-llm": "packages/llm/llm",
  "dsh-compaction": "packages/compaction/compaction",
  "dsh-commands": "packages/interaction/commands",
  "dsh-client-ui-slots": "packages/client/ui-slots",
  "dsh-client-ui-workspace": "packages/client/ui-workspace",
  "dsh-client-locale": "packages/client/locale",
  "dsh-client-ui-primitives": "packages/client/ui-primitives",
  "dsh-client-ui-session": "packages/client/ui-session",
  "dsh-client-store": "packages/client/store",
  "dsh-brand": "packages/util/brand",
  "dsh-client-ui-layout": "packages/client/ui-layout",
  "dsh-client-ui-sidebar": "packages/client/ui-sidebar",
  "dsh-client-ui-renderer": "packages/client/ui-renderer",
  // 删除会话回归使用真实执行循环、归档和本地持久化。
  "dsh-agent-loop-testkit": "packages/test-support/agent-loop-testkit",
  "dsh-session-persistence-jsonl": "packages/session/session-persistence-jsonl",
  "dsh-storage": "packages/storage/storage",
  "dsh-storage-json": "packages/storage/storage-json",
  "dsh-storage-domain": "packages/storage/storage-domain",
};

function findKongmingOs() {
  if (process.env.KONGMING_OS_DIR) {
    const root = resolve(process.env.KONGMING_OS_DIR);
    if (existsSync(join(root, DSH_MARKER))) return root;
    throw new Error(
      `KONGMING_OS_DIR=${root} 下未找到 ${DSH_MARKER}，请检查该目录是否为 kongming-os 仓库根`,
    );
  }
  for (let dir = repoRoot; ; dir = dirname(dir)) {
    const sibling = join(dir, "kongming-os");
    if (existsSync(join(sibling, DSH_MARKER))) return sibling;
    if (existsSync(join(dir, DSH_MARKER))) return dir; // 祖先自身即 kongming-os
    if (dirname(dir) === dir) break; // 文件系统根
  }
  return null;
}

/** 幂等建链：已是正确目标则跳过，指向错误（如搬迁后悬空）则替换。 */
async function ensureLink(target, source) {
  let stat;
  try {
    stat = await lstat(target);
  } catch {
    stat = null; // 不存在，直接建链
  }
  if (stat?.isSymbolicLink()) {
    if (resolve(dirname(target), await readlink(target)) === source) return "kept";
    await rm(target);
  } else if (stat) {
    throw new Error(
      `${target} 已存在且不是符号链接（疑似 pnpm 托管残留），请先 pnpm install 再重试`,
    );
  }
  await symlink(source, target, "dir");
  return "linked";
}

const kongmingOs = findKongmingOs();
if (!kongmingOs) {
  throw new Error(
    "未找到 kongming-os（探测 <祖先>/kongming-os/third_party/dsh 失败）。" +
      "请设置 KONGMING_OS_DIR 指向 kongming-os 仓库根后重跑 pnpm install。",
  );
}
console.log("kongming-os ->", kongmingOs);

await mkdir(join(pkgDir, "node_modules/@deepseek-ai"), { recursive: true });
for (const [name, relPath] of Object.entries(DSH_PACKAGES)) {
  const source = join(kongmingOs, "third_party/dsh", relPath);
  if (!existsSync(join(source, "package.json"))) {
    throw new Error(`kongming-os 内缺少 ${relPath}（${name}），DSH checkout 可能不完整`);
  }
  const target = join(pkgDir, `node_modules/@deepseek-ai/${name}`);
  const result = await ensureLink(target, source);
  if (result === "linked") console.log(`linked @deepseek-ai/${name} ->`, source);
}
console.log("dsh peer links ok");
