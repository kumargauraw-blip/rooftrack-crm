import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useCustomers(filters = {}) {
    return useQuery({
        queryKey: ['customers', filters],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filters.minSatisfaction) params.set('minSatisfaction', filters.minSatisfaction);
            if (filters.completedAfter) params.set('completedAfter', filters.completedAfter);
            if (filters.completedBefore) params.set('completedBefore', filters.completedBefore);
            if (filters.hasReferrals !== undefined) params.set('hasReferrals', filters.hasReferrals);
            if (filters.hasReview !== undefined) params.set('hasReview', filters.hasReview);
            const qs = params.toString();
            const { data } = await api.get(`/customers${qs ? '?' + qs : ''}`);
            return data.data;
        },
    });
}

/**
 * Mark or unmark a customer's review_received_at flag. Doesn't change
 * the customer's status — just records whether they've left a review.
 */
export function useMarkReview() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, received }) => {
            await api.patch(`/customers/${id}/review`, { received });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            queryClient.invalidateQueries({ queryKey: ['lead'] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
        },
    });
}

export function useUpdateSatisfaction() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, satisfaction_score }) => {
            await api.patch(`/customers/${id}/satisfaction`, { satisfaction_score });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            queryClient.invalidateQueries({ queryKey: ['lead'] });
        }
    });
}

export function useCustomerReferrals(customerId) {
    return useQuery({
        queryKey: ['customer-referrals', customerId],
        queryFn: async () => {
            const { data } = await api.get(`/customers/${customerId}/referrals`);
            return data.data;
        },
        enabled: !!customerId,
    });
}
