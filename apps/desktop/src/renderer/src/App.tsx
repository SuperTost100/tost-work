import { useState } from "react";
import { Home } from "@/screens/Home";
import { type Section, Sidebar } from "@/shell/Sidebar";

export function App({ userName = "Giulia" }: { userName?: string }) {
  const [section, setSection] = useState<Section>("home");
  const isMac = window.tostWork?.platform === "darwin";
  return (
    <div className="app">
      <Sidebar current={section} onNavigate={setSection} userName={userName} isMac={isMac} />
      {section === "home" ? (
        <Home userName={userName} />
      ) : (
        <div className="main">
          <div className="top" />
        </div>
      )}
    </div>
  );
}
