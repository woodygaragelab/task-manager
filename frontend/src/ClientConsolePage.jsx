import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientProfileTab, CUSTOM_FIELD_CODES } from "./ClientProfileTab";
import { ProgressTab } from "./ProgressTab";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { HistoryTab } from "./HistoryTab";
import { AgentsPanel } from "./AgentsPanel";
import { useAdminMode } from "./AdminModeContext";
import { api } from "./api";

const POLL_INTERVAL_MS = 4000;
const ADMIN_ONLY_TABS = ["法人税", "源泉R8上期", "年調R7"];
const ALL_TABS = ["基本情報", "法人税", "源泉R8上期", "年調R7", "資料進捗", "履歴", "エージェント"];
const DEFAULT_CLIENT = { clientCode: "MM", clientName: "MM株式会社" };
const CORPORATE_TAX_FIELD_CODES = CUSTOM_FIELD_CODES.slice(10, 20);
const WITHHOLDING_FIELD_CODES = CUSTOM_FIELD_CODES.slice(20, 30);
const YEAR_END_ADJUSTMENT_FIELD_CODES = CUSTOM_FIELD_CODES.slice(30, 40);

export function TabCommentBox({ tabKey, comment, onCommit }) {
  return (
    <div className="tab-comment field">
      <label htmlFor={`tab-comment-${tabKey}`}>ユーザー要望コメント</label>
      <textarea
        id={`tab-comment-${tabKey}`}
        rows={3}
        defaultValue={comment}
        key={`${tabKey}-${comment}`}
        placeholder="このタブに関する要望・申し送りを自由に記入してください(タブ単位で共有されます)"
        onBlur={(e) => onCommit(tabKey, e.target.value)}
      />
    </div>
  );
}

function ClientFieldsTab({ client, fieldLabels, codes, labelOffset, onCommitField }) {
  return (
    <table className="simple-table">
      <thead>
        <tr>
          <th>項目名</th>
          <th>値</th>
        </tr>
      </thead>
      <tbody>
        {codes.map((code, i) => (
          <tr key={code}>
            <td>{fieldLabels[code] || `カスタム項目${i + labelOffset}`}</td>
            <td>
              <input
                className="simple-table__input"
                defaultValue={client[code] ?? ""}
                key={`${code}-${client.clientCode}-${client[code] ?? ""}`}
                onBlur={(e) => onCommitField(code, e.target.value)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClientConsolePage({ seriesList, frameList, initialClientCode, onBackToList }) {
  const { adminMode } = useAdminMode();
  const TABS = adminMode
    ? ALL_TABS
    : ALL_TABS.filter((tab) => !ADMIN_ONLY_TABS.includes(tab));
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
  const [fieldLabels, setFieldLabels] = useState({});
  const [tabComments, setTabComments] = useState({});

  useEffect(() => {
    api.getClientFieldLabels().then(setFieldLabels).catch(() => {});
    api.getTabComments().then(setTabComments).catch(() => {});
  }, []);

  useEffect(() => {
    if (!TABS.includes(activeTab)) {
      setActiveTab("資料進捗");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMode]);

  const commitClientField = async (field, value) => {
    if (!client || value === (client[field] ?? "")) return;
    try {
      const updated = await api.updateClient(client.clientCode, { [field]: value });
      setClient(updated);
    } catch (e) {
      setError(e.message);
    }
  };

  const commitTabComment = async (tabKey, value) => {
    if (value === (tabComments[tabKey] ?? "")) return;
    try {
      const updated = await api.updateTabComment(tabKey, value);
      setTabComments(updated);
    } catch (e) {
      setError(e.message);
    }
  };

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
              <button
                type="button"
                className="panel__title-back"
                onClick={onBackToList}
              >
                <span className="panel__title-arrow">&lt;</span>
                <span className="panel__title-eyebrow">関与先</span>
                <span className="panel__title-name">
                  {client ? `${client.clientName}(${client.clientCode})` : "選択してください"}
                </span>
              </button>
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
                <ClientProfileTab
                  client={client}
                  onUpdated={setClient}
                  onDeleted={() => setClient(null)}
                />
              )}

              {adminMode && activeTab === "法人税" && (
                <ClientFieldsTab
                  client={client}
                  fieldLabels={fieldLabels}
                  codes={CORPORATE_TAX_FIELD_CODES}
                  labelOffset={11}
                  onCommitField={commitClientField}
                />
              )}

              {adminMode && activeTab === "源泉R8上期" && (
                <ClientFieldsTab
                  client={client}
                  fieldLabels={fieldLabels}
                  codes={WITHHOLDING_FIELD_CODES}
                  labelOffset={21}
                  onCommitField={commitClientField}
                />
              )}

              {activeTab === "資料進捗" &&
                (loading ? (
                  <div className="status-line">読み込み中…</div>
                ) : (
                  <ProgressTab
                    tasks={tasks}
                    seriesNameByCode={seriesNameByCode}
                    frameNameByCode={frameNameByCode}
                    seriesGroupByCode={seriesGroupByCode}
                    selectedTaskKey={selectedTaskCombinedKey}
                    onSelect={selectTask}
                  />
                ))}

              {activeTab === "履歴" && (
                <HistoryTab
                  clientCode={client.clientCode}
                  seriesList={seriesList}
                  frameList={frameList}
                  onTasksChanged={() => refresh(client.clientCode)}
                />
              )}

              {activeTab === "エージェント" && <AgentsPanel client={client} />}

              {adminMode && activeTab === "年調R7" && (
                <ClientFieldsTab
                  client={client}
                  fieldLabels={fieldLabels}
                  codes={YEAR_END_ADJUSTMENT_FIELD_CODES}
                  labelOffset={31}
                  onCommitField={commitClientField}
                />
              )}

              <TabCommentBox
                tabKey={activeTab}
                comment={tabComments[activeTab] ?? ""}
                onCommit={commitTabComment}
              />
            </>
          ) : (
            <div className="empty">
              <div className="empty__title">クライアントを選択してください</div>
              上の「関与先」をクリックして関与先一覧から選択してください。
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
