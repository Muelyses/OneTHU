import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readDataFile, slots } from "./dictionary.mjs";

export const hashSource = messages => crypto.createHash("sha256")
  .update(JSON.stringify(Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)))))
  .digest("hex");

/** Reject stale work and edits outside the assigned values before loading code. */
export function checkBatch({ batch, source, target, before, changedFiles = [], targetFile, sameStructure = true }) {
  const errors = [];
  if(!sameStructure)errors.push("Only messages string values may change; imports, keys and other syntax are read-only.");
  if (batch.sourceHash !== hashSource(source.messages)) errors.push("Source changed: regenerate this batch.");
  if (!Array.isArray(batch.messages) || !batch.messages.length) return [...errors, "Empty/invalid batch."];
  const allowed = new Set(batch.messages.map(row => row.key));
  if (allowed.size !== batch.messages.length) errors.push("Duplicate batch key.");
  for (const row of batch.messages) {
    if (source.messages[row.key] !== row.source) errors.push(`Stale/unknown source: ${row.key}`);
    const translated = target.messages[row.key];
    if (typeof translated !== "string" || !translated.trim()) errors.push(`Untranslated: ${row.key}`);
    else if (slots(translated).join("\0") !== slots(row.source).join("\0")) errors.push(`Placeholder mismatch: ${row.key}`);
  }
  if (before) {
    if (target.label !== before.label) errors.push("Do not change the language label.");
    for (const key of new Set([...Object.keys(before.messages), ...Object.keys(target.messages)])) {
      if (!allowed.has(key) && before.messages[key] !== target.messages[key]) errors.push(`Out-of-batch edit: ${key}`);
    }
  }
  for (const file of changedFiles) if (file !== targetFile) errors.push(`Unapproved file changed: ${file}`);
  return errors;
}

export function dataStructure(text) {
  const ast=ts.createSourceFile("locale.ts",text,99,true),edits=[];
  function visit(n){
    if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==="messages"&&ts.isObjectLiteralExpression(n.initializer)){
      for(const p of n.initializer.properties)if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer))edits.push({start:p.initializer.getStart(ast),end:p.initializer.end});
    }ts.forEachChild(n,visit);
  }visit(ast);
  for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+'"<value>"'+text.slice(e.end);
  return text;
}

export function inspectBatch({ path, locale, base, source }) {
  if (!locale || !/^[A-Za-z0-9-]+$/.test(locale) || locale === "zh-CN") throw new Error("--locale must name a target language.");
  if (!base) throw new Error("--batch requires --base <engineering-commit> to enforce the file/key boundary.");
  const commit = execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { encoding: "utf8" }).trim();
  const batch = JSON.parse(fs.readFileSync(path, "utf8"));
  const targetFile = `apps/desktop/src/i18n/locales/${locale}.ts`;
  const target = readDataFile(targetFile);
  const temp = `/tmp/onethu-translation-base-${process.pid}.ts`;
  let before,beforeText;
  try {
    beforeText=execFileSync("git", ["show", `${commit}:${targetFile}`],{encoding:"utf8"});
    fs.writeFileSync(temp, beforeText);
    before = readDataFile(temp);
  } finally { fs.rmSync(temp, { force: true }); }
  const changedFiles = [
    ...execFileSync("git", ["diff", "--name-only", "-z", commit], { encoding: "utf8" }).split("\0"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0"),
  ].filter(Boolean).filter(file => !file.split("/").some(part => part.startsWith("._")));
  return checkBatch({ batch, source, target, before, changedFiles, targetFile, sameStructure:dataStructure(beforeText)===dataStructure(fs.readFileSync(targetFile,"utf8")) });
}
