import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { StatusSelect } from "./StatusSelect";
import { FrameMultiSelect } from "./FrameMultiSelect";

const emptyDraft = () => ({
  date: new Date().toISOString().slice(0, 10),
  category: "",
  seriesCode: "",
  frameCodes: [],
  assignee: "",
  status: "未着手",
  content: "",
});

// クォート囲み・エスケープ("")・改行を含むフィールドに対応した最小限のCSVパーサー。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // 無視(\r\nの\nで改行処理する)
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function HistoryPanel({ clientCode, seriesList = [], frameList = [] }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const load = async () => {
    setError(null);
    try {
      const items = await api.listHistory(clientCode);
      setEntries(items);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listHistory(clientCode)
      .then((items) => !cancelled && setEntries(items))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientCode]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!draft.date) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createHistoryEntry(clientCode, draft);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldCommit = async (historyId, patch) => {
    setEntries((prev) =>
      prev.map((it) => (it.historyId === historyId ? { ...it, ...patch } : it))
    );
    try {
      await api.updateHistoryEntry(clientCode, historyId, patch);
    } catch (err) {
      setError(err.message);
      await load();
    }
  };

  const handleCsvSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを連続で選び直せるようにする
    if (!file) return;

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      for (const row of rows) {
        await api.createHistoryEntry(clientCode, {
          date: "",
          category: "",
          seriesCode: "",
          frameCodes: [],
          assignee: "",
          status: "",
          content: row.map((cell) => cell.trim()).join(" "),
        });
      }
      await load();
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (historyId) => {
    setEntries((prev) => prev.filter((it) => it.historyId !== historyId));
    try {
      await api.deleteHistoryEntry(clientCode, historyId);
    } catch (err) {
      setError(err.message);
      await load();
    }
  };

  if (loading) return <div className="status-line">読み込み中…</div>;

  return (
    <div className="history">
      {error && <div className="error-banner">{error}</div>}

      <div className="history__toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="history__file-input"
          onChange={handleCsvSelected}
          disabled={uploading}
        />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "アップロード中…" : "CSVアップロード"}
        </button>
      </div>

      <form className="history__new" onSubmit={handleAdd}>
        <div className="field">
          <label>日付</label>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label>分類</label>
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </div>
        <div className="field">
          <label>タスク名</label>
          <select
            value={draft.seriesCode}
            onChange={(e) => setDraft({ ...draft, seriesCode: e.target.value })}
          >
            <option value="">未選択</option>
            {seriesList.map((s) => (
              <option key={s.seriesCode} value={s.seriesCode}>
                {s.seriesName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>対象月</label>
          <FrameMultiSelect
            frameList={frameList}
            selected={draft.frameCodes}
            onChange={(frameCodes) => setDraft({ ...draft, frameCodes })}
          />
        </div>
        <div className="field">
          <label>担当者</label>
          <input
            value={draft.assignee}
            onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
          />
        </div>
        <div className="field">
          <label>ステータス</label>
          <StatusSelect
            status={draft.status}
            onChange={(status) => setDraft({ ...draft, status })}
          />
        </div>
        <div className="field field--grow">
          <label>内容</label>
          <input
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="履歴・引き継ぎ事項などを記録してください"
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? "追加中…" : "履歴を追加"}
        </button>
      </form>

      {entries.length === 0 ? (
        <div className="empty">
          <div className="empty__title">履歴はまだありません</div>
          上のフォームから最初の履歴を追加してください。
        </div>
      ) : (
        <table className="history__table">
          <thead>
            <tr>
              <th style={{ width: 130 }}>日付</th>
              <th style={{ width: 120 }}>分類</th>
              <th style={{ width: 160 }}>タスク名</th>
              <th style={{ width: 180 }}>対象月</th>
              <th style={{ width: 100 }}>担当者</th>
              <th style={{ width: 110 }}>ステータス</th>
              <th>内容</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.historyId}>
                <td data-label="日付">
                  <input
                    type="date"
                    className="history__input"
                    defaultValue={entry.date ?? ""}
                    key={`date-${entry.historyId}`}
                    onBlur={(e) => {
                      if (e.target.value !== (entry.date ?? "")) {
                        handleFieldCommit(entry.historyId, { date: e.target.value });
                      }
                    }}
                  />
                </td>
                <td data-label="分類">
                  <input
                    className="history__input"
                    defaultValue={entry.category ?? ""}
                    key={`category-${entry.historyId}`}
                    onBlur={(e) => {
                      if (e.target.value !== (entry.category ?? "")) {
                        handleFieldCommit(entry.historyId, { category: e.target.value });
                      }
                    }}
                  />
                </td>
                <td data-label="タスク名">
                  <select
                    className="history__input"
                    value={entry.seriesCode ?? ""}
                    onChange={(e) =>
                      handleFieldCommit(entry.historyId, { seriesCode: e.target.value })
                    }
                  >
                    <option value="">未選択</option>
                    {seriesList.map((s) => (
                      <option key={s.seriesCode} value={s.seriesCode}>
                        {s.seriesName}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="対象月">
                  <FrameMultiSelect
                    frameList={frameList}
                    selected={entry.frameCodes ?? []}
                    onChange={(frameCodes) =>
                      handleFieldCommit(entry.historyId, { frameCodes })
                    }
                  />
                </td>
                <td data-label="担当者">
                  <input
                    className="history__input"
                    defaultValue={entry.assignee ?? ""}
                    key={`assignee-${entry.historyId}`}
                    onBlur={(e) => {
                      if (e.target.value !== (entry.assignee ?? "")) {
                        handleFieldCommit(entry.historyId, { assignee: e.target.value });
                      }
                    }}
                  />
                </td>
                <td data-label="ステータス">
                  <StatusSelect
                    status={entry.status}
                    onChange={(status) => handleFieldCommit(entry.historyId, { status })}
                  />
                </td>
                <td data-label="内容">
                  <input
                    className="history__input"
                    defaultValue={entry.content ?? ""}
                    key={`content-${entry.historyId}`}
                    onBlur={(e) => {
                      if (e.target.value !== (entry.content ?? "")) {
                        handleFieldCommit(entry.historyId, { content: e.target.value });
                      }
                    }}
                  />
                </td>
                <td data-label="">
                  <button
                    type="button"
                    className="btn btn--ghost history__delete"
                    onClick={() => handleDelete(entry.historyId)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
