import { useState } from "react";

const NEW_OPTION = "__new__";

export function NewTaskForm({ seriesList, onCreate }) {
  const [seriesCode, setSeriesCode] = useState("");
  const [newSeriesCode, setNewSeriesCode] = useState("");
  const [newSeriesName, setNewSeriesName] = useState("");
  const [newTaskGroup, setNewTaskGroup] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSeriesCode("");
    setNewSeriesCode("");
    setNewSeriesName("");
    setNewTaskGroup("");
  };

  const submit = async (e) => {
    e.preventDefault();

    const isNewSeries = seriesCode === NEW_OPTION;
    const resolvedSeriesCode = isNewSeries ? newSeriesCode.trim() : seriesCode;
    const resolvedSeriesName = isNewSeries
      ? newSeriesName.trim()
      : seriesList.find((s) => s.seriesCode === seriesCode)?.seriesName ?? "";
    const resolvedTaskGroup = isNewSeries ? newTaskGroup.trim() : "";

    if (!resolvedSeriesCode || !resolvedSeriesName) return;

    setSubmitting(true);
    try {
      await onCreate({
        seriesCode: resolvedSeriesCode,
        seriesName: resolvedSeriesName,
        taskGroup: resolvedTaskGroup,
      });
      reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="new-task" onSubmit={submit}>
      <div className="field">
        <label htmlFor="series-code">シリーズ</label>
        <select
          id="series-code"
          value={seriesCode}
          onChange={(e) => setSeriesCode(e.target.value)}
          required
        >
          <option value="" disabled>
            選択してください
          </option>
          {seriesList.map((s) => (
            <option key={s.seriesCode} value={s.seriesCode}>
              {s.seriesName}({s.seriesCode})
            </option>
          ))}
          <option value={NEW_OPTION}>+ 新規シリーズを追加</option>
        </select>
        {seriesCode === NEW_OPTION && (
          <>
            <input
              value={newSeriesCode}
              onChange={(e) => setNewSeriesCode(e.target.value)}
              placeholder="シリーズコード"
              required
            />
            <input
              value={newSeriesName}
              onChange={(e) => setNewSeriesName(e.target.value)}
              placeholder="シリーズ名(例: 資料受領)"
              required
            />
            <input
              value={newTaskGroup}
              onChange={(e) => setNewTaskGroup(e.target.value)}
              placeholder="分類"
              required
            />
          </>
        )}
      </div>

      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? "登録中…" : "登録済み全フレーム分のタスクを追加"}
      </button>
    </form>
  );
}
