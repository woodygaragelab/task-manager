export function SeriesListPage({ seriesList }) {
  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        タスクシリーズ
      </h2>

      {seriesList.length === 0 ? (
        <div className="empty">
          <div className="empty__title">タスクシリーズがありません</div>
        </div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>分類</th>
              <th>シリーズ名</th>
              <th>コード</th>
            </tr>
          </thead>
          <tbody>
            {seriesList.map((s) => (
              <tr key={s.seriesCode}>
                <td>{s.taskGroup || "—"}</td>
                <td>{s.seriesName}</td>
                <td className="simple-table__code">{s.seriesCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
