"""
net0 serial schema (v3, ESP-NOW v2), backend side.

Mirrors packets.h. The gateway ESP32 prints one JSON object per line over USB;
the backend sends JSON lines back. This file is the single source of truth for
that JSON on the Python side. If packets.h changes, change this too.

Usage:
    from packets.serial_schema import parse_uplink, dump_downlink, Report, Heartbeat, UserReply, Ack, Message

    pkt = parse_uplink(line)          # -> Report | UserReply | Heartbeat, or raises ValidationError
    ser.write(dump_downlink(Ack(target_node=1, user_id=4821, acked_msg_id=pkt.msg_id)))

Run this file directly to export serial_schema.json (standard JSON Schema).
"""
from __future__ import annotations

import json
from enum import IntEnum
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

# ---------------------------------------------------------------------------
# Limits (must match packets.h). Text limits in packets.h are BYTES;
# Pydantic counts characters, and characters <= bytes, so these are safe upper bounds.
# ---------------------------------------------------------------------------
MAX_HOPS = 8
NAME_MAX = 32
PHONE_MAX = 20
LOCATION_MAX = 120
REPORT_MSG_MAX = 500
SENDER_MAX = 32
REPLY_MSG_MAX = 400
GATEWAY_ID = 9
BROADCAST = 255
MAX_NEIGHBORS = 16

U8 = Annotated[int, Field(ge=0, le=255)]
U16 = Annotated[int, Field(ge=0, le=65535)]
U32 = Annotated[int, Field(ge=0, le=4_294_967_295)]
NodeId = Annotated[int, Field(ge=1, le=254)]
UserId = Annotated[int, Field(ge=1, le=65535)]
Path = Annotated[list[NodeId], Field(min_length=1, max_length=MAX_HOPS)]


# ---------------------------------------------------------------------------
# Lookup tables (mirror the enums in packets.h)
# ---------------------------------------------------------------------------
class Category(IntEnum):
    UNKNOWN = 0
    MEDICAL = 1
    TRAPPED = 2
    FIRE = 3
    FLOOD = 4
    STRUCTURAL = 5
    SECURITY = 6
    HAZMAT = 7
    OTHER = 8


class Severity(IntEnum):
    UNKNOWN = 0
    LOW = 1
    MODERATE = 2
    HIGH = 3
    LIFE_THREATENING = 4


class Role(IntEnum):
    RELAY = 1
    ACCESS = 2
    GATEWAY = 3


# Bit flags for Report.needs
NEEDS = {
    "injured": 1 << 0,
    "rescue": 1 << 1,
    "mobility": 1 << 2,
    "meds": 1 << 3,
    "water": 1 << 4,
    "shelter": 1 << 5,
    "vulnerable": 1 << 6,
}


def decode_needs(needs: int) -> list[str]:
    """3 -> ['injured', 'rescue']"""
    return [name for name, bit in NEEDS.items() if needs & bit]


class _Strict(BaseModel):
    # Reject unknown fields, so a typo on either side fails loudly instead of silently.
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Gateway -> backend (uplink)
# ---------------------------------------------------------------------------
class Gps(_Strict):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: U16


class Report(_Strict):
    """The SOS. Dedup on msg_id (ignore attempt)."""
    type: Literal["report"]
    msg_id: U32
    attempt: U8 = 0
    origin: NodeId               # access node the phone used
    path: Path                   # e.g. [1, 2, 3, 9]: draw the hop animation from this
    user_id: UserId
    category: Category
    severity: Severity
    people: U8                   # 0 = unknown
    needs: U8                    # bit flags; use decode_needs()
    gps: Optional[Gps] = None    # always null until HTTPS/GPS is implemented
    name: str = Field("", max_length=NAME_MAX)
    phone: str = Field("", max_length=PHONE_MAX)
    location: str = Field(max_length=LOCATION_MAX)
    message: str = Field("", max_length=REPORT_MSG_MAX)


class UserReply(_Strict):
    """Follow-up from the user after the first report. Dedup on msg_id."""
    type: Literal["user_reply"]
    msg_id: U32
    attempt: U8 = 0
    origin: NodeId
    path: Path
    user_id: UserId
    reply_to: U32                # msg_id of the original Report
    text: str = Field(max_length=REPLY_MSG_MAX)


class Neighbor(_Strict):
    id: NodeId
    rssi: int = Field(ge=-128, le=0)   # dBm: -40 strong ... -90 weak


class Heartbeat(_Strict):
    """Node status. Mark a node offline if no heartbeat for ~15 s."""
    type: Literal["heartbeat"]
    node: NodeId
    role: Role
    clients: U8                  # phones connected (access nodes only)
    path: Path
    uptime_s: U32
    tx: U16
    rx: U16
    battery: Optional[int] = Field(None, ge=0, le=100)   # null = unknown
    neighbors: list[Neighbor] = Field(default_factory=list, max_length=MAX_NEIGHBORS)


Uplink = Annotated[Union[Report, UserReply, Heartbeat], Field(discriminator="type")]


# ---------------------------------------------------------------------------
# Backend -> gateway (downlink)
# ---------------------------------------------------------------------------
class Ack(_Strict):
    """Send right after saving a Report or UserReply, so the phone shows 'Delivered'."""
    type: Literal["ack"] = "ack"
    target_node: NodeId          # the Report's origin
    user_id: UserId
    acked_msg_id: U32


class Message(_Strict):
    """Responder -> user. target_node=255 reaches every access node; user_id=0 reaches everyone."""
    type: Literal["message"] = "message"
    target_node: Annotated[int, Field(ge=1, le=255)]
    user_id: U16                 # 0 = everyone on target_node(s)
    reply_to: U32 = 0            # Report msg_id, 0 = general alert
    sender: str = Field(max_length=SENDER_MAX)
    text: str = Field(max_length=REPLY_MSG_MAX)


Downlink = Annotated[Union[Ack, Message], Field(discriminator="type")]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_uplink = TypeAdapter(Uplink)
_downlink = TypeAdapter(Downlink)


def parse_uplink(line: str) -> Report | UserReply | Heartbeat:
    """Parse one serial line. Raises pydantic.ValidationError if it doesn't match."""
    return _uplink.validate_json(line)


def dump_downlink(pkt: Ack | Message) -> bytes:
    """Serialize for ser.write(): compact JSON + newline."""
    return (pkt.model_dump_json() + "\n").encode("utf-8")


def export_json_schema(path: str = "serial_schema.json") -> None:
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "net0 serial protocol v3",
        "uplink": _uplink.json_schema(),
        "downlink": _downlink.json_schema(mode="serialization"),
    }
    with open(path, "w") as f:
        json.dump(schema, f, indent=2)


if __name__ == "__main__":
    export_json_schema()
    print("wrote serial_schema.json")
