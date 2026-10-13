# Live test checklist (run by you)

The sandbox cannot reach Telegram or the platforms' live servers, so none of the items below were run there. Tick
each one after you test it in your deployment and note the result in the table at the bottom.

## Before you start
- Deployment is green in Workers Builds.
- Panel: first login, password changed, **Bot and health** → webhook registered.
- Platforms: enable one platform at a time and use **Test** with a public sample link.

## Bot, private chat
1. `/start` → welcome text in the chosen language.
2. `/help` → help text with the link limit and the size limit.
3. `/language` → buttons; pick Persian; the next reply is in Persian. Pick English to switch back.
4. Plain text with no link → "Please send a link."
5. A link from an unsupported site → "not from a supported site."
6. A TikTok link → video arrives as a reply to your message.
7. A Pinterest link → video arrives.
8. A YouTube link (only after you enable YouTube) → video, or a clear error. Record which.
9. An Instagram link (only after you enable Instagram) → video, or a clear error. Record which.
10. Three links in one message → three results in order.
11. Four or more links → the first three are processed and a notice says so.
12. The same link twice within the dedupe window → "already being processed."
13. Six links within a minute with a limit of 5 → the sixth gets the rate-limit message.
14. A video over 50 MB → the size error, no file sent.

## Bot, group
15. Plain chat in the group with no mention → no reply.
16. `@YourBot <tiktok link>` → result replies to that message.
17. `/help` in the group → help text plus the mention hint.
18. Set group mode to "Ignore groups" in the panel → no replies in groups.

## Bot control
19. Turn the bot off in the panel → private chats get the maintenance message; groups get nothing.
20. Turn the bot back on → downloads work again.

## Panel
21. Login throttle: five wrong passwords → locked out for 15 minutes.
22. Session expiry after 12 hours.
23. Settings: enter an out-of-range value → field error, nothing saved.
24. Logs: search by severity and text; the 7-day default cleanup runs hourly.
25. Diagnostics page: no token, secret, or full link appears.
26. Theme: each theme in light, dark, and system mode; system follows the device.

## Results

| # | Result (pass / fail / not tested) | Platform, if relevant | Note |
|---|---|---|---|
|   |   |   |   |
