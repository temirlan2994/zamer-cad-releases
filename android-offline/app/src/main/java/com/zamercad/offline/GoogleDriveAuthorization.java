package com.zamercad.offline;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Intent;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.util.List;
import java.util.function.BiConsumer;

final class GoogleDriveAuthorization {
    private static final int CHOOSE_ACCOUNT = 5042;
    private static final int GRANT_ACCESS = 5043;
    private static final String DRIVE_APP_DATA = "https://www.googleapis.com/auth/drive.appdata";
    private static final String EMAIL = "https://www.googleapis.com/auth/userinfo.email";

    private final Activity activity;
    private final BiConsumer<String, String> deliver;
    private String requestId;
    private boolean interactive;

    GoogleDriveAuthorization(Activity activity, BiConsumer<String, String> deliver) {
        this.activity = activity;
        this.deliver = deliver;
    }

    void request(String id, String email, boolean prompt) {
        if (requestId != null) {
            deliver.accept(id, "{\"error\":\"Вход Google уже открыт\"}");
            return;
        }
        requestId = id;
        interactive = prompt;
        if (!prompt && email.isBlank()) {
            finish("error", "Войдите через Google");
            return;
        }
        try {
            if (prompt) {
                Intent chooser = AccountManager.newChooseAccountIntent(null, null,
                    new String[]{"com.google"}, true, null, null, null, null);
                activity.startActivityForResult(chooser, CHOOSE_ACCOUNT);
            } else {
                authorize(email);
            }
        } catch (RuntimeException error) {
            fail(error);
        }
    }

    private void authorize(String email) {
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setAccount(new Account(email, "com.google"))
            .setRequestedScopes(List.of(new Scope(DRIVE_APP_DATA), new Scope(EMAIL), new Scope("openid")))
            .build();
        Identity.getAuthorizationClient(activity).authorize(request)
            .addOnSuccessListener(activity, result -> {
                if (!result.hasResolution()) {
                    accept(result);
                } else if (!interactive) {
                    finish("error", "Подтвердите вход через Google");
                } else {
                    try {
                        activity.startIntentSenderForResult(result.getPendingIntent().getIntentSender(),
                            GRANT_ACCESS, null, 0, 0, 0);
                    } catch (Exception error) {
                        fail(error);
                    }
                }
            })
            .addOnFailureListener(activity, this::fail);
    }

    boolean onActivityResult(int code, int result, Intent data) {
        if (code != CHOOSE_ACCOUNT && code != GRANT_ACCESS) return false;
        if (requestId == null) return true;
        if (result != Activity.RESULT_OK || data == null) {
            finish("error", "Вход Google отменён");
            return true;
        }
        try {
            if (code == CHOOSE_ACCOUNT) {
                String email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
                if (email == null || email.isBlank()) finish("error", "Выберите Google-аккаунт");
                else authorize(email);
            } else {
                AuthorizationClient client = Identity.getAuthorizationClient(activity);
                accept(client.getAuthorizationResultFromIntent(data));
            }
        } catch (ApiException | RuntimeException error) {
            fail(error);
        }
        return true;
    }

    private void accept(AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isBlank() || !result.getGrantedScopes().contains(DRIVE_APP_DATA)) {
            finish("error", "Разрешите приложению сохранять чертежи в Google Диске");
            return;
        }
        finish("token", token);
    }

    private void fail(Exception error) {
        if (error instanceof ApiException api && api.getStatusCode() == 10) {
            finish("error", "Google-вход ещё не настроен для подписи этой сборки");
            return;
        }
        finish("error", "Не удалось подключить Google. Проверьте интернет и Сервисы Google Play.");
    }

    private void finish(String key, String value) {
        String id = requestId;
        requestId = null;
        if (id != null) deliver.accept(id, "{" + JSONObject.quote(key) + ":" + JSONObject.quote(value) + "}");
    }
}
