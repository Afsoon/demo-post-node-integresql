import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

export async function hashMigrationFiles(directory: string) {
  const paths = (await Array.fromAsync(glob("**/*.{sql,json}", { cwd: directory })))
    .map((path) => path.split(sep).join("/"))
    .sort();
  if (!paths.length) throw new Error(`No migration files found in ${directory}`);
  const entries = await Promise.all(paths.map(async (path) => [
    path,
    createHash("sha256").update(await readFile(join(directory, path))).digest("hex"),
  ]));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
