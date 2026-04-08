import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DATA_DIR = './data';
const PRICE_JSON = './data/price.json';
const HISTORY_JSONL = './data/history.jsonl';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fetchText(url) {
  return execFileSync('curl', ['-L', '--silent', '--show-error', url], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 5
  });
}

function fetchGoldUsdPerOz() {
  console.log('Fetching api.gold-api.com ...');
  const text = fetchText('https://api.gold-api.com/price/XAU');
  console.log('RAW:', text.slice(0, 200));

  const data = JSON.parse(text);
  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 100) {
    throw new Error(`Invalid gold-api.com price: ${data.price}`);
  }

  return price;
}

function fetchUsdPerEur() {
  console.log('Fetching ECB FX ...');
  const xml = fetchText('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
  const match = xml.match(/currency=['\"]USD['\"]\s+rate=['\"]([0-9.]+)['\"]/i);

  if (!match) {
    throw new Error('ECB USD rate not found');
  }

  const usdPerEur = Number(match[1]);
  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) {
    throw new Error(`Invalid ECB USD rate: ${match[1]}`);
  }

  return usdPerEur;
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_JSONL)) {
    return [];
  }

  return fs.readFileSync(HISTORY_JSONL, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => Number.isFinite(Number(item.eurPerOz_primary)) && Number(item.eurPerOz_primary) > 100);
}

function saveHistory(items) {
  const text = items.map(item => JSON.stringify(item)).join('\n');
  fs.writeFileSync(HISTORY_JSONL, text ? text + '\n' : '', 'utf8');
}

async function main() {
  ensureDir(DATA_DIR);

  console.log('=== GOLD UPDATE ===');

  const usdPerOz = fetchGoldUsdPerOz();
  const usdPerEur = fetchUsdPerEur();
  const eurPerOz = usdPerOz / usdPerEur;

  if (!Number.isFinite(eurPerOz) || eurPerOz <= 100) {
    throw new Error(`Computed EUR gold price invalid: ${eurPerOz}`);
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const eurRounded = round2(eurPerOz);
  const usdRounded = round2(usdPerOz);
  const fxRounded = round2(usdPerEur);

  const payload = {
    asOf: now,
    primary: {
      source: 'gold-api.com + ecb',
      eurPerOz: eurRounded
    },
    check: {
      source: 'gold-api.com + ecb',
      eurPerOz: eurRounded,
      usdPerEur: fxRounded,
      xauusdUsdPerOz: usdRounded
    }
  };

  fs.writeFileSync(PRICE_JSON, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const history = loadHistory();
  history.push({
    asOf: now,
    eurPerOz_primary: eurRounded,
    eurPerOz_check: eurRounded
  });
  saveHistory(history);

  console.log('USD/oz:', usdRounded);
  console.log('USD per EUR:', fxRounded);
  console.log('EUR/oz:', eurRounded);
  console.log('WROTE:', PRICE_JSON);
  console.log('APPENDED:', HISTORY_JSONL);
}

main().catch((e) => {
  console.error('FAILED:', e?.stack || e?.message || e);
  process.exit(1);
});
