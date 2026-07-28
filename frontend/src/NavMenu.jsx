const ITEMS = ["進捗", "クライアント", "タスクシリーズ", "フレーム"];

export function NavMenu({ open, currentView, onSelect, onClose }) {
  if (!open) return null;

  return (
    <>
      <div className="nav-menu__backdrop" onClick={onClose} />
      <nav className="nav-menu">
        {ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={
              "nav-menu__item" + (item === currentView ? " nav-menu__item--active" : "")
            }
            onClick={() => onSelect(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </>
  );
}
