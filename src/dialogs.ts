import { Modal, Notice, type App, type TFile } from "obsidian";
import { PublisherApi } from "./api.ts";
import { prepareNote } from "./note.ts";
import {
  channelFor, channelName, errorText, formatTime, issueText, kindName, localFields, states,
  type Batch, type BatchInput, type Channel, type Preview, type Queue, type ScheduledEntry, type Theme,
} from "./protocol.ts";

export interface Defaults {
  channel: string; timezone: string; interval: number; delay: number; theme: Theme; images: boolean;
}
export interface SavedBatch { id: string; path: string; server: string }
type Mode = "validate" | "preview" | "schedule";

function action(parent: HTMLElement, text: string, callback: () => void | Promise<void>, primary = false) {
  const button = parent.createEl("button", { text, cls: primary ? "mod-cta" : undefined });
  button.type = "button";
  button.addEventListener("click", () => void callback());
  return button;
}

function failure(parent: HTMLElement, error: unknown) {
  const element = parent.createDiv({ cls: "otp-error", attr: { role: "alert" } });
  element.setText(errorText(error));
}

function labeled(parent: HTMLElement, text: string) {
  const label = parent.createEl("label", { cls: "otp-field" });
  label.createSpan({ text });
  return label;
}

function confirm(app: App, message: string, deleting = false): Promise<boolean> {
  return new Promise(resolve => {
    class Confirmation extends Modal {
      confirmed = false;
      onOpen() {
        this.setTitle(deleting ? "Удалить из отложки?" : "Подтверждение постановки");
        this.contentEl.createEl("p", { text: message });
        const controls = this.contentEl.createDiv("otp-controls");
        action(controls, "Отмена", () => this.close());
        action(controls, deleting ? "Удалить" : "Поставить в отложку", () => {
          this.confirmed = true;
          this.close();
        }, true);
      }
      onClose() { resolve(this.confirmed); }
    }
    new Confirmation(app).open();
  });
}

export class PlanningDialog extends Modal {
  private active = false;
  private images: string[] = [];
  private readonly defaults: Defaults;
  private readonly remember: (batch: Batch) => Promise<void>;

  constructor(
    app: App, private readonly file: TFile, private readonly api: PublisherApi,
    defaults: Defaults, private readonly mode: Mode,
    remember: (batch: Batch) => Promise<void>,
  ) {
    super(app);
    this.defaults = { ...defaults };
    this.remember = remember;
  }

  onOpen() {
    this.active = true;
    this.setTitle(this.mode === "validate" ? "Проверка викторин" :
      this.mode === "preview" ? "Предпросмотр викторин" : "Запланировать подборку");
    this.contentEl.addClass("otp-dialog");
    void this.load();
  }

  onClose() {
    this.active = false;
    this.releaseImages();
    this.contentEl.empty();
  }

  private releaseImages() {
    for (const image of this.images) URL.revokeObjectURL(image);
    this.images = [];
  }

  private async load() {
    const body = this.contentEl;
    body.createEl("p", { text: this.file.path, cls: "otp-muted" });
    const loading = body.createEl("p", { text: "Проверяю подключение и заметку…" });
    try {
      const channels = await this.api.channels();
      if (!channels.length) {
        const status = await this.api.status();
        throw new Error(status.status === "authorized"
          ? "Нет доступных каналов. Проверьте разрешённые ID каналов и права аккаунта."
          : "Worker пока не подтвердил авторизацию Telegram. Проверьте его состояние в Portainer.");
      }
      if (!this.active) return;
      const { parsed, markdown, warnings } = await prepareNote(this.app, this.file, this.api);
      if (!this.active) return;
      for (const text of [...warnings, ...parsed.warnings.map(issueText)]) {
        body.createEl("p", { cls: "otp-muted", text });
      }
      if (parsed.errors.length) {
        failure(body, new Error(parsed.errors.map(issueText).join("\n")));
        return;
      }
      this.form(channels, parsed.telegram, parsed.tasks, markdown);
    } catch (error) {
      if (this.active) failure(body, error);
    } finally {
      loading.remove();
    }
  }

  private form(channels: Channel[], meta: Record<string, unknown>, tasks: BatchInput["tasks"], markdown: string) {
    const form = this.contentEl.createDiv("otp-fields");
    const channel = labeled(form, "Канал").createEl("select");
    channel.createEl("option", { value: "", text: "Выберите канал" });
    for (const item of channels) channel.createEl("option", { value: String(item.id), text: channelName(item) });
    const preferred = meta.channel ?? this.defaults.channel;
    const selected = channelFor(channels, preferred);
    channel.value = selected ? String(selected.id) : "";
    if (preferred && !selected) {
      this.contentEl.createEl("p", { text: "Канал из настроек недоступен. Выберите канал из списка.", cls: "otp-muted" });
    }

    const timezone = labeled(form, "Часовой пояс IANA").createEl("input", {
      value: typeof meta.timezone === "string" ? meta.timezone : this.defaults.timezone, type: "text",
    });
    let initial = localFields("UTC");
    try { initial = localFields(timezone.value); } catch { /* Проверка покажет ошибку зоны. */ }
    const date = labeled(form, "Дата").createEl("input", {
      type: "date", value: typeof meta.date === "string" ? meta.date : initial.date,
    });
    const start = labeled(form, "Начало").createEl("input", {
      type: "time", value: typeof meta.start === "string" ? meta.start : initial.start,
    });
    const interval = labeled(form, "Интервал, мин").createEl("input", {
      type: "number", value: String(meta.interval ?? this.defaults.interval), attr: { min: "1", step: "1" },
    });
    const delay = labeled(form, "Задержка после изображения, мин").createEl("input", {
      type: "number", value: String(meta.quiz_delay ?? this.defaults.delay), attr: { min: "1", step: "1" },
    });
    const theme = labeled(form, "Тема PNG").createEl("select");
    for (const [value, text] of [["sand", "Песочная"], ["dark", "Тёмная"], ["light", "Светлая"]]) {
      theme.createEl("option", { value, text });
    }
    theme.value = typeof meta.theme === "string" ? meta.theme : this.defaults.theme;
    const controls = this.contentEl.createDiv("otp-controls");
    const result = this.contentEl.createDiv();
    let busy = false;
    form.addEventListener("input", () => {
      if (!busy) {
        result.empty();
        this.releaseImages();
      }
    });

    const previewButton = action(controls, this.mode === "validate" ? "Проверить" : "Обновить предпросмотр", async () => {
      if (busy) return;
      result.empty();
      this.releaseImages();
      const target = channels.find(item => String(item.id) === channel.value);
      if (!target || !date.value || !start.value || !theme.value ||
        !Number.isInteger(interval.valueAsNumber) || !Number.isInteger(delay.valueAsNumber)) {
        failure(result, new Error("Выберите канал и заполните дату, время, интервалы и тему."));
        return;
      }
      const batch: BatchInput = {
        source_file: this.file.path, tasks, channel_id: target.id, timezone: timezone.value.trim(),
        date: date.value, start: start.value, interval: interval.valueAsNumber,
        quiz_delay: delay.valueAsNumber, theme: theme.value as Theme,
      };
      busy = true;
      previewButton.disabled = true;
      const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
      inputs.forEach(input => { input.disabled = true; });
      const loading = result.createEl("p", { text: "Проверяю расписание…" });
      try {
        const preview = await this.api.preview(batch, this.defaults.images, this.mode === "validate");
        if (!this.active) return;
        loading.remove();
        await this.showPreview(result, target, batch, preview, markdown);
      } catch (error) {
        if (this.active) failure(result, error);
      } finally {
        loading.remove();
        busy = false;
        previewButton.disabled = false;
        inputs.forEach(input => { input.disabled = false; });
      }
    }, true);
    if (channel.value) previewButton.click();
  }

  private async showPreview(parent: HTMLElement, channel: Channel, batch: BatchInput, preview: Preview, markdown: string) {
    const time = (value: string) => formatTime(value, batch.timezone);
    parent.createEl("p", {
      text: `${channelName(channel)} · заданий ${batch.tasks.length} · сообщений ${preview.messages.length}`,
    });
    parent.createEl("p", { cls: "otp-muted", text: `${time(preview.first_at)} — ${time(preview.last_at)} · ${batch.timezone}` });
    const imageJobs: Array<{ path: string; target: HTMLElement }> = [];
    for (const [position, task] of batch.tasks.entries()) {
      const card = parent.createDiv("otp-card");
      card.createEl("h4", { text: `${position + 1}. ${task.title}` });
      const messages = preview.messages.filter(message => message.position === position);
      for (const message of messages) {
        card.createDiv({ cls: "otp-muted", text: `${time(message.scheduled_at)} · ${kindName(message.kind)}` });
        if (message.image_url && this.mode !== "validate") {
          imageJobs.push({ path: message.image_url, target: card.createDiv("otp-image") });
        }
      }
      if (task.code && !messages.some(message => message.image_url)) card.createEl("pre", { text: task.code.source });
      if (task.question !== task.title) card.createEl("p", { text: task.question });
      const options = card.createEl("ol");
      for (const [index, option] of task.options.entries()) {
        options.createEl("li", { text: index === task.correct_index ? `${option} ✓` : option,
          cls: index === task.correct_index ? "otp-correct" : undefined });
      }
      card.createEl("p", { text: `Пояснение — ${task.explanation}` });
    }
    for (const { path, target } of imageJobs) {
      const src = await this.api.image(path);
      if (!this.active) {
        URL.revokeObjectURL(src);
        return;
      }
      this.images.push(src);
      target.createEl("img", { attr: { src, alt: "Изображение задания" } });
    }
    if (this.mode === "validate") return;
    const controls = parent.createDiv("otp-controls");
    const errors = parent.createDiv();
    const send = action(controls, "Поставить в отложку", async () => {
      send.disabled = true;
      errors.empty();
      try {
        if (!await confirm(this.app, `Канал ${channelName(channel)}. Сообщений: ${preview.messages.length}. Первая публикация: ${time(preview.first_at)}.`)) return;
        if (!this.active || !send.isConnected) return;
        if (batch.source_file !== this.file.path || await this.app.vault.read(this.file) !== markdown) {
          throw new Error("Заметка изменилась. Закройте окно и откройте предпросмотр заново.");
        }
        if (!this.active || !send.isConnected) return;
        const saved = await this.api.create(batch);
        // Запоминаем идентификатор до запроса постановки, чтобы восстановить статус при обрыве связи.
        await this.remember(saved);
        const scheduled = await this.api.schedule(saved.id);
        if (this.active) {
          this.close();
          new StatusDialog(this.app, this.api, [{ id: scheduled.id, path: batch.source_file, server: this.api.base }]).open();
        }
      } catch (error) {
        if (this.active) failure(errors, error);
      } finally {
        send.disabled = false;
      }
    }, true);
  }
}

export class StatusDialog extends Modal {
  private active = false;
  private timer: number | undefined;
  private generation = 0;

  constructor(app: App, private readonly api: PublisherApi, private readonly batches: SavedBatch[]) {
    super(app);
  }

  onOpen() {
    this.active = true;
    this.setTitle("Статус публикаций");
    this.contentEl.addClass("otp-dialog");
    const controls = this.contentEl.createDiv("otp-controls");
    const list = controls.createEl("select", { attr: { "aria-label": "Подборка" } });
    for (const batch of this.batches) list.createEl("option", { value: batch.id, text: `${batch.path} · ${batch.id.slice(0, 8)}` });
    const panel = this.contentEl.createDiv();
    const refresh = () => {
      window.clearTimeout(this.timer);
      void this.render(panel, list.value, ++this.generation, refresh);
    };
    action(controls, "Обновить", refresh);
    list.addEventListener("change", refresh);
    refresh();
  }

  onClose() {
    this.active = false;
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }

  private async render(panel: HTMLElement, id: string, generation: number, refresh: () => void) {
    panel.empty();
    panel.createEl("p", { text: "Читаю состояние подборки…" });
    const current = () => this.active && this.generation === generation;
    try {
      const [batch, messages] = await Promise.all([this.api.batch(id), this.api.messages(id)]);
      if (!current()) return;
      panel.empty();
      panel.createEl("p", { text: `${states[batch.status] ?? batch.status} · подтверждено ${messages.filter(item => item.status === "scheduled").length} из ${messages.length}` });
      for (const message of messages) {
        const card = panel.createDiv("otp-card");
        const task = batch.payload.tasks.find(item => item.external_id === message.task_id);
        card.createEl("strong", { text: task?.title ?? message.task_id });
        card.createDiv({ text: `${formatTime(message.scheduled_at, batch.payload.timezone)} · ${kindName(message.kind)} · ${states[message.status] ?? message.status}` });
        if (message.telegram_scheduled_id !== null) card.createDiv({ text: `ID сообщения в Telegram ${message.telegram_scheduled_id}`, cls: "otp-muted" });
        if (message.last_error) card.createDiv({ text: message.last_error, cls: "otp-error" });
      }
      const controls = panel.createDiv("otp-controls");
      if (batch.status === "draft") {
        const button = action(controls, "Поставить сохранённый черновик", async () => {
          if (!await confirm(this.app, `Канал ${batch.payload.channel_id}. Сообщений: ${messages.length}.`)) return;
          if (!current()) return;
          button.disabled = true;
          try { await this.api.schedule(id); if (current()) refresh(); }
          catch (error) { if (current()) failure(panel, error); }
          finally { button.disabled = false; }
        }, true);
      } else if (["scheduled", "partial", "blocked"].includes(batch.status)) {
        const button = action(controls, "Сверить с Telegram", async () => {
          button.disabled = true;
          try {
            await this.api.reconcile(id);
            if (current()) {
              new Notice("Сверка добавлена в очередь.");
              this.timer = window.setTimeout(refresh, 2500);
            }
          } catch (error) {
            if (current()) failure(panel, error);
          } finally { button.disabled = false; }
        });
      } else {
        this.timer = window.setTimeout(refresh, 3000);
      }
    } catch (error) {
      if (!current()) return;
      panel.empty();
      failure(panel, error);
    }
  }
}

export class QueueDialog extends Modal {
  private active = false;
  private generation = 0;
  private timer: number | undefined;
  constructor(app: App, private readonly api: PublisherApi, private readonly defaults: Defaults) {
    super(app);
  }

  onOpen() {
    this.active = true;
    this.setTitle("Викторины канала");
    this.contentEl.addClass("otp-dialog");
    void this.load();
  }

  onClose() {
    this.active = false;
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }

  private async load() {
    const panel = this.contentEl.createDiv();
    try {
      const channels = await this.api.channels();
      if (!this.active) return;
      if (!channels.length) throw new Error("Сервер пока не подтвердил ни одного доступного канала.");
      const controls = this.contentEl.createDiv("otp-controls");
      this.contentEl.insertBefore(controls, panel);
      const select = controls.createEl("select", { attr: { "aria-label": "Канал" } });
      for (const channel of channels) select.createEl("option", { value: String(channel.id), text: channelName(channel) });
      const preferred = channelFor(channels, this.defaults.channel);
      if (preferred) select.value = String(preferred.id);
      const tabs = controls.createEl("select", { attr: { "aria-label": "Раздел" } });
      tabs.createEl("option", { value: "scheduled", text: "В отложке" });
      tabs.createEl("option", { value: "published", text: "Опубликованы" });
      const refresh = async (sync = false) => {
        window.clearTimeout(this.timer);
        const generation = ++this.generation;
        const current = () => this.active && this.generation === generation;
        const channel = Number(select.value);
        panel.empty();
        panel.createEl("p", { text: "Читаю данные Telegram…" });
        try {
          if (sync) await this.api.refreshQueue(channel);
          const queue = await this.api.queue(channel);
          if (!current()) return;
          panel.empty();
          const time = (value: string) => formatTime(value, this.defaults.timezone);
          panel.createEl("p", { cls: "otp-muted", text: `Снимок Telegram от ${time(queue.checked_at)} · ${this.defaults.timezone}` });
          const waiting = queue.refresh_requested || queue.messages.some(item => item.delete_requested);
          if (waiting) {
            panel.createEl("p", { text: "Жду подтверждения от Telegram…" });
            this.timer = window.setTimeout(() => void refresh(), 2500);
          }
          if (tabs.value === "published") {
            this.showPublished(panel, queue, time);
          } else {
            this.showScheduled(panel, queue, time, channel, current, () => refresh());
          }
        } catch (error) {
          if (!current()) return;
          panel.empty();
          failure(panel, error);
        }
      };
      action(controls, "Сверить с Telegram", () => refresh(true));
      select.addEventListener("change", () => void refresh());
      tabs.addEventListener("change", () => void refresh());
      await refresh();
    } catch (error) {
      if (this.active) failure(panel, error);
    }
  }

  private showPublished(panel: HTMLElement, queue: Queue, time: (value: string) => string) {
    if (queue.published === undefined) {
      panel.createEl("p", { text: "Для списка публикаций требуется обновить сервер." });
      return;
    }
    panel.createEl("p", { cls: "otp-muted", text: "Викторины среди 100 последних сообщений канала." });
    if (!queue.published.length) panel.createEl("p", { text: "Недавних опубликованных викторин нет." });
    for (const item of queue.published) {
      const card = panel.createDiv("otp-card");
      card.createEl("strong", { text: item.text ?? "Викторина" });
      card.createDiv({ text: `${time(item.scheduled_at)} · ID ${item.id}`, cls: "otp-muted" });
    }
  }

  private showScheduled(
    panel: HTMLElement, queue: Queue, time: (value: string) => string, channel: number,
    current: () => boolean, refresh: () => Promise<void>,
  ) {
    const groups = new Map<string, ScheduledEntry[]>();
    for (const item of [...queue.messages].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
      const key = item.batch_id ? `${item.batch_id}:${item.position}` : String(item.id);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    if (!groups.size) panel.createEl("p", { text: "Отложенных сообщений нет." });
    for (const items of groups.values()) {
      const task = items.find(item => item.kind === "poll") ?? items[0];
      const card = panel.createDiv("otp-card");
      card.createEl("strong", { text: task.text || kindName(task.kind) });
      for (const item of items) {
        card.createDiv({ text: `${time(item.scheduled_at)} · ${kindName(item.kind)} · ID ${item.id}`, cls: "otp-muted" });
        if (item.error) failure(card, new Error(item.error));
      }
      if (!task.managed_id) continue;
      const managedId = task.managed_id;
      const remove = action(card.createDiv("otp-controls"), "Удалить задание из отложки", async () => {
        if (!await confirm(this.app, `Из отложки этого канала будут удалены сообщения задания «${task.text ?? "Викторина"}», включая картинку, если она ещё в очереди.`, true) || !current()) return;
        remove.disabled = true;
        try {
          await this.api.removeTask(channel, managedId);
          if (current()) await refresh();
        } catch (error) {
          if (current()) failure(card, error);
        } finally {
          remove.disabled = false;
        }
      });
      remove.disabled = items.some(item => item.delete_requested);
    }
  }

}
