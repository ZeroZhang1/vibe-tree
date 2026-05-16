import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const achievementsPath = join(root, "src", "renderer", "achievements.ts");
const i18nPath = join(root, "src", "renderer", "i18n.ts");
const defaultPort = Number(process.env.VIBE_TREE_ACHIEVEMENT_EDITOR_PORT ?? 5177);
const host = process.env.VIBE_TREE_ACHIEVEMENT_EDITOR_HOST ?? "127.0.0.1";
const shouldOpen = !process.argv.includes("--no-open");

function readText(path) {
  return readFileSync(path, "utf8");
}

function parseSource(path) {
  const text = readText(path);
  return {
    text,
    sourceFile: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

function propertyName(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function stringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function booleanValue(node) {
  if (!node) return undefined;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function variableInitializer(sourceFile, name) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function objectProperties(objectLiteral) {
  const map = new Map();
  if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return map;
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (name) map.set(name, prop.initializer);
  }
  return map;
}

function literalRange(sourceFile, node) {
  if (!node || !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return undefined;
  return { start: node.getStart(sourceFile), end: node.end };
}

function removableRange(text, node) {
  let start = node.getFullStart();
  let end = node.end;
  while (text[end] === " " || text[end] === "\t") end += 1;
  if (text[end] === ",") end += 1;
  if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
  else if (text[end] === "\n") end += 1;
  return { start, end };
}

function insertionPosition(listNode) {
  return listNode.elements?.end ?? listNode.properties?.end ?? listNode.end - 1;
}

function readZhAchievements() {
  const parsed = parseSource(achievementsPath);
  const initializer = variableInitializer(parsed.sourceFile, "ACHIEVEMENTS");
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error("Could not find ACHIEVEMENTS array.");
  }

  const rows = [];
  for (const element of initializer.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const props = objectProperties(element);
    const id = stringValue(props.get("id"));
    if (!id) continue;
    rows.push({
      id,
      sourceRange: removableRange(parsed.text, element),
      category: stringValue(props.get("category")) ?? "",
      rarity: stringValue(props.get("rarity")) ?? "",
      hidden: booleanValue(props.get("hidden")) === true,
      planned: booleanValue(props.get("planned")) === true,
      zh: {
        name: stringValue(props.get("name")) ?? "",
        description: stringValue(props.get("description")) ?? "",
        flavor: stringValue(props.get("flavor")) ?? "",
      },
      zhRanges: {
        name: literalRange(parsed.sourceFile, props.get("name")),
        description: literalRange(parsed.sourceFile, props.get("description")),
        flavor: literalRange(parsed.sourceFile, props.get("flavor")),
      },
    });
  }
  return { rows, text: parsed.text, insertAt: insertionPosition(initializer) };
}

function readEnCopy() {
  const parsed = parseSource(i18nPath);
  const initializer = variableInitializer(parsed.sourceFile, "ACHIEVEMENT_TEXT_EN");
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error("Could not find ACHIEVEMENT_TEXT_EN object.");
  }

  const byId = new Map();
  for (const prop of initializer.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const id = propertyName(prop.name);
    if (!id || !ts.isObjectLiteralExpression(prop.initializer)) continue;
    const props = objectProperties(prop.initializer);
    byId.set(id, {
      sourceRange: removableRange(parsed.text, prop),
      en: {
        name: stringValue(props.get("name")) ?? "",
        description: stringValue(props.get("description")) ?? "",
        flavor: stringValue(props.get("flavor")) ?? "",
      },
      enRanges: {
        name: literalRange(parsed.sourceFile, props.get("name")),
        description: literalRange(parsed.sourceFile, props.get("description")),
        flavor: literalRange(parsed.sourceFile, props.get("flavor")),
      },
    });
  }
  return { byId, text: parsed.text, insertAt: insertionPosition(initializer) };
}

function readAchievementCopy() {
  const zh = readZhAchievements();
  const en = readEnCopy();
  return {
    achievements: zh.rows.map((row) => {
      const enRow = en.byId.get(row.id);
      return {
        id: row.id,
        category: row.category,
        rarity: row.rarity,
        hidden: row.hidden,
        planned: row.planned,
        zh: row.zh,
        en: enRow?.en ?? { name: "", description: "", flavor: "" },
      };
    }),
  };
}

function jsonLiteral(value) {
  return JSON.stringify(String(value ?? ""));
}

function addReplacement(replacements, range, value) {
  if (!range) return;
  replacements.push({ ...range, value: jsonLiteral(value) });
}

function addDeletion(replacements, range) {
  if (!range) return;
  replacements.push({ ...range, value: "" });
}

function addInsertion(replacements, at, value) {
  replacements.push({ start: at, end: at, value });
}

function applyReplacements(text, replacements) {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let next = text;
  for (const replacement of sorted) {
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
  }
  return next;
}

const CATEGORY_VALUES = new Set(["growth", "peak", "time", "agent", "hidden"]);
const RARITY_VALUES = new Set(["common", "rare", "epic", "legendary", "hidden"]);

function cleanAchievementId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Invalid achievement id "${id}". Use lowercase letters, numbers, and underscores; start with a letter.`);
  }
  return id;
}

function cleanCategory(value) {
  return CATEGORY_VALUES.has(value) ? value : "growth";
}

function cleanRarity(value) {
  return RARITY_VALUES.has(value) ? value : "common";
}

function achievementObjectSource(row) {
  const lines = [
    "  {",
    `    id: ${jsonLiteral(row.id)},`,
    `    category: ${jsonLiteral(cleanCategory(row.category))},`,
    `    rarity: ${jsonLiteral(cleanRarity(row.rarity))},`,
  ];
  if (row.hidden === true) lines.push("    hidden: true,");
  if (row.planned === true) lines.push("    planned: true,");
  lines.push(
    `    name: ${jsonLiteral(row.zh?.name)},`,
    `    description: ${jsonLiteral(row.zh?.description)},`,
    `    flavor: ${jsonLiteral(row.zh?.flavor)},`,
    "    condition: () => false,",
    "  },",
  );
  return `\n${lines.join("\n")}\n`;
}

function englishCopySource(row) {
  return `\n  ${row.id}: {\n    name: ${jsonLiteral(row.en?.name)},\n    description: ${jsonLiteral(row.en?.description)},\n    flavor: ${jsonLiteral(row.en?.flavor)},\n  },\n`;
}

function normalizeIncomingRows(input) {
  const rows = Array.isArray(input?.achievements) ? input.achievements : [];
  const seen = new Set();
  return rows.map((row) => {
    const id = cleanAchievementId(row?.id);
    if (seen.has(id)) throw new Error(`Duplicate achievement id "${id}".`);
    seen.add(id);
    return {
      id,
      category: cleanCategory(row?.category),
      rarity: cleanRarity(row?.rarity),
      hidden: row?.hidden === true,
      planned: row?.planned === true,
      isDraft: row?.isDraft === true || row?.isNew === true,
      zh: {
        name: String(row?.zh?.name ?? ""),
        description: String(row?.zh?.description ?? ""),
        flavor: String(row?.zh?.flavor ?? ""),
      },
      en: {
        name: String(row?.en?.name ?? ""),
        description: String(row?.en?.description ?? ""),
        flavor: String(row?.en?.flavor ?? ""),
      },
    };
  });
}

function saveAchievementCopy(input) {
  const incomingRows = normalizeIncomingRows(input);
  const incoming = new Map(incomingRows.map((row) => [row.id, row]));
  if (!incoming.size) throw new Error("No achievements were provided.");

  const zh = readZhAchievements();
  const en = readEnCopy();
  const existingIds = new Set(zh.rows.map((row) => row.id));
  const zhReplacements = [];
  const enReplacements = [];

  for (const row of incomingRows) {
    if (!existingIds.has(row.id) && row.isDraft !== true) {
      throw new Error(`Unknown achievement id "${row.id}". Use the add button to create copy-only drafts.`);
    }
  }

  for (const row of zh.rows) {
    const next = incoming.get(row.id);
    if (!next) {
      addDeletion(zhReplacements, row.sourceRange);
      const enRow = en.byId.get(row.id);
      addDeletion(enReplacements, enRow?.sourceRange);
      continue;
    }
    addReplacement(zhReplacements, row.zhRanges.name, next.zh?.name);
    addReplacement(zhReplacements, row.zhRanges.description, next.zh?.description);
    addReplacement(zhReplacements, row.zhRanges.flavor, next.zh?.flavor);

    const enRow = en.byId.get(row.id);
    if (enRow) {
      addReplacement(enReplacements, enRow.enRanges.name, next.en?.name);
      addReplacement(enReplacements, enRow.enRanges.description, next.en?.description);
      addReplacement(enReplacements, enRow.enRanges.flavor, next.en?.flavor);
    }
  }

  for (const row of incomingRows) {
    if (existingIds.has(row.id)) continue;
    addInsertion(zhReplacements, zh.insertAt, achievementObjectSource(row));
    addInsertion(enReplacements, en.insertAt, englishCopySource(row));
  }

  writeFileSync(achievementsPath, applyReplacements(zh.text, zhReplacements), "utf8");
  writeFileSync(i18nPath, applyReplacements(en.text, enReplacements), "utf8");
  return readAchievementCopy();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

async function handle(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, pageHtml());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/achievements") {
      sendJson(response, 200, readAchievementCopy());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/save") {
      const body = await readBody(request);
      sendJson(response, 200, saveAchievementCopy(JSON.parse(body)));
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function openUrl(url) {
  if (!shouldOpen) return;
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
  child.unref();
}

function listen(port) {
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < defaultPort + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`Achievement copy editor: ${url}`);
    console.log("Press Ctrl+C to stop.");
    openUrl(url);
  });
}

function pageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vibe Tree Achievement Copy Editor</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
      background: #f6f7f4;
      color: #172019;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid #d8ded7;
      background: rgba(246, 247, 244, 0.94);
      backdrop-filter: blur(12px);
    }
    h1 { margin: 0; font-size: 22px; }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) repeat(5, auto);
      gap: 10px;
      align-items: center;
    }
    input, select, textarea, button {
      border: 1px solid #cdd6ce;
      border-radius: 8px;
      background: #fff;
      color: inherit;
      font: inherit;
    }
    input, select { min-height: 36px; padding: 0 10px; }
    button {
      min-height: 36px;
      padding: 0 14px;
      font-weight: 800;
      cursor: pointer;
    }
    button.primary {
      border-color: #227865;
      background: #2f8a76;
      color: #fff;
    }
    button.danger {
      border-color: #d9b1a9;
      color: #a23b2d;
      background: #fff5f2;
    }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    main {
      display: grid;
      gap: 12px;
      padding: 16px 22px 40px;
    }
    .status {
      min-height: 22px;
      color: #607067;
      font-size: 13px;
    }
    .notice {
      margin: 0;
      color: #607067;
      font-size: 13px;
      line-height: 1.4;
    }
    .card {
      display: grid;
      grid-template-columns: 190px 1fr 1fr;
      gap: 12px;
      padding: 14px;
      border: 1px solid #dce2dc;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 10px 30px rgba(28, 38, 32, 0.05);
    }
    .meta {
      display: grid;
      align-content: start;
      gap: 8px;
      min-width: 0;
    }
    .id {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-weight: 900;
      overflow-wrap: anywhere;
    }
    .system-meta {
      display: grid;
      gap: 8px;
      color: #607067;
      font-size: 12px;
      line-height: 1.35;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge {
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef3ef;
      color: #4c6256;
      font-size: 12px;
      font-weight: 800;
    }
    .badge.accent {
      background: #e5f3ef;
      color: #227865;
    }
    .draft-note {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid #d8ded7;
      border-radius: 8px;
      background: #f8faf6;
      color: #52645a;
      font-size: 12px;
      line-height: 1.45;
    }
    .copy {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .copy h2 {
      margin: 0;
      color: #227865;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    label { display: grid; gap: 4px; color: #607067; font-size: 12px; font-weight: 800; }
    textarea {
      width: 100%;
      min-height: 56px;
      resize: vertical;
      padding: 8px 10px;
      line-height: 1.35;
    }
    textarea[data-field="flavor"] { min-height: 72px; }
    .changed {
      border-color: #d89827;
      box-shadow: 0 0 0 2px rgba(216, 152, 39, 0.12);
    }
    @media (max-width: 980px) {
      .toolbar { grid-template-columns: 1fr 1fr; }
      .card { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Vibe Tree 成就文案调试编辑器</h1>
    <div class="toolbar">
      <input id="search" placeholder="搜索 id / 中文 / English" />
      <select id="category"><option value="">全部分类</option></select>
      <select id="rarity"><option value="">全部稀有度</option></select>
      <button id="add">新增文案草稿</button>
      <button id="reload">重新读取</button>
      <button id="save" class="primary" disabled>保存到源码</button>
    </div>
    <p class="notice">这个页面只用于改成就文案。新增项会保存成未开放占位，真实的系统 ID、解锁条件和统计逻辑还需要后续在源码里实现。</p>
    <div id="status" class="status">Loading...</div>
  </header>
  <main id="list"></main>
  <script>
    let rows = [];
    let original = new Map();
    let dirty = false;

    const list = document.querySelector("#list");
    const status = document.querySelector("#status");
    const search = document.querySelector("#search");
    const category = document.querySelector("#category");
    const rarity = document.querySelector("#rarity");
    const saveButton = document.querySelector("#save");
    const reloadButton = document.querySelector("#reload");
    const addButton = document.querySelector("#add");
    const categories = ["growth", "peak", "time", "agent", "hidden"];
    const rarities = ["common", "rare", "epic", "legendary", "hidden"];

    const keyFor = (row) => JSON.stringify(row);
    const setStatus = (text) => { status.textContent = text; };
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));

    async function load() {
      const response = await fetch("/api/achievements");
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Load failed");
      rows = data.achievements;
      original = new Map(rows.map((row) => [row.id, keyFor(row)]));
      dirty = false;
      saveButton.disabled = true;
      fillFilters();
      render();
      setStatus(\`已读取 \${rows.length} 个成就。修改后 Ctrl+S 保存。\`);
    }

    function fillFilters() {
      const currentCategory = category.value;
      const currentRarity = rarity.value;
      category.innerHTML = '<option value="">全部分类</option>' + categories.map((item) => \`<option value="\${escapeHtml(item)}">\${escapeHtml(item)}</option>\`).join("");
      rarity.innerHTML = '<option value="">全部稀有度</option>' + rarities.map((item) => \`<option value="\${escapeHtml(item)}">\${escapeHtml(item)}</option>\`).join("");
      category.value = currentCategory;
      rarity.value = currentRarity;
    }

    function filteredRows() {
      const query = search.value.trim().toLowerCase();
      return rows.filter((row) => {
        if (category.value && row.category !== category.value) return false;
        if (rarity.value && row.rarity !== rarity.value) return false;
        if (!query) return true;
        return [
          row.id,
          row.zh?.name,
          row.zh?.description,
          row.zh?.flavor,
          row.en?.name,
          row.en?.description,
          row.en?.flavor,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      });
    }

    function render() {
      const visible = filteredRows();
      list.innerHTML = visible.map((row) => cardHtml(row, rows.indexOf(row))).join("");
      setStatus(\`显示 \${visible.length} / \${rows.length} 个成就\${dirty ? "，有未保存修改" : ""}。\`);
    }

    function cardHtml(row, index) {
      return \`
        <article class="card" data-id="\${escapeHtml(row.id)}" data-index="\${index}">
          <section class="meta">
            <div class="system-meta">
              <div>
                <span>系统 ID</span>
                <div class="id">\${escapeHtml(row.id)}</div>
              </div>
              <div class="badges">
                <span class="badge">\${escapeHtml(row.category)}</span>
                <span class="badge">\${escapeHtml(row.rarity)}</span>
                \${row.isNew ? '<span class="badge accent">文案草稿</span>' : ''}
                \${row.hidden ? '<span class="badge">隐藏成就</span>' : ''}
                \${row.planned ? '<span class="badge">未开放</span>' : ''}
              </div>
            </div>
            \${row.isNew ? '<p class="draft-note">新增项只会写入文案占位：默认不会解锁，也不会作为正式成就展示。真正的解锁条件和统计口径需要之后再补代码。</p>' : ''}
            <button class="danger" data-action="delete" data-index="\${index}" type="button">删除</button>
          </section>
          \${copyHtml(row, "zh", "中文", index)}
          \${copyHtml(row, "en", "English", index)}
        </article>
      \`;
    }

    function copyHtml(row, locale, title, index) {
      const copy = row[locale] || {};
      return \`
        <section class="copy">
          <h2>\${title}</h2>
          \${fieldHtml(index, locale, "name", "名称", copy.name)}
          \${fieldHtml(index, locale, "description", "条件/描述", copy.description)}
          \${fieldHtml(index, locale, "flavor", "彩蛋文案", copy.flavor)}
        </section>
      \`;
    }

    function fieldHtml(index, locale, field, label, value) {
      return \`
        <label>
          <span>\${label}</span>
          <textarea data-index="\${index}" data-locale="\${locale}" data-field="\${field}">\${escapeHtml(value ?? "")}</textarea>
        </label>
      \`;
    }

    function updateDirtyState() {
      dirty = rows.length !== original.size || rows.some((row) => original.get(row.id) !== keyFor(row));
      saveButton.disabled = !dirty;
      document.querySelectorAll(".card").forEach((card) => {
        const row = rows[Number(card.dataset.index)];
        card.classList.toggle("changed", Boolean(row && original.get(row.id) !== keyFor(row)));
      });
      setStatus(\`显示 \${filteredRows().length} / \${rows.length} 个成就\${dirty ? "，有未保存修改" : ""}。\`);
    }

    function nextDraftId() {
      let index = 1;
      let id = "draft_achievement";
      const ids = new Set(rows.map((row) => row.id));
      while (ids.has(id)) {
        index += 1;
        id = \`draft_achievement_\${index}\`;
      }
      return id;
    }

    function addAchievement() {
      rows.unshift({
        id: nextDraftId(),
        category: "growth",
        rarity: "common",
        hidden: false,
        planned: true,
        isNew: true,
        isDraft: true,
        zh: { name: "新成就", description: "文案占位，待实现", flavor: "这是一条调试文案。" },
        en: { name: "New Achievement", description: "Copy draft, implementation pending", flavor: "Draft flavor text." },
      });
      search.value = "";
      category.value = "";
      rarity.value = "";
      render();
      updateDirtyState();
    }

    function validateBeforeSave() {
      const ids = new Set();
      for (const row of rows) {
        if (!/^[a-z][a-z0-9_]*$/.test(row.id)) {
          throw new Error(\`无效 ID：\${row.id}。只能用小写字母、数字、下划线，并以字母开头。\`);
        }
        if (ids.has(row.id)) throw new Error(\`重复 ID：\${row.id}\`);
        ids.add(row.id);
      }
    }

    async function save() {
      validateBeforeSave();
      saveButton.disabled = true;
      setStatus("保存中...");
      const response = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievements: rows }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Save failed");
      rows = data.achievements;
      original = new Map(rows.map((row) => [row.id, keyFor(row)]));
      dirty = false;
      render();
      saveButton.disabled = true;
      setStatus("已保存到 src/renderer/achievements.ts 和 src/renderer/i18n.ts。");
    }

    list.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const row = rows[Number(target.dataset.index)];
      const locale = target.dataset.locale;
      const field = target.dataset.field;
      if (!row || !field) return;
      if (locale) {
        row[locale] ||= {};
        row[locale][field] = target.value;
      }
      updateDirtyState();
    });
    list.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("button[data-action='delete']") : null;
      if (!button) return;
      const index = Number(button.dataset.index);
      const row = rows[index];
      if (!row) return;
      if (!confirm(\`删除成就 \${row.id}？保存后会从源码移除。\`)) return;
      rows.splice(index, 1);
      render();
      updateDirtyState();
    });
    [search, category, rarity].forEach((control) => control.addEventListener("input", render));
    addButton.addEventListener("click", addAchievement);
    reloadButton.addEventListener("click", () => load().catch((error) => setStatus(error.message)));
    saveButton.addEventListener("click", () => save().catch((error) => {
      setStatus(error.message);
      updateDirtyState();
    }));
    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) save().catch((error) => setStatus(error.message));
      }
    });
    load().catch((error) => setStatus(error.message));
  </script>
</body>
</html>`;
}

listen(defaultPort);
