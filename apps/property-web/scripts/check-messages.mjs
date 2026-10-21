// Fails when a translation key exists in one language file but not the other (task 04).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const load = (l) => JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"));
const keys = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const en = new Set(keys(load("en")));
const am = new Set(keys(load("am")));
const missingInAm = [...en].filter((k) => !am.has(k));
const missingInEn = [...am].filter((k) => !en.has(k));
const empty = [...keys(load("am"))].filter((k) => k.split(".").reduce((o, p) => o[p], load("am")) === "");

if (missingInAm.length || missingInEn.length || empty.length) {
  if (missingInAm.length) console.error(`Missing in am.json:\n  ${missingInAm.join("\n  ")}`);
  if (missingInEn.length) console.error(`Missing in en.json:\n  ${missingInEn.join("\n  ")}`);
  if (empty.length) console.error(`Empty in am.json:\n  ${empty.join("\n  ")}`);
  process.exit(1);
}
console.log(`Translations OK: ${en.size} keys in both languages.`);
