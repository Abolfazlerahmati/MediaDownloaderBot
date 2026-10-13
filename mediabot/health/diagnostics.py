"""Diagnostics catalogue: maps operational log categories to explanations and fixes.

Only generic, redacted text lives here. Raw log entries are shown in the log viewer.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Explanation:
    title: str
    explanation: str
    steps: tuple[str, ...]
    severity: str = "warning"  # "info" | "warning" | "error"


CATALOGUE: dict[str, Explanation] = {
    "telegram_api": Explanation(
        "Telegram API problem",
        "The bot could not talk to the Telegram API, or Telegram rejected the bot token.",
        ("Run the Telegram API test on the Bot & Health page.",
         "If it says the token was rejected, copy a fresh token from @BotFather and save it in Settings or BOT_TOKEN.",
         "If it says the API cannot be reached, check outbound HTTPS to api.telegram.org and DNS resolution."),
        "error"),
    "bot_start_failed": Explanation(
        "Bot failed to start",
        "Polling could not be started. The panel keeps running; the bot retries automatically when the cause is network-related.",
        ("Check the token and outbound connectivity, then press Restart bot.",
         "Review the operational log entries for this category."),
        "error"),
    "telegram_polling": Explanation(
        "Temporary polling errors",
        "Telegram polling reported transient network errors. Usually harmless if they stop.",
        ("If they continue for several minutes, check network stability and firewall rules."),
        "info"),
    "handler_error": Explanation(
        "Update handler error",
        "A Telegram update could not be processed. The user received no response for that update.",
        ("Open the operational log, filter by component 'bot', and look at the message.",
         "If the error repeats after a restart, report it with the log entry (it contains no secrets)."),
        "error"),
    "platform_inaccessible": Explanation(
        "Content inaccessible or unsupported",
        "The link points to private, removed, region-locked or login-only content. This is expected for some links and is not an outage.",
        ("If many links fail for one platform, run that platform's live test on the Platforms page.",
         "Private or login-only content is intentionally not downloaded."),
        "info"),
    "platform_temporary": Explanation(
        "Temporary platform failure",
        "The platform returned rate-limit or server errors. Requests are retried automatically with backoff.",
        ("Wait a few minutes. Persistent rate limiting may need fewer requests per minute (Settings > Rate limits).",
         "Check that the server's outbound IP is not blocked by the platform."),
        "warning"),
    "extractor_changed": Explanation(
        "Extractor could not parse the site",
        "yt-dlp could not understand the platform's current page format. This usually means the extractor is outdated.",
        ("Update yt-dlp: `pip install -U yt-dlp` (or rebuild the Docker image).",
         "Restart the service and run the platform's live test."),
        "error"),
    "dependency_missing": Explanation(
        "Missing dependency",
        "A required executable such as ffmpeg was not found.",
        ("Install ffmpeg (apt install ffmpeg), or set FFMPEG_PATH to the binary.",
         "Run the dependency checks on the Bot & Health page."),
        "error"),
    "storage_error": Explanation(
        "Storage problem",
        "The temporary directory is full, not writable, or below the minimum free space.",
        ("Free disk space or lower 'Minimum free disk space' in Settings.",
         "Check ownership and permissions of the temporary directory (the process user must be able to write there)."),
        "error"),
    "download_timeout": Explanation(
        "Downloads time out",
        "Downloads are exceeding the configured timeout.",
        ("Check network bandwidth on the server.",
         "Lower the maximum file size or raise the download timeout in Settings."),
        "warning"),
    "limit_exceeded": Explanation(
        "Limits rejected media",
        "Media was rejected because it exceeded a configured size or duration limit. This is intended behaviour.",
        ("Adjust limits in Settings or on the platform's page if you want to allow larger media."),
        "info"),
    "upload_failed": Explanation(
        "Telegram upload failed",
        "The file was downloaded but Telegram did not accept it.",
        ("Confirm the bot can post in the chat (group admin rights or 'Send media' permission).",
         "Check outbound HTTPS to api.telegram.org and that the file is within Telegram's 50 MB limit."),
        "error"),
    "validation_failed": Explanation(
        "Downloaded file failed integrity checks",
        "The file was incomplete or unreadable, so it was not sent. No other file was substituted.",
        ("Retry the link later; the source may have served a damaged stream.",
         "If it happens for every link, check that ffmpeg works (dependency checks)."),
        "warning"),
    "worker_crash": Explanation(
        "Worker crashed",
        "A download worker hit an unexpected error. The worker was restarted automatically.",
        ("If it recurs, restart the service and review the stack trace in the console logs (secrets are redacted)."),
        "error"),
    "worker_error": Explanation(
        "Unexpected job error",
        "A download job failed with an unexpected error. The user received a generic failure message.",
        ("Review the log entry. Repeated errors for one platform suggest an adapter problem; run its live test."),
        "error"),
    "config_invalid": Explanation(
        "Invalid configuration",
        "Stored settings are not valid and defaults are being used.",
        ("Open Settings, correct the highlighted values and save."),
        "error"),
    "migration": Explanation(
        "Database migration",
        "Schema migrations were applied at startup.",
        ("No action needed. A failed migration stops startup; check the console output."),
        "info"),
    "migration_failed": Explanation(
        "Database migration failed",
        "The database schema could not be upgraded. The service will not start.",
        ("Back up the database file, then check the console output for the failing migration."),
        "error"),
    "storage_cleanup": Explanation(
        "Temporary cleanup",
        "Expired temporary files were removed.",
        ("No action needed."),
        "info"),
    "job_completed": Explanation("Download completed", "A job finished successfully.", (), "info"),
    "job_cancelled": Explanation("Job cancelled", "An administrator cancelled an active job.", (), "info"),
    "queue": Explanation(
        "Queue congestion",
        "New links were refused or delayed because the queue is full.",
        ("Increase the queue limit or the number of concurrent downloads (restart required for concurrency).",
         "Check whether one platform is timing out and occupying workers."),
        "warning"),
    "thumbnail": Explanation(
        "Thumbnail unavailable",
        "The item's own thumbnail could not be fetched or converted, so none was attached. This is safe.",
        (), "info"),
    "metadata": Explanation(
        "Metadata could not be read",
        "Embedded tags could not be read from the file. Delivery continues without them.",
        (), "info"),
}

_CATEGORY_HINTS: tuple[tuple[str, str], ...] = (
    ("no space left", "storage_error"),
    ("permission denied", "storage_error"),
    ("unauthorized", "telegram_api"),
    ("invalid token", "telegram_api"),
    ("timed out", "download_timeout"),
    ("ffmpeg", "dependency_missing"),
)


# Categories emitted by the application that are not covered above.
CATALOGUE.update({
    "platform_test": Explanation(
        "Platform live test needs attention",
        "A platform's live test did not pass cleanly (failed, or passed without a sample URL), so the platform cannot be relied on. An enabled platform is disabled automatically when its test fails.",
        ("Open the platform and read the test message.",
         "Choose a public sample URL that matches the platform's domains, then run the test again.",
         "If the extractor cannot parse the page, update yt-dlp (rebuild the container image)."),
        "error"),
    "health_loop": Explanation(
        "Health monitor error",
        "The background health monitor hit an unexpected error. Checks still run on demand.",
        ("Review the logged error and run the checks manually from the Bot & Health page.",),
        "error"),
    "maintenance_failed": Explanation(
        "Background maintenance error",
        "Temporary-file cleanup, log retention or session purge failed on its last run. It is retried every five minutes.",
        ("Check free disk space and the permissions of the data and temp directories.",
         "If the error repeats, open Diagnostics and download the report."),
        "error"),
    "auth_failed": Explanation(
        "Failed administrator sign-in",
        "A sign-in attempt used a wrong username or password. Repeated attempts are throttled per address and per username.",
        ("If this is not you, rotate the administrator password with the reset-password CLI command.",),
        "info"),
    "web_error": Explanation(
        "Admin panel error",
        "A request to the admin panel failed unexpectedly. The panel itself keeps running.",
        ("Reload the page. If it repeats, check the operational log for the failing request category.",),
        "error"),
    "general": Explanation(
        "General message",
        "An informational or uncategorised message.",
        (),
        "info"),
    "admin_action": Explanation("Administrator change", "A configuration change made from the admin panel.", (), "info"),
    "auth": Explanation("Administrator session", "Sign-in or sign-out event.", (), "info"),
    "startup": Explanation("Service started", "The service finished starting.", (), "info"),
    "shutdown": Explanation("Service stopping", "The service is shutting down gracefully.", (), "info"),
    "bot_started": Explanation("Bot started", "Telegram polling started.", (), "info"),
    "bot_stop": Explanation("Bot stopped", "Telegram polling stopped.", (), "info"),
    "worker_start": Explanation("Worker started", "A download worker started.", (), "info"),
    "worker_stop": Explanation("Worker stopped", "A download worker stopped.", (), "info"),
    "retry": Explanation("Retrying a download", "A transient failure is being retried automatically.", (), "info"),
})


def explain(category: str) -> Explanation:
    return CATALOGUE.get(
        category,
        Explanation(
            "Unclassified problem",
            "This entry does not match a known category. Review the raw message and the console log.",
            ("Check the operational log message, then open the Bot & Health page and run the checks.",),
            "warning",
        ),
    )


def categorize_text(text: str, default: str = "worker_error") -> str:
    lowered = text.lower()
    for needle, category in _CATEGORY_HINTS:
        if needle in lowered:
            return category
    return default
