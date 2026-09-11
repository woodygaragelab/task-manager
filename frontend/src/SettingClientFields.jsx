import { useEffect, useState } from "react";
import { api } from "./api";
import { CUSTOM_FIELD_CODES } from "./ClientProfileTab";

const STYLE_OPTIONS = [
  { value: "text", label: "通常テキスト" },
  { value: "gantt", label: "ガント風" },
];
// 関与先一覧画面(ClientListPage.jsx)の既存タブ名。自由入力も可能(datalistは候補表示のみ)。
const KNOWN_TABS = ["法人", "法人税", "源泉R8上期", "年調R7", "個人", "個人確定申告"];
const EMPTY_FIELD = { label: "", tab: "", width: "", style: "text" };
const TAB_OPTIONS_ID = "client-field-tab-options";

const fallbackLabel = (code) => `カスタム項目${Number(code.slice(3))}`;

// 「項目設定」タブ: 関与先プロフィール画面のcol01-col99カスタム項目について、
// 表示ラベル・表示タブ名(関与先一覧のどのタブに列として出すか)・列幅・表示スタイル
// (通常テキスト/ガント風)を設定する。型は全て文字列固定・使用方法は自由なため、
// ここでは表示に関する設定のみを行う。
export function SettingClientFields() {
  const [fields, setFields] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getClientFields()
      .then(setFields)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const commitField = (code, patch) => (e) => {
    const current = fields[code] ?? EMPTY_FIELD;
    const next = { ...current, ...patch(e.target.value) };
    if (
      next.label === current.label &&
      next.tab === current.tab &&
      next.width === current.width &&
      next.style === current.style
    )
      return;
    setSaving(true);
    setError(null);
    api
      .updateClientFields({ [code]: next })
      .then((updated) => setFields(updated))
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">設定</span>
        関与先プロフィールの項目設定
      </h2>

      {error && <div className="error-banner">{error}</div>}
      {saving && <div className="status-line">保存中…</div>}

      {loading ? (
        <div className="status-line">読み込み中…</div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>表示ラベル</th>
              <th>表示タブ名</th>
              <th>列幅</th>
              <th>表示スタイル</th>
            </tr>
          </thead>
          <tbody>
            {CUSTOM_FIELD_CODES.map((code) => {
              const field = fields[code] ?? EMPTY_FIELD;
              const rowKey = `${code}-${field.label}-${field.tab}-${field.width}-${field.style}`;
              return (
                <tr key={code}>
                  <td className="simple-table__code">
                    {code}
                    <br />({fallbackLabel(code)})
                  </td>
                  <td>
                    <input
                      className="simple-table__input"
                      key={`label-${rowKey}`}
                      defaultValue={field.label}
                      placeholder="未設定(空欄の場合は上記フォールバック名で表示)"
                      onBlur={commitField(code, (value) => ({ label: value }))}
                    />
                  </td>
                  <td>
                    <input
                      className="simple-table__input"
                      key={`tab-${rowKey}`}
                      defaultValue={field.tab}
                      list={TAB_OPTIONS_ID}
                      placeholder="未設定(関与先一覧に表示されません)"
                      onBlur={commitField(code, (value) => ({ tab: value }))}
                    />
                  </td>
                  <td>
                    <input
                      className="simple-table__input simple-table__input--narrow"
                      key={`width-${rowKey}`}
                      defaultValue={field.width}
                      placeholder="例: 7.8%"
                      onBlur={commitField(code, (value) => ({ width: value }))}
                    />
                  </td>
                  <td>
                    <select
                      key={`style-${rowKey}`}
                      defaultValue={field.style}
                      onChange={commitField(code, (value) => ({ style: value }))}
                    >
                      {STYLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <datalist id={TAB_OPTIONS_ID}>
        {KNOWN_TABS.map((tab) => (
          <option key={tab} value={tab} />
        ))}
      </datalist>
    </section>
  );
}
