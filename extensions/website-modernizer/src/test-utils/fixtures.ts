/**
 * Mock LLM responses for each agent stage.
 * Returns realistic JSON outputs matching expected schemas.
 */

/** Design system response from Builder Agent */
export const MOCK_DESIGN_SYSTEM = JSON.stringify({
  primaryColor: "#2563eb",
  secondaryColor: "#1e40af",
  accentColor: "#f59e0b",
  neutralLight: "#f8fafc",
  neutralDark: "#1e293b",
  headingFont: "Inter",
  bodyFont: "Open Sans",
  style: "modern professional with warm accents",
});

/** Content generation response from Builder Agent */
export const MOCK_CONTENT = JSON.stringify({
  heroHeadline: "Expert Plumbing You Can Trust",
  heroSubheadline: "Fast, reliable plumbing services for your home and business in Austin, TX",
  ctaText: "Get a Free Quote",
  aboutHeading: "About Joe's Plumbing",
  aboutText: "Joe's Plumbing has been serving the Austin community with reliable residential and commercial plumbing services. Our licensed team handles everything from routine repairs to emergency situations with professionalism and care.",
  services: [
    { name: "Emergency Repairs", description: "24/7 emergency plumbing service when you need it most. Fast response times and reliable fixes." },
    { name: "Drain Cleaning", description: "Professional drain cleaning to keep your pipes flowing smoothly. We handle clogs of all sizes." },
    { name: "Water Heater Service", description: "Installation, repair, and maintenance of all water heater types. Stay comfortable year-round." },
  ],
  contactHeading: "Get In Touch",
  contactSubtext: "Ready to solve your plumbing problems? Contact us today for a free estimate.",
  footerTagline: "Your trusted Austin plumber since 2005",
});

/** Generated HTML from Builder Agent */
export const MOCK_GENERATED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Joe's Plumbing - Expert plumbing services in Austin, TX">
  <title>Joe's Plumbing - Austin, TX</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root { --primary: #2563eb; --accent: #f59e0b; }
    * { scroll-behavior: smooth; }
    body { font-family: 'Open Sans', sans-serif; }
    h1, h2, h3 { font-family: 'Inter', sans-serif; }
    .skip-link { position: absolute; left: -9999px; }
    .skip-link:focus { left: 0; z-index: 100; background: white; padding: 8px; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800">
  <a href="#main" class="skip-link">Skip to content</a>
  <header>
    <nav class="bg-white shadow" aria-label="Main navigation">
      <div class="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
        <a href="#" class="text-xl font-bold text-blue-600">Joe's Plumbing</a>
        <div class="hidden md:flex gap-6">
          <a href="#services" class="hover:text-blue-600">Services</a>
          <a href="#about" class="hover:text-blue-600">About</a>
          <a href="#contact" class="hover:text-blue-600">Contact</a>
        </div>
        <button id="menu-toggle" class="md:hidden" aria-label="Toggle menu" aria-expanded="false">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </nav>
  </header>
  <main id="main">
    <section class="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-20">
      <div class="max-w-6xl mx-auto px-4 text-center">
        <h1 class="text-4xl md:text-5xl font-bold mb-4">Expert Plumbing You Can Trust</h1>
        <p class="text-xl mb-8">Fast, reliable plumbing services for your home and business in Austin, TX</p>
        <a href="#contact" class="bg-amber-500 hover:bg-amber-600 text-white px-8 py-3 rounded-lg font-semibold">Get a Free Quote</a>
      </div>
    </section>
    <section id="services" class="py-16">
      <div class="max-w-6xl mx-auto px-4">
        <h2 class="text-3xl font-bold text-center mb-12">Our Services</h2>
        <div class="grid md:grid-cols-3 gap-8">
          <article class="bg-white p-6 rounded-lg shadow">
            <h3 class="text-xl font-semibold mb-3">Emergency Repairs</h3>
            <p>24/7 emergency plumbing service when you need it most.</p>
          </article>
          <article class="bg-white p-6 rounded-lg shadow">
            <h3 class="text-xl font-semibold mb-3">Drain Cleaning</h3>
            <p>Professional drain cleaning to keep your pipes flowing smoothly.</p>
          </article>
          <article class="bg-white p-6 rounded-lg shadow">
            <h3 class="text-xl font-semibold mb-3">Water Heater Service</h3>
            <p>Installation, repair, and maintenance of all water heater types.</p>
          </article>
        </div>
      </div>
    </section>
    <section id="about" class="py-16 bg-white">
      <div class="max-w-4xl mx-auto px-4">
        <h2 class="text-3xl font-bold text-center mb-8">About Joe's Plumbing</h2>
        <p class="text-lg text-center">Joe's Plumbing has been serving the Austin community with reliable residential and commercial plumbing services.</p>
      </div>
    </section>
    <section id="contact" class="py-16">
      <div class="max-w-4xl mx-auto px-4">
        <h2 class="text-3xl font-bold text-center mb-4">Get In Touch</h2>
        <p class="text-center mb-8">Ready to solve your plumbing problems? Contact us today.</p>
        <form action="#" class="max-w-lg mx-auto space-y-4">
          <label for="name" class="sr-only">Name</label>
          <input id="name" type="text" placeholder="Your Name" class="w-full px-4 py-3 border rounded-lg" required aria-label="Your name">
          <label for="email" class="sr-only">Email</label>
          <input id="email" type="email" placeholder="Your Email" class="w-full px-4 py-3 border rounded-lg" required aria-label="Your email">
          <label for="message" class="sr-only">Message</label>
          <textarea id="message" placeholder="Your Message" rows="4" class="w-full px-4 py-3 border rounded-lg" required aria-label="Your message"></textarea>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold">Send Message</button>
        </form>
        <div class="text-center mt-8">
          <p>Phone: (512) 555-0123</p>
          <p>Email: info@joesplumbing.com</p>
        </div>
      </div>
    </section>
  </main>
  <footer class="bg-slate-800 text-white py-8">
    <div class="max-w-6xl mx-auto px-4 text-center">
      <p class="mb-2">Joe's Plumbing - Your trusted Austin plumber since 2005</p>
      <p class="text-sm text-slate-400">Demo version</p>
    </div>
  </footer>
  <div style="position:fixed;top:8px;right:8px;background:#f59e0b;color:white;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;z-index:9999">Demo</div>
  <script>
    document.getElementById('menu-toggle')?.addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
    });
  </script>
</body>
</html>`;

/** Scout qualification response */
export const MOCK_QUALIFICATION = JSON.stringify({
  isSmallBusiness: true,
  isOutdated: true,
  hasContactInfo: true,
  isPlatformBuilt: false,
  isActive: true,
  industry: "plumber",
  priorityScore: 75,
  skipReason: null,
});

/** Analyzer analysis response */
export const MOCK_ANALYSIS = JSON.stringify({
  businessInfo: {
    name: "Joe's Plumbing",
    industry: "plumber",
    services: ["Emergency Repairs", "Drain Cleaning", "Water Heater Service"],
    valuePropositions: ["24/7 service", "Licensed professionals", "Free estimates"],
    targetAudience: "Homeowners in Austin, TX",
    brandTone: "professional",
    location: "Austin, TX",
    phone: "(512) 555-0123",
    email: "info@joesplumbing.com",
  },
  designEra: "2000s",
  contentSummary: "Small plumbing business website with basic service info, contact details, and a simple layout from the mid-2000s era.",
  improvementPotential: 85,
  conversionLikelihood: "medium",
  effortRequired: "simple",
  decision: "go",
  decisionReason: "Outdated design with low scores, clear small business with contact info available. High improvement potential.",
  keyImprovements: ["Modern responsive design", "Better call-to-action placement", "Improved accessibility", "Mobile-first layout"],
  riskFactors: ["Business may have closed"],
});

/** Outreach email response */
export const MOCK_OUTREACH_EMAIL = JSON.stringify({
  subject: "We built Joe's Plumbing a faster, modern website - take a look",
  body: "Hi there,\n\nI came across your website for Joe's Plumbing and noticed it could benefit from a refresh.\n\nWe went ahead and built you a modern, mobile-friendly version:\n\nYour current site scores:\n- Performance: 45/100\n- Accessibility: 50/100\n\nYour new site scores:\n- Performance: 95/100\n- Accessibility: 95/100\n\nTake a look at the live demo: https://example.com/demo/1\n\nThe full site is yours for $200 - that includes the source code, deployment help, and 30 days of support.\n\nJust reply to this email if you're interested.\n\nBest,\nWeb Modernizer Team\n\nIf you'd prefer not to hear from us, just reply with 'unsubscribe'.",
});

/** Outdated HTML fixture simulating a 2000s-era plumber website */
export const OUTDATED_PLUMBER_HTML = `<html>
<head><title>Joe's Plumbing - Austin TX</title></head>
<body bgcolor="#ffffff">
<center>
<table width="800" cellpadding="5" cellspacing="0">
<tr><td bgcolor="#003366"><font color="white" size="5"><b>Joe's Plumbing</b></font></td></tr>
<tr><td>
<font size="3">Welcome to Joe's Plumbing! We offer the best plumbing services in Austin, Texas.</font>
<br><br>
<b>Our Services:</b><br>
- Emergency Repairs<br>
- Drain Cleaning<br>
- Water Heater Service<br>
<br>
<b>Contact Us:</b><br>
Phone: (512) 555-0123<br>
Email: info@joesplumbing.com<br>
<br>
<font size="1">© 2008 Joe's Plumbing. All rights reserved.</font>
</td></tr>
</table>
</center>
</body>
</html>`;
