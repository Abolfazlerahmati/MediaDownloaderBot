"""Pipeline and job-manager behaviour with a fake adapter and notifier (no network, no ffmpeg)."""

from __future__ import annotations

import asyncio

import pytest

from mediabot.errors import ErrorCode, MediaError
from mediabot.jobs import pipeline as pipeline_module
from mediabot.jobs.manager import JobManager
from mediabot.jobs.models import JobRequest, SubmitResult
from mediabot.jobs.pipeline import DownloadPipeline, PipelineDeps
from mediabot.jobs.tempfiles import TempStore
from mediabot.media.delivery import DeliveryKind
from mediabot.platforms.base import DownloadedFile, MediaInfo, MediaType, PlatformAdapter
from mediabot.services.settings import RuntimeSettings

from .conftest import make_record

MP4_HEAD = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200
MP3_HEAD = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 200


def info(media_type=MediaType.VIDEO, **kwargs) -> MediaInfo:
    base = dict(
        platform_key="youtube", media_type=media_type, source_id="abc", title="Sample: Title",
        ext=None, duration=12.0, width=640, height=360, filesize=1000, is_live=False,
        thumbnail_url=None, artist=None, track=None, extractor="youtube", has_video=True, has_audio=True,
    )
    base.update(kwargs)
    return MediaInfo(**base)


class FakeAdapter(PlatformAdapter):
    adapter_key = "fake"
    display_name = "Fake"
    description = "test"
    calls: list[str] = []
    fail_probe_times = 0
    payload = MP4_HEAD
    ext = "mp4"
    crash = False

    def __init__(self, record, context, media_info):  # type: ignore[no-untyped-def]
        super().__init__(record, context)
        self._info = media_info

    @classmethod
    def canonicalize(cls, url, record):  # type: ignore[no-untyped-def]
        return url.raw

    async def probe(self, url, workdir):  # type: ignore[no-untyped-def]
        FakeAdapter.calls.append("probe")
        if FakeAdapter.crash:
            raise RuntimeError("secret internal detail")
        if FakeAdapter.fail_probe_times > 0:
            FakeAdapter.fail_probe_times -= 1
            raise MediaError(ErrorCode.TEMPORARY, "upstream hiccup")
        return self._info

    async def download(self, url, info, workdir):  # type: ignore[no-untyped-def]
        FakeAdapter.calls.append("download")
        path = workdir / f"video.{FakeAdapter.ext}"
        path.write_bytes(FakeAdapter.payload)
        return DownloadedFile(path=path, ext=FakeAdapter.ext, size=path.stat().st_size)

    def classify_error(self, output):  # type: ignore[no-untyped-def]
        return ErrorCode.UNKNOWN if hasattr(ErrorCode, "UNKNOWN") else ErrorCode.DOWNLOAD_FAILED

    async def self_test(self, workdir):  # type: ignore[no-untyped-def]
        raise NotImplementedError


class RecordingNotifier:
    def __init__(self):
        self.media = []
        self.errors = []
        self.stages = []

    async def on_stage(self, job, stage):  # type: ignore[no-untyped-def]
        self.stages.append(stage)

    async def on_media(self, job, media):  # type: ignore[no-untyped-def]
        self.media.append(media)

    async def on_error(self, job, code):  # type: ignore[no-untyped-def]
        self.errors.append(code)


@pytest.fixture(autouse=True)
def reset_fake():
    FakeAdapter.calls = []
    FakeAdapter.fail_probe_times = 0
    FakeAdapter.payload = MP4_HEAD
    FakeAdapter.ext = "mp4"
    FakeAdapter.crash = False
    pipeline_module._backoff = lambda base, attempt: 0  # keep retry tests instant
    yield


def settings(**overrides) -> RuntimeSettings:
    values = dict(validate_with_ffmpeg=False, min_free_disk_mb=64, retry_max_attempts=2,
                  retry_base_delay_seconds=1, thumbnails_enabled=False)
    values.update(overrides)
    return RuntimeSettings(**values)


def make_pipeline(tmp_path, media_info, **settings_overrides):
    temp = TempStore(tmp_path / "tmp")
    temp.ensure()
    notifier = RecordingNotifier()
    deps = PipelineDeps(
        settings=lambda: settings(**settings_overrides),
        temp=temp,
        ffmpeg_path=None,
        adapter_factory=lambda record, ctx: FakeAdapter(record, ctx, media_info),
        notifier=notifier,
    )
    return DownloadPipeline(deps), notifier, temp


def job_for(record=None, url="https://youtu.be/abc") -> JobRequest:
    return JobRequest(chat_id=1, reply_to_message_id=2, chat_type="private", url=url, url_key="k",
                      platform=record or make_record(), language="en", dedupe_key="1:2:k")


async def test_successful_video_is_delivered_as_video_and_workdir_removed(tmp_path):
    pipe, notifier, temp = make_pipeline(tmp_path, info(title="Sample: Title"))
    await pipe.run(job_for())
    assert len(notifier.media) == 1
    media = notifier.media[0]
    assert media.kind == DeliveryKind.VIDEO
    assert media.display_name.endswith(".mp4")
    assert "/" not in media.display_name and ":" not in media.display_name
    assert notifier.errors == []
    assert not any(temp.jobs_dir.iterdir()), "temporary files must be removed after delivery"


async def test_audio_is_delivered_as_audio(tmp_path):
    FakeAdapter.payload = MP3_HEAD
    FakeAdapter.ext = "mp3"
    pipe, notifier, _ = make_pipeline(tmp_path, info(MediaType.AUDIO, title="Song"))
    await pipe.run(job_for())
    assert notifier.media[0].kind == DeliveryKind.AUDIO


async def test_estimated_size_over_limit_is_refused_before_download(tmp_path):
    pipe, notifier, _ = make_pipeline(tmp_path, info(filesize=10 * 1024 * 1024 * 1024))
    await pipe.run(job_for(make_record(max_file_size_mb=50)))
    assert notifier.errors == [ErrorCode.TOO_LARGE]
    assert "download" not in FakeAdapter.calls


async def test_disabled_media_type_is_refused(tmp_path):
    pipe, notifier, _ = make_pipeline(tmp_path, info(MediaType.VIDEO))
    await pipe.run(job_for(make_record(allowed_media_types=["audio"])))
    assert notifier.errors == [ErrorCode.UNSUPPORTED_MEDIA]


async def test_temporary_failures_are_retried_then_succeed(tmp_path):
    FakeAdapter.fail_probe_times = 1
    pipe, notifier, _ = make_pipeline(tmp_path, info())
    await pipe.run(job_for())
    assert FakeAdapter.calls.count("probe") == 2
    assert len(notifier.media) == 1 and notifier.errors == []


async def test_wrong_file_signature_fails_validation(tmp_path):
    FakeAdapter.payload = b"<html>not a video</html>" * 20
    pipe, notifier, _ = make_pipeline(tmp_path, info())
    await pipe.run(job_for())
    assert notifier.errors == [ErrorCode.VALIDATION_FAILED]
    assert notifier.media == []


async def test_unexpected_errors_never_leak_internal_details(tmp_path):
    FakeAdapter.crash = True
    pipe, notifier, _ = make_pipeline(tmp_path, info())
    await pipe.run(job_for())
    assert notifier.errors == [ErrorCode.DOWNLOAD_FAILED]


async def test_thumbnails_are_never_substituted_across_items(tmp_path):
    # An audio item without its own embedded cover must not receive another item's thumbnail.
    FakeAdapter.payload = MP3_HEAD
    FakeAdapter.ext = "mp3"
    pipe, notifier, _ = make_pipeline(tmp_path, info(MediaType.AUDIO, title="No cover"), thumbnails_enabled=True)
    await pipe.run(job_for())
    assert notifier.media[0].thumbnail_path is None


# ----------------------------------------------------------------------- job manager
class BlockingPipeline:
    def __init__(self):
        self.gate = asyncio.Event()
        self.started = []
        self.notifier = RecordingNotifier()

    async def run(self, job):  # type: ignore[no-untyped-def]
        self.started.append(job.job_id)
        await self.gate.wait()


async def test_manager_accepts_dedupes_and_limits_queue():
    pipe = BlockingPipeline()
    manager = JobManager(pipe, lambda: 1)
    assert manager.submit(job_for()) == SubmitResult.NOT_RUNNING
    await manager.start(1)
    first = job_for()
    assert manager.submit(first) == SubmitResult.ACCEPTED
    assert manager.submit(job_for()) == SubmitResult.DUPLICATE  # same dedupe key while in flight
    await asyncio.sleep(0.05)  # worker picks up the first job
    second = job_for()
    second.dedupe_key = "other"
    third = job_for()
    third.dedupe_key = "third"
    assert manager.submit(second) == SubmitResult.ACCEPTED
    assert manager.submit(third) == SubmitResult.QUEUE_FULL
    snapshot = manager.snapshot()
    assert snapshot["workers_alive"] == 1 and snapshot["queued"] == 1
    pipe.gate.set()
    await manager.stop(grace_seconds=1)


async def test_manager_cancels_active_job():
    pipe = BlockingPipeline()
    manager = JobManager(pipe, lambda: 5)
    await manager.start(1)
    job = job_for()
    manager.submit(job)
    await asyncio.sleep(0.05)
    assert await manager.cancel(job.job_id) is True
    assert await manager.cancel("nope") is False
    await manager.stop(grace_seconds=1)
