package com.zamercad.offline;

import java.net.URI;

/**
 * What the app may do with the Zamer CAD website: open its pages in the
 * browser (subscription and payment) and call the license service.
 */
final class SitePolicy {
    static final String SITE_HOST = "zamer-cad.netlify.app";
    static final String LICENSE_PATH = "/api/license";

    private SitePolicy() {}

    /** The website page to open in the browser, or null for any other link. */
    static String siteUrl(String value) {
        if (value == null || value.isEmpty() || value.length() > 512) return null;
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || !SITE_HOST.equals(uri.getHost())
                || uri.getPort() != -1 || uri.getRawUserInfo() != null) return null;
            return uri.toASCIIString();
        } catch (Exception error) {
            return null;
        }
    }

    /** Whether a WebView request is a license check that may go to the network. */
    static boolean licenseRequest(String scheme, String host, int port, String userInfo, String path, String method) {
        return "https".equals(scheme) && SITE_HOST.equals(host) && port == -1 && userInfo == null
            && LICENSE_PATH.equals(path) && ("POST".equals(method) || "OPTIONS".equals(method));
    }
}
