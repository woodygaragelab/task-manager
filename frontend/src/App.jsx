import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { ClientSelector } from "./ClientSelector";
import { TaskTable } from "./TaskTable";
import { ProgressTable } from "./ProgressTable";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { HistoryPanel } from "./HistoryPanel";
import { NewTaskForm } from "./NewTaskForm";
import { AgentsPanel } from "./AgentsPanel";
import { NavMenu } from "./NavMenu";
import { ClientListPage } from "./ClientListPage";
import { SeriesListPage } from "./SeriesListPage";
import { FrameListPage } from "./FrameListPage";
import { api } from "./api";
import "./App.css";

const POLL_INTERVAL_MS = 4000;
const TABS = ["進捗", "履歴", "タスク", "エージェント"];
const DEFAULT_CLIENT = { clientCode: "MM", clientName: "MM株式会社" };

export default function App() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [client, setClient] = useState(DEFAULT_CLIENT); // {clientCode, clientName} | null
  const [tasks, setTasks] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [frameList, setFrameList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState(null); // {seriesCode, frameCode} | null
  const [activeTab, setActiveTab] = useState("進捗");
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState("進捗"); // 進捗 | クライアント | タスクシリーズ | フレーム

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

  // DEFAULT_CLIENTはclientCode/clientNameのみを持つため、
  // フォルダIDなどの詳細情報を一覧APIから補完する(エージェントタブのフォルダリンク表示に必要)
  useEffect(() => {
    api
      .listClients()
      .then((items) => {
        setClient((prev) => {
          if (!prev || prev.clientCode !== DEFAULT_CLIENT.clientCode) return prev;
          const full = items.find((c) => c.clientCode === prev.clientCode);
          return full || prev;
        });
      })
      .catch(() => {});
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
    // 既存シリーズ1件につき、登録済みの全フレーム分のタスクをまとめて作成する
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
      await refresh(client.clientCode);
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
  const seriesGroupByCode = useMemo(
    () => Object.fromEntries(seriesList.map((s) => [s.seriesCode, s.taskGroup])),
    [seriesList]
  );

  const selectedTask = selectedTaskKey
    ? tasks.find(
        (t) =>
          t.seriesCode === selectedTaskKey.seriesCode &&
          t.frameCode === selectedTaskKey.frameCode
      ) ?? null
    : null;
  const selectedTaskCombinedKey =
    selectedTaskKey && `${selectedTaskKey.seriesCode}#${selectedTaskKey.frameCode}`;

  const selectTask = (task) =>
    setSelectedTaskKey({ seriesCode: task.seriesCode, frameCode: task.frameCode });

  return (
    <div className="app">
      <header className="header">
        <div className="header__left">
          <button
            type="button"
            className="hamburger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="メニュー"
          >
            ☰
          </button>
          <div className="header__title-group">
            <h1 className="header__title">Amorphous Console</h1>
            <div className="header__subtitle">税理士タスク管理</div>
          </div>
          <NavMenu
            open={menuOpen}
            currentView={currentView}
            onSelect={(view) => {
              setCurrentView(view);
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
          />
        </div>

        <div className="header__meta">
          {user?.signInDetails?.loginId ?? user?.username}
          <br />
          <button className="header__signout" onClick={() => signOut()}>
            ログアウト
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {currentView === "クライアント" && <ClientListPage />}
      {currentView === "タスクシリーズ" && (
        <SeriesListPage seriesList={seriesList} onRefresh={refreshMasters} />
      )}
      {currentView === "フレーム" && (
        <FrameListPage frameList={frameList} onRefresh={refreshMasters} />
      )}

      {currentView === "進捗" && (
        <div className="layout">
          <main className="main">
            <section className="panel">
              <div className="panel__header">
                <h2 className="panel__title">
                  <span className="panel__title-eyebrow">クライアント</span>
                  <ClientSelector
                    variant="panel"
                    selectedClientCode={client?.clientCode}
                    onSelect={setClient}
                  />
                </h2>
                {client && lastSynced && (
                  <span className="status-line">
                    最終同期 {lastSynced.toLocaleTimeString("ja-JP")}
                  </span>
                )}
              </div>

              {client ? (
                <>
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
                        seriesGroupByCode={seriesGroupByCode}
                        selectedTaskKey={selectedTaskCombinedKey}
                        onSelect={selectTask}
                      />
                    ))}

                  {activeTab === "履歴" && <HistoryPanel clientCode={client.clientCode} />}

                  {activeTab === "タスク" && (
                    <>
                      {loading ? (
                        <div className="status-line">読み込み中…</div>
                      ) : (
                        <TaskTable
                          tasks={tasks}
                          seriesNameByCode={seriesNameByCode}
                          frameNameByCode={frameNameByCode}
                          seriesGroupByCode={seriesGroupByCode}
                          selectedTaskKey={selectedTaskCombinedKey}
                          onSelect={selectTask}
                        />
                      )}

                      <NewTaskForm seriesList={seriesList} onCreate={handleCreate} />
                    </>
                  )}

                  {activeTab === "エージェント" && <AgentsPanel client={client} />}
                </>
              ) : (
                <div className="empty">
                  <div className="empty__title">クライアントを選択してください</div>
                  上のクライアント名をクリックして選択してください。
                </div>
              )}
            </section>
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
      )}
    </div>
  );
}
