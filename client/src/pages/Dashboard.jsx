import { useState, useMemo } from 'react';
import { useDashboardSummary } from "../hooks/useDashboard";
import { Users, Calendar, Hammer, DollarSign, Activity } from "lucide-react";
import StatsCard from "../components/StatsCard";
import PipelineFunnel from "../components/PipelineFunnel";
import RevenueChart from "../components/RevenueChart";
import ChannelChart from "../components/ChannelChart";
import ActivityFeed from "../components/ActivityFeed";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useLeads } from "../hooks/useLeads";

function getSixMonthsAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
}

export default function Dashboard() {
    const { data: summary, isLoading } = useDashboardSummary();
    const completedSince = useMemo(() => getSixMonthsAgo(), []);
    const { data: leads, isLoading: leadsLoading } = useLeads({ completedSince });

    // Filter States
    const [timeFilter, setTimeFilter] = useState('all'); // all, 7days, 30days, 90days
    const [statusFilter, setStatusFilter] = useState('all');

    if (isLoading || leadsLoading) {
        return <div className="p-8">Loading dashboard metrics...</div>;
    }

    // Filter Logic
    const filteredLeads = (leads || []).filter(lead => {
        // Status Filter
        if (statusFilter !== 'all' && lead.status !== statusFilter) return false;

        // Time Filter
        if (timeFilter !== 'all') {
            const date = new Date(lead.updated_at || lead.created_at);
            const now = new Date();
            const diffTime = Math.abs(now - date);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (timeFilter === '7days' && diffDays > 7) return false;
            if (timeFilter === '30days' && diffDays > 30) return false;
            if (timeFilter === '90days' && diffDays > 90) return false;
        }
        return true;
    });

    // Format money
    const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                <p className="text-muted-foreground">Overview of your business performance.</p>
            </div>

            {/* Stats Row */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                    title="New Leads (Week)"
                    value={summary.newLeadsThisWeek}
                    icon={Users}
                    description="+2 from last week"
                />
                <StatsCard
                    title="Appointments Today"
                    value={summary.appointmentsToday}
                    icon={Calendar}
                    description="3 scheduled"
                />
                <StatsCard
                    title="Active Jobs"
                    value={summary.activeJobs}
                    icon={Hammer}
                    description="In progress or pending"
                />
                <StatsCard
                    title="Revenue (Month)"
                    value={fmtMoney(summary.revenueThisMonth)}
                    icon={DollarSign}
                    description={`vs ${fmtMoney(summary.revenueLastMonth)} last month`}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

                {/* Charts Section */}
                <RevenueChart data={summary.revenueByMonth} />
                <ChannelChart data={summary.leadsBySource} />

            </div>

            {/* Pipeline Funnel - Full Width */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Lead Pipeline</CardTitle>
                    <div className="flex gap-2">
                        <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Stages</option>
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
                        <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                            value={timeFilter}
                            onChange={(e) => setTimeFilter(e.target.value)}
                        >
                            <option value="all">All Time</option>
                            <option value="7days">Last 7 Days</option>
                            <option value="30days">Last 30 Days</option>
                            <option value="90days">Last 3 Months</option>
                        </select>
                    </div>
                </CardHeader>
                <CardContent>
                    <PipelineFunnel leads={filteredLeads} />
                </CardContent>
            </Card>

            {/* Activity Feed */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    {/* Placeholder for Map or Storm Map in future */}
                    <CardHeader>
                        <CardTitle>Storm Activity Map</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px] flex items-center justify-center bg-slate-100 rounded-md">
                        <p className="text-muted-foreground">Interactive Storm Map Integration (Coming Soon)</p>
                    </CardContent>
                </Card>

                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ActivityFeed activities={summary.recentActivity} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
