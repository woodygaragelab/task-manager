import { useState } from "react";

const NEW_OPTION = "__new__";

export function NewTaskForm({ clientCode, seriesList, frameList, onCreate }) {
  const [seriesCode, setSeriesCode] = useState("");
  const [newSeriesCode, setNewSeriesCode] = useState("");
  const [newSeriesName, setNewSeriesName] = useState("");
  const [frameCode, setFrameCode] = useState("");
  const [newFrameCode, setNewFrameCode] = useState("");
  const [newFrameName, setNewFrameName] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSeriesCode("");
    setNewSeriesCode("");
    setNewSeriesName("");
    setFrameCode("");
    setNewFrameCode("");
    setNewFrameName("");
    setAssignee("");
  };

  const submit = async (e) => {
    e.preventDefault();

    const resolvedSeriesCode =
      seriesCode === NEW_OPTION ? newSeriesCode.trim() : seriesCode;
    const resolvedSeriesName =
      seriesCode === NEW_OPTION
        ? newSeriesName.trim()
        : seriesList.find((s) => s.seriesCode === seriesCode)?.seriesName ?? "";
    const resolvedFrameCode =
      frameCode === NEW_OPTION ? newFrameCode.trim() : frameCode;
    const resolvedFrameName =
      frameCode === NEW_OPTION
        ? newFrameName.trim()
        : frameList.find((f) => f.frameCode === frameCode)?.frameName ?? "";

    if (!resolvedSeriesCode || !resolvedSeriesName) return;
    if (!resolvedFrameCode || !resolvedFrameName) return;

    setSubmitting(true);
    try {
      await onCreate({
        clientCode,
        seriesCode: resolvedSeriesCode,
        seriesName: resolvedSeriesName,
        frameCode: resolvedFrameCode,
        frameName: resolvedFrameName,
        assignee: assignee.trim(),
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
          </>
        )}
      </div>

      <div className="field">
        <label htmlFor="frame-code">フレーム</label>
        <select
          id="frame-code"
          value={frameCode}
          onChange={(e) => setFrameCode(e.target.value)}
          required
        >
          <option value="" disabled>
            選択してください
          </option>
          {frameList.map((f) => (
            <option key={f.frameCode} value={f.frameCode}>
              {f.frameName}({f.frameCode})
            </option>
          ))}
          <option value={NEW_OPTION}>+ 新規フレームを追加</option>
        </select>
        {frameCode === NEW_OPTION && (
          <>
            <input
              value={newFrameCode}
              onChange={(e) => setNewFrameCode(e.target.value)}
              placeholder="フレームコード(例: 202606)"
              required
            />
            <input
              value={newFrameName}
              onChange={(e) => setNewFrameName(e.target.value)}
              placeholder="フレーム名(例: 2026年6月)"
              required
            />
          </>
        )}
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
