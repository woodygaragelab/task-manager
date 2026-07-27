import { useState } from "react";
import { StatusSelect } from "./StatusSelect";

export function TaskTable({ tasks, seriesNameByCode, frameNameByCode, onUpdate }) {
  const [drafts, setDrafts] = useState({});

  const rowKey = (task) => `${task.seriesCode}#${task.frameCode}`;

  const draftFor = (task, field) =>
    drafts[rowKey(task)]?.[field] ?? task[field] ?? "";

  const setDraft = (task, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [rowKey(task)]: { ...prev[rowKey(task)], [field]: value },
    }));
  };

  const commit = (task, field) => {
    const value = draftFor(task, field);
    if (value === (task[field] ?? "")) return;
    onUpdate(task.seriesCode, task.frameCode, { [field]: value });
  };

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
          <tr key={rowKey(task)}>
            <td data-label="シリーズ" className="tasks__taskname">
              {seriesNameByCode[task.seriesCode] ?? task.seriesCode}
            </td>
            <td data-label="フレーム" className="tasks__due">
              {frameNameByCode[task.frameCode] ?? task.frameCode}
            </td>
            <td data-label="状態">
              <StatusSelect
                status={task.status}
                onChange={(status) =>
                  onUpdate(task.seriesCode, task.frameCode, { status })
                }
              />
            </td>
            <td data-label="担当">
              <input
                className="tasks__assignee"
                value={draftFor(task, "assignee")}
                onChange={(e) => setDraft(task, "assignee", e.target.value)}
                onBlur={() => commit(task, "assignee")}
                placeholder="—"
              />
            </td>
            <td data-label="完了日">
              <input
                type="date"
                className="tasks__assignee"
                value={draftFor(task, "completeDate")}
                onChange={(e) => setDraft(task, "completeDate", e.target.value)}
                onBlur={() => commit(task, "completeDate")}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
