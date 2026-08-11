/**
 * Emergency password reset — run this directly on the Host computer when
 * nobody can log in through the app (e.g. the only admin account forgot
 * their password, or a new server was just set up and nobody remembers
 * the credentials).
 *
 * Usage (run this in a terminal/command prompt, from this folder):
 *
 *   node reset-password.js <username> <new-password>
 *
 * Example:
 *   node reset-password.js admin MyNewPassword123
 *
 * This only works if you have direct access to the computer that's
 * actually running as the Host — it edits the database file directly, so
 * there's no way to do this remotely, and no way to do it "through" the
 * app itself (that's the point — it's the recovery path for when the app
 * itself is unreachable).
 *
 * If you don't know which file is the real database, check:
 *   Windows Desktop app: %APPDATA%\datahouse-desktop\datahouse.db
 *   Plain web app:       ./datahouse.db (next to server.js)
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.log('Usage: node reset-password.js <username> <new-password>');
  console.log('Example: node reset-password.js admin MyNewPassword123');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const dbPath = process.env.DATAHOUSE_DB_PATH || path.join(__dirname, 'datahouse.db');
console.log(`Using database: ${dbPath}`);

let db;
try {
  db = new DatabaseSync(dbPath);
} catch (e) {
  console.error(`Could not open database at ${dbPath}: ${e.message}`);
  console.error('If your real database is somewhere else, set DATAHOUSE_DB_PATH before running this, e.g.:');
  console.error('  Windows:  set DATAHOUSE_DB_PATH=C:\\Users\\yourname\\AppData\\Roaming\\datahouse-desktop\\datahouse.db && node reset-password.js admin NewPass123');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM T28_Users WHERE T28_02_Username = ?').get(username);
if (!user) {
  const all = db.prepare('SELECT T28_02_Username, T28_01_Name FROM T28_Users').all();
  console.error(`No user found with username "${username}".`);
  if (all.length) {
    console.error('Existing usernames:', all.map(u => u.T28_02_Username).join(', '));
  } else {
    console.error('There are no users in this database at all yet — just open the app and use the sign-up screen instead.');
  }
  process.exit(1);
}

const hashed = bcrypt.hashSync(newPassword, 10);
db.prepare(`
  UPDATE T28_Users
  SET T28_03_Password = ?, T28_05_Active = 1, T28_06_Status = 'Approved'
  WHERE T28_User_PK = ?
`).run(hashed, user.T28_User_PK);

console.log(`Password reset for "${username}" (${user.T28_01_Name}). Account is also confirmed Active and Approved in case that was the problem.`);
console.log('You can now sign in with the new password.');
