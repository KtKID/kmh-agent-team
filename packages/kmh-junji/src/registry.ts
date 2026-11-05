/** 军机阁 agent 注册表：每个 agent 一个独立目录，agent.json 全部原子写入。 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentRecordSchema,
  type AgentRecord,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "./protocol/index.ts";

const RECORD_FILE = "agent.json";

/** @param error - I/O 异常。 @param code - 预期系统错误码。 @returns 错误码是否匹配。 */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * 由名字生成目录安全的 agentId：NFC 规范化，空白与分隔符折叠为 -，
 * 剔除路径危险字符与控制字符，限长 64；结果为空或 `.`/`..` 时回退 `agent`。
 * @param name - 用户输入的 agent 名字。
 * @returns 稳定 slug（未去重）。
 */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .normalize("NFC")
    .replace(/[\s/\\]+/g, "-")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug === "" || slug === "." || slug === ".." ? "agent" : slug;
}

/** 目录扫描结果：有效档案与被跳过的损坏目录。 */
export interface StoreList {
  readonly records: readonly AgentRecord[];
  readonly invalid: readonly { id: string; reason: string }[];
}

/** 军机阁根目录下全部 agent 档案的所有者。 */
export class AgentStore {
  /**
   * @param root - 军机阁根目录（`<dsh-home>/agent-team`）。
   */
  constructor(readonly root: string) {}

  /** @param id - agent 稳定标识。 @returns 该 agent 的独立目录。 */
  dir(id: string): string {
    return join(this.root, id);
  }

  /** 扫描根目录；单个目录损坏只跳过并上报原因，不阻塞其余 agent。 */
  async list(): Promise<StoreList> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return { records: [], invalid: [] };
      throw error;
    }
    const records: AgentRecord[] = [];
    const invalid: { id: string; reason: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const text = await readFile(
          join(this.root, entry.name, RECORD_FILE),
          "utf8",
        );
        records.push(AgentRecordSchema.parse(JSON.parse(text)));
      } catch (error) {
        invalid.push({ id: entry.name, reason: String(error) });
      }
    }
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { records, invalid };
  }

  /**
   * 独占创建新 agent：slug 去重（重名追加 -2/-3）、建目录、写入 reserved 档案。
   * 写入本身原子（同目录临时文件 + rename）。
   * @param input - 已校验的创建输入。
   * @returns reserved 状态的档案，sessionId 已生成。
   */
  async reserve(input: CreateAgentInput): Promise<AgentRecord> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const taken = new Set((await this.list()).records.map((r) => r.id));
    const base = slugify(input.name);
    let id = base;
    let suffix = 2;
    while (taken.has(id)) id = `${base}-${suffix++}`;
    const now = new Date().toISOString();
    const record: AgentRecord = {
      version: 1,
      id,
      name: input.name,
      systemPrompt: input.systemPrompt,
      model: input.model,
      sessionId: randomUUID(),
      phase: "reserved",
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(this.dir(id), { recursive: true, mode: 0o700 });
    await this.write(record);
    return record;
  }

  /**
   * 档案完成（phase → ready）或字段更新后的原子落盘。
   * @param record - 完整档案。
   */
  async commit(record: AgentRecord): Promise<void> {
    await this.write(record);
  }

  /**
   * 读单个档案。
   * @param id - agent 稳定标识。
   * @throws 目录缺失或内容损坏时失败并附路径。
   */
  async read(id: string): Promise<AgentRecord> {
    const filename = join(this.dir(id), RECORD_FILE);
    const text = await readFile(filename, "utf8");
    try {
      return AgentRecordSchema.parse(JSON.parse(text));
    } catch (error) {
      throw Error(`军机阁档案损坏，请检查 ${filename}：${String(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * 合并更新字段并原子落盘。
   * @param id - agent 稳定标识。
   * @param patch - 已校验的更新输入。
   * @returns 更新后的完整档案。
   */
  async update(id: string, patch: UpdateAgentInput): Promise<AgentRecord> {
    const record = await this.read(id);
    const next: AgentRecord = {
      ...record,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.systemPrompt === undefined
        ? {}
        : { systemPrompt: patch.systemPrompt }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    return next;
  }

  /**
   * 删除 agent 目录（含记忆文件）；会话文件不在其中，保留不受影响。
   * @param id - agent 稳定标识。
   */
  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /** 校验后原子写入；临时文件同目录，失败保留原档案。 */
  private async write(record: AgentRecord): Promise<void> {
    AgentRecordSchema.parse(record);
    const filename = join(this.dir(record.id), RECORD_FILE);
    const temporary = join(this.dir(record.id), `.agent-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
