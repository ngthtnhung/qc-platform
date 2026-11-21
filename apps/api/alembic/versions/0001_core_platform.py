"""core platform

Revision ID: 0001
Revises: 
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _pg_extensions() -> None:
    if _is_pg():
        # image pgvector/pgvector đã có sẵn các extension này
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def _audit_append_only() -> None:
    """audit_logs chỉ được thêm: chặn UPDATE/DELETE bằng trigger (PostgreSQL)."""
    if _is_pg():
        op.execute("""
            CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END;
            $$ LANGUAGE plpgsql;
        """)
        op.execute("""
            CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
        """)


def upgrade() -> None:
    _pg_extensions()
    op.create_table('ai_suggestions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('source_ref', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('module_code', sa.String(length=40), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=False),
    sa.Column('content_hash', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('PROPOSED','ACCEPTED','REJECTED')", name=op.f('ck_ai_suggestions_status_valid')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_suggestions'))
    )
    with op.batch_alter_table('ai_suggestions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_ai_suggestions_kind'), ['kind'], unique=False)
        batch_op.create_index(batch_op.f('ix_ai_suggestions_status'), ['status'], unique=False)

    op.create_table('audit_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor_type', sa.String(length=16), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('actor_username', sa.String(length=64), nullable=True),
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('resource_type', sa.String(length=60), nullable=False),
    sa.Column('resource_id', sa.String(length=80), nullable=False),
    sa.Column('decision', sa.String(length=16), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('before', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('after', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('correlation_id', sa.String(length=64), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_logs'))
    )
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_logs_action'), ['action'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_logs_actor_id'), ['actor_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_logs_at'), ['at'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_logs_correlation_id'), ['correlation_id'], unique=False)

    op.create_table('environments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('base_url', sa.String(length=500), nullable=False),
    sa.Column('login_url', sa.String(length=500), nullable=False),
    sa.Column('org_identifier', sa.String(length=120), nullable=False),
    sa.Column('allowed_actions', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('requires_org_confirmation', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('legacy_id', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("type <> 'PRODUCTION_TEST' OR requires_org_confirmation", name=op.f('ck_environments_prod_test_needs_org_confirm')),
    sa.CheckConstraint("type IN ('STAGING','PRODUCTION_TEST','PRODUCTION','TASK_SYSTEM')", name=op.f('ck_environments_type_valid')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_environments')),
    sa.UniqueConstraint('code', name=op.f('uq_environments_code')),
    sa.UniqueConstraint('legacy_id', name=op.f('uq_environments_legacy_id'))
    )
    op.create_table('files',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('mime', sa.String(length=120), nullable=False),
    sa.Column('original_name', sa.String(length=200), nullable=False),
    sa.Column('storage_backend', sa.String(length=10), nullable=False),
    sa.Column('storage_key', sa.String(length=300), nullable=False),
    sa.Column('owner_id', sa.Uuid(), nullable=True),
    sa.Column('legacy_id', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('retention_until', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_files')),
    sa.UniqueConstraint('legacy_id', name=op.f('uq_files_legacy_id'))
    )
    with op.batch_alter_table('files', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_files_sha256'), ['sha256'], unique=False)

    op.create_table('jobs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=60), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('result', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('celery_task_id', sa.String(length=64), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_jobs'))
    )
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jobs_kind'), ['kind'], unique=False)

    op.create_table('secrets',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
    sa.Column('nonce', sa.LargeBinary(), nullable=False),
    sa.Column('wrapped_dek', sa.LargeBinary(), nullable=False),
    sa.Column('dek_nonce', sa.LargeBinary(), nullable=False),
    sa.Column('key_version', sa.Integer(), nullable=False),
    sa.Column('aad', sa.String(length=120), nullable=False),
    sa.Column('updated_by', sa.Uuid(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_secrets'))
    )
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('employee_code', sa.String(length=40), nullable=False),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('must_change_password', sa.Boolean(), nullable=False),
    sa.Column('failed_login_count', sa.Integer(), nullable=False),
    sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('legacy_id', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('qc')", name=op.f('ck_users_role_qc_only')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('legacy_id', name=op.f('uq_users_legacy_id'))
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_username'), ['username'], unique=True)

    op.create_table('accounts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('environment_id', sa.Uuid(), nullable=False),
    sa.Column('owner_user_id', sa.Uuid(), nullable=True),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('role_label', sa.String(length=120), nullable=False),
    sa.Column('username_ref', sa.String(length=200), nullable=False),
    sa.Column('expected_org_ref', sa.String(length=120), nullable=False),
    sa.Column('default_route', sa.String(length=500), nullable=False),
    sa.Column('routes', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('kb_links', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('kb_can_do', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('kb_cannot_do', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('secret_id', sa.Uuid(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('legacy_id', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['environment_id'], ['environments.id'], name=op.f('fk_accounts_environment_id_environments'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], name=op.f('fk_accounts_owner_user_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['secret_id'], ['secrets.id'], name=op.f('fk_accounts_secret_id_secrets'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_accounts')),
    sa.UniqueConstraint('legacy_id', name=op.f('uq_accounts_legacy_id'))
    )
    with op.batch_alter_table('accounts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_accounts_environment_id'), ['environment_id'], unique=False)
        batch_op.create_index('uq_accounts_env_username', ['environment_id', 'username_ref'], unique=True)

    op.create_table('approval_requests',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('subject_type', sa.String(length=60), nullable=False),
    sa.Column('subject_id', sa.String(length=80), nullable=False),
    sa.Column('origin', sa.String(length=8), nullable=False),
    sa.Column('requested_by_type', sa.String(length=16), nullable=False),
    sa.Column('requested_by_id', sa.Uuid(), nullable=True),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('payload_hash', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('decided_by_id', sa.Uuid(), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decision_note', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("origin IN ('ai','human')", name=op.f('ck_approval_requests_origin_valid')),
    sa.CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','CANCELLED')", name=op.f('ck_approval_requests_status_valid')),
    sa.CheckConstraint("status IN ('PENDING','CANCELLED') OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)", name=op.f('ck_approval_requests_decision_has_human')),
    sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], name=op.f('fk_approval_requests_decided_by_id_users'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_approval_requests'))
    )
    with op.batch_alter_table('approval_requests', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_approval_requests_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_approval_requests_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_approval_requests_subject_type'), ['subject_type'], unique=False)
        batch_op.create_index('uq_approval_one_pending_per_subject', ['subject_type', 'subject_id'], unique=True, sqlite_where=sa.text("status = 'PENDING'"), postgresql_where=sa.text("status = 'PENDING'"))

    op.create_table('auth_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('refresh_hash', sa.String(length=64), nullable=False),
    sa.Column('prev_refresh_hash', sa.String(length=64), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('user_agent', sa.String(length=300), nullable=False),
    sa.Column('ip', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_auth_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_sessions')),
    sa.UniqueConstraint('refresh_hash', name=op.f('uq_auth_sessions_refresh_hash'))
    )
    with op.batch_alter_table('auth_sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_auth_sessions_user_id'), ['user_id'], unique=False)

    _audit_append_only()


def downgrade() -> None:
    if _is_pg():
        op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs")
        op.execute("DROP FUNCTION IF EXISTS audit_logs_immutable()")
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('auth_sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_auth_sessions_user_id'))

    op.drop_table('auth_sessions')
    with op.batch_alter_table('approval_requests', schema=None) as batch_op:
        batch_op.drop_index('uq_approval_one_pending_per_subject', sqlite_where=sa.text("status = 'PENDING'"), postgresql_where=sa.text("status = 'PENDING'"))
        batch_op.drop_index(batch_op.f('ix_approval_requests_subject_type'))
        batch_op.drop_index(batch_op.f('ix_approval_requests_status'))
        batch_op.drop_index(batch_op.f('ix_approval_requests_created_at'))

    op.drop_table('approval_requests')
    with op.batch_alter_table('accounts', schema=None) as batch_op:
        batch_op.drop_index('uq_accounts_env_username')
        batch_op.drop_index(batch_op.f('ix_accounts_environment_id'))

    op.drop_table('accounts')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_username'))

    op.drop_table('users')
    op.drop_table('secrets')
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_jobs_kind'))

    op.drop_table('jobs')
    with op.batch_alter_table('files', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_files_sha256'))

    op.drop_table('files')
    op.drop_table('environments')
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_logs_correlation_id'))
        batch_op.drop_index(batch_op.f('ix_audit_logs_at'))
        batch_op.drop_index(batch_op.f('ix_audit_logs_actor_id'))
        batch_op.drop_index(batch_op.f('ix_audit_logs_action'))

    op.drop_table('audit_logs')
    with op.batch_alter_table('ai_suggestions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_ai_suggestions_status'))
        batch_op.drop_index(batch_op.f('ix_ai_suggestions_kind'))

    op.drop_table('ai_suggestions')
    # ### end Alembic commands ###
