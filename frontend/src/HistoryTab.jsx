import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { StatusSelect, STATUS_OPTIONS } from "./StatusSelect";
import { FrameMultiSelect } from "./FrameMultiSelect";

const emptyDraft = () => ({
  date: new Date().toISOString().slice(0, 10),
  category: "",
  seriesCode: "",
  frameCodes: [],
  assignee: "",
  status: "未着手",
  content: "",
  classifications: {},
});

// 内部形式(YYYY-MM-DD)はそのまま保持し、表示のみMM/DDにする。
function formatDateDisplay(isoDate) {
  if (!isoDate) return "";
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  return `${month}/${day}`;
}

// frameCode(YYYYMM形式)を年月順に並べ、連続する月を「開始-終了月」にまとめて表示する。
// 例: 2月・3月・4月 → "2-4月" / 1月・3月・5月・6月 → "1,3,5-6月"
function formatFrameCodesDisplay(frameCodes, frameNameByCode) {
  if (!frameCodes || frameCodes.length === 0) return "";

  const isYearMonth = (code) => /^\d{6}$/.test(code);
  if (!frameCodes.every(isYearMonth)) {
    return frameCodes.map((code) => frameNameByCode[code] ?? code).join("、");
  }

  const ordinal = (code) =>
    parseInt(code.slice(0, 4), 10) * 12 + (parseInt(code.slice(4, 6), 10) - 1);
  const monthLabel = (code) => {
    const name = frameNameByCode[code];
    const match = name?.match(/(\d{1,2})\s*月/);
    return match ? match[1] : String(parseInt(code.slice(4, 6), 10));
  };

  const sorted = [...frameCodes].sort();
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const lastGroup = groups[groups.length - 1];
    if (ordinal(sorted[i]) === ordinal(lastGroup[lastGroup.length - 1]) + 1) {
      lastGroup.push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }

  const labels = groups.map((g) =>
    g.length === 1 ? monthLabel(g[0]) : `${monthLabel(g[0])}-${monthLabel(g[g.length - 1])}`
  );
  return labels.join(",") + "月";
}

const draftFromEntry = (entry) => ({
  date: entry.date ?? "",
  category: entry.category ?? "",
  seriesCode: entry.seriesCode ?? "",
  frameCodes: entry.frameCodes ?? [],
  assignee: entry.assignee ?? "",
  status: entry.status ?? "未着手",
  content: entry.content ?? "",
  classifications: entry.classifications ?? {},
});

export function HistoryTab({ clientCode, seriesList = [], frameList = [], onTasksChanged }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null); // null: 新規追加モード, historyId: 編集モード
  const [submitting, setSubmitting] = useState(false);
  const [reflecting, setReflecting] = useState(false);

  const seriesNameByCode = useMemo(
    () => Object.fromEntries(seriesList.map((s) => [s.seriesCode, s.seriesName])),
    [seriesList]
  );
  const taskGroups = useMemo(
    () => [...new Set(seriesList.map((s) => s.taskGroup).filter(Boolean))],
    [seriesList]
  );
  const seriesOptionsForCategory = useMemo(
    () =>
      draft.category
        ? seriesList.filter((s) => s.taskGroup === draft.category)
        : seriesList,
    [seriesList, draft.category]
  );
  const frameNameByCode = useMemo(
    () => Object.fromEntries(frameList.map((f) => [f.frameCode, f.frameName])),
    [frameList]
  );

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

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const startEdit = (entry) => {
    setEditingId(entry.historyId);
    setDraft(draftFromEntry(entry));
  };

  // タスク名・対象月が選択されている場合のみ、選択中の対象月のタスクへstatusを反映する。
  // 未選択の場合は反映対象がないため何もしない(呼び出し元でエラー表示するかは各自判断)。
  const reflectProgress = async (seriesCode, frameCodes, status) => {
    if (!seriesCode || frameCodes.length === 0) return;
    setReflecting(true);
    try {
      const results = await Promise.allSettled(
        frameCodes.map((frameCode) =>
          api.updateTask(clientCode, seriesCode, frameCode, { status })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        setError(
          `進捗反映に失敗したタスクがあります(${failed.length}/${results.length}件): ` +
            failed.map((r) => r.reason?.message).join(" / ")
        );
      }
      onTasksChanged?.();
    } finally {
      setReflecting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.date) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateHistoryEntry(clientCode, editingId, draft);
      } else {
        await api.createHistoryEntry(clientCode, draft);
      }
      await reflectProgress(draft.seriesCode, draft.frameCodes, draft.status);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReflectProgress = async () => {
    if (!draft.seriesCode || draft.frameCodes.length === 0) {
      setError("進捗反映にはタスク名と対象月の選択が必要です");
      return;
    }
    setError(null);
    await reflectProgress(draft.seriesCode, draft.frameCodes, draft.status);
  };

  const handleDelete = async (historyId) => {
    setEntries((prev) => prev.filter((it) => it.historyId !== historyId));
    if (editingId === historyId) cancelEdit();
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

      <form className="history__new" onSubmit={handleSubmit}>
        <div className="history__new-row">
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
            <label>担当者</label>
            <input
              value={draft.assignee}
              onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
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
        </div>

        <div className="history__new-row">
          <div className="field">
            <label>分類</label>
            <select
              value={draft.category}
              onChange={(e) => {
                const category = e.target.value;
                const seriesStillValid = seriesList.some(
                  (s) => s.seriesCode === draft.seriesCode && s.taskGroup === category
                );
                setDraft({
                  ...draft,
                  category,
                  seriesCode: seriesStillValid ? draft.seriesCode : "",
                });
              }}
            >
              <option value="">未選択</option>
              {taskGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>タスク名</label>
            <select
              value={draft.seriesCode}
              onChange={(e) => setDraft({ ...draft, seriesCode: e.target.value })}
            >
              <option value="">未選択</option>
              {seriesOptionsForCategory.map((s) => (
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
            <label>ステータス</label>
            <StatusSelect
              status={draft.status}
              onChange={(status) => setDraft({ ...draft, status })}
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={submitting}>
            {submitting ? "保存中…" : editingId ? "更新" : "追加"}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleReflectProgress}
              disabled={submitting || reflecting}
            >
              {reflecting ? "反映中…" : "進捗反映"}
            </button>
          )}
          {editingId && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={cancelEdit}
              disabled={submitting || reflecting}
            >
              キャンセル
            </button>
          )}
        </div>
      </form>

      {entries.length === 0 ? (
        <div className="empty">
          <div className="empty__title">履歴はまだありません</div>
          上のフォームから最初の履歴を追加してください。
        </div>
      ) : (
        <div className="history__table-scroll">
        <table className="history__table">
          <thead>
            <tr>
              <th style={{ width: 130 }}>日付</th>
              <th style={{ width: 100 }}>担当者</th>
              <th>内容</th>
              <th style={{ width: 120 }}>分類</th>
              <th style={{ width: 160 }}>タスク名</th>
              <th style={{ width: 180 }}>対象月</th>
              <th style={{ width: 110 }}>ステータス</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.historyId}
                className={
                  "history__row" +
                  (entry.historyId === editingId ? " history__row--selected" : "")
                }
                onClick={() => startEdit(entry)}
              >
                <td data-label="日付">{formatDateDisplay(entry.date)}</td>
                <td data-label="担当者">{entry.assignee ?? ""}</td>
                <td data-label="内容">{entry.content ?? ""}</td>
                <td data-label="分類">{entry.category ?? ""}</td>
                <td data-label="タスク名">
                  {seriesNameByCode[entry.seriesCode] ?? ""}
                </td>
                <td data-label="対象月">
                  {formatFrameCodesDisplay(entry.frameCodes, frameNameByCode)}
                </td>
                <td data-label="ステータス">
                  <span className={`stamp stamp--${entry.status}`}>{entry.status}</span>
                </td>
                <td data-label="">
                  <button
                    type="button"
                    className="btn btn--ghost history__delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry.historyId);
                    }}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
