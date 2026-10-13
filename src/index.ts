/**
 * Cloudflare Worker that fronts the MediaDownloaderBot container.
 *
 * Routes
 *  - POST /internal/db          D1 bridge used by the container (token-protected, never routed to the container).
 *  - everything else            forwarded to ONE Durable Object that owns ONE container (port 8080):
 *                               Telegram webhook at /telegram/webhook and the admin panel.
 *
 * The container checks Telegram's secret token itself and the admin panel's CSRF/Origin rules,
 * so the original Host header is forwarded unchanged.
 */
import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const INACTIVITY_MS = 10 * 60 * 1000; // sleep after 10 minutes without requests
const READY_ATTEMPTS = 150; // about 30 seconds at 200 ms per attempt
const SINGLETON_NAME = "mediabot";
const ORIGIN_HEADER = "x-mediabot-public-origin";
const DB_PATH = "/internal/db";
const DB_TOKEN_HEADER = "x-mediabot-db-token";
const DB_TOKEN_CONTEXT = "mediabot-db-bridge-v1"; // must match mediabot/db/d1.py
const MAX_STATEMENTS = 200;
const MAX_SQL_CHARS = 20000;
const MAX_PARAMS = 100;

export interface Env {
  MEDIA_BOT: DurableObjectNamespace<MediaBotContainer>;
  DB: D1Database;
  APP_SECRET_KEY: string; // wrangler secret
}

type ContainerHandle = NonNullable<DurableObjectState["container"]>;
type Param = string | number | null;
interface Statement {
  sql: string;
  params: Param[];
}

/** Token shared by the Worker and the container: HMAC-SHA256(APP_SECRET_KEY, context), hex. */
async function bridgeToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(DB_TOKEN_CONTEXT));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function parseStatements(body: unknown): { atomic: boolean; statements: Statement[] } | string {
  if (typeof body !== "object" || body === null) {
    return "invalid_body";
  }
  const { atomic, statements } = body as { atomic?: unknown; statements?: unknown };
  if (typeof atomic !== "boolean" || !Array.isArray(statements)) {
    return "invalid_body";
  }
  if (statements.length < 1 || statements.length > MAX_STATEMENTS) {
    return "invalid_statement_count";
  }
  const parsed: Statement[] = [];
  for (const item of statements) {
    const { sql, params } = (item ?? {}) as { sql?: unknown; params?: unknown };
    if (typeof sql !== "string" || sql.length === 0 || sql.length > MAX_SQL_CHARS) {
      return "invalid_sql";
    }
    if (!Array.isArray(params) || params.length > MAX_PARAMS) {
      return "invalid_params";
    }
    for (const value of params) {
      const ok =
        value === null ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value));
      if (!ok) {
        return "invalid_params";
      }
    }
    parsed.push({ sql, params: params as Param[] });
  }
  return { atomic, statements: parsed };
}

/** POST /internal/db: runs statements with the D1 binding. Token-protected. */
async function handleDbBridge(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const expected = await bridgeToken(env.APP_SECRET_KEY);
  if (!constantTimeEqual(request.headers.get(DB_TOKEN_HEADER) ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseStatements(body);
  if (typeof parsed === "string") {
    return json({ error: parsed }, 400);
  }
  try {
    const prepared = parsed.statements.map((s) => env.DB.prepare(s.sql).bind(...s.params));
    const outcomes = parsed.atomic ? await env.DB.batch(prepared) : [];
    if (!parsed.atomic) {
      for (const statement of prepared) {
        outcomes.push(await statement.all());
      }
    }
    const results = outcomes.map((r) => ({
      rows: r.results ?? [],
      changes: r.meta?.changes ?? 0,
      last_row_id: r.meta?.last_row_id ?? 0,
    }));
    return json({ results });
  } catch {
    // Never echo SQL, parameters or driver messages back to the caller.
    return json({ error: "database_error" }, 500);
  }
}

export class MediaBotContainer extends DurableObject<Env> {
  private async ensureRunning(publicOrigin: string): Promise<ContainerHandle> {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Containers are not enabled for this Durable Object.");
    }
    await container.setInactivityTimeout(INACTIVITY_MS);
    if (!container.running) {
      if (!publicOrigin) {
        throw new Error("The public origin is missing; the container cannot register its webhook.");
      }
      const env: Record<string, string> = {
        APP_SECRET_KEY: this.env.APP_SECRET_KEY,
        DATA_DIR: "/tmp/mediabot",
        ADMIN_HOST: "0.0.0.0",
        ADMIN_PORT: String(CONTAINER_PORT),
        ADMIN_COOKIE_SECURE: "true",
        ENABLE_BOT: "true",
        ENABLE_WEB: "true",
        BOT_MODE: "webhook",
        WEBHOOK_BASE_URL: publicOrigin,
        DB_BACKEND: "d1",
        DB_BRIDGE_URL: `${publicOrigin}${DB_PATH}`,
        DB_BRIDGE_TOKEN: await bridgeToken(this.env.APP_SECRET_KEY),
        PERSISTENCE_MODE: "minimal",
        RESTART_SUPERVISED: "true",
      };
      container.start({ env, enableInternet: true });
    }
    await this.waitUntilReady(container);
    return container;
  }

  private async waitUntilReady(container: ContainerHandle): Promise<void> {
    const port = container.getTcpPort(CONTAINER_PORT);
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
      try {
        const response = await port.fetch("http://container/login");
        if (response.status < 500) {
          return;
        }
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("The MediaDownloaderBot container did not become ready.");
  }

  async fetch(request: Request): Promise<Response> {
    const publicOrigin = request.headers.get(ORIGIN_HEADER) ?? "";
    const container = await this.ensureRunning(publicOrigin);

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete(ORIGIN_HEADER);
    return container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === DB_PATH) {
      return handleDbBridge(request, env);
    }
    const headers = new Headers(request.headers);
    // Set by the Worker itself (never trusted from the client). Used only to build WEBHOOK_BASE_URL.
    headers.set(ORIGIN_HEADER, url.origin);
    const forwarded = new Request(request, { headers });
    return env.MEDIA_BOT.getByName(SINGLETON_NAME).fetch(forwarded);
  },
};
