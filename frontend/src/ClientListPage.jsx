import { useEffect, useState } from "react";
import { api } from "./api";

export function ClientListPage() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

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
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.clientCode}>
                <td className="simple-table__code">{c.clientCode}</td>
                <td>{c.clientName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
