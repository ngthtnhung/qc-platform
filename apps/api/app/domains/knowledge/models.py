"""Reference Library có quản trị: nguồn gốc → tham chiếu → rule. AI chỉ đề xuất; QC mới chuyển sang VALIDATED."""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts, utcnow

VALIDATION = "('UNREVIEWED','VALIDATED','REJECTED','DISPUTED')"


class Module(Base):
    __tablename__ = "modules"
    id: Mapped[uuid.UUID] = pk()
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    cluster_code: Mapped[str] = mapped_column(String(40), default="")
    prefix: Mapped[str] = mapped_column(String(40), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    usage_flow: Mapped[str] = mapped_column(Text, default="")
    flows: Mapped[list] = mapped_column(JsonType, default=list)  # [{code,name,menu,note,stage}] giữ nguyên cấu trúc nguồn
    subsystem_slug: Mapped[str] = mapped_column(String(60), default="")
    standard_roles: Mapped[list] = mapped_column(JsonType, default=list)
    extra: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[dt.datetime] = ts()


class Source(Base):
    """Nguồn gốc (SOP, tài liệu BA/FS, ảnh, video…). Bất biến; bản mới = source_version mới."""

    __tablename__ = "sources"
    __table_args__ = (Index("uq_sources_kind_title", "kind", "title", unique=True),)
    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(400))
    external_url: Mapped[str] = mapped_column(String(1000), default="")
    # Nguồn tra cứu trích dẫn: ba_doc | figma | task_function | code_wiki (+ loại cũ của Kho). retired ⇒ không còn được tìm.
    status: Mapped[str] = mapped_column(String(10), default="active", server_default="active")
    meta: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class SourceVersion(Base):
    __tablename__ = "source_versions"
    __table_args__ = (Index("uq_source_versions_source_label", "source_id", "label", unique=True),)
    id: Mapped[uuid.UUID] = pk()
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="RESTRICT"), index=True)
    label: Mapped[str] = mapped_column(String(120))  # doc_version hoặc ngày; "unversioned" nếu nguồn không có
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    meta: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[dt.datetime] = ts()


class Reference(Base):
    __tablename__ = "references"
    __table_args__ = (
        CheckConstraint(f"validation_status IN {VALIDATION}", name="validation_valid"),
        CheckConstraint("validation_status <> 'VALIDATED' OR validated_by IS NOT NULL", name="validated_has_human"),
        Index("uq_references_version_quote", "source_version_id", "content_hash", unique=True),
    )
    id: Mapped[uuid.UUID] = pk()
    module_code: Mapped[str] = mapped_column(String(40), index=True)
    flow_code: Mapped[str] = mapped_column(String(40), default="")
    source_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_versions.id", ondelete="RESTRICT"), index=True)
    locator: Mapped[dict] = mapped_column(JsonType, default=dict)  # section/page/text_lines/frame/task_id/url
    quote: Mapped[str] = mapped_column(Text, default="")
    stance: Mapped[str] = mapped_column(String(20), default="")
    content_hash: Mapped[str] = mapped_column(String(64))
    validation_status: Mapped[str] = mapped_column(String(12), default="UNREVIEWED", index=True)
    validated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    validated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class ReferenceLink(Base):
    __tablename__ = "reference_links"
    __table_args__ = (
        CheckConstraint("type IN ('refines','conflicts_with','supersedes','depends_on')", name="type_valid"),
        CheckConstraint("from_ref_id <> to_ref_id", name="no_self_link"),
        Index("uq_reference_links", "from_ref_id", "to_ref_id", "type", unique=True),
    )
    id: Mapped[uuid.UUID] = pk()
    from_ref_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("references.id", ondelete="CASCADE"), index=True)
    to_ref_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("references.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[uuid.UUID] = pk()
    reference_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("references.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = ts()


class BusinessRule(Base):
    __tablename__ = "business_rules"
    id: Mapped[uuid.UUID] = pk()
    rule_key: Mapped[str] = mapped_column(String(60), unique=True)  # ví dụ DV5S-001 hoặc MAINT-P001
    module_code: Mapped[str] = mapped_column(String(40), index=True)
    flow_code: Mapped[str] = mapped_column(String(40), default="")
    origin: Mapped[str] = mapped_column(String(20), default="kb")  # kb | platform | ai
    legacy_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class BusinessRuleVersion(Base):
    __tablename__ = "business_rule_versions"
    __table_args__ = (
        CheckConstraint("state IN ('active','pending','archived','retired')", name="state_valid"),
        CheckConstraint(f"validation_status IN {VALIDATION}", name="validation_valid"),
        CheckConstraint("validation_status <> 'VALIDATED' OR validated_by IS NOT NULL", name="validated_has_human"),
        Index("uq_rule_versions_rule_no", "rule_id", "version_no", unique=True),
    )
    id: Mapped[uuid.UUID] = pk()
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_rules.id", ondelete="RESTRICT"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(10), default="pending")
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str] = mapped_column(Text)
    user_roles: Mapped[list] = mapped_column(JsonType, default=list)
    setting_type: Mapped[str] = mapped_column(String(30), default="unknown")
    setting_label: Mapped[str] = mapped_column(String(80), default="")
    config_path: Mapped[str] = mapped_column(String(300), default="")
    classification: Mapped[str] = mapped_column(String(40), default="")
    open_questions: Mapped[list] = mapped_column(JsonType, default=list)
    extra: Mapped[dict] = mapped_column(JsonType, default=dict)  # business_logic, exceptions, ai_interpretation… (không bỏ trường nào của nguồn)
    legacy_approval: Mapped[dict | None] = mapped_column(JsonType, nullable=True)  # ai đã duyệt ở Kho ngoài; KHÔNG thay thế duyệt của QC
    content_hash: Mapped[str] = mapped_column(String(64))
    search_fold: Mapped[str] = mapped_column(Text, default="")  # khóa + tên + mô tả, không dấu: tìm kiếm
    validation_status: Mapped[str] = mapped_column(String(12), default="UNREVIEWED", index=True)
    validated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    validated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_type: Mapped[str] = mapped_column(String(16), default="SYSTEM")
    created_at: Mapped[dt.datetime] = ts()
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class RuleVersionReference(Base):
    __tablename__ = "rule_version_references"
    rule_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("business_rule_versions.id", ondelete="CASCADE"), primary_key=True)
    reference_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("references.id", ondelete="RESTRICT"), primary_key=True)
