import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"));

const forbidden = [
  { name: "service-role key assignment", re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s<]/i },
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "bearer token literal", re: /Authorization\s*:\s*["'`]Bearer\s+[A-Za-z0-9._~-]{20,}/i },
  { name: "demo password literal", re: /DEMO_PASSWORD\s*=\s*[^\s<]/i },
];

const failures = [];
for (const file of tracked) {
  let content;
  try {
    content = execFileSync("git", ["show", `:${file}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    continue;
  }
  for (const rule of forbidden) {
    if (rule.re.test(content)) failures.push({ file, rule: rule.name });
  }
}

if (failures.length) {
  console.error("Security gate failed. Potential secret material detected:");
  for (const failure of failures) console.error(`- ${failure.file}: ${failure.rule}`);
  process.exit(1);
}

console.log(`Security gate passed: ${tracked.length} tracked files checked; no forbidden secret patterns detected.`);
