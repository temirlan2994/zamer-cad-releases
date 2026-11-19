package com.zamercad.offline;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 5041;
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String APP_PATH_PREFIX = "/assets/";
    private static final String EXPORT_DIRECTORY = Environment.DIRECTORY_DOWNLOADS + "/Zamer CAD";
    private static final int MAX_EXPORT_BYTES = 32 * 1024 * 1024;

    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout viewport;
    private AppUpdater updater;
    private SurveyLaser surveyLaser;
    private ValueCallback<Uri[]> filePathCallback;
    private ExportedFile lastExport;
    private int viewportInsetLeft;
    private int viewportInsetTop;
    private int viewportInsetRight;
    private int viewportInsetBottom;
    private int imeInsetBottom;
    private boolean typedImeVisible;
    private volatile KeyboardViewport keyboardViewport = new KeyboardViewport(false, 0);

    private record ExportedFile(String requestId, Uri uri, String fileName, String mimeType) {}

    private record KeyboardViewport(boolean visible, int availableHeight) {
        String json() {
            return "{\"visible\":" + visible + ",\"availableHeight\":" + availableHeight + "}";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        updater = new AppUpdater(this);
        surveyLaser = new SurveyLaser(this, this::reportSurveyLaser);
        getWindow().setStatusBarColor(Color.rgb(248, 250, 253));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 250, 253));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Insets belong to the native parent: WebView padding does not resize
        // the CSS viewport and lets fixed/absolute page content cover system bars.
        viewport = new FrameLayout(this);
        viewport.setBackgroundColor(Color.rgb(248, 250, 253));
        viewport.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        viewport.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                viewportInsetLeft = bars.left;
                viewportInsetTop = bars.top;
                viewportInsetRight = bars.right;
                viewportInsetBottom = bars.bottom;
                imeInsetBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
                typedImeVisible = insets.isVisible(WindowInsets.Type.ime()) && imeInsetBottom > 0;
            } else {
                viewportInsetLeft = insets.getSystemWindowInsetLeft();
                viewportInsetTop = insets.getSystemWindowInsetTop();
                viewportInsetRight = insets.getSystemWindowInsetRight();
                viewportInsetBottom = Math.min(insets.getStableInsetBottom(), insets.getSystemWindowInsetBottom());
            }
            updateKeyboardViewport();
            return insets.consumeSystemWindowInsets().consumeDisplayCutout();
        });
        viewport.getViewTreeObserver().addOnGlobalLayoutListener(this::updateKeyboardViewport);
        setContentView(viewport);
        viewport.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new AndroidBridge(), "ZamerAndroid");
        webView.setWebViewClient(new LocalAssetClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                boolean acceptsImage = false;
                for (String accept : params.getAcceptTypes()) {
                    if (accept != null && accept.trim().startsWith("image/")) acceptsImage = true;
                }
                intent.setType(acceptsImage ? "image/*" : "*/*");
                if (!acceptsImage) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "application/octet-stream", "text/plain" });
                }
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (RuntimeException error) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(APP_ORIGIN + APP_PATH_PREFIX + "index.html?apk=1");
        } else {
            webView.restoreState(savedInstanceState);
        }
        updater.checkAtStartup();
    }

    private void updateKeyboardViewport() {
        if (webView == null || isDestroyed()) return;
        int[] viewportLocation = new int[2];
        viewport.getLocationOnScreen(viewportLocation);
        int contentTop = viewportLocation[1] + viewportInsetTop;
        int contentBottom = viewportLocation[1] + viewport.getHeight() - viewportInsetBottom;
        float density = webView.getResources().getDisplayMetrics().density;
        Rect visibleFrame = new Rect();
        viewport.getWindowVisibleDisplayFrame(visibleFrame);
        boolean visible = typedImeVisible;
        int keyboardTop = contentBottom;
        if (Build.VERSION.SDK_INT >= 30 && typedImeVisible) {
            keyboardTop = getWindowManager().getCurrentWindowMetrics().getBounds().bottom - imeInsetBottom;
        }
        // With adjustResize the parent may already end above the IME. Only pad
        // the portion still covering the WebView, including edge-to-edge mode.
        if (visibleFrame.bottom > contentTop && (visible || contentBottom - visibleFrame.bottom > 80 * density)) {
            visible = true;
            keyboardTop = Math.min(keyboardTop, visibleFrame.bottom);
        }
        int contentHeight = Math.max(0, contentBottom - contentTop);
        int imeOverlap = visible ? Math.min(contentHeight, Math.max(0, contentBottom - keyboardTop)) : 0;
        int paddedBottom = viewportInsetBottom + imeOverlap;
        if (viewport.getPaddingLeft() != viewportInsetLeft || viewport.getPaddingTop() != viewportInsetTop ||
            viewport.getPaddingRight() != viewportInsetRight || viewport.getPaddingBottom() != paddedBottom) {
            viewport.setPadding(viewportInsetLeft, viewportInsetTop, viewportInsetRight, paddedBottom);
        }
        int availableHeight = Math.round((contentHeight - imeOverlap) / density);
        KeyboardViewport next = new KeyboardViewport(visible, availableHeight);
        if (next.equals(keyboardViewport)) return;
        keyboardViewport = next;
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('zamer-ime-insets',{detail:" + next.json() + "}));", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[] { data.getData() };
        }
        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SurveyLaser.PERMISSION_REQUEST) surveyLaser.onPermissionsResult();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (updater != null) updater.onResume();
    }

    @Override
    protected void onDestroy() {
        if (updater != null) updater.close();
        if (surveyLaser != null) surveyLaser.close();
        if (webView != null) {
            webView.removeJavascriptInterface("ZamerAndroid");
            webView.destroy();
        }
        fileExecutor.shutdown();
        super.onDestroy();
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public String keyboardViewport() {
            return keyboardViewport.json();
        }

        @JavascriptInterface
        public void connectSurveyLaser() {
            runOnUiThread(surveyLaser::connect);
        }

        @JavascriptInterface
        public void disconnectSurveyLaser() {
            runOnUiThread(surveyLaser::disconnect);
        }

        @JavascriptInterface
        public void showUpdates() {
            runOnUiThread(() -> updater.showMenu());
        }

        @JavascriptInterface
        public void dismissKeyboard() {
            runOnUiThread(() -> {
                if (webView == null || isDestroyed()) return;
                InputMethodManager keyboard = getSystemService(InputMethodManager.class);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(webView.getWindowToken(), 0);
            });
        }

        @JavascriptInterface
        public void setTheme(String theme) {
            final boolean dark = "dark".equals(theme);
            runOnUiThread(() -> {
                if (webView == null || isDestroyed()) return;
                int background = dark ? Color.rgb(16, 20, 27) : Color.rgb(245, 247, 250);
                viewport.setBackgroundColor(background);
                webView.setBackgroundColor(background);
                getWindow().setStatusBarColor(background);
                getWindow().setNavigationBarColor(background);
                getWindow().getDecorView().setSystemUiVisibility(dark ? 0 :
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            });
        }

        @JavascriptInterface
        public void exportFile(String requestId, String requestedName, String mimeType, String base64, boolean share) {
            if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{1,64}")) return;
            final String fileName = sanitizeFileName(requestedName);
            if (!isExportFormat(fileName, mimeType) || base64 == null || base64.isEmpty()
                    || base64.length() > ((MAX_EXPORT_BYTES + 2) / 3) * 4) {
                reportExport(requestId, false, fileName, false, "Неподдерживаемый формат или файл больше 32 МБ");
                return;
            }
            fileExecutor.execute(() -> {
                try {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    if (bytes.length == 0 || bytes.length > MAX_EXPORT_BYTES) throw new IOException("Invalid file size");
                    Uri uri = saveToDownloads(fileName, mimeType, bytes);
                    String savedName = savedDisplayName(uri, fileName);
                    runOnUiThread(() -> finishExport(requestId, uri, savedName, mimeType, share));
                } catch (IOException | RuntimeException error) {
                    reportExport(requestId, false, fileName, false, "Не удалось записать файл в Загрузки");
                }
            });
        }

        @JavascriptInterface
        public void showExport(String requestId, boolean share) {
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                if (lastExport == null || !lastExport.requestId().equals(requestId)) {
                    Toast.makeText(MainActivity.this, "Откройте сохранённый файл в Загрузках", Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    openExport(lastExport, share);
                } catch (RuntimeException error) {
                    Toast.makeText(MainActivity.this, "Файл сохранён. Для открытия используйте папку Загрузки", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    private void reportSurveyLaser(String status, String name, Double value, String message) {
        if (webView == null || isDestroyed()) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("status", status);
            if (name != null) detail.put("name", name);
            if (value != null) detail.put("value", value);
            if (message != null) detail.put("message", message);
        } catch (org.json.JSONException error) {
            return;
        }
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('zamer-laser',{detail:" + detail + "}));", null);
    }

    private Uri saveToDownloads(String fileName, String mimeType, byte[] content) throws IOException {
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, EXPORT_DIRECTORY);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Could not create download entry");
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new FileNotFoundException("Could not open download entry");
                output.write(content);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (getContentResolver().update(uri, ready, null, null) != 1) throw new IOException("Could not publish download entry");
            return uri;
        } catch (IOException | RuntimeException error) {
            if (uri != null) {
                try { getContentResolver().delete(uri, null, null); }
                catch (RuntimeException cleanupFailure) { error.addSuppressed(cleanupFailure); }
            }
            throw error;
        }
    }

    private static boolean isExportFormat(String name, String mimeType) {
        String lower = name.toLowerCase(Locale.ROOT);
        return ("application/pdf".equals(mimeType) && lower.endsWith(".pdf"))
            || ("application/dxf".equals(mimeType) && lower.endsWith(".dxf"))
            || ("application/zip".equals(mimeType) && lower.endsWith(".zip"))
            || ("application/json".equals(mimeType) && lower.endsWith(".zamer"));
    }

    private String savedDisplayName(Uri uri, String fallback) {
        try (Cursor rows = getContentResolver().query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            if (rows != null && rows.moveToFirst() && !rows.isNull(0)) return rows.getString(0);
        } catch (RuntimeException ignored) {
            // The content was already written. Keep the requested name if the media index is unavailable.
        }
        return fallback;
    }

    private void finishExport(String requestId, Uri uri, String fileName, String mimeType, boolean share) {
        if (isDestroyed()) return;
        lastExport = new ExportedFile(requestId, uri, fileName, mimeType);
        boolean chooserOpened = false;
        String message = "";
        if (share) {
            try {
                openExport(lastExport, true);
                chooserOpened = true;
            } catch (RuntimeException error) {
                message = "Файл сохранён. Меню отправки открыть не удалось";
            }
        }
        reportExport(requestId, true, fileName, chooserOpened, message);
    }

    private void openExport(ExportedFile file, boolean share) {
        Intent action;
        if (share) {
            action = new Intent(Intent.ACTION_SEND);
            action.setType(file.mimeType());
            action.putExtra(Intent.EXTRA_STREAM, file.uri());
        } else {
            action = new Intent(Intent.ACTION_VIEW).setDataAndType(file.uri(), file.mimeType());
        }
        action.setClipData(ClipData.newUri(getContentResolver(), file.fileName(), file.uri()));
        action.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(action, share ? "Поделиться файлом" : "Открыть файл"));
    }

    private void reportExport(String requestId, boolean ok, String fileName, boolean chooserOpened, String message) {
        String callback = "window.zamerNativeExportResult?.(" + JSONObject.quote(requestId) + ", {ok:" + ok
            + ",filename:" + JSONObject.quote(fileName) + ",chooserOpened:" + chooserOpened
            + ",message:" + JSONObject.quote(message) + "})";
        runOnUiThread(() -> {
            if (webView != null && !isDestroyed()) webView.evaluateJavascript(callback, null);
        });
    }

    private static String sanitizeFileName(String name) {
        String safe = name == null ? "zamer-export" : name.replaceAll("[\\\\/:*?\"<>|]", "-").trim();
        return safe.isEmpty() ? "zamer-export" : safe;
    }

    private final class LocalAssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            return !"https".equalsIgnoreCase(uri.getScheme())
                || !"appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())
                || uri.getPath() == null || !uri.getPath().startsWith(APP_PATH_PREFIX);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return loadAsset(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return loadAsset(Uri.parse(url));
        }

        private WebResourceResponse loadAsset(Uri uri) {
            // INTERNET is for the native updater only; remote pages/resources
            // must never reach the WebView's JavaScript bridge.
            if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) return errorResponse(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || !path.startsWith(APP_PATH_PREFIX)) return errorResponse(403, "Forbidden");
            String relativePath = path.substring(APP_PATH_PREFIX.length());
            if (relativePath.trim().isEmpty()) relativePath = "index.html";
            if (relativePath.contains("..") || relativePath.startsWith("/")) return errorResponse(403, "Forbidden");
            try {
                String mimeType = mimeType(relativePath);
                String encoding = isTextMime(mimeType) ? "UTF-8" : null;
                InputStream stream = getAssets().open(relativePath);
                Map<String, String> headers = Collections.singletonMap("Cache-Control", "no-store");
                return new WebResourceResponse(mimeType, encoding, 200, "OK", headers, stream);
            } catch (IOException error) {
                return errorResponse(404, "Not found");
            }
        }

        private WebResourceResponse errorResponse(int status, String message) {
            return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                status,
                message,
                Collections.emptyMap(),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8))
            );
        }
    }

    private static String mimeType(String path) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(path).toLowerCase(Locale.ROOT);
        if ("js".equals(extension)) return "application/javascript";
        if ("svg".equals(extension)) return "image/svg+xml";
        if ("json".equals(extension)) return "application/json";
        if ("webmanifest".equals(extension)) return "application/manifest+json";
        String detected = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return detected == null ? "application/octet-stream" : detected;
    }

    private static boolean isTextMime(String mimeType) {
        return mimeType.startsWith("text/")
            || mimeType.contains("javascript")
            || mimeType.contains("json")
            || mimeType.contains("svg")
            || mimeType.contains("manifest");
    }
}
