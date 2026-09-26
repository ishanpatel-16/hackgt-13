from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from packets.serial_schema import REPLY_MSG_MAX, SENDER_MAX


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("msg_id", name="uq_messages_msg_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    msg_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    direction: Mapped[str] = mapped_column(String(8))

    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.user_id"), nullable=True, index=True
    )
    reply_to: Mapped[int] = mapped_column(Integer, default=0, index=True)
    target_node: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path: Mapped[list | None] = mapped_column(JSON, nullable=True)

    sender: Mapped[str] = mapped_column(String(SENDER_MAX), default="")
    text: Mapped[str] = mapped_column(String(REPLY_MSG_MAX))

    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped["User | None"] = relationship(back_populates="messages")
