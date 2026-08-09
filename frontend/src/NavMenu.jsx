const ITEMS = [
  { value: "クライアント", label: "関与先リスト" },
  { value: "コンソール", label: "コンソール" },
  { value: "設定", label: "設定" },
  { value: "データ照会", label: "データ照会" },
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
