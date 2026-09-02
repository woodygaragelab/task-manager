import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";

// 現時点でAgentCoreに実接続しているのは「整理係」(archivist)と「進捗管理係」(progress)のみ。
// 他のエージェントは今後の実装予定のダミー表示。
const LIVE_AGENT_IDS = ["scout", "archivist", "progress"];
const POLL_INTERVAL_MS = 3000;
// バックエンド(TaskAgentJobProcessorFunction)側のAgentCore呼び出しread_timeoutが850秒
// (agent_job_src/app.py)のため、それより短い840秒(14分)でフロントエンドも諦める。
const MAX_POLL_ATTEMPTS = 280;

// 設定ページの「全クライアント」向けエージェントタブは特定の関与先に紐付かないため、
// ジョブ保存・ポーリングのキーとして専用のダミー関与先コードを使う
// (agent-jobsはclientCodeをパーティションキーにするだけで、TaskClientsへの実在確認は行われない)。
const GLOBAL_CLIENT_CODE = "ALL";

const AGENTS = [
  {
    id: "scout",
    name: "受付係",
    role: "資料受領",
    description: "エージェント(仮:info@jakalulu.com)に転送された、メールを要約して履歴に記録し、添付ファイルがあれば受領フォルダに格納する",
  },
  {
    id: "archivist",
    name: "整理係",
    role: "文書整理・分類",
    description: "receiptフォルダの新しい領収書画像を勘定科目ごとにリネーム・分類する",
  },
  {
    id: "courier",
    name: "変換係",
    role: "データ変換",
    description: "領収書リストから仕訳データに変換する",
    instruction: "領収書リストから仕訳データに変換する",
  },
  {
    id: "auditor",
    name: "チェック係",
    role: "検証・照合",
    description: "仕訳データの科目コードをマスタと照合する",
    instruction: "仕訳データの科目コードをマスタと照合する",
  },
  {
    id: "progress",
    name: "進捗管理係",
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
const formatDate = (d) =>
  `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const formatNow = () => formatDate(new Date());
const formatTimestamp = (iso) => (iso ? formatDate(new Date(iso)) : null);

// ジョブのstatus("processing"/"completed"/error時に"error")をチケット表示用のstatusに変換する。
const ticketStatusFromJob = (jobStatus) => {
  if (jobStatus === "completed") return "done";
  if (jobStatus === "processing") return "running";
  return "error";
};

const driveUrl = (folderId) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}?usp=drive_link` : null;

// receipt-ocr-filelistスキルは関与先コードを自スキル側のDynamoDBテーブルで解決しようとし、
// 未登録の場合はDrive上のreceiptフォルダURLをユーザーに尋ねてくる(SKILL.md参照)。
// taskmanager側のTaskClientsに登録済みのフォルダIDを持っている場合は、都度尋ね返される
// 手戻りを避けるため指示文にURLを直接含めてしまう。
// clientが無い場合(設定ページの「全クライアント」タブ)は、関与先コードを付けずに
// 呼び出す。各スキルのSKILL.mdは関与先コード省略時、全関与先を順に処理する仕様になっている
// (receipt-ocr-filelist/progress-updateは「全クライアントの〜」と明示することで
// 都度の関与先確認をスキップし、list_clientsで取得した全件をまとめて処理する)。
const buildArchivistPrompt = (client) => {
  if (!client) return "全クライアントの領収書を整理して";
  const base = `${client.clientCode}の領収書を整理して`;
  if (!client.receiptFolderId) return base;
  return `${base}。receiptフォルダのURLは https://drive.google.com/drive/folders/${client.receiptFolderId} です。`;
};

// progress-updateスキルの呼び出しトリガー文言(SKILL.md参照)に関与先コードを添えて渡す。
const buildProgressPrompt = (client) =>
  client ? `${client.clientCode}の進捗を更新して` : "全クライアントの進捗を更新して";

// email-summaryスキルの呼び出しトリガー文言(SKILL.md参照)に関与先コードを添えて渡す。
// 関与先コード付きで呼ぶと、そのクライアントのsenderEmailsだけにGmail検索クエリを
// 絞り込む(SKILL.md「対象関与先の指定(任意)」参照)。関与先コードを省略すると
// 受信トレイ全体(=全クライアント分)が対象になる。
const buildScoutPrompt = (client) => (client ? `${client.clientCode}の新着メールを処理して` : "新着メールを処理して");

// GFMのpipeテーブルは横幅が親要素(チケット詳細)を超えることがあるため、
// スクロール可能なラッパーで囲んでレイアウト崩れを防ぐ。
const MARKDOWN_COMPONENTS = {
  table: ({ node, ...props }) => (
    <div className="agent-ticket__table-wrap">
      <table {...props} />
    </div>
  ),
};

// scout-schedule/scout-schedule/scout_schedule/scout_schedule_stack.py の
// ScoutWeekdaySchedule(schedule_expression)と一致させること。
// 定期実行ジョブはsenderEmails登録済みの関与先ごとに個別ジョブとして起動され、
// 各関与先のエージェントタブ(このタブ)から結果を確認できる。senderEmails未登録の
// 関与先やどの関与先にも一致しないメール(未分類)向けの全体ジョブ1本だけが
// TaskAgentJobsのGLOBAL_CLIENT_CODEに記録され、設定ページの「全クライアント」タブから
// 確認できる(scout-schedule/scout-schedule/lambda/handler.py参照)。
// archivistはArchivistWeekdaySchedule(同スタック)と一致させること。scoutの10分後に
// 実行され、receiptFolderId登録済みの関与先ごとに個別ジョブとして起動される
// (未登録の関与先向けの全体ジョブは無い。scout-schedule/scout-schedule/lambda_archivist/
// handler.py参照)。
const SCHEDULE_INFO = {
  scout: "平日 6:00 / 12:00 / 18:00(JST)に自動実行されます",
  archivist: "平日 6:10 / 12:10 / 18:10(JST)に自動実行されます",
};

const PROMPT_BUILDERS = {
  archivist: buildArchivistPrompt,
  progress: buildProgressPrompt,
  scout: buildScoutPrompt,
};

const buildPrompt = (agentId, client) => {
  const builder = PROMPT_BUILDERS[agentId];
  return builder ? builder(client) : "";
};

function AgentTicket({ agent, client, ticket, live, global, onStart, expanded, onToggle }) {
  // 前回実行したジョブがあれば、その時点で実際に送信された指示文(ticket.prompt)を優先表示する。
  // 未実行の場合は現在のクライアント情報(全クライアント向けタブではclient=null)から
  // 組み立てたプレビュー文言を表示する。
  const instruction =
    ticket.prompt ?? (live && (global || client) ? buildPrompt(agent.id, client) : agent.instruction);
  // 全クライアント向けタブでは対象フォルダが関与先ごとに異なるため、フォルダリンクは表示しない。
  const showFolders = agent.id === "archivist" && !global;
  const showUketoriFolder = agent.id === "scout" && !global;
  const inputFolderUrl = live ? driveUrl(client?.receiptFolderId) : null;
  const outputFolderUrl = live ? driveUrl(client?.renamedFolderId) : null;
  const uketoriFolderUrl = live ? driveUrl(client?.uketoriFolderId) : null;

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
                disabled={!global && !client}
              >
                {ticket.status === "queued" ? "開始する" : "再実行"}
              </button>
            )
          ) : (
            <button type="button" className="btn btn--ghost agent-ticket__start" disabled>
              開始する(準備中)
            </button>
          )}

          {SCHEDULE_INFO[agent.id] && (
            <p className="agent-ticket__schedule-info">{SCHEDULE_INFO[agent.id]}</p>
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
              <div className="agent-ticket__field agent-ticket__field--result">
                <dt>実行結果</dt>
                <dd className="agent-ticket__result">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                    {ticket.result}
                  </ReactMarkdown>
                </dd>
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
                        /整理済
                      </a>
                    ) : (
                      <span className="agent-ticket__code">未設定</span>
                    )}
                  </dd>
                </div>
              </>
            )}
            {showUketoriFolder && (
              <div className="agent-ticket__field">
                <dt>受領フォルダ</dt>
                <dd>
                  {uketoriFolderUrl ? (
                    <a href={uketoriFolderUrl} target="_blank" rel="noreferrer" className="agent-ticket__code">
                      /受領
                    </a>
                  ) : (
                    <span className="agent-ticket__code">未設定</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

const initialTickets = () =>
  Object.fromEntries(
    AGENTS.map((a) => [
      a.id,
      { status: "queued", prompt: null, startTime: null, endTime: null, result: null },
    ])
  );

// scope="client": 特定の関与先(client)向け(コンソールページ)。
// scope="all": 特定の関与先を選ばず、全クライアントを対象に指示する(設定ページ)。
export function AgentsPanel({ client, scope = "client" }) {
  const isGlobal = scope === "all";
  // 全クライアント向けタブでは特定のclientを持たないため、プロンプト組み立てにはnullを渡し
  // (buildPromptが「全クライアントの〜」文言を生成する)、ジョブ保存・ポーリングのキーには
  // 専用のダミー関与先コードを使う。
  const effectiveClient = isGlobal ? null : client;
  const jobClientCode = isGlobal ? GLOBAL_CLIENT_CODE : client?.clientCode;
  const [expandedId, setExpandedId] = useState(null);
  const [tickets, setTickets] = useState(initialTickets);

  const patchTicket = (agentId, patch) =>
    setTickets((prev) => ({ ...prev, [agentId]: { ...prev[agentId], ...patch } }));

  // 前回実行したジョブ(このクライアント×このエージェントで最新のもの)を取得し、
  // チケットに反映する。展開中でも稼働中(status: "running")のポーリングは上書きしない。
  const loadLastJob = async (agentId) => {
    try {
      const jobs = await api.listAgentJobs(jobClientCode, agentId);
      const latest = jobs?.[0];
      if (!latest) return;
      setTickets((prev) => {
        if (prev[agentId].status === "running") return prev;
        return {
          ...prev,
          [agentId]: {
            status: ticketStatusFromJob(latest.status),
            prompt: latest.prompt ?? null,
            startTime: formatTimestamp(latest.createdAt),
            endTime: latest.status === "processing" ? null : formatTimestamp(latest.updatedAt),
            result: latest.result || latest.error || null,
          },
        };
      });
      if (latest.status === "processing") {
        pollJob(agentId, jobClientCode, latest.jobId);
      }
    } catch {
      // 前回ジョブが存在しない/取得失敗時は何もしない(初期のqueued表示のまま)
    }
  };

  const toggle = (agentId) => {
    const opening = expandedId !== agentId;
    setExpandedId(opening ? agentId : null);
    if (opening && (isGlobal || client) && LIVE_AGENT_IDS.includes(agentId)) {
      loadLastJob(agentId);
    }
  };

  // クライアント切り替え時、チケットは別クライアントの実行結果を保持したままなので
  // いったんリセットする。展開中のライブエージェントがあれば新クライアントの
  // 前回ジョブを取り直す(展開したままクライアントを切り替えても表示が食い違わないように)。
  // 全クライアント向けタブ(jobClientCodeが固定)ではクライアント切り替えは発生しないため、
  // 初回マウント時にのみ実行される。
  useEffect(() => {
    setTickets(initialTickets());
    if (expandedId && LIVE_AGENT_IDS.includes(expandedId)) {
      loadLastJob(expandedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobClientCode]);

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
    if (!isGlobal && !client) return;
    const prompt = buildPrompt(agent.id, effectiveClient);
    patchTicket(agent.id, {
      status: "running",
      prompt,
      startTime: formatNow(),
      endTime: null,
      result: null,
    });
    try {
      const job = await api.submitAgentJob(jobClientCode, agent.id, prompt);
      pollJob(agent.id, jobClientCode, job.jobId);
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
      {isGlobal && (
        <div className="agents__toolbar">
          <span className="status-line">ここでの指示は全クライアントを対象に実行されます</span>
        </div>
      )}
      <div className="agents__list">
        {AGENTS.map((agent) => (
          <AgentTicket
            key={agent.id}
            agent={agent}
            client={effectiveClient}
            global={isGlobal}
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
