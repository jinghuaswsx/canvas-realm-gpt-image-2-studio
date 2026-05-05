import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_PATH = process.env.PROMPT_LIBRARY_REPO ?? "/home/cjh/code/awesome-gpt-image-2-prompts";
const CASES_DIR = join(REPO_PATH, "cases");
const OUT_PATH = resolve(process.cwd(), "public/prompt-library.json");

const CATEGORY_LABELS: Record<string, string> = {
  portrait: "人像与摄影",
  poster: "海报与平面设计",
  ui: "UI/界面设计",
  comparison: "对比图",
  ecommerce: "电商素材",
  "ad-creative": "广告创意",
  character: "角色设计",
};

interface PromptCase {
  id: string;
  category: string;
  categoryLabel: string;
  caseNumber: number;
  title: string;
  author: string;
  authorUrl: string;
  tweetUrl: string;
  imageUrl: string;
  prompt: string;
}

const HEADING_RE = /^###\s+Case\s+(\d+):\s*\[([^\]]+)\]\(([^)]+)\)\s*\(by\s+\[([^\]]+)\]\(([^)]+)\)\s*\)/;
const IMG_RE = /<img[^>]*src="([^"]+)"/;

function extractCases(category: string, markdown: string): PromptCase[] {
  const lines = markdown.split("\n");
  const cases: PromptCase[] = [];
  let current: { num: number; title: string; tweetUrl: string; author: string; authorUrl: string; bodyLines: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const body = current.bodyLines.join("\n");

    const imgMatch = body.match(IMG_RE);
    const imageUrl = imgMatch?.[1] ?? "";

    let prompt = "";
    const fenceIdx = body.indexOf("**提示词：**");
    if (fenceIdx !== -1) {
      const after = body.slice(fenceIdx);
      const fenceMatch = after.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
      if (fenceMatch) prompt = fenceMatch[1].trim();
    }

    if (prompt && imageUrl) {
      cases.push({
        id: `${category}-${current.num}`,
        category,
        categoryLabel: CATEGORY_LABELS[category] ?? category,
        caseNumber: current.num,
        title: current.title.trim(),
        author: current.author.replace(/^@/, ""),
        authorUrl: current.authorUrl,
        tweetUrl: current.tweetUrl,
        imageUrl,
        prompt,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flush();
      current = {
        num: Number(headingMatch[1]),
        title: headingMatch[2],
        tweetUrl: headingMatch[3],
        author: headingMatch[4],
        authorUrl: headingMatch[5],
        bodyLines: [],
      };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  flush();

  return cases;
}

async function main(): Promise<void> {
  const entries = await readdir(CASES_DIR);
  const targets = entries
    .filter((name) => name.endsWith("_zh-CN.md"))
    .map((name) => ({ name, category: name.replace(/_zh-CN\.md$/, "") }))
    .filter((entry) => entry.category in CATEGORY_LABELS);

  const all: PromptCase[] = [];
  for (const { name, category } of targets) {
    const md = await readFile(join(CASES_DIR, name), "utf8");
    const cases = extractCases(category, md);
    all.push(...cases);
    console.log(`  ${category}: ${cases.length}`);
  }

  all.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.caseNumber - b.caseNumber;
  });

  await mkdir(resolve(process.cwd(), "public"), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(all, null, 2), "utf8");
  console.log(`\nWrote ${all.length} cases → ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
