import { useMemo, useState } from "react";

const STATUS_ABBR = {
  未着手: "未",
  依頼中: "依",
  確認中: "確",
  進行中: "進",
  完了: "完",
};

const driveUrl = (folderId) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}?usp=drive_link` : null;

export function ProgressTab({
  tasks,
  seriesNameByCode,
  frameNameByCode,
  seriesGroupByCode,
  selectedTaskKey,
  onSelect,
  renamedFolderId,
  uketoriFolderId,
  showSeriesName = true,
}) {
  const [groupFilter, setGroupFilter] = useState("all");
  const organizedFolderUrl = driveUrl(renamedFolderId);
  const uketoriFolderUrl = driveUrl(uketoriFolderId);

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
            {showSeriesName && <th>タスク名</th>}
            <th>受領フォルダ</th>
            <th>整理済フォルダ</th>
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
              {showSeriesName && (
                <td className="progress__series">
                  {seriesNameByCode[seriesCode] ?? seriesCode}
                </td>
              )}
              <td className="progress__folder">
                {uketoriFolderUrl ? (
                  <a href={uketoriFolderUrl} target="_blank" rel="noreferrer">
                    /受領
                  </a>
                ) : (
                  <span className="progress__none">/受領</span>
                )}
              </td>
              <td className="progress__folder">
                {organizedFolderUrl ? (
                  <a href={organizedFolderUrl} target="_blank" rel="noreferrer">
                    /整理済
                  </a>
                ) : (
                  <span className="progress__none">/整理済</span>
                )}
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
