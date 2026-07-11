package ru.elkakvest.shishka;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// Шишка Банк: WebView на весь экран поверх живого сайта.
// Данные (вход по коду) живут в localStorage — domStorage + персистентный профиль WebView.
public class MainActivity extends Activity {

    private static final String HOME = "https://elka-kvest-2026.ru/";
    private WebView web;
    private PermissionRequest pendingRequest;

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

        // камера для встроенного QR-сканера (getUserMedia внутри WebView)
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
                    pendingRequest = request;
                    return;
                }
                request.grant(request.getResources());
            }
        });

        // диплинк: QR оплаты отсканирован камерой → приложение открывает нужный экран
        Uri deep = getIntent().getData();
        web.loadUrl(deep != null ? deep.toString() : HOME);
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
