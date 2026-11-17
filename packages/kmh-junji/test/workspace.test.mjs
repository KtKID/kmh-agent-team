/** 军机阁工作区行为测试：AGENTS.md 独占创建、既有内容不被覆盖、软连接扫描与提示词约定。 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureWorkspaceDoc,
  readWorkspaceLinks,
  renderWorkspaceConvention,
  renderWorkspaceDoc,
  WORKSPACE_DOC_NAME,
} from "../lib/src/workspace.js";

/** 建一个临时工作区，测试结束自动清理。 */
async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "junji-workspace-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("T1：目录与地图缺失时创建，正文含软连接表与维护规则", async () => {
  const parent = await mkdtemp(join(tmpdir(), "junji-parent-"));
  const root = join(parent, "agent-team");
  try {
    const status = await ensureWorkspaceDoc(root);
    assert.equal(status, "created");
    const text = await readFile(join(root, WORKSPACE_DOC_NAME), "utf8");
    assert.match(text, /军机阁工作区/);
    assert.match(text, /项目软连接/);
    assert.match(text, /负责人/);
    assert.match(text, /不要自己 `ln -s`/);
    assert.match(text, /--follow/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("T2：地图已存在时不覆盖，返回 present 且内容与时间戳不变", async () => {
  await withRoot(async (root) => {
    const file = join(root, WORKSPACE_DOC_NAME);
    const custom = "# 我自己写的\n\n| 软连接 | 负责人 |\n|---|---|\n| kmh-game-lab | 游艺监 |\n";
    await writeFile(file, custom, "utf8");
    const before = await readFile(file, "utf8");

    assert.equal(await ensureWorkspaceDoc(root), "present");
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal(await ensureWorkspaceDoc(root), "present");
    assert.equal(await readFile(file, "utf8"), before);
  });
});

test("T3：扫描软连接——只收软连接、跳过断链、按名字排序", async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, "普通目录"));
    await writeFile(join(root, "普通文件.md"), "x", "utf8");
    const projectA = join(root, "真实项目A");
    const projectB = join(root, "真实项目B");
    await mkdir(projectA);
    await mkdir(projectB);
    await symlink(projectB, join(root, "zeta"));
    await symlink(projectA, join(root, "alpha"));
    await symlink(join(root, "不存在"), join(root, "broken"));

    const links = await readWorkspaceLinks(root);
    assert.deepEqual(
      links.map((link) => link.name),
      ["alpha", "zeta"],
    );
    assert.equal(links[0].target, projectA);
    assert.equal(links[1].target, projectB);
  });
});

test("T4：目录缺失时扫描返回空表，不抛错", async () => {
  const missing = join(tmpdir(), "junji-workspace-missing-does-not-exist");
  assert.deepEqual(await readWorkspaceLinks(missing), []);
});

test("T5：提示词约定只列软连接名，不含任何本机绝对路径，空表时给出退化说明", async () => {
  await withRoot(async (root) => {
    const empty = renderWorkspaceConvention([]);
    assert.match(empty, /## 工作区/);
    assert.match(empty, /当前没有接入任何项目软连接/);
    assert.match(empty, /不要删除、移动或替换软连接/);
    // 回归护栏：工作区绝对路径不得进入注入文本（会把用户名与盘符带进每轮上下文）
    assert.ok(!empty.includes(root), "约定不得包含工作区绝对路径");

    const target = "/tmp/kmh-game-lab";
    const withLinks = renderWorkspaceConvention([
      { name: "kmh-game-lab", target },
    ]);
    assert.match(withLinks, /`kmh-game-lab\/`/);
    assert.match(withLinks, /AGENTS\.md/);
    assert.match(withLinks, /readlink/);
    // 回归护栏：软连接真实目标不得进入注入文本（换设备即失效，且属路径外泄）
    assert.ok(!withLinks.includes(target), "约定不得包含软连接真实路径");
    assert.ok(!withLinks.includes(root), "约定不得包含工作区绝对路径");
  });
});

test("T7：地图模板只记门牌与归属，不写死任何本机路径", () => {
  const doc = renderWorkspaceDoc();
  assert.match(doc, /\| 软连接 \| 一句话简介 \| 负责人 \|/);
  assert.match(doc, /ls -l/);
  assert.ok(!doc.includes("/Volumes/"), "模板不得出现某台机器的盘符路径");
  assert.ok(!doc.includes("/Users/"), "模板不得出现某台机器的用户目录");
  assert.ok(!doc.includes("| 本机真实路径 |"), "模板不得保留真实路径列");
});

test("T6：模板自带说明不被约定文案改写（两次渲染一致）", () => {
  assert.equal(renderWorkspaceDoc(), renderWorkspaceDoc());
});
