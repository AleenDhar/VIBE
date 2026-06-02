"use client";

// Local registry of Jarvis conversations, scoped per user. Jarvis chat_ids are
// generated client-side and there is no backend "list my Jarvis chats" endpoint,
// so we remember them here (per browser) keyed by user id. Each entry points at
// /analysis/jarvis?chat=<id> to resume (messages load from chat_messages).

export interface JarvisChatEntry {
    id: string;
    title: string;
    ts: number;
}

function key(userId: string) {
    return `jarvis:history:${userId}`;
}

export function getJarvisHistory(userId: string): JarvisChatEntry[] {
    try {
        const raw = localStorage.getItem(key(userId));
        const list = raw ? (JSON.parse(raw) as JarvisChatEntry[]) : [];
        return Array.isArray(list) ? list.sort((a, b) => b.ts - a.ts) : [];
    } catch {
        return [];
    }
}

export function addJarvisChat(userId: string, entry: JarvisChatEntry): void {
    if (!userId) return;
    try {
        const list = getJarvisHistory(userId).filter((e) => e.id !== entry.id);
        list.unshift(entry);
        localStorage.setItem(key(userId), JSON.stringify(list.slice(0, 100)));
    } catch {
        /* ignore */
    }
}

export function removeJarvisChat(userId: string, id: string): void {
    try {
        const list = getJarvisHistory(userId).filter((e) => e.id !== id);
        localStorage.setItem(key(userId), JSON.stringify(list));
    } catch {
        /* ignore */
    }
}
