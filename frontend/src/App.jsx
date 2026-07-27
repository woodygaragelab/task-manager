import { useCallback, useEffect, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { CustomerSearch } from "./CustomerSearch";
import { TaskTable } from "./TaskTable";
import { NewTaskForm } from "./NewTaskForm";
import { api } from "./api";
import "./App.css";

const POLL_INTERVAL_MS = 4000;

export default function App() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [client, setClient] = useState(null); // {clientCode, clientName} | null
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);

  const refresh = useCallback(async (clientCode) => {
    if (!clientCode) return;
    try {
      const items = await api.listTasksByClient(clientCode);
      const sorted = [...items].sort((a, b) =>
        (a.statusSort || "").localeCompare(b.statusSort || "")
      );
      setTasks(sorted);
      setError(null);
      setLastSynced(new Date());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // 案件を切り替えたら即座にロード
  useEffect(() => {
    if (!client) return;
    setLoading(true);
    refresh(client.clientCode).finally(() => setLoading(false));
  }, [client, refresh]);

  // 複数人での即時反映のための軽量ポーリング
  useEffect(() => {
    if (!client) return;
    const id = setInterval(() => refresh(client.clientCode), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [client, refresh]);

  const handleUpdate = async (taskId, patch) => {
    // 楽観的UI更新:即座に画面へ反映してからAPIを呼ぶ
    setTasks((prev) =>
      prev.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t))
    );
    try {
      await api.updateTask(taskId, patch);
      await refresh(client.clientCode);
    } catch (e) {
      setError(e.message);
      await refresh(client.clientCode); // 失敗時はサーバー側の状態に揃える
    }
  };

  const handleCreate = async (newTask) => {
    try {
      await api.createTask(newTask);
      await refresh(client.clientCode);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">タスクリスト</h1>
        <div className="header__meta">
          {user?.signInDetails?.loginId ?? user?.username}
          <br />
          <button className="header__signout" onClick={() => signOut()}>
            ログアウト
          </button>
        </div>
      </header>

      <CustomerSearch onSelect={setClient} />

      {error && <div className="error-banner">{error}</div>}

      {client ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">
              <span className="panel__title-eyebrow">案件</span>
              {client.clientName}({client.clientCode})
            </h2>
            {lastSynced && (
              <span className="status-line">
                最終同期 {lastSynced.toLocaleTimeString("ja-JP")}
              </span>
            )}
          </div>

          {loading ? (
            <div className="status-line">読み込み中…</div>
          ) : (
            <TaskTable tasks={tasks} onUpdate={handleUpdate} />
          )}

          <NewTaskForm
            clientCode={client.clientCode}
            clientName={client.clientName}
            onCreate={handleCreate}
          />
        </section>
      ) : (
        <div className="empty">
          <div className="empty__title">案件を検索してください</div>
          上の検索欄に案件コードを入力してください(完全一致)。
        </div>
      )}
    </div>
  );
}
