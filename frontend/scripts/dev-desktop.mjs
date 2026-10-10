import { spawnSync } from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const version=JSON.parse(readFileSync("node_modules/electron/package.json")).version;
if(!existsSync("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")){
 const archive=`build/downloads/electron-v${version}-darwin-arm64.zip`;
 if(process.platform==="darwin" && process.arch==="arm64" && existsSync(archive)){
  const checksums=JSON.parse(readFileSync("node_modules/electron/checksums.json"));
  if(createHash("sha256").update(readFileSync(archive)).digest("hex")!==checksums[`electron-v${version}-darwin-arm64.zip`])throw new Error("Electron checksum mismatch");
  const unpack=spawnSync("ditto",["-x","-k",archive,"node_modules/electron/dist"],{stdio:"inherit"});
  if(unpack.status!==0)process.exit(1);
  writeFileSync("node_modules/electron/path.txt","Electron.app/Contents/MacOS/Electron");
 }else{
  const install=spawnSync(process.execPath,["node_modules/electron/install.js"],{stdio:"inherit"});
  if(install.status!==0)process.exit(1);
 }
}
const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);
const run = spawnSync(
  "node",
  ["node_modules/electron/cli.js", "electron/main.cjs"],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } },
);
process.exit(run.status || 0);
