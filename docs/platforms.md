# Platform status

Status is per platform. "Tested" means automated tests with synthetic HTML fixtures only. Live downloads
have **not** been tested against the real sites from the development environment, which cannot reach them.

| Platform | Status | How it works | Known limits |
|---|---|---|---|
| TikTok (`tiktok.com`, `vm.`/`vt.`) | Implemented, live test pending | Reads the page data script for `playAddr`, then `downloadAddr`, then `og:video` | Page layout changes. Video URLs expire and can be tied to IP. |
| Pinterest (`pinterest.*`, `pin.it`) | Implemented, live test pending | `og:video` meta tag, then `v*.pinimg.com/videos/*.mp4` in the page; picks the highest quality | Image-only pins are rejected with "no video". |
| YouTube (`youtube.com`, `youtu.be`) | **Not implemented** | Replies with a clear message | Needs signature decoding and anti-bot tokens; not feasible on Workers free with the required reliability. Downloading also conflicts with YouTube's terms. |
| Instagram (`instagram.com`) | **Not implemented** | Replies with a clear message | Most content needs a login. Scraping it risks the account. |

Limits that apply to all platforms:
- Maximum file size: **50 MB**. Larger files are rejected with a clear message. Telegram's Bot API upload limit is 50 MB, and a self-hosted Bot API server is not possible on the free plan.
- Only **public** links work.
