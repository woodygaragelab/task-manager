import { useCallback, useEffect, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { NavMenu } from "./NavMenu";
import { ClientListPage } from "./ClientListPage";
import { SettingsPage } from "./SettingsPage";
import { DataQueryPage } from "./DataQueryPage";
import { ConsolePage } from "./ConsolePage";
import { api } from "./api";
import "./App.css";

export default function App() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [seriesList, setSeriesList] = useState([]);
  const [frameList, setFrameList] = useState([]);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState("クライアント"); // コンソール | クライアント | 設定 | データ照会
  const [consoleClientCode, setConsoleClientCode] = useState(null);

  const handleSelectClient = (clientCode) => {
    setConsoleClientCode(clientCode);
    setCurrentView("コンソール");
  };

  const refreshMasters = useCallback(async () => {
    try {
      const [series, frames] = await Promise.all([
        api.listSeries(),
        api.listFrames(),
      ]);
      setSeriesList(series);
      setFrameList(frames);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refreshMasters();
  }, [refreshMasters]);

  return (
    <div className="app">
      <header className="header">
        <div className="header__left">
          <button
            type="button"
            className="hamburger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="メニュー"
          >
            ☰
          </button>
          <button
            type="button"
            className="hamburger"
            onClick={() => setCurrentView("クライアント")}
            aria-label="ホーム(関与先リスト)"
          >
            ⌂
          </button>
          <div className="header__title-group">
            <h1 className="header__title">Amorphous Console</h1>
            <div className="header__subtitle">税理士タスク管理</div>
          </div>
          <NavMenu
            open={menuOpen}
            currentView={currentView}
            onSelect={(view) => {
              setCurrentView(view);
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
          />
        </div>

        <div className="header__meta">
          {user?.signInDetails?.loginId ?? user?.username}
          <br />
          <button className="header__signout" onClick={() => signOut()}>
            ログアウト
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {currentView === "クライアント" && (
        <ClientListPage onSelectClient={handleSelectClient} />
      )}
      {currentView === "設定" && (
        <SettingsPage
          seriesList={seriesList}
          frameList={frameList}
          onRefresh={refreshMasters}
        />
      )}
      {currentView === "データ照会" && <DataQueryPage />}

      {currentView === "コンソール" && (
        <ConsolePage
          key={consoleClientCode ?? "default"}
          initialClientCode={consoleClientCode}
          seriesList={seriesList}
          frameList={frameList}
          onBackToList={() => setCurrentView("クライアント")}
        />
      )}
    </div>
  );
}
