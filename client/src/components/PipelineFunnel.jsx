import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useUpdateLeadStatus } from "@/hooks/useLeads";
import { useNavigate } from "react-router-dom";
import { formatDate } from "@/lib/utils";

const STAGES = [
    { id: 'new', label: 'New', color: 'bg-blue-500' },
    { id: 'contacted', label: 'Contacted', color: 'bg-indigo-500' },
    { id: 'quoted', label: 'Quoted', color: 'bg-orange-500' },
    { id: 'accepted', label: 'Accepted', color: 'bg-green-500' },
    { id: 'scheduled', label: 'Service Scheduled', color: 'bg-purple-500' },
    { id: 'completed', label: 'Service Completed', color: 'bg-teal-500' },
    { id: 'paid', label: 'Payment Received', color: 'bg-emerald-600' },
    { id: 'review_received', label: 'Review Received', color: 'bg-yellow-500' },
];

export default function PipelineFunnel({ leads, limit = 9999 }) {
    const { mutate: updateStatus } = useUpdateLeadStatus();
    const navigate = useNavigate();
    const [draggingId, setDraggingId] = useState(null);

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

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 min-full">
            {STAGES.map((stage) => {
                const fullStageLeads = leads.filter(l => l.status === stage.id);
                const stageLeads = fullStageLeads.slice(0, limit);

                return (
                    <div
                        key={stage.id}
                        className="min-w-[240px] w-full bg-slate-100 dark:bg-slate-900/50 rounded-lg p-3 flex flex-col"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, stage.id)}
                    >
                        <div className={`text-xs font-semibold uppercase mb-3 px-2 py-1 rounded text-white flex justify-between ${stage.color}`}>
                            {stage.label}
                            <span className="bg-white/20 px-1.5 rounded text-[10px]">{stageLeads.length}{fullStageLeads.length > limit ? ` / ${fullStageLeads.length}` : ''}</span>
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
                    </div>
                )
            })}
        </div>
    );
}
