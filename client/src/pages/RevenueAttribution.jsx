import { useReferralStats } from '../hooks/useReferrals';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Users, TrendingUp, BarChart3 } from 'lucide-react';

const SOURCE_LABELS = {
    referral: 'Referral',
    google_ads: 'Google Ads',
    facebook: 'Facebook',
    organic: 'Organic / SEO',
    nextdoor: 'Nextdoor',
    storm_response: 'Storm Response',
    manual: 'Manual / Direct',
    unknown: 'Unknown',
};

const SOURCE_COLORS = {
    referral: 'bg-green-500',
    google_ads: 'bg-blue-500',
    facebook: 'bg-indigo-500',
    organic: 'bg-emerald-500',
    nextdoor: 'bg-teal-500',
    storm_response: 'bg-orange-500',
    manual: 'bg-gray-500',
    unknown: 'bg-gray-300',
};

export default function RevenueAttribution() {
    const { data: stats, isLoading } = useReferralStats();

    if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading attribution data...</div>;

    const bySource = stats?.bySource || [];
    const referralStats = stats?.referralStats || {};
    const totalLeads = bySource.reduce((sum, s) => sum + s.lead_count, 0);
    const totalRevenue = bySource.reduce((sum, s) => sum + s.total_revenue, 0);
    const maxRevenue = Math.max(...bySource.map(s => s.total_revenue), 1);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Revenue Attribution</h1>
                <p className="text-sm text-muted-foreground">Where your leads and revenue come from</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Users className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalLeads}</p>
                                <p className="text-xs text-muted-foreground">Total Leads</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <DollarSign className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">${totalRevenue.toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground">Total Revenue</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-100 rounded-lg">
                                <TrendingUp className="h-5 w-5 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{referralStats.total_referrals || 0}</p>
                                <p className="text-xs text-muted-foreground">Referral Leads</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg">
                                <BarChart3 className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">${(referralStats.referral_revenue || 0).toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground">Referral Revenue</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Bar Chart - Revenue by Source */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Revenue by Source</CardTitle>
                </CardHeader>
                <CardContent>
                    {bySource.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No data yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {bySource.map((source) => {
                                const pct = maxRevenue > 0 ? (source.total_revenue / maxRevenue) * 100 : 0;
                                return (
                                    <div key={source.source} className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="font-medium">{SOURCE_LABELS[source.source] || source.source}</span>
                                            <span className="text-muted-foreground">${source.total_revenue.toLocaleString()}</span>
                                        </div>
                                        <div className="h-6 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${SOURCE_COLORS[source.source] || 'bg-gray-400'} transition-all`}
                                                style={{ width: `${Math.max(pct, 2)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Detailed Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Source Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left py-3 px-4 font-medium">Source</th>
                                    <th className="text-right py-3 px-4 font-medium">Leads</th>
                                    <th className="text-right py-3 px-4 font-medium">Converted</th>
                                    <th className="text-right py-3 px-4 font-medium">Revenue</th>
                                    <th className="text-right py-3 px-4 font-medium">Conversion Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bySource.map((source) => {
                                    const rate = source.lead_count > 0
                                        ? ((source.converted_count / source.lead_count) * 100).toFixed(1)
                                        : '0.0';
                                    return (
                                        <tr key={source.source} className="border-b">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-3 h-3 rounded-full ${SOURCE_COLORS[source.source] || 'bg-gray-400'}`} />
                                                    {SOURCE_LABELS[source.source] || source.source}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-right">{source.lead_count}</td>
                                            <td className="py-3 px-4 text-right">{source.converted_count}</td>
                                            <td className="py-3 px-4 text-right font-medium">${source.total_revenue.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">
                                                <Badge variant={Number(rate) >= 50 ? 'success' : Number(rate) >= 25 ? 'warning' : 'secondary'}>
                                                    {rate}%
                                                </Badge>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
