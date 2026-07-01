# Deploy Trigger — Admin Bootstrap

This file intentionally triggers a new main-branch deployment after the admin bootstrap route was added.

Changes deployed with this trigger:

- Safe admin bootstrap endpoint registered at `POST /api/auth/bootstrap-admin`
- Admin bootstrap uses environment secrets only, not hardcoded credentials
- Bootstrap can set/reset the owner login password from `ADMIN_BOOTSTRAP_PASSWORD`
- Bootstrap marks the owner account as verified and active with high credits

Required runtime secrets:

- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `ADMIN_BOOTSTRAP_TOKEN`

Do not commit real passwords or OAuth client secrets to GitHub.
