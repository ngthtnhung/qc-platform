from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import current_principal, require
from app.core.errors import NotFound
from app.core.principal import Perm, Principal
from app.domains.knowledge import service
from app.domains.knowledge.models import (
    Annotation,
    BusinessRule,
    BusinessRuleVersion,
    Module,
    Reference,
    ReferenceLink,
    RuleVersionReference,
    Source,
    SourceVersion,
)
from app.domains.platform.audit import log_audit

router = APIRouter(prefix="/library", tags=["library"])


class RuleListItem(BaseModel):
    rule_id: uuid.UUID
    rule_key: str
    module_code: str
    origin: str
    version_id: uuid.UUID
    version_no: int
    state: str
    title: str
    validation_status: str
    has_legacy_approval: bool


class RuleList(BaseModel):
    total: int
    items: list[RuleListItem]


class ReferenceOut(BaseModel):
    id: uuid.UUID
    module_code: str
    flow_code: str
    quote: str
    stance: str
    locator: dict[str, Any]
    validation_status: str
    source_title: str
    source_kind: str
    source_version: str


class RuleVersionOut(BaseModel):
    version_id: uuid.UUID
    version_no: int
    state: str
    title: str
    description: str
    user_roles: list[str]
    setting_type: str
    config_path: str
    open_questions: list[Any]
    extra: dict[str, Any]
    legacy_approval: dict[str, Any] | None
    validation_status: str
    validated_by: uuid.UUID | None
    created_by_type: str


class RuleDetail(BaseModel):
    rule_id: uuid.UUID
    rule_key: str
    module_code: str
    origin: str
    versions: list[RuleVersionOut]
    references: list[ReferenceOut]


class RuleIn(BaseModel):
    rule_key: str | None = None  # có ⇒ tạo version mới của rule đó
    module: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=400)
    description: str = Field(min_length=1)
    user_roles: list[str] = []
    setting_type: str = "unknown"
    flow: str = ""


class LinkIn(BaseModel):
    from_ref_id: uuid.UUID
    to_ref_id: uuid.UUID
    type: str
    note: str = ""


class AnnotationIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.get("/modules")
def modules(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return [{"code": m.code, "name": m.name, "cluster": m.cluster_code, "flows": m.flows} for m in session.scalars(select(Module).order_by(Module.code))]


@router.get("/rules", response_model=RuleList)
def list_rules(q: str = "", module: str = "", validation: str = "", state: str = "", all_versions: bool = False, limit: int = 100, offset: int = 0,
               _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    total, rows = service.search_rules(session, q=q, module=module, validation=validation, state=state, latest_only=not all_versions, limit=limit, offset=offset)
    return RuleList(total=total, items=[RuleListItem(rule_id=r.id, rule_key=r.rule_key, module_code=r.module_code, origin=r.origin, version_id=v.id,
                                                     version_no=v.version_no, state=v.state, title=v.title, validation_status=v.validation_status,
                                                     has_legacy_approval=bool(v.legacy_approval)) for r, v in rows])


@router.get("/rules/{rule_key}", response_model=RuleDetail)
def rule_detail(rule_key: str, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    rule = session.scalar(select(BusinessRule).where(BusinessRule.rule_key == rule_key))
    if rule is None:
        raise NotFound("Không thấy rule")
    versions = list(session.scalars(select(BusinessRuleVersion).where(BusinessRuleVersion.rule_id == rule.id).order_by(BusinessRuleVersion.version_no.desc())))
    vids = [v.id for v in versions]
    refs = session.execute(
        select(Reference, Source, SourceVersion).join(SourceVersion, SourceVersion.id == Reference.source_version_id).join(Source, Source.id == SourceVersion.source_id)
        .join(RuleVersionReference, RuleVersionReference.reference_id == Reference.id).where(RuleVersionReference.rule_version_id.in_(vids)).distinct()
    ).all() if vids else []
    return RuleDetail(
        rule_id=rule.id, rule_key=rule.rule_key, module_code=rule.module_code, origin=rule.origin,
        versions=[RuleVersionOut(version_id=v.id, version_no=v.version_no, state=v.state, title=v.title, description=v.description, user_roles=v.user_roles,
                                 setting_type=v.setting_type, config_path=v.config_path, open_questions=v.open_questions, extra=v.extra,
                                 legacy_approval=v.legacy_approval, validation_status=v.validation_status, validated_by=v.validated_by,
                                 created_by_type=v.created_by_type) for v in versions],
        references=[ReferenceOut(id=r.id, module_code=r.module_code, flow_code=r.flow_code, quote=r.quote, stance=r.stance, locator=r.locator,
                                 validation_status=r.validation_status, source_title=s.title, source_kind=s.kind, source_version=sv.label) for r, s, sv in refs],
    )


@router.post("/rules", status_code=201)
def create_rule(body: RuleIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """QC tạo/sửa rule ⇒ version mới UNREVIEWED + yêu cầu duyệt (không ghi đè bản cũ)."""
    rv = service.create_rule_version(session, actor=p, rule_key=body.rule_key, module=body.module, title=body.title, description=body.description,
                                     user_roles=body.user_roles, setting_type=body.setting_type, flow=body.flow)
    rule = session.get(BusinessRule, rv.rule_id)
    return {"rule_key": rule.rule_key, "version_id": str(rv.id), "version_no": rv.version_no, "validation_status": rv.validation_status}


@router.post("/reference-links", status_code=201)
def create_link(body: LinkIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    link = service.link_references(session, actor=p, from_id=body.from_ref_id, to_id=body.to_ref_id, type_=body.type, note=body.note)
    return {"id": str(link.id), "type": link.type}


@router.get("/references/{ref_id}/links")
def reference_links(ref_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    rows = session.scalars(select(ReferenceLink).where((ReferenceLink.from_ref_id == ref_id) | (ReferenceLink.to_ref_id == ref_id)))
    return [{"id": str(r.id), "from": str(r.from_ref_id), "to": str(r.to_ref_id), "type": r.type, "note": r.note} for r in rows]


@router.post("/references/{ref_id}/annotations", status_code=201)
def annotate(ref_id: uuid.UUID, body: AnnotationIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    if session.get(Reference, ref_id) is None:
        raise NotFound("Không thấy tham chiếu")
    a = Annotation(reference_id=ref_id, author_id=p.id, body=body.body)
    session.add(a)
    session.flush()
    log_audit(session, p, "REFERENCE_ANNOTATE", resource_type="reference", resource_id=str(ref_id))
    return {"id": str(a.id)}
