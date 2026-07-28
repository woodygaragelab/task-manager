export function FrameListPage({ frameList }) {
  const sorted = [...frameList].sort((a, b) => a.frameCode.localeCompare(b.frameCode));

  return (
    <section className="panel">
      <h2 className="panel__title">
        <span className="panel__title-eyebrow">一覧</span>
        フレーム
      </h2>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="empty__title">フレームがありません</div>
        </div>
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>コード</th>
              <th>フレーム名</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f.frameCode}>
                <td className="simple-table__code">{f.frameCode}</td>
                <td>{f.frameName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
