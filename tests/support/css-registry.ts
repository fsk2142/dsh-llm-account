import { dirname, resolve } from "node:path";
import ts from "typescript";

/** 从 TypeScript 源码里收集真正绑定了 CSS 模块的 CSS_CLASS 属性访问。 */
export function cssClassReferences(source: string, fileName = "fixture.ts"): Set<string> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cssModulePath = resolve(process.cwd(), "src/client/css.ts");
  const localNames = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const base = resolve(dirname(resolve(fileName)), specifier);
    const candidates = [base, `${base}.ts`, base.replace(/\.js$/, ".ts")];
    if (!candidates.includes(cssModulePath)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "CSS_CLASS") localNames.add(element.name.text);
    }
  }
  const references = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && localNames.has(node.expression.text)) {
      references.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      localNames.has(node.expression.text) &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      references.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}

/** 从 CSS 文本里收集选择器中的完整类名 token；忽略注释和声明值。 */
export function cssSelectorClasses(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set<string>();
  // 只取每个 `{` 前面的选择器文本；声明值里不会出现 `{`，因此不会误收。
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    for (const token of match[1]!.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(token[1]!);
  }
  return classes;
}
