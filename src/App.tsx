import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  FileJson,
  ImagePlus,
  Layers,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { parse, type Details, type ParseResult } from 'mrz';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type RecordStatus = 'queued' | 'processing' | 'done' | 'needs-review' | 'error';

type ExtractedFields = {
  passportNumber: string;
  documentCode: string;
  issuingState: string;
  nationality: string;
  lastName: string;
  firstNames: string;
  birthDate: string;
  sex: string;
  expirationDate: string;
  personalNumber: string;
};

type PassportRecord = {
  id: string;
  file: File;
  sourceFileName: string;
  previewUrl: string;
  status: RecordStatus;
  progress: number;
  message: string;
  fields: ExtractedFields;
  rawMrz: string;
  valid: boolean | null;
  validationDetails: Details[];
  ocrText: string;
  error: string;
};

type FieldKey = keyof ExtractedFields;

type PdfPageOption = {
  pageNumber: number;
  thumbnailUrl: string;
  selected: boolean;
  width: number;
  height: number;
};

type PdfDialogState = {
  id: string;
  file: File;
  fileName: string;
  pages: PdfPageOption[];
  error: string;
};

type RenderedPdfPage = {
  file: File;
  sourceFileName: string;
};

type ParsedCandidate = {
  result: ParseResult;
  lines: string[];
  score: number;
};

const fieldLabels: Array<{ key: FieldKey; label: string; prominent?: boolean }> = [
  { key: 'passportNumber', label: 'Passport number', prominent: true },
  { key: 'lastName', label: 'Surname' },
  { key: 'firstNames', label: 'Given names' },
  { key: 'issuingState', label: 'Issuing country' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'birthDate', label: 'Birth date (YYMMDD)' },
  { key: 'sex', label: 'Sex' },
  { key: 'expirationDate', label: 'Expiry date (YYMMDD)' },
  { key: 'documentCode', label: 'Document code' },
  { key: 'personalNumber', label: 'Personal number' },
];

const emptyFields: ExtractedFields = {
  passportNumber: '',
  documentCode: '',
  issuingState: '',
  nationality: '',
  lastName: '',
  firstNames: '',
  birthDate: '',
  sex: '',
  expirationDate: '',
  personalNumber: '',
};

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isAcceptedImage(file: File) {
  return (
    acceptedImageTypes.has(file.type) ||
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

function isAcceptedPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function createRecord(file: File, sourceFileName = file.name || 'camera-capture.jpg'): PassportRecord {
  return {
    id: crypto.randomUUID(),
    file,
    sourceFileName,
    previewUrl: URL.createObjectURL(file),
    status: 'queued',
    progress: 0,
    message: 'Waiting',
    fields: { ...emptyFields },
    rawMrz: '',
    valid: null,
    validationDetails: [],
    ocrText: '',
    error: '',
  };
}

function statusLabel(status: RecordStatus) {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'done':
      return 'Valid';
    case 'needs-review':
      return 'Review';
    case 'error':
      return 'Error';
  }
}

function getStatusIcon(status: RecordStatus) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={15} />;
    case 'needs-review':
      return <AlertTriangle size={15} />;
    case 'error':
      return <X size={15} />;
    case 'processing':
      return <Loader2 size={15} className="spin" />;
    case 'queued':
      return <Loader2 size={15} />;
  }
}

function updateRecordById(
  records: PassportRecord[],
  id: string,
  updater: (record: PassportRecord) => PassportRecord,
) {
  return records.map((record) => (record.id === id ? updater(record) : record));
}

function cleanMrzLine(line: string) {
  return line
    .toUpperCase()
    .replace(/[‹›«»<]/g, '<')
    .replace(/[{}[\]()]/g, '<')
    .replace(/[|!]/g, 'I')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '');
}

function toMrzLength(line: string, length = 44) {
  const trimmed = line.slice(0, length);
  return trimmed.padEnd(length, '<');
}

function findCandidatePairs(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanMrzLine)
    .filter((line) => line.length >= 20);

  const pairs: string[][] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const firstLine = lines[index];
    const secondLine = lines[index + 1];
    const firstStart = Math.max(firstLine.indexOf('P<'), firstLine.search(/^P[A-Z0-9<]/));
    const lineOne = firstStart >= 0 ? firstLine.slice(firstStart) : firstLine;

    if (lineOne.length >= 30 && secondLine.length >= 30) {
      pairs.push([toMrzLength(lineOne), toMrzLength(secondLine)]);
    }
  }

  const compact = lines.join('');
  const compactStart = compact.indexOf('P<');
  if (compactStart >= 0 && compact.length >= compactStart + 70) {
    const candidate = compact.slice(compactStart, compactStart + 88);
    pairs.push([toMrzLength(candidate.slice(0, 44)), toMrzLength(candidate.slice(44, 88))]);
  }

  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = pair.join('\n');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreParseResult(result: ParseResult) {
  const validDetails = result.details.filter((detail) => detail.valid).length;
  const invalidDetails = result.details.length - validDetails;
  const documentNumberScore = result.documentNumber ? 20 : 0;
  const passportFormatScore = result.format === 'TD3' ? 25 : 0;
  const validScore = result.valid ? 100 : 0;
  return validScore + passportFormatScore + documentNumberScore + validDetails - invalidDetails * 3;
}

function parseBestMrz(ocrText: string): ParsedCandidate | null {
  const candidates = findCandidatePairs(ocrText);
  let bestCandidate: ParsedCandidate | null = null;

  for (const lines of candidates) {
    try {
      const result = parse(lines, { autocorrect: true });
      const score = scoreParseResult(result);
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { result, lines, score };
      }
    } catch {
      // Unsupported candidates are expected with imperfect OCR.
    }
  }

  return bestCandidate;
}

function extractedFieldsFromParse(result: ParseResult): ExtractedFields {
  const fields = result.fields;

  return {
    passportNumber: result.documentNumber ?? fields.documentNumber ?? '',
    documentCode: fields.documentCode ?? '',
    issuingState: fields.issuingState ?? '',
    nationality: fields.nationality ?? '',
    lastName: fields.lastName ?? '',
    firstNames: fields.firstName ?? '',
    birthDate: fields.birthDate ?? '',
    sex: fields.sex ?? '',
    expirationDate: fields.expirationDate ?? '',
    personalNumber: fields.personalNumber ?? '',
  };
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function preprocessMrzImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const cropY = Math.round(bitmap.height * 0.54);
  const cropHeight = bitmap.height - cropY;
  const maxWidth = 1800;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  context.drawImage(bitmap, 0, cropY, bitmap.width, cropHeight, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const average = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted = average < 150 ? Math.max(0, average - 42) : Math.min(255, average + 58);
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not render PDF page.'));
        }
      },
      type,
      quality,
    );
  });
}

function getPdfPageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  return { canvas, context };
}

function getPageImageName(fileName: string, pageNumber: number) {
  const baseName = fileName.replace(/\.pdf$/i, '') || 'passport';
  return `${baseName}-page-${pageNumber}.png`;
}

async function renderPdfThumbnails(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const document = await loadingTask.promise;
  const pages: PdfPageOption[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(0.42, 220 / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = getPdfPageCanvas(viewport.width, viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        pageNumber,
        thumbnailUrl: canvas.toDataURL('image/jpeg', 0.78),
        selected: true,
        width: Math.round(baseViewport.width),
        height: Math.round(baseViewport.height),
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

async function renderPdfPagesToFiles(file: File, pageNumbers: number[]): Promise<RenderedPdfPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const document = await loadingTask.promise;
  const renderedPages: RenderedPdfPage[] = [];

  try {
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1.7, 1800 / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const { canvas, context } = getPdfPageCanvas(viewport.width, viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasToBlob(canvas);
      renderedPages.push({
        file: new File([blob], getPageImageName(file.name, pageNumber), { type: 'image/png' }),
        sourceFileName: `${file.name || 'passport.pdf'} - page ${pageNumber}`,
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return renderedPages;
}

function recordToExport(record: PassportRecord) {
  return {
    id: record.id,
    sourceFileName: record.sourceFileName,
    status: record.status,
    fields: record.fields,
    rawMrz: record.rawMrz,
    valid: record.valid,
    validationDetails: record.validationDetails.map((detail) => ({
      label: detail.label,
      field: detail.field,
      value: detail.value,
      valid: detail.valid,
      error: detail.error ?? '',
    })),
    ocrText: record.ocrText,
    error: record.error,
  };
}

function buildCsv(records: PassportRecord[]) {
  const headers = [
    'sourceFileName',
    'status',
    'passportNumber',
    'documentCode',
    'issuingState',
    'nationality',
    'lastName',
    'firstNames',
    'birthDate',
    'sex',
    'expirationDate',
    'personalNumber',
    'valid',
    'rawMrz',
  ];

  const rows = records.map((record) => [
    record.sourceFileName,
    record.status,
    record.fields.passportNumber,
    record.fields.documentCode,
    record.fields.issuingState,
    record.fields.nationality,
    record.fields.lastName,
    record.fields.firstNames,
    record.fields.birthDate,
    record.fields.sex,
    record.fields.expirationDate,
    record.fields.personalNumber,
    record.valid ?? '',
    record.rawMrz,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

async function copyText(text: string) {
  if (!text) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function App() {
  const [records, setRecords] = useState<PassportRecord[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState('');
  const [workerState, setWorkerState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [pdfDialog, setPdfDialog] = useState<PdfDialogState | null>(null);
  const [pdfImportMessage, setPdfImportMessage] = useState('');
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);
  const activeRecordIdRef = useRef<string | null>(null);
  const processingChainRef = useRef(Promise.resolve());
  const recordsRef = useRef<PassportRecord[]>([]);
  const pdfDialogRef = useRef<PdfDialogState | null>(null);
  const pdfQueueRef = useRef<File[]>([]);
  const isLoadingPdfRef = useRef(false);

  const stats = useMemo(() => {
    const processed = records.filter((record) => ['done', 'needs-review', 'error'].includes(record.status)).length;
    const valid = records.filter((record) => record.status === 'done').length;
    const review = records.filter((record) => record.status === 'needs-review' || record.status === 'error').length;
    return { processed, valid, review, total: records.length };
  }, [records]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    pdfDialogRef.current = pdfDialog;
  }, [pdfDialog]);

  useEffect(() => {
    return () => {
      recordsRef.current.forEach((record) => URL.revokeObjectURL(record.previewUrl));
      pdfDialogRef.current?.pages.forEach((page) => URL.revokeObjectURL(page.thumbnailUrl));
      void workerRef.current?.terminate();
    };
  }, []);

  function setRecord(id: string, updater: (record: PassportRecord) => PassportRecord) {
    setRecords((current) => updateRecordById(current, id, updater));
  }

  async function ensureWorker() {
    if (workerRef.current) {
      return workerRef.current;
    }

    setWorkerState('loading');
    const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      logger: (message) => {
        const id = activeRecordIdRef.current;
        if (!id || message.status !== 'recognizing text') {
          return;
        }
        setRecord(id, (record) => ({
          ...record,
          progress: Math.max(record.progress, Math.round(30 + message.progress * 55)),
          message: 'Reading MRZ',
        }));
      },
    });
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '0',
      user_defined_dpi: '300',
    });
    workerRef.current = worker;
    setWorkerState('ready');
    return worker;
  }

  async function processRecord(record: PassportRecord) {
    activeRecordIdRef.current = record.id;
    setRecord(record.id, (current) => ({
      ...current,
      status: 'processing',
      progress: 6,
      message: 'Preparing image',
      error: '',
      ocrText: '',
      rawMrz: '',
      valid: null,
      validationDetails: [],
    }));

    try {
      const worker = await ensureWorker();
      setRecord(record.id, (current) => ({ ...current, progress: 24, message: 'Cropping MRZ area' }));
      const canvas = await preprocessMrzImage(record.file);

      setRecord(record.id, (current) => ({ ...current, progress: 30, message: 'Reading MRZ' }));
      const recognition = await worker.recognize(canvas, {
        rotateAuto: true,
      });
      const ocrText = recognition.data.text;

      setRecord(record.id, (current) => ({ ...current, progress: 88, message: 'Parsing data', ocrText }));
      const parsed = parseBestMrz(ocrText);

      if (!parsed) {
        setRecord(record.id, (current) => ({
          ...current,
          status: 'needs-review',
          progress: 100,
          message: 'Manual review',
          ocrText,
          valid: false,
          error: 'No valid TD3 passport MRZ candidate was found.',
        }));
        return;
      }

      const validationDetails = parsed.result.details;
      setRecord(record.id, (current) => ({
        ...current,
        status: parsed.result.valid ? 'done' : 'needs-review',
        progress: 100,
        message: parsed.result.valid ? 'Extracted' : 'Check fields',
        fields: extractedFieldsFromParse(parsed.result),
        rawMrz: parsed.lines.join('\n'),
        valid: parsed.result.valid,
        validationDetails,
        ocrText,
        error: parsed.result.valid ? '' : 'MRZ was parsed but one or more check fields did not validate.',
      }));
    } catch (error) {
      setRecord(record.id, (current) => ({
        ...current,
        status: 'error',
        progress: 100,
        message: 'Failed',
        valid: false,
        error: error instanceof Error ? error.message : 'OCR failed.',
      }));
    } finally {
      activeRecordIdRef.current = null;
    }
  }

  function queueRecords(nextRecords: PassportRecord[]) {
    processingChainRef.current = processingChainRef.current
      .then(async () => {
        for (const record of nextRecords) {
          await processRecord(record);
        }
      })
      .catch(() => undefined);
  }

  async function loadNextPdfFromQueue() {
    if (isLoadingPdfRef.current || pdfDialogRef.current) {
      return;
    }

    const file = pdfQueueRef.current.shift();
    if (!file) {
      setPdfImportMessage('');
      return;
    }

    isLoadingPdfRef.current = true;
    setPdfImportMessage(`Preparing ${file.name || 'PDF'}`);
    let shouldContinueQueue = false;

    try {
      const pages = await renderPdfThumbnails(file);
      const nextDialog: PdfDialogState = {
        id: crypto.randomUUID(),
        file,
        fileName: file.name || 'passport.pdf',
        pages,
        error: '',
      };
      pdfDialogRef.current = nextDialog;
      setPdfDialog(nextDialog);
      setPdfImportMessage('');
    } catch (error) {
      setCopiedLabel(error instanceof Error ? `PDF failed: ${error.message}` : 'PDF failed to open');
      window.setTimeout(() => setCopiedLabel(''), 2500);
      setPdfImportMessage('');
      shouldContinueQueue = true;
    } finally {
      isLoadingPdfRef.current = false;
      if (shouldContinueQueue) {
        void loadNextPdfFromQueue();
      }
    }
  }

  function enqueuePdfFiles(files: File[]) {
    pdfQueueRef.current.push(...files);
    void loadNextPdfFromQueue();
  }

  function closePdfDialog() {
    pdfDialogRef.current?.pages.forEach((page) => URL.revokeObjectURL(page.thumbnailUrl));
    pdfDialogRef.current = null;
    setPdfDialog(null);
    setPdfImportMessage('');
    window.setTimeout(() => {
      void loadNextPdfFromQueue();
    }, 0);
  }

  function togglePdfPage(pageNumber: number) {
    setPdfDialog((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        error: '',
        pages: current.pages.map((page) =>
          page.pageNumber === pageNumber ? { ...page, selected: !page.selected } : page,
        ),
      };
    });
  }

  function setAllPdfPages(selected: boolean) {
    setPdfDialog((current) =>
      current
        ? {
            ...current,
            error: '',
            pages: current.pages.map((page) => ({ ...page, selected })),
          }
        : current,
    );
  }

  async function importSelectedPdfPages() {
    if (!pdfDialog) {
      return;
    }

    const selectedPages = pdfDialog.pages.filter((page) => page.selected).map((page) => page.pageNumber);

    if (!selectedPages.length) {
      setPdfDialog((current) => (current ? { ...current, error: 'Select at least one page to import.' } : current));
      return;
    }

    setIsImportingPdf(true);
    setPdfImportMessage(`Rendering ${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'}`);

    try {
      const renderedPages = await renderPdfPagesToFiles(pdfDialog.file, selectedPages);
      const nextRecords = renderedPages.map((page) => createRecord(page.file, page.sourceFileName));

      if (nextRecords.length) {
        setRecords((current) => [...nextRecords, ...current]);
        queueRecords(nextRecords);
      }

      closePdfDialog();
    } catch (error) {
      setPdfDialog((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : 'Could not render selected PDF pages.',
            }
          : current,
      );
    } finally {
      setIsImportingPdf(false);
      setPdfImportMessage('');
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const imageFiles = files.filter(isAcceptedImage);
    const pdfFiles = files.filter((file) => !isAcceptedImage(file) && isAcceptedPdf(file));
    const nextRecords = imageFiles.map((file) => createRecord(file));

    if (!nextRecords.length && !pdfFiles.length) {
      setCopiedLabel('Unsupported file type');
      window.setTimeout(() => setCopiedLabel(''), 1800);
      return;
    }

    if (nextRecords.length) {
      setRecords((current) => [...nextRecords, ...current]);
      queueRecords(nextRecords);
    }

    if (pdfFiles.length) {
      enqueuePdfFiles(pdfFiles);
    }
  }

  function retryRecord(record: PassportRecord) {
    const retryVersion: PassportRecord = {
      ...record,
      status: 'queued',
      progress: 0,
      message: 'Waiting',
      fields: { ...emptyFields },
      rawMrz: '',
      valid: null,
      validationDetails: [],
      ocrText: '',
      error: '',
    };
    setRecords((current) => updateRecordById(current, record.id, () => retryVersion));
    queueRecords([retryVersion]);
  }

  function removeRecord(record: PassportRecord) {
    URL.revokeObjectURL(record.previewUrl);
    setRecords((current) => current.filter((item) => item.id !== record.id));
  }

  function clearAll() {
    records.forEach((record) => URL.revokeObjectURL(record.previewUrl));
    setRecords([]);
  }

  function updateField(recordId: string, key: FieldKey, value: string) {
    setRecord(recordId, (record) => ({
      ...record,
      fields: {
        ...record.fields,
        [key]: value,
      },
    }));
  }

  async function copyValue(label: string, value: string) {
    try {
      await copyText(value);
      setCopiedLabel(`${label} copied`);
      window.setTimeout(() => setCopiedLabel(''), 1400);
    } catch {
      setCopiedLabel('Copy failed');
      window.setTimeout(() => setCopiedLabel(''), 1400);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(records.map(recordToExport), null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    downloadBlob('passports.json', blob);
  }

  function exportCsv() {
    const blob = new Blob([buildCsv(records)], {
      type: 'text/csv;charset=utf-8',
    });
    downloadBlob('passports.csv', blob);
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Passport extractor controls">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>Zafar's Passport Extractor</h1>
            <p>Device-only MRZ OCR</p>
          </div>
        </div>

        <div className="actions">
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*,application/pdf,.pdf"
            multiple
            onChange={(event) => {
              if (event.target.files) {
                addFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
          <input
            ref={cameraInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              if (event.target.files) {
                addFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
          <button className="button primary" type="button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={17} />
            Upload
          </button>
          <button className="button" type="button" onClick={() => cameraInputRef.current?.click()}>
            <Camera size={17} />
            Camera
          </button>
          <button className="button" type="button" onClick={exportJson} disabled={!records.length}>
            <FileJson size={17} />
            JSON
          </button>
          <button className="button" type="button" onClick={exportCsv} disabled={!records.length}>
            <Download size={17} />
            CSV
          </button>
          <button className="icon-button danger" type="button" onClick={clearAll} disabled={!records.length} title="Clear all">
            <Trash2 size={18} />
          </button>
        </div>
      </section>

      <section
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <ImagePlus size={24} />
        <div>
          <strong>Drop passport images or PDFs here</strong>
          <span>JPEG, PNG, WebP, PDF</span>
        </div>
        <div className="stats">
          <span>{stats.total} total</span>
          <span>{stats.valid} valid</span>
          <span>{stats.review} review</span>
          <span>
            {pdfImportMessage || (workerState === 'loading' ? 'OCR loading' : workerState === 'ready' ? 'OCR ready' : 'OCR idle')}
          </span>
        </div>
      </section>

      {records.length === 0 ? (
        <section className="empty-state">
          <Clipboard size={30} />
          <h2>No passports loaded</h2>
          <p>Upload or capture passport images to start a private extraction session.</p>
        </section>
      ) : (
        <section className="record-list" aria-label="Imported passports and extracted data">
          {records.map((record) => (
            <article className="record-card" key={record.id}>
              <div className="passport-panel">
                <div className="record-header">
                  <div>
                    <h2>{record.sourceFileName}</h2>
                    <p>{record.message}</p>
                  </div>
                  <span className={`status-pill ${record.status}`}>
                    {getStatusIcon(record.status)}
                    {statusLabel(record.status)}
                  </span>
                </div>
                <div className="image-frame">
                  <img src={record.previewUrl} alt={`Imported passport ${record.sourceFileName}`} />
                </div>
                <div className="record-tools">
                  <button className="button compact" type="button" onClick={() => retryRecord(record)}>
                    <RefreshCcw size={15} />
                    Retry
                  </button>
                  <button className="button compact danger-text" type="button" onClick={() => removeRecord(record)}>
                    <Trash2 size={15} />
                    Remove
                  </button>
                </div>
              </div>

              <div className="data-panel">
                <div className="progress-line" aria-hidden={record.status !== 'processing'}>
                  <div style={{ width: `${record.progress}%` }} />
                </div>

                <div className="field-grid">
                  {fieldLabels.map((field) => (
                    <label className={`field ${field.prominent ? 'prominent' : ''}`} key={field.key}>
                      <span>{field.label}</span>
                      <div className="input-shell">
                        <input
                          value={record.fields[field.key]}
                          onChange={(event) => updateField(record.id, field.key, event.target.value)}
                          onClick={(event) => {
                            event.currentTarget.select();
                            void copyValue(field.label, event.currentTarget.value);
                          }}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="copy-button"
                          title={`Copy ${field.label}`}
                          onClick={() => copyValue(field.label, record.fields[field.key])}
                        >
                          <Clipboard size={15} />
                        </button>
                      </div>
                    </label>
                  ))}
                </div>

                <label className="field raw-mrz">
                  <span>Raw MRZ</span>
                  <div className="input-shell textarea-shell">
                    <textarea
                      value={record.rawMrz}
                      onChange={(event) =>
                        setRecord(record.id, (current) => ({ ...current, rawMrz: event.target.value }))
                      }
                      onClick={(event) => {
                        event.currentTarget.select();
                        void copyValue('Raw MRZ', event.currentTarget.value);
                      }}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="copy-button"
                      title="Copy raw MRZ"
                      onClick={() => copyValue('Raw MRZ', record.rawMrz)}
                    >
                      <Clipboard size={15} />
                    </button>
                  </div>
                </label>

                {record.error ? (
                  <div className="notice">
                    <AlertTriangle size={17} />
                    <span>{record.error}</span>
                  </div>
                ) : null}

                <div className="details-row">
                  <details>
                    <summary>
                      <Check size={15} />
                      Validation details
                    </summary>
                    <div className="detail-list">
                      {record.validationDetails.length ? (
                        record.validationDetails.map((detail, index) => (
                          <div className="detail-item" key={`${detail.label}-${index}`}>
                            <span>{detail.label}</span>
                            <strong className={detail.valid ? 'valid-text' : 'invalid-text'}>
                              {detail.valid ? 'Valid' : detail.error || 'Invalid'}
                            </strong>
                          </div>
                        ))
                      ) : (
                        <p>No validation data yet.</p>
                      )}
                    </div>
                  </details>

                  <details>
                    <summary>
                      <Clipboard size={15} />
                      OCR text
                    </summary>
                    <pre>{record.ocrText || 'No OCR text yet.'}</pre>
                  </details>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {pdfDialog ? (
        <section className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title">
          <div className="pdf-dialog">
            <div className="pdf-dialog-header">
              <div>
                <div className="eyebrow">
                  <FileText size={15} />
                  PDF import
                </div>
                <h2 id="pdf-dialog-title">{pdfDialog.fileName}</h2>
                <p>
                  {pdfDialog.pages.filter((page) => page.selected).length} of {pdfDialog.pages.length} pages selected
                </p>
              </div>
              <button className="icon-button" type="button" onClick={closePdfDialog} title="Cancel PDF import">
                <X size={18} />
              </button>
            </div>

            <div className="pdf-dialog-actions">
              <button className="button compact" type="button" onClick={() => setAllPdfPages(true)}>
                <CheckCircle2 size={15} />
                Select all
              </button>
              <button className="button compact" type="button" onClick={() => setAllPdfPages(false)}>
                <X size={15} />
                Select none
              </button>
            </div>

            <div className="pdf-page-grid">
              {pdfDialog.pages.map((page) => (
                <button
                  className={`pdf-page-card ${page.selected ? 'selected' : ''}`}
                  type="button"
                  key={page.pageNumber}
                  onClick={() => togglePdfPage(page.pageNumber)}
                >
                  <span className="pdf-page-check">{page.selected ? <Check size={16} /> : null}</span>
                  <img src={page.thumbnailUrl} alt={`${pdfDialog.fileName} page ${page.pageNumber}`} />
                  <strong>Page {page.pageNumber}</strong>
                  <small>
                    {page.width} x {page.height}
                  </small>
                </button>
              ))}
            </div>

            {pdfDialog.error ? (
              <div className="notice">
                <AlertTriangle size={17} />
                <span>{pdfDialog.error}</span>
              </div>
            ) : null}

            <div className="pdf-dialog-footer">
              <button className="button" type="button" onClick={closePdfDialog} disabled={isImportingPdf}>
                Cancel
              </button>
              <button className="button primary" type="button" onClick={importSelectedPdfPages} disabled={isImportingPdf}>
                {isImportingPdf ? <Loader2 size={17} className="spin" /> : <Layers size={17} />}
                {isImportingPdf ? pdfImportMessage || 'Rendering' : 'Import selected'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {copiedLabel ? <div className="toast">{copiedLabel}</div> : null}
    </main>
  );
}

export default App;
