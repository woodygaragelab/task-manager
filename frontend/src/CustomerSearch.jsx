import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function CustomerSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const names = await api.searchCustomers(query.trim());
        setResults(names);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const choose = (name) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onSelect(name);
  };

  return (
    <div className="search">
      <div style={{ flex: 1, position: "relative" }}>
        <input
          className="search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="案件名で検索(前方一致、例: GI)"
        />
        {open && query.trim() && (
          <ul className="search__results">
            {results.map((name) => (
              <li
                key={name}
                className="search__result"
                onClick={() => choose(name)}
              >
                {name}
              </li>
            ))}
            <li
              className="search__result search__result--new"
              onClick={() => choose(query.trim())}
            >
              「{query.trim()}」として新規登録 →
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
