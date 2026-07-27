import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function CustomerSearch({ onSelect }) {
  const [clientCode, setClientCode] = useState("");
  const [newName, setNewName] = useState("");
  const [client, setClient] = useState(null); // {clientCode, clientName} | null
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef();

  useEffect(() => {
    const code = clientCode.trim();
    setClient(null);
    setNotFound(false);
    if (!code) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await api.getClient(code);
        if (found) {
          setClient(found);
        } else {
          setNotFound(true);
        }
      } catch {
        setClient(null);
        setNotFound(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [clientCode]);

  const selectExisting = () => {
    onSelect(client);
    setClientCode("");
    setNewName("");
    setClient(null);
    setNotFound(false);
  };

  const registerNew = () => {
    if (!newName.trim()) return;
    onSelect({ clientCode: clientCode.trim(), clientName: newName.trim() });
    setClientCode("");
    setNewName("");
    setClient(null);
    setNotFound(false);
  };

  return (
    <div className="search">
      <div style={{ flex: 1, position: "relative" }}>
        <input
          className="search__input"
          value={clientCode}
          onChange={(e) => setClientCode(e.target.value)}
          placeholder="案件コードで検索(完全一致、例: GI001)"
        />
        {client && (
          <ul className="search__results">
            <li className="search__result" onClick={selectExisting}>
              {client.clientName}({client.clientCode}) を選択 →
            </li>
          </ul>
        )}
        {notFound && (
          <ul className="search__results">
            <li className="search__result--new" style={{ padding: "8px" }}>
              「{clientCode.trim()}」は未登録です。案件名を入力して新規登録できます。
              <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="案件名"
                />
                <button type="button" onClick={registerNew}>
                  新規登録して選択
                </button>
              </div>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
