import { useState } from "react";

export function NewTaskForm({ clientCode, clientName, onCreate }) {
  const [taskName, setTaskName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!taskName.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        clientCode,
        clientName,
        taskName: taskName.trim(),
        dueDate: dueDate.trim() || "-",
        assignee: assignee.trim(),
      });
      setTaskName("");
      setDueDate("");
      setAssignee("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="new-task" onSubmit={submit}>
      <div className="field">
        <label htmlFor="task-name">タスク名</label>
        <input
          id="task-name"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="例: 6月分請求書"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="due-date">期限</label>
        <input
          id="due-date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          placeholder="07-14 / 至急"
        />
      </div>
      <div className="field">
        <label htmlFor="assignee">担当</label>
        <input
          id="assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="高村"
        />
      </div>
      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? "登録中…" : "タスクを追加"}
      </button>
    </form>
  );
}
