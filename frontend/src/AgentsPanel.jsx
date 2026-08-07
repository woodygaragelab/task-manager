import { useState } from "react";
import { api } from "./api";

// 現時点でAgentCoreに実接続しているのは「分類」(archivist)と「進捗更新」(progress)のみ。
// 他のエージェントは今後の実装予定のダミー表示。
const LIVE_AGENT_IDS = ["archivist", "progress"];
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100;

const AGENTS = [
  {
    id: "scout",
    name: "受領",
    role: "情報収集・調査",
    description: "取引先から届いた見積書・請求書PDFをメールから取得し、案件フォルダに格納する",
    instruction: "取引先から届いた見積書・請求書PDFをメールから取得し、案件フォルダに格納する",
  },
  {
    id: "archivist",
    name: "分類",
    role: "文書整理・分類",
    description: "receiptフォルダの新しい領収書画像を勘定科目ごとにリネーム・分類する",
  },
  {
    id: "courier",
    name: "会計",
    role: "外部連携・送信",
    description: "領収書リストから仕訳データに変換する",
    instruction: "領収書リストから仕訳データに変換する",
  },
  {
    id: "auditor",
    name: "チェック",
    role: "検証・照合",
    description: "仕訳データの科目コードをマスタと照合する",
    instruction: "仕訳データの科目コードをマスタと照合する",
  },
  {
    id: "progress",
    name: "進捗更新",
    role: "進捗管理・更新",
    description: "履歴レコードを順に読み取り、内容を解釈して日付・分類・担当者・ステータスを更新する",
  },
];

const STATUS_LABEL = {
  queued: "待機中",
  running: "実行中",
  done: "完了",
  error: "エラー",
};

const pad2 = (n) => String(n).padStart(2, "0");
const formatNow = () => {
  const d = new Date();
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const driveUrl = (folderId) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}?usp=drive_link` : null;

// receipt-ocr-filelistスキルは関与先コードを自スキル側のDynamoDBテーブルで解決しようとし、
// 未登録の場合はDrive上のreceiptフォルダURLをユーザーに尋ねてくる(SKILL.md参照)。
// taskmanager側のTaskClientsに登録済みのフォルダIDを持っている場合は、都度尋ね返される
// 手戻りを避けるため指示文にURLを直接含めてしまう。
const buildArchivistPrompt = (client) => {
  const base = `${client.clientCode}の領収書を整理して`;
  if (!client.receiptFolderId) return base;
  return `${base}。receiptフォルダのURLは https://drive.google.com/drive/folders/${client.receiptFolderId} です。`;
};

// progress-updateスキルの呼び出しトリガー文言(SKILL.md参照)に関与先コードを添えて渡す。
const buildProgressPrompt = (client) => `${client.clientCode}の進捗を更新して`;

const PROMPT_BUILDERS = {
  archivist: buildArchivistPrompt,
  progress: buildProgressPrompt,
};

const buildPrompt = (agentId, client) => {
  const builder = PROMPT_BUILDERS[agentId];
  return builder ? builder(client) : "";
};

function AgentTicket({ agent, client, ticket, live, onStart, expanded, onToggle }) {
  const instruction = live && client ? buildPrompt(agent.id, client) : agent.instruction;
  const showFolders = agent.id === "archivist";
  const inputFolderUrl = live ? driveUrl(client?.receiptFolderId) : null;
  const outputFolderUrl = live ? driveUrl(client?.renamedFolderId) : null;

  return (
    <div className="agent-ticket" onClick={() => onToggle(agent.id)}>
      <div className="agent-ticket__row">
        <div className="agent-ticket__main">
          <div className="agent-ticket__title">
            <span className="agent-ticket__name">{agent.name}</span>
            <span className="agent-ticket__role">{agent.role}</span>
          </div>
          <p className="agent-ticket__description">{agent.description}</p>
        </div>
        <span className={`agent-ticket__status agent-ticket__status--${ticket.status}`}>
          {STATUS_LABEL[ticket.status]}
        </span>
      </div>

      {expanded && (
        <div className="agent-ticket__detail" onClick={(e) => e.stopPropagation()}>
          {live ? (
            (ticket.status === "queued" || ticket.status === "done" || ticket.status === "error") && (
              <button
                type="button"
                className="btn btn--ghost agent-ticket__start"
                onClick={() => onStart(agent)}
                disabled={!client}
              >
                {ticket.status === "queued" ? "開始する" : "再実行"}
              </button>
            )
          ) : (
            <button type="button" className="btn btn--ghost agent-ticket__start" disabled>
              開始する(準備中)
            </button>
          )}

          <dl className="agent-ticket__fields">
            <div className="agent-ticket__field">
              <dt>指示内容</dt>
              <dd>{instruction}</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>開始時刻</dt>
              <dd>{ticket.startTime || "—"}</dd>
            </div>
            <div className="agent-ticket__field">
              <dt>完了時刻</dt>
              <dd>{ticket.endTime || "—"}</dd>
            </div>
            {ticket.result && (
              <div className="agent-ticket__field">
                <dt>実行結果</dt>
                <dd className="agent-ticket__result">{ticket.result}</dd>
              </div>
            )}
            {showFolders && (
              <>
                <div className="agent-ticket__field">
                  <dt>入力フォルダ</dt>
                  <dd>
                    {inputFolderUrl ? (
                      <a href={inputFolderUrl} target="_blank" rel="noreferrer" className="agent-ticket__code">
                        /receipt
                      </a>
                    ) : (
                      <span className="agent-ticket__code">未設定</span>
                    )}
                  </dd>
                </div>
                <div className="agent-ticket__field">
                  <dt>出力フォルダ</dt>
                  <dd>
                    {outputFolderUrl ? (
                      <a href={outputFolderUrl} target="_blank" rel="noreferrer" className="agent-ticket__code">
                        /renamed
                      </a>
                    ) : (
                      <span className="agent-ticket__code">未設定</span>
                    )}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

const initialTickets = () =>
  Object.fromEntries(
    AGENTS.map((a) => [a.id, { status: "queued", startTime: null, endTime: null, result: null }])
  );

export function AgentsPanel({ client }) {
  const [expandedId, setExpandedId] = useState(null);
  const [tickets, setTickets] = useState(initialTickets);

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const patchTicket = (agentId, patch) =>
    setTickets((prev) => ({ ...prev, [agentId]: { ...prev[agentId], ...patch } }));

  const pollJob = (agentId, clientCode, jobId, attempt = 0) => {
    if (attempt >= MAX_POLL_ATTEMPTS) {
      patchTicket(agentId, { status: "error", result: "応答がタイムアウトしました", endTime: formatNow() });
      return;
    }
    setTimeout(async () => {
      try {
        const job = await api.getAgentJob(clientCode, jobId);
        if (job.status === "processing") {
          pollJob(agentId, clientCode, jobId, attempt + 1);
          return;
        }
        patchTicket(agentId, {
          status: job.status === "completed" ? "done" : "error",
          result: job.result || job.error || "",
          endTime: formatNow(),
        });
      } catch (err) {
        patchTicket(agentId, { status: "error", result: err.message, endTime: formatNow() });
      }
    }, POLL_INTERVAL_MS);
  };

  const start = async (agent) => {
    if (!client) return;
    patchTicket(agent.id, { status: "running", startTime: formatNow(), endTime: null, result: null });
    try {
      const prompt = buildPrompt(agent.id, client);
      const job = await api.submitAgentJob(client.clientCode, agent.id, prompt);
      pollJob(agent.id, client.clientCode, job.jobId);
    } catch (err) {
      patchTicket(agent.id, { status: "error", result: err.message, endTime: formatNow() });
    }
  };

  return (
    <div className="agents">
      <div className="agents__toolbar">
        <span className="status-line">
          稼働中のエージェント {AGENTS.length}
          ({AGENTS.filter((a) => !LIVE_AGENT_IDS.includes(a.id)).map((a) => a.name).join("・")}
          は準備中です)
        </span>
      </div>
      <div className="agents__list">
        {AGENTS.map((agent) => (
          <AgentTicket
            key={agent.id}
            agent={agent}
            client={client}
            ticket={tickets[agent.id]}
            live={LIVE_AGENT_IDS.includes(agent.id)}
            onStart={start}
            expanded={expandedId === agent.id}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}
