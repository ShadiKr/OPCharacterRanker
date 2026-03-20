import path from "node:path";
import fs from "node:fs/promises";
import { scrapeFemaleCharacters } from "../src/lib/scrape/femaleCharacters";
import { runAgeParsingSanityChecks } from "./sanity-check-age-parsing";

function envInt(name: string, defaultValue?: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) ? v : defaultValue;
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const projectRoot = process.cwd();
  const outPath = path.join(projectRoot, "public", "data", "female_characters.json");
  const cacheDir = path.join(projectRoot, ".cache", "fandom");

  const scrapeOnBuild = process.env.SCRAPE_ON_BUILD !== "0";
  const skipSanityChecks = process.env.SKIP_SANITY_CHECKS === "1";
  const limit = envInt("SCRAPE_LIMIT");
  const ageConcurrency = envInt("SCRAPE_AGE_CONCURRENCY", 4);
  const imageBatchSize = envInt("SCRAPE_IMAGE_BATCH_SIZE", 40);
  const force = process.env.FORCE_SCRAPE === "1" || process.env.FORCE_SCRAPE === "true";

  if (!force && (await fileExists(outPath))) {
    console.log(`[scraper] Output already exists: ${outPath}. Skipping (set FORCE_SCRAPE=1 to override).`);
    return;
  }

  // If scraping is disabled but the dataset doesn't exist yet, create a small fallback dataset
  // so the app doesn't 404 at runtime.
  if (!scrapeOnBuild) {
    if (!skipSanityChecks) {
      await runAgeParsingSanityChecks();
    }

    const fallbackLimit = envInt("SCRAPE_FALLBACK_LIMIT", 200);
    const effectiveLimit = limit ?? fallbackLimit;
    console.log(
      `[scraper] SCRAPE_ON_BUILD=0 but dataset is missing; generating fallback dataset (limit=${effectiveLimit}).`
    );

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const data = await scrapeFemaleCharacters({
      limit: effectiveLimit,
      cacheDir,
      ageConcurrency,
      imageBatchSize,
    });

    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        count: data.length,
        source: "https://onepiece.fandom.com/wiki/One_Piece_Wiki",
        category: "Category:Female Characters",
        scrapeLimit: effectiveLimit,
        fallback: true,
      },
      characters: data,
    };

    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`[scraper] Wrote fallback dataset: ${outPath} (${data.length} characters).`);
    return;
  }

  if (!skipSanityChecks) {
    await runAgeParsingSanityChecks();
  }

  console.log(
    `[scraper] Starting scrape${
      limit ? ` (limit=${limit})` : ""
    }... cacheDir=${cacheDir}`
  );

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const data = await scrapeFemaleCharacters({
    limit,
    cacheDir,
    ageConcurrency,
    imageBatchSize,
  });

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      count: data.length,
      source: "https://onepiece.fandom.com/wiki/One_Piece_Wiki",
      category: "Category:Female Characters",
      scrapeLimit: limit ?? null,
    },
    characters: data,
  };

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[scraper] Wrote dataset: ${outPath} (${data.length} characters).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

