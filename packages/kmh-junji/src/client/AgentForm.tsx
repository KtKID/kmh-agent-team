/** 创建/编辑大臣的表单：名字、系统提示词、模型目录下拉。 */
import { useState, type ReactNode } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  AgentModel,
  AgentRecord,
  ModelCatalog,
} from "../protocol/index.ts";

/** 表单提交值；reasoningEffort 暂不在此面配置。 */
export interface FormValues {
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: AgentModel;
}

interface Props extends PropsLocale<"junji"> {
  readonly catalog: ModelCatalog;
  readonly initial?: AgentRecord;
  readonly submitLabel: string;
  readonly onSubmit: (values: FormValues) => Promise<void>;
  readonly onCancel: () => void;
}

/** @param model - 模型选择。 @returns 下拉选项的稳定编码值。 */
function encodeModel(model: AgentModel): string {
  return JSON.stringify({ provider: model.provider, model: model.model });
}

/** @param value - 下拉选项编码值。 @returns 解码后的模型选择。 */
function decodeModel(value: string): AgentModel {
  const parsed = JSON.parse(value) as { provider: string; model: string };
  return { provider: parsed.provider, model: parsed.model };
}

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "var(--dsw-alias-label-secondary)",
  marginBottom: 4,
} as const;
const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-separator)",
  background: "var(--dsw-alias-fill-input)",
  color: "inherit",
  fontSize: 13,
} as const;

/**
 * @param props - 词典、模型目录、可选编辑初值与提交回调。
 * @returns 受控表单；校验失败与请求错误原位展示。
 */
export function AgentForm({
  t,
  catalog,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: Props): ReactNode {
  const [name, setName] = useState(initial?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(
    initial?.systemPrompt ?? "",
  );
  const [selection, setSelection] = useState(() =>
    initial === undefined
      ? encodeModel(catalog.default)
      : encodeModel(initial.model),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const known = catalog.groups.some((group) =>
    group.models.some(
      (entry) =>
        initial !== undefined &&
        entry.id === initial.model.model &&
        group.id === initial.model.provider,
    ),
  );

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length === 0 || systemPrompt.trim().length === 0) {
          setError(t("requiredFields"));
          return;
        }
        setPending(true);
        setError(undefined);
        onSubmit({
          name: name.trim(),
          systemPrompt,
          model: decodeModel(selection),
        })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <div>
        <label style={labelStyle} htmlFor="junji-agent-name">
          {t("name")}
        </label>
        <input
          id="junji-agent-name"
          style={fieldStyle}
          value={name}
          placeholder={t("namePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="junji-agent-prompt">
          {t("systemPrompt")}
        </label>
        <textarea
          id="junji-agent-prompt"
          style={{ ...fieldStyle, minHeight: 120, resize: "vertical" }}
          value={systemPrompt}
          placeholder={t("systemPromptPlaceholder")}
          onChange={(event) => {
            setSystemPrompt(event.target.value);
          }}
        />
      </div>
      <div>
        <label style={labelStyle} htmlFor="junji-agent-model">
          {t("model")}
        </label>
        <select
          id="junji-agent-model"
          style={fieldStyle}
          value={selection}
          onChange={(event) => {
            setSelection(event.target.value);
          }}
        >
          {initial !== undefined && !known ? (
            <optgroup label={t("currentModel")}>
              <option value={encodeModel(initial.model)}>
                {initial.model.provider}/{initial.model.model}
              </option>
            </optgroup>
          ) : null}
          {catalog.groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map((entry) => (
                <option
                  key={`${group.id}/${entry.id}`}
                  value={encodeModel({
                    provider: group.id,
                    model: entry.id,
                  })}
                >
                  {entry.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {error === undefined ? null : (
        <div role="alert" style={{ fontSize: 12, color: "var(--dsw-alias-label-danger, #d5484f)" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>{t("cancel")}</Button>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
