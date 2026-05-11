"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, MoreHorizontal, Star, Plus, ArrowUp, ArrowDown, MessageSquare, ChevronDown, Paperclip, Image as ImageIcon, X, FileText as FileIcon, Loader2, Copy, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { SystemPromptCard } from "@/components/projects/SystemPromptCard";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { MemoryManager } from "@/components/projects/MemoryManager";
import { VisibilityToggle } from "@/components/projects/VisibilityToggle";
import { ProjectAccessManager } from "@/components/projects/ProjectAccessManager";
import { TagManager } from "@/components/projects/TagManager";
import type { Tag } from "@/lib/actions/tags";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { createClient } from "@/lib/supabase/client";
import { extractFileContent } from "@/lib/extract-file-content";
import { addDocument } from "@/lib/actions/documents";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { getActiveModels, getUserAllowedModels, AIModel } from "@/lib/actions/models";
import { getCurrentUserRole } from "@/lib/actions/admin";

interface Chat {
    id: string;
    title: string;
    created_at: string;
}

interface AbmRun {
    seq: number;
    account_id: string;
    account_name: string | null;
    campaign_id: string | null;
    pushed_count: number | null;
    started_at: string;
    completed_at: string | null;
    source: "marker" | "heuristic" | "manual";
    chat: { id: string; title: string | null } | null;
}

interface Diagnosis {
    chat_id: string;
    run_at: string;
    account_id: string | null;
    account_name: string | null;
    opportunity_id: string | null;
    opportunity_name: string | null;
    stage: string | null;
    amount: number | null;
    close_date: string | null;
    owner_name: string | null;
    momentum_verdict: "accelerating" | "stalling" | "drifting" | null;
    health_rating: "high" | "medium" | "low" | null;
    top_risks: any;
    recommendations: any;
    key_themes: any;
    meeting_count_30d: number | null;
    last_meeting_date: string | null;
}

// Light, friendly card palette. Each entry uses /10 background + /30 border
// + 700/300 split text so it reads cleanly in both light and dark themes.
// Cards are coloured by a hash of account_id so the same account always gets
// the same hue (visual continuity across multiple runs of the same account).
// (palette is intentionally narrow; see ABM_CARD_PALETTE.length cap below)
const ABM_CARD_PALETTE = [
    { bg: "bg-sky-500/10",     border: "border-sky-500/30",     accent: "text-sky-700 dark:text-sky-300" },
    { bg: "bg-emerald-500/10", border: "border-emerald-500/30", accent: "text-emerald-700 dark:text-emerald-300" },
    { bg: "bg-violet-500/10",  border: "border-violet-500/30",  accent: "text-violet-700 dark:text-violet-300" },
    { bg: "bg-amber-500/10",   border: "border-amber-500/30",   accent: "text-amber-700 dark:text-amber-300" },
    { bg: "bg-rose-500/10",    border: "border-rose-500/30",    accent: "text-rose-700 dark:text-rose-300" },
    { bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    accent: "text-cyan-700 dark:text-cyan-300" },
    { bg: "bg-indigo-500/10",  border: "border-indigo-500/30",  accent: "text-indigo-700 dark:text-indigo-300" },
    { bg: "bg-teal-500/10",    border: "border-teal-500/30",    accent: "text-teal-700 dark:text-teal-300" },
] as const;

// djb2-style stable hash → palette index. Same account_id always lands on
// the same colour, even across page renders / sessions.
function pickAbmCardPalette(seed: string) {
    let h = 5381;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    }
    return ABM_CARD_PALETTE[Math.abs(h) % ABM_CARD_PALETTE.length];
}

interface ProjectPageClientProps {
    project: any;
    isOwner: boolean;
    canManageAccess: boolean;
    canEdit: boolean;
    initialChats: Chat[];
    initialDocuments: any[];
    initialMemories: any[];
    initialVersions: any[];
    initialTags: Tag[];
    isAbmProject?: boolean;
    initialAbmRuns?: AbmRun[];
    isDiagnosisProject?: boolean;
    initialDiagnoses?: Diagnosis[];
}

export function ProjectPageClient({
    project,
    isOwner,
    canManageAccess,
    canEdit,
    initialChats,
    initialDocuments,
    initialMemories,
    initialVersions,
    initialTags,
    isAbmProject = false,
    initialAbmRuns = [],
    isDiagnosisProject = false,
    initialDiagnoses = [],
}: ProjectPageClientProps) {
    const router = useRouter();
    const supabase = createClient();
    // const [activeChatId, setActiveChatId] = useState<string | null>(null); // Removed
    // const [chatMessages, setChatMessages] = useState<any[]>([]); // Removed
    const [chats, setChats] = useState<Chat[]>(initialChats);
    // const [loadingChat, setLoadingChat] = useState(false); // Removed
    const [inputValue, setInputValue] = useState("");
    const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
    const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [pendingDocuments, setPendingDocuments] = useState<{ name: string, url: string, extractedContent: string }[]>([]);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [cloning, setCloning] = useState(false);
    const [projectName, setProjectName] = useState(project.name);
    const [runsFilter, setRunsFilter] = useState("");

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const files = Array.from(e.target.files);
        setUploadingImage(true);

        try {
            const urls = await Promise.all(
                files.map(async (file) => {
                    const filePath = `chat/temp_${project.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.\-]/g, '')}`;
                    const { error: uploadError } = await supabase.storage
                        .from('project-files')
                        .upload(filePath, file);
                    if (uploadError) throw uploadError;

                    const { data, error: signedUrlError } = await supabase.storage
                        .from('project-files')
                        .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 10);
                    if (signedUrlError || !data?.signedUrl) throw signedUrlError;

                    return data.signedUrl;
                })
            );

            setPendingImages(prev => [...prev, ...urls]);
        } catch (error) {
            console.error("Error uploading image:", error);
            alert("Failed to upload image. Please try again.");
        } finally {
            setUploadingImage(false);
            if (imageInputRef.current) {
                imageInputRef.current.value = "";
            }
        }
    };

    const handleRemoveImage = (index: number) => {
        setPendingImages(prev => prev.filter((_, i) => i !== index));
    };

    const processDocuments = async (files: File[]) => {
        if (files.length === 0) return;
        setUploadingFile(true);
        try {
            const newDocs: { name: string, url: string, extractedContent: string }[] = [];
            for (const file of files) {
                const filePath = `chat/temp_${project.id}/${Date.now()}_${file.name}`;

                const { error: uploadError } = await supabase.storage
                    .from("project-files")
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                let extractedContent = "";
                try {
                    extractedContent = await extractFileContent(file);
                } catch (extractError) {
                    console.warn("Content extraction failed for project chat upload:", extractError);
                }

                if (project.id) {
                    await addDocument(project.id, file.name, filePath, extractedContent || undefined);
                }

                const { data: { publicUrl } } = supabase.storage
                    .from("project-files")
                    .getPublicUrl(filePath);

                newDocs.push({
                    name: file.name,
                    url: publicUrl,
                    extractedContent: extractedContent
                });
            }
            setPendingDocuments(prev => [...prev, ...newDocs]);
        } catch (error: any) {
            console.error("Upload failed", error);
            alert("Upload failed: " + error.message);
        } finally {
            setUploadingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        await processDocuments(Array.from(e.target.files));
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        const imageFiles: File[] = [];
        const docFiles: File[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            } else if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) docFiles.push(file);
            }
        }

        if (imageFiles.length > 0) {
            await handleImageUpload({ target: { files: imageFiles } } as any);
        }
        if (docFiles.length > 0) {
            await processDocuments(docFiles);
        }
    };

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const [models, allowed, role] = await Promise.all([
                    getActiveModels(),
                    getUserAllowedModels(user.id),
                    getCurrentUserRole()
                ]);

                // Filter based on access
                const filtered = models.filter(m =>
                    m.is_available_to_all || allowed.includes(m.id)
                );

                setAvailableModels(filtered);
                if (filtered.length > 0) {
                    // Try to restore previous choice, otherwise first available
                    const savedModelId = sessionStorage.getItem('last_used_model');
                    const savedModel = filtered.find(m => m.id === savedModelId);
                    setSelectedModel(savedModel || filtered[0]);
                }
            } catch (error) {
                console.error("Error fetching models:", error);
            }
        };

        fetchModels();
    }, [supabase]);

    const handleNewChat = async (initialMessage?: string) => {
        try {
            const { createNewChat } = await import("@/lib/actions/chat");
            const result = await createNewChat(project.id);

            if (result.id) {
                // Store initial message and model so the chat page can auto-send it
                if (initialMessage) {
                    sessionStorage.setItem(`chat_initial_${result.id}`, initialMessage);
                }
                if (pendingImages.length > 0) {
                    sessionStorage.setItem(`chat_initial_images_${result.id}`, JSON.stringify(pendingImages));
                }
                if (selectedModel) {
                    sessionStorage.setItem(`chat_model_${result.id}`, selectedModel.id);
                    sessionStorage.setItem('last_used_model', selectedModel.id);
                }
                router.push(`/projects/${project.id}/chat/${result.id}`);
            }
        } catch (err) {
            console.error("Error creating chat:", err);
        }
    };

    const handleSubmitNewChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() && pendingImages.length === 0 && pendingDocuments.length === 0) return;

        let msg = inputValue;
        if (pendingDocuments.length > 0) {
            const docMessages = pendingDocuments.map(doc =>
                `[File Uploaded: ${doc.name}](${doc.url})${doc.extractedContent ? "\n\n*File content has been indexed and added to chat context.*" : ""}`
            ).join('\n\n');
            msg = docMessages + (msg ? '\n\n' + msg : '');
            setPendingDocuments([]);
        }

        await handleNewChat(msg);
    };

    const handleCloneProject = async () => {
        if (cloning) return;
        setCloning(true);
        try {
            const { cloneProject } = await import("@/lib/actions/projects");
            const result = await cloneProject(project.id);
            if (result.error) {
                alert(`Clone failed: ${result.error}`);
            } else if (result.newProjectId) {
                router.push(`/projects/${result.newProjectId}`);
            }
        } catch (err) {
            console.error("Error cloning project:", err);
            alert("Failed to clone project.");
        } finally {
            setCloning(false);
        }
    };

    const handleRenameProject = async () => {
        if (!isOwner) return; // Only owner
        const newName = prompt("Enter new project name:", projectName);
        if (!newName || newName.trim() === projectName) return;
        try {
            const { renameProject } = await import("@/lib/actions/projects");
            const result = await renameProject(project.id, newName.trim());
            if (result.error) {
                alert(`Rename failed: ${result.error}`);
            } else {
                setProjectName(newName.trim());
                router.refresh();
            }
        } catch (err) {
            console.error("Error renaming project:", err);
            alert("Failed to rename project.");
        }
    };

    // Removed handleSelectChat
    // Removed handleBackToList

    return (
        <div className="flex flex-col w-full max-w-screen-xl mx-auto px-4 py-6">
            {/* Back Link */}
            <div className="mb-6">
                <Link href="/projects" className="text-sm text-muted-foreground flex items-center hover:text-foreground transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    All projects
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                {/* Main Content (Left) */}
                <div className="lg:col-span-2">
                    {/* Project Overview — Chat list + new chat input */}
                    <div className="space-y-8">
                        {/* Header Section */}
                        <div className="space-y-4">
                            <div className="flex items-start justify-between">
                                <h1 className="text-3xl md:text-4xl font-serif font-medium tracking-tight text-foreground">
                                    {projectName}
                                </h1>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal className="h-5 w-5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                            {isOwner && (
                                                <DropdownMenuItem onClick={handleRenameProject}>
                                                    <Pencil className="mr-2 h-4 w-4" />
                                                    Rename
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={handleCloneProject} disabled={cloning}>
                                                {cloning ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Copy className="mr-2 h-4 w-4" />
                                                )}
                                                {cloning ? "Cloning..." : "Clone Project"}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <Button variant="ghost" size="icon">
                                        <Star className="h-5 w-5" />
                                    </Button>
                                </div>
                            </div>
                            <p className="text-lg text-muted-foreground/90 leading-relaxed">
                                {project.description || "No description provided."}
                            </p>
                            <div className="flex items-center gap-2">
                                <VisibilityToggle
                                    projectId={project.id}
                                    initialVisibility={project.visibility || 'private'}
                                    canEdit={isOwner}
                                />
                                <ProjectAccessManager
                                    projectId={project.id}
                                    canEdit={canManageAccess}
                                />
                            </div>
                            <TagManager
                                projectId={project.id}
                                canEdit={canEdit}
                                initialTags={initialTags}
                            />
                        </div>

                        {/* Chat Input */}
                        <form onSubmit={handleSubmitNewChat} className="w-full">
                            <div className="relative group cursor-text">
                                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent rounded-3xl -z-10 opacity-50" />
                                <div className="flex flex-col justify-between w-full rounded-3xl border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
                                    {(pendingImages.length > 0 || pendingDocuments.length > 0) && (
                                        <div className="flex flex-wrap gap-2 mb-2 px-2 items-start">
                                            {pendingImages.map((url, i) => (
                                                <div key={i} className="relative group/img">
                                                    <img src={url} alt="Attached" className="h-16 w-16 object-cover rounded-xl border border-border bg-background" />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveImage(i)}
                                                        className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 shadow-sm opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {pendingDocuments.map((doc, idx) => (
                                                <div key={`doc-${idx}`} className="relative group/doc bg-background/50 border border-border/50 rounded-xl shadow-sm p-3 w-36 h-16 flex flex-col items-center justify-center text-center">
                                                    <FileIcon className="h-5 w-5 text-primary/70 mb-1" />
                                                    <span className="text-[10px] font-medium text-foreground truncate w-full" title={doc.name}>{doc.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPendingDocuments(prev => prev.filter((_, i) => i !== idx))}
                                                        className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 shadow-sm opacity-0 group-hover/doc:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <textarea
                                        className={`w-full bg-transparent border-none resize-none p-2 text-lg placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 ${(pendingImages.length > 0 || pendingDocuments.length > 0) ? "min-h-[64px]" : "min-h-[80px]"}`}
                                        placeholder="Start a new chat..."
                                        value={inputValue}
                                        onPaste={handlePaste}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSubmitNewChat(e);
                                            }
                                        }}
                                    />
                                    <div className="flex items-center justify-between px-2">
                                        <div>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                className="hidden"
                                                accept=".pdf,.csv,.xls,.xlsx,.xlsm,.txt,.doc,.docx,.md"
                                                onChange={handleFileUpload}
                                                multiple
                                            />
                                            <input
                                                ref={imageInputRef}
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                multiple
                                                onChange={handleImageUpload}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                type="button"
                                                className="text-muted-foreground hover:text-foreground relative"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={uploadingFile}
                                                title="Attach Document"
                                            >
                                                <Paperclip className={`h-5 w-5 ${uploadingFile ? "opacity-50" : ""}`} />
                                                {uploadingFile && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                                                    </span>
                                                )}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                type="button"
                                                className="text-muted-foreground hover:text-foreground relative"
                                                onClick={() => imageInputRef.current?.click()}
                                                disabled={uploadingImage}
                                                title="Attach Image"
                                            >
                                                <ImageIcon className={`h-5 w-5 ${uploadingImage ? "opacity-50" : ""}`} />
                                                {uploadingImage && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                                                    </span>
                                                )}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        type="button"
                                                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 rounded-lg"
                                                    >
                                                        {selectedModel ? selectedModel.name : "Loading Models..."}
                                                        <ChevronDown className="h-3 w-3 opacity-50" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                {availableModels.length > 0 && (
                                                    <DropdownMenuContent align="end" className="min-w-[160px]">
                                                        {availableModels.map((m) => (
                                                            <DropdownMenuItem
                                                                key={m.id}
                                                                onClick={() => setSelectedModel(m)}
                                                                className={selectedModel?.id === m.id ? "bg-accent" : ""}
                                                            >
                                                                {m.name}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                )}
                                            </DropdownMenu>
                                            <Button
                                                type="submit"
                                                size="icon"
                                                className="rounded-full h-10 w-10 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                                                disabled={(!inputValue.trim() && pendingImages.length === 0 && pendingDocuments.length === 0) || uploadingImage || uploadingFile}
                                            >
                                                <ArrowUp className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>

                        {/* Recent Chats / ABM Runs */}
                        {isAbmProject ? (
                            (() => {
                                // Chats that have at least one ABM run -- those are surfaced
                                // as cards above. Everything else renders below as a normal list.
                                const chatsWithRuns = new Set(
                                    initialAbmRuns
                                        .map((r) => r.chat?.id)
                                        .filter((id): id is string => !!id)
                                );
                                const otherChats = chats.filter((c) => !chatsWithRuns.has(c.id));

                                const formatDate = (iso: string) =>
                                    new Date(iso).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                    });

                                const truncateCampaign = (id: string) =>
                                    id.length > 20 ? id.slice(0, 20) + "…" : id;

                                const filterTerm = runsFilter.trim().toLowerCase();
                                const filteredRuns = filterTerm
                                    ? initialAbmRuns.filter((r) => {
                                          const haystack = [
                                              r.account_name,
                                              r.account_id,
                                              r.campaign_id,
                                          ]
                                              .filter(Boolean)
                                              .join(" ")
                                              .toLowerCase();
                                          return haystack.includes(filterTerm);
                                      })
                                    : initialAbmRuns;

                                return (
                                    <div className="space-y-8 pt-4">
                                        {/* ABM Runs */}
                                        <div>
                                            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                                                <h2 className="text-sm font-medium text-muted-foreground">
                                                    ABM Runs
                                                    {initialAbmRuns.length > 0 && (
                                                        <span className="ml-2 text-xs text-muted-foreground/70">
                                                            {filterTerm
                                                                ? `(${filteredRuns.length} of ${initialAbmRuns.length})`
                                                                : `(${initialAbmRuns.length})`}
                                                        </span>
                                                    )}
                                                </h2>
                                                {initialAbmRuns.length > 0 && (
                                                    <div className="relative w-full sm:w-64">
                                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                                        <input
                                                            type="text"
                                                            value={runsFilter}
                                                            onChange={(e) => setRunsFilter(e.target.value)}
                                                            placeholder="Search account, ID, or campaign..."
                                                            className="w-full text-sm bg-background border border-border/60 rounded-md pl-8 pr-7 py-1.5 placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
                                                        />
                                                        {runsFilter && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setRunsFilter("")}
                                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                                                                aria-label="Clear search"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {initialAbmRuns.length > 0 && filteredRuns.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-border/60 rounded-lg">
                                                    <p className="text-muted-foreground text-sm">
                                                        No runs match "{runsFilter.trim()}".
                                                    </p>
                                                </div>
                                            ) : initialAbmRuns.length > 0 ? (
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {filteredRuns.map((run) => {
                                                        const chatId = run.chat?.id;
                                                        const cardKey = `${chatId ?? "orphan"}-${run.seq}-${run.account_id}`;
                                                        const palette = pickAbmCardPalette(run.account_id);

                                                        // Status pill: Completed > Unknown (heuristic backfill) > Running.
                                                        // Unknown is for backfilled rows where completion was never confirmed.
                                                        let statusLabel = "Running";
                                                        let statusPillClass = "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
                                                        if (run.completed_at) {
                                                            statusLabel = "Completed";
                                                            statusPillClass = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
                                                        } else if (run.source === "heuristic") {
                                                            statusLabel = "Unknown";
                                                            statusPillClass = "bg-muted text-muted-foreground border-border";
                                                        }

                                                        const cardInner = (
                                                            <>
                                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                                    <span className={`text-xs font-medium ${palette.accent}`}>
                                                                        Run #{run.seq}
                                                                    </span>
                                                                    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border ${statusPillClass}`}>
                                                                        {statusLabel}
                                                                    </span>
                                                                </div>
                                                                {run.account_name ? (
                                                                    <>
                                                                        <h3
                                                                            className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate"
                                                                            title={run.account_name}
                                                                        >
                                                                            {run.account_name}
                                                                        </h3>
                                                                        <p
                                                                            className="font-mono text-[11px] text-muted-foreground mt-0.5 truncate"
                                                                            title={run.account_id}
                                                                        >
                                                                            {run.account_id}
                                                                        </p>
                                                                    </>
                                                                ) : (
                                                                    <h3
                                                                        className="font-mono text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate"
                                                                        title={run.account_id}
                                                                    >
                                                                        {run.account_id}
                                                                    </h3>
                                                                )}
                                                                <p className="text-xs text-muted-foreground mt-1">
                                                                    {formatDate(run.started_at)}
                                                                </p>
                                                                {run.pushed_count != null && (
                                                                    <p className="text-xs text-muted-foreground mt-1">
                                                                        {run.pushed_count} {run.pushed_count === 1 ? "lead" : "leads"} pushed
                                                                    </p>
                                                                )}
                                                                {run.campaign_id && (
                                                                    <span
                                                                        className="inline-block mt-2 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                                                                        title={run.campaign_id}
                                                                    >
                                                                        {truncateCampaign(run.campaign_id)}
                                                                    </span>
                                                                )}
                                                            </>
                                                        );

                                                        return chatId ? (
                                                            <Link
                                                                key={cardKey}
                                                                href={`/projects/${project.id}/chat/${chatId}`}
                                                                className={`group block rounded-lg border ${palette.border} ${palette.bg} p-4 hover:brightness-105 dark:hover:brightness-125 hover:shadow-sm transition-all`}
                                                            >
                                                                {cardInner}
                                                            </Link>
                                                        ) : (
                                                            <div
                                                                key={cardKey}
                                                                className={`block rounded-lg border ${palette.border} ${palette.bg} p-4 opacity-60`}
                                                            >
                                                                {cardInner}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="text-center py-12 border border-dashed border-border/60 rounded-lg">
                                                    <p className="text-muted-foreground text-sm">
                                                        No ABM runs yet — start one from the input above.
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Other conversations (chats with no ABM runs attached) */}
                                        {otherChats.length > 0 && (
                                            <div>
                                                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                                                    Other conversations
                                                    <span className="ml-2 text-xs text-muted-foreground/70">
                                                        ({otherChats.length})
                                                    </span>
                                                </h2>
                                                <div className="space-y-2">
                                                    {otherChats.map((chat) => (
                                                        <Link
                                                            key={chat.id}
                                                            href={`/projects/${project.id}/chat/${chat.id}`}
                                                            className="block w-full text-left group"
                                                        >
                                                            <div className="flex items-center gap-3 py-4 border-b border-border/50 group-hover:bg-accent/30 rounded-lg px-4 transition-all">
                                                                <MessageSquare className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                                <div className="flex flex-col gap-1 min-w-0">
                                                                    <h3 className="font-medium text-lg group-hover:text-primary transition-colors truncate">
                                                                        {chat.title || "Untitled Conversation"}
                                                                    </h3>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {new Date(chat.created_at).toLocaleDateString()}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()
                        ) : isDiagnosisProject ? (
                            (() => {
                                // Mirror the ABM-cards pattern for Opportunity Diagnosis projects.
                                // One card per row in lake.opportunity_diagnoses, ordered newest first.
                                const formatDate = (iso: string) =>
                                    new Date(iso).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                    });

                                // Pill class for momentum_verdict and health_rating. Same colour
                                // semantics across both: emerald = good, amber = neutral, rose = bad.
                                const pillFor = (value: string | null): string => {
                                    if (value === "accelerating" || value === "high") {
                                        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
                                    }
                                    if (value === "drifting" || value === "medium") {
                                        return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
                                    }
                                    if (value === "stalling" || value === "low") {
                                        return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
                                    }
                                    return "bg-muted text-muted-foreground border-border";
                                };

                                const filterTerm = runsFilter.trim().toLowerCase();
                                const filteredDiagnoses = filterTerm
                                    ? initialDiagnoses.filter((d) => {
                                          const haystack = [
                                              d.account_name,
                                              d.account_id,
                                              d.opportunity_name,
                                              d.opportunity_id,
                                              d.stage,
                                              d.owner_name,
                                          ]
                                              .filter(Boolean)
                                              .join(" ")
                                              .toLowerCase();
                                          return haystack.includes(filterTerm);
                                      })
                                    : initialDiagnoses;

                                // Chats that have at least one diagnosis row -- surfaced as cards above.
                                // Everything else renders below as the regular chat list.
                                const chatsWithDiagnoses = new Set(
                                    initialDiagnoses.map((d) => d.chat_id)
                                );
                                const otherChats = chats.filter((c) => !chatsWithDiagnoses.has(c.id));

                                return (
                                    <div className="space-y-8 pt-4">
                                        <div>
                                            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                                                <h2 className="text-sm font-medium text-muted-foreground">
                                                    Opportunity Diagnoses
                                                    {initialDiagnoses.length > 0 && (
                                                        <span className="ml-2 text-xs text-muted-foreground/70">
                                                            {filterTerm
                                                                ? `(${filteredDiagnoses.length} of ${initialDiagnoses.length})`
                                                                : `(${initialDiagnoses.length})`}
                                                        </span>
                                                    )}
                                                </h2>
                                                {initialDiagnoses.length > 0 && (
                                                    <div className="relative w-full sm:w-64">
                                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                                        <input
                                                            type="text"
                                                            value={runsFilter}
                                                            onChange={(e) => setRunsFilter(e.target.value)}
                                                            placeholder="Search account, opp, stage..."
                                                            className="w-full text-sm bg-background border border-border/60 rounded-md pl-8 pr-7 py-1.5 placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
                                                        />
                                                        {runsFilter && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setRunsFilter("")}
                                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                                                                aria-label="Clear search"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {filteredDiagnoses.length === 0 ? (
                                                <div className="text-center py-12 border border-dashed border-border/60 rounded-lg">
                                                    <p className="text-muted-foreground text-sm">
                                                        No diagnoses match "{runsFilter.trim()}".
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {filteredDiagnoses.map((d) => {
                                                        const cardKey = `${d.chat_id}-${d.run_at}`;
                                                        const seedForPalette = d.account_id || d.opportunity_id || d.chat_id;
                                                        const palette = pickAbmCardPalette(seedForPalette);

                                                        // Heading priority: account_name > account_id > opportunity_name >
                                                        // generic literal. The opp_name fallback matters because some chats
                                                        // resolved opp data but never did a SOQL Account lookup, so account_*
                                                        // is null while opportunity_name is populated.
                                                        const heading =
                                                            d.account_name ||
                                                            d.account_id ||
                                                            d.opportunity_name ||
                                                            "Opportunity Diagnosis";
                                                        const showRawIdSubtitle = !!d.account_name && !!d.account_id;
                                                        // Don't repeat the heading line as a subtitle when opp_name was used as the heading.
                                                        const showOppSubtitle = !!d.opportunity_name && d.opportunity_name !== heading;

                                                        return (
                                                            <Link
                                                                key={cardKey}
                                                                href={`/projects/${project.id}/chat/${d.chat_id}`}
                                                                className={`group block rounded-lg border ${palette.border} ${palette.bg} p-4 hover:brightness-105 dark:hover:brightness-125 hover:shadow-sm transition-all`}
                                                            >
                                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                    {d.momentum_verdict && (
                                                                        <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border ${pillFor(d.momentum_verdict)}`}>
                                                                            {d.momentum_verdict}
                                                                        </span>
                                                                    )}
                                                                    {d.health_rating && (
                                                                        <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border ${pillFor(d.health_rating)}`}>
                                                                            health: {d.health_rating}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <h3
                                                                    className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate"
                                                                    title={heading}
                                                                >
                                                                    {heading}
                                                                </h3>
                                                                {showRawIdSubtitle && (
                                                                    <p className="font-mono text-[11px] text-muted-foreground mt-0.5 truncate" title={d.account_id ?? undefined}>
                                                                        {d.account_id}
                                                                    </p>
                                                                )}
                                                                {showOppSubtitle && (
                                                                    <p className="text-xs text-muted-foreground mt-1 truncate" title={d.opportunity_name ?? undefined}>
                                                                        {d.opportunity_name}
                                                                    </p>
                                                                )}
                                                                {d.stage && (
                                                                    <p className="text-[11px] text-muted-foreground/80 mt-1 truncate">
                                                                        {d.stage}
                                                                    </p>
                                                                )}
                                                                <p className="text-xs text-muted-foreground mt-2">
                                                                    {formatDate(d.run_at)}
                                                                </p>
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {otherChats.length > 0 && (
                                            <div>
                                                <h2 className="text-sm font-medium text-muted-foreground mb-3">
                                                    Other conversations
                                                    <span className="ml-2 text-xs text-muted-foreground/70">
                                                        ({otherChats.length})
                                                    </span>
                                                </h2>
                                                <div className="space-y-2">
                                                    {otherChats.map((chat) => (
                                                        <Link
                                                            key={chat.id}
                                                            href={`/projects/${project.id}/chat/${chat.id}`}
                                                            className="block w-full text-left group"
                                                        >
                                                            <div className="flex items-center gap-3 py-4 border-b border-border/50 group-hover:bg-accent/30 rounded-lg px-4 transition-all">
                                                                <MessageSquare className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                                <div className="flex flex-col gap-1 min-w-0">
                                                                    <h3 className="font-medium text-lg group-hover:text-primary transition-colors truncate">
                                                                        {chat.title || "Untitled Conversation"}
                                                                    </h3>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {new Date(chat.created_at).toLocaleDateString()}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()
                        ) : (
                            <div className="space-y-4 pt-4">
                                {chats && chats.length > 0 ? (
                                    <div className="space-y-2">
                                        {chats.map((chat) => (
                                            <Link
                                                key={chat.id}
                                                href={`/projects/${project.id}/chat/${chat.id}`}
                                                className="block w-full text-left group"
                                            >
                                                <div className="flex items-center gap-3 py-4 border-b border-border/50 group-hover:bg-accent/30 rounded-lg px-4 transition-all">
                                                    <MessageSquare className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                    <div className="flex flex-col gap-1 min-w-0">
                                                        <h3 className="font-medium text-lg group-hover:text-primary transition-colors truncate">
                                                            {chat.title || "Untitled Conversation"}
                                                        </h3>
                                                        <p className="text-sm text-muted-foreground">
                                                            {new Date(chat.created_at).toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-12">
                                        <p className="text-muted-foreground">No conversations yet.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar (Col Span 1) */}
                <div className="space-y-8">
                    {/* Memory Section */}
                    <div className="p-1">
                        <h3 className="font-medium mb-4 flex items-center justify-between">
                            Memory
                            {isOwner ? (
                                <span className="text-[10px] bg-secondary px-2 py-0.5 rounded text-muted-foreground border">Only you</span>
                            ) : null}
                        </h3>
                        <div className="text-sm text-muted-foreground">
                            <MemoryManager projectId={project.id} memories={initialMemories} canEdit={canEdit} />
                        </div>
                    </div>

                    {/* Instructions Section */}
                    <div className="p-1">
                        <SystemPromptCard projectId={project.id} initialPrompt={project.system_prompt} canEdit={canEdit} initialVersions={initialVersions} />
                    </div>

                    {/* Files Section */}
                    <div className="p-1">
                        <ProjectFiles projectId={project.id} initialFiles={initialDocuments} canEdit={canEdit} />
                    </div>
                </div>
            </div>
        </div>
    );
}
