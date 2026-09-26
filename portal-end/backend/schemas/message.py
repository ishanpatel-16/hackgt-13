from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    msg_id: int | None = None
    direction: str
    user_id: int | None = None
    reply_to: int
    target_node: int | None = None
    path: list[int] | None = None
    sender: str
    text: str
    status: str
    created_at: datetime
