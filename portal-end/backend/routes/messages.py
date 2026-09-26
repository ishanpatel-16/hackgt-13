from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models.message import Message
from models.report import Report
from models.user import User
from packets.esp_manager import queue_downlink
from packets.packet_codec import encode_downlink, frame_packet
from packets.serial_schema import REPLY_MSG_MAX, SENDER_MAX
from packets.serial_schema import Message as DownlinkMessage
from schemas.message import MessageOut

router = APIRouter(prefix="/api/messages", tags=["messages"])


class MessageCreate(BaseModel):
    msg_id: Optional[int] = None
    direction: str = "downlink"
    user_id: Optional[int] = None
    reply_to: int = 0
    target_node: Optional[int] = None
    path: Optional[list[int]] = None
    sender: str = ""
    text: str
    status: str = "pending"


class MessageUpdate(BaseModel):
    direction: Optional[str] = None
    user_id: Optional[int] = None
    reply_to: Optional[int] = None
    target_node: Optional[int] = None
    path: Optional[list[int]] = None
    sender: Optional[str] = None
    text: Optional[str] = None
    status: Optional[str] = None


class MessageSend(BaseModel):
    user_id: int = Field(ge=1, le=65535)
    text: str = Field(min_length=1, max_length=REPLY_MSG_MAX)
    sender: str = Field(default="Portal", max_length=SENDER_MAX)
    reply_to: Optional[int] = Field(default=None, ge=0, le=4294967295)


@router.get("", response_model=list[MessageOut])
def list_messages(
    user_id: Optional[int] = Query(None),
    direction: Optional[str] = Query(None),
    reply_to: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Message).order_by(Message.created_at.desc())
    if user_id is not None:
        q = q.filter(Message.user_id == user_id)
    if direction is not None:
        q = q.filter(Message.direction == direction)
    if reply_to is not None:
        q = q.filter(Message.reply_to == reply_to)
    return q.limit(limit).all()


@router.post("/send", response_model=MessageOut, status_code=201)
def send_message(payload: MessageSend, db: Session = Depends(get_db)):
    """Create a downlink message for a user and queue it to the gateway over BLE."""
    user = db.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.origin is None:
        raise HTTPException(
            status_code=400,
            detail="User has no origin node; cannot route downlink",
        )

    reply_to = payload.reply_to
    if reply_to is None:
        latest = (
            db.query(Report)
            .filter(Report.user_id == payload.user_id)
            .order_by(Report.created_at.desc())
            .first()
        )
        reply_to = latest.msg_id if latest is not None else 0

    downlink = DownlinkMessage(
        target_node=user.origin,
        user_id=payload.user_id,
        reply_to=reply_to,
        sender=payload.sender,
        text=payload.text,
    )

    now = datetime.now(timezone.utc)
    msg = Message(
        msg_id=None,
        direction="downlink",
        user_id=payload.user_id,
        reply_to=reply_to,
        target_node=user.origin,
        path=None,
        sender=payload.sender,
        text=payload.text,
        status="pending",
        created_at=now,
    )
    db.add(msg)
    db.flush()

    framed = frame_packet(encode_downlink(downlink))
    msg.status = "sent" if queue_downlink(framed) else "pending"

    db.commit()
    db.refresh(msg)
    return msg


def _messages_for_user(
    db: Session,
    user_id: int,
    direction: str,
    limit: int,
) -> list[Message]:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return (
        db.query(Message)
        .filter(Message.user_id == user_id, Message.direction == direction)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/upstream/{user_id}", response_model=list[MessageOut])
def list_upstream_messages(
    user_id: int,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return _messages_for_user(db, user_id, "uplink", limit)


@router.get("/downstream/{user_id}", response_model=list[MessageOut])
def list_downstream_messages(
    user_id: int,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return _messages_for_user(db, user_id, "downlink", limit)


@router.get("/{message_id}", response_model=MessageOut)
def get_message(message_id: int, db: Session = Depends(get_db)):
    msg = db.get(Message, message_id)
    if not msg:
        # try msg_id lookup
        msg = db.query(Message).filter(Message.msg_id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


@router.post("", response_model=MessageOut, status_code=201)
def create_message(payload: MessageCreate, db: Session = Depends(get_db)):
    if payload.msg_id is not None:
        existing = db.query(Message).filter(Message.msg_id == payload.msg_id).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"msg_id {payload.msg_id} already exists")
    # ensure user if provided
    if payload.user_id is not None:
        user = db.get(User, payload.user_id)
        if not user:
            now = datetime.now(timezone.utc)
            user = User(user_id=payload.user_id, name="", phone="", first_seen=now, last_seen=now)
            db.add(user)
            db.flush()
    now = datetime.now(timezone.utc)
    msg = Message(
        msg_id=payload.msg_id,
        direction=payload.direction,
        user_id=payload.user_id,
        reply_to=payload.reply_to,
        target_node=payload.target_node,
        path=payload.path,
        sender=payload.sender,
        text=payload.text,
        status=payload.status,
        created_at=now,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.patch("/{message_id}", response_model=MessageOut)
def update_message(message_id: int, payload: MessageUpdate, db: Session = Depends(get_db)):
    msg = db.get(Message, message_id)
    if not msg:
        msg = db.query(Message).filter(Message.msg_id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(msg, k, v)
    db.commit()
    db.refresh(msg)
    return msg


@router.delete("/{message_id}", status_code=204)
def delete_message(message_id: int, db: Session = Depends(get_db)):
    msg = db.get(Message, message_id)
    if not msg:
        msg = db.query(Message).filter(Message.msg_id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    db.delete(msg)
    db.commit()
    return None
