// Bindings and Cloudflare Secrets. Secrets are set in the Cloudflare dashboard (see docs/cloudflare.md).
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  /** Telegram bot token from @BotFather. Secret. */
  BOT_TOKEN: string;
  /** Random string echoed by Telegram in every webhook call. Secret, 32+ characters. */
  WEBHOOK_SECRET: string;
  /** Static assets (panel CSS and JS). Bound by the [assets] block in wrangler.toml. */
  ASSETS?: Fetcher;
}
