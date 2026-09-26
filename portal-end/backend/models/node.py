from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Node(Base):
    __tablename__ = "nodes"

    node_id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[int] = mapped_column(Integer)
    clients: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[list | None] = mapped_column(JSON, nullable=True)

    uptime_s: Mapped[int] = mapped_column(Integer, default=0)
    tx: Mapped[int] = mapped_column(Integer, default=0)
    rx: Mapped[int] = mapped_column(Integer, default=0)
    battery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    neighbors: Mapped[list] = mapped_column(JSON, default=list)

    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
