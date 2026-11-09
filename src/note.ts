import { TFile, type App } from "obsidian";
import { PublisherApi } from "./api.ts";
import { attachmentKeys } from "./protocol.ts";

const MAX_IMAGE = 8 * 1024 * 1024;

export async function prepareNote(app: App, file: TFile, api: PublisherApi) {
  const markdown = await app.vault.read(file);
  const attachments: Record<string, string> = Object.create(null);
  const images = new Map<string, TFile>();
  const identifiers = new Map<string, string>();
  const cache = app.metadataCache.getFileCache(file);
  const warnings: string[] = [];
  if (!cache) warnings.push("Obsidian ещё индексирует заметку. Если вложение не найдено, повторите проверку.");
  for (const embed of cache?.embeds ?? []) {
    const keys = attachmentKeys(embed.link);
    if (!keys.length) continue;
    // Obsidian разрешает относительные ссылки и неоднозначные имена по пути заметки.
    const image = keys.slice().reverse().map(key => app.metadataCache.getFirstLinkpathDest(key, file.path))
      .find(candidate => candidate instanceof TFile);
    if (!image || !/^(png|jpe?g|webp)$/i.test(image.extension)) continue;
    let identifier = identifiers.get(image.path);
    if (!identifier) {
      // Временный ID имеет формат поля image. Реальный хеш вернёт загрузка.
      identifier = (images.size + 1).toString(16).padStart(64, "0");
      images.set(identifier, image);
      identifiers.set(image.path, identifier);
    }
    for (const key of keys) attachments[key] = identifier;
  }
  const parsed = await api.parse(markdown, attachments);
  if (parsed.errors.length) return { markdown, parsed, warnings };

  const uploaded = new Map<string, string>();
  for (const task of parsed.tasks) {
    const identifier = task.image;
    if (!identifier) continue;
    let digest = uploaded.get(identifier);
    if (!digest) {
      const image = images.get(identifier);
      if (!image) throw new Error(`Для задания «${task.title}» не удалось разрешить вложение.`);
      if (image.stat.size > MAX_IMAGE) throw new Error(`Вложение «${image.name}» превышает 8 МБ.`);
      const bytes = await app.vault.readBinary(image);
      if (bytes.byteLength > MAX_IMAGE) throw new Error(`Вложение «${image.name}» превышает 8 МБ.`);
      digest = await api.upload(bytes, image.extension);
      uploaded.set(identifier, digest);
    }
    task.image = digest;
  }
  return { markdown, parsed, warnings };
}
