# Shared Contracts

`GET /health` returns HTTP 200 and `{"status":"ok","contractVersion":1}`.
The TypeScript and Dart wire types accept the same shared JSON fixtures.
Unknown versions, missing fields and extra fields are rejected.

`Language` uses the wire values `th`, `ru`, `en`. The single shell catalog lives
in `lib/src/catalog.json`; it is imported by TypeScript and loaded as a package
asset by Mobile. This package owns wire/presentation values, not Domain Entities,
preferences, business configuration, translation providers or application state.

Build and test commands are documented in the repository README. The Dart side
has no Flutter or runtime dependencies.
