import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useLeads({ completedSince } = {}) {
    return useQuery({
        queryKey: ['leads', { completedSince }],
        queryFn: async () => {
            const params = {};
            if (completedSince) params.completedSince = completedSince;
            const { data } = await api.get('/leads', { params });
            return data.data;
        },
    });
}

export function useLead(id) {
    return useQuery({
        queryKey: ['lead', id],
        queryFn: async () => {
            const { data } = await api.get(`/leads/${id}`);
            return data.data;
        },
        enabled: !!id,
    });
}

export function useUpdateLeadStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, status }) => {
            await api.patch(`/leads/${id}/status`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['lead'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
        }
    });
}

export function useUpdateLeadNotes() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, notes }) => {
            const { data } = await api.patch(`/leads/${id}/notes`, { notes });
            return data;
        },
        onSuccess: (data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['lead', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['appointments'] });
        }
    });
}

export function useCreateLead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (newLead) => {
            const { data } = await api.post('/leads', newLead);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
            queryClient.invalidateQueries({ queryKey: ['appointments'] });
        }
    });
}
