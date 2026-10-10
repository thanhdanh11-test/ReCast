import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { createHash } from "node:crypto";
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  root = resolve(frontend, "..");
function run(command, args, cwd = root) {
  const r = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${command} failed: ${r.status}`);
}
const python = join(root, "backend", ".venv", "bin", "python");
run("npm", ["run", "build"], frontend);
run(python, [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name",
  "topeye-worker",
  "--distpath",
  "backend/build/worker",
  "--workpath",
  "backend/build/pyinstaller",
  "--specpath",
  "backend/build",
  "--paths",
  "backend",
  "--copy-metadata",
  "lxml",
  "--add-data",
  join(root, "backend/topeye/scenario/schemas") + ":topeye/scenario/schemas",
  "backend/scripts/scenario_worker.py",
]);
const stage = join(frontend, "build", "desktop-source"),
  runtime = join(frontend, "build", "runtime");
rmSync(stage, { recursive: true, force: true });
rmSync(runtime, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(runtime, { recursive: true });
cpSync(join(frontend, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(frontend, "electron"), join(stage, "electron"), {
  recursive: true,
});
cpSync(
  join(root, "backend", "build", "worker", "topeye-worker"),
  join(runtime, "worker"),
  { recursive: true, verbatimSymlinks: true },
);
mkdirSync(join(runtime, "worker", "maps"), { recursive: true });
for (const name of [
  "boston-seaport.json",
  "singapore-onenorth.json",
  "singapore-queenstown.json",
  "singapore-hollandvillage.json",
  "LICENSE",
  "NOTICE.txt",
]) {
  cpSync(
    join(root, "backend/data/scenario/maps", name),
    join(runtime, "worker/maps", name),
  );
}
mkdirSync(join(runtime, "engine"), { recursive: true });
const engine = join(
  root,
  "backend",
  ".tools",
  "esmini",
  "build",
  "EnvironmentSimulator",
  "Libraries",
  "esminiLib",
  "libesminiLib.dylib",
);
if (!existsSync(engine))
  throw new Error("Build the pinned esmini library first");
cpSync(engine, join(runtime, "engine", "libesminiLib.dylib"));
const esmini = join(root, "backend", ".tools", "esmini", "source", "esmini");
cpSync(join(esmini, "LICENSE"), join(runtime, "engine", "LICENSE-esmini.txt"));
writeFileSync(
  join(runtime, "engine", "NOTICE.txt"),
  "esmini 3.9.0, MPL-2.0; source https://github.com/esmini/esmini/tree/v3.9.0\nCompiled locally without OSG/OSI/SUMO/PROJ/IMPLOT. OpenSCENARIO XSD copyright ASAM e.V.; https://www.asam.net/license.html\n",
);
cpSync(
  join(esmini, "externals", "fmt", "LICENSE"),
  join(runtime, "engine", "LICENSE-fmt.txt"),
);
const pugixml = readFileSync(
  join(esmini, "externals", "pugixml", "pugixml.cpp"),
  "utf8",
);
writeFileSync(
  join(runtime, "engine", "LICENSE-pugixml.txt"),
  pugixml.slice(pugixml.lastIndexOf("/**")),
);
cpSync(join(frontend, "src/scenario/assets/models/vinfast-vf3-LICENSE.txt"), join(runtime, "worker", "LICENSE-vinfast-vf3.txt"));
cpSync(join(frontend, "src/scenario/assets/models/vinfast-vf3-attribution.json"), join(runtime, "worker", "ATTRIBUTION-vinfast-vf3.json"));
cpSync(join(frontend, "src/scenario/assets/models/NOTICE.md"), join(runtime, "worker", "NOTICE-traffic-models.md"));
cpSync(join(frontend, "src/scenario/assets/LICENSE-CARLA.txt"), join(runtime, "worker", "LICENSE-CARLA-weather.txt"));
for (const name of ["react", "react-dom", "three"]) {
  cpSync(
    join(frontend, "node_modules", name, "LICENSE"),
    join(runtime, "worker", `LICENSE-${name}.txt`),
  );
}
run(python, [
  "-c",
  "import shutil,sysconfig,sys;from pathlib import Path;shutil.copy(Path(sysconfig.get_path('stdlib'))/'LICENSE.txt',sys.argv[1])",
  join(runtime, "worker", "LICENSE-Python.txt"),
]);
const version = JSON.parse(
  readFileSync(join(frontend, "package.json")),
).version;
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "topeye-scenario-studio",
      productName: "Topeye",
      version,
      main: "electron/main.cjs",
    },
    null,
    2,
  ),
);
const electronVersion = JSON.parse(
  readFileSync(join(frontend, "node_modules", "electron", "package.json")),
).version;
const cachedElectron = join(
  frontend,
  "build",
  "downloads",
  `electron-v${electronVersion}-darwin-arm64.zip`,
);
if (existsSync(cachedElectron)) {
  const expected = JSON.parse(
    readFileSync(join(frontend, "node_modules", "electron", "checksums.json")),
  )[`electron-v${electronVersion}-darwin-arm64.zip`];
  if (
    createHash("sha256").update(readFileSync(cachedElectron)).digest("hex") !==
    expected
  )
    throw new Error("Electron archive checksum mismatch");
}
// Derive macOS icon sizes from the same unchanged PNG used by the studio header.
const iconset = join(frontend, "build", "topeye.iconset");
const appIcon = join(frontend, "build", "topeye.icns");
mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
    run("sips", ["-z", pixels, pixels,
      join(frontend, "src", "scenario", "assets", "topeye-logo.png"),
      "--out", join(iconset, name)]);
  }
}
run("iconutil", ["-c", "icns", iconset, "-o", appIcon]);
const outputs = await packager({
  dir: stage,
  out: join(frontend, "release"),
  name: "Topeye",
  platform: "darwin",
  arch: "arm64",
  electronVersion,
  electronZipDir: existsSync(
    join(
      frontend,
      "build",
      "downloads",
      `electron-v${electronVersion}-darwin-arm64.zip`,
    ),
  )
    ? join(frontend, "build", "downloads")
    : undefined,
  overwrite: true,
  asar: true,
  appBundleId: "org.topeye.scenario",
  icon: appIcon,
});
const app = join(outputs[0], "Topeye.app");
// Packager's extraResource copy rewrites symlinks to absolute build paths.
for (const resource of ["worker", "engine"])
  cpSync(join(runtime, resource), join(app, "Contents", "Resources", resource), {
    recursive: true,
    verbatimSymlinks: true,
  });
// Relative PyInstaller links must remain inside the installed bundle.
run(python, [
  "-c",
  "from pathlib import Path; import sys; root=Path(sys.argv[1]).resolve(); links=[p for p in root.rglob('*') if p.is_symlink()]; invalid=[str(p.relative_to(root)) for p in links if p.readlink().is_absolute() or not p.exists() or not p.resolve().is_relative_to(root)]; assert not invalid, f'Non-portable bundle links: {invalid}'; print(f'Portable bundle links verified: {len(links)}')",
  app,
]);
// Local ad-hoc signing only. No Apple credentials or notarization service.
run("codesign", ["--force", "--deep", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", app]);
const zip = join(frontend, "release", `Topeye-${version}-mac-arm64.zip`);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
writeFileSync(
  join(frontend, "release", "build-manifest.json"),
  JSON.stringify(
    {
      version,
      electronVersion,
      engineVersion: "3.9.0",
      engineSha256: createHash("sha256")
        .update(readFileSync(engine))
        .digest("hex"),
      artifact: zip,
      sha256: createHash("sha256").update(readFileSync(zip)).digest("hex"),
      arch: "arm64",
      signing: "local ad-hoc; not notarized",
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log({ app, zip });
