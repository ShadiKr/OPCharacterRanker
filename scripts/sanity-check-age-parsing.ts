import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractAgeInfoFromParseText } from "../src/lib/scrape/femaleCharacters";

async function readFixture(name: string) {
  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", name);
  return fs.readFile(fixturePath, "utf8");
}

export async function runAgeParsingSanityChecks() {
  // These fixtures are tiny snippets copied from Fandom's MediaWiki `prop=text`
  // output; we only include the Age/Birthday block to keep them stable.
  const namiText = await readFixture("nami-parse-age-snippet.txt");
  const carrotText = await readFixture("carrot-parse-age-snippet.txt");

  const nami = extractAgeInfoFromParseText(namiText);
  assert.equal(nami.isMinor, false, "Nami should not be marked minor (18+).");
  assert.ok(nami.ageText?.includes("18"), "Nami ageText should include 18.");
  assert.ok(nami.ageText?.includes("20"), "Nami ageText should include 20.");

  const carrot = extractAgeInfoFromParseText(carrotText);
  assert.equal(carrot.isMinor, true, "Carrot should be marked minor (age 15).");
  assert.ok(carrot.ageText?.includes("15"), "Carrot ageText should include 15.");

  console.log("[sanity-check] Age parsing fixtures: OK");
}

// Allow `tsx scripts/sanity-check-age-parsing.ts` to run standalone.
const isMain =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href ||
  process.env.RUN_SANITY_CHECKS === "1";

if (isMain) {
  runAgeParsingSanityChecks().catch((err) => {
    console.error("[sanity-check] FAILED", err);
    process.exit(1);
  });
}

