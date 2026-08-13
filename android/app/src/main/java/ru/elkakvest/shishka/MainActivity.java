package ru.elkakvest.shishka;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.Manifest;
import android.provider.MediaStore;
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
    private static final int FILE_CHOOSER_CODE = 51;
    private static final int PERMISSION_CODE = 1;
    private WebView web;
    private PermissionRequest pendingRequest;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraPhotoUri;

    @SuppressLint("SetJavaScriptEnabled")
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

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !"elka-kvest-2026.ru".equals(u.getHost()); // чужие ссылки не открываем, свои — внутри
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            // фото-задания: галерея ИЛИ камера (раньше был только camera — часто пустой URI → «фото не выбрано»)
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                cameraPhotoUri = null;

                Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
                gallery.addCategory(Intent.CATEGORY_OPENABLE);
                gallery.setType("image/*");

                Intent camera = buildCameraIntent();
                Intent chooser = Intent.createChooser(gallery, "Фото для задания");
                if (camera != null) {
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{ camera });
                }
                try {
                    startActivityForResult(chooser, FILE_CHOOSER_CODE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    cameraPhotoUri = null;
                    return false;
                }
            }
        });

        Uri deep = getIntent().getData();
        web.loadUrl(deep != null ? deep.toString() : HOME);
    }

    private Intent buildCameraIntent() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            // без камеры всё равно даём галерею; камеру попросим при getUserMedia / следующем разе
            requestPermissions(new String[]{ Manifest.permission.CAMERA }, PERMISSION_CODE);
        }
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_CODE || filePathCallback == null) return;
        Uri result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = data.getData(); // галерея / файлы
                try {
                    grantUriPermission(getPackageName(), result, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {}
            } else if (cameraPhotoUri != null) {
                // камера писала в наш FileProvider — проверим, что файл не пустой
                try {
                    File f = new File(getCacheDir(), "task_photos");
                    // путь из URI: content://…/task_photos/photo_….jpg
                    String last = cameraPhotoUri.getLastPathSegment();
                    File photo = last != null ? new File(f, last) : null;
                    if (photo != null && photo.exists() && photo.length() > 0) result = cameraPhotoUri;
                } catch (Exception ignored) {
                    result = cameraPhotoUri;
                }
            }
        }
        ValueCallback<Uri[]> cb = filePathCallback;
        filePathCallback = null;
        cameraPhotoUri = null;
        cb.onReceiveValue(result != null ? new Uri[]{ result } : null);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
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
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
