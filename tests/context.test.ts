import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quizIdentity, recognizeNote } from "../src/context.ts";

const note = readFileSync(new URL("./fixtures/quiz.md", import.meta.url), "utf8");
test("standard editorial note becomes five quizzes without the brief or checklist", () => {
  const { quizzes, regions } = recognizeNote(note);
  assert.equal(quizzes.length, 5);
  assert.deepEqual(quizzes.map(q => q.correct_index), [1, 3, 2, 0, 2]);
  assert.equal(quizzes[0].question, "В каком порядке нужно обработать заявки?");
  assert.match(quizzes[0].preamble, /В магазине две камеры/);
  assert.match(quizzes[0].preamble, /\(12, 14\)/);
  assert.ok(quizzes.every(q => q.options.length === 4 && !q.options.join().includes("✅")));
  assert.doesNotMatch(JSON.stringify(quizzes), /ТЗ из таблицы|Голос Мани|Перед отложкой|Галочки/);
  assert.ok(regions.some(r => r.kind === "post"));
  assert.ok(quizzes[2].explanation.length > 200, "never truncate explanation silently");
});
test("post text joins the first preamble and legacy notes remain untouched", () => {
  const result = recognizeNote(note.replace("> [!tip]- Голос Мани, можно красиво оформлять.", "Привет! Сегодня решаем задачу."));
  assert.match(result.quizzes[0].preamble, /^Привет!/);
  assert.equal(recognizeNote("## Вопрос?\n- [x] Да\n- [ ] Нет\n**Пояснение:** Да.").quizzes.length, 0);
});
test("multiple marked answers require correction; code and quoted examples are not questions", () => {
  const result = recognizeNote("# Викторина\n```\n1. Пример\n```\n> 2. Цитата\n**1.** Вопрос?\nа) Да ✅\nб) Нет ✅\nв) Ещё ✅\nПояснение: Ответ");
  assert.equal(result.quizzes.length, 1);
  assert.equal(result.quizzes[0].correct_index, -2);
});

test("mobile quiz identity is stable, distinguishes repeats and needs no SubtleCrypto", () => {
  assert.equal(quizIdentity("Вопрос?", 0), quizIdentity("Вопрос?", 0));
  assert.notEqual(quizIdentity("Вопрос?", 0), quizIdentity("Вопрос?", 1));
  assert.notEqual(quizIdentity("Вопрос?", 0), quizIdentity("Другой?", 0));
  assert.match(quizIdentity("Вопрос?", 0), /^[a-zA-Z0-9_.-]{1,128}$/);
});

test("escaped numbering, topic heading and dotted explanations preserve the actual question", () => {
  const note = readFileSync(new URL("./fixtures/decoding.md", import.meta.url), "utf8");
  const result = recognizeNote(note);
  assert.equal(result.quizzes.length, 5);
  assert.equal(result.quizzes[0].question, "Какое слово закодировали?");
  assert.match(result.quizzes[0].preamble, /110100/);
  assert.match(result.quizzes[2].question, /Какое слово/);
  assert.match(result.quizzes[2].preamble, /Л — 0/);
  assert.ok(result.quizzes.every(q => q.explanation && !q.explanation.includes("**")));
  assert.deepEqual(result.quizzes.map(q => q.correct_index), [1, 2, 3, 0, 1]);
  assert.doesNotMatch(JSON.stringify(result.quizzes), /Перед отложкой|Галочки|Голос Мани/);
});

test("explicit poll heading sends the complete question and condition as a post", () => {
  for (const marker of ["Викторина:", "**Викторина:**"]) {
    const source = `# Текст поста\n1. Какое слово закодировали?\n\nК — 00, О — 01, Т — 10, С — 11.\n\nСообщение: 110100\n${marker} Выберите правильный ответ\nа) КОС\nб) СОК ✅\nПояснение: СОК.\n\n2. Второй вопрос?\nа) Да ✅\nб) Нет\nПояснение: Да.`;
    const { quizzes, regions } = recognizeNote(source);
    assert.equal(quizzes.length, 2);
    assert.equal(quizzes[0].question, "Выберите правильный ответ");
    assert.equal(quizzes[0].preamble, "Какое слово закодировали?\n\nК — 00, О — 01, Т — 10, С — 11.\n\nСообщение: 110100");
    assert.equal(quizzes[0].correct_index, 1);
    assert.equal(regions.find(r => r.from === 1)?.kind, "post");
    assert.equal(regions.find(r => r.from === 6)?.kind, "quiz");
    assert.equal(quizzes[1].question, "Второй вопрос?");
    assert.equal(quizzes[1].preamble, "");
  }
});

test("code after a numbered question keeps its language, indentation and surrounding condition", () => {
  const source = [
    "# Викторина Задание № 6 ОГЭ", "1\\. Для какой пары программа напечатает YES?", "", "```python",
    "if s >= 4:", '    print("YES")', "```", "", "Пары: (4, 6), (3, 6).", "",
    "а) (4, 6) ✅", "б) (3, 6)", "**Пояснение.** Четыре подходит.", "",
    "2\\. Второй вопрос?", "а) Да ✅", "б) Нет", "Пояснение: Да.",
  ].join("\n");
  const { quizzes, errors } = recognizeNote(source);
  assert.deepEqual(errors, []);
  assert.deepEqual(quizzes[0].code, { language: "python", source: 'if s >= 4:\n    print("YES")' });
  assert.equal(quizzes[0].question, "Для какой пары программа напечатает YES?");
  assert.equal(quizzes[0].preamble, "Для какой пары программа напечатает YES?\n\nПары: (4, 6), (3, 6).");
  assert.equal(quizzes[1].code, null);
  assert.equal(quizzes[1].preamble, "");
});
