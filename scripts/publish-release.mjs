/**
 * 组装并发布军机阁发行包。包名和版本取自源码清单，发行清单沿用线上 latest 的
 * 宿主兼容范围、导出等字段，打包文件清单和构建产物取自本仓库。
 *
 * 用法：
 *   node scripts/publish-release.mjs            只打包到 dist/，打印 tarball 路径
 *   node scripts/publish-release.mjs --publish  打包并 npm publish
 *
 * 失败（构建产物缺失、取不到模板清单、打包或发布失败）时退出非零，不留下残缺产物。
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { validateReleaseName } from "./validate-release-name.mjs";

/** 发行清单保留的字段；逐一取自线上最新版，避免遗漏。 */
const MANIFEST_KEYS = [
  "description",
  "license",
  "type",
  "engines",
  "peerDependencies",
  "peerDependenciesMeta",
  "dependencies",
  "exports",
  "dsh",
  "icon",
];

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "packages/kmh-junji");
const require = createRequire(join(plugin, "package.json"));
const { build } = require("esbuild");
const publish = process.argv.includes("--publish");
const destination = resolve(root, "dist");
const staging = await mkdtemp(join(tmpdir(), "kmh-junji-release-"));

try {
  const local = JSON.parse(await readFile(join(plugin, "package.json"), "utf8"));
  const { name, version } = local;
  await validateReleaseName(plugin, local);
  const latest = JSON.parse(
    execFileSync("npm", ["view", `${name}@latest`, "--json"], {
      encoding: "utf8",
    }),
  );
  if (latest.name !== name)
    throw new Error(`线上清单的包名应为 ${name}`);
  if (latest.version === version)
    throw Error(`发行版本 ${version} 与线上最新版相同，先升版本再发布`);

  const release = { name, version, files: local.files };
  for (const key of MANIFEST_KEYS)
    if (latest[key] !== undefined) release[key] = latest[key];

  await cp(join(plugin, "lib"), join(staging, "lib"), { recursive: true });
  await cp(join(plugin, local.icon), join(staging, local.icon));
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

  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(release, null, 2) + "\n",
  );
  await mkdir(destination, { recursive: true });
  const filename = join(destination, "kmh-junji.tgz");
  await rm(filename, { force: true });
  execFileSync("pnpm", ["pack", "--out", filename], {
    cwd: staging,
    stdio: "inherit",
  });
  console.log(`tarball: ${filename}`);

  if (publish) {
    execFileSync("npm", ["publish", filename, "--access", "public"], {
      stdio: "inherit",
    });
    console.log(`published ${name}@${version}`);
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
