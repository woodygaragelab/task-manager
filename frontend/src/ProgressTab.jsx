import { useMemo, useState } from "react";

const STATUS_ABBR = {
  未着手: "未",
  依頼中: "依",
  確認中: "確",
  進行中: "進",
  完了: "完",
};

export function ProgressTab({
  tasks,
  seriesNameByCode,
  frameNameByCode,
  seriesGroupByCode,
  selectedTaskKey,
  onSelect,
}) {
  const [groupFilter, setGroupFilter] = useState("all");

  const groups = useMemo(
    () =>
      [...new Set(tasks.map((t) => seriesGroupByCode[t.seriesCode] || "—"))].sort(),
    [tasks, seriesGroupByCode]
  );

  const filteredTasks = useMemo(
    () =>
      groupFilter === "all"
        ? tasks
        : tasks.filter((t) => (seriesGroupByCode[t.seriesCode] || "—") === groupFilter),
    [tasks, seriesGroupByCode, groupFilter]
  );

  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">タスクがありません</div>
        「タスク」タブからタスクを登録すると、ここに進捗表が表示されます。
      </div>
    );
  }

  const seriesCodes = [...new Set(filteredTasks.map((t) => t.seriesCode))].sort();
  const frameCodes = [...new Set(tasks.map((t) => t.frameCode))].sort();
  const taskByKey = Object.fromEntries(
    filteredTasks.map((t) => [`${t.seriesCode}#${t.frameCode}`, t])
  );

  return (
    <>
      <table className="progress">
        <thead>
          <tr>
            <th className="progress__group-header">
              <select
                className="progress-filter__select"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="all">分類: すべて</option>
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </th>
            <th>タスク名</th>
            {frameCodes.map((frameCode) => (
              <th key={frameCode}>{frameNameByCode[frameCode] ?? frameCode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seriesCodes.map((seriesCode) => (
            <tr key={seriesCode}>
              <td className="progress__group">
                {seriesGroupByCode[seriesCode] || "—"}
              </td>
              <td className="progress__series">
                {seriesNameByCode[seriesCode] ?? seriesCode}
              </td>
              {frameCodes.map((frameCode) => {
                const key = `${seriesCode}#${frameCode}`;
                const task = taskByKey[key];
                return (
                  <td
                    key={frameCode}
                    className={
                      "progress__cell" +
                      (task ? " progress__cell--clickable" : "") +
                      (key === selectedTaskKey ? " progress__cell--selected" : "")
                    }
                    onClick={task ? () => onSelect(task) : undefined}
                  >
                    {task ? (
                      <span
                        className={`stamp stamp--${task.status}`}
                        title={task.status}
                      >
                        {STATUS_ABBR[task.status] ?? task.status}
                      </span>
                    ) : (
                      <span className="progress__none">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {seriesCodes.length === 0 && (
        <div className="empty">
          <div className="empty__title">該当するタスクがありません</div>
          分類フィルタを変更してください。
        </div>
      )}
    </>
  );
}
