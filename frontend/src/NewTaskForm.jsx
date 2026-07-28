import { useState } from "react";

const NBSP = "\u00A0";

// 等幅フォントでも全角文字(日本語)は半角の約2倍の幅で描画されるため、
// 単純な文字数パディングでは列が揃わない。全角/半角を判定して表示幅を見積もる。
function visualWidth(str) {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += isWide ? 2 : 1;
  }
  return width;
}

// <option>要素は通常の空白を折り畳んでしまうためNBSPでパディングする。
// 等幅フォント(series-select)と組み合わせることで列が視覚的に揃う。
function padVisual(str, targetWidth) {
  return str + NBSP.repeat(Math.max(0, targetWidth - visualWidth(str)));
}

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

  const groupWidth = Math.max(
    0,
    ...seriesList.map((s) => visualWidth(s.taskGroup || ""))
  );

  return (
    <form className="new-task" onSubmit={submit}>
      <div className="field">
        <select
          id="series-code"
          className="series-select"
          value={seriesCode}
          onChange={(e) => setSeriesCode(e.target.value)}
          required
        >
          <option value="" disabled>
            選択してください
          </option>
          {seriesList.map((s) => (
            <option key={s.seriesCode} value={s.seriesCode}>
              {padVisual(s.taskGroup || "", groupWidth) + NBSP + NBSP + s.seriesName}
            </option>
          ))}
        </select>
      </div>

      <button className="btn btn--primary" type="submit" disabled={submitting}>
        {submitting ? "登録中…" : "全月分のタスクを追加"}
      </button>
    </form>
  );
}
