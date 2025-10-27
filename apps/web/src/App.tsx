import { useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowUpTrayIcon, CameraIcon, DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline';
import { ExclamationCircleIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import { usePersistentState } from './hooks/usePersistentState';
import type { ExtractionResult, Partner, RoundingMode } from './types';
import { extractFromFile } from './services/extract';
import { parseManualText } from './utils/parser';
import { distributeTips } from './utils/rounding';

const EMPTY_RESULT: ExtractionResult = {
  partners: [],
  warnings: []
};

const roundingModes: { value: RoundingMode; label: string }[] = [
  { value: 'none', label: 'No rounding' },
  { value: 'cent', label: 'Nearest cent' },
  { value: 'dime', label: 'Nearest $0.10' },
  { value: 'quarter', label: 'Nearest $0.25' },
  { value: 'dollar', label: 'Nearest dollar' }
];

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [result, setResult] = usePersistentState<ExtractionResult>('tipjar:data', EMPTY_RESULT);
  const [totalTips, setTotalTips] = usePersistentState<number>('tipjar:totalTips', 0);
  const [rounding, setRounding] = usePersistentState<RoundingMode>('tipjar:rounding', 'none');
  const [manualText, setManualText] = usePersistentState<string>('tipjar:manualText', '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const totalHoursFromRows = useMemo(
    () => result.partners.reduce((sum, partner) => sum + (Number(partner.hours) || 0), 0),
    [result.partners]
  );

  const { payouts, hourlyRate, roundingDelta } = useMemo(
    () =>
      distributeTips({
        partners: result.partners,
        totalTips,
        rounding,
        totalHours: result.total_tippable_hours
      }),
    [result.partners, totalTips, rounding, result.total_tippable_hours]
  );

  const handleFileSelection = async (file: File) => {
    setError(null);
    setIsProcessing(true);
    setProgress(0.1);
    setProgressLabel('Uploading to secure extractor…');
    try {
      const controller = new AbortController();
      const extraction = await extractFromFile(file, controller.signal);
      setProgress(0.7);
      setProgressLabel('Normalizing report…');
      setResult({
        ...extraction,
        warnings: extraction.warnings ?? []
      });
      setProgress(1);
      setProgressLabel('Ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed.';
      setError(message);
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setProgress(0);
        setProgressLabel('');
      }, 600);
    }
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleFileSelection(file);
      event.target.value = '';
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleFileSelection(file);
    }
  };

  const updatePartner = (index: number, updates: Partial<Partner>) => {
    setResult((prev) => {
      const partners = [...prev.partners];
      partners[index] = { ...partners[index], ...updates };
      return { ...prev, partners };
    });
  };

  const removePartner = (index: number) => {
    setResult((prev) => {
      const partners = prev.partners.filter((_, idx) => idx !== index);
      return { ...prev, partners };
    });
  };

  const addPartner = () => {
    setResult((prev) => ({
      ...prev,
      partners: [
        ...prev.partners,
        {
          partner_number: '',
          name: '',
          partner_global_id: '',
          hours: 0
        }
      ]
    }));
  };

  const handleManualParse = () => {
    const parsed = parseManualText(manualText);
    setResult((prev) => {
      const next: ExtractionResult = {
        ...prev,
        warnings: parsed.warnings ?? []
      };

      if (parsed.partners.length) {
        next.partners = parsed.partners;
      }
      if (parsed.total_tippable_hours !== undefined) {
        next.total_tippable_hours = parsed.total_tippable_hours;
      }
      if (parsed.store_number !== undefined) {
        next.store_number = parsed.store_number;
      }
      if (parsed.time_period !== undefined) {
        next.time_period = parsed.time_period;
      }

      return next;
    });
  };

  const resetAll = () => {
    setResult(EMPTY_RESULT);
    setTotalTips(0);
    setManualText('');
    setRounding('none');
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-slate-800 bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Tipjar · Starbucks Tip Report Extractor</h1>
            <p className="text-sm text-slate-400">Privacy-first, in-memory parsing for store partners.</p>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-sm font-medium text-slate-200 transition hover:border-accent hover:text-accent"
          >
            <ArrowPathIcon className="h-4 w-4" /> Reset
          </button>
        </div>
        {isProcessing && (
          <div className="h-1 w-full bg-slate-900">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.max(progress, 0.05) * 100}%` }}
            />
          </div>
        )}
        {isProcessing && progressLabel && (
          <p className="px-4 pb-2 text-xs uppercase tracking-wide text-slate-500">{progressLabel}</p>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
        <section>
          <label
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            className={clsx(
              'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-panel/80 p-6 text-center transition',
              isProcessing ? 'opacity-60' : 'hover:border-accent hover:text-accent'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              onChange={onFileInputChange}
              className="hidden"
              disabled={isProcessing}
            />
            <ArrowUpTrayIcon className="h-8 w-8 text-accent" />
            <p className="mt-3 text-base font-medium text-slate-200">Drop a Tip Distribution Report</p>
            <p className="text-sm text-slate-400">or tap to upload / capture (max 15 MB)</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent hover:bg-accent/20"
              >
                <CameraIcon className="h-4 w-4" /> Use camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700"
              >
                <DocumentTextIcon className="h-4 w-4" /> Upload file
              </button>
            </div>
          </label>
          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              <ExclamationCircleIcon className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-panel/90 p-4 shadow-lg">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">Partner hours</h2>
                  <p className="text-sm text-slate-400">Edit partner info and hours. Values stay on this device.</p>
                </div>
                <button
                  type="button"
                  onClick={addPartner}
                  className="inline-flex items-center gap-2 rounded-full bg-accent/20 px-3 py-1 text-sm font-medium text-accent hover:bg-accent/30"
                >
                  <PlusIcon className="h-4 w-4" /> Add partner
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Partner #</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Global ID</th>
                      <th className="px-3 py-2 text-right">Hours</th>
                      <th className="px-3 py-2 text-right">Payout</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {payouts.map((partner, index) => (
                      <tr key={`${partner.partner_number}-${index}`}>
                        <td className="px-3 py-2">
                          <input
                            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1"
                            value={partner.partner_number}
                            onChange={(event) => updatePartner(index, { partner_number: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1"
                            value={partner.name}
                            onChange={(event) => updatePartner(index, { name: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1"
                            value={partner.partner_global_id ?? ''}
                            onChange={(event) => updatePartner(index, { partner_global_id: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-24 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-right"
                            value={partner.hours ?? 0}
                            onChange={(event) => updatePartner(index, { hours: Number.parseFloat(event.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="text-sm font-semibold text-emerald-300">
                            ${partner.roundedPayout.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-500">Base ${partner.payout.toFixed(2)}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removePartner(index)}
                            className="rounded-lg border border-transparent px-2 py-1 text-xs text-slate-500 hover:border-red-500/40 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!payouts.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                          Upload a report or paste text to populate partner rows.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-panel/90 p-4 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-100">Manual text fallback</h2>
              <p className="text-sm text-slate-400">Paste report text when screenshots are unavailable or OCR fails.</p>
              <textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                className="mt-3 h-40 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200"
                placeholder="Paste report text here…"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleManualParse}
                  className="inline-flex items-center gap-2 rounded-full bg-accent/20 px-3 py-1 text-sm font-medium text-accent hover:bg-accent/30"
                >
                  Parse text
                </button>
                <button
                  type="button"
                  onClick={() => setManualText('')}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:border-accent hover:text-accent"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-panel/90 p-4 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-100">Totals & rounding</h2>
              <div className="mt-3 space-y-3 text-sm text-slate-200">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Total tip amount ($)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={totalTips}
                    onChange={(event) => setTotalTips(Number.parseFloat(event.target.value) || 0)}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Total tippable hours</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={result.total_tippable_hours ?? ''}
                    onChange={(event) =>
                      setResult((prev) => ({
                        ...prev,
                        total_tippable_hours: event.target.value === '' ? undefined : Number.parseFloat(event.target.value)
                      }))
                    }
                    placeholder={totalHoursFromRows.toFixed(2)}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2"
                  />
                  <span className="text-xs text-slate-500">Calculated sum: {totalHoursFromRows.toFixed(2)} hours</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Rounding</span>
                  <select
                    value={rounding}
                    onChange={(event) => setRounding(event.target.value as RoundingMode)}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2"
                  >
                    {roundingModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>Hourly tip rate</span>
                  <span className="font-semibold text-emerald-300">${hourlyRate ? hourlyRate.toFixed(4) : '0.0000'}</span>
                </div>
                <div className="mt-2 flex justify-between text-slate-300">
                  <span>Rounded total</span>
                  <span className="font-semibold">${payouts.reduce((sum, partner) => sum + partner.roundedPayout, 0).toFixed(2)}</span>
                </div>
                <div className="mt-2 flex justify-between text-slate-400">
                  <span>Rounding delta</span>
                  <span>{roundingDelta >= 0 ? '+' : ''}{roundingDelta.toFixed(2)}</span>
                </div>
              </div>

              <dl className="mt-4 space-y-2 text-xs text-slate-400">
                {result.store_number && (
                  <div className="flex justify-between">
                    <dt>Store #</dt>
                    <dd className="text-slate-200">{result.store_number}</dd>
                  </div>
                )}
                {result.time_period && (
                  <div className="flex justify-between">
                    <dt>Period</dt>
                    <dd className="text-slate-200">{result.time_period}</dd>
                  </div>
                )}
                {typeof result.confidence === 'number' && (
                  <div className="flex justify-between">
                    <dt>OCR confidence</dt>
                    <dd className="text-slate-200">{(result.confidence * 100).toFixed(0)}%</dd>
                  </div>
                )}
              </dl>
            </div>

            {result.warnings?.length ? (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <ExclamationCircleIcon className="h-4 w-4" /> Warnings
                </h3>
                <ul className="list-disc space-y-1 pl-5">
                  {result.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>
      </main>

      <footer className="border-t border-slate-800 bg-surface/80 py-4 text-center text-xs text-slate-500">
        Made by William Walsh · Starbucks Store #66900.
      </footer>
    </div>
  );
}
