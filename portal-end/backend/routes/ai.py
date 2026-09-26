from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ai import prompts as prompt_store
from ai.process import (
    ProcessResult,
    apply_result_to_report,
    process_packet,
)
from database import get_db
from models.report import Report
from schemas.ai import (
    ProcessPacketIn,
    ProcessResultOut,
    PromptOut,
    PromptUpdate,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/process", response_model=ProcessResultOut)
def process(payload: ProcessPacketIn, db: Session = Depends(get_db)):
    """
    Run AI process on packet/report JSON.

    Returns ai_summary, ai_priority, ai_responders (and ai_category).
    While the LLM is unconfigured, status will be \"stub\".
    Set persist=true with msg_id to write results onto an existing report
    (only when status is ok).
    """
    data = payload.model_dump(
        exclude={"prompt_name", "include_prompt", "persist"}
    )

    try:
        result: ProcessResult = process_packet(
            data,
            prompt_name=payload.prompt_name,
            include_prompt=payload.include_prompt,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    if payload.persist:
        if payload.msg_id is None:
            raise HTTPException(
                status_code=400,
                detail="persist=true requires msg_id",
            )
        report = (
            db.query(Report)
            .filter(Report.msg_id == payload.msg_id)
            .first()
        )
        if report is None:
            raise HTTPException(
                status_code=404,
                detail=f"report msg_id={payload.msg_id} not found",
            )
        apply_result_to_report(report, result)
        db.commit()

    return result


@router.get("/prompts", response_model=list[str])
def list_prompts():
    return prompt_store.list_prompts()


@router.get("/prompts/{name}", response_model=PromptOut)
def get_prompt(name: str):
    try:
        content = prompt_store.load(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return PromptOut(name=name, content=content)


@router.put("/prompts/{name}", response_model=PromptOut)
def update_prompt(name: str, payload: PromptUpdate):
    prompt_store.save(name, payload.content)
    return PromptOut(name=name, content=payload.content)
