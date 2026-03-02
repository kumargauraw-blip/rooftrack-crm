# RoofTrack CRM - Project Context

## Project Overview
CRM application for HonestRoof.com, a roofing contractor in Dallas/Fort Worth area.

**Tech Stack:**
- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- Database: SQLite
- State Management: React Query (@tanstack/react-query)

## Current Issues to Fix

### 1. **Kanban Board Drag-and-Drop** (PRIORITY)
The kanban board cards should be draggable between swimlanes but it's not working properly.

**Files to check:**
- `client/src/components/PipelineFunnel.jsx` - Drag-and-drop implementation
- `client/src/hooks/useLeads.js` - useUpdateLeadStatus mutation
- `server/routes/leads.js` - PATCH /leads/:id/status endpoint

**What works (from code review):**
- HTML5 drag-and-drop handlers are in place
- Backend API endpoint exists
- React Query mutation configured

**What needs testing:**
- Actual drag-and-drop in browser
- Verify API calls go through
- Check for console errors

### 2. **Login Form Validation Bug** (BLOCKING)
Login form is showing "Please fill out this field" even when password is entered.

**Files to check:**
- `client/src/pages/Login.jsx` or equivalent
- Form validation logic

### 3. **Telegram Bot Integration** (NOT YET IMPLEMENTED)
Telegram bot exists in skeleton form but isn't functional.

**Files:**
- `server/bot/handlers.js` - Has skeleton code
- See `../TELEGRAM-INTEGRATION-PLAN.md` for specs

## Project Structure
```
app/
├── client/          # React frontend (Vite)
├── server/          # Express backend
├── rooftrack.db     # SQLite database
├── .env             # Environment variables
└── package.json     # Runs both with concurrently
```

## Running the App
```bash
npm run dev   # Starts both frontend (5173) and backend (3001)
```

## Architecture Notes
- Dashboard shows pipeline with 8 stages: New → Contacted → Quoted → Accepted → Scheduled → Completed → Paid → Review Received
- Each status change is logged in `interactions` table
- Smart note parsing auto-creates appointments from text like "in 3 days"
- Status timestamps are tracked in separate columns (contacted_at, quoted_at, etc.)

## Development Guidelines
- Use React Query for all API calls
- Components are in `client/src/components/`
- UI components from shadcn/ui in `client/src/components/ui/`
- All dates/times should handle timezone properly
- Mobile-first responsive design

## Testing Checklist
1. Login → Dashboard
2. Drag lead card between pipeline stages
3. Verify status update in UI
4. Check database for updated status
5. Test on mobile viewport
