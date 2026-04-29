# Certificate Fix TODO

## Approved Plan Steps

### Step 1: Fix "View Current Certificate" to open in NEW TAB [DONE]
- ✓ Edited `src/hooks/useCertificates.ts`: Changed to `window.open(previewUrl, '_blank', 'noopener,noreferrer')` with popup blocked fallback.
- Test: Button should open PDF blob in popup new tab.

### Step 2: Since IT Engineers is 'admin' (already allowed), investigate other view/gen blocks [DONE]
 - ✓ `VITE_CERTIFICATE_API_URL` unset/empty → likely cause (fix by adding to .env)
 - ✓ Added frontend logging in useCertificates mutationFn/onSuccess
 - Server status: Run `cd server && bun run dev` to check port 4000

### Step 3: Enhance error handling/logging for generation [DONE]
- Frontend: ✓ Logged full errors/success in useManageInvestorCertificate 
- Backend: ✓ Added detailed console.log/error in createCertificate, persistPdf (PDF gen/upload)

### Step 4: Test generation and view end-to-end [PENDING]
 - Generate certificate → check console/network/Supabase storage for logs
 - View button → confirm new tab PDF download

### Step 4: Test generation and view end-to-end [PENDING]
- Generate certificate → check network/Supabase storage
- View button → confirm new tab PDF

### Step 5: Completion [PENDING]
