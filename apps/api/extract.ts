import type { Handler } from '@netlify/functions';
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
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const contentType = event.headers['content-type'] || event.headers['Content-Type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Content-Type must be multipart/form-data' })
    };
  }

  let filePayload: { buffer: Buffer; fileMime: string };
  try {
    filePayload = await new Promise<{ buffer: Buffer; fileMime: string }>((resolve, reject) => {
      const bb = Busboy({ headers: { 'content-type': contentType } });
      const chunks: Buffer[] = [];
      let fileMime = 'application/octet-stream';
      let fileFound = false;

      bb.on('file', (_name, file, info) => {
        fileFound = true;
        fileMime = info.mimeType || fileMime;
        let totalSize = 0;
        file.on('data', (data: Buffer) => {
          totalSize += data.length;
          if (totalSize > MAX_FILE_SIZE) {
            bb.emit('error', new Error('File exceeds 15 MB limit.'));
            file.resume();
            return;
          }
          chunks.push(data);
        });
      });

      bb.on('close', () => {
        if (!fileFound) {
          reject(new Error('No file uploaded'));
          return;
        }
        resolve({ buffer: Buffer.concat(chunks), fileMime });
      });

      bb.on('error', (err) => {
        reject(err);
      });

      bb.end(Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8'));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to read upload.';
    return {
      statusCode: 400,
      body: JSON.stringify({ error: message })
    };
  }

  const { buffer, fileMime } = filePayload;

  if (!buffer.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No file uploaded' })
    };
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(responseBody)
    };
  } catch (error) {
    console.error('extract:handler-error', error instanceof Error ? error.message : 'Unknown error');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process document' })
    };
  }
};

export { handler };
