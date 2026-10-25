import { NextResponse } from "next/server";

/**
 * Escapes a value for safe CSV inclusion. Wraps in quotes if it contains
 * commas, quotes, or newlines, and doubles inner quotes per RFC 4180.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvResponse(
  filename: string,
  headers: string[],
  rows: (string | number | Date | null | undefined)[][],
): NextResponse {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
