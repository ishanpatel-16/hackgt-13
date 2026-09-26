"""add persistent incident cluster ids to reports

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reports", sa.Column("cluster_id", sa.String(length=64), nullable=True))
    op.create_index("ix_reports_cluster_id", "reports", ["cluster_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_reports_cluster_id", table_name="reports")
    op.drop_column("reports", "cluster_id")
