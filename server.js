const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { WebSocketServer } = require('ws');
const { dbGet, dbAll, dbRun, dbExec } = require('./db-turso');
const { ENTITIES, NAV_GROUPS } = require('./schema');
const { registerReportRoutes } = require('./reports');
const { registerReports2 } = require('./reports2');

// Additive-only migrations — safe to run on every startup. Lets existing
// database files (e.g. an already-installed desktop app) gain new columns
// without wiping the user's data.
async function runMigrations() {
  const migrations = [
    { table: 'T11_Item_Master', column: 'T11_55_Photo', ddl: 'ALTER TABLE T11_Item_Master ADD COLUMN T11_55_Photo TEXT' },
    { table: 'T21_Projects', column: 'T21_02_Project_Code', ddl: 'ALTER TABLE T21_Projects ADD COLUMN T21_02_Project_Code TEXT' },
    { table: 'T21_Projects', column: 'T21_03_Project_Name', ddl: 'ALTER TABLE T21_Projects ADD COLUMN T21_03_Project_Name TEXT' },
    { table: 'T21_Projects', column: 'T01_PK', ddl: 'ALTER TABLE T21_Projects ADD COLUMN T01_PK TEXT' },
    { table: 'T15_SO_Details', column: 'T15_03_Retail', ddl: 'ALTER TABLE T15_SO_Details ADD COLUMN T15_03_Retail REAL' },
    { table: 'T15_SO_Details', column: 'T15_04_Trade', ddl: 'ALTER TABLE T15_SO_Details ADD COLUMN T15_04_Trade REAL' },
    { table: 'T15_SO_Details', column: 'T15_05_OEM', ddl: 'ALTER TABLE T15_SO_Details ADD COLUMN T15_05_OEM REAL' },
    { table: 'T15_SO_Details', column: 'T15_06_Description_Override', ddl: 'ALTER TABLE T15_SO_Details ADD COLUMN T15_06_Description_Override TEXT' },
    { table: 'T18_PO_Details', column: 'T18_03_Cost', ddl: 'ALTER TABLE T18_PO_Details ADD COLUMN T18_03_Cost REAL' },
    { table: 'T18_PO_Details', column: 'T18_04_Description_Override', ddl: 'ALTER TABLE T18_PO_Details ADD COLUMN T18_04_Description_Override TEXT' },
    { table: 'T25_SO_Fulfillment', column: 'T25_27_Warranty_Duration', ddl: 'ALTER TABLE T25_SO_Fulfillment ADD COLUMN T25_27_Warranty_Duration TEXT' },
    { table: 'T25_SO_Fulfillment', column: 'T25_28_Warranty_Start', ddl: 'ALTER TABLE T25_SO_Fulfillment ADD COLUMN T25_28_Warranty_Start TEXT' },
    { table: 'T25_SO_Fulfillment', column: 'T25_29_Warranty_End', ddl: 'ALTER TABLE T25_SO_Fulfillment ADD COLUMN T25_29_Warranty_End TEXT' },
    { table: 'T27_Requisition', column: 'T14_SO_PK', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T14_SO_PK TEXT' },
    { table: 'T24_Serial_Numbers', column: 'T24_03_Serial_Number', ddl: 'ALTER TABLE T24_Serial_Numbers ADD COLUMN T24_03_Serial_Number TEXT' },
    { table: 'T24_Serial_Numbers', column: 'T14_SO_PK', ddl: 'ALTER TABLE T24_Serial_Numbers ADD COLUMN T14_SO_PK TEXT' },
    { table: 'T24_Serial_Numbers', column: 'T24_04_Warranty_Start', ddl: 'ALTER TABLE T24_Serial_Numbers ADD COLUMN T24_04_Warranty_Start TEXT' },
    { table: 'T24_Serial_Numbers', column: 'T24_05_Warranty_End', ddl: 'ALTER TABLE T24_Serial_Numbers ADD COLUMN T24_05_Warranty_End TEXT' },
    { table: 'T04_Your_Company', column: 'T04_09_Logo', ddl: 'ALTER TABLE T04_Your_Company ADD COLUMN T04_09_Logo TEXT' },
    { table: 'T25_SO_Fulfillment', column: 'T25_30_CI_Number', ddl: 'ALTER TABLE T25_SO_Fulfillment ADD COLUMN T25_30_CI_Number TEXT' },
    { table: 'T25_SO_Fulfillment', column: 'T25_31_PL_Number', ddl: 'ALTER TABLE T25_SO_Fulfillment ADD COLUMN T25_31_PL_Number TEXT' },
    { table: 'T27_Requisition', column: 'T27_09_SRF_Number', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T27_09_SRF_Number TEXT' },
    { table: 'T28_Users', column: 'T28_06_Status', ddl: 'ALTER TABLE T28_Users ADD COLUMN T28_06_Status TEXT DEFAULT "Approved"' },
    { table: 'T28_Users', column: 'T28_07_Allowed_Entities', ddl: 'ALTER TABLE T28_Users ADD COLUMN T28_07_Allowed_Entities TEXT' },
    { table: 'T28_Users', column: 'T28_08_Role', ddl: 'ALTER TABLE T28_Users ADD COLUMN T28_08_Role TEXT' },
    { table: 'T27_Requisition', column: 'T27_10_Reviewed_By', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T27_10_Reviewed_By TEXT' },
    { table: 'T27_Requisition', column: 'T27_11_Reviewed_Date', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T27_11_Reviewed_Date TEXT' },
    { table: 'T27_Requisition', column: 'T27_12_Approved_By', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T27_12_Approved_By TEXT' },
    { table: 'T27_Requisition', column: 'T27_13_Approved_Date', ddl: 'ALTER TABLE T27_Requisition ADD COLUMN T27_13_Approved_Date TEXT' },
  ];
  for (const m of migrations) {
    try {
      const cols = (await dbAll(`PRAGMA table_info("${m.table}")`));
      const exists = cols.some(c => c.name === m.column);
      if (!exists) (await dbExec(m.ddl));
    } catch (e) {
      console.error(`Migration failed for ${m.table}.${m.column}:`, e.message);
    }
  }
  // New tables (idempotent — CREATE TABLE IF NOT EXISTS is safe on every startup)
  try {
    (await dbExec(`
      CREATE TABLE IF NOT EXISTS T27_Requisition (
        T27_Requisition_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        T27_01_Type TEXT,
        T11_Item_Master_PK TEXT NOT NULL,
        T27_02_Quantity_Requested REAL,
        T27_03_Requested_By TEXT,
        T27_04_Requesting_Office TEXT,
        T27_05_Date_Requested TEXT,
        T27_06_Status TEXT,
        T27_07_Approved_By TEXT,
        T27_08_Notes TEXT,
        FOREIGN KEY (T11_Item_Master_PK) REFERENCES T11_Item_Master(T11_Item_Master_PK)
      );
    `));
  } catch (e) {
    console.error('Migration failed creating T27_Requisition:', e.message);
  }
  try {
    (await dbExec(`
      CREATE TABLE IF NOT EXISTS T26_Forecast (
        T26_Forecast_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        T11_Item_Master_PK TEXT NOT NULL,
        T01_PK TEXT,
        T26_01_Forecast_Quantity REAL,
        T26_02_Delivery_Month TEXT,
        T26_03_Remarks TEXT,
        T26_04_Quarter TEXT,
        T26_05_Submitted_By TEXT,
        FOREIGN KEY (T11_Item_Master_PK) REFERENCES T11_Item_Master(T11_Item_Master_PK),
        FOREIGN KEY (T01_PK) REFERENCES T01_Company(T01_PK)
      );
    `));
  } catch (e) {
    console.error('Migration failed creating T26_Forecast:', e.message);
  }
  try {
    (await dbExec(`
      CREATE TABLE IF NOT EXISTS T28_Users (
        T28_User_PK TEXT PRIMARY KEY,
        T28_01_Name TEXT NOT NULL,
        T28_02_Username TEXT NOT NULL UNIQUE,
        T28_03_Password TEXT,
        T28_04_Department TEXT NOT NULL,
        T28_05_Active INTEGER DEFAULT 1
      );
    `));
  } catch (e) {
    console.error('Migration failed creating T28_Users:', e.message);
  }
  try {
    (await dbExec(`CREATE TABLE IF NOT EXISTS T29_DocCounters (doc_type TEXT PRIMARY KEY, next_number INTEGER NOT NULL DEFAULT 1);`));
  } catch (e) {
    console.error('Migration failed creating T29_DocCounters:', e.message);
  }
  try {
    (await dbExec(`
      CREATE TABLE IF NOT EXISTS T30_RMA (
        T30_RMA_PK TEXT PRIMARY KEY,
        T30_01_RMA_Number TEXT UNIQUE,
        T14_SO_PK TEXT NOT NULL,
        T24_Serial_PK INTEGER,
        T11_Item_Master_PK TEXT NOT NULL,
        T30_02_Reason TEXT,
        T30_03_Date_Requested TEXT,
        T30_04_Under_Warranty INTEGER,
        T30_05_Status TEXT,
        T30_06_Resolution TEXT,
        T30_07_Notes TEXT,
        FOREIGN KEY (T14_SO_PK) REFERENCES T14_Sales_Orders(T14_SO_PK),
        FOREIGN KEY (T11_Item_Master_PK) REFERENCES T11_Item_Master(T11_Item_Master_PK)
      );
    `));
  } catch (e) {
    console.error('Migration failed creating T30_RMA:', e.message);
  }

  // Requisitions used to require a single Item + Quantity per row (NOT
  // NULL constraint). Now a requisition links to a whole Sales Order and
  // lists all of its items instead, so that old constraint has to go —
  // SQLite can't relax a NOT NULL in place, so this rebuilds the table.

  // Re-run the additive column migrations above now that every base table
  // is guaranteed to exist. On a genuinely fresh database, every attempt
  // above ran before its target table existed and was (correctly) skipped
  // — without this second pass, those columns would silently never get
  // added on a fresh install, and the T27_Requisition rebuild just below
  // would fail trying to copy columns that were never created.
  for (const m of migrations) {
    try {
      const cols = (await dbAll(`PRAGMA table_info("${m.table}")`));
      const exists = cols.some(c => c.name === m.column);
      if (!exists) (await dbExec(m.ddl));
    } catch (e) {
      console.error(`Migration (second pass) failed for ${m.table}.${m.column}:`, e.message);
    }
  }

  try {
    const tableInfo = (await dbAll(`PRAGMA table_info("T27_Requisition")`));
    const itemCol = tableInfo.find(c => c.name === 'T11_Item_Master_PK');
    if (itemCol && itemCol.notnull) {
      (await dbExec(`
        CREATE TABLE T27_Requisition_new (
          T27_Requisition_ID INTEGER PRIMARY KEY AUTOINCREMENT,
          T27_01_Type TEXT,
          T11_Item_Master_PK TEXT,
          T27_02_Quantity_Requested REAL,
          T27_03_Requested_By TEXT,
          T27_04_Requesting_Office TEXT,
          T27_05_Date_Requested TEXT,
          T27_06_Status TEXT,
          T27_07_Approved_By TEXT,
          T27_08_Notes TEXT,
          T14_SO_PK TEXT,
          T27_09_SRF_Number TEXT,
          T27_10_Reviewed_By TEXT,
          T27_11_Reviewed_Date TEXT,
          T27_12_Approved_By TEXT,
          T27_13_Approved_Date TEXT
        );
        INSERT INTO T27_Requisition_new SELECT T27_Requisition_ID, T27_01_Type, T11_Item_Master_PK, T27_02_Quantity_Requested, T27_03_Requested_By, T27_04_Requesting_Office, T27_05_Date_Requested, T27_06_Status, T27_07_Approved_By, T27_08_Notes, T14_SO_PK, T27_09_SRF_Number, T27_10_Reviewed_By, T27_11_Reviewed_Date, T27_12_Approved_By, T27_13_Approved_Date FROM T27_Requisition;
        DROP TABLE T27_Requisition;
        ALTER TABLE T27_Requisition_new RENAME TO T27_Requisition;
      `));
    }
  } catch (e) {
    console.error('Migration failed relaxing T27_Requisition constraint:', e.message);
  }
}

const app = express();
let ACTUAL_PORT = null; // set once the server actually binds — see httpServer.listen further down
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------
// Session-based authentication.
//
// SESSION_SECRET is randomly generated per install and persisted to disk so
// existing sessions survive an app restart. This protects against session
// forgery, but this whole system is still meant for organizing access
// within a trusted team, not for defending against a hostile actor who
// already has network access to the machine running this app — there's no
// rate limiting, no account lockout, no HTTPS enforcement, and the app has
// no built-in exposure protection if you put it on the open internet.
// ---------------------------------------------------------------------
// SESSION_SECRET: on Render (ephemeral disk), set a SESSION_SECRET env var
// so sessions survive restarts/redeploys. Falls back to a file persisted
// next to this script for local/desktop use, where the disk is durable.
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const SESSION_SECRET_PATH = path.join(__dirname, '.session-secret');
  try {
    SESSION_SECRET = fs.readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
  } catch (e) {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(SESSION_SECRET_PATH, SESSION_SECRET); } catch (e2) { /* read-only fs — fine, just won't persist across restarts */ }
  }
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
}));

// Public: list of active users for the login picker (name + department only
// — never the password hash).
// Public: lets the frontend show "others connect to: <address>" without any
// Electron-specific plumbing — works identically whether this is running as
// the desktop Host, or just as a plain web server.
app.get('/api/network-info', (req, res) => {
  const nets = require('os').networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  res.json({ addresses, port: ACTUAL_PORT });
});

app.get('/api/auth/login-users', async (req, res) => {
  try {
    // Deliberately NOT filtered to Active=1 — this only exists to answer
    // "does at least one account exist at all", so the "Create the first
    // account" screen doesn't keep reappearing for a Pending/rejected
    // account (which the signup endpoint's own separate isFirstUser check
    // already correctly refuses to treat as "the first").
    const rows = (await dbAll(`SELECT T28_User_PK, T28_01_Name, T28_04_Department FROM T28_Users`));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, username, password, requestedDepartment } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Name, username, and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = (await dbGet(`SELECT 1 FROM T28_Users WHERE T28_02_Username = ?`, [username]));
    if (existing) return res.status(400).json({ error: `Username "${username}" is already taken.` });

    const isFirstUser = (await dbGet(`SELECT COUNT(*) c FROM T28_Users`)).c === 0;
    const pk = genGuid();
    const hashed = bcrypt.hashSync(password, 10);
    // The very first account on a fresh install is auto-approved with full
    // access (someone has to be able to get in to approve anyone else).
    // Every signup after that starts as Pending until an admin approves it.
    const status = isFirstUser ? 'Approved' : 'Pending';
    const department = isFirstUser ? 'CSR' : (requestedDepartment || 'Unassigned');
    const active = isFirstUser ? 1 : 0;

    (await dbRun(`
      INSERT INTO T28_Users (T28_User_PK, T28_01_Name, T28_02_Username, T28_03_Password, T28_04_Department, T28_05_Active, T28_06_Status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [pk, name, username, hashed, department, active, status]));

    if (isFirstUser) {
      req.session.user = { pk, name, department, role: null, allowedEntities: null };
      return res.status(201).json({ status: 'Approved', autoLoggedIn: true });
    }
    res.status(201).json({ status: 'Pending', autoLoggedIn: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const user = (await dbGet(`SELECT * FROM T28_Users WHERE T28_02_Username = ?`, [username]));
    if (!user || !user.T28_03_Password || !bcrypt.compareSync(password, user.T28_03_Password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.T28_06_Status === 'Pending') {
      return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
    }
    if (user.T28_06_Status === 'Rejected' || !user.T28_05_Active) {
      return res.status(403).json({ error: 'This account is not active. Contact an admin.' });
    }
    req.session.user = {
      pk: user.T28_User_PK, name: user.T28_01_Name, department: user.T28_04_Department,
      role: user.T28_08_Role || null,
      allowedEntities: user.T28_07_Allowed_Entities ? user.T28_07_Allowed_Entities.split(',').map(s => s.trim()).filter(Boolean) : null,
    };
    res.json(req.session.user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/session', (req, res) => {
  res.json(req.session.user || null);
});

// Departments with unrestricted access to everything.
const FULL_ACCESS_DEPARTMENTS = ['CSR', 'Customer Service'];

// ---- Admin approval workflow ----
function requireFullAccess(req, res, next) {
  const user = req.session.user;
  if (!user || !FULL_ACCESS_DEPARTMENTS.includes(user.department)) {
    return res.status(403).json({ error: 'Only full-access (CSR) accounts can manage user approvals.' });
  }
  next();
}

app.get('/api/auth/pending-users', requireFullAccess, async (req, res) => {
  try {
    const rows = (await dbAll(`SELECT T28_User_PK, T28_01_Name, T28_02_Username, T28_04_Department FROM T28_Users WHERE T28_06_Status = 'Pending'`));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/approve-user/:pk', requireFullAccess, async (req, res) => {
  try {
    const { department, allowedEntities } = req.body; // allowedEntities: array of entity keys, or null/[] for full access
    const entitiesStr = Array.isArray(allowedEntities) && allowedEntities.length ? allowedEntities.join(',') : null;
    const result = (await dbRun(`UPDATE T28_Users SET T28_06_Status = 'Approved', T28_05_Active = 1, T28_04_Department = ?, T28_07_Allowed_Entities = ? WHERE T28_User_PK = ?`, [department || 'Unassigned', entitiesStr, req.params.pk]));
    if (result.changes === 0) return res.status(404).json({ error: 'No user found with that ID.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/reject-user/:pk', requireFullAccess, async (req, res) => {
  try {
    const result = (await dbRun(`UPDATE T28_Users SET T28_06_Status = 'Rejected', T28_05_Active = 0 WHERE T28_User_PK = ?`, [req.params.pk]));
    if (result.changes === 0) return res.status(404).json({ error: 'No user found with that ID.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Restricted departments only get read/write access to these entity keys.
// Anything else (Companies, Contacts, Items, Currencies, Users, etc.) is
// blocked server-side, not just hidden in the UI.
const DEPARTMENT_ENTITY_ACCESS = {
  'Logistics': ['salesOrders', 'purchaseOrders', 'stockRequisitions', 'purchaseRequisitions'],
  'Procurement': ['purchaseOrders', 'poDetails', 'stockRequisitions', 'purchaseRequisitions', 'items', 'categories', 'companies', 'contacts'],
};

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function checkEntityAccess(req, res, next) {
  const user = req.session.user;
  if (!user) return next(); // requireAuth (mounted earlier) already handles the no-session case
  if (FULL_ACCESS_DEPARTMENTS.includes(user.department)) return next();
  // Per-user allowed entities (set by the admin at approval time) take
  // priority over the department default, since that's the whole point of
  // letting an admin fine-tune exactly one person's access.
  const allowed = (user.allowedEntities && user.allowedEntities.length) ? user.allowedEntities : DEPARTMENT_ENTITY_ACCESS[user.department];
  if (!allowed) return next(); // unrecognized department and no custom list -> don't block (fail open, not silently locked out)
  // Custom routes use kebab-case (sales-orders), entity keys use camelCase
  // (salesOrders) — normalize before comparing so both match correctly.
  const rawEntity = req.params.entity;
  const entity = rawEntity ? rawEntity.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : rawEntity;
  if (entity && !allowed.includes(entity)) {
    return res.status(403).json({ error: `Your account does not have access to ${entity}.` });
  }
  next();
}

// Everything under /api requires a logged-in session, EXCEPT the auth
// endpoints themselves (login-users/login/logout/session), which must stay
// public so the login screen itself can function. Also allows creating the
// very first user on a fresh install with no users yet (otherwise nobody
// could ever log in to create one).
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/users' && req.method === 'POST') {
    const count = (await dbGet(`SELECT COUNT(*) c FROM T28_Users`)).c;
    if (count === 0) return next();
  }
  requireAuth(req, res, next);
});
app.use('/api/:entity', checkEntityAccess);

// ---------------------------------------------------------------------
// Live update broadcasting. Whenever anyone saves/deletes something, every
// other connected client (on this machine or another one on the network)
// gets pushed a lightweight "something changed" message over WebSocket, so
// their screen can refresh instead of showing stale data until they reload.
// This is what makes multiple installs pointed at the same host feel like
// one shared, live system rather than separate disconnected copies.
// ---------------------------------------------------------------------
let wsBroadcast = () => {}; // replaced once the WebSocket server is attached, below
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.path.startsWith('/api/') && !req.path.startsWith('/api/auth/')) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        wsBroadcast({ type: 'data-changed', path: req.path, method: req.method });
      }
    });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Uploaded images live next to this script. Note: on Render's free tier
// (ephemeral disk), uploaded files will NOT survive a redeploy — only the
// database itself is persisted now (via Turso). If uploads need to survive
// redeploys too, they'd need to move to something like S3/Cloudinary/Tigris.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|gif|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
  },
});

app.post('/api/upload-image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filename: req.file.filename, url: `/uploads/${req.file.filename}` });
  });
});

function genGuid() {
  return `{${crypto.randomUUID().toUpperCase()}}`;
}

// Generates sequential document numbers like INT2600182 (prefix + 2-digit
// year + 5-digit sequence) or SRF166 (prefix + plain sequence, no year).
// Atomically increments a per-doc-type counter so numbers never repeat.
async function getNextDocNumber(prefix, { includeYear = true, digits = 5 } = {}) {
  const row = (await dbGet(`SELECT next_number FROM T29_DocCounters WHERE doc_type = ?`, [prefix]));
  const next = row ? row.next_number : 1;
  if (row) {
    (await dbRun(`UPDATE T29_DocCounters SET next_number = ? WHERE doc_type = ?`, [next + 1, prefix]));
  } else {
    (await dbRun(`INSERT INTO T29_DocCounters (doc_type, next_number) VALUES (?, ?)`, [prefix, next + 1]));
  }
  const yearPart = includeYear ? String(new Date().getFullYear()).slice(-2) : '';
  const seqPart = digits > 0 ? String(next).padStart(digits, '0') : String(next);
  return `${prefix}${yearPart}${seqPart}`;
}

function getEntity(key) {
  const ent = ENTITIES[key];
  if (!ent) return null;
  return ent;
}

// Schema info for frontend (with FK options resolved live)
app.get('/api/schema', (req, res) => {
  res.json({ entities: ENTITIES, navGroups: NAV_GROUPS });
});

// List rows for an entity, with FK display values joined in
app.get('/api/:entity', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  try {
    const where = ent.filter ? ` WHERE "${ent.filter.field}" = ?` : '';
    const params = ent.filter ? [ent.filter.value] : [];
    const rows = (await dbAll(`SELECT * FROM "${ent.table}"${where}`, [...params]));
    // attach resolved FK display labels
    const enriched = await Promise.all(rows.map(async row => {
      const out = { ...row };
      for (const f of ent.fields) {
        if (f.fk && row[f.name]) {
          const fkEnt = ENTITIES[f.fk.table];
          if (fkEnt) {
            const fkRow = (await dbGet(`SELECT * FROM "${fkEnt.table}" WHERE "${fkEnt.pk}" = ?`, [row[f.name]]));
            out[`__${f.name}_label`] = fkRow ? fkRow[f.fk.display] : row[f.name];
          }
        }
      }
      return out;
    }));
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get FK dropdown options for a given entity (id + display label)
// ?flag=customer|supplier filters contacts by their company's Customer/Supplier flag,
// matching the original app's Q72_Lookup_Customer_from_Contact / Q73_Lookup_Supplier_from_Contact logic.
app.get('/api/:entity/options', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  try {
    let rows;
    let labelFn = (r) => r[ent.displayField] || `(no ${ent.displayField})`;
    if (req.params.entity === 'contacts' && (req.query.flag === 'customer' || req.query.flag === 'supplier')) {
      const flagCol = req.query.flag === 'customer' ? 'T01_15_Customer' : 'T01_16_Supplier';
      rows = (await dbAll(`
        SELECT c.*, comp."T01_01_Company_Name" as __companyName FROM "T07_Contacts" c
        JOIN "T01_Company" comp ON comp."T01_PK" = c."T01_PK"
        WHERE comp."${flagCol}" = 1 AND c."T07_11_Obsolete" = 0 AND comp."T01_14_Obsolete" = 0
      `));
      // Show the Company Name (not the individual contact's name) — that's who
      // you're actually doing business with on a Sales/Purchase Order.
      labelFn = (r) => r.__companyName || r[ent.displayField] || '(no company)';
    } else if (req.params.entity === 'contacts') {
      // Any other contact picker (e.g. Ship To) — still show Company Name
      // first, falling back to the contact's own name if they have no company.
      rows = (await dbAll(`
        SELECT c.*, comp."T01_01_Company_Name" as __companyName FROM "T07_Contacts" c
        LEFT JOIN "T01_Company" comp ON comp."T01_PK" = c."T01_PK"
      `));
      labelFn = (r) => r.__companyName || [r.T07_01_Forename, r.T07_02_Surname].filter(Boolean).join(' ') || '(no name)';
    } else {
      rows = (await dbAll(`SELECT * FROM "${ent.table}"`));
    }
    const options = rows.map(r => ({
      id: ent.pk ? r[ent.pk] : r._rowid,
      label: labelFn(r),
    }));
    res.json(options);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single row
app.get('/api/:entity/:id', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  const pkCol = ent.pk || '_rowid';
  const filterClause = ent.filter ? ` AND "${ent.filter.field}" = ?` : '';
  const filterParams = ent.filter ? [ent.filter.value] : [];
  const row = (await dbGet(`SELECT * FROM "${ent.table}" WHERE "${pkCol}" = ?${filterClause}`, [req.params.id, ...filterParams]));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Create
app.post('/api/:entity', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  try {
    const body = req.body;
    // If this entity is a filtered "view" of a shared table (e.g. Stock
    // Requisitions / Purchase Requisitions both live in T27_Requisition),
    // silently stamp the filter value so it lands in the right bucket
    // without the user ever having to see or pick a "Type" field.
    if (ent.filter) body[ent.filter.field] = ent.filter.value;

    // Items are identified by Part Number now — enforce uniqueness with a
    // clear error instead of letting a raw constraint failure surface.
    if (req.params.entity === 'items' && body.T11_01_Part_Number) {
      const existing = (await dbGet(`SELECT 1 FROM "T11_Item_Master" WHERE "T11_01_Part_Number" = ?`, [body.T11_01_Part_Number]));
      if (existing) return res.status(400).json({ error: `Part Number "${body.T11_01_Part_Number}" already exists. Part Number must be unique.` });
    }

    // Auto-assign a sequential SRF number (e.g. SRF166) on new requisitions
    // (both Stock and Purchase share the same SRF sequence).
    if ((req.params.entity === 'stockRequisitions' || req.params.entity === 'purchaseRequisitions') && !body.T27_09_SRF_Number) {
      body.T27_09_SRF_Number = await getNextDocNumber('SRF', { includeYear: false, digits: 0 });
    }

    // Hash the password before storing it — never save plain text.
    if (req.params.entity === 'users' && body.T28_03_Password) {
      body.T28_03_Password = bcrypt.hashSync(body.T28_03_Password, 10);
    }
    if (req.params.entity === 'users' && body.T28_02_Username) {
      const existingUser = (await dbGet(`SELECT 1 FROM T28_Users WHERE T28_02_Username = ?`, [body.T28_02_Username]));
      if (existingUser) return res.status(400).json({ error: `Username "${body.T28_02_Username}" is already taken.` });
    }

    const cols = [];
    const vals = [];
    if (ent.pk && ent.pkType === 'text') {
      cols.push(ent.pk);
      vals.push(genGuid());
    }
    for (const f of ent.fields) {
      cols.push(f.name);
      let v = body[f.name];
      if (v === '' || v === undefined) v = null;
      if (f.type === 'bool') v = v ? 1 : 0;
      vals.push(v);
    }
    // If the filter field isn't already one of the entity's own editable
    // fields (it usually isn't — it's hidden from the form), add it explicitly.
    if (ent.filter && !ent.fields.some(f => f.name === ent.filter.field)) {
      cols.push(ent.filter.field);
      vals.push(ent.filter.value);
    }
    const placeholders = cols.map(() => '?').join(',');
    const insertSql = `INSERT INTO "${ent.table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`;
    const info = await dbRun(insertSql, vals);
    const pkCol = ent.pk || '_rowid';
    const newId = ent.pk && ent.pkType === 'text' ? vals[0] : info.lastInsertRowid;
    const created = (await dbGet(`SELECT * FROM "${ent.table}" WHERE "${pkCol}" = ?`, [newId]));

    // A brand-new Company can't show up in the Sales/Purchase Order "Contact"
    // picker until it has at least one Contact person — that picker joins
    // Contacts to Companies, it doesn't list bare companies. Rather than
    // leave a newly-added company invisible until someone remembers to add
    // a contact separately, auto-create a placeholder one so it's usable
    // immediately. The user can rename/replace it later like any contact.
    if (req.params.entity === 'companies' && (created.T01_15_Customer || created.T01_16_Supplier)) {
      const contactPk = genGuid();
      await dbRun(
        `INSERT INTO "T07_Contacts" ("T07_PK", "T07_01_Forename", "T01_PK", "T07_11_Obsolete") VALUES (?, ?, ?, 0)`,
        [contactPk, 'Main Contact', newId]
      );
    }

    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update
app.put('/api/:entity/:id', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  const pkCol = ent.pk || '_rowid';
  try {
    const body = req.body;

    if (req.params.entity === 'items' && body.T11_01_Part_Number) {
      const existing = (await dbGet(`SELECT 1 FROM "T11_Item_Master" WHERE "T11_01_Part_Number" = ? AND "T11_Item_Master_PK" != ?`, [body.T11_01_Part_Number, req.params.id]));
      if (existing) return res.status(400).json({ error: `Part Number "${body.T11_01_Part_Number}" already exists. Part Number must be unique.` });
    }

    // If someone edits a User and actually types a new password, hash it.
    // If the field comes back untouched (still the existing bcrypt hash,
    // which always starts with "$2"), leave it alone — re-hashing an
    // already-hashed value would silently lock the account out.
    if (req.params.entity === 'users' && body.T28_03_Password && !body.T28_03_Password.startsWith('$2')) {
      body.T28_03_Password = bcrypt.hashSync(body.T28_03_Password, 10);
    }

    const sets = [];
    const vals = [];
    for (const f of ent.fields) {
      // Special case: updating a User without a new password means "keep
      // the existing one" — skip this column entirely rather than nulling
      // it out, which would otherwise lock the account out of ever logging in.
      if (req.params.entity === 'users' && f.name === 'T28_03_Password' && !body.T28_03_Password) {
        continue;
      }
      sets.push(`"${f.name}" = ?`);
      let v = body[f.name];
      if (v === '' || v === undefined) v = null;
      if (f.type === 'bool') v = v ? 1 : 0;
      vals.push(v);
    }
    vals.push(req.params.id);
    const filterClause = ent.filter ? ` AND "${ent.filter.field}" = ?` : '';
    if (ent.filter) vals.push(ent.filter.value);
    (await dbRun(`UPDATE "${ent.table}" SET ${sets.join(', ')} WHERE "${pkCol}" = ?${filterClause}`, [...vals]));
    const updated = (await dbGet(`SELECT * FROM "${ent.table}" WHERE "${pkCol}" = ?`, [req.params.id]));

    // Same reasoning as the create path: if Customer/Supplier just got
    // switched on for a company that has no contact yet, give it one now
    // so it's immediately usable in Sales/Purchase Order pickers.
    if (req.params.entity === 'companies' && (updated.T01_15_Customer || updated.T01_16_Supplier)) {
      const hasContact = (await dbGet(`SELECT 1 FROM "T07_Contacts" WHERE "T01_PK" = ? AND "T07_11_Obsolete" = 0`, [req.params.id]));
      if (!hasContact) {
        const contactPk = genGuid();
        await dbRun(
          `INSERT INTO "T07_Contacts" ("T07_PK", "T07_01_Forename", "T01_PK", "T07_11_Obsolete") VALUES (?, ?, ?, 0)`,
          [contactPk, 'Main Contact', req.params.id]
        );
      }
    }

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete
app.delete('/api/:entity/:id', async (req, res) => {
  const ent = getEntity(req.params.entity);
  if (!ent) return res.status(404).json({ error: 'Unknown entity' });
  const pkCol = ent.pk || '_rowid';
  try {
    const filterClause = ent.filter ? ` AND "${ent.filter.field}" = ?` : '';
    const filterParams = ent.filter ? [ent.filter.value] : [];
    (await dbRun(`DELETE FROM "${ent.table}" WHERE "${pkCol}" = ?${filterClause}`, [req.params.id, ...filterParams]));
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Item Master detail bundle — powers the tabbed Item Master screen
// (Costing / Specifications / Activity / Stock Levels / Stocktake /
// All Sales-Quotes-Purchases / Documents), mirroring the original
// Access form's subforms.
// ---------------------------------------------------------------------
app.get('/api/items/:id/full', async (req, res) => {
  const id = req.params.id;
  try {
    const item = (await dbGet(`SELECT * FROM "T11_Item_Master" WHERE "T11_Item_Master_PK" = ?`, [id]));
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const category = item.T12_Category_PK
      ? (await dbGet(`SELECT * FROM "T12_Category" WHERE "T12_Category_PK" = ?`, [item.T12_Category_PK]))
      : null;

    // Specifications: Param1..20 / Value1..20 pairs, only non-empty
    const specs = [];
    for (let i = 1; i <= 20; i++) {
      const paramKey = `T11_${13 + (i - 1) * 2}_Param${i}`;
      const valueKey = `T11_${14 + (i - 1) * 2}_Value${i}`;
      const paramVal = item[paramKey];
      const valueVal = item[valueKey];
      if (paramVal || valueVal) specs.push({ param: paramVal || '', value: valueVal || '' });
    }

    // All Sales Order lines containing this item (joined to SO header + customer)
    const soLines = (await dbAll(`
      SELECT sd."T15_01_Quantity" AS qty, sd."T15_02_Price" AS price,
             so."T14_SO_PK" AS soPk, so."T14_01_SO_Number" AS soNumber,
             so."T14_03_Quote_Date" AS quoteDate, so."T14_04_Sale_Date" AS saleDate,
             so."T14_05_Despatch_Date" AS despatchDate, so."T14_14_Despatch_Due_Date" AS despatchDueDate,
             c."T01_01_Company_Name" AS customerName
      FROM "T15_SO_Details" sd
      JOIN "T14_Sales_Orders" so ON so."T14_SO_PK" = sd."T14_SO_PK"
      LEFT JOIN "T07_Contacts" ct ON ct."T07_PK" = so."T07_PK"
      LEFT JOIN "T01_Company" c ON c."T01_PK" = ct."T01_PK"
      WHERE sd."T11_Item_Master_PK" = ?
      ORDER BY so."T14_01_SO_Number" DESC
    `, [id]));

    // All Purchase Order lines containing this item (joined to PO header + supplier)
    const poLines = (await dbAll(`
      SELECT pd."T18_01_Quantity" AS qty, pd."T18_02_Price" AS price,
             po."T17_PO_PK" AS poPk, po."T17_01_PO_Number" AS poNumber,
             po."T17_02_PO_Date" AS poDate, po."T17_03_Received_Date" AS receivedDate,
             po."T17_04_Due_Date" AS dueDate,
             c."T01_01_Company_Name" AS supplierName
      FROM "T18_PO_Details" pd
      JOIN "T17_Purchase_Orders" po ON po."T17_PO_PK" = pd."T17_PO_PK"
      LEFT JOIN "T07_Contacts" ct ON ct."T07_PK" = po."T07_PK"
      LEFT JOIN "T01_Company" c ON c."T01_PK" = ct."T01_PK"
      WHERE pd."T11_Item_Master_PK" = ?
      ORDER BY po."T17_01_PO_Number" DESC
    `, [id]));

    const today = new Date().toISOString().slice(0, 10);

    // Activity tab: outstanding (not yet fulfilled) SO/PO lines
    const salesActivity = soLines.filter(l => !l.despatchDate);
    const poDue = poLines.filter(l => !l.receivedDate && l.dueDate && l.dueDate >= today);
    const poOverdue = poLines.filter(l => !l.receivedDate && l.dueDate && l.dueDate < today);

    // Stock Levels tab: qty inbound (on outstanding POs) vs qty outbound (on outstanding SOs)
    const qtyOnOrder = poLines.filter(l => !l.receivedDate).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const qtyAllocated = soLines.filter(l => !l.despatchDate).reduce((s, l) => s + (Number(l.qty) || 0), 0);

    // Stocktake tab: raw stock movement history
    const stockHistory = (await dbAll(`
      SELECT "T23_Stock_ID" AS id, "T23_01_Date" AS date, "T23_02_Quantity" AS qty
      FROM "T23_Stock" WHERE "T11_Item_Master_PK" = ? ORDER BY "T23_01_Date" DESC
    `, [id]));
    const latestStockTake = stockHistory[0] || null;

    // Serial numbers tied to this item
    const serialNumbers = (await dbAll(`
      SELECT "T24_Serial_PK" AS id, "T24_01_Date" AS date, "T24_02_Notes" AS notes
      FROM "T24_Serial_Numbers" WHERE "T11_Item_Master_PK" = ? ORDER BY "T24_01_Date" DESC
    `, [id]));

    // Documents tab: joined through T19_Item_Doc_Join
    const documents = (await dbAll(`
      SELECT d."T10_Document_PK" AS id, d."T10_01_Document_Number" AS docNumber,
             d."T10_02_Alt_Ref_Number" AS altRef, d."T10_03_Short_Description" AS shortDesc,
             d."T10_04_Long Description" AS longDesc, d."T10_06_Obsolete" AS obsolete,
             dir."T09_02_Directory_Description" AS directory
      FROM "T19_Item_Doc_Join" j
      JOIN "T10_Documents" d ON d."T10_Document_PK" = j."T10_Document_PK"
      LEFT JOIN "T09_Directory" dir ON dir."T09_Directory_PK" = d."T09_Directory_PK"
      WHERE j."T11_Item_Master_PK" = ?
    `, [id]));

    res.json({
      item, category, specs,
      allSales: soLines, allPurchases: poLines,
      activity: { salesActivity, poDue, poOverdue },
      stockLevels: { qtyOnHand: item.T11_06_Qty_OH, qtyOnOrder, qtyAllocated, reorderQty: item.T11_54_ReOrderQty },
      stocktake: { history: stockHistory, latest: latestStockTake },
      serialNumbers,
      documents,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Sales Order full screen — header + Bill/Ship contact info + line items
// ---------------------------------------------------------------------
async function contactSummary(pk) {
  if (!pk) return null;
  const c = (await dbGet(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`, [pk]));
  if (!c) return null;
  const company = c.T01_PK ? (await dbGet(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`, [c.T01_PK])) : null;
  return {
    pk: c.T07_PK,
    name: [c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '),
    phone: c.T07_03_Phone || '',
    fax: c.T07_04_Fax_Number || '',
    companyName: company ? company.T01_01_Company_Name : '',
    companyPk: c.T01_PK,
  };
}

app.get('/api/sales-orders/:id/full', async (req, res) => {
  const id = req.params.id;
  try {
    if (id === 'new') {
      return res.json({ so: {}, billTo: null, shipTo: null, lines: [], fulfillment: {} });
    }
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [id]));
    if (!so) return res.status(404).json({ error: 'Not found' });
    const lines = (await dbAll(`
      SELECT sd.rowid as lineId, sd.*, i."T11_01_Part_Number" as partNumber,
             COALESCE(sd."T15_06_Description_Override", i."T11_03_Short_Description") as description,
             COALESCE(sd."T15_03_Retail", i."T11_09_List_Price") as retail,
             COALESCE(sd."T15_04_Trade", i."T11_10_Trade_Price") as trade,
             COALESCE(sd."T15_05_OEM", i."T11_11_OEM_Price") as oem
      FROM "T15_SO_Details" sd LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = sd."T11_Item_Master_PK"
      WHERE sd."T14_SO_PK" = ?
    `, [id]));
    const fulfillment = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [id])) || {};
    res.json({
      so,
      billTo: await contactSummary(so.T07_PK),
      shipTo: await contactSummary(so.T07_PK_SHIPTO),
      lines,
      fulfillment,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save header + replace all line items in one call
app.post('/api/sales-orders/full', (req, res) => { saveSalesOrderFull(req, res, null); });
app.put('/api/sales-orders/:id/full', (req, res) => { saveSalesOrderFull(req, res, req.params.id); });

async function saveSalesOrderFull(req, res, existingId) {
  try {
    const { so, lines, fulfillment } = req.body;
    const soFields = ENTITIES.salesOrders.fields.map(f => f.name);
    let soPk = existingId;
    if (!soPk) {
      soPk = genGuid();
      const maxRow = (await dbGet(`SELECT MAX("T14_01_SO_Number") AS m FROM "T14_Sales_Orders"`));
      so['T14_01_SO_Number'] = (maxRow.m || 0) + 1;
      const cols = ['T14_SO_PK', ...soFields];
      const vals = [soPk, ...soFields.map(f => (so[f] === '' || so[f] === undefined) ? null : so[f])];
      (await dbRun(`INSERT INTO "T14_Sales_Orders" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [...vals]));
    } else {
      const updateFields = soFields.filter(f => f !== 'T14_01_SO_Number');
      const sets = updateFields.map(f => `"${f}" = ?`).join(', ');
      const vals = updateFields.map(f => (so[f] === '' || so[f] === undefined) ? null : so[f]);
      (await dbRun(`UPDATE "T14_Sales_Orders" SET ${sets} WHERE "T14_SO_PK" = ?`, [...vals, soPk]));
    }
    (await dbRun(`DELETE FROM "T15_SO_Details" WHERE "T14_SO_PK" = ?`, [soPk]));
    for (const l of (lines || [])) {
      if (!l.T11_Item_Master_PK) continue;
      (await dbRun(`INSERT INTO "T15_SO_Details" ("T14_SO_PK","T11_Item_Master_PK","T15_01_Quantity","T15_02_Price","T15_03_Retail","T15_04_Trade","T15_05_OEM","T15_06_Description_Override") VALUES (?,?,?,?,?,?,?,?)`, [soPk, l.T11_Item_Master_PK, Number(l.T15_01_Quantity) || 0, Number(l.T15_02_Price) || 0,
          l.retail === '' || l.retail === undefined || l.retail === null ? null : Number(l.retail),
          l.trade === '' || l.trade === undefined || l.trade === null ? null : Number(l.trade),
          l.oem === '' || l.oem === undefined || l.oem === null ? null : Number(l.oem),
          l.description === '' || l.description === undefined ? null : l.description]));
    }
    if (fulfillment) {
      const fFields = ENTITIES.soFulfillment.fields.map(f => f.name);
      const boolFields = new Set(ENTITIES.soFulfillment.fields.filter(f => f.type === 'bool').map(f => f.name));
      const vals = fFields.map(f => {
        let v = fulfillment[f];
        if (v === '' || v === undefined) v = null;
        if (boolFields.has(f)) v = v ? 1 : 0;
        return v;
      });
      (await dbRun(`
        INSERT INTO "T25_SO_Fulfillment" ("T14_SO_PK", ${fFields.map(f => `"${f}"`).join(',')})
        VALUES (?, ${fFields.map(() => '?').join(',')})
        ON CONFLICT("T14_SO_PK") DO UPDATE SET ${fFields.map(f => `"${f}" = excluded."${f}"`).join(', ')}
      `, [soPk, ...vals]));
    }
    const updated = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [soPk]));
    res.status(existingId ? 200 : 201).json({ so: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------
// Purchase Order full screen — header + Supplier info + line items
// ---------------------------------------------------------------------
app.get('/api/purchase-orders/:id/full', async (req, res) => {
  const id = req.params.id;
  try {
    if (id === 'new') {
      return res.json({ po: {}, supplier: null, lines: [] });
    }
    const po = (await dbGet(`SELECT * FROM "T17_Purchase_Orders" WHERE "T17_PO_PK" = ?`, [id]));
    if (!po) return res.status(404).json({ error: 'Not found' });
    const lines = (await dbAll(`
      SELECT pd.rowid as lineId, pd.*, i."T11_01_Part_Number" as partNumber,
             COALESCE(pd."T18_04_Description_Override", i."T11_03_Short_Description") as description,
             COALESCE(pd."T18_03_Cost", i."T11_53_COST") as cost
      FROM "T18_PO_Details" pd LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = pd."T11_Item_Master_PK"
      WHERE pd."T17_PO_PK" = ?
    `, [id]));
    res.json({ po, supplier: await contactSummary(po.T07_PK), lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/purchase-orders/full', (req, res) => { savePurchaseOrderFull(req, res, null); });
app.put('/api/purchase-orders/:id/full', (req, res) => { savePurchaseOrderFull(req, res, req.params.id); });

async function savePurchaseOrderFull(req, res, existingId) {
  try {
    const { po, lines } = req.body;
    const poFields = ENTITIES.purchaseOrders.fields.map(f => f.name);
    let poPk = existingId;
    if (!poPk) {
      poPk = genGuid();
      const maxRow = (await dbGet(`SELECT MAX("T17_01_PO_Number") AS m FROM "T17_Purchase_Orders"`));
      po['T17_01_PO_Number'] = (maxRow.m || 0) + 1;
      const cols = ['T17_PO_PK', ...poFields];
      const vals = [poPk, ...poFields.map(f => (po[f] === '' || po[f] === undefined) ? null : po[f])];
      (await dbRun(`INSERT INTO "T17_Purchase_Orders" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [...vals]));
    } else {
      const updateFields = poFields.filter(f => f !== 'T17_01_PO_Number');
      const sets = updateFields.map(f => `"${f}" = ?`).join(', ');
      const vals = updateFields.map(f => (po[f] === '' || po[f] === undefined) ? null : po[f]);
      (await dbRun(`UPDATE "T17_Purchase_Orders" SET ${sets} WHERE "T17_PO_PK" = ?`, [...vals, poPk]));
    }
    (await dbRun(`DELETE FROM "T18_PO_Details" WHERE "T17_PO_PK" = ?`, [poPk]));
    for (const l of (lines || [])) {
      if (!l.T11_Item_Master_PK) continue;
      (await dbRun(`INSERT INTO "T18_PO_Details" ("T17_PO_PK","T11_Item_Master_PK","T18_01_Quantity","T18_02_Price","T18_03_Cost","T18_04_Description_Override") VALUES (?,?,?,?,?,?)`, [poPk, l.T11_Item_Master_PK, Number(l.T18_01_Quantity) || 0, Number(l.T18_02_Price) || 0,
          l.cost === '' || l.cost === undefined || l.cost === null ? null : Number(l.cost),
          l.description === '' || l.description === undefined ? null : l.description]));
    }
    const updated = (await dbGet(`SELECT * FROM "T17_Purchase_Orders" WHERE "T17_PO_PK" = ?`, [poPk]));
    res.status(existingId ? 200 : 201).json({ po: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// ---------------------------------------------------------------------
// Company full screen — header + City/State/Postcode + Contacts /
// Sales Activity / All Purchases tabs
// ---------------------------------------------------------------------
app.get('/api/companies/:id/full', async (req, res) => {
  const id = req.params.id;
  try {
    if (id === 'new') return res.json({ company: {}, city: null, contacts: [], salesActivity: [], allPurchases: [], projects: [] });
    const company = (await dbGet(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`, [id]));
    if (!company) return res.status(404).json({ error: 'Not found' });
    const city = company.T02_City_PK ? (await dbGet(`SELECT * FROM "T02_CityStatePCode" WHERE "T02_City_PK" = ?`, [company.T02_City_PK])) : null;

    const contacts = (await dbAll(`SELECT * FROM "T07_Contacts" WHERE "T01_PK" = ?`, [id]));

    // Sales Activity: all SO line items for sales orders whose contact belongs to this company
    const salesActivity = (await dbAll(`
      SELECT so."T14_01_SO_Number" as soNo, so."T14_03_Quote_Date" as quoteDate, so."T14_04_Sale_Date" as saleDate,
             sd."T15_01_Quantity" as qty, i."T11_02_Alt_Part_Number" as altPartNumber, i."T11_03_Short_Description" as description
      FROM "T15_SO_Details" sd
      JOIN "T14_Sales_Orders" so ON so."T14_SO_PK" = sd."T14_SO_PK"
      JOIN "T07_Contacts" ct ON ct."T07_PK" = so."T07_PK"
      LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = sd."T11_Item_Master_PK"
      WHERE ct."T01_PK" = ?
      ORDER BY so."T14_01_SO_Number" DESC
    `, [id]));

    // All Purchases: all PO line items for purchase orders whose contact (supplier) belongs to this company
    const allPurchases = (await dbAll(`
      SELECT po."T17_01_PO_Number" as poNo, po."T17_02_PO_Date" as poDate, po."T17_03_Received_Date" as receivedDate,
             pd."T18_01_Quantity" as qty, i."T11_02_Alt_Part_Number" as altPartNumber, i."T11_03_Short_Description" as description
      FROM "T18_PO_Details" pd
      JOIN "T17_Purchase_Orders" po ON po."T17_PO_PK" = pd."T17_PO_PK"
      JOIN "T07_Contacts" ct ON ct."T07_PK" = po."T07_PK"
      LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = pd."T11_Item_Master_PK"
      WHERE ct."T01_PK" = ?
      ORDER BY po."T17_01_PO_Number" DESC
    `, [id]));

    // Projects linked directly to this company/customer
    const projects = (await dbAll(`
      SELECT "T21_Project_ID" as id, "T21_02_Project_Code" as code, "T21_03_Project_Name" as name, "T21_01_Project_Notes" as notes
      FROM "T21_Projects" WHERE "T01_PK" = ? ORDER BY "T21_02_Project_Code"
    `, [id]));

    res.json({ company, city, contacts, salesActivity, allPurchases, projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Forecast vs Actual — basic variance report (Forecast Monitoring, step 6
// of the Forecast Planning Process). Compares forecast qty per item/quarter
// against actual quantities sold in Sales Order lines within that quarter.
// Also exposed as raw JSON for any future in-app use.
// ---------------------------------------------------------------------
async function computeForecastVariance(db) {
  const forecasts = (await dbAll(`
    SELECT f.*, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemDesc,
           c."T01_01_Company_Name" as customerName
    FROM "T26_Forecast" f
    LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = f."T11_Item_Master_PK"
    LEFT JOIN "T01_Company" c ON c."T01_PK" = f."T01_PK"
    ORDER BY f."T26_04_Quarter" DESC, i."T11_01_Part_Number"
  `));

  const quarterBounds = (q) => {
    const m = /^(\d{4})-Q([1-4])$/i.exec(String(q || '').trim());
    if (!m) return [null, null];
    const year = m[1];
    const qn = Number(m[2]);
    const startMonth = String((qn - 1) * 3 + 1).padStart(2, '0');
    const endMonth = String(qn * 3).padStart(2, '0');
    const lastDay = new Date(Number(year), qn * 3, 0).getDate();
    return [`${year}-${startMonth}-01`, `${year}-${endMonth}-${String(lastDay).padStart(2, '0')}`];
  };

  return Promise.all(forecasts.map(async (f) => {
    const [start, end] = quarterBounds(f.T26_04_Quarter);
    let actualQty = 0;
    if (start && end) {
      const actual = (await dbGet(`
        SELECT COALESCE(SUM(sd."T15_01_Quantity"), 0) as qty
        FROM "T15_SO_Details" sd
        JOIN "T14_Sales_Orders" so ON so."T14_SO_PK" = sd."T14_SO_PK"
        WHERE sd."T11_Item_Master_PK" = ?
          AND so."T14_04_Sale_Date" >= ? AND so."T14_04_Sale_Date" <= ?
      `, [f.T11_Item_Master_PK, start, end]));
      actualQty = actual.qty || 0;
    }
    const forecastQty = Number(f.T26_01_Forecast_Quantity) || 0;
    const variance = actualQty - forecastQty;
    const variancePct = forecastQty ? (variance / forecastQty) * 100 : null;
    return {
      forecastId: f.T26_Forecast_ID, quarter: f.T26_04_Quarter,
      partNumber: f.partNumber, itemDesc: f.itemDesc, customerName: f.customerName,
      deliveryMonth: f.T26_02_Delivery_Month, forecastQty, actualQty, variance, variancePct,
      remarks: f.T26_03_Remarks,
    };
  }));
}

app.get('/api/forecast-variance', async (req, res) => {
  try {
    res.json(await computeForecastVariance(db));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// RMA (Return Merchandise Authorization) — generated from a Delivery Note
// when a customer reports a faulty unit. Looks up the serial number's
// warranty end date and auto-determines whether the unit is still covered.
// ---------------------------------------------------------------------
app.get('/api/sales-orders/:id/serials', async (req, res) => {
  try {
    const serials = (await dbAll(`
      SELECT s.*, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemDesc
      FROM "T24_Serial_Numbers" s LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = s."T11_Item_Master_PK"
      WHERE s."T14_SO_PK" = ?
    `, [req.params.id]));
    res.json(serials);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rma', async (req, res) => {
  try {
    const { T14_SO_PK, T24_Serial_PK, T11_Item_Master_PK, T30_02_Reason, T30_03_Date_Requested, T30_07_Notes } = req.body;
    if (!T14_SO_PK || !T11_Item_Master_PK) return res.status(400).json({ error: 'Sales Order and Item are required' });

    // Compare today's date against the serial's warranty end date, if we have one.
    let underWarranty = null;
    if (T24_Serial_PK) {
      const serial = (await dbGet(`SELECT * FROM "T24_Serial_Numbers" WHERE "T24_Serial_PK" = ?`, [T24_Serial_PK]));
      if (serial && serial.T24_05_Warranty_End) {
        const today = new Date().toISOString().slice(0, 10);
        underWarranty = serial.T24_05_Warranty_End >= today ? 1 : 0;
      }
    }

    const rmaNumber = await getNextDocNumber("RMA");
    const pk = genGuid();
    (await dbRun(`
      INSERT INTO T30_RMA (T30_RMA_PK, T30_01_RMA_Number, T14_SO_PK, T24_Serial_PK, T11_Item_Master_PK, T30_02_Reason, T30_03_Date_Requested, T30_04_Under_Warranty, T30_05_Status, T30_07_Notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?)
    `, [pk, rmaNumber, T14_SO_PK, T24_Serial_PK || null, T11_Item_Master_PK, T30_02_Reason || null, T30_03_Date_Requested || null, underWarranty, T30_07_Notes || null]));

    const created = (await dbGet(`SELECT * FROM T30_RMA WHERE T30_RMA_PK = ?`, [pk]));
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/rma', async (req, res) => {
  try {
    const rows = (await dbAll(`
      SELECT r.*, so."T14_01_SO_Number" as soNumber, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemDesc, s."T24_03_Serial_Number" as serialNumber
      FROM T30_RMA r
      LEFT JOIN T14_Sales_Orders so ON so."T14_SO_PK" = r."T14_SO_PK"
      LEFT JOIN T11_Item_Master i ON i."T11_Item_Master_PK" = r."T11_Item_Master_PK"
      LEFT JOIN T24_Serial_Numbers s ON s."T24_Serial_PK" = r."T24_Serial_PK"
      ORDER BY r."T30_01_RMA_Number" DESC
    `));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/rma/:id', async (req, res) => {
  try {
    const { T30_05_Status, T30_06_Resolution, T30_07_Notes } = req.body;
    (await dbRun(`UPDATE T30_RMA SET T30_05_Status = ?, T30_06_Resolution = ?, T30_07_Notes = ? WHERE T30_RMA_PK = ?`, [T30_05_Status || null, T30_06_Resolution || null, T30_07_Notes || null, req.params.id]));
    const updated = (await dbGet(`SELECT * FROM T30_RMA WHERE T30_RMA_PK = ?`, [req.params.id]));
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Requisition approval workflow: Requester creates it → Reviewer reviews →
// Manager approves → Logistics generates Commercial Invoice / Packing
// List / Delivery Note against the now-approved requisition (with the SRF
// number carried through onto all three documents).
//
// Role checks here are enforced server-side (not just hidden in the UI) —
// full-access (CSR) accounts can always act on any step, as a practical
// override in case a role isn't correctly assigned yet.
// ---------------------------------------------------------------------
function userHasRole(user, role) {
  if (!user) return false;
  if (FULL_ACCESS_DEPARTMENTS.includes(user.department)) return true;
  return user.role === role;
}

app.post('/api/requisitions/:id/review', async (req, res) => {
  const user = req.session.user;
  if (!userHasRole(user, 'Reviewer')) return res.status(403).json({ error: 'Only a Reviewer (or full-access account) can review requisitions.' });
  try {
    const { decision, notes } = req.body; // decision: 'Reviewed' or 'Rejected'
    if (!['Reviewed', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be "Reviewed" or "Rejected"' });
    const req_ = (await dbGet(`SELECT T27_06_Status FROM T27_Requisition WHERE T27_Requisition_ID = ?`, [req.params.id]));
    if (!req_) return res.status(404).json({ error: 'Requisition not found' });
    if (req_.T27_06_Status && req_.T27_06_Status !== 'Requested') {
      return res.status(400).json({ error: `This requisition is already past the review stage (current status: ${req_.T27_06_Status}).` });
    }
    (await dbRun(`UPDATE T27_Requisition SET T27_06_Status = ?, T27_10_Reviewed_By = ?, T27_11_Reviewed_Date = ?, T27_08_Notes = COALESCE(?, T27_08_Notes) WHERE T27_Requisition_ID = ?`, [decision, user.name, new Date().toISOString().slice(0, 10), notes || null, req.params.id]));
    res.json({ ok: true, status: decision });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/requisitions/:id/approve', async (req, res) => {
  const user = req.session.user;
  if (!userHasRole(user, 'Manager')) return res.status(403).json({ error: 'Only a Manager (or full-access account) can approve requisitions.' });
  try {
    const { decision, notes } = req.body; // decision: 'Approved' or 'Rejected'
    if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be "Approved" or "Rejected"' });
    const req_ = (await dbGet(`SELECT T27_06_Status FROM T27_Requisition WHERE T27_Requisition_ID = ?`, [req.params.id]));
    if (!req_) return res.status(404).json({ error: 'Requisition not found' });
    if (req_.T27_06_Status !== 'Reviewed') {
      return res.status(400).json({ error: `This requisition must be Reviewed before it can be approved (current status: ${req_.T27_06_Status || 'Requested'}).` });
    }
    (await dbRun(`UPDATE T27_Requisition SET T27_06_Status = ?, T27_12_Approved_By = ?, T27_13_Approved_Date = ?, T27_08_Notes = COALESCE(?, T27_08_Notes) WHERE T27_Requisition_ID = ?`, [decision, user.name, new Date().toISOString().slice(0, 10), notes || null, req.params.id]));
    res.json({ ok: true, status: decision });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Full detail bundle for the requisition screen — includes the linked
// Sales Order's line items (all of them, matching the real SRF form) and
// the requester/reviewer/approver names.
app.get('/api/requisitions/:id/full', async (req, res) => {
  try {
    const reqRow = (await dbGet(`SELECT * FROM T27_Requisition WHERE T27_Requisition_ID = ?`, [req.params.id]));
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    let soLines = [];
    let so = null;
    if (reqRow.T14_SO_PK) {
      so = (await dbGet(`SELECT * FROM T14_Sales_Orders WHERE T14_SO_PK = ?`, [reqRow.T14_SO_PK]));
      soLines = (await dbAll(`
        SELECT d.*, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemName
        FROM T15_SO_Details d LEFT JOIN T11_Item_Master i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
        WHERE d."T14_SO_PK" = ?
      `, [reqRow.T14_SO_PK]));
    }
    res.json({ requisition: reqRow, so, soLines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

registerReportRoutes(app);
registerReports2(app);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // listen on all network interfaces, not just localhost, so other machines on the LAN can reach this as the shared server
const httpServer = http.createServer(app);

const wss = new WebSocketServer({ server: httpServer });
const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});
wsBroadcast = (payload) => {
  const msg = JSON.stringify(payload);
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
};

let listenErrorHandled = false;
function handleListenError(err) {
  if (listenErrorHandled) return;
  listenErrorHandled = true;
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. This usually means a previous Nexora session didn't fully close, or another program is using this port. Close any other Nexora windows/processes and try again — if it keeps happening, a restart of the computer will clear it.`);
  } else {
    console.error(`Server failed to start: ${err.message}`);
  }
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100); // give console.error's output a moment to actually flush before exiting
}
httpServer.on('error', handleListenError);
wss.on('error', handleListenError);

(async () => {
  await runMigrations();

  httpServer.listen(PORT, HOST, () => {
    const actualPort = httpServer.address().port; // resolves the real bound port even when PORT=0 (random)
    ACTUAL_PORT = actualPort;
    const nets = require('os').networkInterfaces();
    const lanAddresses = [];
    for (const iface of Object.values(nets)) {
      for (const addr of iface || []) {
        if (addr.family === 'IPv4' && !addr.internal) lanAddresses.push(addr.address);
      }
    }
    console.log(`Nexora app running at http://localhost:${actualPort}`);
    if (lanAddresses.length) {
      console.log(`On your network, other machines can reach this at: ${lanAddresses.map(a => `http://${a}:${actualPort}`).join(', ')}`);
    }
    if (process.send) process.send({ type: 'ready', port: actualPort });
  });
})().catch(err => {
  console.error('Fatal error during startup (likely a database migration/connection problem):', err);
  process.exit(1);
});
