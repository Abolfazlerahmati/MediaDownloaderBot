// Built-in platforms. `implemented` means the Workers build has an extractor for it.
// Admin-defined yt-dlp platforms from the Python version are not available on Workers.
export const MEDIA_PLATFORM_SEEDS: Array<{ key: string; name: string; enabled: boolean; implemented: boolean }> = [
  { key: 'tiktok', name: 'TikTok', enabled: true, implemented: true },
  { key: 'pinterest', name: 'Pinterest', enabled: true, implemented: true },
  { key: 'youtube', name: 'YouTube', enabled: false, implemented: false },
  { key: 'instagram', name: 'Instagram', enabled: false, implemented: false },
];
