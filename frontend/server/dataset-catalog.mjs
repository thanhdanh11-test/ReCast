import fs from "node:fs";
import { basename, join, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fail } from "./worker-bridge.mjs";

/** nuScenes only (plan52): older catalogs may still list an Argoverse 2 entry; it is kept on disk but hidden. */
const supported = (e) => (e.format || "nuscenes") === "nuscenes";

export function createCatalog({ path, seeds = [], inspect }) {
  let entries = [];
  try {
    const saved = JSON.parse(fs.readFileSync(path, "utf8"));
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.entries)) throw new Error("Invalid dataset catalog");
    entries = saved.entries;
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const save = () => {
    const temp = path + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, entries }), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, path);
  };
  const add = async (input, name, authorize = () => {}) => {
    if (typeof input !== "string" || !input.trim() || input.length > 4096) throw fail("INVALID_INPUT", "Cần đường dẫn thư mục dữ liệu");
    if (name !== undefined && (typeof name !== "string" || name.length > 100)) throw fail("INVALID_INPUT", "Tên bộ dữ liệu tối đa 100 ký tự");
    const result = await inspect(input);
    // plan52: the app works on nuScenes only (owner 2026-10-17); other formats are refused, files untouched.
    if (result.version === "av2-sensor") throw fail("DATASET_INVALID", "Ứng dụng chỉ dùng bộ dữ liệu nuScenes");
    authorize();
    const root = fs.realpathSync(result.root);
    const id = createHash("sha256").update(root).digest("hex").slice(0, 24);
    const previous = entries.find(e => e.id === id);
    const entry = { id, root, name: name?.trim() || previous?.name || (result.version === "av2-sensor" ? "Argoverse 2" : "nuScenes") + " · " + basename(root),
      format: result.version === "av2-sensor" ? "av2" : "nuscenes", sceneCount: result.scenes.length, regions: result.regions || [],
      previewPath: result.previewPath || null, status: "ready" };
    entries = [...entries.filter(e => e.id !== id), entry];
    save();
    return entry;
  };
  let initialized = null;
  const initialize = () => initialized ||= (async () => {
    for (const seed of seeds) {
      if (!seed?.root || entries.some(e => e.root === seed.root)) continue;
      if (!fs.existsSync(seed.root)) continue;
      try { await add(seed.root, seed.name); }
      catch (e) {
        // An invalid seed remains visibly unavailable; no setting is changed.
        entries.push({ id: createHash("sha256").update(seed.root).digest("hex").slice(0, 24), root: seed.root,
          name: seed.name || basename(seed.root), format: seed.format || "nuscenes", sceneCount: 0, regions: [], status: "unavailable", error: String(e.message) });
      }
    }
  })();
  const get = (id) => {
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) throw fail("INVALID_INPUT", "Invalid dataset identity");
    const entry = entries.find(e => e.id === id && supported(e));
    if (!entry) throw fail("NOT_FOUND", "Không tìm thấy bộ dữ liệu");
    return entry;
  };
  return {
    add, get,
    async list() {
      await initialize();
      return entries.filter(supported).map(e => ({ ...e, status: fs.existsSync(e.root) ? e.status : "unavailable", previewUrl: e.previewPath ? `/api/catalog/preview/${e.id}` : null, previewPath: undefined }));
    },
    preview(id) {
      const entry = get(id);
      if (!entry.previewPath || !/\.(jpg|jpeg|png)$/i.test(entry.previewPath)) throw fail("NOT_FOUND", "Không có ảnh xem trước");
      const root = fs.realpathSync(entry.root);
      const file = fs.realpathSync(join(root, entry.previewPath));
      if (!file.startsWith(root + sep) || !fs.statSync(file).isFile() || fs.statSync(file).size > 8 * 1024 * 1024)
        throw fail("PATH_ESCAPE", "Invalid preview path");
      return { bytes: fs.readFileSync(file), type: /\.png$/i.test(file) ? "image/png" : "image/jpeg" };
    },
  };
}
