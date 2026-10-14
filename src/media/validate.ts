// Checks on downloaded bytes and file names. Nothing is sent to Telegram unless these pass.

/** An MP4/MOV container has the ASCII tag "ftyp" at byte offset 4. */
export function isMp4Header(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

/**
 * Makes a title safe for a file name. Unicode letters are kept, including Persian text and ZWNJ (U+200C).
 * Control characters and path or header-breaking characters are removed.
 */
export function safeTitle(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = [...cleaned].slice(0, 100).join('').trim();
  return cut.length > 0 ? cut : fallback;
}

export function fileNameFor(title: string | undefined, platform: string): string {
  return `${safeTitle(title, platform)}.mp4`;
}
