import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const names =
  process.platform === "win32"
    ? [
        "command-code.exe",
        "cmdc.exe",
        "commandcode.exe",
        "command-code.cmd",
        "cmdc.cmd",
      ]
    : ["command-code", "cmd", "commandcode"];
const found = [];
for (const dir of (process.env.PATH ?? "")
  .split(path.delimiter)
  .filter(Boolean))
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) found.push(file);
    } catch {
      /* Read only: no installers or version probes. */
    }
  }
const settings = [
  {
    scope: "user",
    file: path.join(os.homedir(), ".commandcode/settings.json"),
  },
  {
    scope: "project",
    file: path.join(process.cwd(), ".commandcode/settings.json"),
  },
  {
    scope: "project-local",
    file: path.join(process.cwd(), ".commandcode/settings.local.json"),
  },
].map(({ scope, file }) => {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  const result = { scope, exists: Boolean(stat) };
  if (!stat) return result;
  result.regular = stat.isFile();
  result.symlink = stat.isSymbolicLink();
  result.mode = (stat.mode & 0o777).toString(8);
  if (!result.regular || result.symlink) return result;
  const bytes = fs.readFileSync(file);
  result.sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    const value = JSON.parse(bytes);
    const hooks = value.hooks ?? {},
      events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"];
    result.hookCounts = Object.fromEntries(
      events
        .filter((k) => k in hooks)
        .map((k) => [
          k,
          Array.isArray(hooks[k]) ? hooks[k].length : "unfamiliar",
        ]),
    );
    result.unknownEventCount = Object.keys(hooks).filter(
      (k) => !events.includes(k),
    ).length;
  } catch {
    result.jsonValid = false;
  }
  return result;
});
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      commandCodeAvailable: found.length > 0,
      candidateCount: found.length,
      versionProbed: false,
      authenticationVerified: false,
      settings,
      settingsModified: false,
      globalInstallPerformed: false,
    },
    null,
    2,
  ),
);
