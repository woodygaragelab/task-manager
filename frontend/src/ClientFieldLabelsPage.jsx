import { useEffect, useState } from "react";
import { api } from "./api";
import { CUSTOM_FIELD_CODES } from "./ClientProfilePage";

// 「項目名」タブ: 関与先プロフィール画面のcol01-col20カスタム項目の表示名を設定する。
// 型は全て文字列固定・使用方法は自由なため、ここでは表示名の割り当てのみを行う。
export function ClientFieldLabelsPage() {
  const [labels, setLabels] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getClientFieldLabels()
      .then(setLabels)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const commitLabel = (code) => (e) => {
    const value = e.target.value;
    if (value === (labels[code] ?? "")) return;
    setSaving(true);
    setError(null);
    api
      .updateClientFieldLabels({ [code]: value })
      .then((updated) => setLabels(updated))
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">設定</span>
        関与先プロフィールの項目名
      </h2>

      {error && <div className="error-banner">{error}</div>}
      {saving && <div className="status-line">保存中…</div>}

      {loading ? (
        <div className="status-line">読み込み中…</div>
      ) : (
        <div className="profile-fields">
          {CUSTOM_FIELD_CODES.map((code, i) => (
            <div className="profile-field" key={code}>
              <label htmlFor={`field-label-${code}`}>
                {code}({`カスタム項目${i + 1}`})
              </label>
              <input
                id={`field-label-${code}`}
                defaultValue={labels[code] ?? ""}
                key={`${code}-${labels[code] ?? ""}`}
                placeholder="未設定(項目名なしで非表示にはなりません)"
                onBlur={commitLabel(code)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
