package com.zamercad.offline;

/** UI-thread update intent: background checks never imply permission to install. */
final class UpdateFlow {
    enum Action { NONE, CHECK, DOWNLOAD }
    private Action stage = Action.NONE;
    private boolean interactive;
    private boolean cancelling;

    Action request(boolean available) {
        if (cancelling) return Action.NONE;
        interactive = true;
        if (busy()) return Action.NONE;
        stage = available ? Action.DOWNLOAD : Action.CHECK;
        return stage;
    }

    boolean startAutomaticCheck() {
        if (busy()) return false;
        stage = Action.CHECK;
        interactive = false;
        return true;
    }

    Action checked(boolean available) {
        if (stage != Action.CHECK) throw new IllegalStateException("No update check in progress");
        if (interactive && available) {
            stage = Action.DOWNLOAD;
            return stage;
        }
        finish();
        return Action.NONE;
    }

    boolean busy() { return stage != Action.NONE; }
    boolean interactive() { return interactive; }
    boolean cancelling() { return cancelling; }
    boolean downloading() { return stage == Action.DOWNLOAD; }

    void cancel() {
        interactive = false;
        cancelling = downloading();
    }

    void finish() {
        stage = Action.NONE;
        interactive = false;
        cancelling = false;
    }
}
