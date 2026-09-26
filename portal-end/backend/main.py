import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

import esp_manager

# -- configuration --
# logging
logging.basicConfig(
    level=logging.INFO
)

logger = logging.getLogger(__name__)


# -- lifespan --
@asynccontextmanager
async def lifespan(app: FastAPI):

    logger.info("Starting FastAPI backend...")

    # start bluetooth connection
    ble_task = asyncio.create_task(
        esp_manager.connect_to_esp32()
    )

    yield

    # stop bluetooth connection
    logger.info("Stopping FastAPI backend...")

    ble_task.cancel()

    try:
        await ble_task
    except asyncio.CancelledError:
        pass


# -- app --
app = FastAPI(
    lifespan=lifespan
)

# -- routes --
@app.get("/")
async def root():

    return {
        "status": "online"
    }