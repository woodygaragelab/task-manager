import { StatusSelect } from "./StatusSelect";

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ja-JP");
}

export function TaskDetailPanel({ task, seriesNameByCode, frameNameByCode, onUpdate, onClose }) {
  if (!task) return null;

  const commitAssignee = (e) => {
    const value = e.target.value;
    if (value === (task.assignee ?? "")) return;
    onUpdate(task.seriesCode, task.frameCode, { assignee: value });
  };

  const commitCompleteDate = (e) => {
    const value = e.target.value;
    if (value === (task.completeDate ?? "")) return;
    onUpdate(task.seriesCode, task.frameCode, { completeDate: value });
  };

  return (
    <aside className="detail">
      <div className="detail__header">
        <span className="detail__eyebrow">タスク詳細</span>
        <button type="button" className="detail__close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <dl className="detail__fields">
        <div className="detail__field">
          <dt>シリーズ</dt>
          <dd>
            {seriesNameByCode[task.seriesCode] ?? task.seriesCode}
            <span className="detail__code">{task.seriesCode}</span>
          </dd>
        </div>

        <div className="detail__field">
          <dt>月</dt>
          <dd>
            {frameNameByCode[task.frameCode] ?? task.frameCode}
            <span className="detail__code">{task.frameCode}</span>
          </dd>
        </div>

        <div className="detail__field">
          <dt>状態</dt>
          <dd>
            <StatusSelect
              status={task.status}
              onChange={(status) => onUpdate(task.seriesCode, task.frameCode, { status })}
            />
          </dd>
        </div>

        <div className="detail__field">
          <dt>担当</dt>
          <dd>
            <input
              className="detail__input"
              defaultValue={task.assignee ?? ""}
              key={`assignee-${task.seriesCode}-${task.frameCode}`}
              onBlur={commitAssignee}
              placeholder="—"
            />
          </dd>
        </div>

        <div className="detail__field">
          <dt>完了日</dt>
          <dd>
            <input
              type="date"
              className="detail__input"
              defaultValue={task.completeDate ?? ""}
              key={`completeDate-${task.seriesCode}-${task.frameCode}`}
              onBlur={commitCompleteDate}
            />
          </dd>
        </div>

        <div className="detail__field">
          <dt>作成日時</dt>
          <dd className="detail__meta">{formatDateTime(task.createdAt)}</dd>
        </div>

        <div className="detail__field">
          <dt>更新日時</dt>
          <dd className="detail__meta">{formatDateTime(task.updatedAt)}</dd>
        </div>
      </dl>
    </aside>
  );
}
