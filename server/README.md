# Certificate Workflow Server

## Endpoints

- `POST /certificates/create`
- `POST /certificates/:id/manager-approve`
- `POST /certificates/:id/general-manager-approve`
- `POST /certificates/:id/ceo-approve`
- `POST /certificates/:id/send`

## Setup

1. Copy `server/.env.example` to `server/.env`
2. Set:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
3. Install dependencies:
   - `cd server`
   - `npm install`
4. Run:
   - `npm run dev`

## Auth

Pass the logged-in user's Supabase access token in:

`Authorization: Bearer <access_token>`

The server validates the token with Supabase Auth, resolves the user's application role from `public.user_roles`, and performs all certificate workflow writes with the service-role client.

## Example Requests

### Create

```http
POST /certificates/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "investorName": "Jane Doe",
  "investorEmail": "jane@example.com",
  "amount": 250000,
  "interestRate": 12.5
}
```

### Approve

```http
POST /certificates/<certificate-id>/manager-approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "signature": "data:image/png;base64,..."
}
```
