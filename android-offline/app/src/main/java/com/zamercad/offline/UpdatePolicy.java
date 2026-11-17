package com.zamercad.offline;

import java.net.URL;

/** Shared, JVM-testable trust boundaries for update sources. */
final class UpdatePolicy {
    static String repository(String text) {
        String value = text.trim().replaceFirst("^https://github\\.com/", "").replaceFirst("/+$", "");
        if (!value.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}")
            || value.endsWith("/.") || value.endsWith("/..")) throw new IllegalArgumentException("Введите имя/репозиторий или его адрес на github.com");
        return value;
    }

    static void requireReleaseUrl(String value, String repository) throws Exception {
        URL url = new URL(value);
        requireGithubHttps(url);
        if (!"github.com".equals(url.getHost())
            || !url.getPath().startsWith("/" + repository + "/releases/download/")) throw new Exception("Ссылка не принадлежит выбранному репозиторию GitHub");
    }

    static void requireGithubHttps(URL url) throws Exception {
        String host = url.getHost();
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null
            || (url.getPort() != -1 && url.getPort() != 443)
            || !(host.equals("api.github.com") || host.equals("github.com")
                || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com"))) throw new Exception("Недопустимый адрес загрузки");
    }
}
