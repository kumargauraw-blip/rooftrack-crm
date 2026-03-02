# CRM Fixes - March 2, 2026

## Bug Fixed: Kanban Drag-and-Drop

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

## Deployment Status
- Local: ✅ Fixed and running on localhost:5173
- Production (rooftrack.gauraw.com): Pending deployment

---

**Next Steps:**
1. Deploy to production URL
2. Kumar validates drag-and-drop functionality
3. Address any remaining issues
