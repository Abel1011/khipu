from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.container import get_container

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the container OUTSIDE the try: with require_persistence on, a missing
    # Qdrant/Postgres raises here and ABORTS startup (fail loud, not just in logs).
    container = get_container()
    # Seed synchronously (batched, idempotent) so the store is ready before the
    # first request - no race where an early question hits an empty memory.
    try:
        count = container.seed()
        log.info("seeded", memories=count)
    except Exception as exc:  # seeding needs the embedder; keep serving if it fails
        log.warning("seed_failed", error=str(exc))

    # Autonomous lifecycle: decay runs hourly (and once at boot), consolidation nightly.
    scheduler = None
    try:
        from datetime import datetime, timezone

        from apscheduler.schedulers.background import BackgroundScheduler

        from app.application.jobs import run_consolidation, run_decay

        def _decay_job():
            log.info("decay_job_ran", **run_decay(get_container()))

        def _consolidation_job():
            log.info("consolidation_job_ran", **run_consolidation(get_container()))

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            _decay_job, "interval", hours=1, id="decay",
            next_run_time=datetime.now(timezone.utc),  # also recompute strengths at boot
        )
        scheduler.add_job(_consolidation_job, "cron", hour=3, id="consolidation")
        scheduler.start()
        log.info("lifecycle_scheduler_started", jobs=["decay:hourly", "consolidation:nightly"])
    except Exception as exc:  # the app still serves; jobs stay admin-triggerable
        log.warning("scheduler_failed", error=str(exc))
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Khipu", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
