import { useEffect, useState } from "react";
import { api } from "./api";

export function ClientListPage() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createClient(newCode.trim(), newName.trim());
      setClients((prev) => [...prev, created]);
      setNewCode("");
      setNewName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (clientCode) => {
    if (!window.confirm(`クライアント「${clientCode}」を削除しますか？`)) return;
    setError(null);
    try {
      await api.deleteClient(clientCode);
      setClients((prev) => prev.filter((c) => c.clientCode !== clientCode));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        クライアント
      </h2>

      {error && <div className="error-banner">{error}</div>}

      {clients.length === 0 ? (
        <div className="empty">
          <div className="empty__title">クライアントがありません</div>
        </div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>コード</th>
              <th>クライアント名</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.clientCode}>
                <td className="simple-table__code">{c.clientCode}</td>
                <td>{c.clientName}</td>
                <td>
                  <button
                    type="button"
                    className="simple-table__delete"
                    onClick={() => remove(c.clientCode)}
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
          <label htmlFor="new-client-code">クライアントコード</label>
          <input
            id="new-client-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-client-name">クライアント名</label>
          <input
            id="new-client-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? "登録中…" : "+ 新規クライアント"}
        </button>
      </form>
    </section>
  );
}
