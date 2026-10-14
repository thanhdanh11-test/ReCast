// Feedback for the maker, kept on this machine (userData/feedback); nothing is sent over the network.
import fs from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fail } from "./worker-bridge.mjs";

const KINDS = ["bug", "idea", "other"];
const CONTEXT = ["version", "dataset", "scene", "view", "userAgent"];
const LIMIT = 500;

export function createFeedback({ dir, now = () => new Date() }) {
  const files = () => { try { return fs.readdirSync(dir).filter(n => /^[0-9TZ:.-]+-[a-f0-9]{8}\.json$/.test(n)).sort().reverse(); } catch { return []; } };
  return {
    submit(args) {
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => !["kind", "message", "contact", "context"].includes(k)))
        throw fail("INVALID_INPUT", "Góp ý không hợp lệ");
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!KINDS.includes(args.kind) || !message || message.length > 4000) throw fail("INVALID_INPUT", "Nội dung góp ý 1–4000 ký tự");
      if (args.contact !== undefined && (typeof args.contact !== "string" || args.contact.length > 200)) throw fail("INVALID_INPUT", "Liên hệ tối đa 200 ký tự");
      const context = {};
      if (args.context !== undefined) {
        if (!args.context || typeof args.context !== "object" || Array.isArray(args.context) || Object.keys(args.context).some(k => !CONTEXT.includes(k)))
          throw fail("INVALID_INPUT", "Thông tin kèm theo không hợp lệ");
        for (const [k, v] of Object.entries(args.context)) {
          if (typeof v !== "string" || v.length > 300) throw fail("INVALID_INPUT", "Thông tin kèm theo không hợp lệ");
          context[k] = v;
        }
      }
      if (files().length >= LIMIT) throw fail("RESOURCE_LIMIT", `Đã lưu ${LIMIT} góp ý; hãy xuất và xoá bớt`);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const saved_at = now().toISOString();
      const id = `${saved_at.replace(/:/g, "-")}-${randomBytes(4).toString("hex")}`;
      const entry = { id, kind: args.kind, message, contact: args.contact?.trim() || "", context, saved_at };
      fs.writeFileSync(join(dir, `${id}.json`), JSON.stringify(entry), { flag: "wx", mode: 0o600 });
      return { id, saved_at };
    },
    list() {
      return files().slice(0, 50).map(n => { try { return JSON.parse(fs.readFileSync(join(dir, n), "utf8")); } catch { return null; } }).filter(Boolean);
    },
  };
}
