/**
 * LLM prompt templates for each agent stage.
 * All prompts are functions that accept structured context and return a string.
 */

import type { Analysis, BusinessInfo, DesignSystem, LighthouseScores } from "../types.js";

// ── Builder Agent Prompts ──

export function designSystemPrompt(info: {
  businessName: string;
  industry: string;
  brandTone: string;
  existingColors?: string[];
}): string {
  return `You are an expert web designer. Generate a modern design system for a ${info.industry} business called "${info.businessName}".

Brand tone: ${info.brandTone}
${info.existingColors?.length ? `Existing brand colors to consider: ${info.existingColors.join(", ")}` : ""}

Output ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "primaryColor": "#hex",
  "secondaryColor": "#hex",
  "accentColor": "#hex",
  "neutralLight": "#hex",
  "neutralDark": "#hex",
  "headingFont": "Google Font name",
  "bodyFont": "Google Font name",
  "style": "brief style description (e.g., minimalist professional, warm friendly, bold modern)"
}

Requirements:
- Colors must have sufficient contrast (WCAG AA)
- Fonts must be available on Google Fonts
- Palette should feel professional and trustworthy for ${info.industry}
- Consider the brand tone: ${info.brandTone}`;
}

export function contentGenerationPrompt(info: {
  businessName: string;
  industry: string;
  services: string[];
  valuePropositions: string[];
  targetAudience: string;
  location: string | null;
  phone: string | null;
  email: string | null;
}): string {
  return `You are an expert copywriter specializing in small business websites. Rewrite content for "${info.businessName}", a ${info.industry} business.

Known services: ${info.services.join(", ") || "Not specified"}
Value propositions: ${info.valuePropositions.join(", ") || "Not specified"}
Target audience: ${info.targetAudience || "Local customers"}
Location: ${info.location || "Not specified"}

Output ONLY valid JSON with this structure (no markdown, no explanation):
{
  "heroHeadline": "Compelling headline (max 10 words)",
  "heroSubheadline": "Supporting text (max 25 words)",
  "ctaText": "Call to action button text (2-4 words)",
  "aboutHeading": "About section heading",
  "aboutText": "2-3 sentences about the business. Factual only - do not invent credentials or history.",
  "services": [
    { "name": "Service Name", "description": "1-2 sentence benefit-focused description" }
  ],
  "contactHeading": "Contact section heading",
  "contactSubtext": "Brief invitation to get in touch",
  "footerTagline": "Short tagline for footer"
}

Rules:
- Keep all factual info accurate (do NOT invent services, credentials, or awards)
- Write benefit-focused copy (what the customer gets, not what the business does)
- Maintain professional, trustworthy tone
- Use the business name naturally
- Include location if known
- Phone: ${info.phone || "omit"}
- Email: ${info.email || "omit"}`;
}

export function siteGenerationPrompt(info: {
  businessName: string;
  industry: string;
  content: string;
  designSystem: DesignSystem;
  contactPhone: string | null;
  contactEmail: string | null;
  location: string | null;
}): string {
  return `You are an expert frontend developer. Create a modern, production-ready single-page website.

Business: ${info.businessName} (${info.industry})
Location: ${info.location || "Not specified"}
Phone: ${info.contactPhone || "Not available"}
Email: ${info.contactEmail || "Not available"}

Design System:
- Primary: ${info.designSystem.primaryColor}
- Secondary: ${info.designSystem.secondaryColor}
- Accent: ${info.designSystem.accentColor}
- Light neutral: ${info.designSystem.neutralLight}
- Dark neutral: ${info.designSystem.neutralDark}
- Heading font: ${info.designSystem.headingFont}
- Body font: ${info.designSystem.bodyFont}
- Style: ${info.designSystem.style}

Content (JSON):
${info.content}

REQUIREMENTS:
1. Output ONLY complete HTML (no markdown fences, no explanation) starting with <!DOCTYPE html>
2. Single self-contained HTML file with all CSS inline in a <style> tag
3. Include Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
4. Load Google Fonts via <link> tags for the specified fonts
5. Mobile-first responsive design (looks great on phone, tablet, and desktop)
6. Sections in order: Navigation, Hero, Services, About, Contact, Footer
7. Smooth scroll navigation with anchor links
8. Modern layout patterns: CSS Grid, Flexbox
9. Subtle animations (CSS only, no JS library): fade-in on scroll, hover effects
10. Accessibility: semantic HTML, ARIA labels, alt text, skip-to-content link, focus styles
11. Fast loading: no external images (use CSS gradients/shapes for decoration)
12. Add a small "Demo" badge in the corner (position: fixed, subtle)
13. Contact form with name, email, message fields (action="#" for demo)
14. If phone/email provided, show them in contact section and footer
15. Professional color usage following the design system
16. Clean typography with proper hierarchy (h1 > h2 > h3 > p)
17. Add appropriate spacing and whitespace
18. Include a simple mobile hamburger menu (vanilla JS, no dependencies)

QUALITY STANDARDS:
- Must score 90+ on Lighthouse Performance
- Must score 90+ on Lighthouse Accessibility
- Must score 90+ on Lighthouse Best Practices
- Must score 90+ on Lighthouse SEO
- Valid HTML5
- No console errors

Generate the complete HTML now.`;
}

export function siteRegenerationPrompt(info: {
  previousHtml: string;
  lighthouseIssues: string[];
  validationErrors: string[];
}): string {
  return `The previously generated website failed quality checks. Fix these issues while keeping the design and content.

Issues to fix:
${info.lighthouseIssues.map((i) => `- Lighthouse: ${i}`).join("\n")}
${info.validationErrors.map((e) => `- Validation: ${e}`).join("\n")}

Previous HTML (fix this):
${info.previousHtml.slice(0, 20000)}

Output ONLY the complete fixed HTML starting with <!DOCTYPE html>. No explanation.`;
}

// ── Analyzer Agent Prompts ──

export function websiteAnalysisPrompt(info: {
  domain: string;
  htmlSnippet: string;
  lighthouseScores: LighthouseScores;
  isMobileResponsive: boolean;
}): string {
  return `Analyze this website for a potential modernization opportunity.

Domain: ${info.domain}
Lighthouse scores: Performance ${info.lighthouseScores.performance}, Accessibility ${info.lighthouseScores.accessibility}, Best Practices ${info.lighthouseScores.bestPractices}, SEO ${info.lighthouseScores.seo}
Mobile responsive: ${info.isMobileResponsive ? "Yes" : "No"}

HTML content (first 15000 chars):
${info.htmlSnippet.slice(0, 15000)}

Extract and analyze. Output ONLY valid JSON (no markdown, no explanation):
{
  "businessInfo": {
    "name": "Business name",
    "industry": "Industry category",
    "services": ["service1", "service2"],
    "valuePropositions": ["value1"],
    "targetAudience": "Who they serve",
    "brandTone": "formal/casual/friendly/professional",
    "location": "City, State or null",
    "phone": "Phone or null",
    "email": "Email or null"
  },
  "designEra": "90s/2000s/2010s/modern",
  "contentSummary": "Brief summary of site content and purpose",
  "improvementPotential": 0-100,
  "conversionLikelihood": "low|medium|high",
  "effortRequired": "simple|medium|complex",
  "decision": "go|skip",
  "decisionReason": "1-2 sentence explanation",
  "keyImprovements": ["improvement1", "improvement2"],
  "riskFactors": ["risk1"]
}

Decision criteria:
- GO if: outdated design, low scores, small business, clear improvement path, contact info available
- SKIP if: already modern, enterprise/large business, platform-built (Wix/Squarespace), no contact info, controversial industry`;
}

export function screenshotAnalysisPrompt(): string {
  return `Analyze this website screenshot. Identify:
1. Approximate design era (90s, 2000s, 2010s, modern)
2. Major design issues (cluttered, poor hierarchy, bad colors, outdated patterns)
3. Missing elements (no CTA, no mobile menu, no social proof)
4. Overall professional impression (1-10)
5. Brand colors visible

Output ONLY valid JSON:
{
  "designEra": "era",
  "designIssues": ["issue1", "issue2"],
  "missingElements": ["element1"],
  "professionalScore": 1-10,
  "brandColors": ["#hex1", "#hex2"]
}`;
}

// ── Seller Agent Prompts ──

export function outreachEmailPrompt(info: {
  businessName: string;
  industry: string;
  contactName?: string;
  oldScores: LighthouseScores;
  newScores: LighthouseScores;
  improvements: string[];
  previewUrl: string;
  priceUsd: number;
}): string {
  return `Write a personalized cold email to the owner of "${info.businessName}", a ${info.industry} business.

Context:
- We already built them a working demo (not a proposal)
- Their current site has significant quality issues
- We're offering the new site for $${info.priceUsd} (one-time)

Performance comparison:
- Old Performance: ${info.oldScores.performance}/100 → New: ${info.newScores.performance}/100
- Old Accessibility: ${info.oldScores.accessibility}/100 → New: ${info.newScores.accessibility}/100
- Old Mobile: ${info.oldScores.bestPractices}/100 → New: ${info.newScores.bestPractices}/100

Key improvements: ${info.improvements.join(", ")}
Demo URL: ${info.previewUrl}

Output ONLY valid JSON:
{
  "subject": "Subject line (curiosity-driven, specific to their business)",
  "body": "Full email body in plain text. Use line breaks for paragraphs."
}

Rules:
- Professional but friendly tone
- ${info.contactName ? `Address as ${info.contactName}` : "Use a professional generic greeting"}
- Lead with value, not a pitch
- Include specific data points (before/after scores)
- Include the demo URL
- Clear single CTA: reply to this email or visit demo
- No aggressive sales language or false urgency
- Keep under 200 words
- Include: "If you'd prefer not to hear from us, just reply with 'unsubscribe'."`;
}

export function replyClassificationPrompt(replyText: string): string {
  return `Classify this email reply from a business owner we pitched a website redesign to.

Reply:
"${replyText}"

Output ONLY valid JSON:
{
  "sentiment": "interested|objection|question|negative|auto_reply",
  "summary": "1-sentence summary of what they said",
  "suggestedAction": "Description of recommended next step",
  "shouldRespond": true/false,
  "responseUrgency": "immediate|within_24h|low"
}

Classification guide:
- interested: asking about price, timeline, features, or expressing positive interest
- objection: too expensive, will DIY, bad timing, using another service
- question: technical question, customization request, clarification needed
- negative: not interested, angry, threatening
- auto_reply: out-of-office, automated response, delivery failure`;
}

export function followUpResponsePrompt(info: {
  businessName: string;
  originalEmail: string;
  replyText: string;
  sentiment: string;
  previewUrl: string;
  priceUsd: number;
}): string {
  return `Write a follow-up reply to a business owner who responded to our website modernization offer.

Business: ${info.businessName}
Their reply: "${info.replyText}"
Reply sentiment: ${info.sentiment}
Demo URL: ${info.previewUrl}
Price: $${info.priceUsd}

Output ONLY valid JSON:
{
  "subject": "Reply subject line (use Re: format)",
  "body": "Full reply text"
}

Rules:
- Match their tone
- Be helpful, not pushy
- Answer questions directly
- If they have objections, acknowledge and address gently
- Always include the demo URL again
- Keep under 150 words
- If they seem negative, thank them and offer to remove from future emails`;
}

// ── Scout Agent Prompts ──

export function domainQualificationPrompt(info: {
  domain: string;
  htmlSnippet: string;
  copyrightYear?: string;
}): string {
  return `Quickly assess if this website is a good candidate for modernization.

Domain: ${info.domain}
${info.copyrightYear ? `Copyright year found: ${info.copyrightYear}` : ""}

HTML snippet (first 5000 chars):
${info.htmlSnippet.slice(0, 5000)}

Output ONLY valid JSON:
{
  "isSmallBusiness": true/false,
  "isOutdated": true/false,
  "hasContactInfo": true/false,
  "isPlatformBuilt": true/false,
  "isActive": true/false,
  "industry": "detected industry or 'unknown'",
  "priorityScore": 0-100,
  "skipReason": "reason if should skip, or null"
}

Skip if: platform-built (Wix/Squarespace/WordPress.com), enterprise, non-English, parked domain, adult/gambling content, government, non-profit.
Prioritize: clear small business, outdated design indicators, contact info present, US-based.`;
}
