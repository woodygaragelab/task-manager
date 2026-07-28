export function ProgressTable({ tasks, seriesNameByCode, frameNameByCode }) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">タスクがありません</div>
        「タスク」タブからタスクを登録すると、ここに進捗表が表示されます。
      </div>
    );
  }

  const seriesCodes = [...new Set(tasks.map((t) => t.seriesCode))].sort();
  const frameCodes = [...new Set(tasks.map((t) => t.frameCode))].sort();
  const statusByKey = Object.fromEntries(
    tasks.map((t) => [`${t.seriesCode}#${t.frameCode}`, t.status])
  );

  return (
    <table className="progress">
      <thead>
        <tr>
          <th>シリーズ</th>
          {frameCodes.map((frameCode) => (
            <th key={frameCode}>{frameNameByCode[frameCode] ?? frameCode}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {seriesCodes.map((seriesCode) => (
          <tr key={seriesCode}>
            <td className="progress__series">
              {seriesNameByCode[seriesCode] ?? seriesCode}
            </td>
            {frameCodes.map((frameCode) => {
              const status = statusByKey[`${seriesCode}#${frameCode}`];
              return (
                <td key={frameCode} className="progress__cell">
                  {status ? (
                    <span className={`stamp stamp--${status}`}>{status}</span>
                  ) : (
                    <span className="progress__none">—</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
