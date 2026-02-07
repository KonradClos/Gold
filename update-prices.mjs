// update-prices.mjs (robust)
// Strategy:
// 1) Try Stooq "summary" quote block (Last/Date/Time) from HTML
// 2) Fallback to Stooq CSV and take the latest row
// 3) ECB USD/EUR daily XML
//
// Writes:
// - data/price.json
// - data/history.jsonl (append)

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
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Gold-Portfolio-Updater; +https://github.com/konradclos/Gold)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en,de;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function daysOld(isoDate /* YYYY-MM-DD */) {
  const t = new Date(isoDate + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - t) / 864e5);
}

// Parse HTML quote block: "Last ... Date YYYY-MM-DD HH:MM:SS"
function parseStooqHtmlLastDateTime(html) {
  const s = html.replace(/\s+/g, " ");

  // This format exists on stooq quote pages in many locales:
  // Last 4189.55 ... Date 2026-02-06 22:00:20
  const re = /Last\s+([0-9]+(?:\.[0-9]+)?)\s+.*?Date\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i;
  const m = s.match(re);
  if (!m) return null;

  const last = Number(m[1]);
  const date = m[2];
  const time = m[3];

  if (!Number.isFinite(last)) return null;
  return { last, date, time };
}

// Fallback: CSV endpoint from Stooq (latest row)
function parseStooqCsvLatest(csv) {
  // Expect header: Date,Open,High,Low,Close,Volume
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("CSV has too few lines.");

  // Take last non-header line
  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split(",");

  // Date, Open, High, Low, Close, Volume
  const date = parts[0];
  const close = Number(parts[4]);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("CSV date invalid: " + date);
  if (!Number.isFinite(close)) throw new Error("CSV close invalid.");

  // Time is not in daily CSV; set 00:00:00
  return { last: close, date, time: "00:00:00" };
}

async function fetchStooqSymbol(symbol) {
  // 1) HTML quote page
  const html = await fetchText(`https://stooq.com/q/?s=${symbol.toLowerCase()}`);
  const fromHtml = parseStooqHtmlLastDateTime(html);
  if (fromHtml) return fromHtml;

  // 2) CSV fallback (daily)
  // Example: https://stooq.com/q/d/l/?s=xaueur&i=d
  const csv = await fetchText(`https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}&i=d`);
  return parseStooqCsvLatest(csv);
}

async function fetchEcbUsdPerEur() {
  const xml = await fetchText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i);
  if (!m) throw new Error("ECB USD rate not found.");
  const usdPerEur = Number(m[1]);
  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) throw new Error("ECB USD rate invalid.");
  return usdPerEur;
}

async function main() {
  ensureDir(DATA_DIR);

  console.log("=== UPDATE SCRIPT RUNNING ===");

  const [xaueur, xauusd, usdPerEur] = await Promise.all([
    fetchStooqSymbol("xaueur"),
    fetchStooqSymbol("xauusd"),
    fetchEcbUsdPerEur(),
  ]);

  console.log("XAUEUR parsed:", xaueur);
  console.log("XAUUSD parsed:", xauusd);
  console.log("ECB usdPerEur:", usdPerEur);

  // Sanity: do not write extremely stale data
  const ageA = daysOld(xaueur.date);
  const ageU = daysOld(xauusd.date);
  if (ageA > 10 && ageU > 10) {
    throw new Error(`Stooq data seems stale: XAUEUR ${xaueur.date} (${ageA}d), XAUUSD ${xauusd.date} (${ageU}d)`);
  }

  const eurPerOz_primary = xaueur.last;
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

  const line = JSON.stringify({
    asOf,
    eurPerOz_primary: round2(eurPerOz_primary),
    eurPerOz_check: eurPerOz_check,
  });
  fs.appendFileSync(HISTORY_JSONL, line + "\n", "utf8");

  console.log("WROTE:", PRICE_JSON);
  console.log("APPENDED:", HISTORY_JSONL);
  console.log("OK:", asOf, "XAUEUR", eurPerOz_primary, "CHECK", eurPerOz_check);
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
