"""Nhập tác vụ từ bản Node (M-12): CHỈ ĐỌC nguồn, chạy khô mặc định, idempotent, không ghi đè.

- Nguồn chính: `database/automation-drafts/*.json` (file hoặc mảng). Id cũ `at_<sha1(module|name)[:16]>` giữ làm `legacy_id`.
- `approved_by: "auto"` của bản Node KHÔNG được coi là duyệt: mọi code vào ở PENDING + yêu cầu duyệt chờ QC.
- Cùng `legacy_id` nhưng script khác ⇒ thêm VERSION MỚI (PENDING), không sửa phiên bản cũ.
- `--legacy-db` (DB đang chạy của bản Node): (a) tác vụ có trong DB nhưng không có/không hợp lệ trong thư mục nháp vẫn được nhập
  từ DB (đó là tác vụ thật đang dùng); (b) với tác vụ đã nhập, lấy giá trị tham số người dùng đã chỉnh trên giao diện cũ,
  chỉ khi script_sha trùng.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.principal import SYSTEM_PRINCIPAL
from app.domains.automation import rules, service
from app.domains.automation.models import AutomationTask, CodeVersion, TaskParam


@dataclass
class Report:
    found: int = 0
    tasks_created: int = 0
    versions_added: int = 0
    unchanged: int = 0
    params_updated: int = 0
    errors: list[str] = field(default_factory=list)
    error_ids: dict[str, int] = field(default_factory=dict)  # legacy_id → vị trí trong errors
    notes: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        d = self.__dict__.copy()
        d["errors"], d["notes"] = len(self.errors), len(self.notes)
        d.pop("error_ids")
        return d


def legacy_id_for(item: dict) -> str:
    return item.get("id") or "at_" + hashlib.sha1(f"{item.get('module')}|{item.get('name')}".encode()).hexdigest()[:16]


def _items(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    yield from (raw if isinstance(raw, list) else [raw])


def import_drafts(session: Session, drafts_dir: Path, rep: Report) -> None:
    for f in sorted(drafts_dir.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            items = list(_items(f))
        except Exception as exc:  # noqa: BLE001
            rep.errors.append(f"{f.name}: không phải JSON hợp lệ ({exc})")
            continue
        for it in items:
            rep.found += 1
            lid = legacy_id_for(it)
            try:
                task = session.scalar(select(AutomationTask).where(AutomationTask.legacy_id == lid))
                script = it.get("script") or ""
                if task is None:
                    service.create_task(
                        session, actor=SYSTEM_PRINCIPAL, name=str(it.get("name", "")), module_code=str(it.get("module", "")), start_url=str(it.get("start_url", "")),
                        steps=[str(s) for s in it.get("steps") or []], script=script, params=it.get("params") or [], flow=str(it.get("flow", "")),
                        description=str(it.get("description", "")), required_roles=[str(r) for r in it.get("required_roles") or []],
                        writes=it.get("writes") is True, rule_keys=[str(r) for r in it.get("rule_ids") or []], source=it.get("source") or {},
                        legacy_id=lid, origin="import")
                    rep.tasks_created += 1
                    rep.versions_added += 1
                elif session.scalar(select(CodeVersion.id).where(CodeVersion.task_id == task.id, CodeVersion.sha256 == rules.script_sha(script))):
                    rep.unchanged += 1
                else:
                    service.add_code_version(session, task=task, script=script, requester=SYSTEM_PRINCIPAL, origin="import", note=f"từ {f.name}")
                    rep.versions_added += 1
                    rep.notes.append(f"{lid}: script khác bản đã nhập ⇒ thêm version mới chờ QC duyệt ({f.name})")
            except AppError as exc:
                rep.error_ids[lid] = len(rep.errors)
                rep.errors.append(f"{f.name} [{lid}]: {exc.message}")
            session.flush()


def import_from_legacy_db(session: Session, legacy_db: Path, rep: Report) -> None:
    data = json.loads(legacy_db.read_text(encoding="utf-8-sig"))
    for t in data.get("automation_tasks", []):
        if t.get("status") == "retired":
            continue
        lid = t.get("id")
        task = session.scalar(select(AutomationTask).where(AutomationTask.legacy_id == lid))
        if task is None:
            try:
                service.create_task(
                    session, actor=SYSTEM_PRINCIPAL, name=str(t.get("name", "")), module_code=str(t.get("module", "")), start_url=str(t.get("start_url", "")),
                    steps=[str(x) for x in t.get("steps") or []], script=t.get("script") or "", params=t.get("params") or [], flow=str(t.get("flow", "")),
                    description=str(t.get("description", "")), required_roles=[str(r) for r in t.get("required_roles") or []], writes=t.get("writes") is True,
                    rule_keys=[str(r) for r in t.get("rule_ids") or []], source=t.get("source") or {}, legacy_id=lid, origin="import")
                rep.tasks_created += 1
                rep.versions_added += 1
                if lid in rep.error_ids:  # bản nháp lỗi nhưng DB cũ có bản hợp lệ ⇒ đã xử lý
                    rep.errors[rep.error_ids.pop(lid)] = ""
                    rep.notes.append(f"{lid}: bản nháp không hợp lệ; đã nhập từ DB cũ")
                else:
                    rep.notes.append(f"{lid}: chỉ có trong DB cũ (không có trong thư mục nháp) ⇒ nhập từ DB cũ")
            except AppError as exc:
                rep.errors.append(f"DB cũ [{lid}]: {exc.message}")
            session.flush()
            continue
        sha = t.get("script_sha") or rules.script_sha(t.get("script", ""))
        if not session.scalar(select(CodeVersion.id).where(CodeVersion.task_id == task.id, CodeVersion.sha256 == sha)):
            rep.notes.append(f"{lid}: script trong DB cũ khác bản đã nhập ⇒ không áp dụng giá trị tham số")
            continue
        cur = {p.key: p for p in session.scalars(select(TaskParam).where(TaskParam.task_id == task.id))}
        for p in t.get("params") or []:
            row = cur.get(p.get("key"))
            if row is not None and (row.value != str(p.get("value", "")) or row.auto != (p.get("auto") is not False)):
                row.value, row.auto = str(p.get("value", "")), p.get("auto") is not False
                rep.params_updated += 1
    rep.errors = [e for e in rep.errors if e]


def run(session: Session, drafts_dir: Path, *, legacy_db: Path | None, apply: bool) -> Report:
    rep = Report()
    import_drafts(session, drafts_dir, rep)
    if legacy_db:
        import_from_legacy_db(session, legacy_db, rep)
    if apply:
        session.commit()
    else:
        session.rollback()
    return rep
