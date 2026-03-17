import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export function useHailReports(date) {
    return useQuery({
        queryKey: ['hail-reports', date],
        queryFn: async () => {
            const params = date ? { date } : {};
            const { data } = await api.get('/storm-intel/hail-reports', { params });
            return data;
        },
        enabled: !!date,
        staleTime: 15 * 60 * 1000, // 15 min
        retry: 2,
    });
}

export function useRecentHailReports() {
    return useQuery({
        queryKey: ['hail-reports', 'recent'],
        queryFn: async () => {
            const { data } = await api.get('/storm-intel/hail-reports/recent');
            return data;
        },
        staleTime: 15 * 60 * 1000,
        retry: 2,
    });
}

export function useSwathSummary() {
    return useQuery({
        queryKey: ['swath-summary'],
        queryFn: async () => {
            const { data } = await api.get('/storm-intel/swath-summary');
            return data;
        },
        staleTime: 15 * 60 * 1000,
        retry: 2,
    });
}
