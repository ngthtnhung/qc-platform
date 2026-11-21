"""CLI vận hành: tạo QC đầu tiên, nhập người dùng từ bản Node (chỉ đọc nguồn).

  python -m app.cli bootstrap --username <tên> --display-name "<Tên>"      # mật khẩu: BOOTSTRAP_PASSWORD hoặc nhập tay
  python -m app.cli import-legacy-users --source ../../database/qa_platform_data.json [--apply]

Không có mật khẩu mặc định. Mặc định `import-legacy-users` chỉ chạy khô (dry-run)."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from sqlalchemy import select

from app.core.db import session_scope
from app.domains.platform import auth as auth_service
from app.domains.platform import users as user_service
from app.domains.platform.audit import log_audit
from app.domains.platform.models import User


def cmd_bootstrap(args: argparse.Namespace) -> int:
    pw = os.environ.get("BOOTSTRAP_PASSWORD") or getpass.getpass("Mật khẩu cho QC đầu tiên: ")
    with session_scope() as s:
        if user_service.active_count(s) > 0 and not args.force:
            print("Đã có người dùng. Dùng --force nếu thật sự muốn thêm QC bằng CLI.", file=sys.stderr)
            return 1
        user, _ = user_service.create_user(s, actor=None, username=args.username, display_name=args.display_name,
                                           password=pw, must_change_password=False)
        s.commit()
        print(f"Đã tạo QC: {user.username}")
    return 0


def legacy_plan(source: Path) -> list[dict]:
    """Đọc team_users từ file JSON cũ (chỉ đọc). Mọi người dùng cũ → vai trò qc (4 QC ngang quyền).
    KHÔNG nhập password_hash/session_token cũ (SHA-256 không salt, token chữ rõ)."""
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    out = []
    for u in data.get("team_users", []):
        out.append({
            "legacy_id": u.get("id"), "username": auth_service.normalize_username(u.get("username") or u.get("display_name") or ""),
            "display_name": u.get("display_name") or "", "employee_code": u.get("employee_code") or "",
            "is_active": u.get("is_active") == 1 or u.get("is_active") is True,
        })
    return out


def cmd_import_users(args: argparse.Namespace) -> int:
    plan = legacy_plan(Path(args.source))
    created, skipped, issued = 0, 0, []
    with session_scope() as s:
        for row in plan:
            if not row["username"]:
                print(f"BỎ QUA {row['legacy_id']}: không có tên đăng nhập", file=sys.stderr)
                skipped += 1
                continue
            exists = s.scalar(select(User).where((User.legacy_id == row["legacy_id"]) | (User.username == row["username"])))
            if exists:
                skipped += 1
                continue
            if not args.apply:
                created += 1
                continue
            user, pw = user_service.create_user(s, actor=None, username=row["username"], display_name=row["display_name"],
                                                employee_code=row["employee_code"], legacy_id=row["legacy_id"])
            if not row["is_active"]:
                user.is_active = False
            log_audit(s, None, "IMPORT_USER", resource_type="user", resource_id=str(user.id), reason=f"legacy_id={row['legacy_id']}")
            issued.append((user.username, pw))
            created += 1
        if args.apply:
            s.commit()
    mode = "ÁP DỤNG" if args.apply else "CHẠY KHÔ"
    print(f"[{mode}] nguồn={len(plan)} tạo={created} bỏ qua={skipped}")
    for username, pw in issued:  # in một lần để admin giao; người dùng bị buộc đổi khi đăng nhập
        print(f"  {username}\t{pw}")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # console Windows mặc định cp1252 sẽ lỗi với tiếng Việt
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bootstrap")
    b.add_argument("--username", required=True)
    b.add_argument("--display-name", required=True)
    b.add_argument("--force", action="store_true")
    b.set_defaults(fn=cmd_bootstrap)
    i = sub.add_parser("import-legacy-users")
    i.add_argument("--source", required=True)
    i.add_argument("--apply", action="store_true")
    i.set_defaults(fn=cmd_import_users)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
