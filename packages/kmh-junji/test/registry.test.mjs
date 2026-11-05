/** 军机阁注册表行为测试：slug 生成与档案 CRUD 的原子性基础。 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentStore, slugify } from "../lib/src/registry.js";
import { CreateAgentInputSchema } from "../lib/src/protocol/index.js";

const INPUT = CreateAgentInputSchema.parse({
  name: "司马懿",
  systemPrompt: "你是司马懿，谨慎隐忍的谋士。",
  model: { provider: "deepseek", model: "deepseek-chat" },
});

test("slugify 保留中日韩名字并折叠空白与分隔符", () => {
  assert.equal(slugify("司马懿"), "司马懿");
  assert.equal(slugify("  My   Agent "), "My-Agent");
  assert.equal(slugify("a/b\\c"), "a-b-c");
  assert.equal(slugify('x<>:"|?*y'), "xy");
  assert.equal(slugify("---"), "agent");
  assert.equal(slugify(""), "agent");
  assert.equal(slugify(".."), "agent");
  assert.equal(slugify(" 计 士 "), "计-士");
});

test("reserve 落盘 reserved 档案并可 list 读回", async () => {
  const root = await mkdtemp(join(tmpdir(), "junji-"));
  try {
    const store = new AgentStore(root);
    const record = await store.reserve(INPUT);
    assert.equal(record.phase, "reserved");
    assert.equal(record.id, "司马懿");
    assert.ok(record.sessionId.length > 10);
    const listed = await store.list();
    assert.equal(listed.records.length, 1);
    assert.equal(listed.records[0].id, "司马懿");
    assert.equal(listed.invalid.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("重名 reserve 追加后缀去重，永不覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "junji-"));
  try {
    const store = new AgentStore(root);
    const first = await store.reserve(INPUT);
    const second = await store.reserve(INPUT);
    assert.notEqual(first.id, second.id);
    assert.equal(second.id, "司马懿-2");
    assert.equal((await store.list()).records.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update 合并字段并原子替换；remove 连目录移除", async () => {
  const root = await mkdtemp(join(tmpdir(), "junji-"));
  try {
    const store = new AgentStore(root);
    const record = await store.reserve(INPUT);
    const updated = await store.update(record.id, {
      name: "仲达",
      systemPrompt: "你是仲达。",
    });
    assert.equal(updated.name, "仲达");
    assert.equal(updated.systemPrompt, "你是仲达。");
    assert.equal(updated.sessionId, record.sessionId);
    const text = await readFile(
      join(root, record.id, "agent.json"),
      "utf8",
    );
    assert.equal(JSON.parse(text).name, "仲达");
    await store.remove(record.id);
    const listed = await store.list();
    assert.equal(listed.records.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("损坏档案目录跳过并上报，不阻塞其余 agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "junji-"));
  try {
    const store = new AgentStore(root);
    await store.reserve(INPUT);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "agent.json"), "{ not json");
    const listed = await store.list();
    assert.equal(listed.records.length, 1);
    assert.equal(listed.invalid.length, 1);
    assert.equal(listed.invalid[0].id, "broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
