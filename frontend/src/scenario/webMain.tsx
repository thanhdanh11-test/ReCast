import React from "react";
import ReactDOM from "react-dom/client";
import { createStaticApi } from "./staticApi";
import "../index.css";

const api = createStaticApi(import.meta.env.BASE_URL + "data/");
window.scenarioApp = api;
window.scenarioDemo = api;
// ScenarioApp captures window.scenarioApp at module evaluation time.
void import("./ScenarioApp").then(({ default: ScenarioApp }) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><ScenarioApp /></React.StrictMode>,
  );
});
