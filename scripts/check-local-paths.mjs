#!/usr/bin/env node
/**
 * 提交脱敏检查：确保入库文本不含本机绝对路径。
 *
 * 检测三类真实路径：用户目录（斜杠 Users 加用户名）、挂载卷（斜杠 Volumes 加卷名）、
 * homebrew 工具链目录。只写 POSIX 根标记或用省略号占位（如 `…`、`...`）不算命中，
 * 所以测试断言里的裸标记与文档里的示意写法都能通过。
 * 用法：`node scripts/check-local-paths.mjs`（查全部入库文件）
 *       `node scripts/check-local-paths.mjs --staged`（只查暂存区）
 * 命中时逐条打印并以退出码 1 结束。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 路径段：至少含一个字母或数字，纯点号（省略号占位）不算。 */
const SEGMENT = String.raw`(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]+`;
const PATTERNS = [
  { re: new RegExp(String.raw`/Users/${SEGMENT}`, "g"), hint: "用户目录" },
  { re: new RegExp(String.raw`/Volumes/${SEGMENT}`, "g"), hint: "挂载卷路径" },
  {
    re: new RegExp("/opt/homebrew/[A-Za-z0-9][^\\s\"'`]*", "g"),
    hint: "本机工具链路径",
  },
];
const BINARY = /\.(png|jpe?g|gif|ico|icns|webp|pdf|woff2?|ttf|zip|zst)$/i;

const staged = process.argv.includes("--staged");
const args = staged
  ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"]
  : ["ls-files"];
const files = execFileSync("git", args, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => !BINARY.test(file));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { re, hint } of PATTERNS) {
    re.lastIndex = 0;
    const matched = text.match(re);
    if (matched !== null && matched.length > 0) {
      const uniq = [...new Set(matched)].slice(0, 3).join("、");
      hits.push(`${file} → ${hint}：${uniq}`);
    }
  }
}

if (hits.length > 0) {
  console.error("发现本机绝对路径，入库前必须脱敏：");
  for (const hit of hits) console.error(` - ${hit}`);
  console.error("\n改法：路径换成 <repo> / <proj> / <home> 等占位符，或改成相对路径。");
  process.exit(1);
}
console.log(`已检查 ${files.length} 个文件，未发现本机绝对路径。`);
