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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import javax.net.ssl.HttpsURLConnection;

/** Native GitHub Releases updater; project storage is never uploaded or changed. */
final class AppUpdater {
    private static final long CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L;
    private final Activity activity;
    private final SharedPreferences preferences;
    private final Consumer<String> onAvailabilityChanged;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final UpdateFlow flow = new UpdateFlow();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private AlertDialog progress;
    private File pendingInstall;
    private boolean awaitingPermission;
    private volatile boolean closed;
    private volatile Release availableUpdate;

    private record Release(long code, String version, String url, String sha256, String notes) {}

    AppUpdater(Activity activity, Consumer<String> onAvailabilityChanged) {
        this.activity = activity;
        this.onAvailabilityChanged = onAvailabilityChanged;
        preferences = activity.getSharedPreferences("updates", Activity.MODE_PRIVATE);
        String cachedManifest = preferences.getString("availableUpdate", "");
        if (!cachedManifest.isEmpty()) {
            try { availableUpdate = parseAvailableUpdate(new JSONObject(cachedManifest), repository()); }
            catch (Exception ignored) { preferences.edit().remove("availableUpdate").apply(); }
        }
    }

    private String repository() { return preferences.getString("repository", BuildConfig.UPDATE_REPOSITORY); }

    String availableVersion() {
        Release update = availableUpdate;
        return update == null ? "" : update.version();
    }

    private void checkAutomatically() {
        long elapsed = System.currentTimeMillis() - preferences.getLong("lastCheck", 0);
        boolean installationChanged = preferences.getLong("lastCheckedVersion", 0) != BuildConfig.VERSION_CODE;
        if (!repository().isEmpty() && preferences.getBoolean("automatic", true)
            && (installationChanged || elapsed < 0 || elapsed >= CHECK_INTERVAL_MS)
            && flow.startAutomaticCheck()) check();
    }

    void startUpdate() {
        if (closed) return;
        if (flow.cancelling()) { toast("Загрузка отменяется…"); return; }
        if (pendingInstall != null && pendingInstall.isFile()) { requestInstall(); return; }
        if (repository().isEmpty()) { showSettings(); return; }
        UpdateFlow.Action action = flow.request(availableUpdate != null);
        showProgress(flow.downloading() ? "Подготовка обновления…" : "Проверяем наличие обновления…");
        if (action == UpdateFlow.Action.CHECK) check();
        else if (action == UpdateFlow.Action.DOWNLOAD) download(availableUpdate);
    }

    void showSettings() {
        if (closed) return;
        if (flow.busy()) { toast("Дождитесь завершения проверки или загрузки"); return; }
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
        String description = "Установлена версия " + BuildConfig.VERSION_NAME + ". Источник — публичный GitHub-репозиторий.";
        Release update = availableUpdate;
        if (update != null) {
            description += "\nДоступна версия " + update.version() + ".";
            if (!update.notes().isBlank()) description += "\n\n" + update.notes();
        }
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Настройки обновлений")
            .setMessage(description)
            .setView(form).setPositiveButton("Сохранить", null).setNegativeButton("Отмена", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            final String repo;
            try { repo = UpdatePolicy.repository(input.getText().toString()); }
            catch (IllegalArgumentException error) { input.setError(error.getMessage()); return; }
            SharedPreferences.Editor changes = preferences.edit().putString("repository", repo).putBoolean("automatic", auto.isChecked());
            if (!repo.equals(repository())) {
                changes.remove("availableUpdate").remove("lastCheck");
                setAvailableUpdate(null);
                pendingInstall = null;
            }
            changes.apply();
            dialog.dismiss();
            checkAutomatically();
        }));
        dialog.show();
    }

    private void check() {
        String repo = repository();
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
                Release update = parseAvailableUpdate(manifest, repo);
                SharedPreferences.Editor changes = preferences.edit()
                    .putLong("lastCheck", System.currentTimeMillis()).putLong("lastCheckedVersion", BuildConfig.VERSION_CODE);
                if (update == null) changes.remove("availableUpdate");
                else changes.putString("availableUpdate", manifest.toString());
                changes.apply();
                ui(() -> {
                    setAvailableUpdate(update);
                    boolean interactive = flow.interactive();
                    if (flow.checked(update != null) == UpdateFlow.Action.DOWNLOAD) {
                        download(update);
                        return;
                    }
                    dismissProgress();
                    if (!interactive) return;
                    if (manifest.optLong("versionCode") > BuildConfig.VERSION_CODE) {
                        toast("Обновление требует более новой версии Android");
                    } else toast("Установлена актуальная версия " + BuildConfig.VERSION_NAME);
                });
            } catch (Exception error) {
                ui(() -> {
                    boolean interactive = flow.interactive();
                    flow.finish();
                    dismissProgress();
                    if (interactive) showError(error);
                });
            }
        });
    }

    private Release parseAvailableUpdate(JSONObject manifest, String repo) throws Exception {
        if (!activity.getPackageName().equals(manifest.getString("packageName"))) {
            throw new Exception("Манифест предназначен для другого приложения");
        }
        long code = manifest.getLong("versionCode");
        if (code <= BuildConfig.VERSION_CODE || manifest.optInt("minSdk", 29) > android.os.Build.VERSION.SDK_INT) return null;
        String url = manifest.getString("apkUrl");
        UpdatePolicy.requireReleaseUrl(url, repo);
        String sha256 = manifest.getString("sha256").toLowerCase(java.util.Locale.ROOT);
        if (!sha256.matches("[a-f0-9]{64}")) throw new Exception("Некорректная контрольная сумма обновления");
        String version = manifest.getString("versionName").trim();
        if (version.isEmpty() || version.length() > 64) throw new Exception("Некорректное название версии");
        String notes = manifest.optString("notes", "");
        return new Release(code, version, url, sha256, notes.substring(0, Math.min(2000, notes.length())));
    }

    private void setAvailableUpdate(Release update) {
        availableUpdate = update;
        onAvailabilityChanged.accept(availableVersion());
    }

    private void showProgress(String message) {
        if (progress != null) return;
        progress = new AlertDialog.Builder(activity).setTitle("Обновление Zamer CAD")
            .setMessage(message)
            .setNegativeButton("Отмена", (dialog, which) -> cancelUpdate()).create();
        progress.setCanceledOnTouchOutside(false);
        progress.setOnCancelListener(dialog -> cancelUpdate());
        progress.show();
    }

    private void cancelUpdate() {
        flow.cancel();
        cancelled.set(true);
        dismissProgress();
    }

    private void dismissProgress() {
        if (progress != null) { progress.dismiss(); progress = null; }
    }

    private void download(Release update) {
        cancelled.set(false);
        if (progress != null) progress.setMessage("Скачиваем версию " + update.version() + "…");
        executor.execute(() -> {
            File temporary = null;
            try {
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Не удалось создать папку обновления");
                File ready = new File(directory, update.sha256() + ".apk");
                if (ready.isFile() && !update.sha256().equals(hashOf(ready)) && !ready.delete()) {
                    throw new Exception("Не удалось заменить файл обновления");
                }
                if (!ready.isFile()) {
                    temporary = File.createTempFile("download-", ".part", directory);
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    HttpsURLConnection connection = connect(update.url());
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                        byte[] buffer = new byte[32768];
                        long total = 0;
                        long length = connection.getContentLengthLong();
                        int lastPercent = -1;
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            requireActiveDownload();
                            total += count;
                            if (total > 128L * 1024 * 1024) throw new Exception("APK превышает лимит 128 МБ");
                            output.write(buffer, 0, count);
                            digest.update(buffer, 0, count);
                            int percent = length > 0 ? (int) Math.min(100, total * 100 / length) : -1;
                            if (percent >= 0 && percent != lastPercent) {
                                lastPercent = percent;
                                ui(() -> {
                                    if (progress != null && flow.downloading() && !cancelled.get()) {
                                        progress.setMessage("Скачиваем версию " + update.version() + " · " + percent + "%");
                                    }
                                });
                            }
                        }
                        output.getFD().sync();
                    } finally { connection.disconnect(); }
                    if (!update.sha256().equals(hex(digest.digest()))) throw new Exception("Контрольная сумма APK не совпала. Установка отменена");
                    if (!temporary.renameTo(ready)) throw new Exception("Не удалось сохранить проверенное обновление");
                    temporary = null;
                }
                requireActiveDownload();
                ui(() -> { if (progress != null) progress.setMessage("Проверяем обновление…"); });
                try { validateApk(ready, update.code()); }
                catch (Exception error) {
                    ready.delete();
                    throw error;
                }
                requireActiveDownload();
                ui(() -> {
                    boolean install = flow.interactive() && !cancelled.get();
                    flow.finish();
                    dismissProgress();
                    if (install) {
                        pendingInstall = ready;
                        requestInstall();
                    }
                });
            } catch (InterruptedException ignored) {
                ui(() -> { flow.finish(); dismissProgress(); });
            } catch (Exception error) {
                ui(() -> {
                    boolean interactive = flow.interactive();
                    flow.finish();
                    dismissProgress();
                    if (interactive) showError(error);
                });
            } finally {
                if (temporary != null) temporary.delete();
            }
        });
    }

    private void requireActiveDownload() throws InterruptedException {
        if (cancelled.get() || closed || Thread.currentThread().isInterrupted()) throw new InterruptedException();
    }

    private String hashOf(File apk) throws Exception {
        if (apk.length() > 128L * 1024 * 1024) return "";
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(apk)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) {
                requireActiveDownload();
                digest.update(buffer, 0, count);
            }
        }
        return hex(digest.digest());
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
            try {
                awaitingPermission = true;
                toast("Разрешите установку из Zamer CAD и вернитесь. Обновление продолжится автоматически.");
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            } catch (Exception error) { awaitingPermission = false; showError(error); }
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
        checkAutomatically();
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
            .setPositiveButton("Повторить", (dialog, which) -> startUpdate())
            .setNeutralButton("Настройки", (dialog, which) -> showSettings())
            .setNegativeButton("Закрыть", null).show();
    }
    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    private void ui(Runnable action) { activity.runOnUiThread(() -> { if (!closed && !activity.isFinishing() && !activity.isDestroyed()) action.run(); }); }
    void close() { closed = true; cancelled.set(true); dismissProgress(); executor.shutdownNow(); }
}
