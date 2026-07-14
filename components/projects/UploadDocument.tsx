"use client";

import { Button } from "@/components/ui/Button";
import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { addDocument } from "@/lib/actions/documents";
import { uploadFileViaServer } from "@/lib/upload-file";

export function UploadDocument({ projectId }: { projectId: string }) {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setIsUploading(true);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `${projectId}/${fileName}`;

            // Upload via our own origin — Zscaler blocks direct browser -> Supabase uploads.
            await uploadFileViaServer(file, filePath);

            // Call Server Action to save metadata
            const response = await addDocument(projectId, file.name, filePath);
            if (response?.error) {
                throw new Error(response.error);
            }

            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

        } catch (error: any) {
            console.error("Upload error:", error);
            alert(error.message || "Error uploading file.");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="flex items-center gap-4">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
                disabled={isUploading}
            />
            <Button
                variant="outline"
                isLoading={isUploading}
                leftIcon={Upload}
                onClick={handleButtonClick}
            >
                Upload Document
            </Button>
        </div>
    );
}
