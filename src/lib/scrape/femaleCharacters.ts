export type FemaleCharacter = {
  /**
   * Stable identifier for the character. We use the Fandom page title.
   * (We later map these IDs to dataset indices for URL compression.)
   */
  id: string;
  name: string;
  portraitUrl: string | null;
  /**
   * Human-readable age text extracted from the wiki "Age:" field.
   * Example: "18 (debut), 20 (after timeskip)"
   */
  ageText: string | null;
  /**
   * True if any extracted age number is < 18.
   * (This approximates "minor at some point" based on the wiki data.)
   */
  isMinor: boolean;
};

export type ScrapeOptions = {
  /**
   * For local development only. If set, stops after scraping this many characters.
   */
  limit?: number;
  /**
   * Cache directory for API responses so reruns are faster.
   */
  cacheDir: string;
  /**
   * Max concurrent age-parsing requests.
   */
  ageConcurrency?: number;
  /**
   * How many titles per `pageimages` request.
   */
  imageBatchSize?: number;
};

type CategoryMember = { title: string };

const FANDOM_API_BASE = "https://onepiece.fandom.com/api.php";
const FEMALE_CATEGORY = "Category:Female Characters";
const AGE_PARSER_CACHE_VERSION = "v4";

function safeFileName(input: string) {
  // Avoid slashes and other path characters.
  return input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function stripFandomRefs(text: string) {
  // Removes citation markers like "[ 13 ]" or "[13]".
  return text.replace(/\[\s*\d+\s*\]/g, "").replace(/\[[^\]]*?\]/g, "");
}

export function extractAgeInfoFromParseText(parseText: string): {
  ageText: string | null;
  isMinor: boolean;
} {
  // We prefer extracting the infobox "Age:" *value cell* directly from the
  // MediaWiki HTML-ish output (prop=text), because many pages have different
  // next labels after Age (e.g. Status:, Occupations:, etc).
  //
  // Example of the relevant snippet:
  //   <h3 ...>Age:</h3>
  //   <div class="pi-data-value pi-font">15<sup ...>...</sup></div>
  const htmlValueMatch = parseText.match(
    // Accept both `pi-data-value pi-font` and cases where `pi-font` is absent.
    /Age:\s*<\/h3>\s*<div[^>]*class="pi-data-value[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/div>/i
  );
  const valueBlockFromHtml = htmlValueMatch ? htmlValueMatch[1] : null;

  // Fallback for minimal/plain fixtures: "Age:" followed by value then "Birthday:".
  const fallbackTextMatch = parseText.match(/Age:\s*([\s\S]*?)(?:Birthday:)/i);
  const valueBlock =
    valueBlockFromHtml ??
    (fallbackTextMatch ? fallbackTextMatch[1] : null);

  if (!valueBlock) return { ageText: null, isMinor: false };

  // The API "text" payload includes HTML-ish markup, including citation IDs
  // that contain digits (e.g. `cite_ref-13`). Those digits must not affect
  // minor/adult, so we strip tags and entities first.
  const tagStripped = valueBlock.replace(/<[^>]+>/g, " ");
  // Remove citation brackets encoded as HTML entities, e.g. `&#91; 4 &#93;`.
  const noEntities = tagStripped
    .replace(/&#91;\s*\d+\s*&#93;/g, " ")
    .replace(/&#\d+;/g, " ");
  const cleaned = stripFandomRefs(noEntities).replace(/\s+/g, " ").trim();
  if (!cleaned) return { ageText: null, isMinor: false };

  const ages = [...cleaned.matchAll(/\b(\d{1,3})\b/g)].map((m) => Number.parseInt(m[1], 10));
  const isMinor = ages.some((a) => a < 18);

  // Keep as-is but normalize spacing for display.
  return { ageText: cleaned, isMinor };
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fandom API error (${res.status}) for ${url}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

async function getFemaleTitles(opts: { limit?: number; cacheDir: string }) {
  const { limit, cacheDir } = opts;
  const titlesCachePath = `${cacheDir}/female_titles.json`;
  try {
    const cached = await import("node:fs/promises").then((fs) => fs.readFile(titlesCachePath, "utf8"));
    const parsed = JSON.parse(cached) as { titles: string[] };
    if (Array.isArray(parsed.titles) && parsed.titles.length > 0) return parsed.titles;
  } catch {
    // Cache miss is expected.
  }

  const titles: string[] = [];
  let cmcontinue: string | undefined = undefined;
  do {
    const url = new URL(FANDOM_API_BASE);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("cmtitle", FEMALE_CATEGORY);
    url.searchParams.set("cmnamespace", "0");
    url.searchParams.set("cmlimit", "500");
    url.searchParams.set("format", "json");
    if (cmcontinue) url.searchParams.set("cmcontinue", cmcontinue);

    const data = await fetchJson(url.toString());
    const members = (data?.query?.categorymembers ?? []) as CategoryMember[];
    for (const m of members) {
      titles.push(m.title);
      if (limit && titles.length >= limit) break;
    }

    cmcontinue = data?.continue?.cmcontinue;
    if (limit && titles.length >= limit) break;
  } while (cmcontinue);

  // Best-effort cache.
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(titlesCachePath, JSON.stringify({ titles }), "utf8");
  } catch {
    // Ignore caching failures.
  }

  return titles;
}

async function fetchPortraitsForTitles(titles: string[], pithumbsize: number) {
  if (titles.length === 0) return new Map<string, string | null>();

  const url = new URL(FANDOM_API_BASE);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("titles", titles.join("|"));
  url.searchParams.set("pithumbsize", String(pithumbsize));
  url.searchParams.set("format", "json");

  const data = await fetchJson(url.toString());
  const pages = data?.query?.pages ?? {};

  const out = new Map<string, string | null>();
  for (const pageKey of Object.keys(pages)) {
    const page = pages[pageKey];
    const title = page?.title as string | undefined;
    if (!title) continue;
    const thumb = page?.thumbnail?.source ?? null;
    // If thumbnail is missing, fall back to `pageimage` sometimes present.
    const portraitUrl = thumb ?? (page?.pageimage ? String(page.pageimage) : null);
    out.set(title, portraitUrl);
  }

  return out;
}

async function fetchAgeForTitle(title: string, cacheDir: string) {
  const ageCachePath = `${cacheDir}/age-${AGE_PARSER_CACHE_VERSION}/${safeFileName(title)}.json`;
  try {
    const fs = await import("node:fs/promises");
    const cached = await fs.readFile(ageCachePath, "utf8");
    const parsed = JSON.parse(cached) as { ageText: string | null; isMinor: boolean };
    return parsed;
  } catch {
    // Cache miss.
  }

  const url = new URL(FANDOM_API_BASE);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", title);
  url.searchParams.set("prop", "text");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  const data = await fetchJson(url.toString());
  const parseText = data?.parse?.text;
  if (typeof parseText !== "string") {
    const empty = { ageText: null as string | null, isMinor: false };
    return empty;
  }

  const { ageText, isMinor } = extractAgeInfoFromParseText(parseText);

  // Best-effort cache write.
  try {
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${cacheDir}/age-${AGE_PARSER_CACHE_VERSION}`, { recursive: true });
    await fs.writeFile(ageCachePath, JSON.stringify({ ageText, isMinor }), "utf8");
  } catch {
    // Ignore caching failures.
  }

  return { ageText, isMinor };
}

async function asyncPool<T, R>(
  limit: number,
  items: T[],
  iterator: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await iterator(items[current]);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function scrapeFemaleCharacters(opts: ScrapeOptions): Promise<FemaleCharacter[]> {
  const {
    limit,
    cacheDir,
    ageConcurrency = 4,
    imageBatchSize = 40,
  } = opts;

  // Ensure cache directory exists.
  const fs = await import("node:fs/promises");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(`${cacheDir}/age-${AGE_PARSER_CACHE_VERSION}`, { recursive: true });

  const titles = await getFemaleTitles({ limit, cacheDir });

  // Portraits: fetched in batches for speed.
  const portraitUrlByTitle = new Map<string, string | null>();
  for (let i = 0; i < titles.length; i += imageBatchSize) {
    const slice = titles.slice(i, i + imageBatchSize);
    // A slightly larger thumbnail makes cards look better.
    const batch = await fetchPortraitsForTitles(slice, 320);
    for (const [t, url] of batch.entries()) {
      portraitUrlByTitle.set(t, url);
    }
  }

  // Ages: parsed concurrently.
  const ageResults = await asyncPool(
    ageConcurrency,
    titles,
    async (title) => {
      const { ageText, isMinor } = await fetchAgeForTitle(title, cacheDir);
      return { title, ageText, isMinor };
    }
  );

  const out: FemaleCharacter[] = ageResults.map(({ title, ageText, isMinor }) => ({
    id: title,
    name: title,
    portraitUrl: portraitUrlByTitle.get(title) ?? null,
    ageText,
    isMinor,
  }));

  // Sort for stable UI ordering.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

