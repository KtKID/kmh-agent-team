/** 军机阁 HTTP 入口，全部复用 DSH 鉴权和连接路由。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { JunjiRuntime } from "./runtime.ts";
import {
  BootstrapSchema,
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
} from "./protocol/index.ts";

/** @param value - 序列化值。 @returns 禁缓存的 JSON 响应。 */
function json(value: unknown): Response {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}

/** @param error - 任意异常。 @returns 统一 500 错误响应。 */
function fail(error: unknown): Response {
  return Response.json(
    { message: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

/** @param url - 请求 URL。 @returns 查询参数 id，缺失时抛错。 */
function requireId(url: URL): string {
  const id = url.searchParams.get("id");
  if (id === null || id === "") throw Error("缺少 id 查询参数");
  return id;
}

/**
 * 注册军机阁 REST 路由：bootstrap/list/create/update/remove/open。
 * @param ctx - Web 宿主。
 * @param runtime - 插件运行时。
 */
export function mountWeb(ctx: Context, runtime: JunjiRuntime): void {
  for (const action of [
    "bootstrap",
    "list",
    "create",
    "update",
    "remove",
    "open",
  ] as const)
    ctx.connection.fetch.register({
      path: `/api/kmh-junji/${action}`,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        try {
          const url = new URL(request.url);
          switch (action) {
            case "bootstrap":
              return json(
                BootstrapSchema.parse({
                  agents: runtime.list(),
                  catalog: await ctx.sessionController.modelCatalog(),
                }),
              );
            case "list":
              return json({ agents: runtime.list() });
            case "create":
              return json(
                await runtime.create(
                  CreateAgentInputSchema.parse(await request.json()),
                ),
              );
            case "update":
              return json({
                agent: await runtime.update(
                  requireId(url),
                  UpdateAgentInputSchema.parse(await request.json()),
                ),
              });
            case "remove":
              await runtime.remove(requireId(url));
              return json({ removed: true });
            case "open": {
              const opened = await runtime.open(requireId(url));
              return json(opened);
            }
          }
        } catch (error) {
          return fail(error);
        }
      },
    });
}
