export type Platform = 'pinterest' | 'tiktok' | 'youtube' | 'instagram';

/** Result of resolving a public page to one downloadable video file. */
export interface MediaInfo {
  platform: Platform;
  /** Direct https URL of the video file. Often short-lived. */
  videoUrl: string;
  /** Referer to send when downloading videoUrl (CDNs check it). */
  referer: string;
  title?: string;
}
