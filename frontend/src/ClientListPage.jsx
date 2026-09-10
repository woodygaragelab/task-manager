import { useEffect, useState } from "react";
import { api } from "./api";
import { CUSTOM_FIELD_CODES } from "./ClientProfileTab";
import { TabCommentBox } from "./ClientConsolePage";

const TABS = ["法人", "法人税", "源泉R8上期", "年調R7", "個人", "個人確定申告"];
// 関与先コンソール画面の同名タブとコメントが混ざらないよう、一覧画面専用のキーを使う
const TAB_COMMENT_KEYS = Object.fromEntries(TABS.map((tab) => [tab, `一覧:${tab}`]));
const CORPORATE_TAX_FIELD_CODES = CUSTOM_FIELD_CODES.slice(10, 20);
const WITHHOLDING_FIELD_CODES = CUSTOM_FIELD_CODES.slice(20, 30);
const YEAR_END_ADJUSTMENT_FIELD_CODES = CUSTOM_FIELD_CODES.slice(30, 40);
const PERSONAL_FIELD_CODES = CUSTOM_FIELD_CODES.slice(50, 59);
const PERSONAL_TAX_FIELD_CODES = CUSTOM_FIELD_CODES.slice(60, 80);

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

function customFieldHeaders(codes, offset, fieldLabels) {
  return codes.map((code, i) => fieldLabels[code] || `カスタム項目${i + offset}`);
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
  const [fieldLabels, setFieldLabels] = useState({});
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
    api.getClientFieldLabels().then(setFieldLabels).catch((e) => setError(e.message));
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

  const hojinRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      matchesFilter(c.engagementType, filters.engagementType) &&
      matchesFilter((c.senderEmails ?? []).join(", "), filters.senderEmails)
  );
  const corporateTaxRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      CORPORATE_TAX_FIELD_CODES.every((code) => matchesFilter(c[code], filters[code]))
  );
  const withholdingRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      WITHHOLDING_FIELD_CODES.every((code) => matchesFilter(c[code], filters[code]))
  );
  const yearEndRows = clients.filter(
    (c) =>
      !c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      YEAR_END_ADJUSTMENT_FIELD_CODES.every((code) => matchesFilter(c[code], filters[code]))
  );
  const personalRows = clients.filter(
    (c) =>
      c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      PERSONAL_FIELD_CODES.every((code) => matchesFilter(c[code], filters[code]))
  );
  const personalTaxRows = clients.filter(
    (c) =>
      c.clientCode.startsWith("P") &&
      matchesFilter(c.clientCode, filters.clientCode) &&
      matchesFilter(c.clientName, filters.clientName) &&
      matchesFilter(c.assignee, filters.assignee) &&
      PERSONAL_TAX_FIELD_CODES.every((code) => matchesFilter(c[code], filters[code]))
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
        ...customFieldHeaders(CUSTOM_FIELD_CODES, 1, fieldLabels),
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
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(CORPORATE_TAX_FIELD_CODES, 11, fieldLabels)],
      corporateTaxRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...CORPORATE_TAX_FIELD_CODES.map((code) => c[code] ?? ""),
      ])
    );

  const downloadWithholdingCsv = () =>
    downloadCsv(
      `関与先一覧_源泉R8上期_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(WITHHOLDING_FIELD_CODES, 21, fieldLabels)],
      withholdingRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...WITHHOLDING_FIELD_CODES.map((code) => c[code] ?? ""),
      ])
    );

  const downloadYearEndCsv = () =>
    downloadCsv(
      `関与先一覧_年調R7_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(YEAR_END_ADJUSTMENT_FIELD_CODES, 31, fieldLabels)],
      yearEndRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...YEAR_END_ADJUSTMENT_FIELD_CODES.map((code) => c[code] ?? ""),
      ])
    );

  const downloadPersonalCsv = () =>
    downloadCsv(
      `関与先一覧_個人_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(PERSONAL_FIELD_CODES, 51, fieldLabels)],
      personalRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...PERSONAL_FIELD_CODES.map((code) => c[code] ?? ""),
      ])
    );

  const downloadPersonalTaxCsv = () =>
    downloadCsv(
      `関与先一覧_個人確定申告_${todayStamp()}.csv`,
      ["関与先番号", "関与先名", "担当者", ...customFieldHeaders(PERSONAL_TAX_FIELD_CODES, 61, fieldLabels)],
      personalTaxRows.map((c) => [
        c.clientCode,
        c.clientName,
        c.assignee ?? "",
        ...PERSONAL_TAX_FIELD_CODES.map((code) => c[code] ?? ""),
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
            <table className="simple-table">
              <thead>
                <tr>
                  <th>関与先番号</th>
                  <th>関与先名</th>
                  <th>担当者</th>
                  <th>関与タイプ</th>
                  <th>差出人メールアドレス</th>
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    { key: "engagementType" },
                    { key: "senderEmails" },
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
                  {CORPORATE_TAX_FIELD_CODES.map((code, i) => (
                    <th key={code} style={{ width: "7.8%" }}>
                      {fieldLabels[code] || `カスタム項目${i + 11}`}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...CORPORATE_TAX_FIELD_CODES.map((code) => ({ key: code, width: "7.8%" })),
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
                      {CORPORATE_TAX_FIELD_CODES.map((code) => (
                        <td key={code}>
                          <input
                            className="simple-table__input simple-table__input--narrow"
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
                  {WITHHOLDING_FIELD_CODES.map((code, i) => (
                    <th key={code} style={{ width: "7.8%" }}>
                      {fieldLabels[code] || `カスタム項目${i + 21}`}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...WITHHOLDING_FIELD_CODES.map((code) => ({ key: code, width: "7.8%" })),
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
                      {WITHHOLDING_FIELD_CODES.map((code) => {
                        const value = c[code] ?? "";
                        const isFilled = value !== "" && value !== "-";
                        return (
                          <td key={code}>
                            <input
                              className={
                                "simple-table__input simple-table__input--narrow simple-table__input--gantt" +
                                (isFilled ? " simple-table__input--filled" : "")
                              }
                              defaultValue={value}
                              key={`${code}-${value}`}
                              onBlur={commitField(c.clientCode, code)}
                            />
                          </td>
                        );
                      })}
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
                  {YEAR_END_ADJUSTMENT_FIELD_CODES.map((code, i) => (
                    <th key={code} style={{ width: "7.8%" }}>
                      {fieldLabels[code] || `カスタム項目${i + 31}`}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...YEAR_END_ADJUSTMENT_FIELD_CODES.map((code) => ({ key: code, width: "7.8%" })),
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
                      {YEAR_END_ADJUSTMENT_FIELD_CODES.map((code, i) => {
                        const value = c[code] ?? "";
                        const isFilled = value !== "" && value !== "-";
                        const isGantt = i > 0;
                        return (
                          <td key={code}>
                            <input
                              className={
                                "simple-table__input simple-table__input--narrow" +
                                (isGantt ? " simple-table__input--gantt" : "") +
                                (isGantt && isFilled ? " simple-table__input--filled" : "")
                              }
                              defaultValue={value}
                              key={`${code}-${value}`}
                              onBlur={commitField(c.clientCode, code)}
                            />
                          </td>
                        );
                      })}
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
                  {PERSONAL_FIELD_CODES.map((code, i) => (
                    <th key={code} style={{ width: "7.8%" }}>
                      {fieldLabels[code] || `カスタム項目${i + 51}`}
                    </th>
                  ))}
                </tr>
                <FilterRow
                  columns={[
                    { key: "clientCode" },
                    { key: "clientName" },
                    { key: "assignee" },
                    ...PERSONAL_FIELD_CODES.map((code) => ({ key: code, width: "7.8%" })),
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
                      {PERSONAL_FIELD_CODES.map((code) => (
                        <td key={code}>
                          <input
                            className="simple-table__input simple-table__input--narrow"
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
                    {PERSONAL_TAX_FIELD_CODES.map((code, i) => (
                      <th key={code}>{fieldLabels[code] || `カスタム項目${i + 61}`}</th>
                    ))}
                  </tr>
                  <FilterRow
                    columns={[
                      { key: "clientCode" },
                      { key: "clientName" },
                      { key: "assignee" },
                      ...PERSONAL_TAX_FIELD_CODES.map((code) => ({ key: code })),
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
                        {PERSONAL_TAX_FIELD_CODES.map((code) => {
                          const value = c[code] ?? "";
                          const isFilled = value !== "" && value !== "-";
                          return (
                            <td key={code}>
                              <input
                                className={
                                  "simple-table__input simple-table__input--narrow simple-table__input--gantt" +
                                  (isFilled ? " simple-table__input--filled" : "")
                                }
                                defaultValue={value}
                                key={`${code}-${value}`}
                                onBlur={commitField(c.clientCode, code)}
                              />
                            </td>
                          );
                        })}
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
