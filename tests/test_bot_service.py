"""Telegram behaviour rules, exercised with a fake gateway and fake job queue."""

from __future__ import annotations

import pytest

from mediabot.bot.service import BotDependencies, BotService
from mediabot.bot.types import IncomingCallback, IncomingMessage
from mediabot.db.repositories import PlatformRepo, PreferenceRepo
from mediabot.i18n import get_translator
from mediabot.jobs.guards import SlidingWindowLimiter, TTLCache
from mediabot.jobs.models import SubmitResult
from mediabot.platforms.service import PlatformService, seed_default_platforms
from mediabot.security.secrets_box import SecretBox
from mediabot.services.preferences import PreferenceStore
from mediabot.urls.detect import MessageEntity
from mediabot.services.settings import RuntimeSettings

from .conftest import TEST_SECRET

BOT_NAME = "mediadl_test_bot"


class FakeGateway:
    def __init__(self):
        self.sent = []
        self.edits = []
        self.answers = []
        self.next_id = 500

    async def send_text(self, chat_id, text, *, reply_to=None, keyboard=None):  # type: ignore[no-untyped-def]
        self.next_id += 1
        self.sent.append({"chat_id": chat_id, "text": text, "reply_to": reply_to, "keyboard": keyboard,
                          "id": self.next_id})
        return self.next_id

    async def edit_text(self, chat_id, message_id, text, keyboard=None):  # type: ignore[no-untyped-def]
        self.edits.append((message_id, text))
        return True

    async def delete_message(self, chat_id, message_id):  # type: ignore[no-untyped-def]
        raise AssertionError("user messages must never be deleted")

    async def answer_callback(self, callback_id, text=None):  # type: ignore[no-untyped-def]
        self.answers.append((callback_id, text))

    async def chat_action(self, chat_id, action):  # type: ignore[no-untyped-def]
        pass

    async def send_media(self, chat_id, reply_to, media):  # type: ignore[no-untyped-def]
        raise AssertionError("not used in these tests")


class FakeJobs:
    def __init__(self):
        self.submitted = []

    def submit(self, job):  # type: ignore[no-untyped-def]
        self.submitted.append(job)
        return SubmitResult.ACCEPTED


@pytest.fixture
def service(db):
    repo = PlatformRepo(db)
    seed_default_platforms(repo)
    repo.set_enabled("youtube", True)
    gateway = FakeGateway()
    jobs = FakeJobs()
    box = SecretBox(TEST_SECRET)
    settings = RuntimeSettings(max_urls_per_message=2, rate_limit_user_per_minute=60, rate_limit_chat_per_minute=60)
    deps = BotDependencies(
        translator=get_translator(),
        settings=lambda: settings,
        platforms=PlatformService(repo),
        preferences=PreferenceStore("minimal", box, PreferenceRepo(db)),
        jobs=jobs,
        keyer=box,
        gateway=gateway,
        username=lambda: BOT_NAME,
        dedupe=TTLCache(),
        limiter=SlidingWindowLimiter(),
    )
    svc = BotService(deps)
    svc.gateway = gateway
    svc.jobs = jobs
    svc.prefs = deps.preferences
    return svc


_update_id = iter(range(1, 10_000))


def msg(text, chat_type="private", user_id=7, entities=(), message_id=10, chat_id=None):  # type: ignore[no-untyped-def]
    return IncomingMessage(update_id=next(_update_id), chat_id=chat_id or (7 if chat_type == "private" else -100),
                           chat_type=chat_type, message_id=message_id, user_id=user_id, is_bot=False,
                           text=text, entities=tuple(entities))


async def test_private_start_sends_welcome_with_language_buttons(service):
    await service.handle_message(msg("/start"))
    assert len(service.gateway.sent) == 1
    sent = service.gateway.sent[0]
    assert sent["keyboard"] is not None
    assert sent["reply_to"] is None


async def test_group_chatter_gets_no_reply(service):
    await service.handle_message(msg("hello everyone, nice weather", chat_type="supergroup"))
    assert service.gateway.sent == []


async def test_group_start_only_when_addressed(service):
    await service.handle_message(msg("/start", chat_type="supergroup"))
    assert service.gateway.sent == [], "bare /start in a group is not addressed to the bot"
    await service.handle_message(msg("/start@someone_else", chat_type="supergroup"))
    assert service.gateway.sent == []
    await service.handle_message(msg(f"/start@{BOT_NAME}", chat_type="supergroup", message_id=44))
    assert len(service.gateway.sent) == 1 and service.gateway.sent[0]["reply_to"] == 44


async def test_supported_link_is_queued_once_and_replies_to_the_message(service):
    url = "https://youtu.be/jNQXAC9IVRw"
    entity = MessageEntity(type="url", offset=0, length=len(url))
    update = msg(url, entities=[entity], message_id=77)
    await service.handle_message(update)
    assert len(service.jobs.submitted) == 1
    job = service.jobs.submitted[0]
    assert job.platform.key == "youtube"
    assert service.gateway.sent[0]["reply_to"] == 77
    # Telegram retries the same update: nothing new happens.
    await service.handle_message(update)
    assert len(service.jobs.submitted) == 1


async def test_disabled_or_unknown_platform_links_are_ignored(service):
    await service.handle_message(msg("https://www.tiktok.com/@a/video/123"))
    await service.handle_message(msg("https://example.com/file.mp4"))
    assert service.jobs.submitted == [] and service.gateway.sent == []


async def test_multiple_links_are_limited_by_configuration(service):
    text = "https://youtu.be/aaaaaaaaaaa https://youtu.be/bbbbbbbbbbb https://youtu.be/ccccccccccc"
    await service.handle_message(msg(text, chat_type="group", user_id=8, message_id=5))
    assert len(service.jobs.submitted) == 2  # max_urls_per_message=2
    assert any("2" in s["text"] or "limit" in s["text"].lower() for s in service.gateway.sent)


async def test_group_language_change_is_a_toast_only(service):
    cb = IncomingCallback(update_id=999, callback_id="cb1", chat_id=-100, chat_type="supergroup",
                          message_id=3, user_id=9, data="lang:fa")
    await service.handle_callback(cb)
    assert service.gateway.edits == [], "shared group messages are never edited"
    assert service.gateway.answers and service.gateway.answers[0][0] == "cb1"
    assert service.prefs.get(9) == "fa", "the clicking user's own preference changes"
    assert service.prefs.get(10) is None, "other members keep their language"


async def test_private_language_change_updates_only_that_user(service):
    cb = IncomingCallback(update_id=1000, callback_id="cb2", chat_id=21, chat_type="private",
                          message_id=4, user_id=21, data="lang:fa")
    await service.handle_callback(cb)
    assert service.prefs.get(21) == "fa"
    assert service.prefs.get(22) is None
    assert service.gateway.edits, "private welcome message may be updated in place"
