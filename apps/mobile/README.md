# Helpy Mobile

Flutter shell only. From this directory:

```sh
flutter pub get --enforce-lockfile
flutter analyze --fatal-infos
flutter test
flutter run
flutter build apk --debug
```

Run dependency restoration once from the repository root as described in the
root README. F1 does not connect to product APIs. The bundled catalog is shared
with Admin, not copied. Locale state is owned by a shared Cubit; persistence is
an injected device adapter outside business data. Expected storage failures use
`fpdart.Either`. Product feature directories retain data/domain/presentation.

APK is a development artifact, not a signed production release.
