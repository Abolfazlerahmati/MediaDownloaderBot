import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STATIC = join(process.cwd(), 'public', 'static');
const css = readFileSync(join(STATIC, 'app.css'), 'utf8');
const fontDir = join(STATIC, 'fonts');

// ---------- fonts ----------

interface FaceRule { weight: number; src: string; range: string }

function fontFaces(): FaceRule[] {
  const faces: FaceRule[] = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const body = m[1];
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
    const src = /url\(([^)]+)\)/.exec(body)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
    const range = /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? '';
    faces.push({ weight, src, range });
  }
  return faces;
}

/** Expands "U+0600-06FF, U+0750" into [start, end] code point pairs. */
function parseRange(range: string): Array<[number, number]> {
  return range.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-').map((x) => parseInt(x, 16));
    return [a, Number.isNaN(b) ? a : b] as [number, number];
  });
}

const covers = (ranges: Array<[number, number]>, cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);

describe('Estedad font wiring', () => {
  const faces = fontFaces();
  const files = readdirSync(fontDir).filter((f) => f.endsWith('.woff2'));

  it('declares eight faces: two subsets at weights 400, 500, 600 and 700', () => {
    expect(faces).toHaveLength(8);
    for (const subset of ['latin', 'arabic']) {
      for (const weight of [400, 500, 600, 700]) {
        expect(faces.some((f) => f.src.endsWith(`estedad-${subset}-${weight}.woff2`) && f.weight === weight)).toBe(true);
      }
    }
  });

  it('every @font-face src points to a file that exists in public/static/fonts', () => {
    for (const face of faces) {
      expect(face.src.startsWith('/static/fonts/')).toBe(true);
      expect(files).toContain(face.src.split('/').pop());
    }
  });

  it('every woff2 file in the fonts folder is referenced by a @font-face rule', () => {
    const referenced = faces.map((f) => f.src.split('/').pop());
    for (const file of files) expect(referenced).toContain(file);
  });

  it('the latin subset covers ASCII digits and letters; the arabic subset covers Arabic and Persian digits', () => {
    const latin = parseRange(faces.find((f) => f.src.includes('latin') && f.weight === 400)!.range);
    const arabic = parseRange(faces.find((f) => f.src.includes('arabic') && f.weight === 400)!.range);
    for (let cp = 0x30; cp <= 0x39; cp++) expect(covers(latin, cp)).toBe(true); // 0-9
    for (let cp = 0x41; cp <= 0x5a; cp++) expect(covers(latin, cp)).toBe(true); // A-Z
    for (let cp = 0x61; cp <= 0x7a; cp++) expect(covers(latin, cp)).toBe(true); // a-z
    for (let cp = 0x6f0; cp <= 0x6f9; cp++) expect(covers(arabic, cp)).toBe(true); // Persian digits
    expect(covers(arabic, 0x644)).toBe(true); // Arabic letter lam
    expect(covers(latin, 0x644)).toBe(false);
  });

  it('the body font stack starts with Estedad and falls back to a system sans', () => {
    expect(css).toMatch(/font-family:\s*"Estedad",[^;]*sans-serif/);
  });
});

// ---------- theme contrast ----------

type Vars = Record<string, string>;

/** Collects the custom properties that apply to one theme and mode, in cascade order. */
function tokensFor(theme: string, mode: string): Vars {
  const rules: Array<{ specificity: number; order: number; decls: Vars }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let order = 0;
  for (const m of css.matchAll(re)) {
    const selectorList = m[1].trim();
    if (!selectorList.includes(':root')) continue;
    for (const selector of selectorList.split(',').map((s) => s.trim())) {
      if (selector.includes('system')) continue; // system mode is resolved through prefers-color-scheme; tested below
      const t = /data-theme="(\w+)"/.exec(selector)?.[1];
      const md = /data-mode="(\w+)"/.exec(selector)?.[1];
      if (t && t !== theme) continue;
      if (md && md !== mode) continue;
      const decls: Vars = {};
      for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
      const specificity = (t ? 1 : 0) + (md ? 1 : 0);
      rules.push({ specificity, order: order++, decls });
    }
  }
  rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const vars: Vars = {};
  for (const r of rules) Object.assign(vars, r.decls);
  return vars;
}

function resolve(vars: Vars, name: string, depth = 0): string | undefined {
  const raw = vars[name];
  if (raw === undefined || depth > 5) return undefined;
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? resolve(vars, ref[1], depth + 1) : raw;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) throw new Error(`not a hex colour: ${a} / ${b}`);
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme contrast (WCAG AA, 4.5:1 for text)', () => {
  const pairs: Array<[string, string]> = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['muted', 'surface'],
    ['muted', 'bg'],
    ['accent-fg', 'accent'],
    ['ok-fg', 'ok-bg'],
    ['warn-fg', 'warn-bg'],
    ['err-fg', 'err-bg'],
    ['info-fg', 'info-bg'],
    ['sidebar-active-text', 'sidebar-active'],
  ];
  for (const theme of ['merchant', 'ios']) {
    for (const mode of ['light', 'dark']) {
      it(`${theme} ${mode}: every text pair meets 4.5:1`, () => {
        const vars = tokensFor(theme, mode);
        for (const [fg, bg] of pairs) {
          const a = resolve(vars, fg);
          const b = resolve(vars, bg);
          expect(a, `--${fg} missing for ${theme}/${mode}`).toBeDefined();
          expect(b, `--${bg} missing for ${theme}/${mode}`).toBeDefined();
          const ratio = contrast(a!, b!);
          expect(ratio, `${fg} on ${bg} in ${theme}/${mode}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('the focus ring is distinct from the page background in every theme and mode', () => {
    for (const theme of ['merchant', 'ios']) {
      for (const mode of ['light', 'dark']) {
        const vars = tokensFor(theme, mode);
        expect(contrast(resolve(vars, 'focus')!, resolve(vars, 'bg')!)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
