import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useCampaigns() {
    return useQuery({
        queryKey: ['campaigns'],
        queryFn: async () => {
            const { data } = await api.get('/campaigns');
            return data.data;
        },
    });
}

export function useCampaign(id) {
    return useQuery({
        queryKey: ['campaign', id],
        queryFn: async () => {
            const { data } = await api.get(`/campaigns/${id}`);
            return data.data;
        },
        enabled: !!id,
    });
}

export function useCreateCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (campaign) => {
            const { data } = await api.post('/campaigns', campaign);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        }
    });
}

export function useUpdateCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, ...fields }) => {
            const { data } = await api.put(`/campaigns/${id}`, fields);
            return data.data;
        },
        onSuccess: (data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['campaign', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        }
    });
}

export function useDeleteCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id) => {
            await api.delete(`/campaigns/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        }
    });
}

export function useSendCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (campaignId) => {
            const { data } = await api.post(`/campaigns/${campaignId}/send`);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
            queryClient.invalidateQueries({ queryKey: ['campaign'] });
        }
    });
}

export function useAddCampaignRecipients() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ campaignId, ...filterData }) => {
            const { data } = await api.post(`/campaigns/${campaignId}/recipients`, filterData);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaign'] });
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        }
    });
}

export function useRecipientPreview(campaignId, filter, statusValue, cityValue) {
    return useQuery({
        queryKey: ['recipientPreview', campaignId, filter, statusValue, cityValue],
        queryFn: async () => {
            const params = new URLSearchParams({ filter });
            if (filter === 'status') params.set('statusValue', statusValue);
            if (filter === 'city') params.set('cityValue', cityValue);
            const { data } = await api.get(`/campaigns/${campaignId}/recipients/preview?${params}`);
            return data.data;
        },
        enabled: !!campaignId && (filter !== 'city' || cityValue.length > 0),
    });
}

export function useCloneCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (campaignId) => {
            const { data } = await api.post(`/campaigns/${campaignId}/clone`);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        }
    });
}
