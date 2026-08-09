import { useState } from "react";
import { TaskDataQueryPage } from "./TaskDataQueryPage";

const TABS = ["タスクデータ"];

export function DataQueryPage() {
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

      {activeTab === "タスクデータ" && <TaskDataQueryPage />}
    </>
  );
}
