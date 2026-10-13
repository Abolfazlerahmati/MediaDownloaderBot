// Panel-editable settings. Every value is validated on the server. Unknown keys are rejected.

export type Language = 'en' | 'fa';

export interface Settings {
  bot_enabled: boolean;
  default_language: Language;
  group_mode: 'addressed' | 'off';
  rate_limit_per_minute: number;
  dedupe_seconds: number;
  max_file_mb: number;
  log_retention_days: number;
  maintenance_message: string;
}

export const DEFAULT_SETTINGS: Settings = {
  bot_enabled: true,
  default_language: 'en',
  group_mode: 'addressed',
  rate_limit_per_minute: 5,
  dedupe_seconds: 120,
  max_file_mb: 50,
  log_retention_days: 7,
  maintenance_message: '',
};

type Def =
  | { type: 'bool' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'int'; min: number; max: number }
  | { type: 'text'; maxLength: number };

export const SETTING_DEFS: { [K in keyof Settings]: Def } = {
  bot_enabled: { type: 'bool' },
  default_language: { type: 'enum', values: ['en', 'fa'] },
  group_mode: { type: 'enum', values: ['addressed', 'off'] },
  rate_limit_per_minute: { type: 'int', min: 1, max: 60 },
  dedupe_seconds: { type: 'int', min: 0, max: 600 },
  max_file_mb: { type: 'int', min: 1, max: 50 },
  log_retention_days: { type: 'int', min: 1, max: 90 },
  maintenance_message: { type: 'text', maxLength: 300 },
};

export type FieldErrors = Record<string, string>;

/** Validates a partial update. Returns typed values, or field-level errors. */
export function validateChanges(
  changes: unknown,
): { ok: true; values: Partial<Settings> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const values: Record<string, unknown> = {};
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { ok: false, errors: { changes: 'expected an object' } };
  }
  for (const [key, raw] of Object.entries(changes as Record<string, unknown>)) {
    const def = SETTING_DEFS[key as keyof Settings];
    if (!def) {
      errors[key] = 'unknown setting';
      continue;
    }
    switch (def.type) {
      case 'bool':
        if (typeof raw !== 'boolean') errors[key] = 'must be true or false';
        else values[key] = raw;
        break;
      case 'enum':
        if (typeof raw !== 'string' || !def.values.includes(raw)) errors[key] = `must be one of: ${def.values.join(', ')}`;
        else values[key] = raw;
        break;
      case 'int':
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < def.min || raw > def.max) {
          errors[key] = `must be a whole number from ${def.min} to ${def.max}`;
        } else values[key] = raw;
        break;
      case 'text':
        if (typeof raw !== 'string' || raw.length > def.maxLength) errors[key] = `must be text up to ${def.maxLength} characters`;
        else values[key] = raw.trim();
        break;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: values as Partial<Settings> };
}

/** Converts stored strings back to typed values. Missing or invalid rows fall back to defaults. */
export function parseStoredSettings(rows: Array<{ key: string; value: string }>): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const def = SETTING_DEFS[row.key as keyof Settings];
    if (!def) continue;
    try {
      const parsed: unknown = JSON.parse(row.value);
      const check = validateChanges({ [row.key]: parsed });
      if (check.ok) out[row.key] = (check.values as Record<string, unknown>)[row.key];
    } catch {
      // keep the default for corrupt rows
    }
  }
  return out as unknown as Settings;
}
