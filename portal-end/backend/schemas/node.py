from datetime import datetime

from pydantic import BaseModel, ConfigDict

from serial_schema import Neighbor


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    node_id: int
    role: int
    status: str
    clients: int
    path: list[int] | None = None
    uptime_s: int
    tx: int
    rx: int
    battery: int | None = None
    neighbors: list[Neighbor]
    last_seen: datetime
