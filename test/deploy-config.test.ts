import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');

describe('free-plan deploy configuration', () => {
  it('declares no Containers and no Durable Objects', () => {
    expect(toml).not.toMatch(/\[\[containers\]\]/);
    expect(toml).not.toMatch(/durable_objects/);
    expect(toml).not.toMatch(/\[exports\./);
  });

  it('binds D1 and KV, and keeps the Worker name and entry point', () => {
    expect(toml).toMatch(/binding = "DB"/);
    expect(toml).toMatch(/database_name = "mediabot"/);
    expect(toml).toMatch(/binding = "CACHE"/);
    expect(toml).toMatch(/name = 'mediadownloaderbot'/);
    expect(toml).toMatch(/main = "src\/index\.ts"/);
  });

  it('contains no secret values', () => {
    expect(toml).not.toMatch(/BOT_TOKEN\s*=/);
    expect(toml).not.toMatch(/WEBHOOK_SECRET\s*=/);
    expect(toml).not.toMatch(/\[vars\]/);
  });

  it('ships the reference schema without the superseded tables', () => {
    const sql = readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS panel_users/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_prefs/);
    expect(sql).not.toMatch(/bot_users|download_jobs/);
  });

  it('serves the panel assets and runs the hourly maintenance cron', () => {
    expect(toml).toMatch(/\[assets\][\s\S]*directory = "\.\/public"[\s\S]*binding = "ASSETS"/);
    expect(toml).toMatch(/\[triggers\][\s\S]*crons = \["0 \* \* \* \*"\]/);
    expect(existsSync(join(root, 'public', 'static', 'app.js'))).toBe(true);
  });

  it('keeps the build out of the repository (no build script to maintain)', () => {
    expect(existsSync(join(root, 'scripts', 'workers-build.sh'))).toBe(false);
  });

  it('has no Python project files left', () => {
    for (const f of ['pyproject.toml', 'requirements.txt', 'Dockerfile', 'docker-compose.yml', 'mediabot']) {
      expect(existsSync(join(root, f)), f).toBe(false);
    }
  });
});
