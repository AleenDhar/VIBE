"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, MoreHorizontal, Star, Plus, ArrowUp, ArrowDown, MessageSquare, ChevronDown, Paperclip, Image as ImageIcon, X } from "lucide-react";
import Link from "next/link";
import { SystemPromptCard } from "@/components/projects/SystemPromptCard";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { MemoryManager } from "@/components/projects/MemoryManager";
import { VisibilityToggle } from "@/components/projects/VisibilityToggle";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { createClient } from "@/lib/supabase/client";
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

interface Chat {
    id: string;
    title: string;
    created_at: string;
}

interface ProjectPageClientProps {
    project: any;
    isOwner: boolean;
    initialChats: Chat[];
    initialDocuments: any[];
    initialMemories: any[];
}

export function ProjectPageClient({
    project,
    isOwner,
    initialChats,
    initialDocuments,
    initialMemories,
}: ProjectPageClientProps) {
    const router = useRouter();
    const supabase = createClient();
    // const [activeChatId, setActiveChatId] = useState<string | null>(null); // Removed
    // const [chatMessages, setChatMessages] = useState<any[]>([]); // Removed
    const [chats, setChats] = useState<Chat[]>(initialChats);
    // const [loadingChat, setLoadingChat] = useState(false); // Removed
    const [inputValue, setInputValue] = useState("");
    const [selectedModel, setSelectedModel] = useState(MODELS[0]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [uploadingImage, setUploadingImage] = useState(false);

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

    // Removed useEffect for loading messages

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
                sessionStorage.setItem(`chat_model_${result.id}`, selectedModel.id);
                router.push(`/projects/${project.id}/chat/${result.id}`);
            }
        } catch (err) {
            console.error("Error creating chat:", err);
        }
    };

    const handleSubmitNewChat = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() && pendingImages.length === 0) return;
        const msg = inputValue;
        // create chat and redirect
        // For passing the initial message, we might need to handle it differently if we redirect immediately.
        // For now, let's just create the chat and let the user type there or pass it via URL query param if supported?
        // The original code passed `initialInput` to ChatInterface.
        // Since we are redirecting, we can't easily pass state. 
        // We could create the chat, adding the message? 
        // actions/chat/createNewChat might need to support an initial message, or we add it after creation.

        // Let's check createNewChat in lib/actions/chat.ts to see if it accepts a message.
        // I will assume for now we just redirect. If we want to capture the input, we can do it.

        await handleNewChat(msg);
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
                                    {project.name}
                                </h1>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Button variant="ghost" size="icon">
                                        <MoreHorizontal className="h-5 w-5" />
                                    </Button>
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
                            </div>
                        </div>

                        {/* Chat Input */}
                        <form onSubmit={handleSubmitNewChat} className="w-full">
                            <div className="relative group cursor-text">
                                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent rounded-3xl -z-10 opacity-50" />
                                <div className="flex flex-col justify-between w-full rounded-3xl border bg-card/50 backdrop-blur-sm p-4 shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
                                    {pendingImages.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2 px-2">
                                            {pendingImages.map((url, i) => (
                                                <div key={i} className="relative group/img">
                                                    <img src={url} alt="Attached" className="h-16 w-16 object-cover rounded-xl border border-border" />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveImage(i)}
                                                        className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 shadow-sm opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <textarea
                                        className={`w-full bg-transparent border-none resize-none p-2 text-lg placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 ${pendingImages.length > 0 ? "min-h-[64px]" : "min-h-[80px]"}`}
                                        placeholder="Start a new chat..."
                                        value={inputValue}
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
                                                accept=".pdf,.csv,.xls,.xlsx,.xlsm,.txt,.doc,.docx,.json,.md"
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
                                                className="text-muted-foreground hover:text-foreground"
                                                onClick={() => fileInputRef.current?.click()}
                                                title="Attach Document"
                                            >
                                                <Paperclip className="h-5 w-5" />
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
                                            <Button
                                                type="submit"
                                                size="icon"
                                                className="rounded-full h-10 w-10 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                                                disabled={(!inputValue.trim() && pendingImages.length === 0) || uploadingImage}
                                            >
                                                <ArrowUp className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>

                        {/* Recent Chats List */}
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
                    </div>
                </div>

                {/* Right Sidebar (Col Span 1) */}
                <div className="space-y-8">
                    {/* Memory Section */}
                    <div className="p-1">
                        <h3 className="font-medium mb-4 flex items-center justify-between">
                            Memory
                            <span className="text-[10px] bg-secondary px-2 py-0.5 rounded text-muted-foreground border">Only you</span>
                        </h3>
                        <div className="text-sm text-muted-foreground">
                            <MemoryManager projectId={project.id} memories={initialMemories} />
                        </div>
                    </div>

                    {/* Instructions Section */}
                    <div className="p-1">
                        <SystemPromptCard projectId={project.id} initialPrompt={project.system_prompt} />
                    </div>

                    {/* Files Section */}
                    <div className="p-1">
                        <ProjectFiles projectId={project.id} initialFiles={initialDocuments} />
                    </div>
                </div>
            </div>
        </div>
    );
}
