import React from "react";
import ReactDOM from "react-dom/client";
import { installDemoFetch } from "./demoFetch";
import { createHttpApi } from "./httpApi";
import "../index.css";

// Recorded demo (vite mode "demo"): the full app over recorded /api responses, no live server.
installDemoFetch(window);
window.scenarioApp = createHttpApi({ eventSource: () => ({ onmessage: null, close() {} }) });
// ScenarioApp captures window.scenarioApp at module evaluation time.
void import("./AccessApp").then(({ default: AccessApp }) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><AccessApp /></React.StrictMode>,
  );
});
