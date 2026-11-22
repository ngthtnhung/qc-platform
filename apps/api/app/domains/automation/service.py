"""Automation: tác vụ, code version (QC duyệt), hàng đợi thực thi, vòng đời Runner.

Quy tắc cứng:
- Mọi code version mới (người, AI hay nhập) ở PENDING + yêu cầu duyệt; chỉ QC chuyển sang APPROVED (hook của approvals).
- Chỉ phiên bản APPROVED mới xếp hàng chạy được; Runner nhận kèm sha256 và phải kiểm tra lại.
- Chạy chỉ trên môi trường STAGING; PolicyEngine kiểm tra AUTOMATE.
"""
from __future__ import annotations

import datetime as dt
import secrets
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError, AuthRequired, Conflict, NotFound, PolicyBlocked
from app.core.principal import Principal, PrincipalType
from app.core.security import sha256_hex
from app.domains.automation import rules
from app.domains.automation.models import (
    AutomationTask,
    CodeVersion,
    Execution,
    ExecutionArtifact,
    ExecutionLog,
    ExecutionStep,
    Runner,
    TaskParam,
)
from app.domains.platform import approvals, policy
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Account, ApprovalRequest, Environment
from app.domains.platform.vault import reveal_secret

LEASE_MINUTES = 5
RATE_LIMIT_RUNS = 120  # mỗi QC trong 10 phút (như bản Node, nhưng bền vì đếm trong DB)
MAX_BATCH = 50
RUNNER_PREFIX = "rn_"


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


# ------------------------------------------------------------------ duyệt code
def _on_code_version(session: Session, req: ApprovalRequest, approved: bool) -> None:
    cv = session.get(CodeVersion, uuid.UUID(req.subject_id))
    if cv is None:
        raise NotFound("Không thấy phiên bản code")
    if cv.sha256 != req.payload.get("sha256"):
        raise Conflict("Code đã thay đổi sau khi gửi duyệt", code="PAYLOAD_CHANGED")
    if approved:
        cv.status, cv.approved_by, cv.approved_at = "APPROVED", req.decided_by_id, req.decided_at or utcnow()
    else:
        cv.status = "REJECTED"


approvals.register_hook("automation_code_version", _on_code_version)


def _submit(session: Session, cv: CodeVersion, task: AutomationTask, requester: Principal) -> ApprovalRequest:
    prev = session.scalar(select(CodeVersion).where(CodeVersion.task_id == task.id, CodeVersion.status == "APPROVED", CodeVersion.id != cv.id)
                          .order_by(CodeVersion.version_no.desc()))
    return approvals.submit_for_approval(
        session, requester=requester, subject_type="automation_code_version", subject_id=str(cv.id),
        title=f"[Code] {task.name} · v{cv.version_no}",
        payload={"task": task.name, "module": task.module_code, "version": cv.version_no, "sha256": cv.sha256, "origin": cv.origin,
                 "writes": task.writes, "start_url": task.start_url, "steps": task.steps, "script": cv.script,
                 "prev_script": prev.script if prev else None, "prev_version": prev.version_no if prev else None, "note": cv.note},
    )


def add_code_version(session: Session, *, task: AutomationTask, script: str, requester: Principal, origin: str, note: str = "") -> CodeVersion:
    errs = rules.validate_script(script)
    if errs:
        raise AppError("; ".join(errs), code="SCRIPT_INVALID", status=422)
    sha = rules.script_sha(script)
    if session.scalar(select(CodeVersion.id).where(CodeVersion.task_id == task.id, CodeVersion.sha256 == sha)):
        raise Conflict("Code này đã có trong một phiên bản của tác vụ", code="DUPLICATE_CODE")
    n = (session.scalar(select(func.max(CodeVersion.version_no)).where(CodeVersion.task_id == task.id)) or 0) + 1
    cv = CodeVersion(task_id=task.id, version_no=n, script=script, sha256=sha, origin=origin, created_by_type=requester.type.value, note=note)
    session.add(cv)
    session.flush()
    _submit(session, cv, task, requester)
    log_audit(session, requester, "CODE_VERSION_CREATE", resource_type="automation_task", resource_id=str(task.id), after={"version": n, "sha256": sha, "origin": origin})
    return cv


def create_task(session: Session, *, actor: Principal, name: str, module_code: str, start_url: str, steps: list[str], script: str,
                params: list[dict], flow: str = "", description: str = "", required_roles: list[str] | None = None, writes: bool = False,
                rule_keys: list[str] | None = None, source: dict | None = None, legacy_id: str | None = None, origin: str = "human") -> tuple[AutomationTask, CodeVersion]:
    if not name.strip() or not module_code.strip():
        raise AppError("Thiếu tên hoặc module", code="VALIDATION_ERROR", status=422)
    if not [s for s in steps if str(s).strip()]:
        raise AppError("Cần ghi các bước bằng lời để người duyệt đọc", code="VALIDATION_ERROR", status=422)
    staging = [e for (e,) in session.execute(select(Environment.base_url).where(Environment.type == "STAGING", Environment.is_active.is_(True)))]
    bad_url = rules.validate_start_url(start_url, staging)
    if bad_url:
        raise AppError(bad_url, code="VALIDATION_ERROR", status=422)
    norm, perrs = rules.normalize_params(params)
    if perrs:
        raise AppError("; ".join(perrs), code="VALIDATION_ERROR", status=422)
    task = AutomationTask(legacy_id=legacy_id, name=name.strip()[:300], module_code=module_code.strip(), flow=flow, description=description,
                          start_url=start_url, required_roles=required_roles or [], writes=writes, rule_keys=rule_keys or [],
                          source=source or {}, steps=[str(s) for s in steps if str(s).strip()])
    session.add(task)
    session.flush()
    session.add_all(TaskParam(task_id=task.id, **p) for p in norm)
    cv = add_code_version(session, task=task, script=script, requester=actor, origin=origin)
    log_audit(session, actor, "AUTOMATION_TASK_CREATE", resource_type="automation_task", resource_id=str(task.id), after={"name": task.name, "module": module_code})
    return task, cv


def latest_approved(session: Session, task_id: uuid.UUID) -> CodeVersion | None:
    return session.scalar(select(CodeVersion).where(CodeVersion.task_id == task_id, CodeVersion.status == "APPROVED").order_by(CodeVersion.version_no.desc()))


def task_params(session: Session, task_id: uuid.UUID) -> list[dict]:
    rows = session.scalars(select(TaskParam).where(TaskParam.task_id == task_id).order_by(TaskParam.key))
    return [{"key": p.key, "label": p.label, "type": p.type, "value": p.value, "auto": p.auto, "fallback": p.fallback} for p in rows]


def update_param_values(session: Session, *, actor: Principal, task: AutomationTask, values: dict[str, str]) -> list[dict]:
    """Đổi giá trị tham số (không đổi code ⇒ không cần duyệt lại, giống bản Node)."""
    cur = {p.key: p for p in session.scalars(select(TaskParam).where(TaskParam.task_id == task.id))}
    for k, v in values.items():
        p = cur.get(k)
        if p is None:
            raise AppError(f'Không có tham số "{k}"', code="VALIDATION_ERROR", status=422)
        if len(str(v)) > rules.MAX_LEN[p.type]:
            raise AppError(f'Giá trị của "{k}" quá dài', code="VALIDATION_ERROR", status=422)
        p.value = str(v)
    log_audit(session, actor, "AUTOMATION_PARAMS_SAVE", resource_type="automation_task", resource_id=str(task.id), after={"keys": sorted(values)})
    return task_params(session, task.id)


# ------------------------------------------------------------------ xếp hàng chạy
def queue_runs(session: Session, *, actor: Principal, task: AutomationTask, account_id: uuid.UUID | None, override: dict | None,
               count: int = 1, correlation_id: str = "") -> list[Execution]:
    if not actor.is_qc_user:
        raise PolicyBlocked("Chỉ QC được yêu cầu chạy tác vụ")
    if task.status != "active":
        raise NotFound("Tác vụ đã ngừng dùng")
    if not 1 <= count <= MAX_BATCH:
        raise AppError(f"Số lần chạy phải từ 1 đến {MAX_BATCH}", code="VALIDATION_ERROR", status=422)
    cv = latest_approved(session, task.id)
    if cv is None:
        raise Conflict("Tác vụ chưa có phiên bản code nào được QC duyệt", code="NOT_APPROVED")
    since = utcnow() - dt.timedelta(minutes=10)
    recent = session.scalar(select(func.count()).select_from(Execution).where(Execution.requested_by == actor.id, Execution.queued_at >= since)) or 0
    if recent + count > RATE_LIMIT_RUNS:
        raise AppError(f"Chạy quá nhiều lần trong 10 phút (tối đa {RATE_LIMIT_RUNS})", code="RATE_LIMITED", status=429)

    rows = session.execute(select(Account, Environment).join(Environment, Environment.id == Account.environment_id)
                           .where(Account.is_active.is_(True), Environment.type == "STAGING", Environment.is_active.is_(True))).all()
    pool = [{"id": a.id, "role_label": a.role_label, "has_secret": a.secret_id is not None, "env": e} for a, e in rows]
    if account_id:
        chosen = next((a for a in pool if a["id"] == account_id), None)
    else:
        chosen = rules.choose_account(task.required_roles, pool)
    if chosen is None:
        raise AppError(_no_account_reason(task, pool, account_id), code="NO_ACCOUNT", status=422)
    policy.evaluate_action(session, actor=actor, action="AUTOMATE", env=chosen["env"], correlation_id=correlation_id)

    params = rules.merge_params(task_params(session, task.id), override)
    batch = secrets.token_hex(6) if count > 1 else ""
    out = []
    for _ in range(count):
        ex = Execution(task_id=task.id, code_version_id=cv.id, account_id=chosen["id"], params=params, batch_id=batch, requested_by=actor.id)
        session.add(ex)
        out.append(ex)
    session.flush()
    log_audit(session, actor, "AUTOMATION_RUN_QUEUED", resource_type="automation_task", resource_id=str(task.id),
              after={"executions": [str(e.id) for e in out], "code_sha256": cv.sha256, "account": str(chosen["id"])}, correlation_id=correlation_id)
    return out


def _no_account_reason(task: AutomationTask, pool: list[dict], account_id: uuid.UUID | None) -> str:
    """Giải thích RÕ vì sao không chọn được tài khoản để người dùng biết sửa ở đâu."""
    if account_id:
        return "Tài khoản đã chọn không thuộc môi trường loại STAGING đang hoạt động (hoặc đã bị vô hiệu)."
    if not pool:
        return ("Chưa có tài khoản nào trong môi trường loại STAGING đang hoạt động. Vào \"Môi trường & tài khoản\": "
                "môi trường phải có loại STAGING và có ít nhất một tài khoản.")
    have = ", ".join(sorted({a["role_label"] or "(trống)" for a in pool}))
    need = ", ".join(task.required_roles) or "(không yêu cầu)"
    return (f"Tác vụ cần vai trò: {need}. Các tài khoản Staging hiện có mang vai trò: {have}. "
            "Đặt lại \"Vai trò\" của tài khoản cho khớp, hoặc chọn tài khoản thủ công khi xếp hàng chạy.")


def cancel_execution(session: Session, *, actor: Principal, execution_id: uuid.UUID) -> Execution:
    ex = session.get(Execution, execution_id)
    if ex is None:
        raise NotFound("Không thấy lần chạy")
    if ex.status not in ("QUEUED", "CLAIMED", "RUNNING"):
        raise Conflict(f"Lần chạy đã {ex.status}")
    ex.status, ex.finished_at, ex.error = "CANCELLED", utcnow(), "Bị hủy bởi QC"
    log_audit(session, actor, "AUTOMATION_RUN_CANCELLED", resource_type="execution", resource_id=str(ex.id))
    return ex


# ------------------------------------------------------------------ Runner
def create_runner(session: Session, *, actor: Principal, name: str, type_: str, capabilities: list[str], labels: list[str]) -> tuple[Runner, str]:
    if session.scalar(select(Runner.id).where(Runner.name == name)):
        raise Conflict("Tên runner đã tồn tại")
    token = RUNNER_PREFIX + secrets.token_urlsafe(32)
    r = Runner(name=name, type=type_, token_hash=sha256_hex(token), capabilities=capabilities or ["web"], labels=labels, owner_user_id=actor.id)
    session.add(r)
    session.flush()
    log_audit(session, actor, "RUNNER_CREATE", resource_type="runner", resource_id=str(r.id), after={"name": name, "type": type_})
    return r, token


def revoke_runner(session: Session, *, actor: Principal, runner_id: uuid.UUID) -> Runner:
    r = session.get(Runner, runner_id)
    if r is None:
        raise NotFound("Không thấy runner")
    r.revoked_at, r.status = utcnow(), "REVOKED"
    log_audit(session, actor, "RUNNER_REVOKE", resource_type="runner", resource_id=str(r.id))
    return r


def authenticate_runner(session: Session, token: str) -> tuple[Runner, Principal]:
    if not token.startswith(RUNNER_PREFIX):
        raise AuthRequired("Token runner không hợp lệ", code="INVALID_RUNNER_TOKEN")
    r = session.scalar(select(Runner).where(Runner.token_hash == sha256_hex(token)))
    if r is None or r.revoked_at is not None:
        raise AuthRequired("Token runner không hợp lệ hoặc đã thu hồi", code="INVALID_RUNNER_TOKEN")
    return r, Principal(type=PrincipalType.RUNNER, id=r.id, username=r.name)


def heartbeat(session: Session, runner: Runner, status: str = "ONLINE") -> None:
    runner.last_heartbeat_at, runner.status = utcnow(), status if status in ("ONLINE", "BUSY") else "ONLINE"


def reclaim_expired(session: Session) -> int:
    """Lease hết hạn (runner mất kết nối) ⇒ xếp lại hàng nếu còn lượt, hết lượt ⇒ FAILED."""
    now, n = utcnow(), 0
    for ex in session.scalars(select(Execution).where(Execution.status.in_(["CLAIMED", "RUNNING"]), Execution.lease_expires_at < now)):
        if ex.attempt >= ex.max_attempts:
            ex.status, ex.finished_at, ex.error = "FAILED", now, "Runner mất kết nối và đã hết số lần thử"
        else:
            ex.status, ex.runner_id, ex.lease_expires_at = "QUEUED", None, None
        n += 1
    return n


def claim(session: Session, runner: Runner) -> dict | None:
    """Nhận một lần chạy: cập nhật có điều kiện (status='QUEUED') nên hai runner không nhận trùng."""
    reclaim_expired(session)
    session.flush()  # autoflush tắt: ghi việc tái xếp hàng trước khi truy vấn hàng đợi
    heartbeat(session, runner, "BUSY")
    candidates = session.scalars(select(Execution).where(Execution.status == "QUEUED").order_by(Execution.queued_at).limit(10).with_for_update(skip_locked=True)).all()
    for ex in candidates:
        res = session.execute(update(Execution).where(Execution.id == ex.id, Execution.status == "QUEUED").values(
            status="CLAIMED", runner_id=runner.id, attempt=Execution.attempt + 1, lease_expires_at=utcnow() + dt.timedelta(minutes=LEASE_MINUTES)))
        if res.rowcount != 1:
            continue
        session.refresh(ex)
        task, cv = session.get(AutomationTask, ex.task_id), session.get(CodeVersion, ex.code_version_id)
        acc = session.get(Account, ex.account_id)
        env = session.get(Environment, acc.environment_id)
        if cv.status != "APPROVED":  # bị thu hồi giữa chừng ⇒ không chạy
            ex.status, ex.finished_at, ex.error = "FAILED", utcnow(), "Phiên bản code không còn ở trạng thái APPROVED"
            continue
        log_audit(session, Principal(type=PrincipalType.RUNNER, id=runner.id, username=runner.name), "AUTOMATION_CLAIM", resource_type="execution", resource_id=str(ex.id))
        return {"execution_id": str(ex.id), "attempt": ex.attempt, "lease_seconds": LEASE_MINUTES * 60, "task": {"name": task.name, "start_url": task.start_url, "writes": task.writes},
                "script": cv.script, "sha256": cv.sha256, "params": ex.params,
                "account": {"id": str(acc.id), "username": acc.username_ref, "expected_org": env.org_identifier or acc.expected_org_ref, "route": acc.default_route},
                "environment": {"code": env.code, "type": env.type, "login_url": env.login_url or env.base_url}}
    return None


def _owned(session: Session, runner: Runner, execution_id: uuid.UUID) -> Execution:
    ex = session.get(Execution, execution_id)
    if ex is None or ex.runner_id != runner.id:
        raise NotFound("Không thấy lần chạy của runner này")
    return ex


def serve_credentials(session: Session, runner: Runner, execution_id: uuid.UUID) -> dict:
    """Một lần cho mỗi lần nhận việc, chỉ khi còn lease; luôn ghi audit. Runner không ghi mật khẩu ra đĩa."""
    ex = _owned(session, runner, execution_id)
    if ex.status not in ("CLAIMED", "RUNNING") or (_aware(ex.lease_expires_at) or utcnow()) < utcnow():
        raise Conflict("Lần chạy không còn hiệu lực", code="LEASE_EXPIRED")
    if ex.credentials_served:
        raise Conflict("Thông tin đăng nhập của lần chạy này đã được lấy", code="CREDENTIALS_ALREADY_SERVED")
    acc = session.get(Account, ex.account_id)
    env = session.get(Environment, acc.environment_id)
    if env.type not in ("STAGING", "PRODUCTION_TEST"):
        return {"username": acc.username_ref, "password": None}
    ex.credentials_served = True
    from app.domains.platform.models import Secret

    secret = session.get(Secret, acc.secret_id) if acc.secret_id else None
    pw = reveal_secret(session, secret, actor=Principal(type=PrincipalType.RUNNER, id=runner.id, username=runner.name),
                       purpose=f"execution {ex.id}") if secret else None
    return {"username": acc.username_ref, "password": pw}


def execution_files(session: Session, runner: Runner, execution_id: uuid.UUID) -> list[dict]:
    """Các file đính kèm của lần chạy (tham số kiểu `file`): chỉ file được liệt kê trong tham số của lần chạy này, chỉ khi runner đang giữ việc."""
    from app.domains.files.models import StoredFile

    ex = _owned(session, runner, execution_id)
    if ex.status not in ("CLAIMED", "RUNNING"):
        raise Conflict(f"Lần chạy ở trạng thái {ex.status}")
    out = []
    for p in session.scalars(select(TaskParam).where(TaskParam.task_id == ex.task_id, TaskParam.type == "file")):
        for raw in str((ex.params or {}).get(p.key, "")).split(","):
            raw = raw.strip()
            try:
                fid = uuid.UUID(raw)
            except ValueError:
                continue  # mã file cũ của bản Node (f_xxx) không có trong platform mới: bỏ qua
            rec = session.get(StoredFile, fid)
            if rec is not None:
                out.append({"key": p.key, "file_id": str(rec.id), "name": rec.original_name, "size": rec.size, "mime": rec.mime})
    return out


def mark_running(session: Session, runner: Runner, execution_id: uuid.UUID) -> Execution:
    ex = _owned(session, runner, execution_id)
    if ex.status != "CLAIMED":
        raise Conflict(f"Lần chạy ở trạng thái {ex.status}")
    ex.status, ex.started_at = "RUNNING", utcnow()
    ex.lease_expires_at = utcnow() + dt.timedelta(minutes=LEASE_MINUTES)
    return ex


def report(session: Session, runner: Runner, execution_id: uuid.UUID, *, status: str, steps: list[dict], log: list[str], error: str,
           duration_ms: int, sha256: str) -> Execution:
    ex = _owned(session, runner, execution_id)
    if ex.status not in ("CLAIMED", "RUNNING"):
        raise Conflict(f"Lần chạy đã ở trạng thái {ex.status}")
    cv = session.get(CodeVersion, ex.code_version_id)
    if sha256 != cv.sha256:  # runner phải báo đúng sha đã chạy: không thể báo kết quả cho code khác bản đã duyệt
        raise Conflict("sha256 không khớp bản code đã duyệt", code="SHA_MISMATCH")
    ex.status = "PASSED" if status == "PASSED" else "FAILED"
    ex.error, ex.duration_ms, ex.finished_at = (error or "")[:4000], duration_ms, utcnow()
    for i, s in enumerate(steps[:500]):
        session.add(ExecutionStep(execution_id=ex.id, seq=i, name=str(s.get("name", ""))[:300], status="PASS" if s.get("status") == "PASS" else "FAIL",
                                  ms=int(s.get("ms", 0) or 0), error=str(s.get("error", ""))[:2000]))
    for i, line in enumerate(log[:1000]):
        session.add(ExecutionLog(execution_id=ex.id, seq=i, message=str(line)[:2000]))
    heartbeat(session, runner, "ONLINE")
    log_audit(session, Principal(type=PrincipalType.RUNNER, id=runner.id, username=runner.name), "AUTOMATION_REPORT", resource_type="execution",
              resource_id=str(ex.id), after={"status": ex.status, "duration_ms": duration_ms})
    return ex


def add_artifact(session: Session, runner: Runner, execution_id: uuid.UUID, kind: str, file_id: uuid.UUID) -> ExecutionArtifact:
    ex = _owned(session, runner, execution_id)
    if kind not in ("screenshot", "video", "trace", "log"):
        raise AppError("Loại artifact không hợp lệ", code="VALIDATION_ERROR", status=422)
    art = ExecutionArtifact(execution_id=ex.id, kind=kind, file_id=file_id)
    session.add(art)
    session.flush()
    return art
