import { useEffect, useState } from "react";
import { SettingSeries } from "./SettingSeries";
import { SettingFrame } from "./SettingFrame";
import { SettingClassificationAxes } from "./SettingClassificationAxes";
import { SettingClientFields } from "./SettingClientFields";
import { useAdminMode } from "./AdminModeContext";

const ADMIN_ONLY_TABS = ["タスク", "フレーム", "分類ルール", "項目名"];

export function SettingsPage({ seriesList, frameList, onRefresh }) {
  const { adminMode } = useAdminMode();
  const tabs = adminMode ? ADMIN_ONLY_TABS : [];
  const [activeTab, setActiveTab] = useState(tabs[0]);

  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [tabs, activeTab]);

  return (
    <>
      <div className="tabs">
        {tabs.map((tab) => (
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

      {adminMode && activeTab === "タスク" && (
        <SettingSeries seriesList={seriesList} onRefresh={onRefresh} />
      )}
      {adminMode && activeTab === "フレーム" && (
        <SettingFrame frameList={frameList} onRefresh={onRefresh} />
      )}
      {adminMode && activeTab === "分類ルール" && <SettingClassificationAxes />}
      {adminMode && activeTab === "項目名" && <SettingClientFields />}
    </>
  );
}
