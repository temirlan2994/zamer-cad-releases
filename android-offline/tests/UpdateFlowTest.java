package com.zamercad.offline;

public final class UpdateFlowTest {
    private static int checks;
    private static void expect(boolean condition) {
        if (!condition) throw new AssertionError("Update flow check " + (checks + 1));
        checks++;
    }

    public static void main(String[] args) {
        UpdateFlow flow = new UpdateFlow();
        expect(flow.startAutomaticCheck());
        expect(!flow.interactive());
        expect(flow.checked(true) == UpdateFlow.Action.NONE);
        expect(!flow.busy()); // A background check must never start an installation.

        expect(flow.request(false) == UpdateFlow.Action.CHECK);
        expect(flow.request(false) == UpdateFlow.Action.NONE); // Double tap: one request.
        expect(flow.checked(true) == UpdateFlow.Action.DOWNLOAD);
        expect(flow.interactive() && flow.downloading());
        expect(!flow.startAutomaticCheck());
        expect(flow.request(true) == UpdateFlow.Action.NONE);
        flow.finish();

        expect(flow.startAutomaticCheck());
        expect(flow.request(false) == UpdateFlow.Action.NONE); // Join a running background check.
        expect(flow.interactive());
        expect(flow.checked(true) == UpdateFlow.Action.DOWNLOAD);
        flow.finish();

        expect(flow.request(true) == UpdateFlow.Action.DOWNLOAD); // Known update skips checking.
        flow.cancel();
        expect(flow.cancelling() && !flow.interactive());
        expect(flow.request(true) == UpdateFlow.Action.NONE); // Don't revive a cancelled download.
        expect(!flow.interactive());
        flow.finish();
        expect(flow.request(true) == UpdateFlow.Action.DOWNLOAD); // Retry after completion/failure.
        flow.finish();

        expect(flow.request(false) == UpdateFlow.Action.CHECK);
        flow.cancel();
        expect(flow.checked(true) == UpdateFlow.Action.NONE); // Late response cannot install.
        expect(!flow.busy());

        expect(flow.request(false) == UpdateFlow.Action.CHECK);
        flow.cancel();
        expect(flow.request(false) == UpdateFlow.Action.NONE); // Explicit retry can rejoin the check.
        expect(flow.checked(true) == UpdateFlow.Action.DOWNLOAD);
        flow.finish();

        expect(flow.request(false) == UpdateFlow.Action.CHECK);
        expect(flow.checked(false) == UpdateFlow.Action.NONE); // Already current releases stop here.
        expect(!flow.busy());
        System.out.println("Update flow: " + checks + " checks passed");
    }
}
