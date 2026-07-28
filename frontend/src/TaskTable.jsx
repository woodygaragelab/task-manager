function formatCompleteDate(value) {
  return value || "—";
}

export function TaskTable({
  tasks,
  seriesNameByCode,
  frameNameByCode,
  selectedTaskKey,
  onSelect,
}) {
  const rowKey = (task) => `${task.seriesCode}#${task.frameCode}`;

  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">タスクはまだありません</div>
        下のフォームから最初のタスクを登録してください。
      </div>
    );
  }

  return (
    <table className="tasks">
      <thead>
        <tr>
          <th>シリーズ</th>
          <th style={{ width: 110 }}>フレーム</th>
          <th style={{ width: 110 }}>状態</th>
          <th style={{ width: 80 }}>担当</th>
          <th style={{ width: 130 }}>完了日</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr
            key={rowKey(task)}
            className={
              "tasks__row" +
              (rowKey(task) === selectedTaskKey ? " tasks__row--selected" : "")
            }
            onClick={() => onSelect(task)}
          >
            <td data-label="シリーズ" className="tasks__taskname">
              {seriesNameByCode[task.seriesCode] ?? task.seriesCode}
            </td>
            <td data-label="フレーム" className="tasks__due">
              {frameNameByCode[task.frameCode] ?? task.frameCode}
            </td>
            <td data-label="状態">
              <span className={`stamp stamp--${task.status}`}>{task.status}</span>
            </td>
            <td data-label="担当">{task.assignee || "—"}</td>
            <td data-label="完了日">{formatCompleteDate(task.completeDate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
