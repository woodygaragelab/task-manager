import { useState } from "react";
import { api } from "./api";

const ENGAGEMENT_TYPE_OPTIONS = ["年一", "自計化", "反自計化"];
export const CUSTOM_FIELD_CODES = Array.from(
  { length: 40 },
  (_, i) => `col${String(i + 1).padStart(2, "0")}`
);

export function ClientProfileTab({ client, onBack, onUpdated, onDeleted, onInitialize }) {
  const [current, setCurrent] = useState(client);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);

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

  const commitEmails = (e) => {
    const emails = e.target.value
      .split(/[,\n]/)
      .map((d) => d.trim())
      .filter(Boolean);
    const current_ = current.senderEmails ?? [];
    if (emails.length === current_.length && emails.every((d, i) => d === current_[i])) return;
    commit({ senderEmails: emails });
  };

  const initialize = async () => {
    if (
      !window.confirm(
        `クライアント「${current.clientCode}」に売上・支払・給与・銀行通帳の全月分タスクを追加します。よろしいですか？`
      )
    )
      return;
    setError(null);
    setInitializing(true);
    try {
      await onInitialize?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setInitializing(false);
    }
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

  const ChoiceField = ({ id, label, field, options }) => (
    <div className="profile-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        defaultValue={current[field] ?? ""}
        key={`${field}-${current.clientCode}`}
        onChange={commitSelect(field)}
      >
        <option value="">未設定</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="panel">
      {onBack && (
        <button type="button" className="btn btn--ghost profile-back" onClick={onBack}>
          ← 関与先リストへ戻る
        </button>
      )}

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

        <ChoiceField
          id="profile-engagement-type"
          label="関与タイプ"
          field="engagementType"
          options={ENGAGEMENT_TYPE_OPTIONS}
        />

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

        <div className="profile-field">
          <label htmlFor="profile-uketori-folder">受領フォルダ</label>
          <input
            id="profile-uketori-folder"
            defaultValue={current.uketoriFolderId ?? ""}
            key={`uketori-${current.clientCode}`}
            placeholder="未設定"
            onBlur={commitText("uketoriFolderId")}
          />
        </div>

        <div className="profile-field">
          <label htmlFor="profile-sender-emails">差出人メールアドレス</label>
          <input
            id="profile-sender-emails"
            defaultValue={(current.senderEmails ?? []).join(", ")}
            key={`sender-emails-${current.clientCode}`}
            placeholder="例: taro@example.com, hanako@example.co.jp"
            onBlur={commitEmails}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost"
        onClick={initialize}
        disabled={initializing}
      >
        {initializing ? "初期化中…" : "このクライアントを初期化"}
      </button>

      <button type="button" className="simple-table__delete" onClick={remove}>
        このクライアントを削除
      </button>
    </section>
  );
}
