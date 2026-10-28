import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { Panel } from "./shell/Panel";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    {/* The menu-bar panel is a window of its own, loaded with #panel. */}
    {location.hash === "#panel" && window.tostWork ? <Panel api={window.tostWork} /> : <Root />}
  </StrictMode>,
);
