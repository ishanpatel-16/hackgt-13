"""add ai_responders to reports

Revision ID: a1b2c3d4e5f6
Revises: f89845517850
Create Date: 2026-09-26 00:42:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f89845517850"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("ai_responders", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reports", "ai_responders")
