# Announcements Feature Implementation Summary

## Database Schema

### Announcements Table
Created via migration: `supabase/migrations/20260321132100_create_announcements_table.sql`

**Columns:**
- `id` (UUID): Primary key, auto-generated
- `title` (TEXT): Announcement title (required)
- `detail` (TEXT): Announcement details (required)
- `status` (TEXT): One of 'info', 'urgent', 'matured' (required)
- `created_at` (TIMESTAMPTZ): Timestamp, defaults to current time

**Security:**
- Row-level security enabled
- Authenticated users can view announcements
- Admin users can create/edit/delete announcements

**Sample Data:**
- Three default announcements included in migration
- Ready for production use

---

## Backend API Hooks

### File: `src/hooks/useAnnouncements.ts`

#### Functions:

1. **`useAnnouncements()`**
   - Fetches all announcements ordered by creation date (newest first)
   - Limits to 8 announcements per query
   - Cache stale time: 60 seconds
   - Returns: `AnnouncementRow[]`

2. **`useCreateAnnouncement()`**
   - Creates new announcement in Supabase
   - Validates title and detail before submission
   - Invalidates cache on success
   - Returns: mutation object with `isPending`, `mutateAsync`

3. **`useDeleteAnnouncement()`**
   - Deletes announcement by ID
   - Invalidates cache on success
   - Returns: mutation object with `isPending`, `mutateAsync`

---

## UI Components

### 1. Landing Page (`src/pages/Landing.tsx`)
- Uses `useAnnouncements()` to fetch backend announcements
- Falls back to inferred alerts from investor maturities if no DB announcements
- Displays up to 4 announcements in grid
- "View all announcements" button links to `/notifications`
- Fully responsive mobile/tablet/desktop

### 2. Settings Page (`src/pages/Settings.tsx`) - NEW
Complete announcement management interface:

**Create Section:**
- Title input field
- Detail textarea
- Status dropdown (Info/Urgent/Matured)
- Create button with loading state
- Toast notifications for success/error

**Management Section:**
- Lists all existing announcements
- Shows title, detail, status badge, created date
- Delete button for each announcement
- Empty state messaging
- Loading state

---

## Frontend to Backend Flow

```
Landing Page
    ↓
useAnnouncements() (hook)
    ↓
fetch announcements from Supabase
    ↓
If found: display in announcements panel
If empty: fallback to inferred investor maturity alerts
    ↓
"View all" button → /notifications page

Settings Page
    ↓
useCreateAnnouncement() / useDeleteAnnouncement() (hooks)
    ↓
Create/Edit/Delete in Supabase
    ↓
Query cache invalidated
    ↓
UI updates automatically
    ↓
Toast feedback to admin
```

---

## Type Definitions

### AnnouncementRow
```typescript
{
  id: string;
  title: string;
  detail: string;
  status: 'info' | 'urgent' | 'matured';
  created_at: string;
}
```

### Supabase Types (Updated)
- `Database['public']['Tables']['announcements']` added to `src/integrations/supabase/types.ts`
- Row, Insert, Update, and Relationships types auto-generated

---

## Features

✅ **Real Database Integration**
- Announcements stored in Supabase
- Persists across sessions
- Supports multiple announcements

✅ **Admin Dashboard**
- Create announcements from Settings page
- Delete announcements with confirmation
- Real-time updates

✅ **Public Homepage**
- Displays latest announcements to all users
- Smart fallback to investor maturity alerts
- "View all" link to notifications page

✅ **Responsive Design**
- Mobile-first layout
- Tablet and desktop grids
- Consistent styling

✅ **Security**
- Row-level security in Supabase
- Admin-only create/delete permissions
- Authenticated view access

✅ **User Feedback**
- Toast notifications for actions
- Loading states
- Empty state messages

---

## How to Use

### For Admin Users (in Settings):
1. Navigate to `/settings`
2. Fill in "Create Announcement" form
   - Title: e.g., "System Maintenance Tomorrow"
   - Detail: e.g., "Scheduled maintenance 2am-4am UTC"
   - Status: Select from Info/Urgent/Matured
3. Click "Create Announcement"
4. View in "Manage Announcements" section
5. Delete by clicking trash icon

### For All Users (on Homepage):
1. View announcements in "Latest announcements" panel
2. Up to 4 latest shown
3. Click "View all announcements" to go to `/notifications` for full list

---

## Fallback Logic

If no announcements in database:
- Landing page automatically generates alerts from active investor maturities
- Shows upcoming maturity dates and investment values
- Sorted by urgency (days until maturity)
- This ensures always-populated content even without admin announcements

---

## Database Migration

**File:** `supabase/migrations/20260321132100_create_announcements_table.sql`

**What it creates:**
1. `announcements` table with proper schema
2. RLS (Row-Level Security) policies
3. Sample data (3 default announcements)
4. CHECK constraint for status enum

**How to apply:**
```bash
npx supabase db push
```

---

## Files Modified

1. ✅ `supabase/migrations/20260321132100_create_announcements_table.sql` (new)
2. ✅ `src/hooks/useAnnouncements.ts` (enhanced)
3. ✅ `src/pages/Landing.tsx` (integrated announcements)
4. ✅ `src/pages/Settings.tsx` (new announcement management)
5. ✅ `src/integrations/supabase/types.ts` (types added)

---

## Testing Checklist

- [ ] Supabase migration applied successfully
- [ ] Admin can create announcements in Settings
- [ ] Announcements appear on Landing page within 60 seconds
- [ ] "View all announcements" button works
- [ ] Delete button removes announcements
- [ ] Fallback to investor alerts when no DB announcements
- [ ] Mobile layout responsive
- [ ] Toast notifications appear
- [ ] Security policies prevent non-admins from creating

---

## Future Enhancements

1. **Scheduling** - Schedule announcements for future publishing
2. **Targeting** - Show announcements only to specific user roles
3. **Rich Text** - Add markdown/HTML editor for announcements
4. **Search/Filter** - Filter announcements by type in Settings
5. **Archive** - Soft delete instead of hard delete
6. **Editing** - Update existing announcements
7. **Email Alerts** - Send announcements via email
