import { useCallback, useEffect, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { NavMenu } from "./NavMenu";
import { ClientListPage } from "./ClientListPage";
import { SeriesListPage } from "./SeriesListPage";
import { FrameListPage } from "./FrameListPage";
import { ClassificationAxesPage } from "./ClassificationAxesPage";
import { TaskDataQueryPage } from "./TaskDataQueryPage";
import { ConsolePage } from "./ConsolePage";
import { api } from "./api";
import "./App.css";

export default function App() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [seriesList, setSeriesList] = useState([]);
  const [frameList, setFrameList] = useState([]);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState("コンソール"); // コンソール | クライアント | タスクシリーズ | フレーム

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

      {currentView === "クライアント" && <ClientListPage />}
      {currentView === "タスクシリーズ" && (
        <SeriesListPage seriesList={seriesList} onRefresh={refreshMasters} />
      )}
      {currentView === "フレーム" && (
        <FrameListPage frameList={frameList} onRefresh={refreshMasters} />
      )}
      {currentView === "分類ルール" && <ClassificationAxesPage />}
      {currentView === "タスクデータ照会" && <TaskDataQueryPage />}

      {currentView === "コンソール" && (
        <ConsolePage seriesList={seriesList} frameList={frameList} />
      )}
    </div>
  );
}
