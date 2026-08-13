package ru.elkakvest.shishka;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

// Шишка Банк: WebView на весь экран поверх живого сайта.
// Данные (вход по коду) живут в localStorage — domStorage + персистентный профиль WebView.
public class MainActivity extends Activity {

    private static final String HOME = "https://elka-kvest-2026.ru/";
    private static final String PREFS = PushService.PREFS;
    private static final int FILE_CHOOSER_CODE = 51;
    private static final int PERMISSION_CODE = 1;
    private static final int NOTIF_PERMISSION_CODE = 2;
    private WebView web;
    private PermissionRequest pendingRequest;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraPhotoUri;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);
        web.setBackgroundColor(Color.parseColor("#33402a"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        web.addJavascriptInterface(new Bridge(), "ShishkaNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !"elka-kvest-2026.ru".equals(u.getHost());
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                rememberUrl(url);
                // подтянуть deviceToken из localStorage → нативный пуш-сервис
                view.evaluateJavascript(
                    "(function(){try{var t=localStorage.getItem('deviceToken')||'';"
                        + "if(t&&window.ShishkaNative)ShishkaNative.setDeviceToken(t);}catch(e){}})();",
                    null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    try { filePathCallback.onReceiveValue(null); } catch (Exception ignored) {}
                }
                filePathCallback = callback;
                cameraPhotoUri = null;

                try {
                    // Съёмка — только через getUserMedia на странице.
                    // Сюда попадаем для «Из галереи»: камеру в chooser НЕ добавляем —
                    // на Xiaomi/MIUI EXTRA_INITIAL_INTENTS с камерой часто сразу открывает камеру.
                    Intent pick = buildGalleryIntent();
                    startActivityForResult(
                        Intent.createChooser(pick, "Фото из галереи"),
                        FILE_CHOOSER_CODE);
                    return true;
                } catch (Throwable t) {
                    ValueCallback<Uri[]> cb = filePathCallback;
                    filePathCallback = null;
                    cameraPhotoUri = null;
                    if (cb != null) {
                        try { cb.onReceiveValue(null); } catch (Exception ignored) {}
                    }
                    return true;
                }
            }
        });

        askNotificationPermission();
        PushService.start(this);

        Uri deep = getIntent().getData();
        if (deep != null && "elka-kvest-2026.ru".equals(deep.getHost())) {
            web.loadUrl(deep.toString());
        } else {
            String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString("url", null);
            if (saved != null && saved.startsWith(HOME)) web.loadUrl(saved);
            else web.loadUrl(HOME);
        }
    }

    private final class Bridge {
        @JavascriptInterface
        public void setDeviceToken(String token) {
            if (token == null) token = "";
            SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
            String prev = p.getString(PushService.KEY_TOKEN, "");
            p.edit().putString(PushService.KEY_TOKEN, token).apply();
            if (!token.isEmpty() && !token.equals(prev)) {
                runOnUiThread(() -> PushService.start(MainActivity.this));
            }
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, NOTIF_PERMISSION_CODE);
    }

    private Intent buildGalleryIntent() {
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                Intent pick = new Intent("android.provider.action.PICK_IMAGES");
                pick.setType("image/*");
                if (pick.resolveActivity(getPackageManager()) != null) return pick;
            } catch (Exception ignored) {}
        }
        Intent pick = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        pick.setType("image/*");
        if (pick.resolveActivity(getPackageManager()) != null) return pick;

        Intent get = new Intent(Intent.ACTION_GET_CONTENT);
        get.addCategory(Intent.CATEGORY_OPENABLE);
        get.setType("image/*");
        return get;
    }

    private Intent buildCameraIntent() {
        try {
            File dir = new File(getCacheDir(), "task_photos");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File photo = File.createTempFile("photo_", ".jpg", dir);
            cameraPhotoUri = FileProvider.getUriForFile(
                this, "ru.elkakvest.shishka.fileprovider", photo);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            List<ResolveInfo> cams = getPackageManager()
                .queryIntentActivities(camera, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo ri : cams) {
                grantUriPermission(
                    ri.activityInfo.packageName,
                    cameraPhotoUri,
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            return cams.isEmpty() ? null : camera;
        } catch (IOException e) {
            cameraPhotoUri = null;
            return null;
        } catch (Throwable t) {
            cameraPhotoUri = null;
            return null;
        }
    }

    private void handleWebPermission(PermissionRequest request) {
        pendingRequest = request;
        ArrayList<String> needed = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                if (!needed.contains(Manifest.permission.CAMERA)) needed.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                if (!needed.contains(Manifest.permission.RECORD_AUDIO)) needed.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        if (needed.isEmpty()) {
            request.grant(request.getResources());
            pendingRequest = null;
            return;
        }
        requestPermissions(needed.toArray(new String[0]), PERMISSION_CODE);
    }

    private void rememberUrl(String url) {
        if (url == null || !url.startsWith(HOME)) return;
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("url", url).apply();
        } catch (Exception ignored) {}
    }

    @Override
    protected void onPause() {
        try {
            if (web != null) {
                rememberUrl(web.getUrl());
                web.onPause();
            }
        } catch (Exception ignored) {}
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        try { if (web != null) web.onResume(); } catch (Exception ignored) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri deep = intent.getData();
        if (deep != null && "elka-kvest-2026.ru".equals(deep.getHost()) && web != null) {
            web.loadUrl(deep.toString());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_CODE) return;
        ValueCallback<Uri[]> cb = filePathCallback;
        filePathCallback = null;
        if (cb == null) return;

        Uri result = null;
        try {
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) {
                    result = data.getData();
                    try {
                        grantUriPermission(getPackageName(), result, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignored) {}
                } else if (cameraPhotoUri != null) {
                    try {
                        File f = new File(getCacheDir(), "task_photos");
                        String last = cameraPhotoUri.getLastPathSegment();
                        File photo = last != null ? new File(f, last) : null;
                        if (photo != null && photo.exists() && photo.length() > 0) result = cameraPhotoUri;
                    } catch (Exception ignored) {
                        result = cameraPhotoUri;
                    }
                } else if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    result = data.getClipData().getItemAt(0).getUri();
                }
            }
        } catch (Throwable ignored) {
            result = null;
        }
        cameraPhotoUri = null;
        try { cb.onReceiveValue(result != null ? new Uri[]{ result } : null); }
        catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == NOTIF_PERMISSION_CODE) {
            PushService.start(this);
            return;
        }
        if (code != PERMISSION_CODE || pendingRequest == null) return;
        boolean ok = res.length > 0;
        for (int r : res) {
            if (r != PackageManager.PERMISSION_GRANTED) { ok = false; break; }
        }
        if (ok) pendingRequest.grant(pendingRequest.getResources());
        else pendingRequest.deny();
        pendingRequest = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
