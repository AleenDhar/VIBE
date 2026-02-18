"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { ArrowUp, Plus, Loader2, ChevronDown, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODELS = [
    { id: "anthropic:claude-opus-4-6", label: "Opus 4.6" },
    { id: "anthropic:claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "google_genai:gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { id: "google_genai:gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "openai:gpt-5.2", label: "GPT 5.2" },
];

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return "Good night";
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

function getFileIcon(fileName: string) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "")) {
        return ImageIcon;
    }
    return FileText;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatHomePage() {
    const router = useRouter();
    const supabase = createClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [inputValue, setInputValue] = useState("");
    const [userName, setUserName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [selectedModel, setSelectedModel] = useState(MODELS[0]);
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: profile } = await supabase
                    .from("profiles")
                    .select("full_name")
                    .eq("id", user.id)
                    .single();

                if (profile?.full_name) {
                    setUserName(profile.full_name.split(" ")[0]);
                } else {
                    setUserName(user.email?.split("@")[0] || "");
                }
            }
        };
        fetchUser();
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const newFiles = Array.from(e.target.files);
        setAttachedFiles(prev => [...prev, ...newFiles]);
        // Reset the input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const removeFile = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!inputValue.trim() && attachedFiles.length === 0) || submitting) return;

        setSubmitting(true);
        try {
            const { createStandaloneChat } = await import("@/lib/actions/chat");
            const result = await createStandaloneChat();

            if (result.id) {
                // Upload attached files and build message content
                let messageContent = inputValue.trim();

                if (attachedFiles.length > 0) {
                    const uploadedLinks: string[] = [];

                    for (const file of attachedFiles) {
                        const filePath = `chat/${result.id}/${Date.now()}_${file.name}`;
                        const { error } = await supabase.storage
                            .from("project-files")
                            .upload(filePath, file);

                        if (!error) {
                            const { data: { publicUrl } } = supabase.storage
                                .from("project-files")
                                .getPublicUrl(filePath);
                            uploadedLinks.push(`[File: ${file.name}](${publicUrl})`);
                        }
                    }

                    if (uploadedLinks.length > 0) {
                        const filesText = uploadedLinks.join("\n");
                        messageContent = messageContent
                            ? `${filesText}\n\n${messageContent}`
                            : filesText;
                    }
                }

                sessionStorage.setItem(`chat_initial_${result.id}`, messageContent);
                sessionStorage.setItem(`chat_model_${result.id}`, selectedModel.id);
                router.push(`/chat/${result.id}`);
            } else {
                console.error("Failed to create chat:", result.error);
                setSubmitting(false);
            }
        } catch (err) {
            console.error("Error:", err);
            setSubmitting(false);
        }
    };

    const greeting = getGreeting();

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-4 -mt-16">
            {/* Greeting */}
            <div className="text-center mb-10">
                <h1 className="text-4xl md:text-5xl font-serif font-medium tracking-tight">
                    <span className="bg-gradient-to-r from-muted-foreground/80 to-foreground bg-clip-text text-transparent">
                        {greeting}{userName ? `, ${userName}` : ""}
                    </span>
                </h1>
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSubmit} className="w-full max-w-2xl">
                <div className="relative group cursor-text">
                    <div className="flex flex-col justify-between min-h-[128px] w-full rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-4 shadow-sm transition-all focus-within:border-border focus-within:shadow-md">
                        {/* Attached Files */}
                        {attachedFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2 px-1">
                                {attachedFiles.map((file, index) => {
                                    const Icon = getFileIcon(file.name);
                                    return (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 bg-muted/60 border border-border/50 rounded-lg px-3 py-1.5 text-sm group/chip"
                                        >
                                            <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                            <span className="text-foreground/90 truncate max-w-[150px]">{file.name}</span>
                                            <span className="text-muted-foreground/60 text-xs">{formatFileSize(file.size)}</span>
                                            <button
                                                type="button"
                                                onClick={() => removeFile(index)}
                                                className="ml-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <textarea
                            className="w-full bg-transparent border-none resize-none p-2 text-base placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
                            placeholder="How can I help you today?"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            rows={2}
                            disabled={submitting}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e);
                                }
                            }}
                        />
                        <div className="flex items-center justify-between px-1">
                            {/* Attach File Button */}
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    onChange={handleFileSelect}
                                    accept=".pdf,.csv,.xls,.xlsx,.xlsm,.txt,.doc,.docx,.json,.md,image/*"
                                    multiple
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    type="button"
                                    className="h-8 w-8 text-muted-foreground/60 hover:text-foreground rounded-lg"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={submitting}
                                >
                                    <Paperclip className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Model Selector */}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            type="button"
                                            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 rounded-lg"
                                        >
                                            {selectedModel.label}
                                            <ChevronDown className="h-3 w-3 opacity-50" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[160px]">
                                        {MODELS.map((m) => (
                                            <DropdownMenuItem
                                                key={m.id}
                                                onClick={() => setSelectedModel(m)}
                                                className={selectedModel.id === m.id ? "bg-accent" : ""}
                                            >
                                                {m.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                {/* Submit */}
                                <Button
                                    type="submit"
                                    size="icon"
                                    className="rounded-full h-9 w-9 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                                    disabled={(!inputValue.trim() && attachedFiles.length === 0) || submitting}
                                >
                                    {submitting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <ArrowUp className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}
