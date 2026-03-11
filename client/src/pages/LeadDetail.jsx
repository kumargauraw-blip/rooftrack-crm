import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLead, useUpdateLeadStatus, useUpdateLeadNotes, useUpdateLead, useDeleteLead } from '../hooks/useLeads';
import { useUpdateSatisfaction, useCustomerReferrals } from '../hooks/useCustomers';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ActivityFeed from "@/components/ActivityFeed";
import { Input } from "@/components/ui/input";
import { Phone, Mail, MapPin, Calendar, DollarSign, ArrowLeft, Save, FileText, Star, Share2, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LeadDetail() {
    const { id } = useParams();
    const { data: lead, isLoading } = useLead(id);
    const { mutate: updateStatus } = useUpdateLeadStatus();
    const { mutate: updateNotes, isPending: isSavingNotes } = useUpdateLeadNotes();
    const { mutate: updateLead, isPending: isSavingLead } = useUpdateLead();
    const { mutate: deleteLead, isPending: isDeleting } = useDeleteLead();
    const { mutate: updateSatisfaction } = useUpdateSatisfaction();
    const { data: referrals } = useCustomerReferrals(id);

    const navigate = useNavigate();

    const [editingNotes, setEditingNotes] = useState(false);
    const [notesValue, setNotesValue] = useState('');
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [editForm, setEditForm] = useState({});

    useEffect(() => {
        if (lead?.notes) {
            setNotesValue(lead.notes);
        }
    }, [lead?.notes]);

    if (isLoading) return <div className="p-8">Loading detail...</div>;
    if (!lead) return <div className="p-8">Lead not found</div>;

    const handleOpenEdit = () => {
        setEditForm({
            name: lead.name || '',
            phone: lead.phone || '',
            email: lead.email || '',
            address: lead.address || '',
            notes: lead.notes || '',
            priority: lead.priority || 'medium',
            status: lead.status || 'new',
            source_channel: lead.source_channel || 'manual',
        });
        setShowEditModal(true);
    };

    const handleSaveEdit = () => {
        updateLead({ id: lead.id, ...editForm }, {
            onSuccess: () => setShowEditModal(false),
        });
    };

    const handleDelete = () => {
        deleteLead(lead.id, {
            onSuccess: () => navigate('/'),
        });
    };

    const handleSaveNotes = () => {
        updateNotes({ id: lead.id, notes: notesValue }, {
            onSuccess: (data) => {
                setEditingNotes(false);
                if (data?.data?.autoAppointments?.length > 0) {
                    // Could show a toast here
                }
            }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{lead.name}</h2>
                    <div className="flex gap-2 text-sm text-muted-foreground items-center">
                        <Badge variant="outline">{lead.source_channel}</Badge>
                        <span>Created {new Date(lead.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                <div className="ml-auto flex gap-2">
                    <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={lead.status}
                        onChange={(e) => updateStatus({ id: lead.id, status: e.target.value })}
                    >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="quoted">Quoted</option>
                        <option value="accepted">Accepted</option>
                        <option value="scheduled">Service Scheduled</option>
                        <option value="completed">Service Completed</option>
                        <option value="paid">Payment Received</option>
                        <option value="review_received">Review Received</option>
                        <option value="lost">Lost</option>
                    </select>
                    <Button variant="outline" size="sm" onClick={handleOpenEdit}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="h-3 w-3 mr-1" /> Delete
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Left Column: Contact & Info */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Contact Info</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <a href={`tel:${lead.phone}`} className="text-sm hover:underline">{lead.phone}</a>
                            </div>
                            <div className="flex items-center gap-3">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a href={`mailto:${lead.email}`} className="text-sm hover:underline">{lead.email}</a>
                            </div>
                            <div className="flex items-center gap-3">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{lead.address}, {lead.city}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Notes Card - Editable */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileText className="h-4 w-4" /> Notes
                            </CardTitle>
                            {!editingNotes ? (
                                <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                                    Edit
                                </Button>
                            ) : (
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => { setEditingNotes(false); setNotesValue(lead.notes || ''); }}>
                                        Cancel
                                    </Button>
                                    <Button size="sm" onClick={handleSaveNotes} disabled={isSavingNotes}>
                                        <Save className="h-3 w-3 mr-1" />
                                        {isSavingNotes ? 'Saving...' : 'Save'}
                                    </Button>
                                </div>
                            )}
                        </CardHeader>
                        <CardContent>
                            {editingNotes ? (
                                <div className="space-y-2">
                                    <textarea
                                        className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        value={notesValue}
                                        onChange={(e) => setNotesValue(e.target.value)}
                                        placeholder="Add notes... (e.g., 'Follow up in 3 days' or 'Call on March 10th' to auto-schedule)"
                                    />
                                    <p className="text-xs text-slate-400">
                                        Tip: Dates like "after 3 days", "on March 10th", or "next Monday" will auto-create appointments.
                                    </p>
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                    {lead.notes || 'No notes yet. Click Edit to add.'}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Financials</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex justify-between items-center bg-slate-50 p-3 rounded">
                                <span className="text-sm">Estimated Value</span>
                                <span className="font-semibold">${lead.estimated_value?.toLocaleString()}</span>
                            </div>
                            {lead.actual_value != null && (
                                <div className="flex justify-between items-center bg-slate-50 p-3 rounded">
                                    <span className="text-sm">Actual Value</span>
                                    <span className="font-semibold">${lead.actual_value?.toLocaleString()}</span>
                                </div>
                            )}
                            {lead.payment_date && (
                                <div className="flex justify-between items-center bg-slate-50 p-3 rounded">
                                    <span className="text-sm">Payment Date</span>
                                    <span className="font-semibold">{new Date(lead.payment_date).toLocaleDateString()}</span>
                                </div>
                            )}

                            {lead.jobs && lead.jobs.length > 0 && (
                                <div className="pt-4 border-t">
                                    <p className="font-semibold text-sm mb-2">Jobs</p>
                                    {lead.jobs.map(job => (
                                        <div key={job.id} className="flex justify-between text-sm py-1">
                                            <span>{job.job_type} ({job.status})</span>
                                            <span>${job.quote_amount?.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Satisfaction Score - show for completed+ leads */}
                    {['completed', 'paid', 'review_received'].includes(lead.status) && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Star className="h-4 w-4" /> Satisfaction
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            type="button"
                                            onClick={() => updateSatisfaction({ id: lead.id, satisfaction_score: star })}
                                            className="cursor-pointer hover:scale-110 transition-transform"
                                        >
                                            <Star
                                                className={`h-6 w-6 ${star <= (lead.satisfaction_score || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                                            />
                                        </button>
                                    ))}
                                </div>
                                {!lead.satisfaction_score && (
                                    <p className="text-xs text-muted-foreground mt-2">Click a star to rate</p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Referral Info */}
                    {(lead.referred_by || lead.referral_source || (referrals && referrals.length > 0)) && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Share2 className="h-4 w-4" /> Referrals
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {lead.referral_source && (
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-muted-foreground">Source</span>
                                        <Badge variant="outline">{lead.referral_source}</Badge>
                                    </div>
                                )}
                                {lead.referred_by && (
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-muted-foreground">Referred by</span>
                                        <Link to={`/leads/${lead.referred_by}`} className="text-sm text-blue-600 hover:underline font-medium">
                                            View Referrer
                                        </Link>
                                    </div>
                                )}
                                {referrals && referrals.length > 0 && (
                                    <div className="pt-2 border-t">
                                        <p className="text-sm font-medium mb-2">Referred {referrals.length} lead{referrals.length !== 1 ? 's' : ''}</p>
                                        {referrals.map(ref => (
                                            <Link key={ref.id} to={`/leads/${ref.id}`} className="flex justify-between text-sm py-1 hover:bg-muted/30 px-1 rounded">
                                                <span>{ref.name}</span>
                                                <Badge variant="secondary" className="text-xs">{ref.status}</Badge>
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Right Column: Timeline & Interactions */}
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Appointments</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {lead.appointments && lead.appointments.length > 0 ? (
                                <div className="space-y-2">
                                    {lead.appointments.map(apt => (
                                        <div key={apt.id} className="flex items-center justify-between p-3 border rounded-md">
                                            <div className="flex items-center gap-3">
                                                <Calendar className="h-4 w-4 text-purple-500" />
                                                <div>
                                                    <p className="font-medium text-sm">{apt.type}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {new Date(apt.scheduled_date).toLocaleDateString()} at {apt.scheduled_time}
                                                    </p>
                                                    {apt.notes && (
                                                        <p className="text-xs text-slate-400 mt-0.5">{apt.notes}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <Badge variant="secondary">{apt.status}</Badge>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">No appointments scheduled.</p>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Activity Log</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ActivityFeed activities={lead.interactions || []} />
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Edit Lead Modal */}
            {showEditModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowEditModal(false)}>
                    <div className="bg-background rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6 space-y-4">
                            <h3 className="text-lg font-semibold">Edit Lead</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-sm font-medium">Name</label>
                                    <Input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Phone</label>
                                    <Input value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Email</label>
                                    <Input type="email" value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Address</label>
                                    <Input value={editForm.address} onChange={(e) => setEditForm(f => ({ ...f, address: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Notes</label>
                                    <textarea
                                        className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        value={editForm.notes}
                                        onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-sm font-medium">Priority</label>
                                        <select
                                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                            value={editForm.priority}
                                            onChange={(e) => setEditForm(f => ({ ...f, priority: e.target.value }))}
                                        >
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium">Status</label>
                                        <select
                                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                            value={editForm.status}
                                            onChange={(e) => setEditForm(f => ({ ...f, status: e.target.value }))}
                                        >
                                            <option value="new">New</option>
                                            <option value="contacted">Contacted</option>
                                            <option value="quoted">Quoted</option>
                                            <option value="accepted">Accepted</option>
                                            <option value="scheduled">Scheduled</option>
                                            <option value="completed">Completed</option>
                                            <option value="paid">Paid</option>
                                            <option value="review_received">Review Received</option>
                                            <option value="lost">Lost</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Source Channel</label>
                                    <select
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                        value={editForm.source_channel}
                                        onChange={(e) => setEditForm(f => ({ ...f, source_channel: e.target.value }))}
                                    >
                                        <option value="manual">Manual</option>
                                        <option value="website">Website</option>
                                        <option value="telegram">Telegram</option>
                                        <option value="phone">Phone</option>
                                        <option value="referral">Referral</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
                                <Button onClick={handleSaveEdit} disabled={isSavingLead}>
                                    <Save className="h-3 w-3 mr-1" />
                                    {isSavingLead ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
                    <div className="bg-background rounded-lg shadow-lg w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-2">Delete Lead</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Are you sure you want to delete this lead? This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                                <Trash2 className="h-3 w-3 mr-1" />
                                {isDeleting ? 'Deleting...' : 'Delete'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
