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

  it('ships the D1 migration and the Workers Builds script', () => {
    expect(existsSync(join(root, 'migrations', '0001_init.sql'))).toBe(true);
    expect(existsSync(join(root, 'scripts', 'workers-build.sh'))).toBe(true);
  });

  it('has no Python project files left', () => {
    for (const f of ['pyproject.toml', 'requirements.txt', 'Dockerfile', 'docker-compose.yml', 'mediabot']) {
      expect(existsSync(join(root, f)), f).toBe(false);
    }
  });
});
