import { createContext, useContext, useState } from "react";

const AdminModeContext = createContext(null);

export function AdminModeProvider({ children }) {
  const [adminMode, setAdminMode] = useState(false);

  return (
    <AdminModeContext.Provider value={{ adminMode, setAdminMode }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode() {
  const ctx = useContext(AdminModeContext);
  if (!ctx) {
    throw new Error("useAdminMode must be used within an AdminModeProvider");
  }
  return ctx;
}
