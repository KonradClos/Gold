// update-prices.mjs
// Robust strategy:
// 1) Try Stooq HTML quote page (preferred)
// 2) Fallback to Stooq CSV daily history
// 3) ECB USD/EUR daily XML as cross-check
//
// Writes:
// - data/price.json
// - data/history.jsonl

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
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/csv;q=0.9,*/*;q=0.8",
      "Accept-Language": "en,de;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }

  return await res.text();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function daysOld(isoDate) {
  const t = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.floor((Date.now() - t) / 864e5);
}

function parseStooqHtmlLastDateTime(html) {
  const s = html.replace(/\s+/g, " ");

  // Preferred: Last ... Date YYYY-MM-DD [HH:MM:SS]
  let m = s.match(
    /Last\s+([0-9]+(?:\.[0-9]+)?)\s+.*?Date\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/i
  );
  if (m) {
    const last = Number(m[1]);
    const date = m[2];
    const time = m[3] || "00:00:00";

    if (Number.isFinite(last)) {
      return { last, date, time };
    }
  }

  // Fallback: sometimes spacing/layout differs
  m = s.match(/Last\s+([0-9]+(?:\.[0-9]+)?)/i);
  const d = s.match(/Date\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/i);

  if (m && d) {
    const last = Number(m[1]);
    const date = d[1];
    const time = d[2] || "00:00:00";

    if (Number.isFinite(last)) {
      return { last, date, time };
    }
  }

  return null;
}

function parseStooqCsvLatest(csv) {
  const raw = csv.trim();

  if (!raw) {
    throw new Error("CSV response is empty.");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  console.log("CSV preview:", lines.slice(0, 5));

  if (lines.length < 2) {
    throw new Error(`CSV has too few lines. Got ${lines.length}. First line: ${lines[0] || "<none>"}`);
  }

  const header = lines[0].toLowerCase();
  if (!header.includes("date") || !header.includes("close")) {
    throw new Error(`CSV header unexpected: ${lines[0]}`);
  }

  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split(",");

  if (parts.length < 5) {
    throw new Error(`CSV row has too few columns: ${lastLine}`);
  }

  const date = parts[0];
  const close = Number(parts[4]);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`CSV date invalid: ${date}`);
  }

  if (!Number.isFinite(close)) {
    throw new Error(`CSV close invalid: ${parts[4]}`);
  }

  return { last: close, date, time: "00:00:00" };
}

async function fetchStooqSymbol(symbol) {
  const lower = symbol.toLowerCase();

  // 1) HTML first
  try {
    const html = await fetchText(`https://stooq.com/q/?s=${lower}`);
    const parsed = parseStooqHtmlLastDateTime(html);

    if (parsed) {
      console.log(`${symbol}: parsed from HTML`);
      return parsed;
    }

    console.log(`${symbol}: HTML fetch ok, but parser found no match`);
  } catch (err) {
    console.log(`${symbol}: HTML fetch/parse failed: ${err?.message || err}`);
  }

  // 2) CSV fallback
  console.log(`${symbol}: trying CSV fallback...`);
  const csv = await fetchText(`https://stooq.com/q/d/l/?s=${lower}&i=d`);
  const parsedCsv = parseStooqCsvLatest(csv);
  console.log(`${symbol}: parsed from CSV`);
  return parsedCsv;
}

async function fetchEcbUsdPerEur() {
  const xml = await fetchText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
  const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i);

  if (!m) {
    throw new Error("ECB USD rate not found.");
  }

  const usdPerEur = Number(m[1]);

  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) {
    throw new Error("ECB USD rate invalid.");
  }

  return usdPerEur;
}

function appendHistoryLine(filePath, data) {
  fs.appendFileSync(filePath, JSON.stringify(data) + "\n", "utf8");
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

  const ageA = daysOld(xaueur.date);
  const ageU = daysOld(xauusd.date);

  if (ageA > 10 && ageU > 10) {
    throw new Error(
      `Stooq data seems stale: XAUEUR ${xaueur.date} (${ageA}d), XAUUSD ${xauusd.date} (${ageU}d)`
    );
  }

  const eurPerOz_primary = xaueur.last;
  const xauusdUsdPerOz = xauusd.last;
  const eurPerOz_check = xauusdUsdPerOz / usdPerEur;

  if (!Number.isFinite(eurPerOz_primary) || eurPerOz_primary <= 0) {
    throw new Error(`Primary EUR/oz invalid: ${eurPerOz_primary}`);
  }

  if (!Number.isFinite(eurPerOz_check) || eurPerOz_check <= 0) {
    throw new Error(`Check EUR/oz invalid: ${eurPerOz_check}`);
  }

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
      eurPerOz: round2(eurPerOz_check),
      usdPerEur: round2(usdPerEur),
      xauusdUsdPerOz: round2(xauusdUsdPerOz),
      stooqDate: xauusd.date,
      stooqTime: xauusd.time,
    },
  };

  fs.writeFileSync(PRICE_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");

  appendHistoryLine(HISTORY_JSONL, {
    asOf,
    eurPerOz_primary: round2(eurPerOz_primary),
    eurPerOz_check: round2(eurPerOz_check),
  });

  console.log("WROTE:", PRICE_JSON);
  console.log("APPENDED:", HISTORY_JSONL);
  console.log("OK:", asOf, "XAUEUR", eurPerOz_primary, "CHECK", eurPerOz_check);
}

main().catch((e) => {
  console.error("FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
