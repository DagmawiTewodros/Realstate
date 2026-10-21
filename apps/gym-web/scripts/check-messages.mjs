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
console.warn(`Translations OK: ${en.size} keys in both languages.`);

// Every literal key used in the code must exist. Translators are found from
// `const t = useTranslations("ns")` or `await getTranslations("ns")`; template keys such as
// t(`field.${f}`) are checked by their fixed prefix.
import { readdirSync, statSync } from "node:fs";
const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(name)) files.push(p);
  }
};
walk(srcDir);
const enMessages = load("en");
const hasPath = (path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), enMessages) !== undefined;
const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const translators = new Map();
  // The same name can be bound to different namespaces in different functions of one file,
  // so a key passes when it exists in any namespace bound to that name.
  for (const m of source.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\("([\w.]+)"\)/g)) {
    translators.set(m[1], [...(translators.get(m[1]) ?? []), m[2]]);
  }
  const rel = file.slice(srcDir.length + 1);
  for (const [name, namespaces] of translators) {
    for (const m of source.matchAll(new RegExp(`(?<![\\w.])${name}\\("([\\w.]+)"`, "g"))) {
      if (!namespaces.some((ns) => hasPath(`${ns}.${m[1]}`))) problems.push(`${rel}: ${namespaces.join("|")}.${m[1]}`);
    }
    for (const m of source.matchAll(new RegExp(`(?<![\\w.])${name}\\(\`([\\w.]*)\\$\\{`, "g"))) {
      const prefix = m[1].replace(/\.$/, "");
      if (prefix && !namespaces.some((ns) => hasPath(`${ns}.${prefix}`))) problems.push(`${rel}: ${namespaces.join("|")}.${prefix}.*`);
    }
  }
}
if (problems.length) {
  console.error(`Keys used in the code but missing from en.json:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.warn(`Translation keys used in ${files.length} source files all exist.`);
