// D1 access for users and download history. The interface lets tests use an in-memory store.
import type { Platform } from './extractors/types';

export type JobStatus = 'pending' | 'done' | 'failed';

export interface Store {
  upsertUser(telegramId: number, username: string | null): Promise<void>;
  countRecentJobs(telegramId: number, sinceIso: string): Promise<number>;
  createJob(job: { telegramId: number; chatId: number; platform: Platform; host: string }): Promise<number>;
  finishJob(id: number, status: Exclude<JobStatus, 'pending'>, errorCode: string | null): Promise<void>;
}

export function d1Store(db: D1Database): Store {
  return {
    async upsertUser(telegramId, username) {
      await db
        .prepare(
          `INSERT INTO bot_users (telegram_id, username, request_count) VALUES (?, ?, 1)
           ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username,
             last_seen_at = datetime('now'), request_count = bot_users.request_count + 1`,
        )
        .bind(telegramId, username)
        .run();
    },
    async countRecentJobs(telegramId, sinceIso) {
      const row = await db
        .prepare('SELECT COUNT(*) AS n FROM download_jobs WHERE telegram_id = ? AND created_at >= ?')
        .bind(telegramId, sinceIso)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },
    async createJob(job) {
      const result = await db
        .prepare('INSERT INTO download_jobs (telegram_id, chat_id, platform, url_host, status) VALUES (?, ?, ?, ?, ?)')
        .bind(job.telegramId, job.chatId, job.platform, job.host, 'pending')
        .run();
      return Number(result.meta.last_row_id);
    },
    async finishJob(id, status, errorCode) {
      await db
        .prepare(`UPDATE download_jobs SET status = ?, error_code = ?, finished_at = datetime('now') WHERE id = ?`)
        .bind(status, errorCode, id)
        .run();
    },
  };
}
