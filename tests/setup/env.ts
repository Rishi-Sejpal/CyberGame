/**
 * Per-worker environment for the test suite.
 *
 * The suite must be hermetic: no developer `.env.local`, real secrets, or a
 * production MongoDB. Everything is set explicitly before any module that reads
 * `process.env` is imported, and the values are deliberately weak-but-valid so
 * the cheap-Argon2 path engages.
 */
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.APP_URL = 'http://localhost:3000';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.SESSION_SECRET = 'test-session-secret-2f8b4d6a1c9e0735b8d2f4a6c1e09375';
process.env.PASSWORD_PEPPER = 'test-pepper-9a1c3e5b7d9f2046c8a2e1b3d5f7094';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27019/cybergrid_test';
process.env.TEST_MONGODB_URI = process.env.MONGODB_URI;
process.env.EMAIL_TRANSPORT = 'outbox';
process.env.EMAIL_FROM = 'CYBERGRID Test <no-reply@cybergrid.test>';
process.env.DEV_MAIL_PREVIEW = 'false';
process.env.AUTO_SEED_CONTENT = 'false';
process.env.AUTH_TEST_FAST_HASH = 'true';
// Test isolation: do not honour proxy headers unless a test opts in.
process.env.TRUST_PROXY = '0';
