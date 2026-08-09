import { useEffect, useState } from "react";
import { api } from "./api";
import { ClientProfilePage } from "./ClientProfilePage";

export function ClientListPage() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newReceiptFolderId, setNewReceiptFolderId] = useState("");
  const [newRenamedFolderId, setNewRenamedFolderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedClientCode, setSelectedClientCode] = useState(null);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createClient(newCode.trim(), newName.trim(), {
        receiptFolderId: newReceiptFolderId.trim() || undefined,
        renamedFolderId: newRenamedFolderId.trim() || undefined,
      });
      setClients((prev) => [...prev, created]);
      setNewCode("");
      setNewName("");
      setNewReceiptFolderId("");
      setNewRenamedFolderId("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedClient = clients.find((c) => c.clientCode === selectedClientCode);

  if (selectedClient) {
    return (
      <ClientProfilePage
        client={selectedClient}
        onBack={() => setSelectedClientCode(null)}
        onUpdated={(updated) =>
          setClients((prev) =>
            prev.map((c) => (c.clientCode === updated.clientCode ? updated : c))
          )
        }
        onDeleted={(clientCode) => {
          setClients((prev) => prev.filter((c) => c.clientCode !== clientCode));
          setSelectedClientCode(null);
        }}
      />
    );
  }

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
              <th>関与先番号</th>
              <th>関与先名</th>
              <th>担当者</th>
              <th>決算月</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.clientCode}>
                <td className="simple-table__code">{c.clientCode}</td>
                <td>
                  <button
                    type="button"
                    className="simple-table__link"
                    onClick={() => setSelectedClientCode(c.clientCode)}
                  >
                    {c.clientName}
                  </button>
                </td>
                <td>{c.assignee || "—"}</td>
                <td>{c.fiscalYearEndMonth ? `${c.fiscalYearEndMonth}月` : "—"}</td>
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
        <div className="field">
          <label htmlFor="new-client-receipt-folder">領収書フォルダID(任意)</label>
          <input
            id="new-client-receipt-folder"
            value={newReceiptFolderId}
            onChange={(e) => setNewReceiptFolderId(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-client-renamed-folder">分類後フォルダID(任意)</label>
          <input
            id="new-client-renamed-folder"
            value={newRenamedFolderId}
            onChange={(e) => setNewRenamedFolderId(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={submitting}>
          {submitting ? "登録中…" : "+ 新規クライアント"}
        </button>
      </form>
    </section>
  );
}
