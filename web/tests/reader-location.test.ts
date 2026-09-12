import { expect, test } from "bun:test";
import { readerLocation } from "../src/reader-location";
const path = `/api/providers/moodle/courses/7/modules/99/resources/${"a".repeat(64)}/preview`;
test("embedded reader accepts only owned preview endpoints and PDF/image kinds", () => {
  expect(readerLocation(`?${new URLSearchParams({path,kind:"pdf",name:"Guide.pdf",theme:"dark"})}`)).toEqual({path,kind:"pdf",name:"Guide.pdf",theme:"dark"});
  for (const bad of ["https://evil.test/file.pdf", "//evil.test/", "/api/status", path+"?token=secret", path.replace("/preview","/download")])
    expect(readerLocation(`?${new URLSearchParams({path:bad,kind:"pdf"})}`)).toBeUndefined();
  expect(readerLocation(`?${new URLSearchParams({path,kind:"html"})}`)).toBeUndefined();
});
