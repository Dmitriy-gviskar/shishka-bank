package ru.elkakvest.shishka;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
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

// Шишка Банк: WebView на весь экран поверх живого сайта.
// Данные (вход по коду) живут в localStorage — domStorage + персистентный профиль WebView.
public class MainActivity extends Activity {

    private static final String HOME = "https://elka-kvest-2026.ru/";
    private static final int FILE_CHOOSER_CODE = 51;
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
            // камера для встроенного QR-сканера (getUserMedia внутри WebView)
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
                    pendingRequest = request;
                    return;
                }
                request.grant(request.getResources());
            }

            // фото-задания: <input type=file capture=environment> — без этого коллбэка WebView
            // вообще не открывает выбор файла/камеру, клик по кнопке ничего не делает.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    File dir = new File(getCacheDir(), "task_photos");
                    if (!dir.exists()) dir.mkdirs();
                    File photo = File.createTempFile("photo_", ".jpg", dir);
                    cameraPhotoUri = FileProvider.getUriForFile(MainActivity.this,
                        "ru.elkakvest.shishka.fileprovider", photo);
                    Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                    camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    startActivityForResult(camera, FILE_CHOOSER_CODE);
                    return true;
                } catch (IOException e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        // диплинк: QR оплаты отсканирован камерой → приложение открывает нужный экран
        Uri deep = getIntent().getData();
        web.loadUrl(deep != null ? deep.toString() : HOME);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_CODE || filePathCallback == null) return;
        Uri result = (resultCode == RESULT_OK && cameraPhotoUri != null) ? cameraPhotoUri : null;
        filePathCallback.onReceiveValue(result != null ? new Uri[]{result} : null);
        filePathCallback = null;
        cameraPhotoUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (pendingRequest != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingRequest.grant(pendingRequest.getResources());
            else pendingRequest.deny();
            pendingRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
