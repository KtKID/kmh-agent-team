/** 验证军机阁源码清单、补丁登记和浏览器模块拥有相同包名。 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** 读取插件目录中的补丁和客户端产物，包名不一致时抛出错误。 */
export async function validateReleaseName(plugin, manifest) {
  const { name } = manifest;
  const patchPath = manifest.dsh.bundle.patch;
  const patch = await readFile(join(plugin, patchPath), "utf8");
  const patchName = patch.match(/^[ \t]+name:[ \t]*"([^"\r\n]+)"[ \t]*\r?$/m)?.[1];
  if (patchName !== name) throw new Error(`${patchPath} 的插件登记名应为 ${name}`);

  const clientPath = manifest.exports["./client"].default;
  const client = await readFile(join(plugin, clientPath), "utf8");
  if (!client.startsWith(`window.__ModuleLoader__.load({id:${JSON.stringify(name)},`)) {
    throw new Error(`${clientPath} 的模块 ID 应为 ${name}，请重新构建军机阁`);
  }
}
