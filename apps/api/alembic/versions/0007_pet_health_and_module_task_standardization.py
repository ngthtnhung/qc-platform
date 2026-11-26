"""pet health and module task standardization

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.alter_column(
            'last_check_status',
            existing_type=sa.String(length=40),
            type_=sa.Text(),
            existing_nullable=False,
        )

    with op.batch_alter_table('modules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('subsystem_slug', sa.String(length=60), server_default='', nullable=False))
        batch_op.add_column(sa.Column('standard_roles', JSON, server_default='[]', nullable=False))

    with op.batch_alter_table('automation_tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('flow_code', sa.String(length=60), server_default='', nullable=False))
        batch_op.add_column(sa.Column('automation_mode', sa.String(length=20), server_default='AUTO', nullable=False))
        batch_op.add_column(sa.Column('target_modules', JSON, server_default='[]', nullable=False))
        batch_op.add_column(sa.Column('preconditions', JSON, server_default='[]', nullable=False))
        batch_op.add_column(sa.Column('data_policy', JSON, server_default='{}', nullable=False))
        batch_op.add_column(sa.Column('expected_criteria', JSON, server_default='[]', nullable=False))
        batch_op.add_column(sa.Column('manual_checklist', JSON, server_default='[]', nullable=False))
        batch_op.create_check_constraint(
            'automation_mode_valid',
            "automation_mode IN ('AUTO','SEMI_AUTO','MANUAL')",
        )

    insp = sa.inspect(op.get_bind())
    existing_cks = [c["name"] for c in insp.get_check_constraints("automation_task_params") if c.get("name")]
    with op.batch_alter_table('automation_task_params', schema=None) as batch_op:
        batch_op.add_column(sa.Column('options', JSON, server_default='[]', nullable=False))
        for ck_name in existing_cks:
            if 'type_valid' in ck_name:
                batch_op.drop_constraint(op.f(ck_name), type_='check')
        batch_op.create_check_constraint(
            'type_valid',
            "type IN ('text','multiline','list','file','number','date','select')",
        )

    with op.batch_alter_table('executions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_module', sa.String(length=40), nullable=True))

    with op.batch_alter_table('execution_schedules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_module', sa.String(length=40), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('execution_schedules', schema=None) as batch_op:
        batch_op.drop_column('target_module')

    with op.batch_alter_table('executions', schema=None) as batch_op:
        batch_op.drop_column('target_module')

    insp = sa.inspect(op.get_bind())
    existing_param_cks = [c["name"] for c in insp.get_check_constraints("automation_task_params") if c.get("name")]
    with op.batch_alter_table('automation_task_params', schema=None) as batch_op:
        for ck_name in existing_param_cks:
            if 'type_valid' in ck_name:
                batch_op.drop_constraint(op.f(ck_name), type_='check')
        batch_op.create_check_constraint(
            'type_valid',
            "type IN ('text','multiline','list','file')",
        )
        batch_op.drop_column('options')

    existing_task_cks = [c["name"] for c in insp.get_check_constraints("automation_tasks") if c.get("name")]
    with op.batch_alter_table('automation_tasks', schema=None) as batch_op:
        for ck_name in existing_task_cks:
            if 'automation_mode_valid' in ck_name:
                batch_op.drop_constraint(op.f(ck_name), type_='check')
        batch_op.drop_column('manual_checklist')
        batch_op.drop_column('expected_criteria')
        batch_op.drop_column('data_policy')
        batch_op.drop_column('preconditions')
        batch_op.drop_column('target_modules')
        batch_op.drop_column('automation_mode')
        batch_op.drop_column('flow_code')

    with op.batch_alter_table('modules', schema=None) as batch_op:
        batch_op.drop_column('standard_roles')
        batch_op.drop_column('subsystem_slug')

    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.alter_column(
            'last_check_status',
            existing_type=sa.Text(),
            type_=sa.String(length=40),
            existing_nullable=False,
        )
