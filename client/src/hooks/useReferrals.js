import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useReferralStats() {
    return useQuery({
        queryKey: ['referral-stats'],
        queryFn: async () => {
            const { data } = await api.get('/referrals/stats');
            return data.data;
        },
    });
}

export function useReferralCampaigns() {
    return useQuery({
        queryKey: ['referral-campaigns'],
        queryFn: async () => {
            const { data } = await api.get('/referrals/campaigns');
            return data.data;
        },
    });
}

export function useReferralCampaign(id) {
    return useQuery({
        queryKey: ['referral-campaign', id],
        queryFn: async () => {
            const { data } = await api.get(`/referrals/campaigns/${id}`);
            return data.data;
        },
        enabled: !!id,
    });
}

export function useCreateCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (campaign) => {
            const { data } = await api.post('/referrals/campaigns', campaign);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['referral-campaigns'] });
        }
    });
}

export function useSendCampaign() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (campaignId) => {
            await api.post(`/referrals/campaigns/${campaignId}/send`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['referral-campaigns'] });
            queryClient.invalidateQueries({ queryKey: ['referral-campaign'] });
        }
    });
}

export function useAddRecipients() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ campaignId, leadIds }) => {
            const { data } = await api.post(`/referrals/campaigns/${campaignId}/recipients`, { leadIds });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['referral-campaign'] });
            queryClient.invalidateQueries({ queryKey: ['referral-campaigns'] });
        }
    });
}

export function useRemoveRecipient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ campaignId, recipientId }) => {
            await api.delete(`/referrals/campaigns/${campaignId}/recipients/${recipientId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['referral-campaign'] });
            queryClient.invalidateQueries({ queryKey: ['referral-campaigns'] });
        }
    });
}

export function useReferralIncentives() {
    return useQuery({
        queryKey: ['referral-incentives'],
        queryFn: async () => {
            const { data } = await api.get('/referrals/incentives');
            return data.data;
        },
    });
}

export function useUpdateIncentive() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, status }) => {
            await api.patch(`/referrals/incentives/${id}`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['referral-incentives'] });
        }
    });
}
