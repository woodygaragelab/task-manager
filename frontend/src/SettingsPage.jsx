import { useState } from "react";
import { SettingSeries } from "./SettingSeries";
import { SettingFrame } from "./SettingFrame";
import { SettingClassificationAxes } from "./SettingClassificationAxes";
import { SettingClientFields } from "./SettingClientFields";
import { AgentsPanel } from "./AgentsPanel";

const TABS = ["タスク", "フレーム", "分類ルール", "項目名", "エージェント"];

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
        <SettingSeries seriesList={seriesList} onRefresh={onRefresh} />
      )}
      {activeTab === "フレーム" && (
        <SettingFrame frameList={frameList} onRefresh={onRefresh} />
      )}
      {activeTab === "分類ルール" && <SettingClassificationAxes />}
      {activeTab === "項目名" && <SettingClientFields />}
      {activeTab === "エージェント" && <AgentsPanel scope="all" />}
    </>
  );
}
