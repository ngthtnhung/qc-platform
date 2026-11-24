"""Handler của các tác vụ nền (đăng ký vào jobs.HANDLERS)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.principal import Principal
from app.domains.bugs.sync import sync_bugs
from app.domains.integrations import service as integ
from app.domains.platform import jobs
from app.domains.sources.sync_live import sync_release_builds, sync_task_functions


def _sync_bugs(session: Session, actor: Principal, payload: dict) -> dict:
    client = integ.haraworks_client(session, actor)
    try:
        return sync_bugs(session, client)
    finally:
        client.close()


def _sync_functions(session: Session, actor: Principal, payload: dict) -> dict:
    client = integ.haraworks_client(session, actor)
    try:
        return sync_task_functions(session, client, actor=actor)
    finally:
        client.close()


def _sync_builds(session: Session, actor: Principal, payload: dict) -> dict:
    client = integ.haraworks_client(session, actor)
    try:
        return sync_release_builds(session, client, actor=actor)
    finally:
        client.close()


def _sync_all(session: Session, actor: Principal, payload: dict) -> dict:
    client = integ.haraworks_client(session, actor)
    try:
        bugs = sync_bugs(session, client)
        fns = sync_task_functions(session, client, actor=actor)
        builds = sync_release_builds(session, client, actor=actor)
        return {"bugs": bugs, "functions": fns, "builds": builds}
    finally:
        client.close()


def _sync_descriptions(session: Session, actor: Principal, payload: dict) -> dict:
    return integ.sync_function_descriptions(session, actor, limit=payload.get("limit"))


jobs.register("sync_bugs", _sync_bugs)
jobs.register("sync_task_functions", _sync_functions)
jobs.register("sync_builds", _sync_builds)
jobs.register("sync_all", _sync_all)
jobs.register("sync_function_descriptions", _sync_descriptions)
