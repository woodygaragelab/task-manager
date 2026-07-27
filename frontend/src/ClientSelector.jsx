import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

export function ClientSelector({ onSelect }) {
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const q = query.trim();
  const matches = useMemo(() => {
    if (!q) return [];
    const lower = q.toLowerCase();
    return clients.filter(
      (c) =>
        c.clientCode.toLowerCase().includes(lower) ||
        c.clientName.toLowerCase().includes(lower)
    );
  }, [clients, q]);

  const exactMatch = clients.some((c) => c.clientCode === q);

  const select = (client) => {
    onSelect(client);
    setQuery("");
    setNewName("");
    setError(null);
  };

  const registerNew = async () => {
    if (!q || !newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createClient(q, newName.trim());
      setClients((prev) => [...prev, created]);
      select(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="search">
      <div style={{ flex: 1, position: "relative" }}>
        <input
          className="search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="クライアントを検索(コード/名称)"
        />
        {error && <div className="error-banner">{error}</div>}
        {q && matches.length > 0 && (
          <ul className="search__results">
            {matches.map((c) => (
              <li
                key={c.clientCode}
                className="search__result"
                onClick={() => select(c)}
              >
                {c.clientName}({c.clientCode}) を選択 →
              </li>
            ))}
          </ul>
        )}
        {q && matches.length === 0 && !exactMatch && (
          <ul className="search__results">
            <li className="search__result--new" style={{ padding: "8px" }}>
              「{q}」は未登録です。クライアント名を入力して新規登録できます。
              <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="クライアント名"
                />
                <button type="button" onClick={registerNew} disabled={creating}>
                  {creating ? "登録中…" : "新規登録して選択"}
                </button>
              </div>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
