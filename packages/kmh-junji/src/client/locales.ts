/** 军机阁客户端文案字典（Phase 3 实装 UI 时扩充）。 */
export const NS = "junji";

export const zh = {
  "section.title": "军机阁",
  "section.create": "创建大臣",
  "panel.name.label": "名字",
  "panel.name.placeholder": "给大臣起个名字，如：司马",
  "panel.systemPrompt.label": "系统提示词",
  "panel.systemPrompt.placeholder":
    "描述这位大臣的身份、职责与行事风格……",
  "panel.model.label": "模型",
  "panel.submit": "创建",
  "panel.cancel": "取消",
} as const;

export type JunjiKey = keyof typeof zh;

export const en: Record<JunjiKey, string> = {
  "section.title": "War Council",
  "section.create": "Create minister",
  "panel.name.label": "Name",
  "panel.name.placeholder": "Name the minister, e.g. Sima",
  "panel.systemPrompt.label": "System prompt",
  "panel.systemPrompt.placeholder":
    "Describe this minister's identity, duties, and style…",
  "panel.model.label": "Model",
  "panel.submit": "Create",
  "panel.cancel": "Cancel",
};
