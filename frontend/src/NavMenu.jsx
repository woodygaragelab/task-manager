const ITEMS = [
  { value: "コンソール", label: "コンソール" },
  { value: "クライアント", label: "関与先リスト" },
  { value: "タスクシリーズ", label: "タスクシリーズ設定" },
  { value: "フレーム", label: "月設定" },
  { value: "分類ルール", label: "分類ルール設定" },
  { value: "タスクデータ照会", label: "タスクデータ照会" },
];

export function NavMenu({ open, currentView, onSelect, onClose }) {
  if (!open) return null;

  return (
    <>
      <div className="nav-menu__backdrop" onClick={onClose} />
      <nav className="nav-menu">
        {ITEMS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={
              "nav-menu__item" + (item.value === currentView ? " nav-menu__item--active" : "")
            }
            onClick={() => onSelect(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}
