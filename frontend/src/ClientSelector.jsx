import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function ClientSelector({ selectedClientCode, onSelect }) {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedClient = clients.find((c) => c.clientCode === selectedClientCode) ?? null;

  const handleSelect = (client) => {
    onSelect(client);
    setOpen(false);
  };

  return (
    <div className="client-selector" ref={ref}>
      <button
        type="button"
        className="client-selector__trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="client-selector__eyebrow">クライアント</span>
        <span className="client-selector__name">
          {selectedClient
            ? `${selectedClient.clientName}(${selectedClient.clientCode})`
            : "選択してください"}
        </span>
      </button>

      {open && (
        <div className="client-selector__dropdown">
          {error && <div className="error-banner">{error}</div>}
          <ul className="client-selector__list">
            {clients.map((c) => (
              <li key={c.clientCode}>
                <button
                  type="button"
                  className={
                    "client-selector__item" +
                    (c.clientCode === selectedClientCode ? " client-selector__item--active" : "")
                  }
                  onClick={() => handleSelect(c)}
                >
                  <span className="client-selector__item-name">{c.clientName}</span>
                  <span className="client-selector__item-code">{c.clientCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
