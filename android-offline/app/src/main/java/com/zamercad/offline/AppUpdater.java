package com.zamercad.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.provider.Settings;
import android.text.InputType;
import android.widget.EditText;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** Native GitHub Releases updater; project storage is never uploaded or changed. */
final class AppUpdater {
    private final Activity activity;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private File pendingInstall;
    private boolean awaitingPermission;
    private volatile boolean closed;

    AppUpdater(Activity activity) {
        this.activity = activity;
        preferences = activity.getSharedPreferences("updates", Activity.MODE_PRIVATE);
    }

    private String repository() { return preferences.getString("repository", BuildConfig.UPDATE_REPOSITORY); }

    void checkAtStartup() {
        long elapsed = System.currentTimeMillis() - preferences.getLong("lastCheck", 0);
        if (!repository().isEmpty() && preferences.getBoolean("automatic", true)
            && (elapsed < 0 || elapsed >= 6 * 60 * 60 * 1000L)) check(true);
    }

    void showMenu() {
        if (busy.get()) { toast("Проверка или загрузка уже выполняется"); return; }
        String source = repository().isEmpty() ? "Источник пока не подключён" : "GitHub: " + repository();
        new AlertDialog.Builder(activity).setTitle("Обновления · " + BuildConfig.VERSION_NAME)
            .setMessage(source + "\nПроекты остаются на телефоне. Установку подтверждает Android.")
            .setPositiveButton("Проверить", (dialog, which) -> {
                if (repository().isEmpty()) configure(); else check(false);
            })
            .setNeutralButton("Настроить", (dialog, which) -> configure())
            .setNegativeButton("Закрыть", null).show();
    }

    private void configure() {
        EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("имя/zamer-cad-releases");
        input.setText(repository());
        int padding = (int) (20 * activity.getResources().getDisplayMetrics().density);
        android.widget.LinearLayout form = new android.widget.LinearLayout(activity);
        form.setOrientation(android.widget.LinearLayout.VERTICAL);
        form.setPadding(padding, 0, padding, 0);
        form.addView(input);
        android.widget.CheckBox auto = new android.widget.CheckBox(activity);
        auto.setText("Проверять при запуске");
        auto.setChecked(preferences.getBoolean("automatic", true));
        form.addView(auto);
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Репозиторий обновлений")
            .setMessage("Публичный GitHub-репозиторий. В последнем релизе должны быть APK и update.json.")
            .setView(form).setPositiveButton("Сохранить", null).setNegativeButton("Отмена", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            final String repo;
            try { repo = UpdatePolicy.repository(input.getText().toString()); }
            catch (IllegalArgumentException error) { input.setError(error.getMessage()); return; }
            preferences.edit().putString("repository", repo).putBoolean("automatic", auto.isChecked()).apply();
            dialog.dismiss();
            check(false);
        }));
        dialog.show();
    }

    private void check(boolean silent) {
        if (!busy.compareAndSet(false, true) || closed) return;
        String repo = repository();
        if (!silent) toast("Проверяем GitHub Releases…");
        executor.execute(() -> {
            try {
                JSONObject release = readJson("https://api.github.com/repos/" + repo + "/releases/latest");
                JSONArray assets = release.getJSONArray("assets");
                String manifestUrl = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    if ("update.json".equals(asset.optString("name"))) manifestUrl = asset.getString("browser_download_url");
                }
                if (manifestUrl == null) throw new Exception("В последнем релизе отсутствует update.json");
                UpdatePolicy.requireReleaseUrl(manifestUrl, repo);
                JSONObject manifest = readJson(manifestUrl);
                if (!activity.getPackageName().equals(manifest.getString("packageName"))) throw new Exception("Манифест предназначен для другого приложения");
                long code = manifest.getLong("versionCode");
                preferences.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
                if (code <= BuildConfig.VERSION_CODE) {
                    if (!silent) ui(() -> toast("Установлена актуальная версия " + BuildConfig.VERSION_NAME));
                    return;
                }
                String apkUrl = manifest.getString("apkUrl");
                UpdatePolicy.requireReleaseUrl(apkUrl, repo);
                String sha256 = manifest.getString("sha256").toLowerCase(java.util.Locale.ROOT);
                if (!sha256.matches("[a-f0-9]{64}")) throw new Exception("Некорректная контрольная сумма обновления");
                if (manifest.optInt("minSdk", 29) > android.os.Build.VERSION.SDK_INT) {
                    if (!silent) ui(() -> toast("Обновление требует более новой версии Android"));
                    return;
                }
                String version = manifest.getString("versionName");
                if (version.length() > 64) throw new Exception("Некорректное название версии");
                String notes = manifest.optString("notes", "");
                String message = "Доступна версия " + version + ". Текущая: " + BuildConfig.VERSION_NAME
                    + ".\n\n" + notes.substring(0, Math.min(2000, notes.length())) + "\n\nЧертежи сохранятся. Скачать обновление?";
                ui(() -> new AlertDialog.Builder(activity).setTitle("Новая версия Zamer CAD")
                    .setMessage(message).setPositiveButton("Скачать", (dialog, which) -> download(apkUrl, sha256, code))
                    .setNegativeButton("Позже", null).show());
            } catch (Exception error) {
                if (!silent) ui(() -> showError(error));
            } finally { busy.set(false); }
        });
    }

    private void download(String url, String expectedHash, long versionCode) {
        if (!busy.compareAndSet(false, true) || closed) return;
        cancelled.set(false);
        AlertDialog progress = new AlertDialog.Builder(activity).setTitle("Загрузка обновления")
            .setMessage("Скачиваем APK и проверяем подпись…")
            .setNegativeButton("Отмена", (dialog, which) -> cancelled.set(true)).create();
        progress.setCanceledOnTouchOutside(false);
        progress.setOnCancelListener(dialog -> cancelled.set(true));
        progress.show();
        executor.execute(() -> {
            File temporary = null;
            try {
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Не удалось создать папку обновления");
                temporary = File.createTempFile("download-", ".part", directory);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                HttpsURLConnection connection = connect(url);
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[32768];
                    long total = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled.get() || closed || Thread.currentThread().isInterrupted()) throw new InterruptedException();
                        total += count;
                        if (total > 128L * 1024 * 1024) throw new Exception("APK превышает лимит 128 МБ");
                        output.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                    }
                    output.getFD().sync();
                } finally { connection.disconnect(); }
                String actualHash = hex(digest.digest());
                if (!expectedHash.equals(actualHash)) throw new Exception("Контрольная сумма APK не совпала. Установка отменена");
                validateApk(temporary, versionCode);
                if (cancelled.get() || closed) throw new InterruptedException();
                File ready = new File(directory, actualHash + ".apk");
                if (ready.exists() && !ready.delete()) throw new Exception("Не удалось заменить файл обновления");
                if (!temporary.renameTo(ready)) throw new Exception("Не удалось сохранить проверенное обновление");
                temporary = null;
                ui(() -> {
                    progress.dismiss();
                    pendingInstall = ready;
                    requestInstall();
                });
            } catch (InterruptedException ignored) {
                ui(progress::dismiss);
            } catch (Exception error) {
                ui(() -> { progress.dismiss(); showError(error); });
            } finally {
                if (temporary != null) temporary.delete();
                busy.set(false);
            }
        });
    }

    private void validateApk(File apk, long expectedVersion) throws Exception {
        PackageManager manager = activity.getPackageManager();
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo installed = manager.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)) throw new Exception("Этот APK не является Zamer CAD");
        if (candidate.getLongVersionCode() != expectedVersion || expectedVersion <= installed.getLongVersionCode()) throw new Exception("Некорректная версия APK");
        if (candidate.applicationInfo == null || (candidate.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) throw new Exception("Debug APK нельзя использовать для обновления");
        if (candidate.applicationInfo.minSdkVersion > android.os.Build.VERSION.SDK_INT) throw new Exception("APK требует более новой версии Android");
        if (candidate.signingInfo == null || installed.signingInfo == null) throw new Exception("Нет сертификата подписи");
        Signature[] incoming = candidate.signingInfo.getApkContentsSigners();
        Signature[] current = installed.signingInfo.getApkContentsSigners();
        if (incoming.length != 1 || current.length != 1 || !Arrays.equals(incoming[0].toByteArray(), current[0].toByteArray())) throw new Exception("APK подписан другим ключом. Установка отменена");
    }

    private void requestInstall() {
        if (pendingInstall == null || !pendingInstall.isFile()) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity).setTitle("Разрешить обновление")
                .setMessage("В настройках Android разрешите установку из Zamer CAD, затем вернитесь сюда.")
                .setPositiveButton("Открыть настройки", (dialog, which) -> {
                    try {
                        awaitingPermission = true;
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                    } catch (Exception error) { awaitingPermission = false; showError(error); }
                }).setNegativeButton("Позже", null).show();
            return;
        }
        try {
            Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/" + pendingInstall.getName());
            Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.setClipData(ClipData.newRawUri("Zamer CAD update", uri));
            activity.startActivity(install);
            pendingInstall = null;
        } catch (Exception error) { showError(error); }
    }

    void onResume() {
        if (awaitingPermission) {
            awaitingPermission = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) requestInstall();
            else toast("Разрешение не выдано. Обновление можно повторить позже");
        }
    }

    private static HttpsURLConnection connect(String value) throws Exception {
        URL url = new URL(value);
        for (int redirect = 0; redirect < 6; redirect++) {
            UpdatePolicy.requireGithubHttps(url);
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("User-Agent", "Zamer-CAD/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept", "application/json, application/octet-stream");
            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Exception("Пустое перенаправление GitHub");
                url = new URL(url, location);
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                if (status == 404) throw new Exception("Репозиторий или опубликованный релиз не найден");
                if (status == 403 || status == 429) throw new Exception("GitHub временно ограничил запросы. Попробуйте позже");
                throw new Exception("Сервер вернул HTTP " + status);
            }
            return connection;
        }
        throw new Exception("Слишком много перенаправлений");
    }

    private static JSONObject readJson(String url) throws Exception {
        HttpsURLConnection connection = connect(url);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 1024 * 1024) throw new Exception("Ответ обновления слишком большой");
                output.write(buffer, 0, count);
            }
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } finally { connection.disconnect(); }
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder();
        for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return value.toString();
    }

    private void showError(Exception error) {
        new AlertDialog.Builder(activity).setTitle("Обновление не выполнено")
            .setMessage(error.getMessage() == null ? "Проверьте интернет и повторите попытку. Проекты не затронуты." : error.getMessage())
            .setPositiveButton("Понятно", null).show();
    }
    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    private void ui(Runnable action) { activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing() && !activity.isDestroyed()) action.run(); }); }
    void close() { closed = true; cancelled.set(true); executor.shutdownNow(); }
}
