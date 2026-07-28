import { useEffect, useState } from "react";
import { api } from "./api";

export function ClientSidebar({ selectedClientCode, onSelect }) {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  // 既に選択済みの状態でマウントされた場合(例: 他画面から戻ってきた場合)は
  // 最初から折りたたんで表示する
  const [expanded, setExpanded] = useState(!selectedClientCode);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const selectedClient = clients.find((c) => c.clientCode === selectedClientCode) ?? null;

  const handleSelect = (client) => {
    onSelect(client);
    setExpanded(false);
  };

  if (!expanded && selectedClient) {
    return (
      <nav className="sidebar sidebar--collapsed">
        <div className="sidebar__header">クライアント</div>
        <button
          type="button"
          className="sidebar__selected"
          onClick={() => setExpanded(true)}
        >
          <span className="sidebar__item-name">{selectedClient.clientName}</span>
          <span className="sidebar__item-code">{selectedClient.clientCode}</span>
        </button>
      </nav>
    );
  }

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
              onClick={() => handleSelect(c)}
            >
              <span className="sidebar__item-name">{c.clientName}</span>
              <span className="sidebar__item-code">{c.clientCode}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
