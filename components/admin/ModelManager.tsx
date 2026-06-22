"use client";

import { useState, useEffect, useCallback } from "react";
import { getActiveModels } from "@/lib/actions/models";
import { updateModelAvailability, getAllModelsForAdmin, updateModelActive } from "@/lib/actions/admin";
import { Loader2 } from "lucide-react";

interface ManagedModel {
    id: string;
    name: string;
    provider: string;
    is_available_to_all: boolean;
    is_active: boolean;
}

export function ModelManager({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
    const [models, setModels] = useState<ManagedModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const fetchModels = useCallback(async () => {
        try {
            if (isSuperAdmin) {
                // Super admins manage the full catalog, including inactive
                // (pre-staged) rows like the Fireworks models awaiting account access.
                const data = await getAllModelsForAdmin();
                setModels(data);
            } else {
                // Plain admins see only active models, and never the Fireworks
                // sandbox — that's a super-admin-only surface.
                const data = await getActiveModels();
                setModels(data.filter(m => m.provider !== "fireworks"));
            }
        } catch (error) {
            console.error("Failed to fetch models", error);
        } finally {
            setIsLoading(false);
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        fetchModels();
    }, [fetchModels]);

    const toggleAvailability = async (m: ManagedModel) => {
        setUpdatingId(m.id);
        try {
            // Preserve is_active; only flip availability.
            const result = await updateModelAvailability(m.id, !m.is_available_to_all, m.is_active);
            if (result.success) await fetchModels();
            else alert("Failed to update availability: " + result.error);
        } catch (error) {
            console.error("Error toggling availability:", error);
            alert("An error occurred while updating.");
        } finally {
            setUpdatingId(null);
        }
    };

    const toggleActive = async (m: ManagedModel) => {
        setUpdatingId(m.id);
        try {
            const result = await updateModelActive(m.id, !m.is_active);
            if (result.success) await fetchModels();
            else alert("Failed to update status: " + result.error);
        } catch (error) {
            console.error("Error toggling active:", error);
            alert("An error occurred while updating.");
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">AI Models Integration</h2>
                {isSuperAdmin && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium border border-amber-200">
                        Super Admin · full catalog
                    </span>
                )}
            </div>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading models...</p>
            ) : (
                <div className="rounded-md border">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted text-muted-foreground text-xs uppercase">
                            <tr>
                                <th className="px-4 py-3 font-medium">Model Name</th>
                                <th className="px-4 py-3 font-medium">ID / Provider</th>
                                <th className="px-4 py-3 font-medium">
                                    Availability <span className="text-[10px] normal-case font-normal text-muted-foreground ml-1">(Click to toggle)</span>
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Status{isSuperAdmin && <span className="text-[10px] normal-case font-normal text-muted-foreground ml-1">(Click to toggle)</span>}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {models.map((model) => {
                                const isFireworks = model.provider === "fireworks";
                                return (
                                    <tr key={model.id} className={`bg-card hover:bg-muted/50 transition-colors ${isFireworks ? "bg-amber-50/40" : ""}`}>
                                        <td className="px-4 py-3 font-medium">
                                            {isFireworks && <span className="mr-1">⚡</span>}
                                            {model.name}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-1">
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded w-max">{model.id}</code>
                                                <span className="text-xs text-muted-foreground capitalize">{model.provider}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleAvailability(model)}
                                                disabled={updatingId === model.id}
                                                className="focus:outline-none transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                                            >
                                                {updatingId === model.id ? (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium flex items-center gap-1 border border-border">
                                                        <Loader2 className="h-3 w-3 animate-spin" /> Updating...
                                                    </span>
                                                ) : model.is_available_to_all ? (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium hover:bg-green-200 border border-green-200 cursor-pointer">
                                                        Available to All
                                                    </span>
                                                ) : (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 border border-amber-200 cursor-pointer">
                                                        {isFireworks ? "Super Admin only" : "Restricted"}
                                                    </span>
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            {isSuperAdmin ? (
                                                <button
                                                    onClick={() => toggleActive(model)}
                                                    disabled={updatingId === model.id}
                                                    className="focus:outline-none transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    title="Toggle whether this model is selectable in chat"
                                                >
                                                    {model.is_active ? (
                                                        <span className="text-xs text-emerald-600 flex items-center gap-1">
                                                            <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Active
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                            <span className="h-2 w-2 rounded-full bg-muted-foreground"></span> Inactive
                                                        </span>
                                                    )}
                                                </button>
                                            ) : model.is_active ? (
                                                <span className="text-xs text-emerald-600 flex items-center gap-1">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Active
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <span className="h-2 w-2 rounded-full bg-muted-foreground"></span> Inactive
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {models.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                                        No models found in database. Please run the database migration.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
                {isSuperAdmin
                    ? "Toggle Status to make a pre-staged model (e.g. Fireworks ⚡) selectable in chat. Fireworks models are visible only to super admins in the chat picker."
                    : "Models are managed via the database. To add new models, insert them into the ai_models table."}
            </p>
        </div>
    );
}
