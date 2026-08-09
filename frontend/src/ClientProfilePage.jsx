import { useState } from "react";
import { api } from "./api";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export function ClientProfilePage({ client, onBack, onUpdated, onDeleted }) {
  const [current, setCurrent] = useState(client);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const commit = async (patch) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateClient(current.clientCode, patch);
      setCurrent(updated);
      onUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const commitText = (field) => (e) => {
    const value = e.target.value;
    if (value === (current[field] ?? "")) return;
    commit({ [field]: value });
  };

  const commitSelect = (field) => (e) => {
    const value = e.target.value;
    if (value === (current[field] ?? "")) return;
    commit({ [field]: value });
  };

  const remove = async () => {
    if (!window.confirm(`クライアント「${current.clientCode}」を削除しますか？`)) return;
    setError(null);
    try {
      await api.deleteClient(current.clientCode);
      onDeleted?.(current.clientCode);
    } catch (err) {
      setError(err.message);
    }
  };

  const MonthField = ({ id, label, field }) => (
    <div className="profile-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        defaultValue={current[field] ?? ""}
        key={`${field}-${current.clientCode}`}
        onChange={commitSelect(field)}
      >
        <option value="">未設定</option>
        {MONTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}月
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="panel">
      <button type="button" className="btn btn--ghost profile-back" onClick={onBack}>
        ← 関与先リストへ戻る
      </button>

      <div className="panel__header">
        <h2 className="panel__title">
          <span className="panel__title-eyebrow">プロフィール</span>
          {current.clientName}
        </h2>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {saving && <div className="status-line">保存中…</div>}

      <div className="profile-fields">
        <div className="profile-field">
          <label htmlFor="profile-client-code">関与先番号</label>
          <input id="profile-client-code" value={current.clientCode} disabled />
        </div>

        <div className="profile-field">
          <label htmlFor="profile-client-name">関与先名</label>
          <input
            id="profile-client-name"
            defaultValue={current.clientName ?? ""}
            key={`name-${current.clientCode}`}
            onBlur={commitText("clientName")}
          />
        </div>

        <div className="profile-field">
          <label htmlFor="profile-assignee">担当者</label>
          <input
            id="profile-assignee"
            defaultValue={current.assignee ?? ""}
            key={`assignee-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("assignee")}
          />
        </div>

        <MonthField id="profile-fiscal-year-end-month" label="決算月" field="fiscalYearEndMonth" />
        <MonthField id="profile-three-months-after-month" label="3か月後月" field="threeMonthsAfterMonth" />
        <MonthField id="profile-interim-month" label="中間月" field="interimMonth" />
        <MonthField id="profile-nine-months-after-month" label="9か月後月" field="nineMonthsAfterMonth" />

        <div className="profile-field">
          <label htmlFor="profile-receipt-folder">領収書フォルダ</label>
          <input
            id="profile-receipt-folder"
            defaultValue={current.receiptFolderId ?? ""}
            key={`receipt-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("receiptFolderId")}
          />
        </div>

        <div className="profile-field">
          <label htmlFor="profile-renamed-folder">分類後フォルダ</label>
          <input
            id="profile-renamed-folder"
            defaultValue={current.renamedFolderId ?? ""}
            key={`renamed-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("renamedFolderId")}
          />
        </div>
      </div>

      <button type="button" className="simple-table__delete" onClick={remove}>
        このクライアントを削除
      </button>
    </section>
  );
}
