"""Nhập `database/kb-snapshot` (M-11): CHỈ ĐỌC nguồn, idempotent, không ghi đè, không giả định duyệt.

- Đọc `kb-snapshot/rules` (đầy đủ trường) chứ KHÔNG đọc `business_rules.json` (bản đã lược bởi buildBundle).
- Mọi rule vào ở `UNREVIEWED`; việc duyệt ở Kho ngoài chỉ được ghi lại trong `legacy_approval`. QC phải duyệt lại ở đây.
- Cùng (rule_id, version) nhưng nội dung khác ⇒ KHÔNG ghi đè, báo xung đột.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.principal import SYSTEM_PRINCIPAL
from app.core.text import stable_hash
from app.domains.knowledge.models import (
    BusinessRule,
    BusinessRuleVersion,
    Module,
    Reference,
    Source,
    SourceVersion,
)
from app.domains.knowledge.service import link_rule_references, rule_fold, submit_rule_version

CORE_FIELDS = {"rule_id", "version", "state", "module", "flow", "title", "description", "user_roles", "setting_type",
               "setting_label", "config_path", "classification", "open_questions"}
LEGACY_APPROVAL_FIELDS = ("approved_by", "approved_at", "verification_status", "ingested_at", "batch_id")
STATES = {"active", "pending", "archived"}


@dataclass
class Report:
    modules_created: int = 0
    modules_skipped: int = 0
    rules_created: int = 0
    versions_created: int = 0
    versions_skipped: int = 0
    references_created: int = 0
    sources_created: int = 0
    approvals_requested: int = 0
    errors: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        d = self.__dict__.copy()
        d["errors"], d["conflicts"] = len(self.errors), len(self.conflicts)
        return d


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def import_modules(session: Session, snap: Path, rep: Report) -> None:
    for f in sorted((snap / "modules").glob("*.json")) if (snap / "modules").is_dir() else []:
        try:
            m = _read(f)
            code = str(m["code"]).strip().upper()
        except Exception as exc:  # noqa: BLE001
            rep.errors.append(f"{f.name}: {exc}")
            continue
        known = {"code", "name", "cluster", "prefix", "note", "usage_flow", "flows", "subsystem_slug", "standard_roles"}
        existing = session.scalar(select(Module).where(Module.code == code))
        if existing is not None:
            # Merge phần còn thiếu (cluster_code, flows, subsystem_slug...) vào module đã có mà không ghi đè dữ liệu người dùng
            updated = False
            if not (existing.cluster_code or "").strip() and m.get("cluster"):
                existing.cluster_code = str(m.get("cluster") or "")
                updated = True
            if not (existing.subsystem_slug or "").strip() and m.get("subsystem_slug"):
                existing.subsystem_slug = str(m.get("subsystem_slug") or "")
                updated = True
            if not (existing.flows or []) and m.get("flows"):
                existing.flows = list(m.get("flows") or [])
                updated = True
            if not (existing.usage_flow or "").strip() and m.get("usage_flow"):
                existing.usage_flow = str(m.get("usage_flow") or "")
                updated = True
            if not (existing.standard_roles or []) and m.get("standard_roles"):
                existing.standard_roles = list(m.get("standard_roles") or [])
                updated = True
            if not updated:
                rep.modules_skipped += 1
            continue
        session.add(Module(
            code=code,
            name=m.get("name", ""),
            cluster_code=m.get("cluster", ""),
            prefix=m.get("prefix", ""),
            subsystem_slug=m.get("subsystem_slug", ""),
            note=m.get("note", ""),
            usage_flow=m.get("usage_flow", ""),
            flows=m.get("flows", []),
            standard_roles=m.get("standard_roles", []),
            extra={k: v for k, v in m.items() if k not in known},
        ))
        rep.modules_created += 1
    session.flush()


def _source_and_version(session: Session, j: dict, rep: Report) -> SourceVersion | None:
    sr = j.get("source_reference") or {}
    title = str(sr.get("document") or "").strip()
    if not title:
        return None
    kind = str(j.get("source_type") or "document")
    src = session.scalar(select(Source).where(Source.kind == kind, Source.title == title))
    if src is None:
        src = Source(kind=kind, title=title[:400], external_url=str(sr.get("url") or "")[:1000])
        session.add(src)
        session.flush()
        rep.sources_created += 1
    label = str(sr.get("doc_version") or sr.get("doc_date") or "unversioned")[:120]
    sv = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src.id, SourceVersion.label == label))
    if sv is None:
        sv = SourceVersion(source_id=src.id, label=label, meta={"doc_date": sr.get("doc_date", ""), "doc_version": sr.get("doc_version", "")})
        session.add(sv)
        session.flush()
    return sv


def _references(session: Session, j: dict, sv: SourceVersion | None, rep: Report) -> list[Reference]:
    out: list[Reference] = []
    if sv is None:
        return out
    sr = j.get("source_reference") or {}
    for ev in j.get("evidence") or []:
        locator = {"section": sr.get("section", ""), "page": sr.get("page", ""), "text_lines": sr.get("text_lines", ""),
                   "frame": sr.get("frame", ""), "task_id": sr.get("task_id", ""), "url": sr.get("url", ""),
                   "reference": ev.get("reference", "")}
        h = stable_hash({"q": ev.get("quote", ""), "l": locator})
        ref = session.scalar(select(Reference).where(Reference.source_version_id == sv.id, Reference.content_hash == h))
        if ref is None:
            ref = Reference(module_code=str(j.get("module", "")), flow_code=str(j.get("flow", "")), source_version_id=sv.id,
                            locator=locator, quote=str(ev.get("quote", "")), stance=str(ev.get("stance", "")), content_hash=h)
            session.add(ref)
            session.flush()
            rep.references_created += 1
        out.append(ref)
    return out


def import_rules(session: Session, snap: Path, rep: Report) -> None:
    rdir = snap / "rules"
    for f in sorted(rdir.glob("*.json")) if rdir.is_dir() else []:
        try:
            j = _read(f)
            key, ver = str(j["rule_id"]), int(j["version"])
            if j.get("state") not in STATES:
                raise ValueError(f"state không hợp lệ: {j.get('state')!r}")
            title, desc = str(j["title"]), str(j["description"])
        except Exception as exc:  # noqa: BLE001
            rep.errors.append(f"{f.name}: {exc}")
            continue
        content_hash = stable_hash(j)
        rule = session.scalar(select(BusinessRule).where(BusinessRule.rule_key == key))
        if rule is None:
            rule = BusinessRule(rule_key=key, module_code=str(j.get("module", "")), flow_code=str(j.get("flow", "")),
                                origin="kb", legacy_id=j.get("legacy_id"))
            session.add(rule)
            session.flush()
            rep.rules_created += 1
        existing = session.scalar(select(BusinessRuleVersion).where(BusinessRuleVersion.rule_id == rule.id, BusinessRuleVersion.version_no == ver))
        if existing is not None:
            if existing.content_hash == content_hash:
                rep.versions_skipped += 1
            else:
                rep.conflicts.append(f"{key} v{ver}: nội dung khác bản đã có — không ghi đè ({f.name})")
            continue
        legacy = {k: j.get(k) for k in LEGACY_APPROVAL_FIELDS if j.get(k) is not None}
        rv = BusinessRuleVersion(
            rule_id=rule.id, version_no=ver, state=j["state"], title=title[:400], description=desc,
            user_roles=j.get("user_roles") or [], setting_type=j.get("setting_type") or "unknown",
            setting_label=j.get("setting_label") or "", config_path=j.get("config_path") or "",
            classification=j.get("classification") or "", open_questions=j.get("open_questions") or [],
            extra={k: v for k, v in j.items() if k not in CORE_FIELDS and k not in LEGACY_APPROVAL_FIELDS},
            legacy_approval=legacy or None, content_hash=content_hash,
            search_fold=rule_fold(key, title, desc, str(j.get("flow_name", ""))), created_by_type="SYSTEM",
        )
        session.add(rv)
        session.flush()
        link_rule_references(session, rv, _references(session, j, _source_and_version(session, j, rep), rep))
        rep.versions_created += 1
        if j["state"] != "archived":  # bản đã lưu trữ chỉ giữ làm lịch sử, không xếp hàng duyệt
            submit_rule_version(session, rv, rule, requester=SYSTEM_PRINCIPAL)
            rep.approvals_requested += 1


def run(session: Session, snap: Path, *, apply: bool) -> Report:
    rep = Report()
    import_modules(session, snap, rep)
    import_rules(session, snap, rep)
    if apply:
        session.commit()
    else:
        session.rollback()  # chạy khô: toàn bộ ghi bị hủy
    return rep
