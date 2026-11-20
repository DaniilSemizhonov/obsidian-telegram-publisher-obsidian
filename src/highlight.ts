import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { recognizeNote } from "./context.ts";

import { minusErrorNote } from "./minus-error.ts";

const labels = {
  post: "Отдельный пост", quiz: "Викторина", explanation: "Пояснение к ответу",
  condition: "Условие задачи", code: "Код на карточке", answer: "Ответ для отдельной публикации",
};

export const publicationHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) { if (update.docChanged) this.decorations = this.build(update.view); }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const markdown = view.state.doc.toString();
    const result = minusErrorNote(markdown) ?? recognizeNote(markdown);
    if (!("quizzes" in result) || result.quizzes.length) {
      for (const region of result.regions.sort((a, b) => a.from - b.from)) {
        builder.add(view.state.doc.line(region.from + 1).from, view.state.doc.line(region.from + 1).from,
          Decoration.line({ attributes: { class: `otp-source-${region.kind}`, title: labels[region.kind] } }));
      }
    }
    return builder.finish();
  }
}, { decorations: value => value.decorations });
