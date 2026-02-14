/**
 * Website Modernizer Plugin
 *
 * Autonomous AI agent system that discovers outdated small business websites,
 * generates modern replacements, and sends outreach with live demos.
 *
 * Registers two tools:
 * - website_modernizer_pipeline: Full pipeline control (scout/analyze/build/sell)
 * - website_modernizer_build: Standalone site builder for one-off generation
 */

import type { ClawdbotPluginApi } from "../../src/plugins/types.js";
import { createPipelineTool } from "./src/tools/pipeline-tool.js";
import { createBuildTool } from "./src/tools/build-tool.js";

const plugin = {
  id: "website-modernizer",
  name: "Website Modernizer",
  description: "Autonomous AI agent pipeline for discovering outdated websites, building modern replacements, and selling them.",

  register(api: ClawdbotPluginApi) {
    // Register the full pipeline tool (optional - must be allowlisted)
    api.registerTool(createPipelineTool(api), { optional: true });

    // Register the standalone build tool (optional)
    api.registerTool(createBuildTool(api), { optional: true });

    api.logger.info("Website Modernizer plugin registered (2 tools)");
  },
};

export default plugin;
