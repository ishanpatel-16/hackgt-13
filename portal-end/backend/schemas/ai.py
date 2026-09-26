from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Responder(str, Enum):
    MEDICAL_EMS = "medical_ems"
    FIRE_RESCUE = "fire_rescue"
    LAW_ENFORCEMENT = "law_enforcement"
    TECHNICAL_SAR = "technical_sar"
    HUMANITARIAN_CARE = "humanitarian_care"
    COAST_GUARD = "coast_guard"


class ProcessPacketIn(BaseModel):
    """Packet / report fields used for AI processing."""

    msg_id: int | None = None
    category: int = 0
    people: int = 0
    needs: int = 0
    location: str = ""
    message: str = ""
    gps_lat: float | None = None
    gps_lon: float | None = None
    gps_accuracy: int | None = None

    prompt_name: str = "report_process"
    include_prompt: bool = False
    # If true and msg_id is set, write AI fields back onto that report.
    persist: bool = False


class ProcessResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ai_summary: str | None = None
    ai_priority: int | None = None
    ai_category: int | None = None
    ai_responders: list[str] = Field(default_factory=list)
    status: str
    prompt_name: str
    prompt: str | None = None


class PromptOut(BaseModel):
    name: str
    content: str


class PromptUpdate(BaseModel):
    content: str = Field(min_length=1)
