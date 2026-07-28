import { useState } from "react";
import { api } from "./api";

export function SeriesListPage({ seriesList, onRefresh }) {
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createSeries(newCode.trim(), newName.trim(), newGroup.trim());
      setNewCode("");
      setNewName("");
      setNewGroup("");
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (seriesCode) => {
    if (!window.confirm(`シリーズ「${seriesCode}」を削除しますか？`)) return;
    setError(null);
    try {
      await api.deleteSeries(seriesCode);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        タスクシリーズ
      </h2>

      {error && <div className="error-banner">{error}</div>}

      {seriesList.length === 0 ? (
        <div className="empty">
          <div className="empty__title">タスクシリーズがありません</div>
        </div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>分類</th>
              <th>シリーズ名</th>
              <th>コード</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {seriesList.map((s) => (
              <tr key={s.seriesCode}>
                <td>{s.taskGroup || "—"}</td>
                <td>{s.seriesName}</td>
                <td className="simple-table__code">{s.seriesCode}</td>
                <td>
                  <button
                    type="button"
                    className="simple-table__delete"
                    onClick={() => remove(s.seriesCode)}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="list-form" onSubmit={create}>
        <div className="field">
          <label htmlFor="new-series-code">シリーズコード</label>
          <input
            id="new-series-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-series-name">シリーズ名</label>
          <input
            id="new-series-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-series-group">分類</label>
          <input
            id="new-series-group"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? "登録中…" : "+ 新規シリーズ"}
        </button>
      </form>
    </section>
  );
}
