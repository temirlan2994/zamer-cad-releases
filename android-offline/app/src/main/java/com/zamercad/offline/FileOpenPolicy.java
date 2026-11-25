package com.zamercad.offline;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

final class FileOpenPolicy {
    static final int MAX_BYTES = 32 * 1024 * 1024;

    static String importName(String displayName, String mimeType) {
        String name = displayName == null ? "" : displayName.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isEmpty()) name = "Чертёж";
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".dwg") || lower.endsWith(".dxf") || lower.endsWith(".zamer") || lower.endsWith(".json")) return name;
        if (!name.contains(".")) {
            String extension = switch (mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT)) {
                case "application/acad", "application/x-acad", "application/autocad_dwg", "application/dwg", "application/vnd.dwg", "application/x-dwg", "image/vnd.dwg", "image/x-dwg" -> ".dwg";
                case "application/dxf", "application/vnd.dxf", "application/x-dxf", "image/vnd.dxf", "image/x-dxf" -> ".dxf";
                case "application/vnd.zamercad.project+json", "application/x-zamer" -> ".zamer";
                default -> "";
            };
            if (!extension.isEmpty()) return name + extension;
        }
        return null;
    }

    static InputStream bounded(InputStream source, int maximum) {
        return new FilterInputStream(source) {
            private long count;

            private void consumed(long length) throws IOException {
                if (length > 0) count += length;
                if (count > maximum) throw new IOException("Файл больше 32 МБ");
            }

            @Override
            public int read() throws IOException {
                int value = in.read();
                consumed(value < 0 ? 0 : 1);
                return value;
            }

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                int read = in.read(buffer, offset, (int) Math.min(length, Math.max(1, maximum - count + 1)));
                consumed(read);
                return read;
            }

            @Override
            public long skip(long length) throws IOException {
                long skipped = in.skip(Math.min(length, Math.max(1, maximum - count + 1)));
                consumed(skipped);
                return skipped;
            }
        };
    }
}
