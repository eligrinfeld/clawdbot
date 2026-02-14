/**
 * Hosting service: deploys generated sites to Vercel or Netlify.
 * Each site gets a unique preview URL for the outreach email.
 */

import type { ModernizerConfig } from "../types.js";

export interface DeployResult {
  success: boolean;
  url?: string;
  deployId?: string;
  error?: string;
}

/**
 * Deploy a single HTML file to a hosting provider.
 * Returns a live preview URL.
 */
export async function deploySite(
  config: ModernizerConfig,
  html: string,
  siteName: string,
): Promise<DeployResult> {
  const provider = config.hostingProvider ?? "netlify";
  const token = config.hostingToken ?? process.env.HOSTING_TOKEN;

  if (!token) {
    return { success: false, error: `No ${provider} API token configured` };
  }

  switch (provider) {
    case "vercel":
      return deployToVercel(token, html, siteName);
    case "netlify":
      return deployToNetlify(token, html, siteName);
    default:
      return { success: false, error: `Unknown hosting provider: ${provider}` };
  }
}

async function deployToNetlify(token: string, html: string, siteName: string): Promise<DeployResult> {
  try {
    // Create a new site deploy via Netlify API
    // Using the file digest approach for single-file deploys
    const slug = sanitizeSlug(siteName);

    // Step 1: Create site (or use existing)
    const siteRes = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `mod-${slug}-${Date.now()}` }),
    });

    if (!siteRes.ok) {
      return { success: false, error: `Netlify site creation failed: ${await siteRes.text()}` };
    }

    const site = (await siteRes.json()) as { id: string; url: string; ssl_url: string };

    // Step 2: Deploy files
    // Create a zip with index.html for the deploy
    const { createDeployZip } = await createZipBuffer(html);

    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/zip",
      },
      body: createDeployZip,
    });

    if (!deployRes.ok) {
      return { success: false, error: `Netlify deploy failed: ${await deployRes.text()}` };
    }

    const deploy = (await deployRes.json()) as { id: string; ssl_url: string; url: string };

    return {
      success: true,
      url: deploy.ssl_url || deploy.url || site.ssl_url,
      deployId: deploy.id,
    };
  } catch (err) {
    return { success: false, error: `Netlify deploy error: ${(err as Error).message}` };
  }
}

async function deployToVercel(token: string, html: string, siteName: string): Promise<DeployResult> {
  try {
    const slug = sanitizeSlug(siteName);

    // Vercel API: create deployment with files
    const deployRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `mod-${slug}`,
        files: [
          {
            file: "index.html",
            data: Buffer.from(html).toString("base64"),
            encoding: "base64",
          },
        ],
        projectSettings: {
          framework: null,
          outputDirectory: ".",
        },
      }),
    });

    if (!deployRes.ok) {
      return { success: false, error: `Vercel deploy failed: ${await deployRes.text()}` };
    }

    const deploy = (await deployRes.json()) as { id: string; url: string };

    return {
      success: true,
      url: `https://${deploy.url}`,
      deployId: deploy.id,
    };
  } catch (err) {
    return { success: false, error: `Vercel deploy error: ${(err as Error).message}` };
  }
}

function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Create a minimal zip buffer containing index.html.
 * Uses a simple zip structure without external dependencies.
 */
async function createZipBuffer(htmlContent: string): Promise<{ createDeployZip: Buffer }> {
  // Minimal ZIP file construction for a single index.html
  const fileName = "index.html";
  const fileData = Buffer.from(htmlContent, "utf-8");
  const fileNameBuf = Buffer.from(fileName, "utf-8");

  // CRC32 calculation
  const crc = crc32(fileData);

  // Local file header
  const localHeader = Buffer.alloc(30 + fileNameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // compression (stored)
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(crc, 14); // crc32
  localHeader.writeUInt32LE(fileData.length, 18); // compressed size
  localHeader.writeUInt32LE(fileData.length, 22); // uncompressed size
  localHeader.writeUInt16LE(fileNameBuf.length, 26); // name length
  localHeader.writeUInt16LE(0, 28); // extra field length
  fileNameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const centralOffset = localHeader.length + fileData.length;

  // Central directory header
  const centralHeader = Buffer.alloc(46 + fileNameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0); // signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // compression
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0, 14); // mod date
  centralHeader.writeUInt32LE(crc, 16); // crc32
  centralHeader.writeUInt32LE(fileData.length, 20); // compressed size
  centralHeader.writeUInt32LE(fileData.length, 24); // uncompressed size
  centralHeader.writeUInt16LE(fileNameBuf.length, 28); // name length
  centralHeader.writeUInt16LE(0, 30); // extra field length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number start
  centralHeader.writeUInt16LE(0, 36); // internal attributes
  centralHeader.writeUInt32LE(0, 38); // external attributes
  centralHeader.writeUInt32LE(localOffset, 42); // relative offset
  fileNameBuf.copy(centralHeader, 46);

  // End of central directory
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // signature
  endRecord.writeUInt16LE(0, 4); // disk number
  endRecord.writeUInt16LE(0, 6); // central dir disk
  endRecord.writeUInt16LE(1, 8); // entries on disk
  endRecord.writeUInt16LE(1, 10); // total entries
  endRecord.writeUInt32LE(centralHeader.length, 12); // central dir size
  endRecord.writeUInt32LE(centralOffset, 16); // central dir offset
  endRecord.writeUInt16LE(0, 20); // comment length

  return {
    createDeployZip: Buffer.concat([localHeader, fileData, centralHeader, endRecord]),
  };
}

/** CRC32 for ZIP files. */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
