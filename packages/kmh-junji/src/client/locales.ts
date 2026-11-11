/** 军机阁客户端文案字典。 */
export const NS = "junji";

export const zh = {
  panel: "军机阁",
  retry: "重试",
  loadFailed: "军机阁暂时无法打开",
  empty: "军机阁还没有大臣，点右上角 + 招募第一位",
  createTitle: "创建大臣",
  editTitle: "编辑大臣",
  name: "名字",
  namePlaceholder: "给大臣起个名字",
  systemPrompt: "系统提示词",
  systemPromptPlaceholder: "描述这位大臣的身份、职责与行事风格……",
  model: "模型",
  submitCreate: "创建",
  submitSave: "保存",
  cancel: "取消",
  edit: "编辑",
  delete: "删除",
  confirmDelete: "确认删除",
  openFailed: "打开会话失败",
  requiredFields: "名字和系统提示词不能为空",
  currentModel: "当前模型",
  removeHint: "进行中的任务会被停止，会话归档并保留历史，记忆小本子一并移除",
} as const;

export type JunjiKey = keyof typeof zh;

export const en: Record<JunjiKey, string> = {
  panel: "War Council",
  retry: "Retry",
  loadFailed: "War Council could not be opened",
  empty: "No ministers yet. Click + to recruit the first one",
  createTitle: "Create minister",
  editTitle: "Edit minister",
  name: "Name",
  namePlaceholder: "Name the minister",
  systemPrompt: "System prompt",
  systemPromptPlaceholder:
    "Describe this minister's identity, duties, and style…",
  model: "Model",
  submitCreate: "Create",
  submitSave: "Save",
  cancel: "Cancel",
  edit: "Edit",
  delete: "Delete",
  confirmDelete: "Confirm delete",
  openFailed: "Failed to open session",
  requiredFields: "Name and system prompt are required",
  currentModel: "Current model",
  removeHint:
    "Running work will stop and the session will be archived. Memory notes will be removed and chat history kept.",
};
