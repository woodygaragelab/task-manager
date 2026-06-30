import { useState } from "react";
import { StatusStamp } from "./StatusStamp";

function formatDue(due) {
  if (!due || due === "-") return "—";
  if (due === "至急") return "至急";
  return due.replace(/^2026-/, "");
}

export function TaskTable({ tasks, onUpdate }) {
  const [drafts, setDrafts] = useState({});

  const draftFor = (task, field) =>
    drafts[task.taskId]?.[field] ?? task[field] ?? "";

  const setDraft = (taskId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], [field]: value },
    }));
  };

  const commit = (task, field) => {
    const value = draftFor(task, field);
    if (value === (task[field] ?? "")) return;
    onUpdate(task.taskId, { [field]: value });
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
          <th style={{ width: 56 }}>No</th>
          <th>タスク</th>
          <th style={{ width: 100 }}>状態</th>
          <th style={{ width: 76 }}>期限</th>
          <th style={{ width: 64 }}>担当</th>
          <th>結論</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.taskId}>
            <td data-label="No" className="tasks__id">
              {task.taskId}
            </td>
            <td data-label="タスク" className="tasks__taskname">
              {task.taskName}
            </td>
            <td data-label="状態">
              <StatusStamp
                status={task.status}
                onChange={(status) => onUpdate(task.taskId, { status })}
              />
            </td>
            <td data-label="期限" className="tasks__due">
              {formatDue(task.dueDate)}
            </td>
            <td data-label="担当">
              <input
                className="tasks__assignee"
                value={draftFor(task, "assignee")}
                onChange={(e) =>
                  setDraft(task.taskId, "assignee", e.target.value)
                }
                onBlur={() => commit(task, "assignee")}
                placeholder="—"
              />
            </td>
            <td data-label="結論">
              <textarea
                className="tasks__conclusion"
                rows={1}
                value={draftFor(task, "conclusion")}
                onChange={(e) =>
                  setDraft(task.taskId, "conclusion", e.target.value)
                }
                onBlur={() => commit(task, "conclusion")}
                placeholder="未記入"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
