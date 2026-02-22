"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader2, Trash2, Plus, CheckCircle2, FileText, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { extractFileContent } from "@/lib/extract-file-content";

interface ProjectFilesProps {
    projectId: string;
    initialFiles: any[];
}

function getFileExtension(filename: string): string {
    const parts = filename.split(".");
    if (parts.length < 2) return "FILE";
    return parts[parts.length - 1].toUpperCase();
}

export function ProjectFiles({ projectId, initialFiles }: ProjectFilesProps) {
    const [files, setFiles] = useState(initialFiles);
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState("");
    const [indexingId, setIndexingId] = useState<string | null>(null);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setUploading(true);
        setUploadStatus("Uploading file...");

        const supabase = createClient();
        const filePath = `projects/${projectId}/${Date.now()}_${file.name}`;

        try {
            // 1. Upload file to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from("project-files")
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Extract text content from the file (client-side)
            setUploadStatus("Extracting content...");
            let extractedContent = "";
            try {
                extractedContent = await extractFileContent(file);
                if (extractedContent) {
                    console.log(`Extracted ${extractedContent.length} chars from ${file.name}`);
                }
            } catch (extractError) {
                console.warn("Content extraction failed (non-fatal):", extractError);
                // Non-fatal — file still uploads, just without extracted content
            }

            // 3. Save metadata + extracted content to documents table
            setUploadStatus("Saving...");
            const { addDocument } = await import("@/lib/actions/documents");
            const result = await addDocument(projectId, file.name, filePath, extractedContent || undefined);

            if (result.success) {
                window.location.reload();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            console.error("Upload failed:", error);
            alert("Upload failed: " + error.message);
        } finally {
            setUploading(false);
            setUploadStatus("");
        }
    };

    const handleDelete = async (docId: string, filePath: string) => {
        if (!confirm("Are you sure you want to delete this file?")) return;

        const supabase = createClient();

        try {
            await supabase.storage.from("project-files").remove([filePath]);

            const { deleteDocument } = await import("@/lib/actions/documents");
            const result = await deleteDocument(docId);

            if (result.success) {
                window.location.reload();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            console.error("Delete failed:", error);
            alert("Delete failed: " + error.message);
        }
    };

    const handleReindex = async (doc: any) => {
        setIndexingId(doc.id);
        const supabase = createClient();

        try {
            // Download file from Supabase Storage
            const { data: fileData, error: downloadError } = await supabase.storage
                .from("project-files")
                .download(doc.file_path);

            if (downloadError || !fileData) throw downloadError || new Error("Download failed");

            // Create a File object from the blob
            const file = new File([fileData], doc.name, { type: fileData.type });

            // Extract content
            const content = await extractFileContent(file);
            if (!content) {
                alert("Could not extract content from this file type.");
                return;
            }

            // Update document in DB
            const { updateDocumentContent } = await import("@/lib/actions/documents");
            const result = await updateDocumentContent(doc.id, content);

            if (result.success) {
                window.location.reload();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            console.error("Re-index failed:", error);
            alert("Re-index failed: " + error.message);
        } finally {
            setIndexingId(null);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base text-foreground">Files</h3>
                <label className="cursor-pointer">
                    <input
                        type="file"
                        className="hidden"
                        onChange={handleUpload}
                        disabled={uploading}
                        accept=".pdf,.csv,.xls,.xlsx,.xlsm,.txt,.doc,.docx,.md"
                    />
                    <div className="flex items-center justify-center h-7 w-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                        {uploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                    </div>
                </label>
            </div>

            {/* Upload status indicator */}
            {uploading && uploadStatus && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-xs text-primary">{uploadStatus}</span>
                </div>
            )}

            {files && files.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                    {files.map((doc: any) => {
                        const ext = getFileExtension(doc.name);
                        const hasContent = !!doc.content;
                        return (
                            <div
                                key={doc.id}
                                className="group relative flex flex-col justify-between rounded-xl border border-border bg-card/50 p-4 min-h-[120px] hover:border-primary/40 transition-all"
                            >
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDelete(doc.id, doc.file_path)}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>

                                <p className="text-sm font-medium text-foreground leading-snug pr-6 line-clamp-3">
                                    {doc.name}
                                </p>

                                <div className="mt-3 flex items-center gap-2">
                                    <span className="inline-block text-[11px] font-medium text-muted-foreground bg-muted/80 px-2 py-0.5 rounded">
                                        {ext}
                                    </span>
                                    {hasContent ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500" title="Content extracted — available as chat context">
                                            <CheckCircle2 className="h-3 w-3" />
                                            <span>Indexed</span>
                                        </span>
                                    ) : (
                                        <button
                                            onClick={() => handleReindex(doc)}
                                            disabled={indexingId === doc.id}
                                            className="inline-flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 transition-colors cursor-pointer"
                                            title="Extract content so AI can read this file"
                                        >
                                            {indexingId === doc.id ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-3 w-3" />
                                            )}
                                            <span>{indexingId === doc.id ? "Indexing..." : "Index"}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground italic">
                    No files uploaded yet.
                </p>
            )}
        </div>
    );
}
