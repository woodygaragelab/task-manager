import { useEffect, useState } from "react";
import { api } from "./api";

export function ClientSidebar({ selectedClientCode, onSelect }) {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const cancelAdd = () => {
    setAdding(false);
    setNewCode("");
    setNewName("");
    setError(null);
  };

  const registerNew = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createClient(newCode.trim(), newName.trim());
      setClients((prev) => [...prev, created]);
      onSelect(created);
      cancelAdd();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <nav className="sidebar">
      <div className="sidebar__header">クライアント</div>

      {error && <div className="error-banner">{error}</div>}

      <ul className="sidebar__list">
        {clients.map((c) => (
          <li key={c.clientCode}>
            <button
              type="button"
              className={
                "sidebar__item" +
                (c.clientCode === selectedClientCode ? " sidebar__item--active" : "")
              }
              onClick={() => onSelect(c)}
            >
              <span className="sidebar__item-name">{c.clientName}</span>
              <span className="sidebar__item-code">{c.clientCode}</span>
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <form className="sidebar__new-form" onSubmit={registerNew}>
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="クライアントコード"
            required
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="クライアント名"
            required
          />
          <div className="sidebar__new-actions">
            <button className="btn btn--primary" type="submit" disabled={creating}>
              {creating ? "登録中…" : "登録"}
            </button>
            <button className="btn btn--ghost" type="button" onClick={cancelAdd}>
              キャンセル
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="sidebar__add"
          onClick={() => setAdding(true)}
        >
          + 新規クライアント
        </button>
      )}
    </nav>
  );
}
