import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useDeleteKBDoc, useExperts, useKBDocs, useUploadKBDoc } from "@/api/hooks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import type { KBDoc } from "@/types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 3;
const ACCEPTED_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt", ".rst"] as const;
const FILE_ACCEPT = ".pdf,.md,.markdown,.txt,.rst,application/pdf,text/plain,text/markdown,text/x-rst";

const COPY = {
  pageTitle: ["任务资料", "Task Materials"],
  sectionTitle: ["本任务资料", "Documents for this task"],
  sectionDescription: [
    "上传本次批改需要检索的评分细则、讲义片段或补充答案。",
    "Upload rubrics, lecture excerpts, or supplementary answers to retrieve during grading.",
  ],
  formatHint: ["PDF、MD、TXT、RST；每份不超过 5 MB，最多 3 份。", "PDF, MD, TXT, or RST; up to 5 MB each and 3 documents total."],
  upload: ["上传资料", "Upload document"],
  uploading: ["上传中…", "Uploading…"],
  uploadProgress: ["上传进度", "Upload progress"],
  modelsLoading: ["正在确认可用模型…", "Checking available models…"],
  modelsUnavailable: ["暂时无法确认模型状态，请刷新后再试。", "Model availability could not be checked. Refresh and try again."],
  modelRequired: ["需要先添加并启用至少一个 BYOK 模型，才能为资料建立检索索引。", "Add and enable at least one BYOK model before indexing task documents."],
  openByok: ["前往模型与 BYOK", "Open Models & BYOK"],
  limitReached: ["已达到 3 份上限；删除一份后可继续上传。", "The 3-document limit is reached. Delete one to upload another."],
  emptyTitle: ["暂无本任务资料", "No task documents yet"],
  emptyDescription: ["上传后会显示文件名、片段数量和索引方式。", "Uploaded documents will show their filename, chunk count, and index method."],
  loadingDocs: ["正在读取任务资料…", "Loading task documents…"],
  loadError: ["无法读取任务资料。", "Task documents could not be loaded."],
  retry: ["重新加载", "Reload"],
  chunks: ["个片段", "chunks"],
  delete: ["删除", "Delete"],
  deleting: ["删除中…", "Deleting…"],
  boundaryTitle: ["存储边界", "Storage boundary"],
  boundaryDescription: [
    "资料只用于当前任务的检索增强；当前索引保存在内存中，后端重启或任务删除后可能失效。",
    "Documents are used only for this task. The current in-memory index may be lost after a backend restart or task deletion.",
  ],
  back: ["返回批改设置", "Back to Grading Setup"],
  missingTask: ["缺少任务 ID，无法管理任务资料。", "The task ID is missing, so task documents cannot be managed."],
  unsupported: ["仅支持 PDF、MD、TXT 或 RST 文件。", "Only PDF, MD, TXT, or RST files are supported."],
  tooLarge: ["文件不能超过 5 MB。", "The file cannot exceed 5 MB."],
  uploadFailed: ["任务资料上传失败", "Task document upload failed"],
  deleteFailed: ["任务资料删除失败", "Task document deletion failed"],
  uploaded: ["已添加任务资料", "Task document added"],
  alreadyExists: ["任务资料已存在", "Task document already exists"],
  deleted: ["已删除任务资料", "Task document deleted"],
} as const;

type CopyKey = keyof typeof COPY;

export function TaskMaterialsPage() {
  const { taskId } = useParams();
  const { locale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const docsQuery = useKBDocs(taskId);
  const expertsQuery = useExperts();
  const uploadDocument = useUploadKBDoc();
  const deleteDocument = useDeleteKBDoc();

  const documents = docsQuery.data?.docs ?? [];
  const enabledByokCount = (expertsQuery.data ?? []).filter(
    (expert) => expert.enabled && !expert.is_shared && expert.scope !== "shared",
  ).length;
  const modelGate = expertsQuery.isLoading
    ? text(locale, "modelsLoading")
    : expertsQuery.isError
      ? text(locale, "modelsUnavailable")
      : enabledByokCount === 0
        ? text(locale, "modelRequired")
        : null;
  const uploadGate = !taskId
    ? text(locale, "missingTask")
    : docsQuery.isLoading
      ? text(locale, "loadingDocs")
      : docsQuery.isError
        ? text(locale, "loadError")
        : documents.length >= MAX_DOCUMENTS
          ? text(locale, "limitReached")
          : modelGate;
  const returnTo = taskId ? `/tasks/${taskId}/materials` : "/history";
  const gradingSetupRoute = taskId ? `/tasks/${taskId}/grading-setup` : "/history";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!taskId) {
      toast.error(text(locale, "missingTask"));
      return;
    }
    if (!isAcceptedFile(file.name)) {
      toast.error(text(locale, "unsupported"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(text(locale, "tooLarge"));
      return;
    }
    if (uploadGate) {
      toast.error(uploadGate);
      return;
    }

    try {
      setUploadProgress(0);
      const result = await uploadDocument.mutateAsync({
        taskId,
        file,
        onProgress: (value) => setUploadProgress(value),
      });
      toast[result.status === "already_done" ? "info" : "success"](
        joinDetail(text(locale, result.status === "already_done" ? "alreadyExists" : "uploaded"), result.filename, locale),
      );
    } catch (error) {
      toast.error(joinDetail(text(locale, "uploadFailed"), errorMessage(error), locale));
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleDelete(document: KBDoc) {
    if (!taskId) {
      toast.error(text(locale, "missingTask"));
      return;
    }
    const confirmation = locale === "zh-CN"
      ? `确定删除本任务资料“${document.filename}”？`
      : `Delete "${document.filename}" from this task?`;
    if (!window.confirm(confirmation)) return;

    try {
      setDeletingDocId(document.doc_id);
      await deleteDocument.mutateAsync({ taskId, docId: document.doc_id });
      toast.success(joinDetail(text(locale, "deleted"), document.filename, locale));
    } catch (error) {
      toast.error(joinDetail(text(locale, "deleteFailed"), errorMessage(error), locale));
    } finally {
      setDeletingDocId(null);
    }
  }

  return (
    <div className="min-w-0 w-full max-w-[1300px]">
      <h1 className="min-h-9 break-words text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {text(locale, "pageTitle")}
      </h1>
      <NewTaskStepper currentStep={1} />

      <section className="mx-auto mt-[35px] w-full max-w-[900px] rounded-[10px] border bg-card px-5 py-5 sm:px-10 sm:py-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold leading-6 text-foreground">{text(locale, "sectionTitle")}</h2>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-muted-foreground">{text(locale, "sectionDescription")}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{text(locale, "formatHint")}</p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
            <span className="text-[12px] font-semibold text-foreground">{docsQuery.isSuccess ? documents.length : "—"} / {MAX_DOCUMENTS}</span>
            <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="sr-only" onChange={handleFileChange} />
            <button
              type="button"
              disabled={uploadDocument.isPending || deleteDocument.isPending || Boolean(uploadGate)}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {uploadDocument.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <FileUp aria-hidden="true" className="h-4 w-4" />}
              {text(locale, uploadDocument.isPending ? "uploading" : "upload")}
            </button>
          </div>
        </div>

        {uploadProgress !== null ? (
          <div className="mt-4" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{text(locale, "uploadProgress")} {uploadProgress}%</p>
          </div>
        ) : null}

        {modelGate ? (
          <div className="mt-4 flex flex-col gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[12px] leading-5">{modelGate}</p>
            </div>
            {expertsQuery.isLoading ? null : expertsQuery.isError ? (
              <button type="button" onClick={() => void expertsQuery.refetch()} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-amber-300 bg-white px-3 text-[12px] font-semibold text-foreground hover:bg-amber-50 dark:bg-background">
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {text(locale, "retry")}
              </button>
            ) : (
              <Link to={`/settings/byok?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90">
                {text(locale, "openByok")}
              </Link>
            )}
          </div>
        ) : documents.length >= MAX_DOCUMENTS ? (
          <p className="mt-4 rounded-[7px] bg-muted/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">{text(locale, "limitReached")}</p>
        ) : null}

        <div className="mt-5 border-t pt-4">
          <DocumentList
            locale={locale}
            documents={documents}
            isLoading={docsQuery.isLoading}
            isError={docsQuery.isError}
            deletingDocId={deletingDocId}
            onRetry={() => void docsQuery.refetch()}
            onDelete={(document) => void handleDelete(document)}
          />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-[8px] bg-muted/45 px-3.5 py-3 text-[11px] leading-4 text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{text(locale, "boundaryTitle")}</p>
            <p className="mt-0.5">{text(locale, "boundaryDescription")}</p>
          </div>
        </div>

        <footer className="mt-5 flex border-t pt-4">
          <Link to={gradingSetupRoute} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border bg-card px-4 text-[13px] font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {text(locale, "back")}
          </Link>
        </footer>
      </section>
    </div>
  );
}

function DocumentList({
  locale,
  documents,
  isLoading,
  isError,
  deletingDocId,
  onRetry,
  onDelete,
}: {
  locale: Locale;
  documents: KBDoc[];
  isLoading: boolean;
  isError: boolean;
  deletingDocId: string | null;
  onRetry: () => void;
  onDelete: (document: KBDoc) => void;
}) {
  if (isLoading) {
    return <div className="flex min-h-[116px] items-center justify-center gap-2 text-[12px] text-muted-foreground"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />{text(locale, "loadingDocs")}</div>;
  }
  if (isError) {
    return (
      <div className="flex min-h-[116px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[12px] text-danger">{text(locale, "loadError")}</p>
        <button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border bg-card px-3 text-[12px] font-semibold hover:bg-muted">
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />{text(locale, "retry")}
        </button>
      </div>
    );
  }
  if (documents.length === 0) {
    return (
      <div className="flex min-h-[116px] flex-col items-center justify-center rounded-[8px] border border-dashed px-4 py-5 text-center">
        <FileText aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-[13px] font-semibold text-foreground">{text(locale, "emptyTitle")}</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{text(locale, "emptyDescription")}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-[8px] border">
      {documents.map((document) => {
        const isDeleting = deletingDocId === document.doc_id;
        return (
          <li key={document.doc_id} className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-blue-50 text-primary dark:bg-blue-950/30">
                <FileText aria-hidden="true" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="break-all text-[13px] font-semibold leading-5 text-foreground">{document.filename}</p>
                <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground">
                  {document.chunk_count} {text(locale, "chunks")}{document.embedder ? ` · ${document.embedder}` : ""}{document.created_at ? ` · ${formatTimestamp(document.created_at, locale)}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={Boolean(deletingDocId)}
              onClick={() => onDelete(document)}
              className="inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-red-200 bg-card px-3 text-[12px] font-semibold text-danger outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:border-red-900 dark:hover:bg-red-950/20"
            >
              {isDeleting ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
              {text(locale, isDeleting ? "deleting" : "delete")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function text(locale: Locale, key: CopyKey): string {
  return COPY[key][locale === "zh-CN" ? 0 : 1];
}

function isAcceptedFile(filename: string): boolean {
  const normalized = filename.trim().toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function formatTimestamp(value: number, locale: Locale): string {
  return new Date(value * 1000).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown): string {
  return normalizeAPIError(error).message;
}

function joinDetail(label: string, detail: string, locale: Locale): string {
  return `${label}${locale === "zh-CN" ? "：" : ": "}${detail}`;
}
