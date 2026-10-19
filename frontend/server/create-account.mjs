// plan61: make the single account on the host itself, before a public server is reachable.
// Usage: node frontend/server/create-account.mjs <username>   (password: one line on stdin)
import fs from "node:fs";
import { join } from "node:path";
import { createAuth } from "./local-auth.mjs";
import { defaultUserData } from "./local-server.mjs";

const EXIT = { INVALID_INPUT: 1, ACCOUNT_EXISTS: 2 };
const username = process.argv[2];
if (process.stdin.isTTY) process.stderr.write("Mật khẩu (12–128 ký tự, hiện trên màn hình): ");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.split(/\r?\n/)[0];

const userData = defaultUserData();
fs.mkdirSync(userData, { recursive: true });
try {
  await createAuth({ path: join(userData, "local-account.json") }).setup({ username, password }, { setHeader() {} });
  console.log(`Đã tạo tài khoản "${username}" tại ${userData}`);
} catch (e) {
  console.error(e.message);
  process.exit(EXIT[e.code] ?? 3);
}
