"use client";

import { useMemo, useRef, useState } from "react";
import type { TaskParam } from "@/lib/api";

type ParamUsage = {
  key: string;
  lines: number[];
  kind: "param" | "prefix";
};

type AdjustableLiteral = {
  id: string;
  line: number;
  method: string;
  quote: string;
  value: string;
  rawMatch: string;
  suggestedKey: string;
};

type ScriptEditorProps = {
  script: string;
  params: TaskParam[];
  onChangeScript: (next: string) => void;
  onChangeParams?: (next: TaskParam[]) => void;
  readOnly?: boolean;
  minHeight?: number;
};

function slugKey(raw: string, existing: Set<string>): string {
  const folded = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let base = folded || "gia_tri";
  if (/^\d/.test(base)) base = `p_${base}`;
  base = base.slice(0, 26);
  let k = base;
  let i = 2;
  while (existing.has(k)) {
    k = `${base.slice(0, 23)}_${i++}`;
  }
  return k;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LINE_TOKEN_RE =
  /(\/\/.*$)|(ctx\.(?:val|has|list)\(\s*(['"`])[^'"`]+\3(?:\s*,\s*(['"`])(?:\\.|[^\\])*?\4)?\s*\)|ctx\.params\.[A-Za-z0-9_]+|ctx\.params\[['"`][A-Za-z0-9_]+['"`]\]|ctx\.testPrefix|pickOption\([^)]+\)|attachFiles\([^)]+\))|(\b(?:step|assert|openPopup|expectDownload|pickOption|attachFiles|await|async|const|let|return|if|else|for|try|catch|finally|page)\b)|((['"`])(?:\\.|(?!\7)[^\\])*?\7)/g;

function highlightLineHtml(line: string): string {
  if (!line) return " ";
  let out = "";
  let last = 0;
  LINE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINE_TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out += escapeHtml(line.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      out += `<span class="se-tok-comment">${escapeHtml(tok)}</span>`;
    } else if (m[2]) {
      out += `<span class="se-tok-param">${escapeHtml(tok)}</span>`;
    } else if (m[5]) {
      out += `<span class="se-tok-kw">${escapeHtml(tok)}</span>`;
    } else if (m[6]) {
      // Tô xanh các chuỗi nội dung / lựa chọn có thể đổi trong fill/name/option
      out += `<span class="se-tok-val">${escapeHtml(tok)}</span>`;
    } else {
      out += escapeHtml(tok);
    }
    last = m.index + tok.length;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out || " ";
}

export function ScriptEditor({
  script,
  params,
  onChangeScript,
  onChangeParams,
  readOnly = false,
  minHeight = 280,
}: ScriptEditorProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [newParamKey, setNewParamKey] = useState("");
  const [newParamVal, setNewParamVal] = useState("");
  const [showLiterals, setShowLiterals] = useState(true);

  const lines = useMemo(() => (script || "").split("\n"), [script]);

  const highlightedHtml = useMemo(() => {
    return lines
      .map((l, i) => {
        const cls = activeLine === i + 1 ? "se-line is-active" : "se-line";
        return `<div class="${cls}">${highlightLineHtml(l)}</div>`;
      })
      .join("");
  }, [lines, activeLine]);

  // Quét vị trí các parameter và biến đổi có thể chỉnh sửa trong code
  const { usages, literals } = useMemo(() => {
    const map = new Map<string, { lines: number[]; kind: "param" | "prefix" }>();
    const lits: AdjustableLiteral[] = [];
    const existingKeys = new Set(params.map((p) => p.key));

    lines.forEach((line, idx) => {
      const ln = idx + 1;
      const pRe =
        /ctx\.(?:val|has|list)\(\s*(['"`])([A-Za-z][A-Za-z0-9_]*)\1|ctx\.params\.([A-Za-z][A-Za-z0-9_]*)|ctx\.params\[(['"`])([A-Za-z][A-Za-z0-9_]*)\4\]|(?:pickOption|attachFiles)\([^,]+,\s*(['"`])([A-Za-z][A-Za-z0-9_]*)\6/g;
      let m: RegExpExecArray | null;
      while ((m = pRe.exec(line)) !== null) {
        const key = m[2] || m[3] || m[5] || m[7];
        if (!key) continue;
        const entry = map.get(key) || { lines: [], kind: "param" as const };
        if (!entry.lines.includes(ln)) entry.lines.push(ln);
        map.set(key, entry);
      }
      if (line.includes("ctx.testPrefix")) {
        const entry = map.get("testPrefix") || { lines: [], kind: "prefix" as const };
        if (!entry.lines.includes(ln)) entry.lines.push(ln);
        map.set("testPrefix", entry);
      }
      // Tìm các chuỗi giá trị/lựa chọn cứng (.fill('...'), .selectOption('...'), name: '...') chưa tham số hóa
      if (!/ctx\.val\(/.test(line)) {
        const fillRe = /\.(fill|selectOption)\(\s*(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\2\s*\)/g;
        let fm: RegExpExecArray | null;
        while ((fm = fillRe.exec(line)) !== null) {
          lits.push({
            id: `${ln}-${fm.index}`,
            line: ln,
            method: fm[1],
            quote: fm[2],
            value: fm[3],
            rawMatch: fm[0],
            suggestedKey: slugKey(fm[3] || fm[1], existingKeys),
          });
        }
        const optRe = /getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*(['"])([^'"]+)\1/g;
        let om: RegExpExecArray | null;
        while ((om = optRe.exec(line)) !== null) {
          lits.push({
            id: `${ln}-opt-${om.index}`,
            line: ln,
            method: "option",
            quote: om[1],
            value: om[2],
            rawMatch: om[0],
            suggestedKey: slugKey(om[2], existingKeys),
          });
        }
      }
    });

    for (const p of params) {
      if (!map.has(p.key)) map.set(p.key, { lines: [], kind: "param" });
    }

    const outUsages: ParamUsage[] = Array.from(map.entries()).map(([key, v]) => ({
      key,
      lines: v.lines,
      kind: v.kind,
    }));
    return { usages: outUsages, literals: lits.slice(0, 12) };
  }, [lines, params]);

  function syncScroll() {
    if (!taRef.current) return;
    const { scrollTop, scrollLeft } = taRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  }

  function jumpToLine(lineNo: number) {
    setActiveLine(lineNo);
    if (!taRef.current) return;
    const lineHeight = 21;
    const targetTop = Math.max(0, (lineNo - 3) * lineHeight);
    taRef.current.scrollTop = targetTop;
    syncScroll();
    // Đưa con trỏ tới đầu dòng tương ứng
    const pos = lines.slice(0, lineNo - 1).reduce((acc, l) => acc + l.length + 1, 0);
    taRef.current.focus();
    taRef.current.setSelectionRange(pos, pos + (lines[lineNo - 1]?.length ?? 0));
  }

  function updateParamValue(key: string, val: string) {
    if (!onChangeParams) return;
    const exists = params.some((p) => p.key === key);
    if (exists) {
      onChangeParams(params.map((p) => (p.key === key ? { ...p, value: val } : p)));
    } else {
      onChangeParams([...params, { key, label: key, type: "text", value: val, auto: true, fallback: "first" }]);
    }
  }

  function insertParamSnippet() {
    const cleanKey = slugKey(newParamKey || "tham_so", new Set(params.map((p) => p.key)));
    const val = newParamVal || "giá trị mới";
    if (onChangeParams) {
      onChangeParams([...params, { key: cleanKey, label: newParamKey.trim() || cleanKey, type: "text", value: val, auto: true, fallback: "first" }]);
    }
    const snippet = `\n// Tham số ${cleanKey}\nctx.val('${cleanKey}', ${JSON.stringify(val)})`;
    if (taRef.current && typeof taRef.current.selectionStart === "number") {
      const start = taRef.current.selectionStart;
      const end = taRef.current.selectionEnd;
      const next = script.slice(0, start) + snippet + script.slice(end);
      onChangeScript(next);
    } else {
      onChangeScript(script + snippet);
    }
    setNewParamKey("");
    setNewParamVal("");
  }

  function replaceLiteralValue(lit: AdjustableLiteral, nextVal: string) {
    const nextLines = [...lines];
    const lineIdx = lit.line - 1;
    if (!nextLines[lineIdx]) return;
    if (lit.method === "option") {
      nextLines[lineIdx] = nextLines[lineIdx].replace(
        lit.rawMatch,
        `getByRole('option', { name: ${lit.quote}${nextVal}${lit.quote}`,
      );
    } else {
      nextLines[lineIdx] = nextLines[lineIdx].replace(
        lit.rawMatch,
        `.${lit.method}(${lit.quote}${nextVal}${lit.quote})`,
      );
    }
    onChangeScript(nextLines.join("\n"));
  }

  function parameterizeLiteral(lit: AdjustableLiteral) {
    if (!onChangeParams || lit.method === "option") return;
    const key = slugKey(lit.suggestedKey, new Set(params.map((p) => p.key)));
    onChangeParams([
      ...params,
      { key, label: lit.value || key, type: "text", value: lit.value, auto: true, fallback: "first" },
    ]);
    const nextLines = [...lines];
    const lineIdx = lit.line - 1;
    if (!nextLines[lineIdx]) return;
    nextLines[lineIdx] = nextLines[lineIdx].replace(
      lit.rawMatch,
      `.${lit.method}(ctx.val('${key}', ${JSON.stringify(lit.value)}))`,
    );
    onChangeScript(nextLines.join("\n"));
    jumpToLine(lit.line);
  }

  const paramMetaMap = Object.fromEntries(params.map((p) => [p.key, p]));

  return (
    <div className="se-wrap">
      {/* Thanh vị trí tham số & giá trị có thể điều chỉnh nhanh */}
      <div className="se-param-bar">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5 }}>
            🎯 Vị trí Tham số trong code ({usages.length}) &amp; Chú thích màu sắc
          </strong>
          <div className="se-legend">
            <span className="se-leg-item"><i className="se-dot param" /> Tham số (`ctx.val`, `ctx.params`)</span>
            <span className="se-leg-item"><i className="se-dot val" /> Nội dung / Lựa chọn đổi được</span>
            <span className="se-leg-item"><i className="se-dot kw" /> Lệnh Playwright</span>
          </div>
        </div>

        {usages.length > 0 ? (
          <div className="se-chip-list">
            {usages.map((u) => {
              const p = paramMetaMap[u.key];
              const isPrefix = u.kind === "prefix";
              return (
                <div key={u.key} className="se-param-chip">
                  <button
                    type="button"
                    className="se-chip-loc"
                    onClick={() => u.lines[0] && jumpToLine(u.lines[0])}
                    disabled={u.lines.length === 0}
                    title={u.lines.length ? `Nhấn để nhảy tới dòng ${u.lines.join(", ")}` : "Chưa dùng trong script"}
                  >
                    <span className="se-dot param" />
                    <code>{isPrefix ? "ctx.testPrefix" : u.key}</code>
                    <span className="se-line-tag">
                      {u.lines.length ? `Dòng ${u.lines.join(",")}` : "Chưa gắn vào code"}
                    </span>
                  </button>
                  {!isPrefix && onChangeParams && !readOnly && (
                    p?.type === "select" && p.options?.length ? (
                      <select
                        value={p.value}
                        onChange={(e) => updateParamValue(u.key, e.target.value)}
                        style={{ width: "auto", padding: "2px 6px", fontSize: 12 }}
                        aria-label={`Chọn giá trị cho ${u.key}`}
                      >
                        {p.options.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={p?.value ?? ""}
                        onChange={(e) => updateParamValue(u.key, e.target.value)}
                        placeholder="Giá trị mặc định…"
                        style={{ width: 140, padding: "2px 6px", fontSize: 12 }}
                        aria-label={`Giá trị tham số ${u.key}`}
                      />
                    )
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            Chưa có tham số <code>ctx.val(...)</code> nào trong code. Bạn có thể tham số hóa trực tiếp các dòng nội dung xanh bên dưới hoặc thêm tham số mới.
          </div>
        )}

        {literals.length > 0 && !readOnly && (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="sm"
              style={{ fontSize: 11.5, padding: "2px 8px" }}
              onClick={() => setShowLiterals((s) => !s)}
            >
              {showLiterals ? "▾ Ẩn" : "▸ Hiện"} các nội dung / lựa chọn có thể sửa nhanh trong code ({literals.length})
            </button>
            {showLiterals && (
              <div className="se-lit-list">
                {literals.map((lit) => (
                  <div key={lit.id} className="se-lit-row">
                    <button
                      type="button"
                      className="sm"
                      style={{ padding: "1px 6px", fontSize: 11 }}
                      onClick={() => jumpToLine(lit.line)}
                    >
                      Dòng {lit.line} ({lit.method})
                    </button>
                    <input
                      value={lit.value}
                      onChange={(e) => replaceLiteralValue(lit, e.target.value)}
                      style={{ width: 190, padding: "2px 6px", fontSize: 12 }}
                      title="Sửa trực tiếp nội dung / lựa chọn ở dòng này"
                    />
                    {lit.method !== "option" && onChangeParams && (
                      <button
                        type="button"
                        className="sm"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => parameterizeLiteral(lit)}
                        title="Biến giá trị cứng này thành tham số ctx.val(...) để chỉnh khi chạy"
                      >
                        Biến thành tham số
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
            <input
              value={newParamKey}
              onChange={(e) => setNewParamKey(e.target.value)}
              placeholder="Tên tham số mới (vd: ten_phieu)"
              style={{ width: 190, padding: "4px 8px", fontSize: 12 }}
            />
            <input
              value={newParamVal}
              onChange={(e) => setNewParamVal(e.target.value)}
              placeholder="Giá trị mặc định"
              style={{ width: 170, padding: "4px 8px", fontSize: 12 }}
            />
            <button type="button" className="sm" onClick={insertParamSnippet}>
              + Thêm tham số &amp; chèn vào code
            </button>
            <button
              type="button"
              className="sm"
              onClick={() => {
                onChangeScript(
                  (script ? script.trimEnd() + "\n" : "") +
                    "await step('Bước kiểm tra bổ sung', async () => {\n  assert(Boolean(page.url()), 'Kiểm tra điều kiện mong đợi');\n});\n",
                );
              }}
            >
              + Thêm khung step()
            </button>
          </div>
        )}
      </div>

      {/* Trình soạn thảo code có đánh số dòng & tô màu trực tiếp */}
      <div className="se-editor-box" style={{ minHeight }}>
        <div className="se-gutter" ref={gutterRef} aria-hidden="true">
          {lines.map((_, i) => (
            <div key={i} className={`se-gline${activeLine === i + 1 ? " is-active" : ""}`}>
              {i + 1}
            </div>
          ))}
        </div>
        <div className="se-code-stack" style={{ minHeight }}>
          <pre
            ref={preRef}
            className="se-highlight"
            aria-hidden="true"
            // Escape HTML đã xử lý qua escapeHtml() cho mọi token và chuỗi người dùng
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
          <textarea
            ref={taRef}
            className="se-textarea"
            value={script}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onScroll={syncScroll}
            onChange={(e) => onChangeScript(e.target.value)}
            onClick={() => {
              if (!taRef.current) return;
              const upToCaret = script.slice(0, taRef.current.selectionStart);
              setActiveLine(upToCaret.split("\n").length);
            }}
            onKeyUp={() => {
              if (!taRef.current) return;
              const upToCaret = script.slice(0, taRef.current.selectionStart);
              setActiveLine(upToCaret.split("\n").length);
            }}
          />
        </div>
      </div>
    </div>
  );
}
