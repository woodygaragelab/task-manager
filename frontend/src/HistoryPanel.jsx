import { useEffect, useState } from "react";
import { api } from "./api";

export function HistoryPanel({ clientCode }) {
  const [history, setHistory] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getHistory(clientCode)
      .then((item) => {
        if (cancelled) return;
        setHistory(item.history ?? "");
        setDirty(false);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientCode]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateHistory(clientCode, history);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="status-line">読み込み中…</div>;

  return (
    <div className="history">
      {error && <div className="error-banner">{error}</div>}
      <textarea
        className="history__textarea"
        value={history}
        onChange={(e) => {
          setHistory(e.target.value);
          setDirty(true);
        }}
        placeholder="このクライアントに関する履歴・引き継ぎ事項などを記録してください"
      />
      <div className="history__actions">
        {dirty && <span className="status-line">未保存の変更があります</span>}
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
