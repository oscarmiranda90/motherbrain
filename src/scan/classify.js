/**
 * Structural classification.
 *
 * This module answers "what IS this folder" — never "is it worth keeping".
 * That second question belongs to the person running the scan: a scaffold with
 * one commit may be the work that paid their rent, and no heuristic can know
 * that. So nothing here ranks, scores, or filters. It describes.
 *
 * What it does report is structure, which is verifiable: the ecosystem, the
 * framework, the kind of thing it is, and whether it sits inside a larger
 * project (a Flutter `android/` folder, a workspace package) — which is a fact
 * about the tree, not an opinion about the code.
 */

/** Ecosystem detection, by marker file. Order is display order. */
export const ECOSYSTEM_LABELS = {
  node: "Node",
  deno: "Deno",
  bun: "Bun",
  flutter: "Flutter",
  dart: "Dart",
  python: "Python",
  go: "Go",
  rust: "Rust",
  php: "PHP",
  wordpress: "WordPress",
  ruby: "Ruby",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  dotnet: ".NET",
  elixir: "Elixir",
  godot: "Godot",
  unity: "Unity",
  unreal: "Unreal",
  cpp: "C/C++",
  docker: "Docker",
};

/**
 * Framework detection.
 *
 * Each rule looks at evidence already gathered — dependency names, config
 * filenames, file contents — and contributes a label. A project can match
 * several: "Next.js + Tailwind + Supabase" is a more useful description than
 * forcing a single winner.
 */
const FRAMEWORK_RULES = [
  // --- JS/TS meta-frameworks (config file is stronger evidence than a dep) ---
  { label: "Next.js", files: [/^next\.config\.(js|ts|mjs|cjs)$/], deps: [/^next$/] },
  { label: "Nuxt", files: [/^nuxt\.config\.(js|ts)$/], deps: [/^nuxt$/] },
  { label: "Astro", files: [/^astro\.config\.(js|ts|mjs)$/], deps: [/^astro$/] },
  { label: "SvelteKit", files: [/^svelte\.config\.js$/], deps: [/^@sveltejs\/kit$/] },
  { label: "Remix", files: [/^remix\.config\.js$/], deps: [/^@remix-run\//] },
  { label: "Gatsby", files: [/^gatsby-config\.(js|ts)$/], deps: [/^gatsby$/] },
  { label: "Angular", files: [/^angular\.json$/], deps: [/^@angular\/core$/] },
  { label: "Docusaurus", files: [/^docusaurus\.config\.(js|ts)$/], deps: [/^@docusaurus\//] },

  // --- UI layer ---
  { label: "React", deps: [/^react$/] },
  { label: "Vue", deps: [/^vue$/] },
  { label: "Svelte", deps: [/^svelte$/] },
  { label: "Solid", deps: [/^solid-js$/] },
  { label: "Preact", deps: [/^preact$/] },

  // --- Mobile / desktop ---
  { label: "Expo", files: [/^app\.json$/, /^expo\.json$/], deps: [/^expo$/] },
  { label: "React Native", files: [/^metro\.config\.js$/], deps: [/^react-native$/] },
  { label: "Capacitor", files: [/^capacitor\.config\.(ts|json)$/], deps: [/^@capacitor\/core$/] },
  { label: "Electron", files: [/^electron\.vite\.config\.ts$/], deps: [/^electron$/] },
  { label: "Tauri", deps: [/^@tauri-apps\//] },

  // --- Build tooling ---
  { label: "Vite", files: [/^vite\.config\.(js|ts|mjs)$/], deps: [/^vite$/] },
  { label: "Webpack", files: [/^webpack\.config\.js$/], deps: [/^webpack$/] },
  { label: "Tailwind", files: [/^tailwind\.config\.(js|ts|cjs|mjs)$/], deps: [/^tailwindcss$/] },
  { label: "TypeScript", files: [/^tsconfig\.json$/], deps: [/^typescript$/] },

  // --- Backend ---
  { label: "Express", deps: [/^express$/] },
  { label: "Fastify", deps: [/^fastify$/] },
  { label: "Hono", deps: [/^hono$/] },
  { label: "NestJS", deps: [/^@nestjs\/core$/] },
  { label: "FastAPI", pyDeps: [/^fastapi/i] },
  { label: "Django", files: [/^manage\.py$/], pyDeps: [/^django/i] },
  { label: "Flask", pyDeps: [/^flask/i] },
  { label: "Laravel", files: [/^artisan$/], phpDeps: [/^laravel\/framework$/] },
  { label: "Symfony", phpDeps: [/^symfony\//] },
  { label: "Rails", files: [/^config\.ru$/], rubyDeps: [/^rails$/] },

  // --- Data ---
  { label: "Prisma", files: [/^schema\.prisma$/], deps: [/^prisma$|^@prisma\/client$/] },
  { label: "Drizzle", files: [/^drizzle\.config\.(ts|js)$/], deps: [/^drizzle-orm$/] },
  { label: "Payload CMS", files: [/^payload\.config\.ts$/], deps: [/^payload$/] },
  // Pubspec dependencies are indented under `dependencies:`, so every pubspec
  // pattern has to allow leading whitespace.
  { label: "Firebase", files: [/^firebase\.json$/], deps: [/^firebase$|^firebase-admin$/], pubspec: [/^\s*firebase_core:/m] },
  { label: "Supabase", deps: [/^@supabase\/supabase-js$/], pubspec: [/^\s*supabase_flutter:/m] },
  { label: "MongoDB", deps: [/^mongoose$|^mongodb$/] },
  { label: "PostgreSQL", deps: [/^pg$|^postgres$/] },
  { label: "GraphQL", deps: [/^graphql$/] },

  // --- State / data fetching ---
  { label: "Zustand", deps: [/^zustand$/] },
  { label: "Redux", deps: [/^redux$|^@reduxjs\/toolkit$/] },
  { label: "React Query", deps: [/^@tanstack\/react-query$/] },
  { label: "Riverpod", pubspec: [/^\s*(flutter_)?riverpod:/m] },
  { label: "Bloc", pubspec: [/^\s*flutter_bloc:/m] },

  // --- Graphics / media ---
  { label: "Three.js", deps: [/^three$/] },
  { label: "GSAP", deps: [/^gsap$/] },
  { label: "Framer Motion", deps: [/^framer-motion$|^motion$/] },
  { label: "Remotion", files: [/^remotion\.config\.ts$/], deps: [/^remotion$|^@remotion\//] },

  // --- AI ---
  { label: "OpenAI", deps: [/^openai$/], pyDeps: [/^openai/i] },
  { label: "Anthropic", deps: [/^@anthropic-ai\/sdk$/], pyDeps: [/^anthropic/i] },
  { label: "Vercel AI SDK", deps: [/^ai$/] },
  { label: "LangChain", deps: [/^langchain$|^@langchain\//], pyDeps: [/^langchain/i] },

  // --- Payments ---
  { label: "Stripe", deps: [/^stripe$|^@stripe\//] },

  // --- Testing ---
  { label: "Vitest", deps: [/^vitest$/] },
  { label: "Jest", deps: [/^jest$/] },
  { label: "Playwright", deps: [/^playwright$|^@playwright\/test$/] },
  { label: "Cypress", deps: [/^cypress$/] },
];

/**
 * Identify frameworks from the evidence collected for a project.
 *
 * @param {object} evidence
 * @param {string[]} [evidence.deps]      npm dependency names
 * @param {string[]} [evidence.pyDeps]    python requirement names
 * @param {string[]} [evidence.phpDeps]   composer package names
 * @param {string[]} [evidence.rubyDeps]  gem names
 * @param {string[]} [evidence.files]     filenames present at the project root
 * @param {string} [evidence.pubspecText] raw pubspec.yaml contents
 */
export function detectFrameworks(evidence = {}) {
  const deps = evidence.deps ?? [];
  const pyDeps = evidence.pyDeps ?? [];
  const phpDeps = evidence.phpDeps ?? [];
  const rubyDeps = evidence.rubyDeps ?? [];
  const files = evidence.files ?? [];
  const pubspec = evidence.pubspecText ?? "";

  const found = [];

  for (const rule of FRAMEWORK_RULES) {
    const hit =
      (rule.deps && rule.deps.some((re) => deps.some((d) => re.test(d)))) ||
      (rule.pyDeps && rule.pyDeps.some((re) => pyDeps.some((d) => re.test(d)))) ||
      (rule.phpDeps && rule.phpDeps.some((re) => phpDeps.some((d) => re.test(d)))) ||
      (rule.rubyDeps && rule.rubyDeps.some((re) => rubyDeps.some((d) => re.test(d)))) ||
      (rule.files && rule.files.some((re) => files.some((f) => re.test(f)))) ||
      (rule.pubspec && rule.pubspec.some((re) => re.test(pubspec)));

    if (hit) found.push(rule.label);
  }

  return [...new Set(found)];
}

/**
 * The structural role of a directory inside the tree.
 *
 * `project`  — a root someone would call a project
 * `platform` — toolchain-generated build scaffolding (android/, ios/, linux/)
 * `package`  — a workspace member or sub-package of a parent project
 * `nested`   — a project root that happens to live inside another project
 */
export function structuralRole(record) {
  if (!record.nestedUnder) return "project";

  const dirName = record.dirName ?? "";

  // A container folder wins over the name: `apps/web` is a workspace package,
  // even though `web` is also the name of a Flutter platform target.
  if (/(^|\/)(packages|apps|services|workers|functions|tools|scripts|examples?)\/[^/]+$/.test(record.path)) {
    return "package";
  }
  if (/^(functions|worker|workers|scripts|example|examples)$/i.test(dirName)) {
    return "package";
  }

  if (PLATFORM_ROLE_NAMES.has(dirName)) return "platform";

  return "nested";
}

const PLATFORM_ROLE_NAMES = new Set([
  "android",
  "ios",
  "macos",
  "windows",
  "linux",
  "web",
  "runner",
  "winrt",
  "fuchsia",
  "ohos",
  "harmony",
]);

/**
 * A short, honest description of what a directory is, for display.
 * Frameworks first (they carry the most information), then ecosystem.
 */
export function describeStructure(record) {
  const frameworks = record.frameworks ?? [];
  const ecosystems = (record.ecosystems ?? []).map((e) => ECOSYSTEM_LABELS[e] ?? e);

  if (frameworks.length) {
    const head = frameworks.slice(0, 4).join(" · ");
    const extra = frameworks.length > 4 ? ` +${frameworks.length - 4}` : "";
    return head + extra;
  }
  if (ecosystems.length) return ecosystems.join(" · ");
  return "unknown";
}

/**
 * The kind of artifact this looks like, structurally. Used as a starting value
 * for the manifest's `kind` field, which the user can always correct.
 */
export function inferKind(record) {
  const eco = record.ecosystems ?? [];
  const fw = record.frameworks ?? [];
  const role = record.role ?? "project";

  if (role === "platform") return "platform-scaffold";
  if (eco.includes("godot") || eco.includes("unity") || eco.includes("unreal")) return "game";
  if (eco.includes("flutter")) return "mobile-app";
  if (fw.includes("Expo") || fw.includes("React Native") || fw.includes("Capacitor")) {
    return "mobile-app";
  }
  if (fw.includes("Electron") || fw.includes("Tauri")) return "desktop-app";
  if (eco.includes("wordpress")) return "website";
  if (fw.includes("Remotion")) return "content-pipeline";
  if (fw.includes("Docusaurus")) return "docs-site";
  if (fw.includes("Astro") || fw.includes("Gatsby")) return "website";
  if (fw.some((f) => ["Next.js", "Nuxt", "SvelteKit", "Remix", "Angular"].includes(f))) {
    return "web-app";
  }
  if (fw.some((f) => ["Express", "Fastify", "Hono", "NestJS", "FastAPI", "Django", "Flask", "Laravel", "Rails"].includes(f))) {
    return "service";
  }
  if (fw.includes("React") || fw.includes("Vue") || fw.includes("Svelte")) return "web-app";
  if (eco.includes("go") || eco.includes("rust")) return "cli";
  return "unknown";
}
