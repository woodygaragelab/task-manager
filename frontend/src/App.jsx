import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { ClientSidebar } from "./ClientSidebar";
import { TaskTable } from "./TaskTable";
import { ProgressTable } from "./ProgressTable";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { NewTaskForm } from "./NewTaskForm";
import { api } from "./api";
import "./App.css";

const POLL_INTERVAL_MS = 4000;
const TABS = ["進捗", "タスク", "エージェント"];

export default function App() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [client, setClient] = useState(null); // {clientCode, clientName} | null
  const [tasks, setTasks] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [frameList, setFrameList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState(null); // {seriesCode, frameCode} | null
  const [activeTab, setActiveTab] = useState("タスク");

  const refreshMasters = useCallback(async () => {
    try {
      const [series, frames] = await Promise.all([
        api.listSeries(),
        api.listFrames(),
      ]);
      setSeriesList(series);
      setFrameList(frames);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refreshMasters();
  }, [refreshMasters]);

  const refresh = useCallback(async (clientCode) => {
    if (!clientCode) return;
    try {
      const items = await api.listTasksByClient(clientCode);
      const sorted = [...items].sort((a, b) =>
        (a.taskKey || "").localeCompare(b.taskKey || "")
      );
      setTasks(sorted);
      setError(null);
      setLastSynced(new Date());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // クライアントを切り替えたら即座にロードし、詳細パネルは閉じる
  useEffect(() => {
    setSelectedTaskKey(null);
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

  const handleUpdate = async (seriesCode, frameCode, patch) => {
    // 楽観的UI更新:即座に画面へ反映してからAPIを呼ぶ
    setTasks((prev) =>
      prev.map((t) =>
        t.seriesCode === seriesCode && t.frameCode === frameCode
          ? { ...t, ...patch }
          : t
      )
    );
    try {
      await api.updateTask(client.clientCode, seriesCode, frameCode, patch);
      await refresh(client.clientCode);
    } catch (e) {
      setError(e.message);
      await refresh(client.clientCode); // 失敗時はサーバー側の状態に揃える
    }
  };

  const handleCreate = async ({ seriesCode, seriesName }) => {
    // シリーズ1件につき、登録済みの全フレーム分のタスクをまとめて作成する
    try {
      await Promise.all(
        frameList.map((frame) =>
          api.createTask({
            clientCode: client.clientCode,
            seriesCode,
            seriesName,
            frameCode: frame.frameCode,
            frameName: frame.frameName,
          })
        )
      );
      // 新規シリーズが自動登録された可能性があるためマスタも合わせて再取得する
      await Promise.all([refresh(client.clientCode), refreshMasters()]);
    } catch (e) {
      setError(e.message);
    }
  };

  const seriesNameByCode = useMemo(
    () => Object.fromEntries(seriesList.map((s) => [s.seriesCode, s.seriesName])),
    [seriesList]
  );
  const frameNameByCode = useMemo(
    () => Object.fromEntries(frameList.map((f) => [f.frameCode, f.frameName])),
    [frameList]
  );

  const selectedTask = selectedTaskKey
    ? tasks.find(
        (t) =>
          t.seriesCode === selectedTaskKey.seriesCode &&
          t.frameCode === selectedTaskKey.frameCode
      ) ?? null
    : null;

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

      {error && <div className="error-banner">{error}</div>}

      <div className="layout">
        <ClientSidebar selectedClientCode={client?.clientCode} onSelect={setClient} />

        <main className="main">
          {client ? (
            <section className="panel">
              <div className="panel__header">
                <h2 className="panel__title">
                  <span className="panel__title-eyebrow">クライアント</span>
                  {client.clientName}({client.clientCode})
                </h2>
                {lastSynced && (
                  <span className="status-line">
                    最終同期 {lastSynced.toLocaleTimeString("ja-JP")}
                  </span>
                )}
              </div>

              <div className="tabs">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={
                      "tabs__tab" + (activeTab === tab ? " tabs__tab--active" : "")
                    }
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === "進捗" &&
                (loading ? (
                  <div className="status-line">読み込み中…</div>
                ) : (
                  <ProgressTable
                    tasks={tasks}
                    seriesNameByCode={seriesNameByCode}
                    frameNameByCode={frameNameByCode}
                  />
                ))}

              {activeTab === "タスク" && (
                <>
                  {loading ? (
                    <div className="status-line">読み込み中…</div>
                  ) : (
                    <TaskTable
                      tasks={tasks}
                      seriesNameByCode={seriesNameByCode}
                      frameNameByCode={frameNameByCode}
                      selectedTaskKey={
                        selectedTaskKey &&
                        `${selectedTaskKey.seriesCode}#${selectedTaskKey.frameCode}`
                      }
                      onSelect={(task) =>
                        setSelectedTaskKey({
                          seriesCode: task.seriesCode,
                          frameCode: task.frameCode,
                        })
                      }
                    />
                  )}

                  <NewTaskForm seriesList={seriesList} onCreate={handleCreate} />
                </>
              )}
            </section>
          ) : (
            <div className="empty">
              <div className="empty__title">クライアントを選択してください</div>
              左のリストからクライアントを選んでください。
            </div>
          )}
        </main>

        {selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            seriesNameByCode={seriesNameByCode}
            frameNameByCode={frameNameByCode}
            onUpdate={handleUpdate}
            onClose={() => setSelectedTaskKey(null)}
          />
        )}
      </div>
    </div>
  );
}
