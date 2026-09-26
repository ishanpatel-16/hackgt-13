from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models.node import Node, utcnow
from schemas.node import NodeOut
from packets.serial_schema import GATEWAY_ID, MAX_HOPS

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


class NodeCreate(BaseModel):
    node_id: int = Field(ge=1, le=254)
    role: int = 1
    status: str = "online"
    clients: int = 0
    path: Optional[list[int]] = None
    uptime_s: int = 0
    tx: int = 0
    rx: int = 0
    battery: Optional[int] = None
    neighbors: list[dict] = Field(default_factory=list)


class NodeUpdate(BaseModel):
    role: Optional[int] = None
    status: Optional[str] = None
    clients: Optional[int] = None
    path: Optional[list[int]] = None
    uptime_s: Optional[int] = None
    tx: Optional[int] = None
    rx: Optional[int] = None
    battery: Optional[int] = None
    neighbors: Optional[list[dict]] = None


@router.get("", response_model=list[NodeOut])
def list_nodes(db: Session = Depends(get_db)):
    return db.query(Node).order_by(Node.node_id).all()


@router.get("/{node_id}", response_model=NodeOut)
def get_node(node_id: int, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.post("", response_model=NodeOut, status_code=201)
def create_node(payload: NodeCreate, db: Session = Depends(get_db)):
    if db.get(Node, payload.node_id):
        raise HTTPException(status_code=409, detail="Node already exists")
    node = Node(
        node_id=payload.node_id,
        role=payload.role,
        status=payload.status,
        clients=payload.clients,
        path=payload.path if payload.path is not None else [payload.node_id],
        uptime_s=payload.uptime_s,
        tx=payload.tx,
        rx=payload.rx,
        battery=payload.battery,
        neighbors=payload.neighbors,
        last_seen=utcnow(),
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.patch("/{node_id}", response_model=NodeOut)
def update_node(node_id: int, payload: NodeUpdate, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(node, k, v)
    node.last_seen = utcnow()
    db.commit()
    db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=204)
def delete_node(node_id: int, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    db.delete(node)
    db.commit()
    return None
