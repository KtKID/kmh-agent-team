/** 军机阁主面板：大臣列表 + ➕ 创建/编辑弹层；点击大臣进入其专属会话。 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  IconEditOutlineMedium,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineMedium,
  IconUsersOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { AgentRecord, ModelCatalog } from "../protocol/index.ts";
import { AgentForm, type FormValues } from "./AgentForm.tsx";
import * as api from "./transport.ts";

/** 注册侧闭包的打开动作。 */
export interface JunjiPanelFace {
  readonly open: (id: string) => Promise<void>;
}

type PanelProps = PropsRuntime<"main"> &
  PropsLocale<"junji"> &
  InjectFace<JunjiPanelFace>;

type PanelState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready" };

type Overlay =
  | { kind: "closed" }
  | { kind: "creating" }
  | { kind: "editing"; agent: AgentRecord };

/**
 * @param props - 面板份额、打开动作和词典。
 * @returns 军机阁管理面板。
 */
export function JunjiPanel({ open, t }: PanelProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [agents, setAgents] = useState<readonly AgentRecord[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "closed" });
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    api
      .bootstrap(controller.signal)
      .then((value) => {
        setAgents(value.agents);
        setCatalog(value.catalog);
        setState({ kind: "ready" });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            kind: "failed",
            message: cause instanceof Error ? cause.message : String(cause),
          });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const reload = useCallback((): void => {
    api
      .listAgents()
      .then((value) => {
        setAgents(value.agents);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  const onOpen = (id: string): void => {
    setBusyId(id);
    setError(undefined);
    open(id)
      .catch((cause: unknown) => {
        setError(
          `${t("openFailed")}：${cause instanceof Error ? cause.message : String(cause)}`,
        );
      })
      .finally(() => {
        setBusyId(undefined);
      });
  };

  const onCreate = async (values: FormValues): Promise<void> => {
    const created = await api.createAgent(values);
    setOverlay({ kind: "closed" });
    reload();
    await open(created.agent.id);
  };

  const onEdit = async (
    id: string,
    values: FormValues,
  ): Promise<void> => {
    await api.updateAgent(id, {
      ...(values.name === undefined ? {} : { name: values.name }),
      systemPrompt: values.systemPrompt,
      model: values.model,
    });
    setOverlay({ kind: "closed" });
    reload();
  };

  const onRemove = (id: string): void => {
    api
      .removeAgent(id)
      .then(() => {
        setConfirmId(undefined);
        reload();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  const centered = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 12,
  } as const;

  return (
    <div
      data-junji-panel=""
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t("panel")}</span>
        <Button
          disabled={catalog === undefined}
          onClick={() => {
            setOverlay({ kind: "creating" });
          }}
        >
          <IconPlusOutlineRegular size={16} />
        </Button>
      </div>
      {error === undefined ? null : (
        <div
          role="alert"
          style={{ padding: "0 16px", fontSize: 12, color: "var(--dsw-alias-label-danger, #d5484f)" }}
        >
          {error}
        </div>
      )}
      {state.kind === "loading" ? (
        <div style={centered} role="status" aria-label={t("panel")}>
          <IconLoadingOutlineRegular size={20} />
        </div>
      ) : state.kind === "failed" ? (
        <div style={centered} role="alert">
          <span>{t("loadFailed")}</span>
          <span
            style={{ color: "var(--dsw-alias-label-secondary)", fontSize: 12 }}
          >
            {state.message}
          </span>
          <Button
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div style={centered}>
          <IconUsersOutlineRegular size={28} />
          <span style={{ color: "var(--dsw-alias-label-secondary)", fontSize: 13 }}>
            {t("empty")}
          </span>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: "0 8px",
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {agents.map((agent) => (
            <li
              key={agent.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 8px",
                borderRadius: 10,
              }}
            >
              <button
                type="button"
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  border: "none",
                  background: "none",
                  color: "inherit",
                  textAlign: "left",
                  cursor: busyId === agent.id ? "wait" : "pointer",
                  padding: 0,
                }}
                disabled={busyId !== undefined}
                onClick={() => {
                  onOpen(agent.id);
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {busyId === agent.id ? t("panel") + "…" : agent.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--dsw-alias-label-secondary)" }}>
                  {agent.model.provider}/{agent.model.model}
                </span>
              </button>
              <Button
                disabled={busyId !== undefined}
                onClick={() => {
                  setOverlay({ kind: "editing", agent });
                }}
                aria-label={t("edit")}
              >
                <IconEditOutlineMedium size={16} />
              </Button>
              {confirmId === agent.id ? (
                <Button
                  disabled={busyId !== undefined}
                  onClick={() => {
                    onRemove(agent.id);
                  }}
                >
                  {t("confirmDelete")}
                </Button>
              ) : (
                <Button
                  disabled={busyId !== undefined}
                  onClick={() => {
                    setConfirmId(agent.id);
                  }}
                  aria-label={t("delete")}
                >
                  <IconTrashOutlineMedium size={16} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {overlay.kind === "closed" || catalog === undefined ? null : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in srgb, var(--dsw-alias-fill-deep, rgba(0,0,0,0.5)) 50%, transparent)",
            zIndex: 40,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              setOverlay({ kind: "closed" });
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: "min(440px, calc(100vw - 48px))",
              maxHeight: "calc(100vh - 96px)",
              overflowY: "auto",
              padding: 20,
              borderRadius: 14,
              border: "1px solid var(--dsw-alias-separator)",
              background: "var(--dsw-alias-fill-panel, var(--dsw-alias-fill-input))",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              {overlay.kind === "creating"
                ? t("createTitle")
                : t("editTitle")}
            </div>
            {overlay.kind === "creating" ? (
              <AgentForm
                t={t}
                catalog={catalog}
                submitLabel={t("submitCreate")}
                onSubmit={onCreate}
                onCancel={() => {
                  setOverlay({ kind: "closed" });
                }}
              />
            ) : (
              <>
                <AgentForm
                  t={t}
                  catalog={catalog}
                  initial={overlay.agent}
                  submitLabel={t("submitSave")}
                  onSubmit={(values) => {
                    return onEdit(overlay.kind === "editing" ? overlay.agent.id : "", values);
                  }}
                  onCancel={() => {
                    setOverlay({ kind: "closed" });
                  }}
                />
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--dsw-alias-label-secondary)",
                  }}
                >
                  {t("removeHint")}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
