import { useState } from "react";

export function NewTaskForm({ seriesList, onCreate }) {
  const [seriesCode, setSeriesCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!seriesCode) return;

    const seriesName = seriesList.find((s) => s.seriesCode === seriesCode)?.seriesName ?? "";

    setSubmitting(true);
    try {
      await onCreate({ seriesCode, seriesName });
      setSeriesCode("");
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
        </select>
      </div>

      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? "登録中…" : "登録済み全フレーム分のタスクを追加"}
      </button>
    </form>
  );
}
