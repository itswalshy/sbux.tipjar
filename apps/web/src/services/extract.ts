import type { ExtractionResult } from '../types';

export async function extractFromFile(file: File, signal?: AbortSignal): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append('file', file, file.name);

  const response = await fetch('/api/extract', {
    method: 'POST',
    body: formData,
    signal
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to extract document');
  }

  return (await response.json()) as ExtractionResult;
}
