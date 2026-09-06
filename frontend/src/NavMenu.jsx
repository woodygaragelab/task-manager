const ITEMS = [
  { value: "設定", label: "設定", adminOnly: true },
  { value: "エージェント", label: "エージェント" },
  { value: "データ照会", label: "データ照会", adminOnly: true },
];

export function NavMenu({ open, currentView, adminMode, onSelect, onClose }) {
  if (!open) return null;

  const items = ITEMS.filter((item) => !item.adminOnly || adminMode);

  return (
    <>
      <div className="nav-menu__backdrop" onClick={onClose} />
      <nav className="nav-menu">
        {items.map((item) => (
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
