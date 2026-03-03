import { useState, useRef, useMemo } from 'react';
import { useLeads, useCreateLead, useUpdateLeadStatus } from "../hooks/useLeads";
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Plus, Search, Phone, ArrowRight, LayoutGrid, List } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const STATUSES = [
    { key: 'new', label: 'New', color: 'bg-blue-500', lightBg: 'bg-blue-50', border: 'border-blue-200' },
    { key: 'contacted', label: 'Contacted', color: 'bg-indigo-500', lightBg: 'bg-indigo-50', border: 'border-indigo-200' },
    { key: 'quoted', label: 'Quoted', color: 'bg-amber-500', lightBg: 'bg-amber-50', border: 'border-amber-200' },
    { key: 'accepted', label: 'Accepted', color: 'bg-emerald-500', lightBg: 'bg-emerald-50', border: 'border-emerald-200' },
    { key: 'scheduled', label: 'Service Scheduled', color: 'bg-purple-500', lightBg: 'bg-purple-50', border: 'border-purple-200' },
    { key: 'completed', label: 'Service Completed', color: 'bg-teal-500', lightBg: 'bg-teal-50', border: 'border-teal-200' },
    { key: 'paid', label: 'Payment Received', color: 'bg-green-600', lightBg: 'bg-green-50', border: 'border-green-200' },
    { key: 'review_received', label: 'Review Received', color: 'bg-sky-500', lightBg: 'bg-sky-50', border: 'border-sky-200' },
    { key: 'lost', label: 'Lost', color: 'bg-red-500', lightBg: 'bg-red-50', border: 'border-red-200' },
];

const STATUS_DATE_MAP = {
    contacted: 'contacted_at',
    scheduled: 'scheduled_at',
    quoted: 'quoted_at',
    accepted: 'accepted_at',
    completed: 'completed_at',
    paid: 'paid_at',
    review_received: 'review_received_at',
    lost: 'lost_at',
};

function LeadCard({ lead, onDragStart }) {
    const statusDateCol = STATUS_DATE_MAP[lead.status];
    const statusDate = statusDateCol ? lead[statusDateCol] : null;
    const statusInfo = STATUSES.find(s => s.key === lead.status);

    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(lead.id));
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(lead.id);
            }}
            className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-150 active:opacity-70 active:scale-[0.98]"
        >
            <div className="flex items-start justify-between mb-2">
                <Link to={`/leads/${lead.id}`} className="font-semibold text-sm text-slate-800 hover:text-blue-600 hover:underline truncate max-w-[140px]">
                    {lead.name}
                </Link>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    lead.priority === 'hot' ? 'bg-red-100 text-red-700' :
                    lead.priority === 'warm' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                }`}>
                    {lead.priority}
                </span>
            </div>

            {lead.phone && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                    <Phone className="h-3 w-3" />
                    <span>{lead.phone}</span>
                </div>
            )}

            <div className="flex items-center justify-between mt-2">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{lead.source_channel}</Badge>
                <span className="text-[10px] text-slate-400">
                    {statusDate
                        ? formatDistanceToNow(new Date(statusDate + 'Z'), { addSuffix: false })
                        : formatDistanceToNow(new Date(lead.created_at + 'Z'), { addSuffix: false })
                    }
                </span>
            </div>
        </div>
    );
}

const KANBAN_PAGE_SIZE = 10;

function KanbanBoard({ leads, searchTerm }) {
    const { mutate: updateStatus } = useUpdateLeadStatus();
    const [draggingId, setDraggingId] = useState(null);
    const [dragOverCol, setDragOverCol] = useState(null);
    const [visibleCounts, setVisibleCounts] = useState({});

    const getVisible = (key) => visibleCounts[key] || KANBAN_PAGE_SIZE;
    const showMore = (key) => setVisibleCounts(prev => ({ ...prev, [key]: (prev[key] || KANBAN_PAGE_SIZE) + KANBAN_PAGE_SIZE }));
    const showLess = (key) => setVisibleCounts(prev => ({ ...prev, [key]: KANBAN_PAGE_SIZE }));

    const filteredLeads = leads?.filter(lead =>
        lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (lead.phone && lead.phone.includes(searchTerm))
    );

    const handleDrop = (e, targetStatus) => {
        e.preventDefault();
        // Try dataTransfer first, fall back to draggingId state
        let leadId = e.dataTransfer.getData('text/plain');
        if (!leadId && draggingId) {
            leadId = String(draggingId);
        }
        if (leadId) {
            const lead = leads.find(l => String(l.id) === String(leadId));
            if (lead && lead.status !== targetStatus) {
                updateStatus({ id: lead.id, status: targetStatus });
            }
        }
        setDraggingId(null);
        setDragOverCol(null);
    };

    const handleDragOver = (e, statusKey) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverCol(statusKey);
    };

    const handleDragLeave = (e, statusKey) => {
        // Only clear if actually leaving the column (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setDragOverCol(null);
        }
    };

    return (
        <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max">
                {STATUSES.map((status) => {
                    const columnLeads = filteredLeads?.filter(l => l.status === status.key) || [];
                    const visible = getVisible(status.key);
                    const visibleLeads = columnLeads.slice(0, visible);
                    const hasMore = columnLeads.length > visible;
                    const canCollapse = visible > KANBAN_PAGE_SIZE;
                    const isOver = dragOverCol === status.key;

                    return (
                        <div
                            key={status.key}
                            className={`w-[220px] flex-shrink-0 rounded-lg border-2 transition-colors duration-150 ${
                                isOver ? `${status.border} ${status.lightBg} border-dashed` : 'border-slate-200 bg-slate-50/50'
                            }`}
                            onDragOver={(e) => handleDragOver(e, status.key)}
                            onDragLeave={(e) => handleDragLeave(e, status.key)}
                            onDrop={(e) => handleDrop(e, status.key)}
                        >
                            {/* Column header */}
                            <div className="p-3 border-b border-slate-200">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2.5 h-2.5 rounded-full ${status.color}`} />
                                        <span className="text-xs font-semibold text-slate-700">{status.label}</span>
                                    </div>
                                    <span className="text-xs font-medium text-slate-400 bg-white rounded-full px-2 py-0.5 border">
                                        {columnLeads.length}
                                    </span>
                                </div>
                            </div>

                            {/* Cards */}
                            <div className="p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-280px)] overflow-y-auto">
                                {columnLeads.length === 0 && (
                                    <div className={`text-xs text-center py-6 rounded-md border border-dashed transition-colors ${
                                        isOver ? `${status.border} text-slate-500` : 'border-slate-200 text-slate-300'
                                    }`}>
                                        {isOver ? 'Drop here' : 'No leads'}
                                    </div>
                                )}
                                {visibleLeads.map((lead) => (
                                    <LeadCard
                                        key={lead.id}
                                        lead={lead}
                                        onDragStart={setDraggingId}
                                    />
                                ))}

                                {/* Pagination controls */}
                                {(hasMore || canCollapse) && (
                                    <div className="flex gap-1.5 mt-1">
                                        {hasMore && (
                                            <button
                                                onClick={() => showMore(status.key)}
                                                className="flex-1 text-xs text-blue-600 hover:text-blue-800 bg-white border border-blue-200 rounded py-1.5 font-medium hover:bg-blue-50 transition-colors"
                                            >
                                                Show more ({columnLeads.length - visible})
                                            </button>
                                        )}
                                        {canCollapse && (
                                            <button
                                                onClick={() => showLess(status.key)}
                                                className="flex-1 text-xs text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded py-1.5 font-medium hover:bg-slate-50 transition-colors"
                                            >
                                                Show less
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function TableView({ leads, searchTerm, statusFilter }) {
    const filteredLeads = leads?.filter(lead => {
        const matchesSearch = lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (lead.phone && lead.phone.includes(searchTerm));
        const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <Card>
            <div className="relative w-full overflow-auto">
                <table className="w-full caption-bottom text-sm text-left">
                    <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50">
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Name</th>
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Source</th>
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Status</th>
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Priority</th>
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Created</th>
                            <th className="h-12 px-4 align-middle font-medium text-muted-foreground text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                        {filteredLeads?.map((lead) => (
                            <tr key={lead.id} className="border-b transition-colors hover:bg-muted/50">
                                <td className="p-4 align-middle font-medium">
                                    <div className="flex flex-col">
                                        <span>{lead.name}</span>
                                        <span className="text-xs text-muted-foreground">{lead.phone}</span>
                                    </div>
                                </td>
                                <td className="p-4 align-middle">
                                    <Badge variant="outline">{lead.source_channel}</Badge>
                                </td>
                                <td className="p-4 align-middle">
                                    <Badge className={
                                        lead.status === 'new' ? 'bg-blue-500' :
                                        lead.status === 'paid' ? 'bg-green-500' :
                                        lead.status === 'lost' ? 'bg-red-500' : 'bg-slate-500'
                                    }>
                                        {lead.status}
                                    </Badge>
                                </td>
                                <td className="p-4 align-middle">
                                    <span className={
                                        lead.priority === 'hot' ? 'text-red-500 font-bold' :
                                        lead.priority === 'warm' ? 'text-orange-500' : 'text-blue-500'
                                    }>
                                        {lead.priority}
                                    </span>
                                </td>
                                <td className="p-4 align-middle text-muted-foreground">
                                    {formatDistanceToNow(new Date(lead.created_at))} ago
                                </td>
                                <td className="p-4 align-middle text-right">
                                    <Button variant="ghost" size="sm" asChild>
                                        <Link to={`/leads/${lead.id}`}>
                                            View <ArrowRight className="ml-2 h-4 w-4" />
                                        </Link>
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function getSixMonthsAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
}

export default function Leads() {
    const completedSince = useMemo(() => getSixMonthsAgo(), []);
    const { data: leads, isLoading } = useLeads({ completedSince });
    const { mutate: createLead } = useCreateLead();

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [viewMode, setViewMode] = useState('board'); // 'board' or 'table'
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source_channel: 'manual', notes: '' });

    if (isLoading) return <div className="p-8">Loading leads...</div>;

    const handleCreate = (e) => {
        e.preventDefault();
        createLead(newLead, {
            onSuccess: () => {
                setIsModalOpen(false);
                setNewLead({ name: '', phone: '', email: '', source_channel: 'manual', notes: '' });
            }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Leads</h2>
                    <p className="text-muted-foreground">Manage your potential customers.</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex items-center bg-white border rounded-md p-0.5 shadow-sm">
                        <button
                            onClick={() => setViewMode('board')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                viewMode === 'board' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <LayoutGrid className="h-3.5 w-3.5" /> Board
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                viewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <List className="h-3.5 w-3.5" /> Table
                        </button>
                    </div>
                    <Button onClick={() => setIsModalOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> Add Lead
                    </Button>
                </div>
            </div>

            {/* Search + Filters */}
            <div className="flex gap-4 items-center">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or phone..."
                        className="pl-8"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {viewMode === 'table' && (
                    <select
                        className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Status</option>
                        {STATUSES.map(s => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* View */}
            {viewMode === 'board' ? (
                <KanbanBoard leads={leads} searchTerm={searchTerm} />
            ) : (
                <TableView leads={leads} searchTerm={searchTerm} statusFilter={statusFilter} />
            )}

            {/* Add Lead Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <Card className="w-full max-w-md bg-white">
                        <CardHeader>
                            <CardTitle>Add New Lead</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleCreate} className="space-y-4">
                                <Input
                                    placeholder="Name"
                                    value={newLead.name}
                                    onChange={e => setNewLead({ ...newLead, name: e.target.value })}
                                    required
                                />
                                <Input
                                    placeholder="Phone"
                                    value={newLead.phone}
                                    onChange={e => setNewLead({ ...newLead, phone: e.target.value })}
                                />
                                <Input
                                    placeholder="Email"
                                    value={newLead.email}
                                    onChange={e => setNewLead({ ...newLead, email: e.target.value })}
                                />
                                <select
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={newLead.source_channel}
                                    onChange={e => setNewLead({ ...newLead, source_channel: e.target.value })}
                                >
                                    <option value="manual">Manual Entry</option>
                                    <option value="referral">Referral</option>
                                    <option value="stormwatch">StormWatch</option>
                                    <option value="homeadvisor">HomeAdvisor</option>
                                    <option value="thumbtack">Thumbtack</option>
                                    <option value="yelp">Yelp</option>
                                </select>
                                <textarea
                                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    placeholder="Notes (e.g., 'Needs roof replacement. Follow up in 3 days')"
                                    value={newLead.notes}
                                    onChange={e => setNewLead({ ...newLead, notes: e.target.value })}
                                />
                                <p className="text-xs text-slate-400">
                                    Tip: Include dates like "call after 3 days" or "follow up on March 10th" to auto-schedule appointments.
                                </p>
                                <div className="flex justify-end gap-2 mt-4">
                                    <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                                    <Button type="submit">Create Lead</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
