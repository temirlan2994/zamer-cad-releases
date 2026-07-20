# Zamer CAD Offline APK

This Android wrapper packages the browser prototype as local application assets.
The `?apk=1` mode bypasses remote authentication and keeps project data on the
phone in WebView local storage plus IndexedDB. Exports are written to
`Downloads/Zamer CAD` through Android MediaStore.

Build prerequisites are configured locally with JDK 17 and Android SDK 35.
Run from this directory:

```powershell
.\gradlew.bat assembleRelease
```

The release signing key and `keystore.properties` are intentionally ignored by
Git. Keep both files backed up: every future APK update must use the same key.
