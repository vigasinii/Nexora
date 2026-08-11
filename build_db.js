const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ENTITIES } = require('./schema');

const DB_PATH = path.join(__dirname, 'datahouse.db');
const CSV_DIR = path.join(__dirname, 'seed_csv');

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF;');

function sqlType(t) {
  switch (t) {
    case 'number': return 'INTEGER';
    case 'float': return 'REAL';
    case 'bool': return 'INTEGER';
    case 'date': return 'TEXT';
    default: return 'TEXT';
  }
}

// simple CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

let created = 0, seeded = 0, totalRows = 0;

for (const [key, ent] of Object.entries(ENTITIES)) {
  const cols = ent.fields.map(f => `"${f.name}" ${sqlType(f.type)}`);
  let pkClause = '';
  if (ent.pk) {
    pkClause = `"${ent.pk}" ${sqlType(ent.pkType)} PRIMARY KEY,`;
  } else {
    pkClause = `"_rowid" INTEGER PRIMARY KEY AUTOINCREMENT,`;
  }
  const createSQL = `CREATE TABLE "${ent.table}" (${pkClause} ${cols.join(', ')});`;
  db.exec(createSQL);
  created++;

  const csvPath = path.join(CSV_DIR, `${ent.table}.csv`);
  if (!fs.existsSync(csvPath)) continue;
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);
  if (rows.length < 2) continue;
  const header = rows[0];
  const dataRows = rows.slice(1);

  const allCols = ent.pk ? [ent.pk, ...ent.fields.map(f => f.name)] : ent.fields.map(f => f.name);
  const insertCols = allCols.filter(c => header.includes(c));
  const placeholders = insertCols.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT OR IGNORE INTO "${ent.table}" (${insertCols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`);

  const fieldTypeMap = {};
  ent.fields.forEach(f => fieldTypeMap[f.name] = f.type);

  db.exec('BEGIN;');
  for (const r of dataRows) {
    const rec = {};
    header.forEach((h, idx) => rec[h] = r[idx]);
    const values = insertCols.map(c => {
      let v = rec[c];
      if (v === undefined || v === '') return null;
      const t = fieldTypeMap[c];
      if (t === 'bool') return (v === '1' || v.toLowerCase?.() === 'true') ? 1 : 0;
      if (t === 'number') return isNaN(parseInt(v)) ? null : parseInt(v);
      if (t === 'float') return isNaN(parseFloat(v)) ? null : parseFloat(v);
      return v;
    });
    try {
      stmt.run(...values);
      totalRows++;
    } catch (e) {
      // skip bad row
    }
  }
  db.exec('COMMIT;');
  seeded++;
}

console.log(`Created ${created} tables, seeded ${seeded} from CSV, ${totalRows} total rows inserted.`);
console.log(`DB written to ${DB_PATH}`);
db.close();
