import { BookOpenCheck, FileText, Info, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { useDeletePersonalKnowledge, usePersonalKnowledge, useUploadPersonalKnowledge } from "@/api/hooks";
import type { PersonalKnowledgeDocument } from "@/types/personalKnowledge";

const PERSONAL_KB_ACCEPT = ".pdf,.txt,.md,.markdown,.docx,.pptx,text/plain,text/markdown,application/pdf";

export function KnowledgeBasePage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const query = usePersonalKnowledge();
  const upload = useUploadPersonalKnowledge();
  const remove = useDeletePersonalKnowledge();
  const [busy, setBusy] = useState(false);
  const docs = query.data?.documents ?? [];

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) await upload.mutateAsync({ file });
      toast.success(`已上传 ${files.length} 份个人知识库资料`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally { setBusy(false); }
  }

  async function onDelete(doc: PersonalKnowledgeDocument) {
    if (!window.confirm(`确定删除“${doc.original_name}”？`)) return;
    try { await remove.mutateAsync(doc.id); toast.success(`已删除：${doc.original_name}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "删除失败"); }
  }

  return (
    <div className="grid gap-5">
      <SectionHeader title="个人知识库" description="上传可跨任务复用的教材、讲义和评分参考。文件会保存到当前部署配置的持久化存储中。" />
      <Card className="grid gap-4 border-warning/30 bg-warning/5">
        <div className="flex items-start gap-3"><Info className="mt-1 h-5 w-5 text-warning" /><p className="text-sm leading-6 text-muted-foreground">资料只属于当前账号。上传后不会自动参与批改，必须在任务设置中明确勾选。</p></div>
      </Card>
      <Card className="grid gap-4">
        <div className="flex items-center gap-3"><BookOpenCheck className="h-5 w-5 text-accent" /><div><h2 className="font-semibold">资料列表</h2><p className="text-sm text-muted-foreground">支持文本型 PDF、DOCX、PPTX、TXT、MD；暂不处理扫描 PDF OCR。</p></div></div>
        {query.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : docs.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无个人知识库资料。</p> : <div className="grid gap-2">{docs.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"><div className="flex min-w-0 items-center gap-3"><FileText className="h-4 w-4 shrink-0 text-accent" /><div className="min-w-0"><p className="break-words text-sm font-medium">{doc.original_name}</p><p className="text-xs text-muted-foreground">{formatBytes(doc.size_bytes)} · {doc.status === "ready" ? `${doc.chunk_count} 个片段` : `状态：${doc.status}`}</p></div></div><Button type="button" variant="danger" className="h-8" onClick={() => onDelete(doc)} disabled={remove.isPending}><Trash2 className="h-4 w-4" />删除</Button></div>)}</div>}
      </Card>
      <Card className="grid gap-3"><input ref={inputRef} className="sr-only" type="file" accept={PERSONAL_KB_ACCEPT} multiple onChange={onFiles} /><Button type="button" className="w-fit" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}选择文件上传</Button><p className="text-xs text-muted-foreground">上传内容和解析后的分块会持久化；只有你删除时才会移除。</p></Card>
    </div>
  );
}

function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
