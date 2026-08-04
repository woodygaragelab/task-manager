import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientSelector } from "./ClientSelector";
import { TaskTable } from "./TaskTable";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { NewTaskForm } from "./NewTaskForm";
import { api } from "./api";

export function TaskDataQueryPage() {
  const [client, setClient] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [frameList, setFrameList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTaskKey, setSelectedTaskKey] = useState(null); // {seriesCode, frameCode} | null

  useEffect(() => {
    Promise.all([api.listSeries(), api.listFrames()])
      .then(([series, frames]) => {
        setSeriesList(series);
        setFrameList(frames);
      })
      .catch((e) => setError(e.message));
  }, []);

  const refresh = useCallback(async (clientCode) => {
    if (!clientCode) return;
    try {
      const items = await api.listTasksByClient(clientCode);
      const sorted = [...items].sort((a, b) =>
        (a.taskKey || "").localeCompare(b.taskKey || "")
      );
      setTasks(sorted);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    setSelectedTaskKey(null);
    if (!client) {
      setTasks([]);
      return;
    }
    setLoading(true);
    refresh(client.clientCode).finally(() => setLoading(false));
  }, [client, refresh]);

  const handleUpdate = async (seriesCode, frameCode, patch) => {
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
      await refresh(client.clientCode);
    }
  };

  const handleCreate = async ({ seriesCode, seriesName }) => {
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
          </div>

          {error && <div className="error-banner">{error}</div>}

          {client ? (
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
