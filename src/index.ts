/**
 * Cloudflare Worker that fronts the MediaDownloaderBot container.
 *
 * - Every request goes to one Durable Object, which owns one container instance.
 * - The container runs the Python process (Telegram webhook + admin panel) on port 8080.
 * - Telegram delivers updates to POST /telegram/webhook; the container checks the secret token itself.
 * - The admin panel is served through the same route; its CSRF/Origin checks rely on the original Host header,
 *   so the Host header is forwarded unchanged.
 */
import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const INACTIVITY_MS = 10 * 60 * 1000; // sleep after 10 minutes without requests
const READY_ATTEMPTS = 150; // about 30 seconds at 200 ms per attempt
const SINGLETON_NAME = "mediabot";
const ORIGIN_HEADER = "x-mediabot-public-origin";

export interface Env {
  MEDIA_BOT: DurableObjectNamespace<MediaBotContainer>;
  APP_SECRET_KEY: string; // wrangler secret
  BOT_TOKEN?: string; // wrangler secret (optional)
}

type ContainerHandle = NonNullable<DurableObjectState["container"]>;

export class MediaBotContainer extends DurableObject<Env> {
  private async ensureRunning(publicOrigin: string): Promise<ContainerHandle> {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Containers are not enabled for this Durable Object.");
    }
    await container.setInactivityTimeout(INACTIVITY_MS);
    if (!container.running) {
      const env: Record<string, string> = {
        APP_SECRET_KEY: this.env.APP_SECRET_KEY,
        DATA_DIR: "/data",
        ADMIN_HOST: "0.0.0.0",
        ADMIN_PORT: String(CONTAINER_PORT),
        ADMIN_COOKIE_SECURE: "true",
        ENABLE_BOT: "true",
        ENABLE_WEB: "true",
        BOT_MODE: "webhook",
        WEBHOOK_BASE_URL: publicOrigin,
        PERSISTENCE_MODE: "minimal",
        RESTART_SUPERVISED: "true",
      };
      if (this.env.BOT_TOKEN) {
        env.BOT_TOKEN = this.env.BOT_TOKEN;
      }
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
    const headers = new Headers(request.headers);
    // Set by the Worker itself (never trusted from the client). Used only to build WEBHOOK_BASE_URL.
    headers.set(ORIGIN_HEADER, new URL(request.url).origin);
    const forwarded = new Request(request, { headers });
    return env.MEDIA_BOT.getByName(SINGLETON_NAME).fetch(forwarded);
  },
};
