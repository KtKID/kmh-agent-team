/** 军机阁记忆文件：位于 agent 独立目录，准备时按需独占或重发完整快照，刷新走同目录临时文件原子替换。 */
import { randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { MemoryFiles } from "./types.ts";

/** @param error - I/O 异常。 @param code - 预期系统错误码。 @returns 错误码是否匹配。 */
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * @param agentDir - agent 独立目录的绝对路径。
 * @returns 该 agent 的两份记忆文件路径（MEMORY.md / MEMORY.frozen.md）。
 * @throws 目录为相对路径时失败。
 */
export function resolveMemoryFiles(agentDir: string): MemoryFiles {
  if (!isAbsolute(agentDir)) throw Error("军机阁 agent 目录需要绝对路径");
  return {
    original: join(agentDir, "MEMORY.md"),
    frozen: join(agentDir, "MEMORY.frozen.md"),
  };
}

/** 首次补齐空原始文件；冻结缺失时独占发布，已有时原始非空即完整重发、原始为空保留既有冻结。 */
export async function initializeMemoryFiles(
  files: MemoryFiles,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await mkdir(dirname(files.original), { recursive: true, mode: 0o700 });
  try {
    await writeFile(files.original, "", { flag: "wx", mode: 0o600, signal });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  let initial = false;
  try {
    await access(files.frozen);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    initial = true;
  }
  if (!initial && (await stat(files.original)).size === 0) return;
  await publish(files, initial, signal);
}

/**
 * @returns 当前冻结文件完整 UTF-8 正文。
 * @throws 读取失败时附完整路径，文件保持原样。
 */
export async function readFrozenFile(
  files: MemoryFiles,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await readFile(files.frozen, { encoding: "utf8", signal });
  } catch (error) {
    throw Error(`冻结记忆读取失败 ${files.frozen}：${String(error)}`, {
      cause: error,
    });
  }
}

/**
 * 将本次读取的完整原始字节发布为冻结版本。
 * @throws 读取、写入或发布失败均保留完整旧冻结并传播。
 */
export async function replaceFrozenFile(
  files: MemoryFiles,
  signal?: AbortSignal,
): Promise<void> {
  await publish(files, false, signal);
}

/** 同目录临时文件完整写入后发布；首次使用独占 link，刷新使用 rename，最后清理临时路径。 */
async function publish(
  files: MemoryFiles,
  initial: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = join(dirname(files.frozen), `.memory-${randomUUID()}.tmp`);
  try {
    const bytes = await readFile(files.original, { signal });
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600, signal });
    signal?.throwIfAborted();
    if (initial) {
      try {
        await link(temporary, files.frozen);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    } else {
      await rename(temporary, files.frozen);
    }
  } catch (error) {
    throw Error(
      `冻结记忆发布失败 ${files.original} → ${files.frozen}：${String(error)}`,
      { cause: error },
    );
  } finally {
    await rm(temporary, { force: true });
  }
}
