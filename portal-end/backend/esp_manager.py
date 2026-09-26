import asyncio
import logging

from bleak import BleakClient, BleakScanner

# -- configuration --
# bluetooth gateway connection
SERVICE_UUID = "7b2f3a91-8c64-4f2e-a7d1-91c8e7b5d421"
CHARACTERISTIC_UUID = "a12b3c45-6789-4def-8123-456789abcdef"
SCAN_INTERVAL = 5

# -- logging --
logger = logging.getLogger(__name__)

# -- bluetooth status --
ble_client: BleakClient | None = None
ble_device = None

# -- bluetooth --
async def find_esp32():

    logger.info("Scanning for gateway ESP32...")

    devices = await BleakScanner.discover(
        timeout=5,
        return_adv=True
    )

    for device, advertisement_data in devices.values():

        logger.info(
            f"Found device: {device.name} | {device.address}"
        )

        service_uuids = advertisement_data.service_uuids

        if SERVICE_UUID.lower() in [
            uuid.lower()
            for uuid in service_uuids
        ]:

            logger.info(
                "Found gateway ESP32"
            )

            return device

    return None


async def connect_to_esp32():

    global ble_client
    global ble_device

    while True:

        try:

            device = await find_esp32()

            if device is None:

                logger.info(
                    "Gateway ESP32 not found. Retrying..."
                )

                await asyncio.sleep(
                    SCAN_INTERVAL
                )

                continue

            logger.info(
                f"Connecting to {device.name}..."
            )

            client = BleakClient(device)

            await client.connect()

            if client.is_connected:

                ble_client = client
                ble_device = device

                logger.info(
                    f"Connected to {device.name}"
                )

                # stay connected
                while client.is_connected:

                    await asyncio.sleep(1)

                logger.warning(
                    "Gateway ESP32 disconnected."
                )

                ble_client = None
                ble_device = None

        except Exception as e:

            logger.error(
                f"BLE error: {e}"
            )

            ble_client = None
            ble_device = None

        logger.info(
            "Retrying ESP32 connection..."
        )

        await asyncio.sleep(
            SCAN_INTERVAL
        )