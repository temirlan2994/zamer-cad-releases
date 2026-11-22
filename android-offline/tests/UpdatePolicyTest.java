package com.zamercad.offline;

import java.net.URL;

public final class UpdatePolicyTest {
    interface Checked { void run() throws Exception; }
    private static int checks;
    static void reject(Checked action) throws Exception {
        try { action.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Unsafe update input was accepted");
    }
    public static void main(String[] args) throws Exception {
        if (!"owner/zamer-releases".equals(UpdatePolicy.repository("https://github.com/owner/zamer-releases/"))) throw new AssertionError();
        checks++;
        for (String repo : new String[]{"", "../repo", "owner/..", "owner/.", "owner/repo/other", "https://evil.test/owner/repo", "owner/repo?token=x"}) reject(() -> UpdatePolicy.repository(repo));
        UpdatePolicy.requireReleaseUrl("https://github.com/owner/repo/releases/download/v1/update.json", "owner/repo"); checks++;
        for (String url : new String[]{
            "http://github.com/owner/repo/releases/download/v1/a.apk",
            "https://github.com:444/owner/repo/releases/download/v1/a.apk",
            "https://user:password@github.com/owner/repo/releases/download/v1/a.apk",
            "https://github.com.evil.test/owner/repo/releases/download/v1/a.apk",
            "https://github.com/other/repo/releases/download/v1/a.apk",
            "https://github.com/owner/repository/releases/download/v1/a.apk",
            "https://github.com/owner/repo/blob/main/a.apk"
        }) reject(() -> UpdatePolicy.requireReleaseUrl(url, "owner/repo"));
        for (String url : new String[]{"https://api.github.com/repos/owner/repo/releases/latest", "https://release-assets.githubusercontent.com/asset?a=1", "https://objects.githubusercontent.com/asset"}) { UpdatePolicy.requireGithubHttps(new URL(url)); checks++; }
        for (String url : new String[]{"http://release-assets.githubusercontent.com/a", "https://localhost/a", "https://127.0.0.1/a", "file:///tmp/a", "https://release-assets.githubusercontent.com.evil.test/a"}) reject(() -> UpdatePolicy.requireGithubHttps(new URL(url)));
        System.out.println("Update policy: " + checks + " checks passed");
    }
}
