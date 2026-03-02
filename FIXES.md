# CRM Fixes - March 2, 2026

## Bug #1: Login Form Password Validation (BLOCKING)

**Issue:** Login form would not submit - browser validation showed "Please fill out this field" on password input even when filled.

**Root Cause:** Password input field had implicit `required` attribute triggering browser HTML5 validation, which wasn't being disabled by form's `noValidate` attribute.

**Files Changed:**
- `client/src/pages/Login.jsx`

**Fix Applied:**
```jsx
<Input
  id="password"
  type="password"
  ...
  required={false}  // Explicitly disable required validation
/>
```

**Testing:**
- ⏳ Deployed to production, awaiting validation

---

## Bug #2: Kanban Drag-and-Drop

**Issue:** Kanban board cards could not be dragged between swimlanes. Backend returned 500 error when updating lead status.

**Root Cause:** SQL syntax error in `server/routes/leads.js` - PATCH `/leads/:id/status` endpoint.

The datetime function was using double quotes instead of single quotes:
```sql
❌ datetime("now")  // SQL interprets "now" as a column name
✅ datetime('now')  // Correct - 'now' is a string literal
```

**Files Changed:**
- `server/routes/leads.js` - Line ~249 (status update endpoint)

**Fix Applied:**
```javascript
// Before:
db.prepare(`UPDATE leads SET status = ?, ${dateCol} = datetime("now"), updated_at = datetime("now") WHERE id = ?`)

// After:
db.prepare(`UPDATE leads SET status = ?, ${dateCol} = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
```

**Testing:**
- ✅ Standalone test script confirmed SQL update works with correct syntax
- ✅ Server restarted with fix
- ⏳ Browser drag-and-drop needs validation

---

## Bug #3: PATCH /:id/status Returns 500, Never Logs Errors

**Issue:** The `PATCH /api/leads/:id/status` endpoint returned HTTP 500 for every request, including valid ones. No `[STATUS UPDATE ERROR]` log appeared in server output.

**Root Causes (4 issues found):**

### 3a. SQL double-quote syntax (already partially fixed in Bug #2)
The `datetime("now")` issue from Bug #2 was fixed in the status endpoint but **still present** in the notes endpoint (`PATCH /:id/notes`, line 282):
```javascript
// BROKEN (notes endpoint still had this):
db.prepare('UPDATE leads SET notes = ?, updated_at = datetime("now") WHERE id = ?')
// FIXED:
db.prepare("UPDATE leads SET notes = ?, updated_at = datetime('now') WHERE id = ?")
```

### 3b. `getDb()` and body destructuring outside try/catch
`const db = getDb()` and `const { status } = req.body` were **outside** the try block. When `req.body` was undefined (missing `Content-Type: application/json` header), the destructuring threw a `TypeError` that escaped the route handler entirely. Express's global error handler caught it and returned a generic `{"success":false,"error":"Internal Server Error"}` — the route-specific `[STATUS UPDATE ERROR]` log never fired.

```javascript
// BEFORE (lines 241-243):
router.patch('/:id/status', authenticate, (req, res) => {
    const db = getDb();              // outside try
    const { status } = req.body;     // outside try — crashes if req.body is undefined
    try { ... }

// AFTER:
router.patch('/:id/status', authenticate, (req, res) => {
    try {
        const db = getDb();
        const status = req.body?.status;    // safe optional chaining
        if (!status) return res.status(400).json(...)
        ...
```

### 3c. DATABASE_PATH relative path resolves to wrong file
`.env` had `DATABASE_PATH=./rooftrack.db` (relative). The `server` npm script does `cd server && npm run dev`, so the CWD is `server/`. The relative path resolved to `server/rooftrack.db` (a 4KB near-empty database) instead of `app/rooftrack.db` (the real 131KB database with all lead data).

```javascript
// BEFORE (server/db/database.js):
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../rooftrack.db');

// AFTER - always resolve relative to project root:
const projectRoot = path.join(__dirname, '../..');
const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);
```

### 3d. Missing timestamp column migration check
The `GET /` route checks `migrationDone` and retries `ensureTimestampColumns()` if needed, but the `PATCH /:id/status` route did not. If the PATCH was the first request after a failed module-load migration, the timestamp columns might not exist, causing the UPDATE SQL to fail.

**Files Changed:**
- `server/routes/leads.js` — Both PATCH routes: moved getDb/body parsing inside try/catch, added validation, added migration check, fixed double-quote SQL in notes route, improved error logging
- `server/db/database.js` — Resolve DATABASE_PATH relative to project root

**Testing (curl):**
```
Test 1: Valid request         -> {"success":true}          HTTP 200  ✅
Test 2: No Content-Type       -> {"error":"Status is required"}  HTTP 400  ✅
Test 3: Missing status field  -> {"error":"Status is required"}  HTTP 400  ✅
Test 4: Empty body            -> {"error":"Status is required"}  HTTP 400  ✅
Test 5: Status 'new' (no date col) -> {"success":true}     HTTP 200  ✅
```

Database verified: `l1` status updated to `contacted`, `contacted_at` timestamp set correctly.

---

## Deployment Status
- Local: ✅ Fixed and running on localhost:5173
- Production (rooftrack.gauraw.com): Pending deployment

---

**Next Steps:**
1. Deploy to production URL (ensure the `workspace-chanakya` code is deployed, NOT the old `workspace` copy)
2. Kumar validates drag-and-drop functionality
3. Address any remaining issues
