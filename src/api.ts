import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import {
  backendUrl, issueText, multipartImage, type Batch, type BatchInput, type BatchMessage,
  type Channel, type Issue, type Parsed, type PollRevision, type Preview, type Queue,
} from "./protocol.ts";

export class PublisherApi {
  readonly base: string;
  constructor(base: string, private readonly token: string) {
    this.base = backendUrl(base);
    if (!token.trim()) throw new Error("Задайте токен API в настройках Telegram Publisher.");
  }

  private async send(path: string, options: Partial<RequestUrlParam> = {}): Promise<RequestUrlResponse> {
    let response: RequestUrlResponse;
    try {
      response = await requestUrl({
        ...options, url: this.base + "/api/v1" + path, throw: false,
        headers: { Authorization: "Bearer " + this.token },
      });
    } catch {
      throw new Error("Сервер недоступен. Проверьте адрес, HTTPS или SSH-туннель.");
    }
    if (response.status >= 200 && response.status < 300) return response;
    let detail: unknown;
    try { detail = response.json?.detail; } catch { /* Ответ прокси может быть HTML. */ }
    if (Array.isArray(detail) && detail.every(issue => issue && typeof issue.message === "string")) {
      throw new Error(detail.map(issue => issueText(issue as Issue)).join("\n"));
    }
    if (typeof detail === "string") throw new Error(detail);
    throw new Error(response.status === 401 ? "Сервер отклонил токен API." : `Сервер ответил HTTP ${response.status}.`);
  }

  private async json<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.send(path, body === undefined ? {} : {
      method: "POST", contentType: "application/json", body: JSON.stringify(body),
    });
    try { return response.json as T; }
    catch { throw new Error("Сервер вернул ответ в неожиданном формате."); }
  }

  channels() { return this.json<Channel[]>("/channels"); }
  status() { return this.json<{ status: string }>("/telegram/status"); }
  parse(markdown: string, attachments: Record<string, string>) {
    return this.json<Parsed>("/notes/parse", { markdown, attachments });
  }
  preview(batch: BatchInput, images: boolean, validateOnly: boolean) {
    const path = validateOnly ? "/batches/validate" : `/batches/preview?preview_images=${images}`;
    return this.json<Preview>(path, batch);
  }
  create(batch: BatchInput) { return this.json<Batch>("/batches", batch); }
  schedule(id: string) { return this.json<Batch>(`/batches/${encodeURIComponent(id)}/schedule`, {}); }
  batch(id: string) { return this.json<Batch>(`/batches/${encodeURIComponent(id)}`); }
  messages(id: string) { return this.json<BatchMessage[]>(`/batches/${encodeURIComponent(id)}/messages`); }
  reconcile(id: string) { return this.json<Batch>(`/batches/${encodeURIComponent(id)}/reconcile`, {}); }
  queue(id: number) { return this.json<Queue>(`/scheduled?channel_id=${id}`); }
  refreshQueue(id: number) { return this.json<{ queued: boolean }>(`/scheduled/${id}/refresh`, {}); }
  replacePoll(channel: number, id: string, expected: number, fields: PollRevision) {
    return this.json<{ queued: boolean }>(`/scheduled/${channel}/replace/${encodeURIComponent(id)}`,
      { ...fields, expected_telegram_id: expected });
  }
  removeTask(channel: number, id: string) {
    return this.json<{ queued: boolean }>(`/scheduled/${channel}/delete/${encodeURIComponent(id)}`, {});
  }

  async upload(data: ArrayBuffer, extension: string): Promise<string> {
    const options = multipartImage(data, extension);
    const response = await this.send("/uploads", { method: "POST", ...options });
    return response.json.digest as string;
  }

  async image(path: string): Promise<string> {
    if (!/^\/api\/v1\/images\/[a-f0-9]{64}$/.test(path)) throw new Error("Ссылка изображения не распознана.");
    const response = await this.send(path.slice("/api/v1".length));
    const mime = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
    if (mime !== "image/png" && mime !== "image/jpeg") throw new Error("Сервер вернул неизвестный формат изображения.");
    return URL.createObjectURL(new Blob([response.arrayBuffer], { type: mime }));
  }
}
