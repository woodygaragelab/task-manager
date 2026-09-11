import { useEffect, useState } from "react";
import { api } from "./api";
import { CUSTOM_FIELD_CODES } from "./ClientProfileTab";
import { TabCommentBox } from "./ClientConsolePage";

const TABS = ["法人", "法人税", "源泉R8上期", "年調R7", "個人", "個人確定申告"];
// 関与先コンソール画面の同名タブとコメントが混ざらないよう、一覧画面専用のキーを使う
const TAB_COMMENT_KEYS = Object.fromEntries(TABS.map((tab) => [tab, `一覧:${tab}`]));

const matchesFilter = (value, filter) =>
  !filter || String(value ?? "").toLowerCase().includes(filter.trim().toLowerCase());

const ASSIGNEE_COLORS = {
  佐藤: "hsl(38, 81%, 84%)",
  蛭川: "hsl(210, 35%, 80%)",
  松田: "hsl(120, 35%, 80%)",
};
const DEFAULT_ASSIGNEE_COLOR = "hsl(50, 35%, 80%)";

function assigneeRowColor(assignee) {
  if (!assignee) return undefined;
  return ASSIGNEE_COLORS[assignee] ?? DEFAULT_ASSIGNEE_COLOR;
}

function escapeCsvCell(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename, headers, rows) {
  const csvBody = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const csv = String.fromCharCode(0xfeff) + csvBody;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// col01→1、col11→11のように項目番号をそのまま使う。SettingClientFields.jsxで
// 表示ラベルが未設定の項目はこの名前でフォールバックする。
const fallbackLabel = (code) => `カスタム項目${Number(code.slice(3))}`;
const fieldLabel = (fieldConfig, code) => fieldConfig[code]?.label || fallbackLabel(code);
const fieldWidth = (fieldConfig, code) => fieldConfig[code]?.width || undefined;
const fieldStyle = (fieldConfig, code) => fieldConfig[code]?.style ?? "text";
// SettingClientFields.jsxで指定された表示タブ名がtabと一致する項目だけを、col番号の
// 昇順で抜き出す(以前はCUSTOM_FIELD_CODES.slice()でタブごとの範囲をハードコードしていた)。
const fieldsForTab = (fieldConfig, tab) =>
  CUSTOM_FIELD_CODES.filter((code) => (fieldConfig[code]?.tab || "") === tab);

function customFieldHeaders(codes, fieldConfig) {
  return codes.map((code) => fieldLabel(fieldConfig, code));
}

// 表示スタイルが「ガント風」の項目だけ、値が入っているセルを矢印形の濃色chipにする。
function customFieldCellClassName(fieldConfig, code, value) {
  const isGantt = fieldStyle(fieldConfig, code) === "gantt";
  const isFilled = isGantt && value !== "" && value !== "-";
  return (
    "simple-table__input simple-table__input--narrow" +
    (isGantt ? " simple-table__input--gantt" : "") +
    (isFilled ? " simple-table__input--filled" : "")
  );
}

function FilterRow({ columns, filters, onChange }) {
  return (
    <tr className="simple-table__filter-row">
      {columns.map(({ key, width }) => (
        <th key={key} style={width ? { width } : undefined}>
          <input
            className="simple-table__filter"
            value={filters[key] ?? ""}
            onChange={(e) => onChange(key, e.target.value)}
            placeholder="絞り込み"
          />
        </th>
      ))}
    </tr>
  );
}

export function ClientListPage({ onSelectClient }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [clients, setClients] = useState([]);
  const [fieldConfig, setFieldConfig] = useState({});
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tabComments, setTabComments] = useState({});
  const [filters, setFilters] = useState({});

  const setFilter = (key, value) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
    api.getClientFields().then(setFieldConfig).catch((e) => setError(e.message));
    api.getTabComments().then(setTabComments).catch(() => {});
  }, []);

  const commitTabComment = async (tabKey, value) => {
    if (value === (tabComments[tabKey] ?? "")) return;
    try {
      const updated = await api.updateTabComment(tabKey, value);
      setTabComments(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const commitField = (clientCode, field) => async (e) => {
    const value = e.target.value;
    const target = clients.find((c) => c.clientCode === clientCode);
    if (!target || value === (target[field] ?? "")) return;
    try {
      const updated = await api.updateClient(clientCode, { [field]: value });
      setClients((prev) => prev.map((c) => (c.clientCode === clientCode ? updated : c)));
    } catch (err) {
      setError(err.message);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createClient(newCode.trim(), newName.trim());
      setClients((prev) => [...prev, created]);
      setNewCode("");
      setNewName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hojinFields = fieldsForTab(fieldConfig, "法人");
  const corporateTaxFields = fieldsForTab(fieldConfig, "法人税");
  const withholdingFields = fieldsForTab(fieldConfig, "源泉R8上期");
  const yearEndFields = fieldsForTab(fieldConfig, "年調R7");
  const personalFields = fieldsForTab(fieldConfig, "個人");
  const personalTaxFields = fieldsForTab(fieldConfig, "個人確定申告");

  const hojinRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      matchesFilter(c.engagementType, filters.engagementType) &&
      matchesFilter((c.senderEmails ?? []).join(", "), filters.senderEmails) &&
      hojinFields.every((code) => matchesFilter(c[code], filters[code]))
  );
  const corporateTaxRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      corporateTaxFields.every((code) => matchesFilter(c[code], filters[code]))
  );
  const withholdingRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      withholdingFields.every((code) => matchesFilter(c[code], filters[code]))
  );
  const yearEndRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      yearEndFields.every((code) => matchesFilter(c[code], filters[code]))
  );
  const personalRows = clients.filter(
    (c) =>
      c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      personalFields.every((code) => matchesFilter(c[code], filters[code]))
  );
  const personalTaxRows = clients.filter(
    (c) =>
      c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      personalTaxFields.every((code) => matchesFilter(c[code], filters[code]))
  );

  const downloadHojinCsv = () =>
    downloadCsv(
      `関与先一覧_法人_${todayStamp()}.csv`,
      [
        "関与先番号",
        "関与先名",
        "担当者",
        "関与タイプ",
        "差出人メールアドレス",
        ...customFieldHeaders(CUSTOM_FIELD_CODES, fieldConfig),
      ],
      hojinRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        c.engagementType ?? "",
        (c.senderEmails ?? []).join(", "),
        ...CUSTOM_FIELD_CODES.map((code) => c[code] ?? ""),
      ])
    );

  const downloadCorporateTaxCsv = () =>
    downloadCsv(
      `関与先一覧_法人税_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(corporateTaxFields, fieldConfig)],
      corporateTaxRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...corporateTaxFields.map((code) => c[code] ?? ""),
      ])
    );

  const downloadWithholdingCsv = () =>
    downloadCsv(
      `関与先一覧_源泉R8上期_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(withholdingFields, fieldConfig)],
      withholdingRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...withholdingFields.map((code) => c[code] ?? ""),
      ])
    );

  const downloadYearEndCsv = () =>
    downloadCsv(
      `関与先一覧_年調R7_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(yearEndFields, fieldConfig)],
      yearEndRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...yearEndFields.map((code) => c[code] ?? ""),
      ])
    );

  const downloadPersonalCsv = () =>
    downloadCsv(
      `関与先一覧_個人_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(personalFields, fieldConfig)],
      personalRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...personalFields.map((code) => c[code] ?? ""),
      ])
    );

  const downloadPersonalTaxCsv = () =>
    downloadCsv(
      `関与先一覧_個人確定申告_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(personalTaxFields, fieldConfig)],
      personalTaxRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...personalTaxFields.map((code) => c[code] ?? ""),
      ])
    );

  return (
    <section className="panel">
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={"tabs__tab" + (activeTab === tab ? " tabs__tab--active" : "")}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "法人" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadHojinCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <table className="simple-table simple-table--fixed">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  <th>関与タイプ</th>
                  <th>差出人メールアドレス</th>
                  {hojinFields.map((code) => (
                    <th
                      key={code}
                      style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                    >
                      {fieldLabel(fieldConfig, code)}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    { key: "engagementType" },
                    { key: "senderEmails" },
                    ...hojinFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                  ]}
                  filters={filters}
                  onChange={setFilter}
                />
              </thead>
              <tbody>
                {hojinRows.map((c) => (
                    <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                      <td className="simple-table__code">{c.clientCode}</td>
                      <td>
                        <button
                          type="button"
                          className="simple-table__link"
                          onClick={() => onSelectClient(c.clientCode)}
                        >
                          {c.clientName}
                        </button>
                      </td>
                      <td>{c.assignee || "—"}</td>
                      <td>{c.engagementType || "—"}</td>
                      <td>{(c.senderEmails ?? []).join(", ") || "—"}</td>
                      {hojinFields.map((code) => (
                        <td key={code}>
                          <input
                            className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                            defaultValue={c[code] ?? ""}
                            key={`${code}-${c[code] ?? ""}`}
                            onBlur={commitField(c.clientCode, code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <form className="list-form" onSubmit={create}>
            <div className="field">
              <label htmlFor="new-client-code">関与先番号</label>
              <input
                id="new-client-code"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="new-client-name">関与先名</label>
              <input
                id="new-client-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <button className="btn btn--primary" type="submit" disabled={submitting}>
              {submitting ? "登録中…" : "追加"}
            </button>
          </form>

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["法人"]}
            comment={tabComments[TAB_COMMENT_KEYS["法人"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}

      {activeTab === "法人税" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadCorporateTaxCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <table className="simple-table simple-table--fixed">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  {corporateTaxFields.map((code) => (
                    <th
                      key={code}
                      style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                    >
                      {fieldLabel(fieldConfig, code)}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...corporateTaxFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                  ]}
                  filters={filters}
                  onChange={setFilter}
                />
              </thead>
              <tbody>
                {corporateTaxRows.map((c) => (
                    <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                      <td className="simple-table__code">{c.clientCode}</td>
                      <td>
                        <button
                          type="button"
                          className="simple-table__link"
                          onClick={() => onSelectClient(c.clientCode)}
                        >
                          {c.clientName}
                        </button>
                      </td>
                      <td>{c.assignee || "—"}</td>
                      {corporateTaxFields.map((code) => (
                        <td key={code}>
                          <input
                            className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                            defaultValue={c[code] ?? ""}
                            key={`${code}-${c[code] ?? ""}`}
                            onBlur={commitField(c.clientCode, code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["法人税"]}
            comment={tabComments[TAB_COMMENT_KEYS["法人税"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}

      {activeTab === "源泉R8上期" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadWithholdingCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <table className="simple-table simple-table--fixed">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  {withholdingFields.map((code) => (
                    <th
                      key={code}
                      style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                    >
                      {fieldLabel(fieldConfig, code)}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...withholdingFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                  ]}
                  filters={filters}
                  onChange={setFilter}
                />
              </thead>
              <tbody>
                {withholdingRows.map((c) => (
                    <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                      <td className="simple-table__code">{c.clientCode}</td>
                      <td>
                        <button
                          type="button"
                          className="simple-table__link"
                          onClick={() => onSelectClient(c.clientCode)}
                        >
                          {c.clientName}
                        </button>
                      </td>
                      <td>{c.assignee || "—"}</td>
                      {withholdingFields.map((code) => (
                        <td key={code}>
                          <input
                            className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                            defaultValue={c[code] ?? ""}
                            key={`${code}-${c[code] ?? ""}`}
                            onBlur={commitField(c.clientCode, code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["源泉R8上期"]}
            comment={tabComments[TAB_COMMENT_KEYS["源泉R8上期"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}

      {activeTab === "年調R7" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadYearEndCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <table className="simple-table simple-table--fixed">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  {yearEndFields.map((code) => (
                    <th
                      key={code}
                      style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                    >
                      {fieldLabel(fieldConfig, code)}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...yearEndFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                  ]}
                  filters={filters}
                  onChange={setFilter}
                />
              </thead>
              <tbody>
                {yearEndRows.map((c) => (
                    <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                      <td className="simple-table__code">{c.clientCode}</td>
                      <td>
                        <button
                          type="button"
                          className="simple-table__link"
                          onClick={() => onSelectClient(c.clientCode)}
                        >
                          {c.clientName}
                        </button>
                      </td>
                      <td>{c.assignee || "—"}</td>
                      {yearEndFields.map((code) => (
                        <td key={code}>
                          <input
                            className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                            defaultValue={c[code] ?? ""}
                            key={`${code}-${c[code] ?? ""}`}
                            onBlur={commitField(c.clientCode, code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["年調R7"]}
            comment={tabComments[TAB_COMMENT_KEYS["年調R7"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}

      {activeTab === "個人" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadPersonalCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <table className="simple-table simple-table--fixed">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  {personalFields.map((code) => (
                    <th
                      key={code}
                      style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                    >
                      {fieldLabel(fieldConfig, code)}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...personalFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                  ]}
                  filters={filters}
                  onChange={setFilter}
                />
              </thead>
              <tbody>
                {personalRows.map((c) => (
                    <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                      <td className="simple-table__code">{c.clientCode}</td>
                      <td>
                        <button
                          type="button"
                          className="simple-table__link"
                          onClick={() => onSelectClient(c.clientCode)}
                        >
                          {c.clientName}
                        </button>
                      </td>
                      <td>{c.assignee || "—"}</td>
                      {personalFields.map((code) => (
                        <td key={code}>
                          <input
                            className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                            defaultValue={c[code] ?? ""}
                            key={`${code}-${c[code] ?? ""}`}
                            onBlur={commitField(c.clientCode, code)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["個人"]}
            comment={tabComments[TAB_COMMENT_KEYS["個人"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}

      {activeTab === "個人確定申告" && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <div className="list-toolbar">
            <button type="button" className="btn btn--ghost" onClick={downloadPersonalTaxCsv}>
              CSVダウンロード
            </button>
          </div>

          {clients.length === 0 ? (
            <div className="empty">
              <div className="empty__title">クライアントがありません</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>関与先番号</th>
                    <th>関与先名</th>
                    <th>担当者</th>
                    {personalTaxFields.map((code) => (
                      <th
                        key={code}
                        style={fieldWidth(fieldConfig, code) ? { width: fieldWidth(fieldConfig, code) } : undefined}
                      >
                        {fieldLabel(fieldConfig, code)}
                      </th>
                    ))}
                  </tr>
                  <FilterRow
                    columns={[
                      { key: "clientCode" },
                      { key: "clientName" },
                      { key: "assignee" },
                      ...personalTaxFields.map((code) => ({ key: code, width: fieldWidth(fieldConfig, code) })),
                    ]}
                    filters={filters}
                    onChange={setFilter}
                  />
                </thead>
                <tbody>
                  {personalTaxRows.map((c) => (
                      <tr key={c.clientCode} style={{ backgroundColor: assigneeRowColor(c.assignee) }}>
                        <td className="simple-table__code">{c.clientCode}</td>
                        <td>
                          <button
                            type="button"
                            className="simple-table__link"
                            onClick={() => onSelectClient(c.clientCode)}
                          >
                            {c.clientName}
                          </button>
                        </td>
                        <td>{c.assignee || "—"}</td>
                        {personalTaxFields.map((code) => (
                          <td key={code}>
                            <input
                              className={customFieldCellClassName(fieldConfig, code, c[code] ?? "")}
                              defaultValue={c[code] ?? ""}
                              key={`${code}-${c[code] ?? ""}`}
                              onBlur={commitField(c.clientCode, code)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <TabCommentBox
            tabKey={TAB_COMMENT_KEYS["個人確定申告"]}
            comment={tabComments[TAB_COMMENT_KEYS["個人確定申告"]] ?? ""}
            onCommit={commitTabComment}
          />
        </>
      )}
    </section>
  );
}
