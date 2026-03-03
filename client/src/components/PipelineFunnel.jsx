import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useUpdateLeadStatus } from "@/hooks/useLeads";
import { useNavigate } from "react-router-dom";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 10;

const STAGES = [
    { id: 'new', label: 'New', color: 'bg-blue-500' },
    { id: 'contacted', label: 'Contacted', color: 'bg-indigo-500' },
    { id: 'quoted', label: 'Quoted', color: 'bg-orange-500' },
    { id: 'accepted', label: 'Accepted', color: 'bg-green-500' },
    { id: 'scheduled', label: 'Service Scheduled', color: 'bg-purple-500' },
];

export default function PipelineFunnel({ leads }) {
    const { mutate: updateStatus } = useUpdateLeadStatus();
    const navigate = useNavigate();
    const [draggingId, setDraggingId] = useState(null);
    const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

    const handleDragStart = (e, leadId) => {
        e.dataTransfer.setData('text/plain', String(leadId));
        e.dataTransfer.effectAllowed = 'move';
        setDraggingId(leadId);
    };

    const handleDragEnd = () => {
        setDraggingId(null);
    };

    const handleDrop = (e, status) => {
        e.preventDefault();
        // Try dataTransfer first, fall back to draggingId state
        let leadId = e.dataTransfer.getData('text/plain');
        if (!leadId && draggingId) {
            leadId = String(draggingId);
        }
        if (leadId) {
            const lead = leads.find(l => String(l.id) === String(leadId));
            if (lead && lead.status !== status) {
                updateStatus({ id: lead.id, status });
            }
        }
        setDraggingId(null);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const overflowColumns = STAGES.filter(stage => {
        const count = leads.filter(l => l.status === stage.id).length;
        return count > visibleLimit;
    });
    const isExpanded = visibleLimit > PAGE_SIZE;

    return (
        <div>
            <div className="flex gap-4 overflow-x-auto pb-4 min-full">
                {STAGES.map((stage) => {
                    const fullStageLeads = leads.filter(l => l.status === stage.id);
                    const stageLeads = fullStageLeads.slice(0, visibleLimit);
                    const isTruncated = fullStageLeads.length > visibleLimit;

                    return (
                        <div
                            key={stage.id}
                            className="min-w-[240px] w-full bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3 flex flex-col"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, stage.id)}
                        >
                            <div className={`text-xs font-semibold uppercase mb-3 px-2 py-1 rounded text-white flex justify-between ${stage.color}`}>
                                {stage.label}
                                <span className="bg-white/20 px-1.5 rounded text-[10px]">{fullStageLeads.length}</span>
                            </div>

                            <div className="space-y-2 flex-1">
                                {stageLeads.map(lead => (
                                    <Card
                                        key={lead.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, lead.id)}
                                        onDragEnd={handleDragEnd}
                                        onClick={() => navigate(`/leads/${lead.id}`)}
                                        className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow relative group"
                                    >
                                        <CardContent className="p-3">
                                            <p className="font-medium text-sm truncate">{lead.name}</p>

                                            {/* New Details: City & Priority */}
                                            <div className="flex justify-between items-center mt-1 text-xs text-muted-foreground">
                                                <span>{lead.city || 'Unknown City'}</span>
                                                <span className={`font-medium ${lead.priority === 'hot' ? 'text-red-500' :
                                                    lead.priority === 'warm' ? 'text-orange-500' : 'text-blue-500'
                                                    }`}>
                                                    {lead.priority}
                                                </span>
                                            </div>

                                            {/* Footer: Source & Last Activity */}
                                            <div className="flex justify-between items-end mt-3 pt-2 border-t border-slate-100">
                                                <Badge variant="outline" className="text-[10px] h-5 font-normal text-slate-500">{lead.source_channel}</Badge>
                                                <span className="text-[10px] text-slate-400">
                                                    {formatDate(lead.updated_at) || 'Just now'}
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {isTruncated && (
                                <p className="text-[11px] text-slate-400 text-center mt-2">
                                    showing {stageLeads.length} of {fullStageLeads.length}
                                </p>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Board-level pagination control */}
            {(overflowColumns.length > 0 || isExpanded) && (
                <div className="flex items-center justify-center gap-3 mt-2 py-3 px-4 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 rounded-lg">
                    {overflowColumns.length > 0 && (
                        <button
                            onClick={() => setVisibleLimit(prev => prev + PAGE_SIZE)}
                            className="text-sm text-blue-600 hover:text-blue-800 bg-white border border-blue-200 rounded-md px-4 py-2 font-medium hover:bg-blue-50 transition-colors"
                        >
                            Show more ({overflowColumns.length} {overflowColumns.length === 1 ? 'column has' : 'columns have'} hidden cards)
                        </button>
                    )}
                    {isExpanded && (
                        <button
                            onClick={() => setVisibleLimit(PAGE_SIZE)}
                            className="text-sm text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-md px-4 py-2 font-medium hover:bg-slate-50 transition-colors"
                        >
                            Show less
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
