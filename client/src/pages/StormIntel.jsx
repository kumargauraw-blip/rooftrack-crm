import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHailReports, useRecentHailReports, useSwathSummary } from '../hooks/useStormIntel';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Zap, Megaphone, CloudRain, AlertTriangle } from 'lucide-react';

function formatDateToYYMMDD(dateStr) {
    // dateStr is YYYY-MM-DD from input[type=date]
    const [yyyy, mm, dd] = dateStr.split('-');
    return yyyy.slice(2) + mm + dd;
}

function todayYYMMDD() {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
}

function todayInputDate() {
    return new Date().toISOString().split('T')[0];
}

function formatYYMMDDtoDisplay(yymmdd) {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd;
    const yy = yymmdd.slice(0, 2);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
}

function hailSizeColor(size) {
    if (size >= 2) return 'bg-red-100 text-red-800 border-red-300';
    if (size >= 1.5) return 'bg-orange-100 text-orange-800 border-orange-300';
    if (size >= 1) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
}

function hailSizeBg(size) {
    if (size >= 2) return 'border-red-400 bg-red-50';
    if (size >= 1.5) return 'border-orange-400 bg-orange-50';
    if (size >= 1) return 'border-yellow-400 bg-yellow-50';
    return 'border-green-400 bg-green-50';
}

function formatTime(time) {
    if (!time || time.length < 4) return time;
    const hh = time.slice(0, 2);
    const mm = time.slice(2, 4);
    return `${hh}:${mm} UTC`;
}

// --- Swath Summary Card ---
function SwathCard({ zone }) {
    const navigate = useNavigate();

    const handleCreateCampaign = () => {
        const subject = `Your area was hit by ${zone.maxHailSize}-inch hail - Free Roof Inspection`;
        navigate('/campaigns', {
            state: {
                prefill: {
                    type: 'storm_response',
                    name: `Storm Response - ${zone.county} ${formatYYMMDDtoDisplay(zone.latestReport?.date || '')}`,
                    subject,
                    zips: zone.zips,
                    county: zone.county,
                }
            }
        });
    };

    return (
        <Card className={`border-2 ${hailSizeBg(zone.maxHailSize)}`}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{zone.county}</CardTitle>
                    <Badge className={hailSizeColor(zone.maxHailSize)}>
                        {zone.maxHailSize}" max
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{zone.zone}</p>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                        <p className="text-muted-foreground text-xs">Reports</p>
                        <p className="font-semibold">{zone.reportCount}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground text-xs">Max Hail</p>
                        <p className="font-semibold">{zone.maxHailSize}"</p>
                    </div>
                </div>

                <div>
                    <p className="text-xs text-muted-foreground mb-1">Cities Affected</p>
                    <div className="flex flex-wrap gap-1">
                        {zone.cities.map(city => (
                            <Badge key={city} variant="outline" className="text-xs">{city}</Badge>
                        ))}
                    </div>
                </div>

                <div>
                    <p className="text-xs text-muted-foreground mb-1">Zip Codes</p>
                    <p className="text-xs font-mono">{zone.zips.join(', ')}</p>
                </div>

                {zone.latestReport && (
                    <p className="text-xs text-muted-foreground">
                        Latest: {formatYYMMDDtoDisplay(zone.latestReport.date)} at {formatTime(zone.latestReport.time)}
                    </p>
                )}

                <Button
                    size="sm"
                    className="w-full"
                    onClick={handleCreateCampaign}
                >
                    <Megaphone className="h-3.5 w-3.5 mr-1.5" />
                    Create Campaign
                </Button>
            </CardContent>
        </Card>
    );
}

// --- Reports Table ---
function ReportsTable({ reports }) {
    if (!reports?.length) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Detailed Reports ({reports.length})</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <th className="py-2 pr-3 font-medium">Date</th>
                                <th className="py-2 pr-3 font-medium">Time</th>
                                <th className="py-2 pr-3 font-medium">Hail Size</th>
                                <th className="py-2 pr-3 font-medium">Location</th>
                                <th className="py-2 pr-3 font-medium">County</th>
                                <th className="py-2 pr-3 font-medium">Zone</th>
                                <th className="py-2 font-medium">Comments</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {reports.map((r, i) => (
                                <tr key={i} className="hover:bg-muted/50">
                                    <td className="py-2 pr-3 whitespace-nowrap">{formatYYMMDDtoDisplay(r.date)}</td>
                                    <td className="py-2 pr-3 whitespace-nowrap">{formatTime(r.time)}</td>
                                    <td className="py-2 pr-3">
                                        <Badge className={hailSizeColor(r.hailSize)}>{r.hailSize}"</Badge>
                                    </td>
                                    <td className="py-2 pr-3">{r.location}</td>
                                    <td className="py-2 pr-3">{r.county}</td>
                                    <td className="py-2 pr-3">
                                        {r.zoneInfo ? (
                                            <span className="text-xs">{r.zoneInfo.county}</span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                    <td className="py-2 text-xs text-muted-foreground max-w-xs truncate">{r.comments}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}

// --- Main Component ---
export default function StormIntel() {
    const [mode, setMode] = useState('recent'); // 'date' or 'recent'
    const [selectedDate, setSelectedDate] = useState(todayInputDate());

    const dateYYMMDD = formatDateToYYMMDD(selectedDate);

    const singleDay = useHailReports(mode === 'date' ? dateYYMMDD : null);
    const recent = useRecentHailReports();
    const swath = useSwathSummary();

    const isRecent = mode === 'recent';
    const reportsQuery = isRecent ? recent : singleDay;
    const reports = reportsQuery.data?.data || [];
    const isLoading = reportsQuery.isLoading || (isRecent && swath.isLoading);
    const isError = reportsQuery.isError;

    const swathData = isRecent ? (swath.data?.data || []) : [];

    // For single-day mode, build swath from reports
    const singleDaySwath = !isRecent ? buildSwathFromReports(reports) : [];
    const displaySwath = isRecent ? swathData : singleDaySwath;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Zap className="h-6 w-6 text-yellow-500" />
                        Storm Intel
                    </h1>
                    <p className="text-sm text-muted-foreground">SPC hail reports for the DFW metro area</p>
                </div>

                <div className="flex items-center gap-2">
                    <Input
                        type="date"
                        value={selectedDate}
                        onChange={e => {
                            setSelectedDate(e.target.value);
                            setMode('date');
                        }}
                        className="w-40"
                    />
                    <Button
                        variant={isRecent ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setMode(isRecent ? 'date' : 'recent')}
                    >
                        Last 3 Days
                    </Button>
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="text-center py-12">
                    <CloudRain className="h-8 w-8 mx-auto mb-3 text-muted-foreground animate-pulse" />
                    <p className="text-muted-foreground">Fetching SPC hail data...</p>
                </div>
            )}

            {/* Error */}
            {isError && (
                <Card>
                    <CardContent className="py-8 text-center">
                        <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-red-500" />
                        <p className="text-red-600 font-medium">Failed to load hail reports</p>
                        <p className="text-sm text-muted-foreground mt-1">SPC data may be temporarily unavailable. Try again later.</p>
                    </CardContent>
                </Card>
            )}

            {/* No Reports */}
            {!isLoading && !isError && reports.length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center">
                        <CloudRain className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p className="text-muted-foreground">
                            No hail reports for DFW on {isRecent ? 'the last 3 days' : selectedDate}
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Swath Summary Cards */}
            {!isLoading && displaySwath.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-3">Hail Swath Summary</h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {displaySwath.map(zone => (
                            <SwathCard key={zone.zone} zone={zone} />
                        ))}
                    </div>
                </div>
            )}

            {/* Detailed Reports Table */}
            {!isLoading && reports.length > 0 && (
                <ReportsTable reports={reports} />
            )}
        </div>
    );
}

function buildSwathFromReports(reports) {
    const zoneMap = new Map();
    for (const report of reports) {
        if (!report.zone) continue;
        if (!zoneMap.has(report.zone)) {
            zoneMap.set(report.zone, {
                zone: report.zone,
                county: report.zoneInfo?.county || report.county,
                cities: report.zoneInfo?.cities || [],
                zips: report.zoneInfo?.zips || [],
                reportCount: 0,
                maxHailSize: 0,
                latestReport: null,
                reports: [],
            });
        }
        const entry = zoneMap.get(report.zone);
        entry.reportCount++;
        if (report.hailSize > entry.maxHailSize) {
            entry.maxHailSize = report.hailSize;
        }
        if (!entry.latestReport || report.date > entry.latestReport.date ||
            (report.date === entry.latestReport.date && report.time > entry.latestReport.time)) {
            entry.latestReport = { date: report.date, time: report.time };
        }
        entry.reports.push(report);
    }
    return Array.from(zoneMap.values()).sort((a, b) => b.maxHailSize - a.maxHailSize);
}
