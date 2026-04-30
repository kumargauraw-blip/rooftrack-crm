import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

/**
 * Fetch leads from the CRM.
 *
 * Options:
 *   stage          - 'active' (default) | 'lost' | 'paid'
 *                    'active' shows the working pipeline (everything
 *                    except lost), with paid > 30 days auto-aged out.
 *                    'lost' returns only lost leads (Lost tab).
 *                    'paid' returns only paid leads (rare; Customers
 *                    page uses /customers instead).
 *   completedSince - legacy ISO date filter; new code should use stage.
 */
export function useLeads({ completedSince, stage } = {}) {
    return useQuery({
        queryKey: ['leads', { completedSince, stage }],
        queryFn: async () => {
            const params = {};
            if (stage) params.stage = stage;
            else if (completedSince) params.completedSince = completedSince;
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

export function useUpdateLead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, ...fields }) => {
            const { data } = await api.put(`/leads/${id}`, fields);
            return data.data;
        },
        onSuccess: (data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['lead', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
            queryClient.invalidateQueries({ queryKey: ['appointments'] });
        }
    });
}

export function useDeleteLead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id) => {
            await api.delete(`/leads/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
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
