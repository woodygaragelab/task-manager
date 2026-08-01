import { useState } from "react";

// 現時点ではダミーのエージェント定義のみ。実際のディスパッチ・実行連携は未実装。
const AGENTS = [
  {
    id: "scout",
    name: "受領",
    role: "情報収集・調査",
    description: "取引先から届いた見積書・請求書PDFをメールから取得し、案件フォルダに格納する",
    instruction: "取引先から届いた見積書・請求書PDFをメールから取得し、案件フォルダに格納する",
    inputFolder: "/receipt",
    outputFolder: "/renamed",
  },
  {
    id: "archivist",
    name: "分類",
    role: "文書整理・分類",
    description: "receiptフォルダの新しい領収書画像を勘定科目ごとにリネーム・分類する",
    instruction: "領収書を整理して",
    inputFolder: "/receipt",
    outputFolder: "/renamed",
  },
  {
    id: "courier",
    name: "会計",
    role: "外部連携・送信",
    description: "領収書リストから仕訳データに変換する",
    instruction: "領収書リストから仕訳データに変換する",
    inputFolder: "/renamed",
    outputFolder: "/journal",
  },
  {
    id: "auditor",
    name: "チェック",
    role: "検証・照合",
    description: "仕訳データの科目コードをマスタと照合する",
    instruction: "仕訳データの科目コードをマスタと照合する",
    inputFolder: "/journal",
    outputFolder: "/checked",
  },
  {
    id: "pinger",
    name: "疎通確認",
    role: "接続確認・監視",
    description: "会計システムAPIへの接続状態を確認し、応答時間を記録する",
    instruction: "会計システムAPIへの接続状態を確認し、応答時間を記録する",
    inputFolder: "-",
    outputFolder: "-",
  },
];

function AgentTicket({ agent, expanded, onToggle }) {
  return (
    <div
      className="agent-ticket"
      onClick={() => onToggle(agent.id)}
    >
      <div className="agent-ticket__row">
        <div className="agent-ticket__main">
          <div className="agent-ticket__title">
            <span className="agent-ticket__name">{agent.name}</span>
            <span className="agent-ticket__role">{agent.role}</span>
          </div>
          <p className="agent-ticket__description">{agent.description}</p>
        </div>
        <span className="stamp stamp--NA">待機中</span>
      </div>

      {expanded && (
        <div className="agent-ticket__detail" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn--ghost agent-ticket__start" disabled>
            開始する(準備中)
          </button>

          <dl className="agent-ticket__fields">
            <div className="agent-ticket__field">
              <dt>指示内容</dt>
              <dd>{agent.instruction}</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>開始時刻</dt>
              <dd>—</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>完了時刻</dt>
              <dd>—</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>入力フォルダ</dt>
              <dd className="agent-ticket__code">{agent.inputFolder}</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>出力フォルダ</dt>
              <dd className="agent-ticket__code">{agent.outputFolder}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

export function AgentsPanel() {
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="agents">
      <div className="agents__toolbar">
        <span className="status-line">稼働中のエージェント {AGENTS.length}(機能は準備中です)</span>
      </div>
      <div className="agents__list">
        {AGENTS.map((agent) => (
          <AgentTicket
            key={agent.id}
            agent={agent}
            expanded={expandedId === agent.id}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}
