import { readFileSync, readdirSync, statSync } from "node:fs";
import assert from "node:assert/strict";
const html = readFileSync("dist/index.html", "utf8");
assert.match(
  html,
  /\/Meter_Reading_Dashboard\/assets\//,
  "project URL base path",
);
assert.doesNotMatch(
  html,
  /(?:src|href)="\/assets\//,
  "root-relative assets break project URLs",
);
const files = [];
function walk(root) {
  for (const name of readdirSync(root)) {
    const p = root + "/" + name;
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
}
walk("dist");
const patterns = [
  /sb_secret_[a-zA-Z0-9_-]{12,}/,
  /mg_[a-f0-9]{64}/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const p of files) {
  const text = readFileSync(p, "utf8");
  for (const pattern of patterns)
    assert(!pattern.test(text), `Potential credential in ${p}`);
}
console.log("PASS: project base path and built-asset credential checks");
