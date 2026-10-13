import React from "react";
import ReactDOM from "react-dom/client";
import { createHttpApi } from "./httpApi";
import "../index.css";

window.scenarioApp = createHttpApi();
// ScenarioApp captures window.scenarioApp at module evaluation time.
void import("./AccessApp").then(({ default: AccessApp }) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><AccessApp /></React.StrictMode>,
  );
});
