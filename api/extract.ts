import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';
import { z } from 'zod';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const endpointBase = (process.env.AZURE_CV_ENDPOINT ?? '').replace(/\/$/, '');
const READ_ENDPOINT = `${endpointBase}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2024-07-31`;

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

interface ParsedPartner {
  partner_number: string;
  name: string;
  partner_global_id?: string;
  hours: number;
}

function parseContent(content: string): {
  partners: ParsedPartner[];
  totalHours?: number;
  storeNumber?: string;
  timePeriod?: string;
  warnings: string[];
} {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const partners: ParsedPartner[] = [];
  const warnings: string[] = [];

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

  let totalHours: number | undefined;
  const hoursMatch = content.match(/Total Tippable Hours:\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (hoursMatch) {
    totalHours = Number.parseFloat(hoursMatch[1]);
  }

  let storeNumber: string | undefined;
  const storeMatch = content.match(/Store\s+#?(\d{4,6})/i);
  if (storeMatch) {
    storeNumber = storeMatch[1];
  }

  let timePeriod: string | undefined;
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

async function readAzure(contentType: string, buffer: Buffer) {
  if (!process.env.AZURE_CV_ENDPOINT || !process.env.AZURE_CV_KEY) {
    throw new Error('Azure Document Intelligence credentials are not configured.');
  }

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

  const requestId = response.headers.get('apim-request-id') ?? 'unknown';

  if (!response.ok) {
    console.error(`extract:${requestId}: Azure error ${response.status}`);
    throw new Error(`Azure request failed (${response.status})`);
  }

  const data = await response.json();
  const duration = Date.now() - requestStart;
  console.log(`extract:${requestId}: completed in ${duration}ms`);
  return data;
}

async function readMultipartFile(req: VercelRequest): Promise<{ buffer: Buffer; fileMime: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (value: { buffer: Buffer; fileMime: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const safeReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE }
    });

    const chunks: Buffer[] = [];
    let fileMime = 'application/octet-stream';
    let fileFound = false;

    bb.on('file', (_name, file, info) => {
      fileFound = true;
      fileMime = info.mimeType || fileMime;
      file.on('data', (data: Buffer) => {
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

    bb.on('error', (err) => {
      safeReject(err instanceof Error ? err : new Error('Upload parser error'));
    });

    req.pipe(bb);
  });
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method?.toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    return;
  }

  let filePayload: { buffer: Buffer; fileMime: string };
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
    const content: string = azureResult?.analyzeResult?.content ?? '';
    const { partners, totalHours, storeNumber, timePeriod, warnings } = parseContent(content);

    const wordConfidences: number[] = [];
    const pages: any[] = azureResult?.analyzeResult?.pages ?? [];
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

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(responseBody);
  } catch (error) {
    console.error('extract:handler-error', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to process document' });
  }
}
