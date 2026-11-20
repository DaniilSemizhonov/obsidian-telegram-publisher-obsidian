import { test } from "node:test";
import assert from "node:assert/strict";
import { minusErrorNote } from "../src/minus-error.ts";

test("conditions and code become posts while answer code stays in the separate section", () => {
  const lines = [
    "---", "rubric: Минус ошибка", "---", "> [!note] ТЗ", "# Минус ошибка. ОГЭ", "## Условия",
    "### Задача 1", "**МИНУС ОШИБКА**", "Условие", "```python", "# Правки", "print(1)", "```",
    "---", "## Ответы на Минус ошибку", "### Задача 1", "Исправленный код:", "```", "print(2)", "```",
    "# Перед отложкой", "- [ ] Проверить",
  ];
  const result = minusErrorNote(lines.join("\r\n"))!;
  assert.equal(result.markdown, [...lines.slice(0, 3), "## Минус ошибка", ...lines.slice(6, 13)].join("\n"));
  assert.deepEqual(result.regions.map(r => r.kind), [
    "condition", "condition", "condition", "code", "code", "code", "code",
    "answer", "answer", "answer", "answer", "answer",
  ]);
  assert.equal(result.regions.at(-1)?.to, 19);
});

test("ordinary conditions are ignored and the original rubric still works", () => {
  assert.equal(minusErrorNote("# Другое\n## Условия\n### Задача 1"), null);
  const legacy = "## Минус ошибка\n### Пример\nУсловие\n~~~\nкод\n~~~";
  assert.equal(minusErrorNote(legacy)?.markdown, legacy);
});
