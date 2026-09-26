"""
Binary wire format for net0 packets over BLE.

Mirrors packed little-endian C structs (packets.h style).
Each BLE frame is:

    uint16_t length;   // bytes that follow
    uint8_t  payload[length];

payload[0] is the packet type. Fixed-width fields use
struct packing; strings are null-padded char arrays.
"""
from __future__ import annotations

import struct
from typing import Union

from serial_schema import (
    LOCATION_MAX,
    MAX_HOPS,
    MAX_NEIGHBORS,
    NAME_MAX,
    PHONE_MAX,
    REPLY_MSG_MAX,
    REPORT_MSG_MAX,
    SENDER_MAX,
    Ack,
    Category,
    Gps,
    Heartbeat,
    Message,
    Neighbor,
    Report,
    Role,
    Severity,
    UserReply,
)

# -- packet types --
PKT_REPORT = 1
PKT_USER_REPLY = 2
PKT_HEARTBEAT = 3
PKT_ACK = 4
PKT_MESSAGE = 5

# -- framing --
FRAME_HEADER = struct.Struct("<H")
BATTERY_UNKNOWN = 255

# -- uplink layouts --
# type, msg_id, attempt, origin, path_len, path[8],
# user_id, category, severity, people, needs,
# has_gps, lat, lon, accuracy_m
_REPORT_HDR = struct.Struct(
    f"<B I B B B {MAX_HOPS}s H B B B B B f f H"
)
_REPORT_NAME = struct.Struct(f"<{NAME_MAX}s")
_REPORT_PHONE = struct.Struct(f"<{PHONE_MAX}s")
_REPORT_LOCATION = struct.Struct(f"<{LOCATION_MAX}s")
_REPORT_MESSAGE = struct.Struct(f"<{REPORT_MSG_MAX}s")

# type, msg_id, attempt, origin, path_len, path[8],
# user_id, reply_to
_USER_REPLY_HDR = struct.Struct(
    f"<B I B B B {MAX_HOPS}s H I"
)
_USER_REPLY_TEXT = struct.Struct(f"<{REPLY_MSG_MAX}s")

# type, node, role, clients, path_len, path[8],
# uptime_s, tx, rx, battery, neighbor_count
_HEARTBEAT_HDR = struct.Struct(
    f"<B B B B B {MAX_HOPS}s I H H B B"
)
_NEIGHBOR = struct.Struct("<Bb")

# -- downlink layouts --
_ACK = struct.Struct("<B B H I")
_MESSAGE_HDR = struct.Struct("<B B H I")
_MESSAGE_SENDER = struct.Struct(f"<{SENDER_MAX}s")
_MESSAGE_TEXT = struct.Struct(f"<{REPLY_MSG_MAX}s")

UplinkPacket = Union[Report, UserReply, Heartbeat]
DownlinkPacket = Union[Ack, Message]


# -- helpers --
def _decode_c_string(raw: bytes) -> str:

    return raw.split(b"\x00", 1)[0].decode(
        "utf-8",
        errors="replace"
    )


def _encode_c_string(value: str, size: int) -> bytes:

    encoded = value.encode("utf-8")[: size - 1]
    return encoded.ljust(size, b"\x00")


def _decode_path(raw: bytes, path_len: int) -> list[int]:

    if path_len < 1 or path_len > MAX_HOPS:
        raise ValueError(
            f"invalid path_len: {path_len}"
        )

    return list(raw[:path_len])


def _encode_path(path: list[int]) -> tuple[int, bytes]:

    if not path or len(path) > MAX_HOPS:
        raise ValueError(
            f"invalid path length: {len(path)}"
        )

    raw = bytes(path) + bytes(MAX_HOPS - len(path))

    return len(path), raw


# -- framing --
def frame_packet(payload: bytes) -> bytes:

    return FRAME_HEADER.pack(len(payload)) + payload


def feed_frames(
    buffer: bytearray,
    chunk: bytes
) -> list[bytes]:
    """
    Append a BLE notification chunk and return
    any complete payloads that can be peeled off.
    """

    buffer.extend(chunk)
    payloads: list[bytes] = []

    while True:

        if len(buffer) < FRAME_HEADER.size:
            break

        (length,) = FRAME_HEADER.unpack_from(buffer, 0)
        total = FRAME_HEADER.size + length

        if length == 0 or length > 2048:
            # corrupt frame — drop one byte and resync
            del buffer[0]
            continue

        if len(buffer) < total:
            break

        payloads.append(
            bytes(buffer[FRAME_HEADER.size: total])
        )

        del buffer[:total]

    return payloads


# -- uplink decode --
def decode_uplink(payload: bytes) -> UplinkPacket:

    if not payload:
        raise ValueError("empty payload")

    pkt_type = payload[0]

    if pkt_type == PKT_REPORT:
        return _decode_report(payload)

    if pkt_type == PKT_USER_REPLY:
        return _decode_user_reply(payload)

    if pkt_type == PKT_HEARTBEAT:
        return _decode_heartbeat(payload)

    raise ValueError(
        f"unknown uplink type: {pkt_type}"
    )


def _decode_report(payload: bytes) -> Report:

    expected = (
        _REPORT_HDR.size
        + _REPORT_NAME.size
        + _REPORT_PHONE.size
        + _REPORT_LOCATION.size
        + _REPORT_MESSAGE.size
    )

    if len(payload) < expected:
        raise ValueError(
            f"report too short: {len(payload)} < {expected}"
        )

    offset = 0

    (
        pkt_type,
        msg_id,
        attempt,
        origin,
        path_len,
        path_raw,
        user_id,
        category,
        severity,
        people,
        needs,
        has_gps,
        lat,
        lon,
        accuracy_m,
    ) = _REPORT_HDR.unpack_from(payload, offset)

    offset += _REPORT_HDR.size

    name = _decode_c_string(
        _REPORT_NAME.unpack_from(payload, offset)[0]
    )
    offset += _REPORT_NAME.size

    phone = _decode_c_string(
        _REPORT_PHONE.unpack_from(payload, offset)[0]
    )
    offset += _REPORT_PHONE.size

    location = _decode_c_string(
        _REPORT_LOCATION.unpack_from(payload, offset)[0]
    )
    offset += _REPORT_LOCATION.size

    message = _decode_c_string(
        _REPORT_MESSAGE.unpack_from(payload, offset)[0]
    )

    gps = None

    if has_gps:
        gps = Gps(
            lat=lat,
            lon=lon,
            accuracy_m=accuracy_m
        )

    return Report(
        type="report",
        msg_id=msg_id,
        attempt=attempt,
        origin=origin,
        path=_decode_path(path_raw, path_len),
        user_id=user_id,
        category=Category(category),
        severity=Severity(severity),
        people=people,
        needs=needs,
        gps=gps,
        name=name,
        phone=phone,
        location=location,
        message=message,
    )


def _decode_user_reply(payload: bytes) -> UserReply:

    expected = _USER_REPLY_HDR.size + _USER_REPLY_TEXT.size

    if len(payload) < expected:
        raise ValueError(
            f"user_reply too short: {len(payload)} < {expected}"
        )

    (
        pkt_type,
        msg_id,
        attempt,
        origin,
        path_len,
        path_raw,
        user_id,
        reply_to,
    ) = _USER_REPLY_HDR.unpack_from(payload, 0)

    text = _decode_c_string(
        _USER_REPLY_TEXT.unpack_from(
            payload,
            _USER_REPLY_HDR.size
        )[0]
    )

    return UserReply(
        type="user_reply",
        msg_id=msg_id,
        attempt=attempt,
        origin=origin,
        path=_decode_path(path_raw, path_len),
        user_id=user_id,
        reply_to=reply_to,
        text=text,
    )


def _decode_heartbeat(payload: bytes) -> Heartbeat:

    if len(payload) < _HEARTBEAT_HDR.size:
        raise ValueError(
            f"heartbeat too short: {len(payload)}"
        )

    (
        pkt_type,
        node,
        role,
        clients,
        path_len,
        path_raw,
        uptime_s,
        tx,
        rx,
        battery_raw,
        neighbor_count,
    ) = _HEARTBEAT_HDR.unpack_from(payload, 0)

    if neighbor_count > MAX_NEIGHBORS:
        raise ValueError(
            f"too many neighbors: {neighbor_count}"
        )

    neighbors_size = neighbor_count * _NEIGHBOR.size
    expected = _HEARTBEAT_HDR.size + neighbors_size

    if len(payload) < expected:
        raise ValueError(
            f"heartbeat neighbors truncated: {len(payload)} < {expected}"
        )

    neighbors: list[Neighbor] = []
    offset = _HEARTBEAT_HDR.size

    for _ in range(neighbor_count):

        neighbor_id, rssi = _NEIGHBOR.unpack_from(
            payload,
            offset
        )

        neighbors.append(
            Neighbor(
                id=neighbor_id,
                rssi=rssi
            )
        )

        offset += _NEIGHBOR.size

    battery = None if battery_raw == BATTERY_UNKNOWN else battery_raw

    return Heartbeat(
        type="heartbeat",
        node=node,
        role=Role(role),
        clients=clients,
        path=_decode_path(path_raw, path_len),
        uptime_s=uptime_s,
        tx=tx,
        rx=rx,
        battery=battery,
        neighbors=neighbors,
    )


# -- downlink encode --
def encode_downlink(pkt: DownlinkPacket) -> bytes:

    if isinstance(pkt, Ack):
        return _ACK.pack(
            PKT_ACK,
            pkt.target_node,
            pkt.user_id,
            pkt.acked_msg_id,
        )

    if isinstance(pkt, Message):
        return (
            _MESSAGE_HDR.pack(
                PKT_MESSAGE,
                pkt.target_node,
                pkt.user_id,
                pkt.reply_to,
            )
            + _MESSAGE_SENDER.pack(
                _encode_c_string(pkt.sender, SENDER_MAX)
            )
            + _MESSAGE_TEXT.pack(
                _encode_c_string(pkt.text, REPLY_MSG_MAX)
            )
        )

    raise TypeError(
        f"unsupported downlink packet: {type(pkt)}"
    )
