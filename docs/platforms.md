# Platform status

"Tested" means automated tests with synthetic fixtures only. The development environment cannot reach the real sites,
so **no live download has been run from it**. Live tests are your step, using the **Run extraction test** button in the panel.

| Platform | Status | How it works | Known limits |
|---|---|---|---|
| TikTok (`tiktok.com`, `vm.`/`vt.`) | Implemented, live test pending | Reads the page data for `playAddr`, then `downloadAddr`, then `og:video` | Page layout changes. Video URLs expire and may be tied to the requesting IP. |
| Pinterest (`pinterest.*`, `pin.it`) | Implemented, live test pending | `og:video` meta tag, then `v*.pinimg.com/videos/*.mp4` in the page; picks the highest quality | Image-only pins are rejected with "no video". |
| YouTube (`youtube.com`, `youtu.be`, shorts, embed, live) | Implemented, live test pending. Disabled by default | Calls YouTube's public player API (Android client), then takes the highest progressive MP4 without a cipher | Only single-file MP4s (usually 360p or 720p). Separate high-quality video and audio need ffmpeg, which Workers cannot run, so they are not used. YouTube can refuse datacenter IPs, age-restricted and private videos, and changes its API without notice. |
| Instagram (`instagram.com`: posts, reels, TV) | Implemented, live test pending. Disabled by default | Reads the public embed page for `video_url`, then `og:video` | Login-only, private, and story content is not supported. Instagram changes its pages often, and an empty result is common. |

Limits that apply to all platforms:
- Maximum file size: **50 MB**. Larger files are rejected with a clear message.
- Only **public** links work. Private accounts, stories, and login-only content are not supported.
- YouTube and Instagram are disabled until you run the extraction test and enable them in **Platforms**.
- Downloads depend on the source site's current page structure and on whether it allows Cloudflare's IP ranges.
