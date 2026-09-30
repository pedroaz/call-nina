import { builtinModules } from "node:module";
import path from "node:path";

const nodeBuiltins = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.startsWith("node:") ? name.slice(5) : `node:${name}`,
  ]),
);

const boundaries = [
  {
    id: "managed-generation",
    prefix: "packages/managed-generation/",
    packages: ["contracts", "learning-workflows"],
    node: true,
    electron: false,
  },
  {
    id: "managed-service",
    prefix: "apps/managed-service/",
    packages: ["contracts", "managed-generation"],
    node: true,
    electron: false,
  },
  {
    id: "learning-workflows",
    prefix: "packages/learning-workflows/",
    packages: ["contracts"],
    node: false,
    electron: false,
  },
  {
    id: "desktop-renderer",
    prefix: "apps/desktop/src/renderer/",
    packages: ["contracts", "design-system", "domain"],
    node: false,
    electron: false,
  },
  {
    id: "desktop-preload",
    prefix: "apps/desktop/src/preload/",
    packages: ["contracts"],
    node: true,
    electron: true,
  },
  {
    id: "desktop-main",
    prefix: "apps/desktop/src/main/",
    packages: [
      "codex-client",
      "direct-api",
      "offline-runtime",
      "managed-generation",
      "contracts",
      "domain",
      "persistence",
      "learning-workflows",
    ],
    node: true,
    electron: true,
  },
  {
    id: "mcp-server",
    prefix: "apps/mcp-server/",
    packages: ["contracts", "domain", "persistence"],
    node: true,
    electron: false,
  },
  {
    id: "design-system",
    prefix: "packages/design-system/",
    packages: [],
    node: false,
    electron: false,
  },
  {
    id: "contracts",
    prefix: "packages/contracts/",
    packages: [],
    node: false,
    electron: false,
  },
  {
    id: "domain",
    prefix: "packages/domain/",
    packages: ["contracts"],
    node: false,
    electron: false,
  },
  {
    id: "persistence",
    prefix: "packages/persistence/",
    packages: ["contracts", "domain", "platform"],
    node: true,
    electron: false,
  },
  {
    id: "offline-runtime",
    prefix: "packages/offline-runtime/",
    packages: ["learning-workflows", "contracts"],
    node: true,
    electron: false,
  },
  {
    id: "direct-api",
    prefix: "packages/direct-api/",
    packages: ["contracts", "learning-workflows"],
    node: true,
    electron: false,
  },
  {
    id: "codex-client",
    prefix: "packages/codex-client/",
    packages: ["contracts", "platform", "learning-workflows"],
    node: true,
    electron: false,
  },
  {
    id: "platform",
    prefix: "packages/platform/",
    packages: [],
    node: true,
    electron: false,
  },
];

const packagePrefixes = new Map([
  ["@call-nina/managed-generation", "managed-generation"],
  ["@call-nina/learning-workflows", "learning-workflows"],
  ["@call-nina/design-system", "design-system"],
  ["@call-nina/contracts", "contracts"],
  ["@call-nina/domain", "domain"],
  ["@call-nina/persistence", "persistence"],
  ["@call-nina/codex-client", "codex-client"],
  ["@call-nina/offline-runtime", "offline-runtime"],
  ["@call-nina/direct-api", "direct-api"],
  ["@call-nina/platform", "platform"],
  ["@call-nina/desktop", "desktop"],
  ["@call-nina/mcp-server", "mcp-server"],
  ["@call-nina/plugin", "plugin"],
]);

function repositoryPath(filename) {
  return path.relative(process.cwd(), filename).split(path.sep).join("/");
}

function boundaryForFile(filename) {
  const relative = repositoryPath(filename);
  return boundaries.find(({ prefix }) => relative.startsWith(prefix));
}

function packageForSource(source, filename) {
  for (const [prefix, id] of packagePrefixes) {
    if (source === prefix || source.startsWith(`${prefix}/`)) {
      return id;
    }
  }

  if (source.startsWith(".")) {
    const target = repositoryPath(path.resolve(path.dirname(filename), source));
    const targetBoundary = boundaries.find(({ prefix }) => target.startsWith(prefix));
    return targetBoundary?.id;
  }

  return undefined;
}

function literalSource(node) {
  return typeof node?.value === "string" ? node.value : undefined;
}

const enforcePackageBoundaries = {
  meta: {
    type: "problem",
    docs: { description: "Enforce Call Nina process and package dependency boundaries." },
    schema: [],
    messages: {
      forbiddenPackage: "{{owner}} must not import from {{target}}.",
      forbiddenNode: "{{owner}} must not import Node.js builtin {{source}}.",
      forbiddenElectron: "{{owner}} must not import Electron runtime {{source}}.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const owner = boundaryForFile(filename);
    if (!owner) return {};

    function checkSource(node, sourceNode) {
      const source = literalSource(sourceNode);
      if (!source) return;

      if (nodeBuiltins.has(source) && !owner.node) {
        context.report({ node, messageId: "forbiddenNode", data: { owner: owner.id, source } });
        return;
      }
      if ((source === "electron" || source.startsWith("@electron/")) && !owner.electron) {
        context.report({ node, messageId: "forbiddenElectron", data: { owner: owner.id, source } });
        return;
      }

      const target = packageForSource(source, filename);
      if (target && target !== owner.id && !owner.packages.includes(target)) {
        context.report({
          node,
          messageId: "forbiddenPackage",
          data: { owner: owner.id, target },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source);
      },
      ExportNamedDeclaration(node) {
        checkSource(node, node.source);
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source);
      },
      ImportExpression(node) {
        checkSource(node, node.source);
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        ) {
          checkSource(node, node.arguments[0]);
        }
      },
    };
  },
};

const insecurePreferenceValues = new Map([
  ["nodeIntegration", true],
  ["nodeIntegrationInWorker", true],
  ["nodeIntegrationInSubFrames", true],
  ["contextIsolation", false],
  ["sandbox", false],
  ["webSecurity", false],
  ["allowRunningInsecureContent", true],
  ["experimentalFeatures", true],
]);

function staticPropertyName(node) {
  if (!node.computed && node.key.type === "Identifier") return node.key.name;
  if (node.key.type === "Literal" && typeof node.key.value === "string") return node.key.value;
  return undefined;
}

const secureElectronPreferences = {
  meta: {
    type: "problem",
    docs: { description: "Reject statically insecure Electron webPreferences." },
    schema: [],
    messages: {
      insecurePreference: "Electron preference {{name}} must not be set to {{value}}.",
      dynamicPreference:
        "Electron preference {{name}} must use the explicit safe literal {{value}}.",
    },
  },
  create(context) {
    return {
      Property(node) {
        const name = staticPropertyName(node);
        if (!name || !insecurePreferenceValues.has(name)) return;
        const insecureValue = insecurePreferenceValues.get(name);
        const safeValue = !insecureValue;
        if (node.value.type !== "Literal") {
          context.report({
            node,
            messageId: "dynamicPreference",
            data: { name, value: String(safeValue) },
          });
          return;
        }
        if (node.value.value === insecureValue) {
          context.report({
            node,
            messageId: "insecurePreference",
            data: { name, value: String(insecureValue) },
          });
        }
      },
    };
  },
};

const noElectronRemote = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Electron remote APIs." },
    schema: [],
    messages: {
      remote: "Electron remote APIs are not allowed.",
      dynamicImport: "Electron must use static imports; dynamic Electron imports are not allowed.",
    },
  },
  create(context) {
    const electronNamespaceBindings = new Set(["electron"]);

    function isElectronRequire(node) {
      return (
        node?.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        node.arguments.length === 1 &&
        literalSource(node.arguments[0]) === "electron"
      );
    }

    return {
      ImportDeclaration(node) {
        const source = literalSource(node.source);
        if (source === "@electron/remote") context.report({ node, messageId: "remote" });
        if (
          source === "electron" &&
          node.specifiers.some(
            (specifier) =>
              specifier.type === "ImportSpecifier" && specifier.imported.name === "remote",
          )
        ) {
          context.report({ node, messageId: "remote" });
        }
        if (source === "electron") {
          for (const specifier of node.specifiers) {
            if (specifier.type === "ImportNamespaceSpecifier")
              electronNamespaceBindings.add(specifier.local.name);
          }
        }
      },
      ImportExpression(node) {
        const source = literalSource(node.source);
        if (source === "electron" || source === "@electron/remote") {
          context.report({
            node,
            messageId: source === "@electron/remote" ? "remote" : "dynamicImport",
          });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        ) {
          const source = literalSource(node.arguments[0]);
          if (source === "@electron/remote") context.report({ node, messageId: "remote" });
        }
      },
      VariableDeclarator(node) {
        if (isElectronRequire(node.init) && node.id.type === "Identifier")
          electronNamespaceBindings.add(node.id.name);
        if (
          node.id.type === "Identifier" &&
          node.init?.type === "Identifier" &&
          electronNamespaceBindings.has(node.init.name)
        ) {
          electronNamespaceBindings.add(node.id.name);
        }
        const destructuresRemote =
          node.id.type === "ObjectPattern" &&
          node.id.properties.some(
            (property) => property.type === "Property" && staticPropertyName(property) === "remote",
          );
        const electronSource =
          isElectronRequire(node.init) ||
          (node.init?.type === "Identifier" && electronNamespaceBindings.has(node.init.name));
        if (destructuresRemote && electronSource) {
          context.report({ node, messageId: "remote" });
        }
      },
      AssignmentExpression(node) {
        if (
          node.left.type === "Identifier" &&
          (isElectronRequire(node.right) ||
            (node.right.type === "Identifier" && electronNamespaceBindings.has(node.right.name)))
        ) {
          electronNamespaceBindings.add(node.left.name);
        }
      },
      MemberExpression(node) {
        const propertyName =
          !node.computed && node.property.type === "Identifier"
            ? node.property.name
            : literalSource(node.property);
        const electronNamespace =
          (node.object.type === "Identifier" && electronNamespaceBindings.has(node.object.name)) ||
          isElectronRequire(node.object);
        if (electronNamespace && propertyName === "remote") {
          context.report({ node, messageId: "remote" });
        }
      },
    };
  },
};

const canonicalReactAriaControls = new Set([
  "Button",
  "Checkbox",
  "Dialog",
  "DialogTrigger",
  "FieldError",
  "Input",
  "Label",
  "Modal",
  "ModalOverlay",
  "Radio",
  "RadioGroup",
  "Select",
  "TextArea",
  "TextField",
  "Tooltip",
  "TooltipTrigger",
]);

const noDirectReactAriaControls = {
  meta: {
    type: "problem",
    docs: { description: "Require renderer features to use repository-owned UI controls." },
    schema: [],
    messages: {
      directControl: "Import {{name}} from the renderer components/ui layer instead.",
    },
  },
  create(context) {
    const filename = repositoryPath(context.getFilename());
    if (filename.includes("/components/ui/")) return {};
    return {
      ImportDeclaration(node) {
        if (literalSource(node.source) !== "react-aria-components") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            canonicalReactAriaControls.has(specifier.imported.name)
          ) {
            context.report({
              node: specifier,
              messageId: "directControl",
              data: { name: specifier.imported.name },
            });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    "enforce-package-boundaries": enforcePackageBoundaries,
    "secure-electron-preferences": secureElectronPreferences,
    "no-electron-remote": noElectronRemote,
    "no-direct-react-aria-controls": noDirectReactAriaControls,
  },
};
