import { useState } from "react";
import { SeriesListPage } from "./SeriesListPage";
import { FrameListPage } from "./FrameListPage";
import { ClassificationAxesPage } from "./ClassificationAxesPage";

const TABS = ["タスク", "フレーム", "分類ルール"];

export function SettingsPage({ seriesList, frameList, onRefresh }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);

  return (
    <>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={"tabs__tab" + (activeTab === tab ? " tabs__tab--active" : "")}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "タスク" && (
        <SeriesListPage seriesList={seriesList} onRefresh={onRefresh} />
      )}
      {activeTab === "フレーム" && (
        <FrameListPage frameList={frameList} onRefresh={onRefresh} />
      )}
      {activeTab === "分類ルール" && <ClassificationAxesPage />}
    </>
  );
}
