const path = require('path');
const fs = require('fs');
const express = require('express');
const Busboy = require('busboy');
const { z } = require('zod');

if (process.env.NODE_ENV !== 'production') {
  // Load environment variables when running locally.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config();
}

const app = express();
app.disable('x-powered-by');

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const partnerSchema = z.object({
  partner_number: z.string(),
  name: z.string(),
  partner_global_id: z.string().optional(),
  hours: z.number()
});

const payloadSchema = z.object({
  store_number: z.string().optional(),
  time_period: z.string().optional(),
  total_tippable_hours: z.number().optional(),
  partners: z.array(partnerSchema),
  confidence: z.number().optional(),
  warnings: z.array(z.string())
});

function parseContent(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const partners = [];
  const warnings = [];

  const partnerRegex = /^(\d{4,6})\s+(.*?\S)\s+(US[A-Z0-9]+)\s+([0-9]+(?:\.[0-9]{1,2})?)$/;

  for (const line of lines) {
    const partnerMatch = partnerRegex.exec(line);
    if (partnerMatch) {
      const [, number, name, globalId, hours] = partnerMatch;
      partners.push({
        partner_number: number,
        name,
        partner_global_id: globalId,
        hours: Number.parseFloat(hours)
      });
    }
  }

  let totalHours;
  const hoursMatch = content.match(/Total Tippable Hours:\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (hoursMatch) {
    totalHours = Number.parseFloat(hoursMatch[1]);
  }

  let storeNumber;
  const storeMatch = content.match(/Store\s+#?(\d{4,6})/i);
  if (storeMatch) {
    storeNumber = storeMatch[1];
  }

  let timePeriod;
  const dateMatch = content.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–-]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (dateMatch) {
    timePeriod = `${dateMatch[1]}–${dateMatch[2]}`;
  }

  if (!partners.length) {
    warnings.push('No partner rows detected. Ensure the upload is a Tip Distribution Report.');
  }

  if (!totalHours) {
    warnings.push('Total tippable hours not found. You may need to enter them manually.');
  }

  return { partners, totalHours, storeNumber, timePeriod, warnings };
}

async function readAzure(contentType, buffer) {
  const endpointBase = (process.env.AZURE_CV_ENDPOINT || '').replace(/\/$/, '');
  if (!endpointBase || !process.env.AZURE_CV_KEY) {
    throw new Error('Azure Document Intelligence credentials are not configured.');
  }

  const READ_ENDPOINT = `${endpointBase}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2024-07-31`;

  const requestStart = Date.now();
  const response = await fetch(READ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Ocp-Apim-Subscription-Key': process.env.AZURE_CV_KEY,
      'x-ms-cognitive-service-learning-optout': 'true'
    },
    body: buffer
  });

  const requestId = response.headers.get('apim-request-id') || 'unknown';

  if (!response.ok) {
    console.error(`extract:${requestId}: Azure error ${response.status}`);
    throw new Error(`Azure request failed (${response.status})`);
  }

  const data = await response.json();
  const duration = Date.now() - requestStart;
  console.log(`extract:${requestId}: completed in ${duration}ms`);
  return data;
}

function readMultipartFile(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('Upload parser error'));
    };

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE }
    });

    const chunks = [];
    let fileMime = 'application/octet-stream';
    let fileFound = false;

    bb.on('file', (_name, file, info) => {
      fileFound = true;
      fileMime = info.mimeType || fileMime;
      file.on('data', (data) => {
        chunks.push(data);
      });
      file.on('limit', () => {
        file.resume();
        safeReject(new Error('File exceeds 15 MB limit.'));
      });
    });

    bb.on('finish', () => {
      if (!fileFound) {
        safeReject(new Error('No file uploaded'));
        return;
      }
      safeResolve({ buffer: Buffer.concat(chunks), fileMime });
    });

    bb.on('error', safeReject);
    req.on('error', safeReject);

    req.pipe(bb);
  });
}

app.all('/api/extract', (req, res, next) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  next();
});

app.post('/api/extract', async (req, res) => {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    return;
  }

  let filePayload;
  try {
    filePayload = await readMultipartFile(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to read upload.';
    res.status(400).json({ error: message });
    return;
  }

  const { buffer, fileMime } = filePayload;

  if (!buffer.length) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const azureResult = await readAzure(fileMime, buffer);
    const content = azureResult?.analyzeResult?.content || '';
    const { partners, totalHours, storeNumber, timePeriod, warnings } = parseContent(content);

    const wordConfidences = [];
    const pages = Array.isArray(azureResult?.analyzeResult?.pages) ? azureResult.analyzeResult.pages : [];
    for (const page of pages) {
      if (Array.isArray(page.words)) {
        for (const word of page.words) {
          if (typeof word.confidence === 'number') {
            wordConfidences.push(word.confidence);
          }
        }
      }
    }

    const confidence = wordConfidences.length
      ? Number((wordConfidences.reduce((sum, value) => sum + value, 0) / wordConfidences.length).toFixed(2))
      : undefined;

    const responseBody = payloadSchema.parse({
      store_number: storeNumber,
      time_period: timePeriod,
      total_tippable_hours: totalHours,
      partners,
      confidence,
      warnings
    });

    res.set('Cache-Control', 'no-store');
    res.status(200).json(responseBody);
  } catch (error) {
    console.error('extract:handler-error', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to process document' });
  }
});

const distPath = path.join(__dirname, '..', 'apps', 'web', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const port = Number.parseInt(process.env.PORT || '8787', 10);
app.listen(port, () => {
  console.log(`Tipjar API listening on port ${port}`);
});

module.exports = app;
