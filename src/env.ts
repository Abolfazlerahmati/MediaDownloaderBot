// Bindings and secrets available to the Worker. Secrets are set with `wrangler secret put`.
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}
