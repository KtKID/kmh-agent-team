/** 军机阁记忆文件行为测试：初始化发布、冻结读取与压缩后原子刷新。 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  initializeMemoryFiles,
  readFrozenFile,
  replaceFrozenFile,
  resolveMemoryFiles,
} from "../lib/src/memory/files.js";

test("resolveMemoryFiles 落在 agent 独立目录", () => {
  const files = resolveMemoryFiles("/tmp/agent-team/sima");
  assert.equal(files.original, "/tmp/agent-team/sima/MEMORY.md");
  assert.equal(files.frozen, "/tmp/agent-team/sima/MEMORY.frozen.md");
  assert.throws(() => resolveMemoryFiles("relative/path"));
});

test("首次初始化：原始为空文件，冻结缺失时发布空冻结", async () => {
  const dir = await mkdtemp(join(tmpdir(), "junji-mem-"));
  try {
    const files = resolveMemoryFiles(dir);
    await initializeMemoryFiles(files);
    assert.equal(await readFile(files.original, "utf8"), "");
    assert.equal(await readFrozenFile(files), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("创建时已有原始内容则完整发布为冻结（创建时加载）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "junji-mem-"));
  try {
    const files = resolveMemoryFiles(dir);
    await writeFile(files.original, "# 小本子\n- 喜欢谨慎措辞", "utf8");
    await initializeMemoryFiles(files);
    assert.equal(await readFrozenFile(files), "# 小本子\n- 喜欢谨慎措辞");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("原始为空且冻结已有时保留既有冻结（不清空）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "junji-mem-"));
  try {
    const files = resolveMemoryFiles(dir);
    await writeFile(files.frozen, "旧冻结内容", "utf8");
    await initializeMemoryFiles(files);
    assert.equal(await readFrozenFile(files), "旧冻结内容");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("压缩刷新：完整原始字节原子替换冻结（压缩时加载）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "junji-mem-"));
  try {
    const files = resolveMemoryFiles(dir);
    await initializeMemoryFiles(files);
    await writeFile(files.original, "第一轮记录", "utf8");
    await replaceFrozenFile(files);
    assert.equal(await readFrozenFile(files), "第一轮记录");
    await writeFile(files.original, "第一轮记录\n第二轮记录", "utf8");
    await replaceFrozenFile(files);
    assert.equal(await readFrozenFile(files), "第一轮记录\n第二轮记录");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
