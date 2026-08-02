import { useEffect, useRef, useState } from "react";

// 対象月(TaskFrame)を複数選択するためのチェックボックス付きドロップダウン。
export function FrameMultiSelect({ frameList, selected, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const toggle = (frameCode) => {
    const next = selected.includes(frameCode)
      ? selected.filter((c) => c !== frameCode)
      : [...selected, frameCode];
    onChange(next);
  };

  const label = frameList
    .filter((f) => selected.includes(f.frameCode))
    .map((f) => f.frameName)
    .join("、");

  return (
    <div className="frame-multiselect" ref={rootRef}>
      <button
        type="button"
        className="frame-multiselect__trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        {label || "未選択"}
      </button>
      {open && (
        <div className="frame-multiselect__panel">
          {frameList.length === 0 ? (
            <div className="frame-multiselect__empty">フレーム未登録</div>
          ) : (
            frameList.map((f) => (
              <label key={f.frameCode} className="frame-multiselect__option">
                <input
                  type="checkbox"
                  checked={selected.includes(f.frameCode)}
                  onChange={() => toggle(f.frameCode)}
                />
                {f.frameName}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
