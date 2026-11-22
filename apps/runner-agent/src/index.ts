#!/usr/bin/env node
/**
 * QC Runner Agent (Host hoặc Docker).
 *   QC_SERVER_URL=https://qc.noi-bo.local RUNNER_TOKEN=rn_... node dist/index.js
 * Token do QC tạo ở trang "Runner" (chỉ hiện một lần). Không có mật khẩu mặc định, không ghi bí mật ra đĩa.
 */
import os from "node:os";
import path from "node:path";
import { playwrightBrowser, runLoop, type AgentConfig } from "./agent.js";
import { checkServerUrl } from "./serverUrl.js";

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Thiếu biến môi trường ${name}`);
    process.exit(1);
  }
  return v;
}

const server = need("QC_SERVER_URL");
const urlError = checkServerUrl(server, process.env.RUNNER_ALLOW_HTTP === "1");
if (urlError) {
  console.error(urlError);
  process.exit(1);
}
const skipLogin = process.env.RUNNER_SKIP_LOGIN === "1";
if (skipLogin) console.warn("CẢNH BÁO: RUNNER_SKIP_LOGIN=1 — bỏ qua đăng nhập, chỉ dùng để kiểm thử giao thức trên máy dev.");

const cfg: AgentConfig = {
  server,
  token: need("RUNNER_TOKEN"),
  pollMs: Number(process.env.RUNNER_POLL_MS ?? 3000),
  headless: process.env.RUNNER_HEADLESS === "1" || process.env.RUNNER_HEADLESS === undefined && process.platform === "linux",
  skipLogin,
  profileDir: process.env.RUNNER_PROFILE_DIR ?? path.join(os.homedir(), ".qc-runner", "profiles"),
};

const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());
await runLoop(cfg, playwrightBrowser, (m) => console.log(`${new Date().toISOString()} ${m}`), ac.signal);
