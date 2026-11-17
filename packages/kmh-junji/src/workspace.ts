/** 军机阁工作区：项目软连接的现场读取、AGENTS.md 地图的就绪，以及注入大臣提示词的工作区约定。 */
import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

/** 工作区地图文件名；DSH 会把工作目录下的这份文件注入会话上下文。 */
export const WORKSPACE_DOC_NAME = "AGENTS.md";

/** 工作区里的一条项目软连接。 */
export interface WorkspaceLink {
  /** 软连接名（即大臣看到的相对路径首段）。 */
  readonly name: string;
  /** 软连接指向的真实绝对路径。 */
  readonly target: string;
}

/**
 * @returns 首次创建时写入的地图正文；只在文件缺失时落盘，已存在的内容一律不动。
 */
export function renderWorkspaceDoc(): string {
  return `# AGENTS.md — 军机阁工作区

这是军机阁大臣共用的工作目录。项目本体不在这里，要用的项目以软连接挂在本目录下。

## 项目软连接

| 软连接 | 一句话简介 | 负责人 |
|---|---|---|
| — | 尚未接入项目 | — |

> 只记门牌与归属，不记真实路径：要指向哪里，用 \`ls -l <软连接名>\` 现查。换设备时重建软连接即可，这份表不用改。

## 使用软连接的注意

- 递归搜索要跟随软连接（ripgrep 加 \`--follow\`）；直接读 \`<软连接>/某个文件\` 不受影响。
- 不要删除、移动或替换软连接本身。
- 路径被解析成真实绝对路径属于正常现象。

## 维护规则

- 接入新项目：先报孔明，由孔明在工作区建软连接，不要自己 \`ln -s\`。
- 接入时在「项目软连接」表追加一行：软连接名、一句话简介、负责人。
- 只追加或修改与自己有关的行；不要整份重写，不要删除别人的行。
`;
}

/**
 * 确保工作区目录与地图文件就绪：目录缺失时创建，地图缺失时写入模板。
 * 已存在的地图一律不改写，避免覆盖用户或大臣维护的内容。
 * @param root - 军机阁工作区根目录。
 * @returns `created` 表示本次写入新地图，`present` 表示已存在未改动。
 */
export async function ensureWorkspaceDoc(
  root: string,
): Promise<"created" | "present"> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(root, WORKSPACE_DOC_NAME), renderWorkspaceDoc(), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "present";
    throw error;
  }
}

/**
 * 读取工作区里现有的项目软连接；目录缺失或单项读不出时返回空表，不影响装配。
 * @param root - 军机阁工作区根目录。
 * @returns 按名字排序的软连接表。
 */
export function readWorkspaceLinksSync(root: string): WorkspaceLink[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const links: WorkspaceLink[] = [];
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const name = entry.name;
    try {
      const target = readlinkSync(join(root, name));
      // 断链（目标不存在）不进入约定：否则大臣会被告知有一个打不开的项目。
      statSync(join(root, name));
      links.push({ name, target });
    } catch {
      // 断链等异常项跳过：约定说明不因单个软连接失效而中断。
    }
  }
  links.sort((left, right) => left.name.localeCompare(right.name));
  return links;
}

/**
 * 同步扫描结果的事件循环友好包装：装配提示词时避免在注册段前插入 await。
 * @param root - 军机阁工作区根目录。
 * @returns 按名字排序的软连接表。
 */
export async function readWorkspaceLinks(
  root: string,
): Promise<WorkspaceLink[]> {
  return readWorkspaceLinksSync(root);
}

/**
 * 生成追加到大臣人格提示词末尾的工作区约定：当前软连接名、用法与地图维护规则。
 *
 * 刻意只写「门牌」不写「地址」：注入文本里不出现任何本机绝对路径（工作区根目录与软连接
 * 的真实目标都不写），否则会把使用者的用户名、盘符与项目位置带进每轮上下文，换设备后还会
 * 变成错的。真实路径用时现查（`ls -l` / `readlink`）或看本机地图。
 * @param links - `readWorkspaceLinks` 的结果。
 * @returns 约定正文；提示词为空时不依赖它也能独立读懂。
 */
export function renderWorkspaceConvention(
  links: readonly WorkspaceLink[],
): string {
  const list =
    links.length === 0
      ? "- 当前没有接入任何项目软连接；需要项目文件时报给孔明。"
      : links.map((link) => `- \`${link.name}/\``).join("\n");
  return `## 工作区（军机阁自动注入）

- 你当前的工作目录就是军机阁工作区（用 \`pwd\` 确认）。项目本体不在这个目录里，通过下面的软连接访问：
${list}
- 这里只写软连接名，不写目标路径：要指向哪里，用 \`ls -l <名字>\` 或 \`readlink <名字>\` 现查。
- 工作区下的 \`${WORKSPACE_DOC_NAME}\` 是项目地图与负责人表（本机真实路径记在那一份里）。DSH 会把它的内容注入你的上下文；看不到时先读一遍再动手。
- 用软连接时：递归搜索要跟随软连接（ripgrep 加 \`--follow\`）；直接读 \`<软连接>/某个文件\` 不受影响；不要删除、移动或替换软连接本身；路径被解析成真实绝对路径属正常。
- 接入新项目不要自己 \`ln -s\`，先报孔明；更新地图只追加或修改自己负责的行，不整份重写、不删别人的行。`;
}
