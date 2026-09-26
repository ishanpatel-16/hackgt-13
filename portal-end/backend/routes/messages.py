from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models.message import Message
from models.user import User
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
