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

      <div className="profile-form">
        <div className="field">
          <label htmlFor="profile-client-code">クライアントコード</label>
          <input id="profile-client-code" value={current.clientCode} disabled />
        </div>

        <div className="field">
          <label htmlFor="profile-client-name">クライアント名</label>
          <input
            id="profile-client-name"
            defaultValue={current.clientName ?? ""}
            key={`name-${current.clientCode}`}
            onBlur={commitText("clientName")}
          />
        </div>

        <div className="field">
          <label htmlFor="profile-receipt-folder">領収書フォルダID</label>
          <input
            id="profile-receipt-folder"
            defaultValue={current.receiptFolderId ?? ""}
            key={`receipt-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("receiptFolderId")}
          />
        </div>

        <div className="field">
          <label htmlFor="profile-renamed-folder">分類後フォルダID</label>
          <input
            id="profile-renamed-folder"
            defaultValue={current.renamedFolderId ?? ""}
            key={`renamed-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("renamedFolderId")}
          />
        </div>

        <div className="field">
          <label htmlFor="profile-assignee">担当者</label>
          <input
            id="profile-assignee"
            defaultValue={current.assignee ?? ""}
            key={`assignee-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("assignee")}
          />
        </div>

        <div className="field">
          <label htmlFor="profile-fiscal-year-end-month">決算月</label>
          <select
            id="profile-fiscal-year-end-month"
            defaultValue={current.fiscalYearEndMonth ?? ""}
            key={`fiscal-${current.clientCode}`}
            onChange={commitSelect("fiscalYearEndMonth")}
          >
            <option value="">未設定</option>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="profile-interim-month">中間月</label>
          <select
            id="profile-interim-month"
            defaultValue={current.interimMonth ?? ""}
            key={`interim-${current.clientCode}`}
            onChange={commitSelect("interimMonth")}
          >
            <option value="">未設定</option>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
      </div>

      <button type="button" className="simple-table__delete" onClick={remove}>
        このクライアントを削除
      </button>
    </section>
  );
}
