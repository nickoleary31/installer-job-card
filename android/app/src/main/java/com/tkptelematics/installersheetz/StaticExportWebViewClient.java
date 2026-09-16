package com.tkptelematics.installersheetz;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Map;

/**
 * Phase 2A.1 fix. Capacitor's WebViewLocalServer resolves any extensionless
 * request path other than "/" straight to the app's ROOT index.html when
 * html5mode is on (the default) — there is no built-in directory-index
 * resolution to "<path>/index.html" the way a normal static file host would
 * do it. That matches Capacitor's usual single-page-app assumption (one
 * index.html, client router owns everything), but mobile-web's static
 * export is a genuine multi-document Next.js export: every route has its
 * own real prerendered index.html. Left unfixed, a hard navigation, a page
 * reload, or a future WebView-state restoration targeting a clean route URL
 * (e.g. https://localhost/installs) would silently load the Login screen
 * instead of the requested screen, with no error.
 *
 * Fix: for a main-frame request to an extensionless, non-root path — and
 * ONLY when that request's origin is this app's own packaged local origin —
 * rewrite the URL to "<path>/index.html" (preserving query string; a
 * fragment, if any, never reaches this layer at all, since fragments are a
 * client-side-only concept the WebView's networking stack strips before any
 * request is made) before handing it to Capacitor's own local server. That
 * URL now has a real extension, so it flows through the server's existing,
 * already-correct exact-asset-match path — the same one that already serves
 * every other .html/.js/.css asset — with the same JS-bridge injection any
 * other HTML response gets. Client-side Next.js navigation between routes
 * is unaffected: it never issues a real network request for the route path.
 *
 * Origin scoping is load-bearing, not cosmetic: without it, a future
 * main-frame navigation to an allow-listed *external* host (Capacitor
 * supports loading trusted external content in the same WebView via
 * server.allowNavigation, e.g. an OAuth or payment page) would have its
 * path silently rewritten too — https://example.com/account/reset would
 * become https://example.com/account/reset/index.html, breaking a page we
 * don't own and have no reason to touch. bridge.getScheme()/getHost() are
 * Capacitor's own public accessors for the local origin's scheme/hostname
 * (config-driven, not hardcoded "https"/"localhost"), and
 * bridge.getServerUrl() is non-null only in the Phase 1A smoke-test
 * server.url escape hatch, where the app is loading a real remote Next.js
 * server (Preview deployment) that has its own correct routing and must
 * never be touched by this class either. This mirrors the same
 * server-url-null-and-host-match pattern WebViewLocalServer itself uses
 * internally (see isMainUrl()) — not a new invented check.
 */
public class StaticExportWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public StaticExportWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return bridge.getLocalServer().shouldInterceptRequest(rewriteIfNeeded(request));
    }

    private WebResourceRequest rewriteIfNeeded(WebResourceRequest request) {
        if (!request.isForMainFrame() || !isLocalPackagedOrigin(request.getUrl())) {
            return request;
        }

        Uri url = request.getUrl();
        String path = url.getPath();
        String lastSegment = url.getLastPathSegment();
        boolean extensionless = lastSegment == null || !lastSegment.contains(".");

        if (path == null || path.equals("/") || !extensionless) {
            return request;
        }

        String rewrittenPath = (path.endsWith("/") ? path : path + "/") + "index.html";
        Uri rewrittenUrl = url.buildUpon().path(rewrittenPath).build();
        return new RewrittenUrlRequest(request, rewrittenUrl);
    }

    /**
     * True only for the app's own packaged local origin — never for an
     * external host, and never while loaded from the Phase 1A server.url
     * escape hatch (a real remote server with its own correct routing).
     */
    private boolean isLocalPackagedOrigin(Uri url) {
        if (bridge.getServerUrl() != null) {
            return false;
        }
        return bridge.getScheme().equalsIgnoreCase(url.getScheme()) && bridge.getHost().equalsIgnoreCase(url.getHost());
    }

    /** Delegates everything except getUrl() to the original system-provided request. */
    private static class RewrittenUrlRequest implements WebResourceRequest {

        private final WebResourceRequest original;
        private final Uri url;

        RewrittenUrlRequest(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return original.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return original.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return original.hasGesture();
        }

        @Override
        public String getMethod() {
            return original.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return original.getRequestHeaders();
        }
    }
}
