// Small HTML helpers. They use regular expressions, not a DOM parser, to keep CPU time low.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Returns the content of <meta property="X"> or <meta name="X">, in either attribute order. */
export function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = html.match(new RegExp(`<meta\\b[^>]*\\b(?:property|name)=["']${escaped}["'][^>]*>`, 'i'));
  if (!tag) return null;
  const content = tag[0].match(/\bcontent=["']([^"']*)["']/i);
  return content ? decodeEntities(content[1]) : null;
}

/** Undo JSON-style escaping such as \/ that appears in inline script data. */
export function unescapeJsonString(value: string): string {
  return value.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u002F/gi, '/');
}

export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}
