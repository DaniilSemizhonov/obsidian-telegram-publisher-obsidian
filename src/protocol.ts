export const themeNames = {
  sand: "Песочная", dark: "Тёмная", light: "Светлая", coral: "Коралловая", "minus-error": "Розово-фиолетовая",
};
export type Theme = keyof typeof themeNames;
export interface Code { source: string; language: string }
export interface Channel { id: number; title: string; username: string | null }
interface QuizTask {
  preamble?: string;
  external_id: string; title: string; question: string; options: string[];
  correct_index: number; explanation: string; image: string | null;
  code: Code | null;
}
interface ErrorTask {
  external_id: string; title: string; blocks: (string | { rows: string[][] })[]; image?: never;
  code: NonNullable<QuizTask["code"]>;
}
export type Task = QuizTask | ErrorTask;
export type PollRevision = Pick<QuizTask, "question" | "options" | "correct_index" | "explanation">;
export interface Issue { task?: number | null; field?: string; message: string }
export interface Parsed {
  telegram: Record<string, unknown>; tasks: Task[]; errors: Issue[]; warnings: Issue[];
}
interface ScheduleSlot { channel_id: number; timezone: string; date: string; start: string }
export interface PostInput extends ScheduleSlot { text: string }
export interface Schedule extends ScheduleSlot {
  interval: number; quiz_delay: number; theme: Theme;
}
export interface BatchInput extends Schedule { source_file: string; tasks: Task[]; caption_above?: boolean; code_as_image?: boolean }
export interface Planned {
  task_id: string; position: number; kind: string; scheduled_at: string; image_url: string | null;
}
export interface Preview { messages: Planned[]; first_at: string; last_at: string }
export interface Batch { id: string; status: string; payload: BatchInput }
export interface BatchMessage {
  id: string; task_id: string; kind: string; status: string; scheduled_at: string;
  telegram_scheduled_id: number | null; attempt_count: number; last_error: string | null;
}
export interface QueueEntry { id: number; kind: string; text: string | null; scheduled_at: string }
export interface ScheduledEntry extends QueueEntry {
  managed_id?: string | null; batch_id?: string | null; position?: number | null;
  delete_requested?: boolean; error?: string | null;
}
export interface Queue {
  checked_at: string; messages: ScheduledEntry[];
  published?: QueueEntry[]; refresh_requested?: boolean; replacing?: boolean;
  post_submissions?: { id: string; text: string; scheduled_at: string; status: string; error: string | null }[];
}

export function backendUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Укажите полный адрес сервера, включая https://."); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Для сервера используйте HTTPS или локальный SSH-туннель.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Адрес сервера должен быть без учётных данных, параметров и фрагмента.");
  }
  return url.href.replace(/\/+$/, "");
}

/** A desktop tunnel is not reachable through the phone's own loopback address. */
export function connectionUrl(desktop: string, mobile: string, isMobile: boolean): string {
  const base = backendUrl(isMobile && mobile.trim() ? mobile : desktop);
  if (isMobile && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) {
    throw new Error("На телефоне localhost ведёт на сам телефон. Укажите доступный HTTPS-адрес в настройке «Сервер для телефона».");
  }
  return base;
}

export function attachmentKeys(link: string): string[] {
  const path = link.replace(/\\/g, "/");
  if (!path || /^([a-z][a-z\d+.-]*:|\/)|[?#]/i.test(path)) return [];
  try {
    const decoded = decodeURIComponent(path);
    return [...new Set([path, decoded])];
  } catch {
    return [path];
  }
}

export function multipartImage(data: ArrayBuffer, extension: string) {
  if (!/^(png|jpe?g|webp)$/i.test(extension)) throw new Error("Поддерживаются PNG, JPEG и WebP.");
  const boundary = "obsidian-" + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const encoder = new TextEncoder();
  const header = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.${extension}"\r\n` +
    "Content-Type: application/octet-stream\r\n\r\n"
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(header.length + data.byteLength + tail.length);
  body.set(header);
  body.set(new Uint8Array(data), header.length);
  body.set(tail, header.length + data.byteLength);
  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function localFields(zone: string, instant = new Date(Date.now() + 30 * 60_000)) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const field = (name: string) => parts.find(part => part.type === name)?.value;
  return { date: `${field("year")}-${field("month")}-${field("day")}`, start: `${field("hour")}:${field("minute")}` };
}

export function formatTime(value: string, zone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone, dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
}

export function issueText(issue: Issue): string {
  return [issue.task ? `Задание №${issue.task}` : "", issue.field, issue.message].filter(Boolean).join(" · ");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить запрос.";
}

export function channelName(channel: Channel): string {
  return `${channel.title} (${channel.username ? "@" + channel.username + ", " : ""}${channel.id})`;
}

export function channelFor(channels: Channel[], choice: unknown): Channel | undefined {
  if (typeof choice !== "string" && typeof choice !== "number") return;
  const key = String(choice).trim().toLowerCase();
  const exact = channels.filter(channel => channel.title.trim().toLowerCase() === key);
  return channels.find(channel => String(channel.id) === key ||
    (channel.username !== null && "@" + channel.username.toLowerCase() === key)) ?? (exact.length === 1 ? exact[0] : undefined);
}

export const states: Record<string, string> = {
  draft: "Черновик", queued: "В очереди", pending: "Ожидает", ready: "Готово к отправке",
  processing: "Обрабатывается", rendering: "Готовится изображение", scheduling: "Отправляется",
  verifying: "Проверяется в Telegram", scheduled: "Подтверждено в отложке",
  removed: "Удалено из отложки", published: "Опубликовано",
  partial: "Часть сообщений в другом состоянии", blocked: "Остановлено", uncertain: "Требуется сверка",
  retryable_error: "Ожидает повторной попытки",
};

export function kindName(kind: string) {
  return kind === "photo" ? "Изображение" : kind === "poll" ? "Викторина"
    : kind === "rich" ? "Rich Message" : kind === "text" ? "Пост" : "Сообщение";
}
