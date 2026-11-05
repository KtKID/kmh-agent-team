/** 军机阁记忆配置；模板必须包含三个变量，默认文案沿用 kongming-memory-v1 安装补丁。 */
import Schema from "@deepseek-ai/schemastery";

export const MemoryConfig = Schema.object({
  promptTemplate: Schema.string()
    .pattern(
      /^(?=.*\{\{originalMemoryPath\}\})(?=.*\{\{frozenMemoryPath\}\})(?=.*\{\{frozenMemory\}\})/s,
    )
    .default(
      [
        "原始记忆文件：{{originalMemoryPath}}",
        "冻结记忆文件：{{frozenMemoryPath}}",
        "以下为当前完整冻结记忆：",
        "<junji-memory>",
        "{{frozenMemory}}",
        "</junji-memory>",
      ].join("\n"),
    ),
  reminderPrompt: Schema.string().default(
    [
      "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里",
      "当前普通任务已经收尾，请检查本轮值得长期保留的偏好、决策和踩坑。通过通用 read/write/edit 读取并更新原始记忆，保留已有条目、合并重复内容，新要求更新对应旧条目；寒暄与重复信息保持已有记录。",
      "原始记忆文件：{{originalMemoryPath}}",
      "冻结记忆文件：{{frozenMemoryPath}}",
      "新记忆写入原始文件，冻结文件由插件维护。实际保存成功后确认，失败时说明原因。",
    ].join("\n"),
  ),
});

export type MemoryConfig = ReturnType<typeof MemoryConfig>;
