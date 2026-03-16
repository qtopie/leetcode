#!/usr/bin/env node

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";

const CDP_ENDPOINT = "http://127.0.0.1:9222";
const LEETCODE_TOML_PATH = path.join(os.homedir(), ".leetcode", "leetcode.toml");
const COOKIE_WAIT_TIMEOUT_MS = 30_000;
const COOKIE_WAIT_INTERVAL_MS = 1_000;

const SITE_CONFIG = {
  "leetcode.com": {
    home: "https://leetcode.com/",
    login: "https://leetcode.com/accounts/login/",
    csrfCookie: "csrftoken",
    sessionCookie: "LEETCODE_SESSION",
  },
  "leetcode.cn": {
    home: "https://leetcode.cn/",
    login: "https://leetcode.cn/accounts/login/",
    csrfCookie: "csrftoken",
    sessionCookie: "LEETCODE_SESSION",
  },
};

function parseArgs(argv) {
  const result = {
    site: "leetcode.com",
    output: path.join(os.homedir(), ".leetcode", "leetcode-cookies.json"),
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--site") {
      result.site = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output") {
      result.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--debug") {
      result.debug = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/get-leetcode-cookies.mjs [--site leetcode.com|leetcode.cn] [--output <path>] [--debug]

Opens a visible browser, waits for you to log in, and then exports the
LeetCode session cookies to a local file. Do not paste the generated values
into chat or commit them to git.`);
}

async function promptForLogin(site) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question(
      `Log in to ${site}, then press Enter here to capture cookies...`,
    );
  } finally {
    rl.close();
  }
}

function pickCookie(cookies, name) {
  return cookies.find((cookie) => cookie.name === name)?.value ?? "";
}

function dedupeCookies(cookies) {
  const uniqueMap = new Map();
  for (const cookie of cookies) {
    const cookieKey = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    uniqueMap.set(cookieKey, cookie);
  }
  return [...uniqueMap.values()];
}

async function collectCookies(context, siteConfig) {
  const [allCookies, scopedCookies] = await Promise.all([
    context.cookies(),
    context.cookies(siteConfig.home, siteConfig.login),
  ]);
  return dedupeCookies([...allCookies, ...scopedCookies]);
}

async function waitForRequiredCookies(context, siteConfig, siteUrl, page, debug) {
  const startTime = Date.now();
  let latestCookies = [];

  while (Date.now() - startTime < COOKIE_WAIT_TIMEOUT_MS) {
    latestCookies = await collectCookies(context, siteConfig);
    const csrf = pickCookie(latestCookies, siteConfig.csrfCookie);
    const session = pickCookie(latestCookies, siteConfig.sessionCookie);

    if (debug) {
      const cookieSummary = latestCookies
        .map((cookie) => `${cookie.name}@${cookie.domain}`)
        .join(", ");
      console.log(
        `[debug] url=${page.url()} cookies=${cookieSummary || "(none)"}`,
      );
    }

    if (csrf && session) {
      return { cookies: latestCookies, csrf, session };
    }

    await new Promise((resolve) => {
      setTimeout(resolve, COOKIE_WAIT_INTERVAL_MS);
    });
  }

  const availableCookieNames = latestCookies
    .map((cookie) => `${cookie.name}@${cookie.domain}`)
    .join(", ");
  throw new Error(
    `could not find ${siteConfig.csrfCookie} or ${siteConfig.sessionCookie} within ${COOKIE_WAIT_TIMEOUT_MS / 1000}s on ${siteUrl}; available cookies: ${availableCookieNames || "(none)"}`,
  );
}

function buildTomlSnippet({ csrf, session, site }) {
  return [
    "[cookies]",
    `csrf = "${csrf}"`,
    `session = "${session}"`,
    `site = "${site}"`,
  ].join("\n");
}

function buildCookiesKeyValues(payload) {
  return {
    csrf: payload.csrf,
    session: payload.session,
    site: payload.site,
  };
}

function upsertCookiesKeys(sectionBody, keyValues) {
  const lines = sectionBody ? sectionBody.split("\n") : [];
  const keyOrder = ["csrf", "session", "site"];
  const seenKeys = new Set();
  const updatedLines = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)(csrf|session|site)\s*=/);
    if (!match) {
      updatedLines.push(line);
      continue;
    }

    const key = match[2];
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    updatedLines.push(`${match[1]}${key} = "${keyValues[key]}"`);
  }

  for (const key of keyOrder) {
    if (!seenKeys.has(key)) {
      updatedLines.push(`${key} = "${keyValues[key]}"`);
    }
  }

  return updatedLines.join("\n").replace(/^\n+|\n+$/g, "");
}

function replaceCookiesSection(existingToml, payload) {
  const keyValues = buildCookiesKeyValues(payload);
  const cookiesSectionRegex = /(^\[cookies\][^\n]*\n?)([\s\S]*?)(?=^\[[^\]]+\][^\n]*\n?|\s*$)/m;
  const matchedSection = existingToml.match(cookiesSectionRegex);

  if (matchedSection) {
    const header = matchedSection[1].endsWith("\n")
      ? matchedSection[1]
      : `${matchedSection[1]}\n`;
    const updatedBody = upsertCookiesKeys(matchedSection[2], keyValues);
    const replacement = `${header}${updatedBody}\n`;
    return existingToml.replace(cookiesSectionRegex, replacement);
  }

  const appendedSection = `${buildTomlSnippet(payload)}\n`;
  if (!existingToml.trim()) {
    return appendedSection;
  }

  return `${existingToml.trimEnd()}\n\n${appendedSection}`;
}

async function updateLeetCodeToml(payload) {
  let existingToml = "";

  try {
    existingToml = await readFile(LEETCODE_TOML_PATH, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const updatedToml = replaceCookiesSection(existingToml, payload);
  await writeFile(LEETCODE_TOML_PATH, updatedToml, { mode: 0o600 });
  await chmod(LEETCODE_TOML_PATH, 0o600);
}

async function connectOrLaunchBrowser() {
  try {
    const connectedBrowser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const existingContext = connectedBrowser.contexts()[0];
    const context = existingContext ?? (await connectedBrowser.newContext());
    return { browser: connectedBrowser, context, reusedDebugBrowser: true };
  } catch {
    const launchedBrowser = await chromium.launch({ headless: false });
    const context = await launchedBrowser.newContext();
    return { browser: launchedBrowser, context, reusedDebugBrowser: false };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const siteConfig = SITE_CONFIG[args.site];
  if (!siteConfig) {
    throw new Error(`unsupported site: ${args.site}`);
  }

  await mkdir(path.dirname(args.output), { recursive: true });

  const { browser, context, reusedDebugBrowser } = await connectOrLaunchBrowser();
  const page = await context.newPage();

  if (reusedDebugBrowser) {
    console.log(`Connected to existing Chrome debug instance at ${CDP_ENDPOINT}`);
  } else {
    console.log("No Chrome debug instance on port 9222; launched a new browser.");
  }

  console.log(`Opening ${siteConfig.login}`);
  await page.goto(siteConfig.login, { waitUntil: "domcontentloaded" });
  await promptForLogin(args.site);
  await page.goto(siteConfig.home, { waitUntil: "networkidle" });

  const { cookies, csrf, session } = await waitForRequiredCookies(
    context,
    siteConfig,
    siteConfig.home,
    page,
    args.debug,
  );

  const payload = {
    site: args.site,
    csrf,
    session,
    capturedAt: new Date().toISOString(),
    cookies: cookies
      .filter((cookie) =>
        [siteConfig.csrfCookie, siteConfig.sessionCookie].includes(cookie.name),
      )
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
  };

  await writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(args.output, 0o600);

  await updateLeetCodeToml(payload);

  console.log(`Saved cookies to ${args.output}`);
  console.log(`Saved LeetCode config to ${LEETCODE_TOML_PATH}`);

  if (reusedDebugBrowser) {
    await page.close();
  } else {
    await browser.close();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
