"""Command-line tools: run the service, create admins, validate configuration."""

from __future__ import annotations

import argparse
import getpass
import secrets
import sys

from mediabot import __version__
from mediabot.config import ConfigError, load_config
from mediabot.db.database import Database, open_database
from mediabot.db.repositories import AdminRepo
from mediabot.security.passwords import hash_password, password_problem


def _cmd_gen_secret(_: argparse.Namespace) -> int:
    print(secrets.token_urlsafe(48))
    return 0


def _read_password(args: argparse.Namespace) -> str | None:
    if args.password_stdin:
        return sys.stdin.readline().rstrip("\n")
    if not sys.stdin.isatty():
        print("Refusing to read a password from a non-interactive stdin. Use --password-stdin.", file=sys.stderr)
        return None
    first = getpass.getpass("New password (min 12 characters): ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        print("Passwords do not match.", file=sys.stderr)
        return None
    return first


def _open_db() -> Database:
    config = load_config()
    config.require_valid()
    db = open_database(config)
    db.migrate()
    return db


def _cmd_create_admin(args: argparse.Namespace) -> int:
    username = args.username.strip().lower()
    if not username or len(username) > 64 or not username.replace("_", "").replace("-", "").replace(".", "").isalnum():
        print("Usernames may contain letters, digits, dot, dash and underscore (max 64).", file=sys.stderr)
        return 2
    password = _read_password(args)
    if password is None:
        return 2
    problem = password_problem(password)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    db = _open_db()
    try:
        repo = AdminRepo(db)
        if repo.get_by_username(username):
            print("An administrator with this username already exists. Use reset-password instead.", file=sys.stderr)
            return 1
        repo.create(username, hash_password(password))
        print(f"Administrator '{username}' created.")
    finally:
        db.close()
    return 0


def _cmd_reset_password(args: argparse.Namespace) -> int:
    password = _read_password(args)
    if password is None:
        return 2
    problem = password_problem(password)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    db = _open_db()
    try:
        repo = AdminRepo(db)
        admin = repo.get_by_username(args.username.strip().lower())
        if admin is None:
            print("No such administrator.", file=sys.stderr)
            return 1
        repo.update_password(admin.id, hash_password(password))
        db.execute("DELETE FROM admin_sessions WHERE admin_id = ?", (admin.id,))
        print("Password updated and existing sessions were signed out.")
    finally:
        db.close()
    return 0


def _cmd_check(_: argparse.Namespace) -> int:
    import asyncio

    from mediabot.media.ffmpeg import ffmpeg_version, locate_ffmpeg
    from mediabot.platforms.ytdlp import ytdlp_version

    try:
        config = load_config()
        config.require_valid()
    except ConfigError as exc:
        print(f"Configuration problem:\n{exc}", file=sys.stderr)
        return 2
    db = open_database(config)
    applied = db.migrate()
    print(f"MediaDownloaderBot {__version__}")
    location = "Cloudflare D1 via Worker bridge" if config.db_backend == "d1" else str(config.resolved_database_path)
    print(f"database     : {location} (schema {db.schema_version()}, applied now: {applied or 'none'})")
    print(f"persistence  : {config.persistence_mode}")
    print(f"bot token    : {'set' if config.bot_token else 'not in environment (may be saved in the panel)'}")
    print(f"yt-dlp       : {ytdlp_version() or 'NOT INSTALLED'}")
    ffmpeg = locate_ffmpeg(config.ffmpeg_path)
    version = asyncio.run(ffmpeg_version(ffmpeg)) if ffmpeg else None
    print(f"ffmpeg       : {version or 'NOT FOUND'}")
    db.close()
    return 0 if ytdlp_version() and version else 1


def _cmd_run(_: argparse.Namespace) -> int:
    from mediabot.app import run

    return run()


def _cmd_migrate(_: argparse.Namespace) -> int:
    db = _open_db()
    print(f"Schema version: {db.schema_version()}")
    db.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mediabot", description="MediaDownloaderBot command-line tools.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("run", help="Start the bot and admin panel (default).").set_defaults(func=_cmd_run)
    sub.add_parser("gen-secret", help="Print a random APP_SECRET_KEY.").set_defaults(func=_cmd_gen_secret)
    sub.add_parser("check", help="Validate configuration and dependencies.").set_defaults(func=_cmd_check)
    sub.add_parser("migrate", help="Apply database migrations.").set_defaults(func=_cmd_migrate)
    for name, func, help_text in (
        ("create-admin", _cmd_create_admin, "Create an administrator account."),
        ("reset-password", _cmd_reset_password, "Reset an administrator password."),
    ):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--username", required=True)
        p.add_argument("--password-stdin", action="store_true", help="Read the password from stdin.")
        p.set_defaults(func=func)
    args = parser.parse_args(argv)
    func = getattr(args, "func", _cmd_run)
    return int(func(args))


if __name__ == "__main__":
    raise SystemExit(main())
