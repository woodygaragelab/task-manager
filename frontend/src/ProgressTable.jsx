export function ProgressTable({
  tasks,
  seriesNameByCode,
  frameNameByCode,
  selectedTaskKey,
  onSelect,
}) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">タスクがありません</div>
        「タスク」タブからタスクを登録すると、ここに進捗表が表示されます。
      </div>
    );
  }

  const seriesCodes = [...new Set(tasks.map((t) => t.seriesCode))].sort();
  const frameCodes = [...new Set(tasks.map((t) => t.frameCode))].sort();
  const taskByKey = Object.fromEntries(
    tasks.map((t) => [`${t.seriesCode}#${t.frameCode}`, t])
  );

  return (
    <table className="progress">
      <thead>
        <tr>
          <th>タスク名</th>
          {frameCodes.map((frameCode) => (
            <th key={frameCode}>{frameNameByCode[frameCode] ?? frameCode}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {seriesCodes.map((seriesCode) => (
          <tr key={seriesCode}>
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
                    <span className={`stamp stamp--${task.status}`}>{task.status}</span>
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
  );
}
