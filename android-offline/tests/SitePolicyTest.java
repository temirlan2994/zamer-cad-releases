package com.zamercad.offline;

public final class SitePolicyTest {
    private static int checks;

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }

    public static void main(String[] args) {
        check("https://zamer-cad.netlify.app/?buy=year".equals(SitePolicy.siteUrl("https://zamer-cad.netlify.app/?buy=year")), "checkout page");
        check("https://zamer-cad.netlify.app/#pricing".equals(SitePolicy.siteUrl("https://zamer-cad.netlify.app/#pricing")), "pricing anchor");
        for (String url : new String[]{
            null, "", "http://zamer-cad.netlify.app/", "https://zamer-cad.netlify.app.evil.test/",
            "https://evil.test/?u=https://zamer-cad.netlify.app/", "https://user@zamer-cad.netlify.app/",
            "https://zamer-cad.netlify.app:444/", "intent://zamer-cad.netlify.app/#Intent;end", "javascript:alert(1)",
            "file:///sdcard/a.html", "https://zamer-cad.netlify.app/" + "a".repeat(600)
        }) check(SitePolicy.siteUrl(url) == null, "rejected link " + url);

        check(SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", -1, null, "/api/license", "POST"), "license check");
        check(SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", -1, null, "/api/license", "OPTIONS"), "license preflight");
        check(!SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", -1, null, "/api/license", "GET"), "GET");
        check(!SitePolicy.licenseRequest("http", "zamer-cad.netlify.app", -1, null, "/api/license", "POST"), "http");
        check(!SitePolicy.licenseRequest("https", "evil.test", -1, null, "/api/license", "POST"), "other host");
        check(!SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", 8443, null, "/api/license", "POST"), "port");
        check(!SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", -1, "user", "/api/license", "POST"), "user info");
        check(!SitePolicy.licenseRequest("https", "zamer-cad.netlify.app", -1, null, "/api/projects", "POST"), "other path");
        System.out.println("Site policy: " + checks + " checks passed");
    }
}
