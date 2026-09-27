/**
 * 由 docs/使用帮助.md 生成官网文档页 site/docs.html。
 *
 * 【为什么要生成而不是手写一份】软件内帮助页与官网文档必须永远一致。
 * 手写第二份就会漂移（改了软件里的、忘了官网的）。这里以 Markdown 为唯一源头：
 *   docs/使用帮助.md  →  （本脚本）  →  site/docs.html
 * 软件内的帮助页读的是 src/web/help.ts（同一份正文的副本，由同一个文件导入生成）。
 *
 * 用法：deno run -A scripts/build-site-docs.ts
 */

const MD_PATH = "docs/使用帮助.md";
const OUT_PATH = "site/docs.html";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/(https:\/\/[^\s<)]+)/g, (u) => "<a href=\"" + u + "\">" + u + "</a>");
  return t;
}

function convert(md: string): string {
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      closeLists();
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(raw)); continue; }
    if (line.startsWith("### ")) { closeLists(); out.push("<h3>" + inline(line.slice(4)) + "</h3>"); continue; }
    if (line.startsWith("## ")) { closeLists(); out.push("<h2>" + inline(line.slice(3)) + "</h2>"); continue; }
    if (line.startsWith("# ")) { closeLists(); out.push("<h1>" + inline(line.slice(2)) + "</h1>"); continue; }
    if (line.startsWith("- ")) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push("<li>" + inline(line.slice(2)) + "</li>");
      continue;
    }
    const m = /^(\d+)\. (.*)$/.exec(line);
    if (m) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push("<li>" + inline(m[2]!) + "</li>");
      continue;
    }
    if (!line.trim()) { closeLists(); continue; }
    closeLists();
    out.push("<p>" + inline(line) + "</p>");
  }
  closeLists();
  return out.join("\n");
}

const md = await Deno.readTextFile(MD_PATH);
const body = convert(md);
const title = (md.split("\n").find((l) => l.startsWith("# ")) ?? "# 使用帮助").slice(2).trim();
const html = [
  "<!doctype html>",
  "<html lang=\"zh-CN\">",
  "<head>",
  "<meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
  "<title>" + esc(title) + " · DSH管家</title>",
  "<meta name=\"description\" content=\"DSH 管家使用帮助：第一次用、日常五件事、定时守护、诊断包、写操作审计、技能快照、网络与离线、常见疑问。\">",
  "<link rel=\"icon\" href=\"/assets/favicon-32.png\">",
  "<link rel=\"stylesheet\" href=\"/docs.css\">",
  "<style>",
  "  .doc-wrap { max-width: 820px; margin: 0 auto; padding: 96px 24px 80px; }",
  "  .doc-body h1 { font-size: 30px; margin: 0 0 20px; }",
  "  .doc-body h2 { font-size: 20px; margin: 34px 0 10px; padding-top: 18px; border-top: 1px solid var(--line, #e8e4dc); }",
  "  .doc-body h2:first-of-type { border-top: none; padding-top: 0; }",
  "  .doc-body p, .doc-body li { line-height: 1.8; color: var(--ink-2, #4a4740); }",
  "  .doc-body ul, .doc-body ol { padding-left: 22px; }",
  "  .doc-body li { margin: 6px 0; }",
  "  .doc-body code { background: #f2efe9; padding: 1px 6px; border-radius: 4px; font-size: 14px; }",
  "  .doc-body pre { background: #f2efe9; padding: 14px 16px; border-radius: 10px; overflow: auto; }",
  "  .doc-body a { color: #c24a1e; }",
  "  .doc-back { position: fixed; top: 20px; left: 24px; }",
  "</style>",
  "</head>",
  "<body>",
  "<a class=\"btn btn-ghost doc-back\" href=\"/\">← 返回首页</a>",
  "<main class=\"doc-wrap\"><article class=\"doc-body\">" + body + "</article></main>",
  "</body>",
  "</html>",
  "",
].join("\n");
await Deno.writeTextFile(OUT_PATH, html);
console.log("已生成 " + OUT_PATH + "（正文 " + body.split("\n").length + " 行）");