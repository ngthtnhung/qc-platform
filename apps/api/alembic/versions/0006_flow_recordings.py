"""flow recordings

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    op.create_table('flow_recordings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('module_code', sa.String(length=40), nullable=False),
    sa.Column('start_url', sa.String(length=1000), nullable=False),
    sa.Column('raw_events', JSON, nullable=False),
    sa.Column('normalized', JSON, nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('task_id', sa.Uuid(), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_flow_recordings_created_by_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['automation_tasks.id'], name=op.f('fk_flow_recordings_task_id_automation_tasks'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_flow_recordings'))
    )


def downgrade() -> None:
    op.drop_table('flow_recordings')
