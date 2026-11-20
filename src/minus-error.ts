import type { Region } from "./context.ts";

// Keep the server's existing task/table parser and use the same selection for editor colours.
export function minusErrorNote(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const yamlEnd = lines[0] === "---" ? lines.findIndex((s, i) => i > 0 && /^(---|\.\.\.)$/.test(s)) : -1;
  const header = lines.slice(0, yamlEnd + 1);
  const rubric = header.some(line => /^rubric:\s*["']?минус ошибка["']?\s*$/i.test(line));
  const content: string[] = [];
  const regions: Region[] = [];
  let topic = false, found = false, task = false;
  let section: "conditions" | "answers" | undefined;
  let fence = "";
  for (let i = yamlEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const inCode = Boolean(fence || marker);
    if (fence) {
      if (marker && marker[1].startsWith(fence) && !marker[2].trim()) fence = "";
    } else if (marker) {
      fence = marker[1];
    } else {
      const heading = /^ {0,3}(#{1,3})\s+(.+?)\s*$/.exec(line);
      if (heading) {
        const title = heading[2].toLowerCase();
        if (heading[1] === "#") topic = /^минус ошибка(?:$|[\s.:—–-])/.test(title);
        if (heading[1].length < 3) {
          section = undefined;
          task = false;
          if (heading[1] === "##") {
            if (title === "минус ошибка" || (title === "условия" && (topic || rubric))) {
              section = "conditions";
              found = true;
              content.push("## Минус ошибка");
            } else if (title === "ответы на минус ошибку") section = "answers";
          }
          continue;
        }
        task = Boolean(section);
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    }
    if (!task || !section) continue;
    if (section === "conditions") content.push(line);
    if (line.trim() || inCode) regions.push({ from: i, to: i,
      kind: section === "answers" ? "answer" : inCode ? "code" : "condition" });
  }
  return found ? { markdown: [...header, ...content].join("\n"), regions } : null;
}
