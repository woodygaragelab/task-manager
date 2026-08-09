import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientSelector } from "./ClientSelector";
import { ClientProfilePage } from "./ClientProfilePage";
import { ProgressTable } from "./ProgressTable";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { HistoryPanel } from "./HistoryPanel";
import { AgentsPanel } from "./AgentsPanel";
import { api } from "./api";

const POLL_INTERVAL_MS = 4000;
const TABS = ["基本情報", "資料進捗", "履歴", "エージェント"];
const DEFAULT_CLIENT = { clientCode: "MM", clientName: "MM株式会社" };

export function ConsolePage({ seriesList, frameList, initialClientCode }) {
  const initialCode = initialClientCode || DEFAULT_CLIENT.clientCode;
  const [client, setClient] = useState(() =>
    initialClientCode
      ? { clientCode: initialClientCode, clientName: initialClientCode }
      : DEFAULT_CLIENT
  ); // {clientCode, clientName} | null
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState(null); // {seriesCode, frameCode} | null
  const [activeTab, setActiveTab] = useState("資料進捗");

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

  // 初期クライアント(DEFAULT_CLIENTまたはinitialClientCode)はclientCode/clientNameのみを持つため、
  // フォルダIDなどの詳細情報を一覧APIから補完する(エージェントタブのフォルダリンク表示に必要)
  useEffect(() => {
    api
      .listClients()
      .then((items) => {
        setClient((prev) => {
          if (!prev || prev.clientCode !== initialCode) return prev;
          const full = items.find((c) => c.clientCode === initialCode);
          return full || prev;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              {client && <span className="panel__title-arrow">&gt;</span>}
            </h2>
            {client && lastSynced && (
              <span className="status-line">
                最終同期 {lastSynced.toLocaleTimeString("ja-JP")}
              </span>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

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

              {activeTab === "基本情報" && (
                <ClientProfilePage
                  client={client}
                  onUpdated={setClient}
                  onDeleted={() => setClient(null)}
                />
              )}

              {activeTab === "資料進捗" &&
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

              {activeTab === "履歴" && (
                <HistoryPanel
                  clientCode={client.clientCode}
                  seriesList={seriesList}
                  frameList={frameList}
                  onTasksChanged={() => refresh(client.clientCode)}
                />
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
  );
}
