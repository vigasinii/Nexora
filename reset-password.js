/**
 * Emergency password reset — run this directly from a machine with network
 * access to your Turso database when nobody can log in through the app
 * (e.g. the only admin account forgot their password, or a new server was
 * just set up and nobody remembers the credentials).
 *
 * Usage:
 *
 *   TURSO_DATABASE_URL=libsql://your-db.turso.io TURSO_AUTH_TOKEN=xxx \
 *     node reset-password.js <username> <new-password>
 *
 * Example:
 *   TURSO_DATABASE_URL=libsql://nexora-vigasinii.turso.io TURSO_AUTH_TOKEN=xxx \
 *     node reset-password.js admin MyNewPassword123
 *
 * (Same env vars you set in Render's dashboard.)
 */
const bcrypt = require('bcryptjs');
const { dbGet, dbAll, dbRun } = require('./db-turso');

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.log('Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node reset-password.js <username> <new-password>');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}
if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL is not set. Set it (and TURSO_AUTH_TOKEN) to the same values you use on Render, then re-run this command.');
  process.exit(1);
}

(async () => {
  try {
    const user = await dbGet('SELECT * FROM T28_Users WHERE T28_02_Username = ?', [username]);
    if (!user) {
      const all = await dbAll('SELECT T28_02_Username, T28_01_Name FROM T28_Users');
      console.error(`No user found with username "${username}".`);
      if (all.length) {
        console.error('Existing usernames:', all.map(u => u.T28_02_Username).join(', '));
      } else {
        console.error('There are no users in this database at all yet — just open the app and use the sign-up screen instead.');
      }
      process.exit(1);
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    await dbRun(`
      UPDATE T28_Users
      SET T28_03_Password = ?, T28_05_Active = 1, T28_06_Status = 'Approved'
      WHERE T28_User_PK = ?
    `, [hashed, user.T28_User_PK]);

    console.log(`Password reset for "${username}" (${user.T28_01_Name}). Account is also confirmed Active and Approved in case that was the problem.`);
    console.log('You can now sign in with the new password.');
  } catch (e) {
    console.error(`Could not reach the database: ${e.message}`);
    console.error('Double check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set correctly.');
    process.exit(1);
  }
})();
