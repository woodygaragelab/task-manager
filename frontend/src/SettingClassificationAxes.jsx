import { useEffect, useState } from "react";
import { api } from "./api";

const emptyRuleDraft = () => ({
  category: "",
  pattern: "",
  matchType: "keyword",
  priority: 0,
});

const ruleDraftFromRule = (rule) => ({
  category: rule.category ?? "",
  pattern: rule.pattern ?? "",
  matchType: rule.matchType ?? "keyword",
  priority: rule.priority ?? 0,
});

// 「分類ルール」ページ: 軸(観点)タブの切り替え+軸の追加・改名・削除+
// 軸ごとのルール一覧・編集フォーム。ルールはHistoryTabの履歴一覧と同様、
// 行クリックでフォームに読み込んで編集する方式(4-5節の既存UXを踏襲)。
export function SettingClassificationAxes() {
  const [axes, setAxes] = useState([]);
  const [activeAxisId, setActiveAxisId] = useState(null);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState(null);
  const [loadingAxes, setLoadingAxes] = useState(true);
  const [loadingRules, setLoadingRules] = useState(false);

  const [newAxisId, setNewAxisId] = useState("");
  const [newAxisLabel, setNewAxisLabel] = useState("");
  const [creatingAxis, setCreatingAxis] = useState(false);

  const [ruleDraft, setRuleDraft] = useState(emptyRuleDraft);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [submittingRule, setSubmittingRule] = useState(false);

  const loadAxes = async () => {
    try {
      const items = await api.listClassificationAxes();
      setAxes(items);
      return items;
    } catch (e) {
      setError(e.message);
      return [];
    }
  };

  useEffect(() => {
    setLoadingAxes(true);
    loadAxes()
      .then((items) => {
        if (items.length > 0) setActiveAxisId(items[0].axisId);
      })
      .finally(() => setLoadingAxes(false));
  }, []);

  const loadRules = async (axisId) => {
    if (!axisId) {
      setRules([]);
      return;
    }
    setLoadingRules(true);
    setError(null);
    try {
      const items = await api.listClassificationRules(axisId);
      setRules(items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRules(false);
    }
  };

  useEffect(() => {
    setEditingRuleId(null);
    setRuleDraft(emptyRuleDraft());
    loadRules(activeAxisId);
  }, [activeAxisId]);

  const createAxis = async (e) => {
    e.preventDefault();
    if (!newAxisId.trim() || !newAxisLabel.trim()) return;
    setCreatingAxis(true);
    setError(null);
    try {
      const created = await api.createClassificationAxis(
        newAxisId.trim(),
        newAxisLabel.trim()
      );
      setNewAxisId("");
      setNewAxisLabel("");
      await loadAxes();
      setActiveAxisId(created.axisId);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingAxis(false);
    }
  };

  const renameAxis = async (axisId, label) => {
    setAxes((prev) =>
      prev.map((a) => (a.axisId === axisId ? { ...a, label } : a))
    );
    try {
      await api.updateClassificationAxis(axisId, { label });
    } catch (err) {
      setError(err.message);
      await loadAxes();
    }
  };

  const removeAxis = async (axisId) => {
    if (!window.confirm(`軸「${axisId}」を削除しますか？(配下のルールも全て削除されます)`)) return;
    setError(null);
    try {
      await api.deleteClassificationAxis(axisId);
      const remaining = await loadAxes();
      setActiveAxisId(remaining.length > 0 ? remaining[0].axisId : null);
    } catch (err) {
      setError(err.message);
    }
  };

  const startEditRule = (rule) => {
    setEditingRuleId(rule.ruleId);
    setRuleDraft(ruleDraftFromRule(rule));
  };

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setRuleDraft(emptyRuleDraft());
  };

  const submitRule = async (e) => {
    e.preventDefault();
    if (!ruleDraft.category.trim() || !ruleDraft.pattern.trim()) return;
    setSubmittingRule(true);
    setError(null);
    try {
      const payload = {
        category: ruleDraft.category.trim(),
        pattern: ruleDraft.pattern.trim(),
        matchType: ruleDraft.matchType,
        priority: Number(ruleDraft.priority) || 0,
      };
      if (editingRuleId) {
        await api.updateClassificationRule(activeAxisId, editingRuleId, payload);
      } else {
        await api.createClassificationRule(activeAxisId, payload);
      }
      cancelEditRule();
      await loadRules(activeAxisId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingRule(false);
    }
  };

  const removeRule = async (ruleId) => {
    if (editingRuleId === ruleId) cancelEditRule();
    setError(null);
    try {
      await api.deleteClassificationRule(activeAxisId, ruleId);
      await loadRules(activeAxisId);
    } catch (err) {
      setError(err.message);
    }
  };

  const activeAxis = axes.find((a) => a.axisId === activeAxisId) ?? null;

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        分類ルール
      </h2>

      {error && <div className="error-banner">{error}</div>}

      {loadingAxes ? (
        <div className="status-line">読み込み中…</div>
      ) : axes.length === 0 ? (
        <div className="empty">
          <div className="empty__title">分類軸がまだありません</div>
          下のフォームから最初の軸を追加してください。
        </div>
      ) : (
        <div className="tabs">
          {axes.map((axis) => (
            <button
              key={axis.axisId}
              type="button"
              className={
                "tabs__tab" + (axis.axisId === activeAxisId ? " tabs__tab--active" : "")
              }
              onClick={() => setActiveAxisId(axis.axisId)}
            >
              {axis.label || axis.axisId}
            </button>
          ))}
        </div>
      )}

      <form className="list-form" onSubmit={createAxis}>
        <div className="field">
          <label htmlFor="new-axis-id">軸ID</label>
          <input
            id="new-axis-id"
            value={newAxisId}
            onChange={(e) => setNewAxisId(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-axis-label">表示名</label>
          <input
            id="new-axis-label"
            value={newAxisLabel}
            onChange={(e) => setNewAxisLabel(e.target.value)}
            required
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={creatingAxis}>
          {creatingAxis ? "登録中…" : "+ 軸を追加"}
        </button>
      </form>

      {activeAxis && (
        <div className="classification-axis-detail">
          <div className="classification-axis-detail__header">
            <div className="field">
              <label htmlFor="axis-label">表示名</label>
              <input
                id="axis-label"
                defaultValue={activeAxis.label}
                key={`label-${activeAxis.axisId}`}
                onBlur={(e) => {
                  if (e.target.value !== activeAxis.label) {
                    renameAxis(activeAxis.axisId, e.target.value);
                  }
                }}
              />
            </div>
            <span className="simple-table__code">{activeAxis.axisId}</span>
            <button
              type="button"
              className="simple-table__delete"
              onClick={() => removeAxis(activeAxis.axisId)}
            >
              軸を削除
            </button>
          </div>

          {loadingRules ? (
            <div className="status-line">読み込み中…</div>
          ) : rules.length === 0 ? (
            <div className="empty">
              <div className="empty__title">ルールがまだありません</div>
              下のフォームから最初のルールを追加してください。
            </div>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>優先度</th>
                  <th>分類値</th>
                  <th style={{ width: 120 }}>判定方式</th>
                  <th>パターン</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.ruleId}
                    className={
                      "history__row" +
                      (rule.ruleId === editingRuleId ? " history__row--selected" : "")
                    }
                    onClick={() => startEditRule(rule)}
                  >
                    <td>{rule.priority}</td>
                    <td>{rule.category}</td>
                    <td>{rule.matchType === "regex" ? "正規表現" : "キーワード"}</td>
                    <td>{rule.pattern}</td>
                    <td>
                      <button
                        type="button"
                        className="simple-table__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRule(rule.ruleId);
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form className="list-form" onSubmit={submitRule}>
            <div className="field">
              <label htmlFor="rule-priority">優先度</label>
              <input
                id="rule-priority"
                type="number"
                value={ruleDraft.priority}
                onChange={(e) => setRuleDraft({ ...ruleDraft, priority: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="rule-category">分類値</label>
              <input
                id="rule-category"
                value={ruleDraft.category}
                onChange={(e) => setRuleDraft({ ...ruleDraft, category: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="rule-match-type">判定方式</label>
              <select
                id="rule-match-type"
                value={ruleDraft.matchType}
                onChange={(e) => setRuleDraft({ ...ruleDraft, matchType: e.target.value })}
              >
                <option value="keyword">キーワード(部分一致)</option>
                <option value="regex">正規表現</option>
              </select>
            </div>
            <div className="field field--grow">
              <label htmlFor="rule-pattern">パターン</label>
              <input
                id="rule-pattern"
                value={ruleDraft.pattern}
                onChange={(e) => setRuleDraft({ ...ruleDraft, pattern: e.target.value })}
                required
              />
            </div>
            <button className="btn btn--primary" type="submit" disabled={submittingRule}>
              {submittingRule ? "保存中…" : editingRuleId ? "更新する" : "+ ルールを追加"}
            </button>
            {editingRuleId && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={cancelEditRule}
                disabled={submittingRule}
              >
                キャンセル
              </button>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
