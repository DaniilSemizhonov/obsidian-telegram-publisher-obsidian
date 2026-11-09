import assert from "node:assert/strict";
import test from "node:test";
import { attachmentKeys, backendUrl, channelFor, localFields, multipartImage } from "../src/protocol.ts";

test("API credentials are only sent through HTTPS or a loopback tunnel", () => {
  assert.equal(backendUrl(" http://127.0.0.1:8000/ "), "http://127.0.0.1:8000");
  assert.equal(backendUrl("https://example.com/publisher"), "https://example.com/publisher");
  for (const value of ["http://example.com", "https://user@example.com", "https://example.com/?token=x"]) {
    assert.throws(() => backendUrl(value));
  }
});

test("attachment names match decoded Markdown links and skip external references", () => {
  assert.deepEqual(attachmentKeys("../assets/Example%20quiz.png"), ["../assets/Example%20quiz.png", "../assets/Example quiz.png"]);
  assert.deepEqual(attachmentKeys("https://example.com/image.png"), []);
  assert.deepEqual(attachmentKeys("/etc/file.png"), []);
});

test("multipart uploads preserve binary image bytes", async () => {
  const bytes = new Uint8Array([0, 128, 255, 10]);
  const { body, contentType } = multipartImage(bytes.buffer, "png");
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  const image = form.get("image");
  assert.ok(image instanceof File);
  assert.equal(image.name, "image.png");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.throws(() => multipartImage(bytes.buffer, 'png"\r\n'));
});

test("default schedule uses the requested time zone across midnight", () => {
  assert.deepEqual(localFields("Europe/Moscow", new Date("2026-11-09T22:04:00Z")),
    { date: "2026-11-10", start: "01:04" });
});

test("default channel matches ID or public handle without selecting another channel", () => {
  const channels = [
    { id: -1001234567890, title: "Тест", username: "TestQuiz" },
    { id: -1001234567891, title: "Другой", username: null },
  ];
  assert.equal(channelFor(channels, "@testquiz"), channels[0]);
  assert.equal(channelFor(channels, "-1001234567891"), channels[1]);
  assert.equal(channelFor(channels, "@missing"), undefined);
});
