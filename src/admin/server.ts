import express from 'express';
import { connectMongo } from '../config/mongo.js';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { parserQueue } from '../queue/parserQueue.js';
import { buildCompaniesCSV, type ExportMode } from '../exporters/csvExporter.js';
import { logger } from '../utils/logger.js';
import type { ParserJobName } from '../types/index.js';

const app = express();

app.use(express.json());

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Company Parser Admin</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #172026;
      background: #f4f7f6;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 44px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.15; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .grid { display: grid; grid-template-columns: 380px 1fr; gap: 18px; align-items: start; }
    section, form { background: #fff; border: 1px solid #d8e0de; border-radius: 8px; padding: 18px; }
    label { display: block; font-size: 13px; font-weight: 700; margin: 14px 0 6px; }
    input, textarea {
      width: 100%;
      border: 1px solid #b7c4c0;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      background: #fff;
    }
    textarea { min-height: 92px; resize: vertical; }
    button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 750;
      color: #fff;
      background: #126f64;
      cursor: pointer;
    }
    button.secondary { color: #172026; background: #e5ecea; }
    button.danger { background: #a43831; }
    .buttonLink {
      display: inline-block;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 750;
      color: #172026;
      background: #e5ecea;
      text-decoration: none;
    }
    .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .status { min-height: 22px; margin-top: 12px; font-size: 13px; color: #45615a; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #e3e9e7; padding: 9px 8px; vertical-align: top; }
    th { color: #506962; font-size: 12px; }
    a { color: #126f64; }
    .stack { display: grid; gap: 18px; }
    .muted { color: #657872; }
    .sectionTitle { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 14px; }
    .sectionTitle h2 { margin: 0; }
    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
      header { display: block; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Company Parser Admin</h1>
        <div class="muted">Create Google Maps parser jobs and inspect recent results.</div>
      </div>
      <button class="secondary" id="refreshBtn" type="button">Refresh</button>
    </header>

    <div class="grid">
      <form id="googleForm">
        <h2>New Google Maps Job</h2>
        <label for="keywords">Keywords</label>
        <textarea id="keywords" name="keywords" placeholder="coffee shop, fast food, restaurant">coffee shop</textarea>

        <label for="location">City / location</label>
        <input id="location" name="location" value="Kyiv, Ukraine" placeholder="Kyiv, Ukraine">

        <div class="actions">
          <button type="submit">Add to queue</button>
          <button class="secondary" id="exampleLviv" type="button">Fast food Lviv</button>
          <button class="secondary" id="enrichSavedBtn" type="button">Enrich saved websites</button>
        </div>
        <div class="status" id="formStatus"></div>
      </form>

      <div class="stack">
        <section>
          <div class="sectionTitle">
            <h2>Queue</h2>
            <button class="danger" id="clearQueueBtn" type="button">Clear queue</button>
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>Type</th><th>Status</th><th>Parameters</th></tr>
            </thead>
            <tbody id="jobsBody"></tbody>
          </table>
        </section>

        <section>
          <div class="sectionTitle">
            <h2>Recent Companies</h2>
            <div class="actions" style="margin-top:0">
              <button class="danger" id="clearCompaniesBtn" type="button">Clear companies</button>
              <a class="buttonLink" href="/api/export/raw">Raw CSV</a>
              <a class="buttonLink" href="/api/export/all">All CSV</a>
              <a class="buttonLink" href="/api/export/valid">Valid CSV</a>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>Name</th><th>Category</th><th>Phone</th><th>Email</th><th>Website</th><th>Maps</th><th>Source</th></tr>
            </thead>
            <tbody id="companiesBody"></tbody>
          </table>
        </section>
      </div>
    </div>
  </main>

  <script>
    const form = document.querySelector('#googleForm');
    const statusEl = document.querySelector('#formStatus');
    const jobsBody = document.querySelector('#jobsBody');
    const companiesBody = document.querySelector('#companiesBody');

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[char]);
    }

    async function refresh() {
      const [jobsRes, companiesRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/companies')
      ]);
      const jobs = await jobsRes.json();
      const companies = await companiesRes.json();

      jobsBody.innerHTML = jobs.map((job) => \`
        <tr>
          <td>\${escapeHtml(job.id)}</td>
          <td>\${escapeHtml(job.name)}</td>
          <td>\${escapeHtml(job.state)}</td>
          <td><code>\${escapeHtml(JSON.stringify(job.data))}</code></td>
        </tr>
      \`).join('') || '<tr><td colspan="4" class="muted">Queue is empty</td></tr>';

      companiesBody.innerHTML = companies.map((company) => \`
        <tr>
          <td>\${escapeHtml(company.name)}</td>
          <td>\${escapeHtml(company.category)}</td>
          <td>\${escapeHtml(company.phone)}</td>
          <td>\${escapeHtml(company.email)}</td>
          <td>\${company.website ? \`<a href="\${escapeHtml(company.website)}" target="_blank" rel="noreferrer">open</a>\` : ''}</td>
          <td>\${company.googleMapsUrl ? \`<a href="\${escapeHtml(company.googleMapsUrl)}" target="_blank" rel="noreferrer">maps</a>\` : ''}</td>
          <td>\${escapeHtml(company.source)}</td>
        </tr>
      \`).join('') || '<tr><td colspan="7" class="muted">No companies yet</td></tr>';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      statusEl.textContent = 'Adding job...';

      const body = {
        keywords: document.querySelector('#keywords').value,
        location: document.querySelector('#location').value
      };

      const response = await fetch('/api/jobs/google-maps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();

      if (!response.ok) {
        statusEl.textContent = result.error || 'Could not add job';
        return;
      }

      statusEl.textContent = \`Job #\${result.id} added\`;
      await refresh();
    });

    document.querySelector('#clearQueueBtn').addEventListener('click', async () => {
      const ok = confirm('Clear all parser jobs? Stop the worker first if a job is currently active.');
      if (!ok) return;

      const response = await fetch('/api/jobs', { method: 'DELETE' });
      const result = await response.json();
      statusEl.textContent = result.message || result.error || 'Queue cleared';
      await refresh();
    });

    document.querySelector('#enrichSavedBtn').addEventListener('click', async () => {
      statusEl.textContent = 'Adding website enrichment job...';
      const response = await fetch('/api/jobs/enrich-websites', { method: 'POST' });
      const result = await response.json();
      statusEl.textContent = response.ok
        ? \`Website enrichment job #\${result.id} added for \${result.count} sites\`
        : result.error || 'Could not add enrichment job';
      await refresh();
    });

    document.querySelector('#clearCompaniesBtn').addEventListener('click', async () => {
      const ok = confirm('Delete all saved companies from MongoDB? This is useful before rerunning with the improved details parser.');
      if (!ok) return;

      const response = await fetch('/api/companies', { method: 'DELETE' });
      const result = await response.json();
      statusEl.textContent = result.message || result.error || 'Companies cleared';
      await refresh();
    });

    document.querySelector('#exampleLviv').addEventListener('click', () => {
      document.querySelector('#keywords').value = 'fast food, burger, kebab';
      document.querySelector('#location').value = 'Lviv, Ukraine';
    });

    document.querySelector('#refreshBtn').addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`);
});

app.post('/api/jobs/google-maps', async (req, res) => {
  const keywords = splitList(req.body.keywords);
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';

  if (!keywords.length) {
    res.status(400).json({ error: 'Enter at least one keyword.' });
    return;
  }

  if (!location) {
    res.status(400).json({ error: 'Enter a city or location.' });
    return;
  }

  const job = await parserQueue.add('googleMaps' satisfies ParserJobName, {
    keywords,
    location
  });

  res.status(201).json({ id: job.id, name: job.name, data: job.data });
});

app.post('/api/jobs/enrich-websites', async (_req, res) => {
  const companies = await Company.find({
    website: { $type: 'string', $gt: '' },
    $or: [{ email: '' }, { email: { $exists: false } }]
  })
    .sort({ scrapedAt: -1 })
    .limit(env.WEBSITE_ENRICH_MAX_PER_JOB)
    .select('website category')
    .lean()
    .exec();

  const urls = Array.from(new Set(companies.map((company) => company.website).filter(Boolean)));

  if (!urls.length) {
    res.status(400).json({ error: 'No saved websites without email were found.' });
    return;
  }

  const job = await parserQueue.add('openSource' satisfies ParserJobName, {
    urls,
    category: companies[0]?.category ?? ''
  });

  res.status(201).json({ id: job.id, name: job.name, count: urls.length, data: job.data });
});

app.get('/api/jobs', async (_req, res) => {
  const jobs = await parserQueue.getJobs(
    ['waiting', 'active', 'delayed', 'completed', 'failed'],
    0,
    49,
    false
  );

  const payload = await Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      state: await job.getState(),
      failedReason: job.failedReason,
      timestamp: job.timestamp
    }))
  );

  res.json(payload);
});

app.delete('/api/jobs', async (_req, res) => {
  try {
    await parserQueue.pause();
    await parserQueue.obliterate({ force: true });
    await parserQueue.resume();

    res.json({ message: 'Queue cleared' });
  } catch (error) {
    await parserQueue.resume().catch(() => undefined);
    logger.error('Queue cleanup failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Queue cleanup failed'
    });
  }
});

app.get('/api/companies', async (_req, res) => {
  const companies = await Company.find()
    .sort({ scrapedAt: -1 })
    .limit(50)
    .select('name category phone email website websiteDomain googleMapsUrl instagram source scrapedAt isValid')
    .lean()
    .exec();

  res.json(companies);
});

app.delete('/api/companies', async (_req, res) => {
  const result = await Company.deleteMany({});
  res.json({ message: `Deleted ${result.deletedCount} companies` });
});

app.get('/api/export/:mode', async (req, res) => {
  const mode = req.params.mode as ExportMode;

  if (!['valid', 'raw', 'all'].includes(mode)) {
    res.status(400).json({ error: 'Export mode must be valid, raw or all.' });
    return;
  }

  const { csv } = await buildCompaniesCSV(mode);

  res
    .status(200)
    .setHeader('content-type', 'text/csv; charset=utf-8')
    .setHeader('content-disposition', `attachment; filename="companies-${mode}.csv"`)
    .send(csv);
});

async function main(): Promise<void> {
  await connectMongo();

  app.listen(env.ADMIN_PORT, () => {
    logger.info('Admin UI is running', { url: `http://localhost:${env.ADMIN_PORT}` });
  });
}

main().catch((error) => {
  logger.error('Admin UI failed', { error: error.message, stack: error.stack });
  process.exit(1);
});
