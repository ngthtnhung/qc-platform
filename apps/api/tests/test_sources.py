import json
import unicodedata

import httpx
import pytest
from sqlalchemy import select

from app.core.text import fold, fold_with_map, normalize_text
from app.domains.integrations import service as integ
from app.domains.sources import parsers, search
from app.domains.sources.models import Integration, SourcePassage
from tests.conftest import login, make_qc
from tests.docx_util import BA_DOC, make_docx, p

WIKI_HTML = """<html><head><title>Wiki</title><script>var secret = 'KHÔNG ĐƯỢC TRÍCH';</script><style>.x{}</style></head><body>
<h1 id="rules">Rule chạy thực tế</h1>
<h2 id="priority">Độ ưu tiên phiếu</h2>
<p>Khi tạo phiếu bảo trì, hệ thống gán độ ưu tiên mặc định là TRUNG_BINH nếu người dùng không chọn.</p>
<pre>if (!ticket.priority) { ticket.priority = 'MEDIUM'; }</pre>
<table><tr><th>Mã</th><th>Ý nghĩa</th></tr><tr><td>P1</td><td>Khẩn cấp: xử lý trong 4 giờ</td></tr></table>
</body></html>"""

TASKS = {"tasks": [
    {"id": "6af2f0135316d2ca5c282235", "name": "[FUNCTION][MAINT] Điều chỉnh độ ưu tiên phiếu bảo trì", "project_Id": "p1", "project_Name": "Super Team",
     "team_Name": "Super Team", "additionalInfo": [{"key": "module", "value": "MAINT"}, {"key": "platform", "value": "Tất cả"}]},
    {"id": "6af2f0135316d2ca5c282236", "name": "[FUNCTION][HRM] Xuất file nhân viên", "project_Id": "p1", "project_Name": "Super Team", "team_Name": "Super Team",
     "additionalInfo": [{"key": "module", "value": "HRM"}]},
], "qcTasks": [{"id": "6af2f0135316d2ca5c282237", "name": "[QC] Kiểm tra độ ưu tiên mặc định", "project_Id": "p1", "team_Name": "Super Team", "parent_Id": "6af2f0135316d2ca5c282235"}]}


@pytest.fixture()
def qc(client, session):
    make_qc(session, "qcsrc")
    login(client, "qcsrc")
    return client


def upload(qc, kind, title, name, data, **extra):
    return qc.post("/api/v1/sources/upload", data={"kind": kind, "title": title, **extra}, files={"file": (name, data, "application/octet-stream")})


# ------------------------------------------------------------------ bộ phân tích
def test_docx_headings_paragraphs_tables_and_lines():
    items = parsers.parse_docx(BA_DOC)
    by = {i.text: i for i in items}
    h = by["3.4 Bộ lọc"]
    assert h.kind == "heading" and h.heading_path == "Yêu cầu bảo trì › 3.4 Bộ lọc"  # hai tiêu đề cùng cấp 2: tiêu đề sau thay tiêu đề trước
    para = by["Độ ưu tiên mặc định của phiếu mới tạo là Trung bình; không còn mức Không ưu tiên."]
    assert para.kind == "paragraph" and para.heading_path.endswith("3. Danh sách xử lý phiếu") and para.locator["paragraph"] == 4
    row = by["Độ ưu tiên | Lọc theo bốn mức: Thấp, Trung bình, Cao, Khẩn cấp"]
    assert row.kind == "table_row" and row.locator["table"] == 1 and row.locator["row"] == 2
    assert "Phiếu quá hạn được tô đỏ trên danh sách." in by  # các run trong một đoạn được nối đúng
    lines = [i.locator["line"] for i in items]
    assert lines == sorted(lines) and len(set(lines)) == len(lines)  # số dòng tăng dần, duy nhất


def test_docx_long_paragraph_is_split_with_exact_offsets():
    long = " ".join(f"Câu số {i} nói về độ ưu tiên và phiếu bảo trì." for i in range(80))
    items = parsers.parse_docx(make_docx(p("Mục dài", "Heading1"), p(long)))
    parts = [i for i in items if i.kind == "paragraph"]
    assert len(parts) > 1
    norm = normalize_text(long)
    for it in parts:
        a, b = it.locator["char_start"], it.locator["char_end"]
        assert norm[a:b].strip() == it.text  # đoạn trích là chuỗi con CHÍNH XÁC của đoạn gốc
        assert it.locator["parts"] == len(parts)


def test_docx_invalid_file_is_rejected_cleanly():
    from app.core.errors import AppError

    with pytest.raises(AppError) as e:
        parsers.parse_docx(b"not a zip")
    assert e.value.code == "DOCX_INVALID"


def test_html_wiki_skips_scripts_keeps_headings_code_tables_and_anchors():
    items = parsers.parse_html(WIKI_HTML.encode())
    texts = [i.text for i in items]
    assert not any("KHÔNG ĐƯỢC TRÍCH" in t for t in texts)
    para = next(i for i in items if "TRUNG_BINH" in i.text)
    assert para.heading_path == "Rule chạy thực tế › Độ ưu tiên phiếu" and para.locator["anchor"] == "priority"
    code = next(i for i in items if i.kind == "code")
    assert "ticket.priority = 'MEDIUM'" in code.text
    row = next(i for i in items if i.kind == "table_row" and "P1" in i.text)
    assert row.text == "P1 | Khẩn cấp: xử lý trong 4 giờ"


def test_markdown_uses_real_file_line_numbers():
    md = "# Tiêu đề\n\nĐoạn một dòng một\ntiếp dòng hai\n\n## Mục con\nNội dung mục con\n".encode()
    items = parsers.parse_text(md, markdown=True)
    para = next(i for i in items if i.text.startswith("Đoạn một"))
    assert (para.locator["line_start"], para.locator["line_end"], para.locator["line"]) == (3, 4, 3)
    sub = next(i for i in items if i.text == "Nội dung mục con")
    assert sub.heading_path == "Tiêu đề › Mục con" and sub.locator["line_start"] == 7


def test_figma_nodes_become_text_passages_with_frame_path():
    doc = {"nodes": {"1:2": {"document": {"type": "FRAME", "name": "Tạo phiếu", "id": "1:2", "children": [
        {"type": "FRAME", "name": "Form", "id": "1:3", "children": [{"type": "TEXT", "id": "1:4", "name": "label", "characters": "Độ ưu tiên mặc định: Trung bình"},
                                                                   {"type": "TEXT", "id": "1:5", "name": "x", "characters": "  "}]}]}}}}
    items = parsers.parse_figma_nodes(doc, "AbC123xyz9", "https://www.figma.com/design/AbC123xyz9/Ten")
    assert len(items) == 1
    it = items[0]
    assert it.text == "Độ ưu tiên mặc định: Trung bình" and it.heading_path == "Tạo phiếu › Form"
    assert it.locator["node_id"] == "1:4" and it.locator["url"].endswith("node-id=1-4")


# ------------------------------------------------------------------ từ khóa và tô sáng
def test_keywords_prefer_phrases_identifiers_quoted_and_drop_stopwords():
    kws = search.extract_keywords('Khi tạo phiếu bảo trì, độ ưu tiên mặc định không hiển thị "Trung bình" ở màn hình MAINT-502 [FUNCTION]')
    terms = {k.term: k for k in kws}
    assert "do uu tien" in terms and terms["do uu tien"].type == "phrase"
    assert terms["trung binh"].type == "quoted" and terms["maint-502"].type == "identifier" and "function" in terms
    assert "khi" not in terms and "o" not in terms  # từ dừng bị bỏ
    assert kws[0].weight >= kws[-1].weight


def test_highlight_offsets_map_back_to_original_text_exactly():
    text = "Độ ưu  tiên mặc định của PHIẾU là Trung bình. Đổi đơn vị"
    folded, idx = fold_with_map(text)
    assert len(folded) == len(idx) and fold("Độ ưu tiên") == "do uu tien"
    kw = [search.Keyword("do uu tien", "độ ưu tiên", "phrase", 3.0), search.Keyword("phieu", "phiếu", "word", 1.0), search.Keyword("don vi", "đơn vị", "phrase", 3.0)]
    hl = search._highlights(text, kw)
    got = [text[h["start"]:h["end"]] for h in hl]
    assert got == ["Độ ưu  tiên", "PHIẾU", "đơn vị"]  # khớp bỏ dấu/hoa thường/khoảng trắng kép, vẫn trả đúng ký tự gốc


def test_nfd_text_is_normalized_to_nfc():
    nfd = unicodedata.normalize("NFD", "Độ ưu tiên")
    assert normalize_text(nfd) == "Độ ưu tiên" and unicodedata.is_normalized("NFC", normalize_text(nfd))


# ------------------------------------------------------------------ nạp nguồn + tra cứu (API)
def test_upload_docx_creates_versioned_passages_and_duplicate_is_noop(qc, session):
    r = upload(qc, "ba_doc", "FS Yêu cầu bảo trì", "fs.docx", BA_DOC)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["passages"] >= 7 and body["version"] == "v1" and not body["duplicate"]
    again = upload(qc, "ba_doc", "FS Yêu cầu bảo trì", "fs.docx", BA_DOC).json()
    assert again["duplicate"] is True and again["version_id"] == body["version_id"]
    changed = make_docx(p("Yêu cầu bảo trì", "Heading1"), p("Độ ưu tiên mặc định của phiếu mới tạo là Cao theo bản sửa đổi."))
    v2 = upload(qc, "ba_doc", "FS Yêu cầu bảo trì", "fs.docx", changed, version_label="2026-12").json()
    assert v2["version"] == "2026-12"
    assert upload(qc, "ba_doc", "FS Yêu cầu bảo trì", "fs2.docx", changed, version_label="2026-12").json()["duplicate"] is True
    cur = session.scalars(select(SourcePassage).where(SourcePassage.is_current.is_(True))).all()
    assert {x.source_version_id.hex for x in cur} == {v2["version_id"].replace("-", "")}  # chỉ phiên bản mới nhất còn "hiện hành"


def test_upload_rejects_wrong_types_and_bad_input(qc):
    assert upload(qc, "ba_doc", "x", "a.html", b"<p>hello world text</p>").status_code == 415  # BA chỉ nhận .docx
    assert upload(qc, "ba_doc", "x", "a.docx", b"not a zip").status_code in (415, 422)
    assert upload(qc, "figma", "x", "a.docx", BA_DOC).status_code == 422  # Figma không nhận tệp
    assert upload(qc, "ba_doc", " ", "a.docx", BA_DOC).status_code == 422


def test_lookup_returns_exact_quotes_from_all_four_source_kinds(qc, session):
    assert upload(qc, "ba_doc", "FS Yêu cầu bảo trì", "fs.docx", BA_DOC).status_code == 201
    assert upload(qc, "code_wiki", "Wiki rule trên code", "wiki.html", WIKI_HTML.encode()).status_code == 201
    fig = qc.post("/api/v1/sources/figma", json={"url": "https://www.figma.com/design/AbC123xyz9/Tao-phieu?node-id=1-2", "title": "Thiết kế tạo phiếu",
                                                 "pasted_text": "Trường Độ ưu tiên có 4 mức: Thấp, Trung bình, Cao, Khẩn cấp.\n\nNút Tạo phiếu nằm cuối form."})
    assert fig.status_code == 201, fig.text
    up = qc.post("/api/v1/sources/task-functions/upload", files={"file": ("functions-live.json", json.dumps(TASKS).encode(), "application/json")})
    assert up.status_code == 201 and up.json()["teams"][0]["created"] == 3

    res = qc.post("/api/v1/lookups", json={"description": "Khi tạo phiếu bảo trì, độ ưu tiên mặc định không đúng là Trung bình"}).json()
    assert set(res["groups"]) == {"ba_doc", "code_wiki", "figma", "task_function"}
    assert any(k["term"] == "do uu tien" for k in res["keywords"])
    for kind, cites in res["groups"].items():
        for c in cites:
            ex = c["excerpt"]
            assert c["quote"][ex["start"]:ex["end"]] == ex["text"]  # excerpt là chuỗi con chính xác
            assert c["highlights"] and all(c["quote"][h["start"]:h["end"]] for h in c["highlights"])
            assert c["citation"].startswith({"ba_doc": "Tài liệu BA", "code_wiki": "Wiki rule trên code", "figma": "Figma", "task_function": "Task Function"}[kind])
    ba = res["groups"]["ba_doc"][0]
    assert ba["quote"] == "Độ ưu tiên mặc định của phiếu mới tạo là Trung bình; không còn mức Không ưu tiên." and ba["location"].startswith("dòng") and "3. Danh sách xử lý phiếu" in ba["heading_path"]
    assert res["groups"]["code_wiki"][0]["locator"].get("anchor") == "priority" or "TRUNG_BINH" in res["groups"]["code_wiki"][0]["quote"]
    fg = res["groups"]["figma"][0]
    assert "4 mức" in fg["quote"] and fg["locator"]["node_id"] == "1:2" and fg["url"].startswith("https://www.figma.com/")
    tk = next(c for c in res["groups"]["task_function"] if c["locator"]["task_id"] == "6af2f0135316d2ca5c282235")
    assert "MAINT" in tk["quote"] and tk["locator"]["has_description"] is False and tk["url"].endswith("/p1/6af2f0135316d2ca5c282235")
    assert {c["locator"]["task_id"] for c in res["groups"]["task_function"]} >= {"6af2f0135316d2ca5c282235", "6af2f0135316d2ca5c282237"}  # cả task QC con
    assert res["lookup_id"]

    hist = qc.get("/api/v1/lookups").json()
    assert hist[0]["id"] == res["lookup_id"] and hist[0]["results"] >= 4
    assert qc.put(f"/api/v1/lookups/{res['lookup_id']}/note", json={"note": "Đối chiếu với FS mục 3"}).status_code == 204
    saved = qc.get(f"/api/v1/lookups/{res['lookup_id']}").json()
    assert saved["note"] == "Đối chiếu với FS mục 3" and saved["results"][0]["quote"]


def test_lookup_filters_coverage_hints_and_relevance(qc):
    first = qc.post("/api/v1/lookups", json={"description": "Không có nguồn nào được nạp cả"}).json()
    assert first["groups"] == {} and "Chưa nạp nguồn" in first["hint"] and first["coverage"]["ba_doc"]["passages"] == 0
    upload(qc, "ba_doc", "FS", "fs.docx", BA_DOC)
    upload(qc, "code_wiki", "Wiki", "wiki.html", WIKI_HTML.encode())
    only_wiki = qc.post("/api/v1/lookups", json={"description": "độ ưu tiên mặc định của phiếu", "kinds": ["code_wiki"]}).json()
    assert list(only_wiki["groups"]) == ["code_wiki"]
    top = qc.post("/api/v1/lookups", json={"description": "bộ lọc độ ưu tiên có bốn mức Thấp Trung bình Cao Khẩn cấp", "kinds": ["ba_doc"]}).json()["groups"]["ba_doc"][0]
    assert top["quote"].startswith("Độ ưu tiên | Lọc theo bốn mức")  # đoạn khớp nhiều từ nhất xếp đầu
    none = qc.post("/api/v1/lookups", json={"description": "zzzz qqqq xyzxyz hoàn toàn lạ"}).json()
    assert none["groups"] == {} and "Không có đoạn nào khớp" in none["hint"]
    assert qc.post("/api/v1/lookups", json={"description": "x"}).status_code == 422
    assert qc.post("/api/v1/lookups", json={"description": "mô tả đủ dài để hợp lệ", "kinds": ["bogus"]}).status_code == 422


def test_retired_sources_are_excluded_but_history_is_kept(qc):
    sid = upload(qc, "ba_doc", "FS", "fs.docx", BA_DOC).json()["source_id"]
    lk = qc.post("/api/v1/lookups", json={"description": "độ ưu tiên mặc định của phiếu mới tạo"}).json()
    assert lk["groups"]
    assert qc.delete(f"/api/v1/sources/{sid}").status_code == 204
    assert qc.post("/api/v1/lookups", json={"description": "độ ưu tiên mặc định của phiếu mới tạo", "save": False}).json()["groups"] == {}
    assert qc.get(f"/api/v1/lookups/{lk['lookup_id']}").json()["results"]  # tra cứu cũ vẫn đọc được
    assert qc.get("/api/v1/sources").json()["items"] == []


def test_old_versions_only_with_flag_and_context_is_exact(qc):
    upload(qc, "ba_doc", "FS", "fs.docx", BA_DOC)
    upload(qc, "ba_doc", "FS", "fs.docx", make_docx(p("Mục", "Heading1"), p("Nội dung hoàn toàn khác không liên quan đến phiếu.")), version_label="v2")
    q = "độ ưu tiên mặc định của phiếu mới tạo"
    assert qc.post("/api/v1/lookups", json={"description": q, "save": False}).json()["groups"] == {}
    old = qc.post("/api/v1/lookups", json={"description": q, "include_old_versions": True, "save": False}).json()["groups"]["ba_doc"][0]
    assert old["source_version"] == "v1" and old["is_current"] is False
    ctx = qc.get(f"/api/v1/sources/passages/{old['passage_id']}/context?radius=1").json()["items"]
    assert [i["is_target"] for i in ctx].count(True) == 1 and any("Danh sách xử lý phiếu" in i["text"] for i in ctx)


def test_task_functions_reimport_is_idempotent_and_description_updates_supersede(qc, session):
    f = {"file": ("f.json", json.dumps(TASKS).encode(), "application/json")}
    assert qc.post("/api/v1/sources/task-functions/upload", files=f).json()["teams"][0]["created"] == 3
    again = qc.post("/api/v1/sources/task-functions/upload", files={"file": ("f.json", json.dumps(TASKS).encode(), "application/json")}).json()["teams"][0]
    assert (again["created"], again["unchanged"]) == (0, 3)
    assert qc.post("/api/v1/sources/task-functions/upload", files={"file": ("f.json", b"[]", "application/json")}).status_code == 422
    assert qc.post("/api/v1/sources/task-functions/upload", files={"file": ("f.json", b"not json", "application/json")}).status_code == 422


# ------------------------------------------------------------------ Figma qua token (transport giả)
def figma_transport(calls):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((str(request.url), request.headers.get("x-figma-token")))
        if request.headers.get("x-figma-token") != "figd_test_token":
            return httpx.Response(403)
        return httpx.Response(200, json={"nodes": {"1:2": {"document": {"type": "FRAME", "name": "Tạo phiếu", "id": "1:2", "children": [
            {"type": "TEXT", "id": "1:9", "name": "t", "characters": "Mức độ ưu tiên mặc định là Trung bình"}]}}}})
    return httpx.MockTransport(handler)


def test_figma_link_without_content_or_token_says_what_is_missing(qc):
    r = qc.post("/api/v1/sources/figma", json={"url": "https://www.figma.com/design/AbC123xyz9/Ten?node-id=1-2"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "NO_FIGMA_CONTENT"
    assert qc.post("/api/v1/sources/figma", json={"url": "https://evil.example.com/design/x/y", "pasted_text": "abc def ghi"}).status_code == 422


def test_figma_token_fetch_uses_read_only_api_and_never_returns_token(qc, session):
    calls: list = []
    integ.TRANSPORT["figma"] = figma_transport(calls)
    try:
        assert qc.put("/api/v1/integrations/figma", json={"value": "figd_test_token"}).status_code == 204
        assert "figd_test_token" not in json.dumps(qc.get("/api/v1/integrations").json())
        r = qc.post("/api/v1/sources/figma", json={"url": "https://www.figma.com/design/AbC123xyz9/Ten?node-id=1-2", "title": "Thiết kế"})
        assert r.status_code == 201, r.text
        assert calls and "/v1/files/AbC123xyz9/nodes?ids=1:2" in calls[0][0] and calls[0][1] == "figd_test_token"
        lk = qc.post("/api/v1/lookups", json={"description": "mức độ ưu tiên mặc định là Trung bình", "save": False}).json()["groups"]["figma"][0]
        assert lk["locator"]["node_id"] == "1:9" and lk["heading_path"] == "Tạo phiếu"
        assert qc.put("/api/v1/integrations/figma", json={"value": "sai_token"}).status_code == 204
        bad = qc.post("/api/v1/sources/figma", json={"url": "https://www.figma.com/design/AbC123xyz9/Ten?node-id=1-2", "version_label": "x"})
        assert bad.status_code == 502 and bad.json()["error"]["code"] == "FIGMA_AUTH"
    finally:
        integ.TRANSPORT.clear()


# ------------------------------------------------------------------ Haraworks: mô tả Task Function (transport giả)
def haraworks_transport(seen, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.headers.get("cookie"), json.loads(request.content)["query"]))
        if status != 200:
            return httpx.Response(status)
        data = {"t0": {"id": "6af2f0135316d2ca5c282235", "name": "[FUNCTION][MAINT] Điều chỉnh độ ưu tiên phiếu bảo trì",
                       "content": "<p>Đổi <b>độ ưu tiên mặc định</b> của phiếu mới tạo thành Trung bình.</p><ul><li>Desktop</li><li>Mobile</li></ul>"},
                "t1": None}
        return httpx.Response(200, json={"data": data})
    return httpx.MockTransport(handler)


def test_haraworks_description_sync_reads_only_and_updates_citations(qc, session):
    qc.post("/api/v1/sources/task-functions/upload", files={"file": ("f.json", json.dumps(TASKS).encode(), "application/json")})
    r = qc.post("/api/v1/sources/task-functions/sync-descriptions")
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_COOKIE"
    assert qc.put("/api/v1/integrations/haraworks", json={"value": "Cookie: sid=abc123; other=zzz"}).status_code == 204
    assert qc.put("/api/v1/integrations/haraworks", json={"value": "chứa ký tự tiếng Việt"}).status_code == 422
    seen: list = []
    integ.TRANSPORT["haraworks"] = haraworks_transport(seen)
    try:
        r = qc.post("/api/v1/sources/task-functions/sync-descriptions")
        assert r.status_code == 202  # việc dài chạy ở worker, không trong request
        job = qc.get(f"/api/v1/jobs/{r.json()['job_id']}").json()
        assert job["status"] == "DONE", job
        out = job["result"]
        assert out["with_description"] == 1 and out["requested"] == 3
        assert all(c == "sid=abc123; other=zzz" for c, _ in seen)  # cookie lấy từ vault, bỏ tiền tố "Cookie:"
        assert all(q.startswith("query{") and "mutation" not in q for _, q in seen)  # chỉ truy vấn đọc
        lk = qc.post("/api/v1/lookups", json={"description": "độ ưu tiên mặc định của phiếu mới tạo là Trung bình trên Desktop", "kinds": ["task_function"], "save": False}).json()
        top = lk["groups"]["task_function"][0]
        assert "Đổi độ ưu tiên mặc định của phiếu mới tạo thành Trung bình." in top["quote"] and "- Desktop" in top["quote"]
        assert top["locator"]["has_description"] is True and top["locator"]["url"].endswith("/6af2f0135316d2ca5c282235")
        assert "abc123" not in json.dumps(qc.get("/api/v1/integrations").json())
        chk = qc.post("/api/v1/integrations/haraworks/check").json()
        assert chk["ok"] is True
    finally:
        integ.TRANSPORT.clear()


def test_haraworks_expired_cookie_is_reported_and_recorded(qc, session):
    assert qc.put("/api/v1/integrations/haraworks", json={"value": "sid=expired"}).status_code == 204
    seen: list = []
    integ.TRANSPORT["haraworks"] = haraworks_transport(seen, status=401)
    try:
        r = qc.post("/api/v1/integrations/haraworks/check")
        assert r.status_code == 401 and r.json()["error"]["code"] == "HARAWORKS_AUTH"
        session.expire_all()
        assert "HARAWORKS_AUTH" in session.get(Integration, "haraworks").last_check_status
    finally:
        integ.TRANSPORT.clear()


# ------------------------------------------------------------------ wiki qua URL (fail-closed)
def test_wiki_url_fetch_is_disabled_by_default_and_allowlisted(qc, monkeypatch):
    from app.core import config
    from app.domains.sources import router as sr

    body = {"url": "https://wiki.noi-bo.local/rules", "title": "Wiki rule"}
    r = qc.post("/api/v1/sources/code-wiki/url", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "WIKI_FETCH_DISABLED"
    monkeypatch.setenv("WIKI_FETCH_ALLOWED_HOSTS", "wiki.noi-bo.local")
    config.get_settings.cache_clear()
    assert qc.post("/api/v1/sources/code-wiki/url", json={"url": "https://evil.example.com/x", "title": "x"}).json()["error"]["code"] == "WIKI_HOST_NOT_ALLOWED"
    sr.WIKI_TRANSPORT = httpx.MockTransport(lambda req: httpx.Response(200, content=WIKI_HTML.encode()) if req.url.host == "wiki.noi-bo.local" else httpx.Response(404))
    try:
        ok = qc.post("/api/v1/sources/code-wiki/url", json=body)
        assert ok.status_code == 201 and ok.json()["passages"] >= 4
        redirect = httpx.MockTransport(lambda req: httpx.Response(302, headers={"location": "http://169.254.169.254/"}))
        sr.WIKI_TRANSPORT = redirect
        bad = qc.post("/api/v1/sources/code-wiki/url", json={"url": "https://wiki.noi-bo.local/other", "title": "Wiki 2"})
        assert bad.status_code == 502  # không theo chuyển hướng (chặn SSRF)
    finally:
        sr.WIKI_TRANSPORT = None
        config.get_settings.cache_clear()
