import { describe, expect, it } from 'vitest';
import { classifyUrl, extractFirstUrl } from '../src/platforms';

describe('extractFirstUrl', () => {
  it('finds the first http(s) URL and strips trailing punctuation', () => {
    expect(extractFirstUrl('see https://www.tiktok.com/@a/video/1, thanks')).toBe('https://www.tiktok.com/@a/video/1');
    expect(extractFirstUrl('no link here')).toBeNull();
  });
});

describe('classifyUrl', () => {
  it.each([
    ['https://www.tiktok.com/@user/video/123', 'tiktok', true],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok', true],
    ['https://www.pinterest.com/pin/123456/', 'pinterest', true],
    ['https://pin.it/4abcDEF', 'pinterest', true],
    ['https://ir.pinterest.com/pin/9/', 'pinterest', true],
    ['https://www.youtube.com/watch?v=abc', 'youtube', false],
    ['https://youtu.be/abc', 'youtube', false],
    ['https://www.instagram.com/reel/abc/', 'instagram', false],
  ])('classifies %s as %s (supported=%s)', (url, platform, supported) => {
    const result = classifyUrl(url);
    expect(result?.platform).toBe(platform);
    expect(result?.supported).toBe(supported);
  });

  it('rejects other hosts, non-http schemes, and malformed input', () => {
    expect(classifyUrl('https://example.com/video.mp4')).toBeNull();
    expect(classifyUrl('ftp://www.tiktok.com/x')).toBeNull();
    expect(classifyUrl('not a url')).toBeNull();
    expect(classifyUrl('https://eviltiktok.com.attacker.net/x')).toBeNull();
  });
});
