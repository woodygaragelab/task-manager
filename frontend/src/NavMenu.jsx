const ITEMS = [
  { value: "進捗", label: "ホーム" },
  { value: "クライアント", label: "クライアント" },
  { value: "タスクシリーズ", label: "タスク" },
  { value: "フレーム", label: "月" },
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
