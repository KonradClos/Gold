// update-prices.mjs
// Writes:
// - data/price.json
// - data/history.jsonl (append 1 line per run)
//
// Sources:
// - Stooq summary pages for XAUEUR + XAUUSD
// - ECB daily USD/EUR from eurofxref-daily.xml
//
// Run: node update-prices.mjs

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const PRICE_JSON = path.join(DATA_DIR, "price.json");
const HISTORY_JSONL = path.join(DATA_DIR, "history.jsonl");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // helpful against some basic bot heuristics
      "User-Agent": "Mozilla/5.0 (Gold-Portfolio-Updater; +https://github.com/konradclos/Gold)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en,de;q=0.9",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

// Parse Stooq summary page:
// It contains blocks like:
// Last 4189.55 €/ozt Date 2026-02-06 22:00:20
function parseStooqSummary(html) {
  // Normalize whitespace a bit
  const s = html.replace(/\s+/g, " ");

  const m = s.match(/attach.*?/i); // noop, keep stable (no usage)
  void m;

  const re = /Last\s+([0-9]+(?:\.[0-9]+)?)\s+.*?Date\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i;
  const match = s.match(re);
  if (!match) {
    throw new Error("Could not parse Stooq summary (Last/Date/Time not found).");
  }

  const last = Number(match[1]);
  const date = match[2];
  const time = match[3];

  if (!Number.isFinite(last)) throw new Error("Parsed Stooq 'Last' is not a number.");

  return { last, date, time };
}

async function fetchEcbUsdPerEur() {
  const xml = await fetchText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i);
  if (!m) throw new Error("ECB USD rate not found in XML.");
  const usdPerEur = Number(m[1]);
  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) throw new Error("ECB USD rate invalid.");
  return usdPerEur;
}

function daysOld(isoDate /* YYYY-MM-DD */) {
  const d = new Date(isoDate + "T00:00:00Z").getTime();
  const age = Math.floor((Date.now() - d) / 864e5);
  return age;
}

async function main() {
  ensureDir(DATA_DIR);

  // Stooq summary pages (work today: they show Date 2026-02-06 etc.)
  const [xaueurHtml, xauusdHtml] = await Promise.all([
    fetchText("https://stooq.com/q/?s=xaueur"),
    fetchText("https://stooq.com/q/?s=xauusd"),
  ]);

  const xaueur = parseStooqSummary(xaueurHtml);
  const xauusd = parseStooqSummary(xauusdHtml);

  // Optional sanity: if stooq date is very old, fail the run (prevents writing stale data)
  const ageA = daysOld(xaueur.date);
  const ageU = daysOld(xauusd.date);
  if (ageA > 10 && ageU > 10) {
    throw new Error(`Stooq data seems stale: XAUEUR ${xaueur.date} (${ageA}d), XAUUSD ${xauusd.date} (${ageU}d)`);
  }

  // ECB USD per EUR
  const usdPerEur = await fetchEcbUsdPerEur();

  const eurPerOz_primary = xaueur.last; // already XAUEUR
  const xauusdUsdPerOz = xauusd.last;
  const eurPerOz_check = xauusdUsdPerOz / usdPerEur;

  const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const payload = {
    asOf,
    primary: {
      source: "stooq-xaueur",
      eurPerOz: round2(eurPerOz_primary),
      stooqDate: xaueur.date,
      stooqTime: xaueur.time,
    },
    check: {
      source: "stooq-xauusd + ecb-usd-per-eur",
      eurPerOz: eurPerOz_check,
      usdPerEur,
      xauusdUsdPerOz,
      stooqDate: xauusd.date,
      stooqTime: xauusd.time,
    },
  };

  fs.writeFileSync(PRICE_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");

  // Append to history.jsonl
  const line = JSON.stringify({
    asOf,
    eurPerOz_primary: round2(eurPerOz_primary),
    eurPerOz_check: eurPerOz_check,
  });
  fs.appendFileSync(HISTORY_JSONL, line + "\n", "utf8");

  console.log("OK:", asOf, "XAUEUR", eurPerOz_primary, "XAUUSD/ECB", eurPerOz_check);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
