import { useState } from "react";
import { api } from "./api";

export function FrameListPage({ frameList, onRefresh }) {
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...frameList].sort((a, b) => a.frameCode.localeCompare(b.frameCode));

  const create = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createFrame(newCode.trim(), newName.trim());
      setNewCode("");
      setNewName("");
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (frameCode) => {
    if (!window.confirm(`フレーム「${frameCode}」を削除しますか？`)) return;
    setError(null);
    try {
      await api.deleteFrame(frameCode);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        フレーム
      </h2>

      {error && <div className="error-banner">{error}</div>}

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="empty__title">フレームがありません</div>
        </div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>コード</th>
              <th>フレーム名</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f.frameCode}>
                <td className="simple-table__code">{f.frameCode}</td>
                <td>{f.frameName}</td>
                <td>
                  <button
                    type="button"
                    className="simple-table__delete"
                    onClick={() => remove(f.frameCode)}
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
          <label htmlFor="new-frame-code">フレームコード</label>
          <input
            id="new-frame-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="例: 202608"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-frame-name">フレーム名</label>
          <input
            id="new-frame-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: 8月"
            required
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? "登録中…" : "+ 新規フレーム"}
        </button>
      </form>
    </section>
  );
}
