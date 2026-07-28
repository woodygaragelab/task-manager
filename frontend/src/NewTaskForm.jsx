import { useState } from "react";

const NEW_OPTION = "__new__";

export function NewTaskForm({ seriesList, onCreate }) {
  const [seriesCode, setSeriesCode] = useState("");
  const [newSeriesCode, setNewSeriesCode] = useState("");
  const [newSeriesName, setNewSeriesName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSeriesCode("");
    setNewSeriesCode("");
    setNewSeriesName("");
  };

  const submit = async (e) => {
    e.preventDefault();

    const resolvedSeriesCode =
      seriesCode === NEW_OPTION ? newSeriesCode.trim() : seriesCode;
    const resolvedSeriesName =
      seriesCode === NEW_OPTION
        ? newSeriesName.trim()
        : seriesList.find((s) => s.seriesCode === seriesCode)?.seriesName ?? "";

    if (!resolvedSeriesCode || !resolvedSeriesName) return;

    setSubmitting(true);
    try {
      await onCreate({ seriesCode: resolvedSeriesCode, seriesName: resolvedSeriesName });
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
          </>
        )}
      </div>

      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? "登録中…" : "登録済み全フレーム分のタスクを追加"}
      </button>
    </form>
  );
}
