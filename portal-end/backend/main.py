import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

import esp_manager
from database import Base, engine
from models import Message, Node, Report, User  # noqa: F401
from packet_handler import mark_stale_nodes_offline

# -- configuration --
# logging
logging.basicConfig(
    level=logging.INFO
)

logger = logging.getLogger(__name__)

# node status sweep
OFFLINE_SWEEP_INTERVAL = 5


# -- fast api --
# lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):

    logger.info("Starting FastAPI backend...")

    # create sql tables
    Base.metadata.create_all(bind=engine)

    # start bluetooth connection
    ble_task = asyncio.create_task(
        esp_manager.connect_to_esp32()
    )

    # mark nodes offline without heartbeats
    sweep_task = asyncio.create_task(
        _offline_sweep()
    )

    yield

    # stop bluetooth connection
    logger.info("Stopping FastAPI backend...")

    ble_task.cancel()
    sweep_task.cancel()

    for task in (ble_task, sweep_task):

        try:
            await task
        except asyncio.CancelledError:
            pass


async def _offline_sweep():

    while True:

        try:

            marked = await asyncio.to_thread(
                mark_stale_nodes_offline
            )

            if marked:
                logger.info(
                    f"Marked {marked} node(s) offline"
                )

        except Exception as e:

            logger.error(
                f"Offline sweep error: {e}"
            )

        await asyncio.sleep(
            OFFLINE_SWEEP_INTERVAL
        )


# app
app = FastAPI(
    lifespan=lifespan
)

# routes
@app.get("/")
async def root():

    return {
        "status": "online"
    }
