package com.zamercad.offline;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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

    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout viewport;
    private AppUpdater updater;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        updater = new AppUpdater(this);
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
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                    insets.getSystemWindowInsetLeft(),
                    insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(),
                    insets.getSystemWindowInsetBottom()
                );
            }
            return insets.consumeSystemWindowInsets().consumeDisplayCutout();
        });
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
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "application/octet-stream", "text/plain" });
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
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
        if (webView != null) {
            webView.removeJavascriptInterface("ZamerAndroid");
            webView.destroy();
        }
        fileExecutor.shutdown();
        super.onDestroy();
    }

    private final class AndroidBridge {
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
        public void saveTextFile(String requestedName, String requestedMimeType, String content) {
            final String fileName = sanitizeFileName(requestedName);
            final String mimeType = requestedMimeType == null || requestedMimeType.isBlank()
                ? "application/octet-stream"
                : requestedMimeType;
            final String text = content == null ? "" : content;
            fileExecutor.execute(() -> saveToDownloads(fileName, mimeType, text));
        }
    }

    private void saveToDownloads(String fileName, String mimeType, String content) {
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Zamer CAD");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Could not create download entry");
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new FileNotFoundException("Could not open download entry");
                output.write(content.getBytes(StandardCharsets.UTF_8));
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, ready, null, null);
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "Сохранено: Загрузки/Zamer CAD/" + fileName, Toast.LENGTH_LONG).show());
        } catch (Exception error) {
            if (uri != null) getContentResolver().delete(uri, null, null);
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "Не удалось сохранить файл", Toast.LENGTH_LONG).show());
        }
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
            if (relativePath.isBlank()) relativePath = "index.html";
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
