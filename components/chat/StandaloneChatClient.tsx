"use client";

import { useEffect, useState, useRef } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";

interface PhaseBoundary {
    position: number;
    name: string | null;
    model_id: string | null;
    after_ms: number;
}

interface StandaloneChatClientProps {
    projectId: string | null;
    chatId: string;
    initialMessages: any[];
    automationTaskId?: string | null;
    phaseBoundaries?: PhaseBoundary[];
}

export function StandaloneChatClient({ projectId, chatId, initialMessages, automationTaskId, phaseBoundaries }: StandaloneChatClientProps) {
    const [initialInput, setInitialInput] = useState<string | undefined>(undefined);
    const [initialModel, setInitialModel] = useState<string | undefined>(undefined);
    const [initialImages, setInitialImages] = useState<string[] | undefined>(undefined);
    const checkedRef = useRef(false);

    useEffect(() => {
        if (checkedRef.current) return;
        checkedRef.current = true;

        // Check if there's a pending initial message from the chat home page
        const msgKey = `chat_initial_${chatId}`;
        const modelKey = `chat_model_${chatId}`;
        const imagesKey = `chat_initial_images_${chatId}`;
        const stored = sessionStorage.getItem(msgKey);
        const storedModel = sessionStorage.getItem(modelKey);
        const storedImages = sessionStorage.getItem(imagesKey);

        if (stored) {
            setInitialInput(stored);
            sessionStorage.removeItem(msgKey);
        }
        if (storedModel) {
            setInitialModel(storedModel);
            sessionStorage.removeItem(modelKey);
        }
        if (storedImages) {
            try {
                setInitialImages(JSON.parse(storedImages));
            } catch (e) {
                console.error("Failed to parse initial images", e);
            }
            sessionStorage.removeItem(imagesKey);
        }
    }, [chatId]);

    return (
        <ChatInterface
            projectId={projectId}
            chatId={chatId}
            initialMessages={initialMessages}
            initialInput={initialInput}
            initialModel={initialModel}
            initialImages={initialImages}
            automationTaskId={automationTaskId}
            phaseBoundaries={phaseBoundaries}
        />
    );
}
