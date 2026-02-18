"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader2, Trash2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setUploading(true);

        const supabase = createClient();
        const filePath = `projects/${projectId}/${Date.now()}_${file.name}`;

        try {
            const { error: uploadError } = await supabase.storage
                .from("project-files")
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { addDocument } = await import("@/lib/actions/documents");
            const result = await addDocument(projectId, file.name, filePath);

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
                        accept=".pdf,.csv,.xls,.xlsx,.xlsm,.txt,.doc,.docx,image/*"
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

            {files && files.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                    {files.map((doc: any) => {
                        const ext = getFileExtension(doc.name);
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

                                <div className="mt-3">
                                    <span className="inline-block text-[11px] font-medium text-muted-foreground bg-muted/80 px-2 py-0.5 rounded">
                                        {ext}
                                    </span>
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
