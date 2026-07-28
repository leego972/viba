# VIBA Google Play Publisher

## Implemented

- Authenticated publisher dashboard at `/play-publisher`
- Customer-owned Google service-account connection
- AES-256-GCM credential encryption
- Android application registry
- Readiness audits
- Isolated-build job queue contract
- Build artifact SHA-256 verification
- Android Publisher API JWT authentication
- AAB upload through Google Play edits
- Internal, closed, open and production tracks
- Staged production rollout
- Explicit production approval gate
- Release audit logs

## Required environment

```env
PLAY_PUBLISHER_MASTER_KEY=<minimum-32-character-random-secret>
```

Never rotate this value without first re-encrypting stored service-account credentials.

## Google service-account setup

1. Enable Google Play Android Developer API in the customer's Google Cloud project.
2. Create a service account and JSON key.
3. Add the service-account email in Play Console Users and permissions.
4. Restrict access to the required applications and release permissions.
5. Paste the JSON into VIBA Play Publisher. It is validated before encrypted storage.

## Build worker contract

A worker claims queued rows in `play_publisher_jobs` where `kind='build'`, clones the registered repository and runs the commands supplied in `input.commands` inside a fresh Android container.

The worker must:

1. Use a clean ephemeral filesystem.
2. inject signing material only for the duration of the build;
3. run typecheck, tests, web build, Capacitor sync and `bundleRelease`;
4. upload the resulting `.aab` to private object storage using a short-lived signed URL;
5. calculate SHA-256;
6. mark the job complete through the API or a DB-backed worker process;
7. destroy the workspace and credentials.

Completion payload:

```json
{
  "status": "completed",
  "artifactUrl": "https://short-lived-signed-url/app-release.aab",
  "sha256": "hex-sha256",
  "output": {
    "commands": [],
    "logsUrl": "https://private-log-url"
  }
}
```

## Release request

```json
{
  "buildJobId": 123,
  "track": "internal",
  "rolloutPercent": 100,
  "approveProduction": false
}
```

For `track=production`, `approveProduction` must be `true`. The API downloads the AAB, verifies its digest, creates a Google Play edit, uploads the bundle, assigns the track and commits the edit.

## Security boundaries

- The browser never receives decrypted Google credentials.
- Google Play App Signing remains responsible for the production signing key.
- VIBA should hold only the upload key required by the isolated worker.
- Production publication cannot occur without an explicit approval flag.
- Service accounts should be scoped to the smallest possible Play Console permission set.
- Artifact URLs must be short-lived and non-public.

## Remaining deployment infrastructure

The repository now contains the complete application-layer module. Production operation additionally requires an Android SDK build-worker deployment and private object storage. Those are infrastructure services, not processes that should execute inside the VIBA web API container.
