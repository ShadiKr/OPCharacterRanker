"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import LZString from "lz-string";
import type { FemaleCharacter } from "@/lib/tierlist/femaleCharacter";

const TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
type Tier = (typeof TIERS)[number];
type Assignments = Record<string, Tier | undefined>;

type PersistedStateV1 = {
  v: 1;
  /**
   * Only store ranked characters (unassigned omitted).
   * key: character id, value: Tier letter
   */
  t: Record<string, Tier>;
};

function isTierLetter(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

function encodeAssignments(assignments: Assignments): string {
  const t: Record<string, Tier> = {};
  for (const [id, tier] of Object.entries(assignments)) {
    if (tier) t[id] = tier;
  }
  const payload: PersistedStateV1 = { v: 1, t };
  return LZString.compressToBase64(JSON.stringify(payload)) ?? "";
}

function decodeAssignments(encoded: string): Assignments {
  try {
    const json = LZString.decompressFromBase64(encoded);
    if (!json) return {};
    const parsed = JSON.parse(json) as PersistedStateV1;
    if (!parsed || parsed.v !== 1 || !parsed.t) return {};

    const out: Assignments = {};
    for (const [id, tier] of Object.entries(parsed.t)) {
      if (isTierLetter(tier)) out[id] = tier;
    }
    return out;
  } catch {
    return {};
  }
}

function matchesQuery(name: string, q: string) {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return name.toLowerCase().includes(query);
}

const NO_PORTRAIT_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <rect width="240" height="240" fill="#0a0a0a"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="18" fill="#71717a">
        No image
      </text>
    </svg>`
  );

function tierColor(tier: Tier) {
  switch (tier) {
    case "S":
      return { labelBg: "bg-red-500", labelText: "text-white" };
    case "A":
      return { labelBg: "bg-orange-400", labelText: "text-black" };
    case "B":
      return { labelBg: "bg-yellow-300", labelText: "text-black" };
    case "C":
      return { labelBg: "bg-green-400", labelText: "text-black" };
    case "D":
      return { labelBg: "bg-sky-500", labelText: "text-white" };
    case "E":
      return { labelBg: "bg-violet-500", labelText: "text-white" };
    case "F":
      return { labelBg: "bg-pink-500", labelText: "text-white" };
  }
}

function CharacterCard(props: { character: FemaleCharacter; tier: Tier | undefined }) {
  const { character, tier } = props;
  const isRanked = Boolean(tier);

  return (
    <div
      className="relative w-[120px] aspect-square rounded-xl border border-zinc-800 bg-black/40 shadow-sm overflow-hidden flex-none"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", character.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <Image
        src={character.portraitUrl ?? NO_PORTRAIT_PLACEHOLDER}
        alt={character.name}
        fill
        unoptimized
        className="object-cover object-top"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

      <div className="absolute left-2 right-2 bottom-2">
        <div
          className="font-semibold text-[13px] leading-snug truncate text-zinc-50"
          title={character.name}
        >
          {character.name}
        </div>

        {/* Only show minor/adult focus after ranking:
            We show the "Minor" badge only when they are ranked AND marked minor. */}
        {isRanked && character.isMinor ? (
          <div className="mt-1 inline-flex items-center rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-200">
            Minor
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TierRow(props: {
  tier: Tier;
  characters: FemaleCharacter[];
  onDropCharacter: (id: string, tier: Tier) => void;
}) {
  const { tier, characters, onDropCharacter } = props;
  const colors = tierColor(tier);

  return (
    <div className="flex border-t border-zinc-800 first:border-t-0">
      <div
        className={[
          "w-16 shrink-0 flex items-center justify-center font-extrabold text-lg",
          colors.labelBg,
          colors.labelText,
        ].join(" ")}
      >
        {tier}
      </div>

      <div
        className="flex-1 bg-black/30 min-h-[84px] p-2.5 overflow-y-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/plain");
          if (id) onDropCharacter(id, tier);
        }}
      >
        {characters.length === 0 ? (
          <div className="text-xs text-zinc-600 italic">Drop here</div>
        ) : null}

        <div className="flex flex-wrap gap-2 items-start">
          {characters
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <CharacterCard key={c.id} character={c} tier={tier} />
            ))}
        </div>
      </div>
    </div>
  );
}

export default function TierListApp() {
  const [dataset, setDataset] = useState<FemaleCharacter[] | null>(null);
  const [query, setQuery] = useState("");
  const [assignments, setAssignments] = useState<Assignments>({});
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    // Load the precomputed wiki dataset generated during `prebuild`.
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/data/female_characters.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { characters?: FemaleCharacter[] };
        const chars = Array.isArray(json.characters) ? json.characters : [];
        if (!cancelled) setDataset(chars);
      } catch (e) {
        console.error(e);
        if (!cancelled) setDataset([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("r");
    const STORAGE_KEY = "tierlist:rankings:v1";

    if (r) {
      const decoded = decodeAssignments(r);
      queueMicrotask(() => setAssignments(decoded));
      return;
    }

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const decoded = decodeAssignments(saved);
      queueMicrotask(() => setAssignments(decoded));
    }
  }, []);

  useEffect(() => {
    const STORAGE_KEY = "tierlist:rankings:v1";
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeAssignments(assignments));
    } catch {
      // Ignore quota errors
    }
  }, [assignments]);

  const pool = useMemo(() => {
    if (!dataset) return [];
    return dataset.filter((c) => assignments[c.id] === undefined && matchesQuery(c.name, query));
  }, [dataset, assignments, query]);

  const byTier = useMemo(() => {
    const buckets: Record<Tier, FemaleCharacter[]> = {
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
      E: [],
      F: [],
    };
    if (!dataset) return buckets;
    for (const c of dataset) {
      const t = assignments[c.id];
      if (t) buckets[t].push(c);
    }
    return buckets;
  }, [dataset, assignments]);

  function moveCharacterToTier(id: string, tier: Tier) {
    setAssignments((prev) => ({
      ...prev,
      [id]: tier,
    }));
  }

  async function copyShareLink() {
    const encoded = encodeAssignments(assignments);
    const url = new URL(window.location.href);
    url.searchParams.set("r", encoded);

    try {
      await navigator.clipboard.writeText(url.toString());
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      window.prompt("Copy this tier link:", url.toString());
    }
  }

  function resetAll() {
    if (!confirm("Reset all tier rankings?")) return;
    setAssignments({});
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-800 text-zinc-50">
      <header className="max-w-7xl mx-auto px-4 py-6">
        {/* Per your request: no title/instructions text */}
        <div className="flex gap-3 items-center mt-1 flex-wrap">
          <button
            type="button"
            onClick={copyShareLink}
            className="rounded-xl bg-white/10 text-white px-4 py-2 text-sm hover:bg-white/15 transition border border-white/10"
          >
            {shareCopied ? "Copied!" : "Share"}
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10 transition"
          >
            Reset
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-10">
        <section className="rounded-2xl border border-zinc-800 bg-black/40 p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            {/* Tier board */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-zinc-200">Your tiers</div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-zinc-800">
                {TIERS.map((tierLetter) => (
                  <TierRow
                    key={tierLetter}
                    tier={tierLetter}
                    characters={byTier[tierLetter]}
                    onDropCharacter={moveCharacterToTier}
                  />
                ))}
              </div>
            </div>

            {/* Search / characters area at the very bottom */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-zinc-200">
                Search unassigned characters
              </label>
              <input
                className="mt-2 w-full border border-zinc-800 rounded-xl px-3 py-2 text-sm bg-black/30 text-zinc-50 placeholder:text-zinc-500"
                placeholder="Type a name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              <div className="mt-4 min-h-[140px] max-h-[45vh] overflow-y-auto">
                {dataset ? (
                  pool.length === 0 ? (
                    <div className="text-sm text-zinc-500 italic py-8">
                      No unassigned matches. Try clearing the search, or assign more characters.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3 items-start">
                      {pool
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => (
                          <CharacterCard key={c.id} character={c} tier={undefined} />
                        ))}
                    </div>
                  )
                ) : (
                  <div className="text-sm text-zinc-500 italic py-8">Loading dataset...</div>
                )}

                {!dataset || dataset.length === 0 ? (
                  <div className="mt-4 text-sm text-zinc-400">
                    Dataset not found yet. Wait for the build-time scraper to generate{" "}
                    <code className="ml-2 text-xs bg-white/10 px-2 py-1 rounded border border-white/10">
                      {"/data/female_characters.json"}
                    </code>
                    .
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

