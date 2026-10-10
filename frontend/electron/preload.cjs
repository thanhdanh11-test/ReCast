const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "chooseDataset",
  "chooseWorkspace",
  "listScenes",
  "sourceScene",
  "extract",
  "export",
  "variant",
  "replay",
  "cancelJob",
  "settings",
  "mapContext",
  "exportMapContext",
  "importXosc",
  "openImported",
  "replayImported",
];
const api = Object.fromEntries(
  methods.map((name) => [
    name,
    (args) => ipcRenderer.invoke("scenario:" + name, args),
  ]),
);
api.onProgress = (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on("scenario:progress", listener);
  return () => ipcRenderer.removeListener("scenario:progress", listener);
};
contextBridge.exposeInMainWorld("scenarioApp", Object.freeze(api));
