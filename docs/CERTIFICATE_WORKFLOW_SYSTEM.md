# Realtime Certificate Workflow System

## SQL Schema

- `supabase/migrations/20260411000000_add_production_certificate_system.sql`
- `supabase/migrations/20260411002000_upgrade_certificate_workflow_for_realtime.sql`

Core objects:

- `public.certificates`
- `public.certificate_status`
- `public.notifications`
- `public.manager_certificate_dashboard`
- `public.general_manager_certificate_dashboard`
- `public.ceo_certificate_dashboard`
- `public.get_investor_certificates()`

## Edge Functions

- `supabase/functions/create-certificate/index.ts`
- `supabase/functions/manager-approve/index.ts`
- `supabase/functions/general-manager-approve/index.ts`
- `supabase/functions/ceo-approve/index.ts`
- `supabase/functions/send-final-certificate/index.ts`

## Shared Utilities

- `supabase/functions/_shared/certificateSystem.ts`
- `supabase/functions/_shared/certificatePdf.ts`
- `supabase/functions/_shared/certificateEmail.ts`

## Workflow

1. `create-certificate`
   - inserts `public.certificates`
   - sets `status = pending_manager`
   - generates PDF
   - uploads to storage
   - inserts `public.notifications`
   - emails Investment Manager

2. `manager-approve`
   - stores `manager_signature`
   - sets `status = pending_general_manager`
   - regenerates PDF
   - inserts notification
   - emails General Manager

3. `general-manager-approve`
   - stores `general_manager_signature`
   - sets `status = pending_ceo`
   - regenerates PDF
   - inserts notification
   - emails CEO

4. `ceo-approve`
   - stores `ceo_signature`
   - sets `status = approved`
   - regenerates final PDF
   - triggers final delivery

5. `send-final-certificate`
   - sends certificate to investor email
   - sets `status = sent`
   - inserts investor notification

## Realtime Frontend Example

- `src/examples/certificateRealtimeExample.js`

## Example API Calls

### Create Certificate

```ts
await supabase.functions.invoke('create-certificate', {
  body: {
    investor_name: 'John Doe',
    investor_email: 'john@example.com',
    amount: 50000,
    interest_rate: 12.5,
  },
})
```

### Manager Approval

```ts
await supabase.functions.invoke('manager-approve', {
  body: {
    certificateId: 'CERTIFICATE_UUID',
    signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
  },
})
```

### General Manager Approval

```ts
await supabase.functions.invoke('general-manager-approve', {
  body: {
    certificateId: 'CERTIFICATE_UUID',
    signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
  },
})
```

### CEO Approval

```ts
await supabase.functions.invoke('ceo-approve', {
  body: {
    certificateId: 'CERTIFICATE_UUID',
    signature: 'https://example.com/signatures/ceo-signature.png',
  },
})
```

### Final Resend

```ts
await supabase.functions.invoke('send-final-certificate', {
  body: {
    certificateId: 'CERTIFICATE_UUID',
  },
})
```

## Folder Structure

```text
supabase/
  migrations/
    20260411000000_add_production_certificate_system.sql
    20260411002000_upgrade_certificate_workflow_for_realtime.sql
  functions/
    create-certificate/
      index.ts
    manager-approve/
      index.ts
    general-manager-approve/
      index.ts
    ceo-approve/
      index.ts
    send-final-certificate/
      index.ts
    _shared/
      certificateSystem.ts
      certificatePdf.ts
      certificateEmail.ts
src/
  examples/
    certificateRealtimeExample.js
docs/
  CERTIFICATE_WORKFLOW_SYSTEM.md
```
