import { useEffect, useState } from "react";
import { api } from "./api";

const TABS = ["法人", "個人"];

export function ClientListPage({ onSelectClient }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);
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

  return (
    <section className="panel">
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={"tabs__tab" + (activeTab === tab ? " tabs__tab--active" : "")}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "法人" && (
        <>
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
                  <th>関与タイプ</th>
                  <th>納付方式</th>
                  <th>差出人メールアドレス</th>
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
                        onClick={() => onSelectClient(c.clientCode)}
                      >
                        {c.clientName}
                      </button>
                    </td>
                    <td>{c.assignee || "—"}</td>
                    <td>{c.fiscalYearEndMonth ? `${c.fiscalYearEndMonth}月` : "—"}</td>
                    <td>{c.engagementType || "—"}</td>
                    <td>{c.paymentMethod || "—"}</td>
                    <td>{(c.senderEmails ?? []).join(", ") || "—"}</td>
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
              {submitting ? "登録中…" : "追加"}
            </button>
          </form>
        </>
      )}

      {activeTab === "個人" && (
        <div className="empty">
          <div className="empty__title">工事中</div>
        </div>
      )}
    </section>
  );
}
