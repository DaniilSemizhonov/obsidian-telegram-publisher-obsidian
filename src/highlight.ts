import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { recognizeNote } from "./context.ts";

export const publicationHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) { if (update.docChanged) this.decorations = this.build(update.view); }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const result = recognizeNote(view.state.doc.toString());
    if (result.quizzes.length) {
      for (const region of result.regions.sort((a, b) => a.from - b.from)) {
        builder.add(view.state.doc.line(region.from + 1).from, view.state.doc.line(region.from + 1).from,
          Decoration.line({ attributes: { class: `otp-source-${region.kind}`, title: region.kind === "post" ? "Отдельный пост" : region.kind === "quiz" ? "Викторина" : "Пояснение к ответу" } }));
      }
    }
    return builder.finish();
  }
}, { decorations: value => value.decorations });
