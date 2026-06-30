const ORDER = ["要対応", "決定済", "情報", "完了"];

export function StatusStamp({ status, onChange, disabled }) {
  const next = () => {
    const idx = ORDER.indexOf(status);
    const nextStatus = ORDER[(idx + 1) % ORDER.length];
    onChange(nextStatus);
  };

  return (
    <button
      type="button"
      className={`stamp stamp--${status}`}
      onClick={next}
      disabled={disabled}
      title="クリックで次のステータスへ進める"
    >
      {status}
    </button>
  );
}
