# Platform status

"Tested" means automated tests with synthetic fixtures only. The development environment cannot reach the real sites,
so **no live download has been run from it**. Live tests are your step, using the **Run extraction test** button in the panel.

| Platform | Status | How it works | Known limits |
|---|---|---|---|
| TikTok (`tiktok.com`, `vm.`/`vt.`) | Implemented, live test pending | Reads the page data for `playAddr`, then `downloadAddr`, then `og:video` | Page layout changes. Video URLs expire and may be tied to the requesting IP. |
| Pinterest (`pinterest.*`, `pin.it`) | Implemented, live test pending | `og:video` meta tag, then `v*.pinimg.com/videos/*.mp4` in the page; picks the highest quality | Image-only pins are rejected with "no video". |
| YouTube (`youtube.com`, `youtu.be`) | **Not implemented on Workers** | Replies with a clear message | The old Python project used yt-dlp, which cannot run on Workers. Cloudflare-only extraction needs signature decoding and anti-bot tokens, which is not reliable on the free plan. |
| Instagram (`instagram.com`) | **Not implemented on Workers** | Replies with a clear message | Most content needs a login. Public scraping is unreliable and risks the account. |

Limits that apply to all platforms:
- Maximum file size: **50 MB**. Larger files are rejected with a clear message.
- Only **public** links work. Private accounts, stories, and login-only content are not supported.
- Downloads depend on the source site's current page structure and on whether it allows Cloudflare's IP ranges.
