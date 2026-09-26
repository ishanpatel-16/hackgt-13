import asyncio
import logging

from bleak import BleakClient, BleakScanner

from packets.packet_codec import decode_uplink, feed_frames
from packets.packet_handler import handle_uplink

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

# -- packet queues --
_rx_buffer = bytearray()
_uplink_queue: asyncio.Queue[bytes] | None = None
_downlink_queue: asyncio.Queue[bytes] | None = None
_loop: asyncio.AbstractEventLoop | None = None


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


def _on_notify(sender, data: bytearray):

    if _uplink_queue is None or _loop is None:
        return

    _loop.call_soon_threadsafe(
        _uplink_queue.put_nowait,
        bytes(data),
    )


def _queue_downlink(framed: bytes) -> None:

    if _downlink_queue is None or _loop is None:
        return

    _loop.call_soon_threadsafe(
        _downlink_queue.put_nowait,
        framed,
    )


async def _process_uplink(chunk: bytes):

    global _rx_buffer

    try:

        payloads = feed_frames(
            _rx_buffer,
            chunk
        )

        for payload in payloads:

            pkt = decode_uplink(payload)

            logger.info(
                f"Uplink {pkt.type} ({len(payload)} bytes)"
            )

            await asyncio.to_thread(
                handle_uplink,
                pkt,
                _queue_downlink,
            )

    except Exception as e:

        logger.error(
            f"Failed to parse BLE payload: {e}"
        )


async def _flush_downlink(client: BleakClient):

    if _downlink_queue is None:
        return

    while not _downlink_queue.empty():

        framed = _downlink_queue.get_nowait()

        await client.write_gatt_char(
            CHARACTERISTIC_UUID,
            framed,
            response=False,
        )

        logger.info(
            f"Sent downlink ({len(framed)} bytes)"
        )


async def connect_to_esp32():

    global ble_client
    global ble_device
    global _rx_buffer
    global _uplink_queue
    global _downlink_queue
    global _loop

    _loop = asyncio.get_running_loop()
    _uplink_queue = asyncio.Queue()
    _downlink_queue = asyncio.Queue()

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
                _rx_buffer.clear()

                await client.start_notify(
                    CHARACTERISTIC_UUID,
                    _on_notify,
                )

                logger.info(
                    f"Connected to {device.name}"
                )

                # stay connected + handle packets
                while client.is_connected:

                    try:

                        chunk = await asyncio.wait_for(
                            _uplink_queue.get(),
                            timeout=0.1,
                        )

                        await _process_uplink(chunk)

                    except asyncio.TimeoutError:
                        pass

                    await _flush_downlink(client)

                logger.warning(
                    "Gateway ESP32 disconnected."
                )

                try:
                    await client.stop_notify(
                        CHARACTERISTIC_UUID
                    )
                except Exception:
                    pass

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
