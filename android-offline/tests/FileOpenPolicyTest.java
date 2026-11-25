package com.zamercad.offline;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

public final class FileOpenPolicyTest {
    private static int checks;

    private static void check(boolean condition) {
        checks++;
        if (!condition) throw new AssertionError("Failed check " + checks);
    }

    private static void tooLarge(InputStream stream) throws Exception {
        try (stream) {
            stream.readAllBytes();
            throw new AssertionError("Oversized stream was accepted");
        } catch (IOException expected) { checks++; }
    }

    public static void main(String[] args) throws Exception {
        check(FileOpenPolicy.MAX_BYTES == 32 * 1024 * 1024);
        for (String name : new String[] { "План.DWG", "drawing.dxf", "project.zamer", "backup.json" }) {
            check(name.equals(FileOpenPolicy.importName(name, "application/octet-stream")));
        }
        check("План.dwg".equals(FileOpenPolicy.importName("/storage/downloads/План.dwg", null)));
        check("План.dxf".equals(FileOpenPolicy.importName("C:\\files\\План.dxf", null)));
        check("План.dxf".equals(FileOpenPolicy.importName("План\n.dxf", null)));
        check("drawing.dwg".equals(FileOpenPolicy.importName("drawing", "image/vnd.dwg")));
        check("Чертёж.dxf".equals(FileOpenPolicy.importName(null, "application/dxf")));
        check("project.zamer".equals(FileOpenPolicy.importName("project", "application/x-zamer")));
        check(FileOpenPolicy.importName("picture.png", "application/octet-stream") == null);
        check(FileOpenPolicy.importName("document.txt", "application/acad") == null);
        check(FileOpenPolicy.importName("unknown", "application/octet-stream") == null);
        byte[] bytes = new byte[] { 0, 1, 2, 3 };
        try (InputStream stream = FileOpenPolicy.bounded(new ByteArrayInputStream(bytes), 4)) {
            check(Arrays.equals(stream.readAllBytes(), bytes));
        }
        tooLarge(FileOpenPolicy.bounded(new ByteArrayInputStream(new byte[5]), 4));
        try (InputStream stream = FileOpenPolicy.bounded(new ByteArrayInputStream(new byte[5]), 4)) {
            check(stream.read() == 0);
            check(stream.skip(3) == 3);
            try { stream.read(); throw new AssertionError("Single byte read exceeded limit"); }
            catch (IOException expected) { checks++; }
        }
        System.out.println("File open policy: " + checks + " checks passed");
    }
}
