/**
 * 输入为已构建的军机阁和相邻的 session-kit，输出可由 DeepSeek Harness 安装的 .tgz。
 * 构建、解析依赖或打包失败时退出非零，不使用残缺产物。
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "packages/kmh-junji");
const require = createRequire(join(plugin, "package.json"));
const { build } = require("esbuild");
const destination = resolve(process.argv[2] ?? join(root, "dist"));
const staging = await mkdtemp(join(tmpdir(), "kmh-junji-release-"));
const officialDshVersion = "0.2.2-rc.2";

try {
  const manifest = JSON.parse(await readFile(join(plugin, "package.json"), "utf8"));
  // 发行清单采用已验证的官方宿主版本，KMH 源码开发仍沿用原清单。
  const { scripts, devDependencies, ...release } = manifest;
  release.engines = { dsh: officialDshVersion };
  for (const name of Object.keys(release.peerDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) {
      release.peerDependencies[name] = officialDshVersion;
    }
  }
  release.peerDependencies["@deepseek-ai/cordis"] = "4.1.0";
  release.peerDependencies["@deepseek-ai/schemastery"] = "3.19.0";
  await cp(join(plugin, "lib"), join(staging, "lib"), { recursive: true });
  await cp(join(plugin, "cordis.patch.yml"), join(staging, "cordis.patch.yml"));
  await cp(join(root, "LICENSE"), join(staging, "LICENSE"));
  await cp(join(plugin, "README.md"), join(staging, "README.md"));

  // 发行包内联会话互通逻辑，DSH 与 zod 仍走宿主及正常依赖解析。
  await build({
    entryPoints: [join(plugin, "lib/src/kongming-integration.js")],
    outfile: join(staging, "lib/src/kongming-integration.js"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["./protocol/index.js", "@deepseek-ai/*", "zod"],
    legalComments: "inline",
  });

  await writeFile(join(staging, "package.json"), JSON.stringify(release, null, 2) + "\n");
  await mkdir(destination, { recursive: true });
  const filename = join(destination, "kmh-junji.tgz");
  execFileSync("pnpm", ["pack", "--out", filename], { cwd: staging, stdio: "inherit" });
} finally {
  await rm(staging, { recursive: true, force: true });
}
