export const STATUS_OPTIONS = ["未着手", "依頼中", "確認中", "進行中", "完了", "-"];
const OPTIONS = STATUS_OPTIONS;

export function StatusSelect({ status, onChange, disabled }) {
  return (
    <select
      className={`stamp stamp--${status}`}
      value={status}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
