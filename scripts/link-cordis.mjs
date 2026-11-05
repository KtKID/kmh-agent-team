/**
 * 手工把 vendored cordis 链接进包内 node_modules。
 * cordis 是唯一带 bin 的 link 依赖；pnpm 安装时会对 link 依赖的 bin 源文件执行
 * chmod，该文件位于工作区外的只读 DSH checkout，被文件沙箱拒绝（EPERM）。
 * 因此 cordis 不进 devDependencies（peer 声明保留），由本脚本在安装后建符号链接。
 */
import { mkdir, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgDir = fileURLToPath(new URL("../packages/kmh-junji", import.meta.url));
const target = join(pkgDir, "node_modules/@deepseek-ai/cordis");
const source = join(pkgDir, "../../../kongming-os/third_party/dsh/vendor/cordis");

await mkdir(dirname(target), { recursive: true });
try {
  await symlink(source, target, "dir");
  console.log("linked @deepseek-ai/cordis ->", source);
} catch (error) {
  if (error instanceof Error && error.code === "EEXIST") {
    console.log("link @deepseek-ai/cordis already present");
  } else {
    throw error;
  }
}
