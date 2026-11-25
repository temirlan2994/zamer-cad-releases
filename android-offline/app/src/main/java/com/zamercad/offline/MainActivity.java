package com.zamercad.offline;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.MotionEvent;
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
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 5041;
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String APP_PATH_PREFIX = "/assets/";
    private static final String EXPORT_DIRECTORY = Environment.DIRECTORY_DOWNLOADS + "/Zamer CAD";
    private static final int MAX_EXPORT_BYTES = 32 * 1024 * 1024;
    private static final String SPEN_INSERT_ACTION = "com.samsung.pen.INSERT";
    private static final String HANDLE_BACK_SCRIPT =
        "(function(){var home=document.getElementById('projectHome');" +
        "if(home&&home.hidden){var back=document.getElementById('backToProjectsButton');" +
        "if(back&&!back.closest('[inert]')&&!document.querySelector('dialog[open]')){back.click();return true;}}return false;})()";

    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout viewport;
    private AppUpdater updater;
    private GoogleDriveAuthorization googleDrive;
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
    private boolean sPenActive;
    private boolean sPenDetected;
    private boolean sPenReceiverRegistered;
    private boolean sPenHovering;
    private volatile boolean sPenButtonHandling = true;
    private final ArrayDeque<IncomingFile> incomingFiles = new ArrayDeque<>();
    private volatile IncomingFile activeIncomingFile;
    private int incomingFileCount;
    private boolean importUiReady;
    private boolean incomingFileSent;

    private record IncomingFile(String id, String name, Uri uri) {}

    private final BroadcastReceiver sPenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            handleSpenInsert(intent);
        }
    };

    private record ExportedFile(String requestId, Uri uri, String fileName, String mimeType) {}

    private record KeyboardViewport(boolean visible, int availableHeight) {
        String json() {
            return "{\"visible\":" + visible + ",\"availableHeight\":" + availableHeight + "}";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        updater = new AppUpdater(this, this::reportUpdateAvailability);
        surveyLaser = new SurveyLaser(this, this::reportSurveyLaser);
        getWindow().setStatusBarColor(Color.rgb(248, 250, 253));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        googleDrive = new GoogleDriveAuthorization(this, (id, result) -> {
            if (!isDestroyed()) webView.evaluateJavascript("window.zamerGoogleAuthorizationResult?.(" + JSONObject.quote(id) + "," + result + ");", null);
        });
        webView.setBackgroundColor(Color.rgb(248, 250, 253));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Android routes stylus proximity through dispatchHoverEvent, not the
        // generic-motion/touch listeners. Some WebViews expose it as a mouse
        // pointer in JavaScript, so forward the native coordinates explicitly.
        webView.setOnHoverListener((view, event) -> {
            noteSpenInput(event);
            reportSpenHover(event);
            return sPenButtonHandling && isSpenButtonMotion(event);
        });
        webView.setOnGenericMotionListener((view, event) -> {
            noteSpenInput(event);
            if (sPenHovering && (event.getActionMasked() == MotionEvent.ACTION_BUTTON_PRESS ||
                    event.getActionMasked() == MotionEvent.ACTION_BUTTON_RELEASE)) reportSpenHover(event);
            // The app handles the barrel action; do not also forward it as a
            // WebView secondary click. Samsung Air Command has its own setting.
            return sPenButtonHandling && isSpenButtonMotion(event);
        });
        webView.setOnTouchListener((view, event) -> {
            noteSpenInput(event);
            return false;
        });
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
                // File providers disagree on the MIME types for DXF and DWG.
                // The web importer validates the extension and contents.
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

        registerSpenReceiver();

        if (savedInstanceState == null) {
            webView.loadUrl(APP_ORIGIN + APP_PATH_PREFIX + "index.html?apk=1");
        } else {
            webView.restoreState(savedInstanceState);
        }
        handleOpenFileIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOpenFileIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void handleOpenFileIntent(Intent intent) {
        if (intent == null || (!Intent.ACTION_VIEW.equals(intent.getAction()) && !Intent.ACTION_SEND.equals(intent.getAction()))) return;
        Uri uri;
        try {
            uri = Intent.ACTION_VIEW.equals(intent.getAction()) ? intent.getData()
                : Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) uri = intent.getClipData().getItemAt(0).getUri();
        } catch (RuntimeException error) {
            uri = null;
        }
        if (uri == null || (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme()))) {
            Toast.makeText(this, "Не удалось получить файл. Откройте его из файлового менеджера.", Toast.LENGTH_LONG).show();
            return;
        }
        if (incomingFileCount >= 4) {
            Toast.makeText(this, "Сначала завершите открытие предыдущих файлов", Toast.LENGTH_LONG).show();
            return;
        }
        incomingFileCount++;
        final Uri fileUri = uri;
        final String mimeType = intent.getType();
        fileExecutor.execute(() -> {
            try {
                String name = fileUri.getLastPathSegment();
                long size = -1;
                try (Cursor rows = getContentResolver().query(fileUri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                    if (rows != null && rows.moveToFirst()) {
                        int nameColumn = rows.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int sizeColumn = rows.getColumnIndex(OpenableColumns.SIZE);
                        if (nameColumn >= 0 && !rows.isNull(nameColumn)) name = rows.getString(nameColumn);
                        if (sizeColumn >= 0 && !rows.isNull(sizeColumn)) size = rows.getLong(sizeColumn);
                    }
                } catch (RuntimeException ignored) {
                    // Some providers and file: URIs expose a readable stream
                    // without supporting metadata queries. Enforce size on read.
                }
                name = FileOpenPolicy.importName(name, mimeType);
                if (name == null) throw new IOException("Поддерживаются файлы DWG, DXF и ZAMER");
                if (size == 0 || size > FileOpenPolicy.MAX_BYTES) throw new IOException("Выберите непустой чертёж размером до 32 МБ");
                IncomingFile file = new IncomingFile(UUID.randomUUID().toString(), name, fileUri);
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    incomingFiles.add(file);
                    dispatchIncomingFile();
                });
            } catch (IOException | RuntimeException error) {
                runOnUiThread(() -> {
                    incomingFileCount--;
                    if (!isDestroyed()) Toast.makeText(this, error instanceof IOException ? error.getMessage() : "Не удалось прочитать файл. Попробуйте открыть его из файлового менеджера.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void dispatchIncomingFile() {
        if (!importUiReady || incomingFileSent || webView == null || isDestroyed()) return;
        if (activeIncomingFile == null) activeIncomingFile = incomingFiles.poll();
        IncomingFile file = activeIncomingFile;
        if (file == null) return;
        incomingFileSent = true;
        String url = APP_ORIGIN + APP_PATH_PREFIX + "_imports/" + file.id();
        String detail = "{\"id\":" + JSONObject.quote(file.id()) + ",\"name\":" + JSONObject.quote(file.name()) + ",\"url\":" + JSONObject.quote(url) + "}";
        webView.evaluateJavascript("window.zamerReceiveFile?.(" + detail + ");", null);
    }

    private void reportUpdateAvailability(String version) {
        if (webView != null && !isDestroyed()) {
            webView.evaluateJavascript("window.zamerUpdateAvailable?.(" + JSONObject.quote(version) + ");", null);
        }
    }

    private static boolean isSpenButtonMotion(MotionEvent event) {
        if (event.getPointerCount() == 0) return false;
        int tool = event.getToolType(0);
        if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return false;
        int buttons = event.getButtonState() | event.getActionButton();
        return (buttons & (MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_SECONDARY)) != 0;
    }

    private void noteSpenInput(MotionEvent event) {
        if (event == null) return;
        boolean stylus = false;
        for (int index = 0; index < event.getPointerCount(); index++) {
            int type = event.getToolType(index);
            if (type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER) {
                stylus = true;
                break;
            }
        }
        if (!stylus || (sPenDetected && sPenActive)) return;
        sPenDetected = true;
        sPenActive = true;
        dispatchSpenState();
    }

    private void handleSpenInsert(Intent intent) {
        if (intent == null || !SPEN_INSERT_ACTION.equals(intent.getAction()) || !intent.hasExtra("penInsert")) return;
        boolean inserted = intent.getBooleanExtra("penInsert", true);
        sPenDetected = true;
        sPenActive = !inserted;
        dispatchSpenState();
        if (inserted) clearSpenHover();
    }

    private void reportSpenHover(MotionEvent event) {
        if (webView == null || isDestroyed() || event.getPointerCount() == 0) return;
        int type = event.getToolType(0);
        if (type != MotionEvent.TOOL_TYPE_STYLUS && type != MotionEvent.TOOL_TYPE_ERASER) return;
        if (event.getActionMasked() == MotionEvent.ACTION_HOVER_EXIT) {
            clearSpenHover();
            return;
        }
        float x = event.getX();
        float y = event.getY();
        if (!Float.isFinite(x) || !Float.isFinite(y) || webView.getWidth() <= 0 || webView.getHeight() <= 0) return;
        sPenHovering = true;
        String detail = "{\"hovering\":true,\"x\":" + x + ",\"y\":" + y +
            ",\"width\":" + webView.getWidth() + ",\"height\":" + webView.getHeight() +
            ",\"buttons\":" + event.getButtonState() + "}";
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('zamer-spen-hover',{detail:" + detail + "}));", null);
    }

    private void clearSpenHover() {
        sPenHovering = false;
        if (webView != null && !isDestroyed()) webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('zamer-spen-hover',{detail:{hovering:false}}));", null);
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerSpenReceiver() {
        IntentFilter filter = new IntentFilter(SPEN_INSERT_ACTION);
        try {
            Intent sticky = Build.VERSION.SDK_INT >= 33
                ? registerReceiver(sPenReceiver, filter, Context.RECEIVER_EXPORTED)
                : registerReceiver(sPenReceiver, filter);
            sPenReceiverRegistered = true;
            if (sticky != null) handleSpenInsert(sticky);
        } catch (RuntimeException ignored) {
            sPenReceiverRegistered = false;
        }
    }

    private String sPenStateJson() {
        boolean samsung = Build.MANUFACTURER != null && Build.MANUFACTURER.toLowerCase(Locale.ROOT).contains("samsung");
        return "{\"supported\":" + (samsung || sPenDetected) +
            ",\"detected\":" + sPenDetected + ",\"active\":" + sPenActive + "}";
    }

    private void dispatchSpenState() {
        if (webView == null || isDestroyed()) return;
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('zamer-spen-state',{detail:" + sPenStateJson() + "}));",
            null
        );
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
        if (googleDrive.onActivityResult(requestCode, resultCode, data)) return;
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
        if (webView == null || isDestroyed()) {
            finishBackNavigation();
            return;
        }
        webView.evaluateJavascript(HANDLE_BACK_SCRIPT, handled -> {
            if (!"true".equals(handled) && !isFinishing() && !isDestroyed()) finishBackNavigation();
        });
    }

    private void finishBackNavigation() {
        if (webView != null && !isDestroyed() && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (updater != null) updater.onResume();
        dispatchSpenState();
    }

    @Override
    protected void onPause() {
        clearSpenHover();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (sPenReceiverRegistered) {
            try {
                unregisterReceiver(sPenReceiver);
            } catch (RuntimeException ignored) {
                // The Samsung pen service may disappear while the activity is stopping.
            }
            sPenReceiverRegistered = false;
        }
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
        public void setSpenButtonHandling(boolean handled) {
            sPenButtonHandling = handled;
        }

        @JavascriptInterface
        public void openSpenSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
                catch (RuntimeException error) { Toast.makeText(MainActivity.this, "Откройте настройки телефона → Дополнительные функции → S Pen", Toast.LENGTH_LONG).show(); }
            });
        }

        @JavascriptInterface
        public void readyForImports() {
            runOnUiThread(() -> {
                importUiReady = true;
                dispatchIncomingFile();
            });
        }

        @JavascriptInterface
        public void completeFileImport(String id) {
            runOnUiThread(() -> {
                if (activeIncomingFile == null || !activeIncomingFile.id().equals(id)) return;
                activeIncomingFile = null;
                incomingFileSent = false;
                incomingFileCount--;
                dispatchIncomingFile();
            });
        }

        @JavascriptInterface
        public void authorizeGoogle(String id, String email, boolean interactive) {
            runOnUiThread(() -> googleDrive.request(id, email, interactive));
        }

        @JavascriptInterface
        public String keyboardViewport() {
            return keyboardViewport.json();
        }

        @JavascriptInterface
        public String spenState() {
            return sPenStateJson();
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
        public String availableUpdateVersion() {
            return updater.availableVersion();
        }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> {
                if (webView == null || isDestroyed()) return;
                webView.requestFocus();
                // Native hover-button events are not WebView user gestures.
                // Show the IME after the focused HTML input creates its connection.
                webView.post(() -> {
                    if (webView == null || isDestroyed() || !webView.hasFocus()) return;
                    InputMethodManager keyboard = getSystemService(InputMethodManager.class);
                    if (keyboard != null) keyboard.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                });
            });
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
            || ("application/acad".equals(mimeType) && lower.endsWith(".dwg"))
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

    private static boolean isGoogleDriveFetch(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (request.isForMainFrame() || !"https".equals(uri.getScheme()) || uri.getPort() != -1 || uri.getUserInfo() != null) return false;
        String path = uri.getPath();
        if (path == null) return false;
        String method = request.getMethod();
        boolean preflight = "OPTIONS".equals(method);
        boolean allowed;
        if ("openidconnect.googleapis.com".equals(uri.getHost())) {
            allowed = "/v1/userinfo".equals(path) && (preflight || "GET".equals(method));
        } else if ("www.googleapis.com".equals(uri.getHost())) {
            allowed = switch (path) {
                case "/drive/v3/files", "/drive/v3/files/generateIds" -> preflight || "GET".equals(method);
                case "/upload/drive/v3/files" -> preflight || "POST".equals(method);
                default -> path.matches("/drive/v3/files/[a-zA-Z0-9_-]{1,80}") &&
                    (preflight || "GET".equals(method) || "DELETE".equals(method));
            };
        } else {
            return false;
        }
        // Bearer fetches and their CORS preflight are admitted. Remote frame and
        // script loads cannot set this header and remain blocked from the bridge.
        return allowed && (preflight || request.getRequestHeaders().entrySet().stream().anyMatch(header ->
            "Authorization".equalsIgnoreCase(header.getKey()) && header.getValue().startsWith("Bearer ")));
    }

    private final class LocalAssetClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            importUiReady = false;
            incomingFileSent = false;
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            dispatchSpenState();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            return !"https".equalsIgnoreCase(uri.getScheme())
                || !"appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())
                || uri.getPath() == null || !uri.getPath().startsWith(APP_PATH_PREFIX);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (isGoogleDriveFetch(request)) return null;
            return loadAsset(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return loadAsset(Uri.parse(url));
        }

        private WebResourceResponse loadAsset(Uri uri) {
            // Only packaged resources may load as documents in this WebView.
            if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) return errorResponse(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || !path.startsWith(APP_PATH_PREFIX)) return errorResponse(403, "Forbidden");
            String relativePath = path.substring(APP_PATH_PREFIX.length());
            if (relativePath.startsWith("_imports/")) {
                IncomingFile file = activeIncomingFile;
                if (file == null || !relativePath.equals("_imports/" + file.id())) return errorResponse(404, "Not found");
                try {
                    InputStream stream = getContentResolver().openInputStream(file.uri());
                    if (stream == null) return errorResponse(404, "Not found");
                    return new WebResourceResponse("application/octet-stream", null, 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"), FileOpenPolicy.bounded(stream, FileOpenPolicy.MAX_BYTES));
                } catch (IOException | RuntimeException error) {
                    return errorResponse(400, "Could not read drawing");
                }
            }
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
