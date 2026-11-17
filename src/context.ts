/** Context recognition is deliberately local: never treats the editorial brief as instructions. */
export type RegionKind = "post" | "quiz" | "explanation";
export interface Region { from: number; to: number; kind: RegionKind }
export interface DraftQuiz { title: string; question: string; options: string[]; correct_index: number; explanation: string; preamble: string }
export function recognizeNote(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const regions: Region[] = [];
  const quizzes: DraftQuiz[] = [];
  let section = "", fenced = false, yaml = lines[0] === "---", current: DraftQuiz | undefined;
  let body: { text: string; line: number }[] = [], explanation = false;
  const posts: string[] = [];
  const finish = () => {
    if (!current) return;
    const paragraphs = body.map(item => item.text).join("\n").trim().split(/\n\s*\n/);
    const questionIndex = paragraphs.map(paragraph => paragraph.includes("?")).lastIndexOf(true);
    const selected = questionIndex >= 0 ? questionIndex : paragraphs.length - 1;
    current.question = paragraphs[selected]?.trim() ?? "";
    current.title = current.question;
    current.preamble = paragraphs.filter((_, index) => index !== selected).join("\n\n");
    const questionStart = body.map(item => item.text).join("\n").lastIndexOf(current.question);
    let offset = 0;
    for (const item of body) {
      regions.push({ from: item.line, to: item.line, kind: offset >= questionStart && offset < questionStart + current.question.length ? "quiz" : "post" });
      offset += item.text.length + 1;
    }
    quizzes.push(current); current = undefined; body = []; explanation = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (yaml) { if (i && /^(---|\.\.\.)$/.test(line)) yaml = false; continue; }
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      finish();
      if (heading[1].length === 1 || /викторин/i.test(heading[2])) section = /^(перед отложкой|тз|правки|текст поста)/i.test(heading[2]) || /викторин/i.test(heading[2])
        ? heading[2].toLowerCase().trim() : section;
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    const start = /^(?:\*\*(\d+)\\?[.)]\*\*|(?:\*\*)?(\d+)\\?[.)](?:\*\*)?)\s+(.+)$/.exec(line);
    if (start && /викторин|правки|текст поста/.test(section)) {
      finish(); current = { title: "", question: "", options: [], correct_index: -1, explanation: "", preamble: "" };
      body.push({ text: start[3], line: i }); continue;
    }
    if (current) {
      const option = /^\s*([а-яa-z])[).]\s+(.+)$/i.exec(line);
      if (option && !explanation) {
        if (option[2].includes("✅")) current.correct_index = current.correct_index === -1 ? current.options.length : -2;
        current.options.push(option[2].replace(/✅/g, "").trim());
        regions.push({ from: i, to: i, kind: "quiz" }); continue;
      }
      const exp = /^(?:\*\*)?Пояснение[.:](?:\*\*)?\s*(.*)$/i.exec(line);
      if (exp) { explanation = true; current.explanation = exp[1]; }
      else if (explanation) current.explanation += "\n" + line;
      else if (!current.options.length) body.push({ text: line, line: i });
      if (explanation) regions.push({ from: i, to: i, kind: "explanation" });
    } else if (section === "текст поста" && line.trim()) {
      posts.push(line); regions.push({ from: i, to: i, kind: "post" });
    }
  }
  finish();
  for (const quiz of quizzes) quiz.explanation = quiz.explanation.trim();
  if (quizzes.length && posts.length) quizzes[0].preamble = [posts.join("\n"), quizzes[0].preamble].filter(Boolean).join("\n\n");
  return { quizzes, regions };
}

/** Stable identity, not a security digest. Works in mobile WebViews without SubtleCrypto. */
export function quizIdentity(question: string, index: number): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(question)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `auto-${index}-${hash.toString(16).padStart(16, "0")}`;
}
