import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { boundaries, packagePrefixes } from "../eslint-rules/call-nina.mjs";
import {
  desktopServiceDependencies,
  mainServiceImports,
  rendererPublicModules,
} from "./policy.mjs";

const root = process.cwd();
const desktop = path.join(root, "apps/desktop/src");
const files = readdirSync(desktop, { recursive: true })
  .filter((name) => /\.tsx?$/u.test(name) && !name.endsWith(".d.ts"))
  .map((name) => path.join(desktop, name));
const sourceFiles = new Set(files);
const graph = new Map();
const problems = [];
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const fail = (file, reason) => problems.push(`${relative(file)}: ${reason}`);
const options = { moduleResolution: ts.ModuleResolutionKind.NodeNext };

function codeLines(sf) {
  const source = sf.text;
  const lines = new Set();
  const starts = ts.computeLineStarts(source);
  const lineAt = (position) => ts.computeLineAndCharacterOfPosition(starts, position).line;
  // The parser rescans regex, template and JSX tokens; a standalone scanner
  // can mistake their contents for comments and hide the rest of the file.
  function visit(node) {
    if (
      node.kind === ts.SyntaxKind.EndOfFileToken ||
      (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
    )
      return;
    const children = node.getChildren(sf);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const start = node.getStart(sf);
    if (start >= node.end) return;
    for (let line = lineAt(start); line <= lineAt(node.end - 1); line++)
      if (source.slice(starts[line], starts[line + 1]).trim()) lines.add(line);
  }
  visit(sf);
  return lines.size;
}

function rendererBoundary(file, target) {
  const prefix = "apps/desktop/src/renderer/";
  const from = relative(file).slice(prefix.length).split("/");
  const to = relative(target).slice(prefix.length).split("/");
  const fromLayer = from.length === 1 ? "app" : from[0];
  const toLayer = to.length === 1 ? "app" : to[0];
  if (fromLayer === "features" && toLayer === "features" && from[1] !== to[1])
    fail(file, `feature cannot import sibling feature ${relative(target)}`);
  const forbidden = {
    learning: ["app", "features"],
    runtime: ["app", "features", "learning"],
    components: ["app", "features", "learning", "runtime"],
  };
  if (forbidden[fromLayer]?.includes(toLayer))
    fail(file, `invalid ${fromLayer} → ${toLayer} dependency`);
  if (
    ["features", "learning"].includes(toLayer) &&
    !(fromLayer === toLayer && from[1] === to[1]) &&
    !target.endsWith(".css") &&
    (toLayer === "features"
      ? path.basename(target) !== "index.ts"
      : !rendererPublicModules.includes(to.join("/").replace(/\.tsx?$/, ".js")))
  )
    fail(file, `consume ${toLayer}/${to[1]} through its public index`);
}

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const composition = [
    "apps/desktop/src/main/backend.ts",
    "apps/desktop/src/renderer/App.tsx",
  ].includes(relative(file));
  const limit = composition ? 300 : 500;
  const size = codeLines(sf);
  if (size > limit) fail(file, `${size} code lines exceeds ${limit}`);
  const edges = [];
  function dependency(node, literal, runtime) {
    if (!literal || !ts.isStringLiteral(literal)) return;
    const specifier = literal.text;
    if (!specifier.startsWith(".")) return;
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
      ?.resolvedFileName;
    const target =
      resolved ??
      (specifier.endsWith(".css") ? path.resolve(path.dirname(file), specifier) : undefined);
    if (!target) return;
    if (
      relative(file).startsWith("apps/desktop/src/renderer/") &&
      relative(target).startsWith("apps/desktop/src/renderer/")
    )
      rendererBoundary(file, target);
    if (
      relative(file).startsWith("apps/desktop/src/main/services/") &&
      ["backend.ts", "index.ts"].includes(path.basename(target))
    )
      fail(file, "service cannot import the composition root");
    if (
      relative(file).startsWith("apps/desktop/src/main/services/") &&
      path.dirname(target) === path.dirname(file) &&
      path.basename(file) !== "desktop-services.ts" &&
      !(mainServiceImports[path.basename(file)] ?? []).includes(path.basename(target))
    )
      fail(file, `undeclared service import ${path.basename(target)}`);
    if (runtime && sourceFiles.has(target)) edges.push(target);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((entry) => entry.isTypeOnly));
      dependency(node, node.moduleSpecifier, !typeOnly);
    } else if (ts.isExportDeclaration(node)) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((entry) => entry.isTypeOnly));
      dependency(node, node.moduleSpecifier, !typeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      dependency(node, node.argument.literal, false);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(sf) === "require")
    )
      dependency(node, node.arguments[0], true);
    if (
      ts.isTypeReferenceNode(node) &&
      node.typeName.getText(sf) === "DesktopServices" &&
      relative(file).startsWith("apps/desktop/src/main/services/") &&
      !(
        ts.isTypeReferenceNode(node.parent) &&
        node.parent.typeName.getText(sf) === "Pick" &&
        node.parent.typeArguments?.[0] === node
      )
    )
      fail(file, "services must declare a narrow Pick of DesktopServices");
    if (
      ts.isTypeReferenceNode(node) &&
      node.typeName.getText(sf) === "Pick" &&
      node.typeArguments?.[0]?.getText(sf) === "DesktopServices"
    ) {
      const permitted = desktopServiceDependencies[path.basename(file)] ?? [];
      const keys = node.typeArguments[1];
      for (const key of ts.isUnionTypeNode(keys) ? keys.types : [keys])
        if (
          ts.isLiteralTypeNode(key) &&
          ts.isStringLiteral(key.literal) &&
          !permitted.includes(key.literal.text)
        )
          fail(file, `undeclared service dependency ${key.literal.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  graph.set(file, edges);
}

const completed = new Set();
const active = new Set();
const trail = [];
function visit(file) {
  if (active.has(file)) {
    fail(
      file,
      `runtime import cycle: ${trail.slice(trail.indexOf(file)).map(relative).join(" → ")}`,
    );
    return;
  }
  if (completed.has(file)) return;
  active.add(file);
  trail.push(file);
  for (const target of graph.get(file) ?? []) visit(target);
  trail.pop();
  active.delete(file);
  completed.add(file);
}
for (const file of files) visit(file);

for (const directory of ["packages", "apps", "plugins"]) {
  for (const name of readdirSync(directory)) {
    const manifest = path.join(directory, name, "package.json");
    if (!ts.sys.fileExists(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const owner = packagePrefixes.get(pkg.name);
    if (!owner || !boundaries.some((boundary) => boundary.id === owner || owner === "desktop"))
      fail(manifest, `workspace ${pkg.name} has no dependency policy`);
  }
}
if (problems.length) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    `Architecture: ${files.length} desktop modules satisfy boundaries, cycles and size budgets.\n`,
  );
