import { Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { PublisherApi } from "./api.ts";
import { PlanningDialog, QueueView, QUEUE_VIEW, StatusDialog, type Defaults, type SavedBatch } from "./dialogs.ts";
import { backendUrl, errorText, localFields, themeNames, type Batch } from "./protocol.ts";

const SECRET_ID = "obsidian-telegram-publisher-api";
const DEFAULTS: Settings = {
  url: "http://127.0.0.1:8000", channel: "", timezone: "Europe/Moscow",
  interval: 8, delay: 1, theme: "sand", images: true,
};

interface Settings extends Defaults { url: string }
interface PluginData { settings: Settings; batches: SavedBatch[] }

export default class TelegramPublisher extends Plugin {
  data: PluginData = { settings: { ...DEFAULTS }, batches: [] };
  private saveQueue: Promise<void> = Promise.resolve();

  async onload() {
    const saved = await this.loadData() as Partial<PluginData> | null;
    this.data = { settings: { ...DEFAULTS, ...saved?.settings }, batches: saved?.batches ?? [] };
    this.addSettingTab(new PublisherSettings(this));
    this.registerView(QUEUE_VIEW, leaf => new QueueView(
      leaf, () => this.api(), this.data.settings, () => this.plan(), channel => this.plan(true, channel),
    ));
    this.addRibbonIcon("calendar-clock", "Отложка Telegram", () => void this.queue());
    this.addCommand({ id: "schedule-note", name: "Telegram: Запланировать подборку", callback: () => this.plan() });
    this.addCommand({ id: "schedule-minus-error", name: "Telegram: Запланировать «Минус ошибка»", callback: () => this.plan(true) });
    this.addCommand({ id: "batch-status", name: "Telegram: Проверить статус публикаций", callback: () => this.status() });
    this.addCommand({ id: "channel-queue", name: "Telegram: Открыть отложку канала", callback: () => this.queue() });
  }

  api() {
    return new PublisherApi(this.data.settings.url, this.app.secretStorage.getSecret(SECRET_ID) ?? "");
  }

  persist() {
    // Параллельно открытые окна сохраняют последнюю версию данных по очереди.
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(this.data));
    return this.saveQueue;
  }

  private async remember(batch: Batch, server: string) {
    const entry = { id: batch.id, path: batch.payload.source_file, server };
    this.data.batches = [entry, ...this.data.batches.filter(item => item.id !== batch.id || item.server !== server)].slice(0, 100);
    await this.persist();
  }

  private plan(minusError = false, channel?: string) {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice(minusError ? "Откройте заметку с разделом «Минус ошибка»." : "Откройте Markdown-заметку с викторинами.");
      return;
    }
    try {
      const api = this.api();
      new PlanningDialog(this.app, file, api, this.data.settings,
        batch => this.remember(batch, api.base), minusError, channel).open();
    } catch (error) {
      new Notice(errorText(error));
    }
  }

  private status() {
    try {
      const api = this.api();
      const path = this.app.workspace.getActiveFile()?.path;
      const batches = this.data.batches.filter(batch => batch.server === api.base);
      if (!batches.length) {
        new Notice("На этом сервере ещё нет подборок, отправленных из этого хранилища Obsidian.");
        return;
      }
      const ordered = [...batches.filter(batch => batch.path === path), ...batches.filter(batch => batch.path !== path)];
      new StatusDialog(this.app, api, ordered).open();
    } catch (error) {
      new Notice(errorText(error));
    }
  }

  private async queue() {
    try {
      await this.app.workspace.ensureSideLeaf(QUEUE_VIEW, "right", { active: true });
    }
    catch (error) { new Notice(errorText(error)); }
  }
}

class PublisherSettings extends PluginSettingTab {
  constructor(private readonly publisher: TelegramPublisher) { super(publisher.app, publisher); }

  display() {
    const root = this.containerEl;
    root.empty();
    const settings = this.publisher.data.settings;
    const persist = () => void this.publisher.persist().catch(error => new Notice(errorText(error)));
    new Setting(root).setName("Адрес сервера")
      .setDesc("HTTPS-адрес или http://127.0.0.1:8000 через SSH-туннель.")
      .addText(text => {
        text.setValue(settings.url);
        text.inputEl.addEventListener("change", () => {
          try { settings.url = backendUrl(text.getValue()); persist(); }
          catch (error) { new Notice(errorText(error)); text.setValue(settings.url); }
        });
      });

    const tokenSetting = new Setting(root).setName("Токен API");
    const tokenStatus = () => tokenSetting.setDesc(this.app.secretStorage.getSecret(SECRET_ID)
      ? "Токен сохранён в хранилище секретов Obsidian. Вставьте новый токен для замены."
      : "Вставьте BACKEND_API_TOKEN из настроек стека в Portainer.");
    tokenStatus();
    const tokenInput = tokenSetting.controlEl.createEl("input", {
      type: "password", attr: { autocomplete: "off", placeholder: "Токен API", "aria-label": "Токен API" },
    });
    tokenSetting.addButton(button => button.setButtonText("Сохранить").onClick(() => {
      const token = tokenInput.value.trim();
      if (!token) { new Notice("Введите токен API."); return; }
      this.app.secretStorage.setSecret(SECRET_ID, token);
      tokenInput.value = "";
      tokenStatus();
    }));

    new Setting(root).setName("Проверка подключения")
      .addButton(button => button.setButtonText("Проверить").onClick(async () => {
        button.setDisabled(true);
        try {
          const api = this.publisher.api();
          const [channels, status] = await Promise.all([api.channels(), api.status()]);
          const messages: Record<string, string> = {
            authorized: "Telegram авторизован", unavailable: "Telegram недоступен",
            worker_unavailable: "Worker ещё не подтвердил подключение", flood_wait: "Telegram просит подождать",
          };
          new Notice(`API доступен. ${messages[status.status] ?? status.status}. Каналов: ${channels.length}.`, 7000);
        } catch (error) { new Notice(errorText(error), 7000); }
        finally { button.setDisabled(false); }
      }));

    new Setting(root).setName("Канал по умолчанию").setDesc("Числовой ID или @username.")
      .addText(text => text.setValue(settings.channel).onChange(value => { settings.channel = value.trim(); persist(); }));
    new Setting(root).setName("Часовой пояс").setDesc("Например, Europe/Moscow.")
      .addText(text => {
        text.setValue(settings.timezone);
        text.inputEl.addEventListener("change", () => {
          const zone = text.getValue().trim();
          try { localFields(zone); settings.timezone = zone; persist(); }
          catch { new Notice("Укажите существующий часовой пояс IANA."); text.setValue(settings.timezone); }
        });
      });
    for (const [key, label] of [["interval", "Интервал между заданиями, мин"], ["delay", "Задержка после изображения, мин"]] as const) {
      new Setting(root).setName(label).addText(text => {
        text.inputEl.type = "number";
        text.setValue(String(settings[key]));
        text.inputEl.addEventListener("change", () => {
          const number = text.inputEl.valueAsNumber;
          if (!Number.isInteger(number) || number < 1 || number > 1440) {
            new Notice("Укажите целое число минут от 1 до 1440.");
            text.setValue(String(settings[key]));
            return;
          }
          settings[key] = number;
          persist();
        });
      });
    }
    new Setting(root).setName("Тема PNG").addDropdown(dropdown => dropdown
      .addOptions(themeNames)
      .setValue(settings.theme).onChange(value => { settings.theme = value as Settings["theme"]; persist(); }));
    new Setting(root).setName("Изображения в предпросмотре")
      .addToggle(toggle => toggle.setValue(settings.images).onChange(value => { settings.images = value; persist(); }));
  }
}
