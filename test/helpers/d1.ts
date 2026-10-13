// Test double for D1 built on node:sqlite. It implements only the Db surface the app uses.
import { DatabaseSync } from 'node:sqlite';
import type { Db, Stmt } from '../../src/db/schema';
import { resetSchemaCacheForTests } from '../../src/db/schema';

type Param = number | bigint | string | null | Uint8Array;

function clean(values: unknown[]): Param[] {
  return values.map((v) => (v === undefined ? null : (v as Param)));
}

function makeStmt(raw: DatabaseSync, sql: string, params: Param[]): Stmt {
  return {
    bind(...values: unknown[]): Stmt {
      return makeStmt(raw, sql, clean(values));
    },
    async first<T>(): Promise<T | null> {
      const row = raw.prepare(sql).get(...params);
      return (row ?? null) as T | null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      return { results: raw.prepare(sql).all(...params) as T[] };
    },
    async run(): Promise<unknown> {
      return raw.prepare(sql).run(...params);
    },
  };
}

export interface TestDb {
  db: Db;
  raw: DatabaseSync;
}

export function createTestDb(): TestDb {
  resetSchemaCacheForTests();
  const raw = new DatabaseSync(':memory:');
  const db: Db = {
    prepare(sql: string) {
      return makeStmt(raw, sql, []);
    },
    async batch(statements: unknown[]) {
      const out: unknown[] = [];
      for (const s of statements as Stmt[]) out.push(await s.run());
      return out;
    },
  };
  return { db, raw };
}
