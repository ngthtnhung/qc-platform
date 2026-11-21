"""Nạp TẤT CẢ model để metadata/khóa ngoại luôn đầy đủ (API, worker, CLI, Alembic đều dùng chung)."""
from app.domains.bugs import models as bugs  # noqa: F401
from app.domains.files import models as files  # noqa: F401
from app.domains.knowledge import models as knowledge  # noqa: F401
from app.domains.platform import models as platform  # noqa: F401
